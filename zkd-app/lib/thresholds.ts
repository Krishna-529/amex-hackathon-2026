/**
 * Adaptive action thresholds.
 *
 * A fixed cutoff assumes the cost of waiting is constant. It is not: on a route
 * with two remaining seats, waiting for more certainty costs you the seat; on a
 * route with forty, it costs nothing. So the threshold moves with the cost of
 * being late, and demands more confidence when the forecast is less sure of
 * itself.
 *
 * Every evaluation returns its own inputs so the decision ledger can reconstruct
 * why a band fired. An adaptive threshold nobody can replay is not auditable.
 */

export type ThresholdInputs = {
  /** alternative seats found across all suppliers for this route */
  seatsAvailable: number;
  /**
   * How many travellers need placing together. Scarcity is a ratio, not a count:
   * three seats is abundance for one person and infeasible for a family of six.
   */
  partySize: number;
  /** minutes from now until the disrupted flight was due to depart */
  minutesToDeparture: number;
  /** the trip has an onward leg or a hard commitment that a late arrival breaks */
  hasHardConstraint: boolean;
  /** the forecast's own confidence, 0-1 */
  confidence: number;
};

export type Thresholds = {
  /** start assembling and searching, no spend */
  prepare: number;
  /** keep bundles continuously refreshed, pre-compute policy verdicts */
  ready: number;
  /** go and ask the member in advance, while there is time to think */
  preAuthorise: number;
  factors: { scarcity: number; urgency: number; criticality: number; confidence: number };
  inputs: ThresholdInputs;
};

/** Where the bands sit when nothing is unusual — seats plentiful, hours to spare. */
const BASE = { prepare: 25, ready: 55, preAuthorise: 80 };

/** Below this the thresholds cannot fall, so scarcity can never make us act on noise. */
const FLOOR = { prepare: 10, ready: 25, preAuthorise: 45 };
const CEILING = { prepare: 45, ready: 75, preAuthorise: 95 };

export function thresholdsFor(input: ThresholdInputs): Thresholds {
  const scarcity = scarcityFactor(input.seatsAvailable, input.partySize);
  const urgency = urgencyFactor(input.minutesToDeparture);
  const criticality = input.hasHardConstraint ? 0.85 : 1;
  // A forecast that does not trust itself has to clear a higher bar.
  const confidence = 0.7 + 0.3 * clamp01(input.confidence);

  const shift = (scarcity * urgency * criticality) / confidence;

  return {
    prepare: bound(BASE.prepare * shift, FLOOR.prepare, CEILING.prepare),
    ready: bound(BASE.ready * shift, FLOOR.ready, CEILING.ready),
    preAuthorise: bound(BASE.preAuthorise * shift, FLOOR.preAuthorise, CEILING.preAuthorise),
    factors: { scarcity, urgency, criticality, confidence },
    inputs: input,
  };
}

/**
 * Few seats left means the option disappears while we deliberate, so we act
 * earlier. Once inventory is deep the factor flattens — there is no more benefit
 * to hurrying.
 *
 * What matters is not the raw seat count but how many parties like this one the
 * route can still absorb: six seats is comfortable for a solo traveller and only
 * just enough for a family of six. At a party of one this is identical to the
 * plain seat count, so existing behaviour is unchanged.
 *
 * Note the known simplification: `seats` is summed across suppliers, so it does
 * not guarantee a party can sit on the same flight. Grouping is a later change.
 */
function scarcityFactor(seats: number, partySize: number): number {
  const party = Math.max(1, Math.floor(partySize));
  const capacity = seats / party;
  if (capacity < 1) return 0.6;
  if (capacity >= 20) return 1;
  return 0.6 + 0.4 * (capacity / 20);
}

/** Time is the other thing you cannot buy back. Inside an hour, act on less. */
function urgencyFactor(minutes: number): number {
  if (minutes <= 60) return 0.65;
  if (minutes >= 480) return 1;
  return 0.65 + 0.35 * ((minutes - 60) / 420);
}

export type Band = 'watch' | 'prepare' | 'ready' | 'pre-authorise';

export function bandFor(cancelProbabilityPct: number, t: Thresholds): Band {
  if (cancelProbabilityPct >= t.preAuthorise) return 'pre-authorise';
  if (cancelProbabilityPct >= t.ready) return 'ready';
  if (cancelProbabilityPct >= t.prepare) return 'prepare';
  return 'watch';
}

export const BAND_LABEL: Record<Band, string> = {
  watch: 'Low risk',
  prepare: 'Moderate risk',
  ready: 'High risk',
  'pre-authorise': 'Very high risk',
};

export const BAND_SAY: Record<Band, string> = {
  watch: "Nothing unusual around this flight. We'll keep watching it and only tell you if that changes.",
  prepare:
    "A few things are working against this one. We're already lining up alternatives in the background.",
  ready:
    "This flight is in real trouble. We're keeping a full backup plan — seat, room and transfers — current, and we'll move you the moment it's called.",
  'pre-authorise':
    "This one looks likely to go. Tell us now what you'd want and we won't need to ask you in a hurry later.",
};

export const GLOW: Record<Band, string> = {
  watch: 'rgba(75,171,124,.10)',
  prepare: 'rgba(211,160,63,.10)',
  ready: 'rgba(217,97,90,.12)',
  'pre-authorise': 'rgba(217,97,90,.16)',
};

/** UI tone buckets, kept to three so the existing colour classes still apply. */
export const BAND_TONE: Record<Band, 'low' | 'mid' | 'high'> = {
  watch: 'low',
  prepare: 'mid',
  ready: 'high',
  'pre-authorise': 'high',
};

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

function bound(v: number, lo: number, hi: number) {
  return Math.round(Math.max(lo, Math.min(hi, v)));
}
