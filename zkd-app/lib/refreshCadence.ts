/**
 * How often to re-shop, and why.
 *
 * We cannot hold a seat. A passenger cannot hold two flight tickets, so a
 * speculative hold on a replacement is a duplicate booking — which carriers'
 * auditors cancel, sometimes cancelling the original. So the thing that used to
 * be secured must instead be kept *current*: a set of coherent bundles that are
 * still bookable at the moment the carrier acts.
 *
 * The interval is derived, not picked — the same discipline as
 * `lib/confirmWindow.ts`. The correctness constraint comes from the supplier's
 * own price guarantee (re-shop before it lapses); the cost constraint comes from
 * the probability band, because supplier rate limits, not compute, are the
 * binding constraint on this system. Every result reports which bound was
 * binding so the decision ledger can reconstruct it afterwards.
 *
 * Cadence is per component class, which is what makes continuous refresh
 * affordable: flight offers expire in minutes, hotel rates hold for hours, and
 * ground is quotable on demand and needs no standing refresh at all.
 */

import type { Band } from './thresholds';

/** Network + parse budget for revalidating a portfolio, so we finish before the offer dies. */
const REVALIDATION_BUDGET_SECONDS = 20;

export type ComponentClass = 'flight' | 'hotel' | 'ground';

/**
 * Bounds per band, in seconds. `min` is the fastest we may go — a cost ceiling,
 * since every refresh spends supplier quota. `max` is the slowest we may go — a
 * staleness ceiling.
 *
 * The minima are the stated design values. The maxima are set at twice the
 * minimum so a portfolio is re-validated at least twice within a band's typical
 * dwell; that multiplier is an **assumption**, to be replaced once we can
 * measure how fast offers actually die per route. Tier `assumed`.
 */
const BOUNDS: Record<ComponentClass, Partial<Record<Band, { min: number; max: number }>>> = {
  flight: {
    prepare: { min: 30 * 60, max: 60 * 60 },
    'hold-gate': { min: 5 * 60, max: 15 * 60 },
    'pre-authorise': { min: 2 * 60, max: 5 * 60 },
  },
  // Rooms are held on much longer validity, and during a hub-wide event the
  // thing that moves is availability rather than price.
  hotel: {
    prepare: { min: 6 * 3600, max: 12 * 3600 },
    'hold-gate': { min: 60 * 60, max: 3 * 3600 },
    'pre-authorise': { min: 30 * 60, max: 60 * 60 },
  },
  // Ground is quoted at bundle assembly. There is nothing to keep warm.
  ground: {},
};

export type CadenceInputs = {
  component: ComponentClass;
  band: Band;
  /**
   * Soonest `expiresAt` across the portfolio for this component class, epoch ms.
   * Null when no offer in hand carries an expiry — Sabre never returns one — in
   * which case only the band bounds apply.
   */
  soonestExpiryAt: number | null;
  /**
   * The scarcity factor already computed by `lib/thresholds.ts` (0.6 – 1.0).
   * Below 1 it shortens the interval: when the option is disappearing while we
   * deliberate, staying current matters more and costs are worth paying.
   */
  scarcity?: number;
  now?: number;
};

export type RefreshCadence = {
  refreshing: boolean;
  /** Seconds until the next re-shop. Zero when not refreshing. */
  seconds: number;
  boundBy: 'offer-expiry' | 'band-floor' | 'band-ceiling' | 'not-refreshing';
  /** Epoch ms of the next re-shop. Equals `now` when not refreshing. */
  nextAt: number;
  /** Present only when `refreshing` is false, saying why. */
  reason?: string;
};

export function refreshCadence(input: CadenceInputs): RefreshCadence {
  const now = input.now ?? Date.now();
  const bounds = BOUNDS[input.component][input.band];

  if (input.component === 'ground') {
    return notRefreshing(now, 'ground is quoted on demand at bundle assembly');
  }
  if (!bounds) {
    // `watch` is the only band with no bounds: nothing has happened yet, and a
    // probability below `prepare` is not worth a single supplier call.
    return notRefreshing(now, `no refresh in the ${input.band} band`);
  }

  const scarcity = clamp(input.scarcity ?? 1, 0.6, 1);
  const min = Math.max(1, Math.round(bounds.min * scarcity));
  const max = Math.max(min, Math.round(bounds.max * scarcity));

  const fromOffer =
    input.soonestExpiryAt === null
      ? Infinity
      : (input.soonestExpiryAt - now) / 1000 - REVALIDATION_BUDGET_SECONDS;

  let seconds: number;
  let boundBy: RefreshCadence['boundBy'];
  if (fromOffer < min) {
    // The offer dies sooner than we are allowed to re-shop. We refresh at the
    // floor and accept that it may already be gone — which the RE-CHECK cascade
    // is there to handle.
    seconds = min;
    boundBy = 'band-floor';
  } else if (fromOffer > max) {
    seconds = max;
    boundBy = 'band-ceiling';
  } else {
    seconds = Math.floor(fromOffer);
    boundBy = 'offer-expiry';
  }

  return { refreshing: true, seconds, boundBy, nextAt: now + seconds * 1000 };
}

/** Plain-language form for the ledger and the UI, mirroring `windowRationale`. */
export function cadenceRationale(c: RefreshCadence, component: ComponentClass): string {
  if (!c.refreshing) return c.reason ?? 'Not refreshing.';
  const mins = Math.round(c.seconds / 60);
  const every = mins >= 1 ? `${mins} min` : `${c.seconds}s`;
  switch (c.boundBy) {
    case 'offer-expiry':
      return `Re-checking ${component}s every ${every} — just before the current prices lapse.`;
    case 'band-floor':
      return `Re-checking ${component}s every ${every}. The prices lapse sooner than that, so some may already be gone when we go to book.`;
    case 'band-ceiling':
      return `Re-checking ${component}s every ${every}. The prices hold longer, but we stay current anyway.`;
    default:
      return `Re-checking ${component}s every ${every}.`;
  }
}

function notRefreshing(now: number, reason: string): RefreshCadence {
  return { refreshing: false, seconds: 0, boundBy: 'not-refreshing', nextAt: now, reason };
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
