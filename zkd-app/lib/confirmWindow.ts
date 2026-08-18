/**
 * How long the member gets to answer.
 *
 * The old 90 seconds was a number nobody could defend. The real constraint is
 * not a guess about attention span — it is the supplier's own offer expiry. An
 * offer is a price the supplier promises to honour until `expiresAt`; past that
 * we are quoting a fare we cannot fill. So the window is that promise, minus the
 * time we need to execute inside it.
 *
 * Two bounds sit on top:
 *
 *   FLOOR — below this the ask is theatre. A push has to arrive, be noticed and
 *   be answered; there is no honest way to do that in seconds. Under the floor
 *   we do not ask at all — consent tier decides (see shouldAsk below).
 *
 *   CEILING — the offer's expiry is the supplier's promise, not the market's. On
 *   a route that is filling, a long window is a promise we cannot keep, and it is
 *   also bounded by check-in closing.
 *
 * The seat can still be sold while the member thinks. That is not solved by
 * shortening the window — it is solved by re-validating at confirm time and
 * cascading to the next ranked candidate. Consent is to the outcome, not to a
 * specific seat.
 */

/** Below this, asking is theatre — assume nothing useful comes back. */
export const WINDOW_FLOOR_SECONDS = 120;

/** Nothing benefits from waiting longer than this once the carrier has acted. */
export const WINDOW_CEILING_SECONDS = 20 * 60;

/** Machine time from consent to a ticketed booking — the ~11 s critical path. */
const EXECUTION_BUDGET_SECONDS = 11;

/** Slack for push delivery, a cold app start and the round trip back. */
const NETWORK_MARGIN_SECONDS = 20;

/** Domestic check-in typically closes 45 min out; international 60. */
const CHECKIN_CUTOFF_MINUTES = { domestic: 45, international: 60 };

export type WindowInputs = {
  /** epoch ms at which the supplier's offer stops being honoured */
  offerExpiresAt: number | null;
  /** epoch ms of the replacement flight's scheduled departure */
  departureAt: number;
  international: boolean;
  now?: number;
  /** Overrides WINDOW_CEILING_SECONDS for this call only — see
   *  AUTOPILOT_NOTICE_CEILING_SECONDS below. Never overrides
   *  WINDOW_FLOOR_SECONDS, which stays the one universal minimum: "below
   *  this the ask is theatre" applies identically to a notice as to a real
   *  ask — a notice still has to be noticed and read. Omit for the existing
   *  ask-tier behavior, unchanged. */
  ceilingSeconds?: number;
};

/**
 * The autopilot notice's ceiling (server/engine/simulation.ts's autopilot
 * branch of createTaskForBooking). Autopilot had NO window at all before
 * this — it booked instantly. This gives the member a real, bounded chance
 * to intervene before it does, reasoned as follows:
 *
 *  - The floor (120s) above is reused UNCHANGED — a notice needs the exact
 *    same minimum real time to be noticed and read as a full ask,
 *    regardless of tier, so it is never shortened below what this file
 *    already established as "theatre."
 *  - The ceiling is short because autopilot's whole value proposition is
 *    fast default action, and this window is an override OPPORTUNITY, not
 *    a required decision — unlike 'ask', silence here is not "we assume
 *    yes," it is the literal thing autopilot means.
 *  - Real seat-churn risk runs for the whole notice period (this file's own
 *    answer — re-validate at confirm time, never a shorter window — still
 *    applies at expiry via revalidateChoice, but a longer notice is still
 *    more exposure for zero member benefit once nobody is looking at it).
 *  - 180s sits just above the floor (clearly distinguishable from "no
 *    notice at all") and stays an order of magnitude below the 20-minute
 *    ask ceiling (15% of it), so autopilot never quietly turns into a
 *    second ask flow — chosen at the short end of common "we'll proceed
 *    automatically unless you say otherwise" grace-period patterns
 *    deliberately, since speed is what this consent tier sells.
 */
export const AUTOPILOT_NOTICE_CEILING_SECONDS = 180;

export type ConfirmWindow = {
  seconds: number;
  /** false when the derived window fell below the floor — do not ask, act per consent tier */
  askable: boolean;
  /** which constraint actually decided the length, for the ledger and the UI */
  boundBy: 'offer-expiry' | 'check-in' | 'ceiling' | 'floor';
  expiresAt: number;
};

export function confirmWindow(input: WindowInputs): ConfirmWindow {
  const now = input.now ?? Date.now();

  const fromOffer = input.offerExpiresAt
    ? (input.offerExpiresAt - now) / 1000 - EXECUTION_BUDGET_SECONDS - NETWORK_MARGIN_SECONDS
    : Infinity;

  const cutoff = CHECKIN_CUTOFF_MINUTES[input.international ? 'international' : 'domestic'];
  const fromCheckIn =
    (input.departureAt - now) / 1000 - cutoff * 60 - EXECUTION_BUDGET_SECONDS - NETWORK_MARGIN_SECONDS;

  const candidates: [number, ConfirmWindow['boundBy']][] = [
    [fromOffer, 'offer-expiry'],
    [fromCheckIn, 'check-in'],
    [input.ceilingSeconds ?? WINDOW_CEILING_SECONDS, 'ceiling'],
  ];
  const [rawSeconds, boundBy] = candidates.reduce((a, b) => (b[0] < a[0] ? b : a));

  if (rawSeconds < WINDOW_FLOOR_SECONDS) {
    return { seconds: 0, askable: false, boundBy: 'floor', expiresAt: now };
  }

  const seconds = Math.floor(rawSeconds);
  return { seconds, askable: true, boundBy, expiresAt: now + seconds * 1000 };
}

/**
 * When the window is too short to ask in, consent tier decides alone.
 *
 * Autopilot acts. Ask-me-first still acts when the recovery is free, because
 * permission exists to protect the member's money — not to strand them at an
 * airport for missing a notification. If it would cost them, we stop.
 */
export function shouldActWithoutAsking(
  window: ConfirmWindow,
  consent: 'autopilot' | 'ask',
  costsMember: boolean,
): boolean {
  if (window.askable) return false;
  if (consent === 'autopilot') return true;
  return !costsMember;
}

export function windowRationale(w: ConfirmWindow): string {
  if (!w.askable) return 'Too little time left to ask — your standing permission decides this one.';
  const mins = Math.round(w.seconds / 60);
  const length = mins >= 2 ? `${mins} minutes` : `${w.seconds} seconds`;
  switch (w.boundBy) {
    case 'offer-expiry':
      return `You have ${length} — that is how long the airline is holding this price.`;
    case 'check-in':
      return `You have ${length} — after that, check-in closes on the replacement flight.`;
    default:
      return `You have ${length}. The fare is held longer than that, but a seat nobody has paid for is not really yours, so we do not promise more.`;
  }
}
