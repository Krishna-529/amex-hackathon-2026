/**
 * What the member actually reads.
 *
 * Copy lives here rather than inside each channel so the Telegram message, the
 * WhatsApp message and the Android push cannot drift into saying three
 * different things about the same flight — the failure mode where a member is
 * told "we're booking it" on one device and "we need your go-ahead" on another.
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
