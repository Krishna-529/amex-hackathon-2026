/**
 * The discrete-choice model itself: turn a set of candidates + a weight vector
 * into utilities, choice probabilities, and per-feature contributions.
 *
 * This is a conditional logit (McFadden). Each candidate i in a choice set has
 *
 *     v_i = w · phi_i  +  log P(bookable_i)
 *
 * and the probability the member picks i from the set is the softmax
 *
 *     P(choose i) = exp(v_i) / sum_j exp(v_j).
 *
 * The `log P(bookable)` term is the offset described in bookability.ts: it makes
 * "can we get it" multiply the preference utility rather than compete with it,
 * with a fixed coefficient of 1 that no training can move.
 *
 * Choosing conditional logit over the pairwise ranker considered earlier is
 * deliberate. It is the canonical model for exactly this problem — a traveller
 * selecting one option from a presented set — it uses every decision (picking
 * the option we ranked first is still an observation, "chose 1 of N"), and its
 * fitted coefficients ARE the weights, so they drop straight back into the
 * artifact and stay inspectable. The known limitation is IIA (two near-identical
 * flights split each other's share); nested/mixed logit relaxes it and needs
 * more data than a hackathon has, so it is a documented future step, not today's.
 */

import { FEATURES, type FeatureVector, type ModelScored, type WeightVector, type RankerArtifact } from './types.ts';
import { bookabilityOffset } from './bookability.ts';

export function dot(w: WeightVector, phi: FeatureVector): number {
  let s = 0;
  for (const f of FEATURES) s += w[f] * phi[f];
  return s;
}

/** Per-feature contribution w_k * phi_k — what the explanation leads with, and
 *  what makes a learned score as inspectable as the hand-set one it replaces. */
export function contributionsOf(w: WeightVector, phi: FeatureVector): FeatureVector {
  const out = {} as FeatureVector;
  for (const f of FEATURES) out[f] = w[f] * phi[f];
  return out;
}

export type Candidate = { altId: string; features: FeatureVector; bookability: number };

/**
 * Score a choice set. Returns candidates in the model's own preference order
 * (highest utility first), each carrying its softmax choice probability and its
 * contributions. Ranking placement/propensity is applied afterwards by
 * explore.ts, so this stays a pure, exploration-free function — the thing the
 * trainer's likelihood is defined against.
 */
export function scoreSet(cands: Candidate[], w: WeightVector, art: RankerArtifact): ModelScored[] {
  const utilities = cands.map((c) => dot(w, c.features) + bookabilityOffset(c.bookability, art));

  // softmax with the usual max-subtraction for numerical stability
  const max = Math.max(...utilities);
  const exps = utilities.map((u) => Math.exp(u - max));
  const denom = exps.reduce((a, b) => a + b, 0) || 1;

  const scored: ModelScored[] = cands.map((c, i) => ({
    altId: c.altId,
    utility: utilities[i],
    choiceProbability: exps[i] / denom,
    bookability: c.bookability,
    features: c.features,
    contributions: contributionsOf(w, c.features),
    rank: 0, // set by explore.ts / caller after ordering
    propensity: 1,
  }));

  // Deterministic tiebreak makes the monotonicity guarantee crisp: when two
  // options have equal utility (e.g. a weight was clipped to zero, or they
  // genuinely match), the cheaper one wins, then the earlier, then the one with
  // more spare seats. Without this, an exact tie would fall to input order,
  // which is arbitrary — and "cheaper is never ranked worse" has to hold even
  // in a tie, not merely "never strictly worse".
  scored.sort(
    (a, b) =>
      b.utility - a.utility ||
      b.features.cost - a.features.cost ||
      b.features.arrival - a.features.arrival ||
      b.features.seats - a.features.seats,
  );
  scored.forEach((s, i) => (s.rank = i));
  return scored;
}
