/**
 * Ranking candidates — on two costs that must never be confused.
 *
 * When Amex fronts a fresh purchase, the member sees zero. If ranking sorted on
 * what the member sees, a fronted walk-up fare would *tie* with a free reissue,
 * and the reversibility tiebreak would then pick the fronted one — quietly
 * inverting the ladder so the expensive option wins because its expense was
 * hidden from the field being sorted on.
 *
 * So there are two figures, deliberately distinct:
 *
 *   netEconomic   — what the recovery ultimately costs after expected recovery.
 *                   Drives ranking.
 *   memberVisible — what the member is asked to pay. Drives consent.
 *
 * The ordering rule is: cost dominates, unless a cheaper candidate arrives
 * *materially* later, where "materially" comes from the itinerary's own
 * connection slack rather than an invented constant. Reversibility only
 * separates candidates that are otherwise equal — which matters because the free
 * mechanisms are the irreversible ones.
 */

import type { Bundle } from './bundle';
import { stalestAt } from './bundle';
import type { Money, ReissueMechanism } from '@/server/suppliers/types';

export type EntitlementSource =
  | 'airline_owed'
  | 'card_benefit'
  | 'fronted_pending_recovery'
  | 'member_paid';

export type CostView = {
  netEconomic: Money;
  memberVisible: Money;
  /** Which of the four sources settles the flight portion. */
  flightSource: EntitlementSource;
};

export type CostInputs = {
  bundle: Bundle;
  mechanism: ReissueMechanism;
  originalFare: Money;
  /** True when the card fronts a fresh purchase and pursues the carrier afterwards. */
  fronting: boolean;
  /**
   * How reliably this carrier settles valid refund claims, 0–1. The successor to
   * churn governance: a carrier that routinely refuses valid claims makes
   * fronting against it genuinely more expensive, and ranking should know.
   */
  recoveryRate: number;
  /** True when the carrier owes the stay under duty of care. */
  stayOwedByCarrier: boolean;
};

export function costsFor(i: CostInputs): CostView {
  const currency = i.bundle.flight.price.currency;
  const fare = i.bundle.flight.price.amount;

  let netFlight: number;
  let memberFlight: number;
  let flightSource: EntitlementSource;

  if (i.mechanism === 'same-carrier' || i.mechanism === 'interline') {
    // An involuntary reissue carries the ticket's value across. Nobody pays again.
    netFlight = 0;
    memberFlight = 0;
    flightSource = 'airline_owed';
  } else if (i.fronting) {
    // We pay the fare now and expect to recover it. What it truly costs is the
    // unrecovered share, which is why `recoveryRate` belongs in the objective.
    netFlight = Math.round(fare * (1 - clamp01(i.recoveryRate)));
    memberFlight = 0;
    flightSource = 'fronted_pending_recovery';
  } else {
    const delta = Math.max(0, fare - i.originalFare.amount);
    netFlight = delta;
    memberFlight = delta;
    flightSource = 'member_paid';
  }

  const stay = i.bundle.stay?.rate ?? 0;
  const stayNet = i.stayOwedByCarrier ? 0 : stay;
  const ground = i.bundle.ground.reduce((n, g) => n + g.fare, 0);

  return {
    netEconomic: { amount: netFlight + stayNet + ground, currency },
    memberVisible: { amount: memberFlight + stayNet + ground, currency },
    flightSource,
  };
}

export type Candidate = {
  bundle: Bundle;
  mechanism: ReissueMechanism;
  cost: CostView;
  /** True when the flight step can be undone — a fresh purchase inside its void window. */
  reversible: boolean;
};

export type RankInputs = {
  /**
   * How much later an arrival has to be before it outweighs being free. Derived
   * from the onward connection's slack where one exists; callers without an
   * onward leg should pass the travel window's tolerance.
   */
  materialityMinutes: number;
};

/**
 * Total order over candidates. Negative means `a` ranks ahead of `b`.
 */
export function compareCandidates(a: Candidate, b: Candidate, opts: RankInputs): number {
  const materialityMs = opts.materialityMinutes * 60_000;
  const arrivalGap = a.bundle.flight.arrivesAt - b.bundle.flight.arrivesAt;

  // Cost only dominates while the arrival difference is immaterial. A free seat
  // that lands after the connection is gone is not a bargain.
  if (Math.abs(arrivalGap) > materialityMs) return arrivalGap;

  const costGap = a.cost.netEconomic.amount - b.cost.netEconomic.amount;
  if (costGap !== 0) return costGap;

  if (a.reversible !== b.reversible) return a.reversible ? -1 : 1;

  // Everything equal, prefer the candidate whose components were checked most
  // recently: cheaper to avoid a stale cascade than to detect one.
  return stalestAt(b.bundle) - stalestAt(a.bundle);
}

export function rank(candidates: Candidate[], opts: RankInputs): Candidate[] {
  return [...candidates].sort((a, b) => compareCandidates(a, b, opts));
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
