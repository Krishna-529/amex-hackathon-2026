/**
 * A trip bundle — the unit the rebooking pipeline actually searches for.
 *
 * The member does not want a seat, they want to get where they were going with
 * somewhere to sleep and a way to reach it. So the thing we keep valid is a
 * *bundle*: flight + hotel + ground, coherent as one plan.
 *
 * It is deliberately **not** a cross product. Eight flights, twelve hotels and
 * six cabs is 576 combinations, and refreshing that is neither affordable nor
 * necessary. The specs already give the right shape and it is honoured here:
 * flight **anchors**, hotel derives from the chosen flight's arrival, ground
 * derives from both. A hotel that does not name the flight it is conditioned on
 * is invalid rather than merely worse.
 *
 * Because a bundle can break from any component, most breaks are repairable
 * without discarding the anchor. That repair hierarchy is what makes continuous
 * refresh cheap enough to run at all — see `repairPlan`.
 */

import type { Offer } from '@/server/suppliers/types';

/** Minutes needed between landing and being able to check in somewhere. */
const TRANSFER_MINUTES = 60;
/** A hotel check-in this far before arrival + transfer is incoherent, not just poor. */
const CHECKIN_GRACE_MINUTES = 30;

export type StayOption = {
  id: string;
  name: string;
  /** epoch ms */
  checkInAt: number;
  checkOutAt: number;
  rate: number;
  currency: string;
  /** epoch ms up to which cancelling is free; null when undisclosed — never guess */
  cancellationDeadline: number | null;
  /** epoch ms after which this quote is no longer honoured */
  expiresAt: number | null;
};

export type GroundOption = {
  id: string;
  kind: string;
  seats: number;
  /** epoch ms */
  pickupAt: number;
  fare: number;
  currency: string;
  expiresAt: number | null;
};

export type Bundle = {
  id: string;
  flight: Offer;
  /** Null when the recovery is same-day and needs no overnight stay. */
  stay: StayOption | null;
  ground: GroundOption[];
  /** epoch ms each component was last revalidated, so staler fallbacks rank lower */
  validatedAt: { flight: number; stay: number | null; ground: number };
};

export type Incoherence =
  | { rule: 'stay-before-arrival'; detail: string }
  | { rule: 'pickup-before-arrival'; detail: string }
  | { rule: 'ground-seats-short'; detail: string }
  | { rule: 'flight-seats-short'; detail: string }
  | { rule: 'stay-not-conditioned'; detail: string };

/**
 * Compose a bundle around a flight anchor. The stay and ground windows are
 * *derived* from the flight rather than chosen alongside it, which is what stops
 * the combination exploding and what makes a repair possible later.
 */
export function compose(args: {
  flight: Offer;
  stay: StayOption | null;
  ground: GroundOption[];
  now: number;
}): Bundle {
  return {
    id: `b-${args.flight.supplierOfferId}`,
    flight: args.flight,
    stay: args.stay,
    ground: args.ground,
    validatedAt: {
      flight: args.now,
      stay: args.stay ? args.now : null,
      ground: args.now,
    },
  };
}

/**
 * Coherence is a hard constraint, not a ranking term. An incoherent bundle is
 * denied — a room you cannot reach in time is not a worse room, it is not a room.
 */
export function coherence(b: Bundle, partySize: number): Incoherence[] {
  const problems: Incoherence[] = [];
  const arrival = b.flight.arrivesAt;
  const usableFrom = arrival + TRANSFER_MINUTES * 60_000;

  if (b.flight.seatsRemaining < partySize) {
    problems.push({
      rule: 'flight-seats-short',
      detail: `${b.flight.seatsRemaining} seats for a party of ${partySize}`,
    });
  }

  if (b.stay) {
    if (b.stay.checkInAt + CHECKIN_GRACE_MINUTES * 60_000 < usableFrom) {
      problems.push({
        rule: 'stay-before-arrival',
        detail: `check-in ${iso(b.stay.checkInAt)} precedes arrival ${iso(arrival)} plus transfer`,
      });
    }
    if (b.validatedAt.stay === null) {
      problems.push({ rule: 'stay-not-conditioned', detail: 'stay is not tied to this flight' });
    }
  }

  for (const g of b.ground) {
    if (g.pickupAt < arrival) {
      problems.push({
        rule: 'pickup-before-arrival',
        detail: `pickup ${iso(g.pickupAt)} precedes arrival ${iso(arrival)}`,
      });
    }
    if (g.seats < partySize) {
      problems.push({
        rule: 'ground-seats-short',
        detail: `${g.seats} seats for a party of ${partySize}`,
      });
    }
  }

  return problems;
}

export function isCoherent(b: Bundle, partySize: number): boolean {
  return coherence(b, partySize).length === 0;
}

/* ── the repair hierarchy ────────────────────────────────────────────────── */

export type Staleness = {
  flightGone: boolean;
  stayGone: boolean;
  groundStale: boolean;
  flightRetimed: boolean;
};

export type Repair =
  | { action: 'none' }
  | { action: 'requote-ground'; cost: 'cheapest' }
  | { action: 'rederive-stay'; cost: 'moderate' }
  | { action: 'rederive-windows'; cost: 'moderate' }
  | { action: 'cascade'; cost: 'full'; reason: string };

/**
 * What to do when a bundle degrades. Repair at the cheapest level that works and
 * keep the anchor: only a dead flight kills a bundle. Ordering matters — a
 * re-timed flight invalidates both derived windows even when every component
 * still exists.
 */
export function repairPlan(s: Staleness): Repair {
  if (s.flightGone) {
    return { action: 'cascade', cost: 'full', reason: 'the flight anchor is gone' };
  }
  if (s.flightRetimed) return { action: 'rederive-windows', cost: 'moderate' };
  if (s.stayGone) return { action: 'rederive-stay', cost: 'moderate' };
  if (s.groundStale) return { action: 'requote-ground', cost: 'cheapest' };
  return { action: 'none' };
}

/**
 * Freshness of the weakest component, in ms. The refresh loop concentrates on
 * the leading bundle, so a fallback's hotel quote can quietly go stale in the
 * background — this is what lets ranking prefer fallbacks that were checked
 * recently, and it is cheaper to avoid a stale cascade than to detect one.
 */
export function stalestAt(b: Bundle): number {
  const stamps = [b.validatedAt.flight, b.validatedAt.ground];
  if (b.validatedAt.stay !== null) stamps.push(b.validatedAt.stay);
  return Math.min(...stamps);
}

/**
 * Components whose quotes have lapsed at `now`. A cascade must revalidate
 * *every* component of the bundle it moves to, not just the one that changed.
 */
export function lapsedComponents(b: Bundle, now: number): Array<'flight' | 'stay' | 'ground'> {
  const out: Array<'flight' | 'stay' | 'ground'> = [];
  if (b.flight.expiresAt !== null && b.flight.expiresAt <= now) out.push('flight');
  if (b.stay?.expiresAt != null && b.stay.expiresAt <= now) out.push('stay');
  if (b.ground.some((g) => g.expiresAt !== null && g.expiresAt <= now)) out.push('ground');
  return out;
}

/** Total member-facing cost of the bundle, in the flight's currency. */
export function bundleCost(b: Bundle): { amount: number; currency: string } {
  const currency = b.flight.price.currency;
  let amount = b.flight.price.amount;
  // We hold no FX rates, so a component in another currency is not silently summed.
  if (b.stay && b.stay.currency === currency) amount += b.stay.rate;
  for (const g of b.ground) if (g.currency === currency) amount += g.fare;
  return { amount, currency };
}

/** True when every component is priced in one currency, so the total is meaningful. */
export function singleCurrency(b: Bundle): boolean {
  const c = b.flight.price.currency;
  if (b.stay && b.stay.currency !== c) return false;
  return b.ground.every((g) => g.currency === c);
}

function iso(ms: number): string {
  return new Date(ms).toISOString().slice(11, 16);
}
