/**
 * `optimization_strategy` → scoring weights.
 *
 * The wire schema gives the member one comprehensible knob with four settings.
 * The scorer needs six weights, because comparing an overnight-plus-hotel
 * against a same-night two-stop against a carrier-protected reroute is not a
 * one-dimensional question — a bare enum cannot express "arrives 4h earlier but
 * costs money and adds a connection".
 *
 * So the enum selects a preset. The member sets something they understand; the
 * scorer keeps a principled multi-criteria comparison; and neither has to know
 * about the other. Presets live here rather than inside the scorer so they can
 * be read, argued with and tuned without touching scoring logic.
 *
 * ── Why `reliability` is pinned across all four ────────────────────────────
 *
 * Every preset holds reliability at RELIABILITY_FLOOR. No optimisation strategy
 * should be able to talk the agent into an option it cannot actually book — a
 * member who asked for "lowest cost" asked to save money, not to be handed a
 * row with no PNR behind it. Strategy governs *which real option* wins, never
 * whether an option is real.
 *
 * This matters most under `lowest_cost`, where the carrier-protected
 * alternative is free (`fare: 0` by construction in altsFromOffers.ts) and would
 * otherwise sweep every comparison on price alone.
 */

import type { OptimizationStrategy } from './schema';

export type Criterion = 'arrival' | 'cost' | 'reliability' | 'cabin' | 'loyalty' | 'effort';

export type Weights = Record<Criterion, number>;

/** No strategy may value bookability below this. */
export const RELIABILITY_FLOOR = 0.18;

export const PRESETS: Record<OptimizationStrategy, Weights> = {
  earliest_arrival: {
    arrival: 0.50, cost: 0.10, reliability: RELIABILITY_FLOOR, cabin: 0.08, loyalty: 0.04, effort: 0.10,
  },
  stick_to_preferred_airline: {
    arrival: 0.24, cost: 0.12, reliability: RELIABILITY_FLOOR, cabin: 0.10, loyalty: 0.30, effort: 0.06,
  },
  minimize_layovers: {
    arrival: 0.26, cost: 0.10, reliability: RELIABILITY_FLOOR, cabin: 0.08, loyalty: 0.04, effort: 0.34,
  },
  lowest_cost: {
    arrival: 0.18, cost: 0.40, reliability: RELIABILITY_FLOOR, cabin: 0.10, loyalty: 0.04, effort: 0.10,
  },
};

/**
 * A late arrival that breaks an onward leg or a hard commitment is not a
 * preference question — it is the thing the member is actually trying to avoid.
 * Applied on top of whichever preset they chose, then renormalised.
 */
const HARD_CONSTRAINT_ARRIVAL_BOOST = 1.5;

export function weightsFor(
  strategy: OptimizationStrategy,
  opts: { hasHardConstraint?: boolean } = {},
): Weights {
  const base = { ...PRESETS[strategy] };
  if (opts.hasHardConstraint) base.arrival *= HARD_CONSTRAINT_ARRIVAL_BOOST;
  return normalise(base);
}

/**
 * Renormalises to sum 1 while holding reliability at or above its floor.
 *
 * Order matters: boosting arrival then renormalising would otherwise dilute
 * reliability below the floor, which is precisely the guarantee the floor
 * exists to make unconditional.
 */
export function normalise(w: Weights): Weights {
  const keys = Object.keys(w) as Criterion[];
  const positive = keys.map((k) => Math.max(0, w[k]));
  const sum = positive.reduce((a, b) => a + b, 0);
  if (sum <= 0) return { ...PRESETS.earliest_arrival };

  const scaled = {} as Weights;
  keys.forEach((k, i) => { scaled[k] = positive[i] / sum; });

  if (scaled.reliability >= RELIABILITY_FLOOR) return scaled;

  // Restore the floor, and take the shortfall from the others in proportion so
  // their relative ordering — the thing the member actually chose — survives.
  const deficit = RELIABILITY_FLOOR - scaled.reliability;
  const others = keys.filter((k) => k !== 'reliability');
  const othersSum = others.reduce((a, k) => a + scaled[k], 0);
  const out = { ...scaled, reliability: RELIABILITY_FLOOR };
  if (othersSum > 0) {
    for (const k of others) out[k] = scaled[k] - deficit * (scaled[k] / othersSum);
  }
  return out;
}

/** What the member is told we optimised for, in their words rather than ours. */
export const STRATEGY_LABEL: Record<OptimizationStrategy, string> = {
  earliest_arrival: 'getting you there soonest',
  stick_to_preferred_airline: 'keeping you on an airline you hold status with',
  minimize_layovers: 'the fewest changes',
  lowest_cost: 'the least out of your pocket',
};
