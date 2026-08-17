/**
 * Adaptive action thresholds — client-safe half.
 *
 * This file holds the Band type and the pure UI lookups (labels, copy,
 * glow colours) so client components can import them directly. The actual
 * computation (thresholdsFor) reads config/risk-thresholds.json off disk via
 * lib/thresholdConfig.ts, which pulls in Node's `fs` — that must stay
 * server-only, so it lives in server/engine/thresholds.ts instead. Importing
 * it from here would drag `fs` into the browser bundle.
 *
 * Every evaluation returns its own inputs so the decision ledger can reconstruct
 * why a band fired. An adaptive threshold nobody can replay is not auditable.
 */

export type ThresholdInputs = {
  /** alternative seats found across all suppliers for this route, already
   *  filtered to options that can seat the relevant party — see `partySize` */
  seatsAvailable: number;
  /** minutes from now until the disrupted flight was due to depart */
  minutesToDeparture: number;
  /** the trip has an onward leg or a hard commitment that a late arrival breaks */
  hasHardConstraint: boolean;
  /** the forecast's own confidence, 0-1 */
  confidence: number;
  /** provenance only — thresholdsFor does not read this. The party
   *  `seatsAvailable` was filtered against; 1 unless a larger PNR exists on
   *  this flight. Kept here so the decision ledger can explain a low
   *  `seatsAvailable` that would otherwise look unexplained. */
  partySize?: number;
};

export type Thresholds = {
  /** start assembling and searching, no spend */
  prepare: number;
  /** evaluate the hold gate, pre-compute policy verdicts */
  holdGate: number;
  /** go and ask the member in advance, while there is time to think */
  preAuthorise: number;
  factors: { scarcity: number; urgency: number; criticality: number; confidence: number };
  inputs: ThresholdInputs;
  /** the config version these bands were computed against — for the decision ledger */
  configVersion: number;
};

export type Band = 'watch' | 'prepare' | 'hold-gate' | 'pre-authorise';

export function bandFor(cancelProbabilityPct: number, t: Thresholds): Band {
  if (cancelProbabilityPct >= t.preAuthorise) return 'pre-authorise';
  if (cancelProbabilityPct >= t.holdGate) return 'hold-gate';
  if (cancelProbabilityPct >= t.prepare) return 'prepare';
  return 'watch';
}

export const BAND_LABEL: Record<Band, string> = {
  watch: 'Low risk',
  prepare: 'Moderate risk',
  'hold-gate': 'High risk',
  'pre-authorise': 'Very high risk',
};

export const BAND_SAY: Record<Band, string> = {
  watch: "Nothing unusual around this flight. We'll keep watching it and only tell you if that changes.",
  prepare:
    "A few things are working against this one. We're already lining up alternatives in the background.",
  'hold-gate':
    "This flight is in real trouble. We've got backup seats identified and we'll move you the moment it's called.",
  'pre-authorise':
    "This one looks likely to go. Tell us now what you'd want and we won't need to ask you in a hurry later.",
};

export const GLOW: Record<Band, string> = {
  watch: 'rgba(75,171,124,.10)',
  prepare: 'rgba(211,160,63,.10)',
  'hold-gate': 'rgba(217,97,90,.12)',
  'pre-authorise': 'rgba(217,97,90,.16)',
};

/** UI tone buckets, kept to three so the existing colour classes still apply. */
export const BAND_TONE: Record<Band, 'low' | 'mid' | 'high'> = {
  watch: 'low',
  prepare: 'mid',
  'hold-gate': 'high',
  'pre-authorise': 'high',
};

/**
 * The riskScore at which the engine stops watching and starts *acting* —
 * pre-fetching alternatives from suppliers.
 *
 * Mirrors `altCache.prefetchAtOrAboveRiskScore` in config/risk-thresholds.json,
 * which is the authority. It is duplicated here because that config is read
 * through lib/thresholdConfig.ts, which pulls in Node's `fs` and must stay off
 * the client bundle — and this file is the client-safe half.
 *
 * Deliberately NOT a round 80. 75 is the number that actually changes system
 * behaviour; highlighting at 80 would draw the eye to a threshold nothing keys
 * off. If the config is retuned, change it here too — the test in
 * lib/thresholds.test.ts asserts the two agree.
 */
export const ACT_AT_RISK_SCORE = 75;

/** True when this flight's score has crossed into the acting band. Undefined
 *  riskScore (the model omits it rather than fabricating one) is never
 *  highlighted — absence of evidence is not a low score, but it is not a high
 *  one either. */
export function isActingOnRisk(riskScore: number | undefined): boolean {
  return riskScore !== undefined && riskScore >= ACT_AT_RISK_SCORE;
}
