/**
 * Adaptive action thresholds — server-only half.
 *
 * A fixed cutoff assumes the cost of waiting is constant. It is not: on a route
 * with two remaining seats, waiting for more certainty costs you the seat; on a
 * route with forty, it costs nothing. So the threshold moves with the cost of
 * being late, and demands more confidence when the forecast is less sure of
 * itself.
 *
 * This reads config/risk-thresholds.json via lib/thresholdConfig.ts (Node
 * `fs`), so it must never be imported from a client component — the Band
 * type and UI lookups client code actually needs live in lib/thresholds.ts.
 */

import { getThresholdConfig } from '@/lib/thresholdConfig';
import type { ThresholdInputs, Thresholds } from '@/lib/thresholds';

export function thresholdsFor(input: ThresholdInputs): Thresholds {
  const cfg = getThresholdConfig();
  const scarcity = scarcityFactor(input.seatsAvailable, cfg.scarcity);
  const urgency = urgencyFactor(input.minutesToDeparture, cfg.urgency);
  const criticality = input.hasHardConstraint ? cfg.criticality.hardConstraintFactor : 1;
  // A forecast that does not trust itself has to clear a higher bar.
  const confidence = cfg.confidence.floor + cfg.confidence.span * clamp01(input.confidence);

  const shift = (scarcity * urgency * criticality) / confidence;
  const { base, floor, ceiling } = cfg.bands;

  return {
    prepare: bound(base.prepare * shift, floor.prepare, ceiling.prepare),
    holdGate: bound(base.holdGate * shift, floor.holdGate, ceiling.holdGate),
    preAuthorise: bound(base.preAuthorise * shift, floor.preAuthorise, ceiling.preAuthorise),
    factors: { scarcity, urgency, criticality, confidence },
    inputs: input,
    configVersion: cfg.version,
  };
}

/**
 * Few seats left means the option disappears while we deliberate, so we act
 * earlier. Once inventory is deep the factor flattens — there is no more benefit
 * to hurrying.
 */
function scarcityFactor(seats: number, cfg: { soldOutFactor: number; amplePlateauSeats: number }): number {
  if (seats <= 0) return cfg.soldOutFactor;
  if (seats >= cfg.amplePlateauSeats) return 1;
  return cfg.soldOutFactor + (1 - cfg.soldOutFactor) * (seats / cfg.amplePlateauSeats);
}

/** Time is the other thing you cannot buy back. Inside the near-term window, act on less. */
function urgencyFactor(
  minutes: number,
  cfg: { insideWindowFactor: number; insideWindowMinutes: number; amplePlateauMinutes: number },
): number {
  if (minutes <= cfg.insideWindowMinutes) return cfg.insideWindowFactor;
  if (minutes >= cfg.amplePlateauMinutes) return 1;
  const span = cfg.amplePlateauMinutes - cfg.insideWindowMinutes;
  return cfg.insideWindowFactor + (1 - cfg.insideWindowFactor) * ((minutes - cfg.insideWindowMinutes) / span);
}

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

function bound(v: number, lo: number, hi: number) {
  return Math.round(Math.max(lo, Math.min(hi, v)));
}
