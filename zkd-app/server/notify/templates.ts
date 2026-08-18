/**
 * What the member actually reads.
 *
 * Copy lives here rather than inside each channel so the WhatsApp message and
 * the Android push cannot drift into saying different things about the same
 * flight — the failure mode where a member is told "we're booking it" on one
 * device and "we need your go-ahead" on another.
 *
 * ── Two honest constraints this copy has to respect ────────────────────────
 *
 * 1. NOTHING IS RESERVED. Options are kept *fresh* by the refresh loop, never
 *    held — a passenger cannot hold two tickets, and a carrier's auditors
 *    cancel duplicates (sometimes cancelling the original). So this never says
 *    "held for you" or "reserved". See memory.md, 2026-08-17.
 * 2. THE PROBABILITY IS SMALL AND THAT IS CORRECT. A calibrated probability of
 *    a rare event tops out around 4% for this model, so the number is stated
 *    with its band label rather than alone — "4%" reads as reassuring on its
 *    own and as alarming next to "High risk", and the band is what actually
 *    drives what we do next.
 */
import type { Band } from '@/lib/thresholds';
import { BAND_LABEL } from '@/lib/thresholds';
import type { Consent } from '@/server/domain/types';
import type { NotifyEvent } from './types';

export type ThresholdAlertInput = {
  flightId: string;
  passengerId?: string;
  /** e.g. "6E 5231" */
  code: string;
  from: string;
  to: string;
  /** already formatted for the member's eyes, e.g. "Sun 23 Aug, 22:05" */
  departsDisplay: string;
  pct: number;
  band: Band;
  consent: Consent;
  /** the current best option from rankAlts(), when one has been cached yet */
  topOption?: { code: string; arr: string; why: string } | null;
};

/**
 * The pre-cancellation alert — the one the whole prediction exists to send.
 *
 * The ask/autopilot split is the entire point of the consent model, so it is
 * the second line of the message, not a footnote: an `ask` member is being
 * asked for something, an `autopilot` member is being told what will happen
 * and given a way to stop it.
 */
export function thresholdAlert(i: ThresholdAlertInput): NotifyEvent {
  const risk = `${BAND_LABEL[i.band].toLowerCase()} (${i.pct}%)`;

  const lead = `${i.code} ${i.from}→${i.to}, departing ${i.departsDisplay}, is now showing ${risk} of cancellation.`;

  const stance =
    i.consent === 'autopilot'
      ? 'You have us on autopilot, so if it does cancel we will rebook you using the preferences on your card — no need to do anything. Tap below if you would rather choose yourself.'
      : 'Tell us what you would prefer and we will line it up now, while there is still time to think. If we do not hear from you, we will use the details from your card.';

  const option = i.topOption
    ? `\n\nBest alternative right now: ${i.topOption.code}, arriving ${i.topOption.arr}. ${i.topOption.why}`
    : '\n\nWe are searching alternatives now and will keep them fresh until this is settled.';

  return {
    kind: 'risk-threshold',
    flightId: i.flightId,
    passengerId: i.passengerId,
    title: `${i.code} may be cancelled`,
    body: `${lead}\n\n${stance}${option}`,
    path: `/prepare/${i.flightId}`,
    actions: [
      { id: 'choose', label: 'Choose my option' },
      { id: 'details', label: 'See the prediction' },
    ],
    data: { screen: 'Prepare', flightId: i.flightId, band: i.band, pct: String(i.pct) },
  };
}

/* ── The rest of the ladder ─────────────────────────────────────────────────
 *
 * `thresholdAlert` above is the first rung and used to be the only one built,
 * even though `AlertKind` had named the others since the beginning. That was
 * survivable while silence meant STOP: a member who missed every message ended
 * up with an unspent card and a handed-over recovery.
 *
 * It is not survivable now. The per-transaction cap was removed on 2026-08-19
 * and silence proceeds to book (server/engine/simulation.ts). The only thing
 * standing between a member and a charge they did not expect is that we told
 * them, at each step, what was about to happen — so these three messages are
 * not nice-to-have polish, they are the safety mechanism, and every one of
 * them has to be worth reading on a lock screen.
 *
 * Two rules inherited from the top of this file still hold everywhere below:
 * nothing is ever described as held or reserved, and money is stated as the
 * DELTA the member actually pays rather than the gross fare — quoting ₹18,000
 * when ₹14,000 of it is coming straight back is technically true and
 * practically a lie.
 */

export type CancelledAlertInput = {
  flightId: string;
  passengerId?: string;
  code: string;
  from: string;
  to: string;
  /** how many alternatives we are already holding ranked, not reserved */
  optionCount: number;
  /** the current leader, when the search has finished */
  topOption?: { code: string; arr: string } | null;
};

/**
 * Rung 2 — it actually happened.
 *
 * Deliberately says what we have ALREADY done, not what we are about to do.
 * The member is standing in an airport finding out their flight is dead; the
 * useful information is that somebody is already several steps ahead of them.
 */
export function cancelledAlert(i: CancelledAlertInput): NotifyEvent {
  const lead = `${i.code} ${i.from}→${i.to} has been cancelled.`;

  const state = i.topOption
    ? `We saw it before you did and have already ranked your alternatives against your preferences. Right now the best is ${i.topOption.code}, arriving ${i.topOption.arr}.`
    : i.optionCount > 0
      ? `We have already ranked ${i.optionCount} alternatives against your preferences.`
      : 'We are searching alternatives for you now.';

  return {
    kind: 'cancelled',
    flightId: i.flightId,
    passengerId: i.passengerId,
    title: `${i.code} is cancelled — we are on it`,
    body: `${lead}

${state}

Nothing is booked yet. We will tell you before anything is charged.`,
    path: `/recovery/${i.flightId}`,
    actions: [
      { id: 'choose', label: 'Choose my option' },
      { id: 'view', label: 'See the plan' },
    ],
    data: { screen: 'Recovery', flightId: i.flightId },
  };
}

export type AboutToBookInput = {
  flightId: string;
  passengerId?: string;
  code: string;
  /** the option we are about to buy */
  altCode: string;
  altArrives: string;
  /** formatted, already in the member's own currency — the DELTA, not the fare */
  deltaDisplay: string;
  /** true when the delta is zero or negative: nothing to pay */
  free: boolean;
  /** whole minutes the member has to stop this */
  minutes: number;
};

/**
 * Rung 3 — the one that has to arrive.
 *
 * This is the message that replaced the spend ceiling. It states the exact
 * amount, names the deadline, and says plainly what happens if the member does
 * nothing — because "we will proceed unless you stop us" is only fair if it was
 * actually said out loud beforehand.
 *
 * The stop action is listed FIRST. A member skimming a notification in a queue
 * reads the leftmost button, and the destructive-to-them outcome is the one
 * they should be able to reach fastest.
 */
export function aboutToBookAlert(i: AboutToBookInput): NotifyEvent {
  const cost = i.free
    ? 'It costs you nothing.'
    : `It comes to ${i.deltaDisplay} after the refund on your original ticket, charged to your Amex.`;

  const window = `You have about ${i.minutes} minute${i.minutes === 1 ? '' : 's'} to change or stop this. If we do not hear from you we will go ahead, because leaving you stranded is worse than spending without a reply.`;

  return {
    kind: 'about-to-book',
    flightId: i.flightId,
    passengerId: i.passengerId,
    title: i.free ? `Booking ${i.altCode} for you` : `About to spend ${i.deltaDisplay}`,
    body: `${i.code} was cancelled, so we are about to put you on ${i.altCode}, arriving ${i.altArrives}.

${cost}

${window}`,
    path: `/recovery/${i.flightId}`,
    actions: [
      { id: 'stop', label: 'Stop — let me choose' },
      { id: 'approve', label: 'Yes, go ahead' },
    ],
    data: { screen: 'Recovery', flightId: i.flightId, delta: i.deltaDisplay },
  };
}

export type StoodDownInput = {
  flightId: string;
  passengerId?: string;
  code: string;
  from: string;
  to: string;
  departsDisplay: string;
};

/**
 * The only good news this system is capable of sending.
 *
 * `bandCrossing.ts` alerts on escalation only, and for sound reasons — it stops
 * a flight sitting in one band from re-announcing itself every scoring tick.
 * But the consequence is that every message a member ever receives from us is
 * bad news, and a service that only ever appears to deliver alarm is one people
 * learn to dismiss.
 *
 * So a flight that climbed to hold-gate or beyond and then genuinely fell back
 * gets exactly one stand-down. Not a de-escalation of noise into more noise:
 * one message, only after a real alarm, saying the thing the member most wants
 * to hear.
 */
export function stoodDownAlert(i: StoodDownInput): NotifyEvent {
  return {
    kind: 'stood-down',
    flightId: i.flightId,
    passengerId: i.passengerId,
    title: `${i.code} is looking fine again`,
    body:
      `Good news — ${i.code} ${i.from}→${i.to}, departing ${i.departsDisplay}, has dropped back to a normal risk of cancellation.

` +
      'We are still watching it, and we will tell you if that changes again.',
    path: `/flights/${i.flightId}`,
    actions: [{ id: 'details', label: 'See the prediction' }],
    data: { screen: 'FlightDetail', flightId: i.flightId },
  };
}
