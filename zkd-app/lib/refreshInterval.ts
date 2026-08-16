/**
 * How often live inventory is re-checked.
 *
 * server/engine/altsCache.ts used a flat ten-minute TTL. A fixed number cannot
 * be right twice: ten minutes is wasteful two days before departure and
 * negligent eleven minutes before it, when a cancelled widebody is emptying
 * every alternative on the route. So the interval is computed from the things
 * that actually move it, and then floored by what the provider can bear.
 *
 *   target = BASE · urgency(TTD) · severity · scarcity · window
 *   target = min(target, offerExpiresIn / 2)            // Nyquist, see below
 *   ms     = max(clamp(target, MIN, MAX), rateLimitFloor)
 *
 * ── The clamp order is load-bearing ────────────────────────────────────────
 *
 * MIN and MAX bound the *target* — what we would like. The rate-limit floor is
 * applied afterwards and is deliberately **unbounded above**: it may exceed
 * MAX_REFRESH_MS.
 *
 * Getting this backwards (clamping after the floor) is not a rounding detail,
 * it silently defeats the component. A provider that can sustain one call every
 * three hours would be polled hourly regardless, and adaptive refresh would
 * overspend a free tier faster than the flat TTL it replaced. The ceiling is a
 * freshness preference; the budget is a constraint; a constraint that yields to
 * a preference is decoration.
 *
 * ── urgency ────────────────────────────────────────────────────────────────
 *
 * Linear in minutes-to-departure between 15 min and 8 h, flat outside. Past
 * eight hours there is no information in the difference; inside fifteen minutes
 * there is nothing left to rebook into, so the floor stops us spending quota on
 * a decision that has already been made for us.
 *
 * ── severity ───────────────────────────────────────────────────────────────
 *
 * Reuses the band from lib/thresholds.ts rather than inventing a parallel
 * scale, plus `disrupted` for "the carrier has stopped being a forecast and
 * acted". Two systems disagreeing about how bad a situation is would be worse
 * than either being slightly wrong.
 *
 * ── scarcity ───────────────────────────────────────────────────────────────
 *
 * Saturates at 20 seats, matching scarcityFactor() in lib/thresholds.ts. The
 * two measure the same thing and must not disagree about where "plentiful"
 * starts.
 *
 * ── window ─────────────────────────────────────────────────────────────────
 *
 * Halved while a consent window is open. A member is looking at this plan right
 * now and may be about to spend money against it; a stale price on that screen
 * is worse than a stale price on a list nobody has opened.
 *
 * ── Nyquist against the supplier's promise ─────────────────────────────────
 *
 * An offer's `expiresAt` is the supplier's guarantee. Sampling slower than
 * twice per offer lifetime means routinely showing a fare whose guarantee
 * lapsed between polls — and lib/confirmWindow.ts derives the member's entire
 * decision window from that expiry, so a window computed off a dead offer is a
 * promise we cannot keep.
 *
 * Returns its own inputs and factors for the same reason thresholdsFor() does:
 * "an adaptive threshold nobody can replay is not auditable" — and "why was
 * this seat count four minutes old" is a question the ops panel has to be able
 * to answer after the fact.
 */

import type { Band } from './thresholds';

/** The forecast band, plus the state where the carrier has actually filed. */
export type RefreshSeverity = Band | 'disrupted';

export type RefreshInputs = {
  minutesToDeparture: number;
  severity: RefreshSeverity;
  /** replacement seats visible across every supplier right now */
  seatsAvailable: number;
  /** distinct flights refreshing against the same provider — divides the allowance */
  watchers: number;
  /** hard floor from server/governor.ts sustainableIntervalMs() */
  rateLimitFloorMs: number;
  /** ms until the soonest expiry among held offers/holds; null when none carry one */
  offerExpiresInMs: number | null;
  /** a member is sitting in front of this plan with a countdown running */
  hasOpenConsentWindow: boolean;
};

export type RefreshBoundBy =
  | 'rate-limit'
  | 'offer-expiry'
  | 'floor'
  | 'ceiling'
  | 'urgency'
  | 'base';

export type RefreshInterval = {
  ms: number;
  boundBy: RefreshBoundBy;
  /** the unclamped target, so the ledger shows what we wanted before the limiter spoke */
  targetMs: number;
  factors: { urgency: number; severity: number; scarcity: number; window: number };
  inputs: RefreshInputs;
};

/** Today's fixed TTL becomes the base case — the calm, far-from-departure answer. */
export const BASE_REFRESH_MS = 10 * 60 * 1000;
export const MIN_REFRESH_MS = 20_000;
export const MAX_REFRESH_MS = 60 * 60 * 1000;

/** Inside this many minutes there is nothing left to rebook into. */
const URGENCY_FLOOR_MIN = 15;
/** Beyond this, distance to departure carries no more information. */
const URGENCY_CEIL_MIN = 480;
const URGENCY_MIN_FACTOR = 0.05;

const SEVERITY_FACTOR: Record<RefreshSeverity, number> = {
  watch: 1,
  prepare: 0.6,
  'hold-gate': 0.3,
  'pre-authorise': 0.15,
  disrupted: 0.08,
};

/** Matches the saturation point of scarcityFactor() in lib/thresholds.ts. */
const SCARCITY_SATURATION_SEATS = 20;

export function refreshIntervalFor(inputs: RefreshInputs): RefreshInterval {
  const urgency = urgencyFactor(inputs.minutesToDeparture);
  const severity = SEVERITY_FACTOR[inputs.severity] ?? 1;
  const scarcity = scarcityFactor(inputs.seatsAvailable);
  const window = inputs.hasOpenConsentWindow ? 0.5 : 1;

  let target = BASE_REFRESH_MS * urgency * severity * scarcity * window;
  let boundBy: RefreshBoundBy = target < BASE_REFRESH_MS ? 'urgency' : 'base';

  if (inputs.offerExpiresInMs !== null) {
    const nyquist = Math.max(MIN_REFRESH_MS, inputs.offerExpiresInMs / 2);
    if (nyquist < target) {
      target = nyquist;
      boundBy = 'offer-expiry';
    }
  }

  const targetMs = target;

  // MIN/MAX bound what we *want*, not what the provider permits.
  let ms = target;
  if (ms < MIN_REFRESH_MS) {
    ms = MIN_REFRESH_MS;
    boundBy = 'floor';
  } else if (ms > MAX_REFRESH_MS) {
    ms = MAX_REFRESH_MS;
    boundBy = 'ceiling';
  }

  // The limiter is applied LAST and is unbounded above — it can and must push
  // past MAX_REFRESH_MS.
  //
  // Clamping it would invert the whole component: a provider that sustains one
  // call every three hours would be polled hourly anyway, and "adaptive
  // refresh" would become a way to overspend a free tier faster than the flat
  // TTL it replaced. The ceiling is a freshness *preference*; the budget is a
  // constraint, and a constraint that yields to a preference is decoration.
  //
  // The honest consequence is that data can legitimately be hours old. That is
  // reported as `rate-limit` rather than hidden, so the UI can say the number
  // is stale instead of quietly showing a stale number.
  if (inputs.rateLimitFloorMs > ms) {
    ms = inputs.rateLimitFloorMs;
    boundBy = 'rate-limit';
  }

  return {
    ms: Math.round(ms),
    boundBy,
    targetMs: Math.round(targetMs),
    factors: { urgency, severity, scarcity, window },
    inputs,
  };
}

function urgencyFactor(minutes: number): number {
  if (minutes >= URGENCY_CEIL_MIN) return 1;
  if (minutes <= URGENCY_FLOOR_MIN) return URGENCY_MIN_FACTOR;
  const span = URGENCY_CEIL_MIN - URGENCY_FLOOR_MIN;
  return URGENCY_MIN_FACTOR + (1 - URGENCY_MIN_FACTOR) * ((minutes - URGENCY_FLOOR_MIN) / span);
}

function scarcityFactor(seats: number): number {
  if (seats >= SCARCITY_SATURATION_SEATS) return 1;
  if (seats <= 0) return 0.5;
  return 0.5 + 0.5 * (seats / SCARCITY_SATURATION_SEATS);
}

/** Plain-language rationale for the ops panel and the decision ledger. */
export function refreshRationale(r: RefreshInterval): string {
  const secs = Math.round(r.ms / 1000);
  const every = secs >= 120 ? `${Math.round(secs / 60)} min` : `${secs} s`;
  const flights = `${r.inputs.watchers} watched flight${r.inputs.watchers === 1 ? '' : 's'}`;

  switch (r.boundBy) {
    case 'rate-limit':
      return `Re-checking every ${every} — we would go faster, but that is all the provider's free tier sustains across ${flights}.`;
    case 'offer-expiry':
      return `Re-checking every ${every} — twice per offer lifetime, so a fare never lapses unnoticed between polls.`;
    case 'floor':
      return `Re-checking every ${every} — the fastest we poll anything. Below this we would be paying for jitter, not information.`;
    case 'ceiling':
      return `Re-checking every ${every} — nothing goes unchecked for longer than that.`;
    case 'urgency':
      return `Re-checking every ${every}, from ${Math.round(r.inputs.minutesToDeparture)} min to departure and ${r.inputs.seatsAvailable} seats still visible.`;
    default:
      return `Re-checking every ${every} — nothing unusual around this flight.`;
  }
}
