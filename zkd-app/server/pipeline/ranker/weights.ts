/**
 * Where a member's weight vector actually comes from — the smart-initialisation
 * and anti-overfit machinery, in one place.
 *
 * The design goal the whole ranker is built around: a member should be scored
 * with a vector that is already personalised on day one, so that learning only
 * ever has to apply a SMALL correction. A small correction needs little data and
 * is hard to overfit. The chain that produces it, weakest evidence first:
 *
 *   1. STRATEGY PRIOR  — the presets, ported into feature space. Every member on
 *      a given optimisation strategy starts here. This is the "why 0.50?" layer:
 *      today it is the hand-set prior, but it is now a labelled starting point a
 *      learned global vector shrinks it toward, not the final answer.
 *
 *   2. MyCa WARM START — offsets derived from the member's own MyCa profile:
 *      more loyalty weight if they hold airline status, red-eye avoidance if
 *      they set it, cabin sensitivity if entitled above economy. This is the
 *      personalisation that works with zero interaction history, because MyCa is
 *      a real statement of preference, not an inference. It is why the model does
 *      not need to "explore" a member to serve them well from the first recovery.
 *
 *   3. GLOBAL LEARNED  — a vector fitted across ALL members on this strategy,
 *      blended over the prior by observation count. Removes aggregate bias in the
 *      hand-set prior once there is data to justify moving.
 *
 *   4. MEMBER LEARNED  — a vector fitted on THIS member's own choices, blended
 *      over the global-or-prior by their own count. This is the long-run
 *      adaptivity, and it is gated hardest because it has the least data behind
 *      it and the most room to overfit one person's noise.
 *
 * Two anti-overfit controls run at every learned layer: a hard `minData` gate
 * (below it, the learned vector is ignored entirely) and a soft empirical-Bayes
 * shrinkage `w = (n*learned + k*prior)/(n+k)` — the same formula
 * zkd-risk-model/train.py uses for entity cancellation rates. The trainer adds a
 * third (an L2 penalty toward the prior) so the learned vectors handed here are
 * already conservative.
 *
 * And one hard invariant, asserted here rather than trusted: every weight is
 * clipped to be non-negative before it is ever used to score. The features are
 * oriented so that non-negative weights mean "cheaper/earlier/less-downgrade is
 * never ranked worse" — a monotonicity guarantee that holds no matter what a
 * training run produced or what a hand-edited artifact claims.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { FEATURES, type FeatureName, type RankerArtifact, type WeightVector } from './types.ts';

const ARTIFACT_PATH = join(process.cwd(), 'server', 'pipeline', 'ranker', 'model.json');

let cached: { art: RankerArtifact; mtime: number } | null = null;

/** Load the artifact, re-reading only when the file changes. The trainer writes
 *  a new one out of band; the app picks it up on the next call. */
export function loadArtifact(): RankerArtifact {
  const art = JSON.parse(readFileSync(ARTIFACT_PATH, 'utf8')) as RankerArtifact;
  cached = { art, mtime: Date.now() };
  return art;
}

export function getArtifact(): RankerArtifact {
  if (cached) return cached.art;
  return loadArtifact();
}

/** For tests and the trainer: score against an explicitly supplied artifact. */
export function withArtifact(art: RankerArtifact): RankerArtifact {
  return art;
}

export type MemberSignals = {
  strategy: string;
  memberId?: string;
  preferredCarriers: string[];
  avoidRedEye: boolean;
  /** true when the member's entitled cabin is above economy */
  premiumEntitled: boolean;
};

/**
 * Resolve the weight vector for one ranking, walking the chain above. Pure and
 * deterministic given the artifact and signals, so it is trivially testable and
 * so a decision can be replayed exactly (the resolved vector is logged with the
 * decision).
 */
export function resolveWeights(art: RankerArtifact, sig: MemberSignals): WeightVector {
  const prior = art.priorByStrategy[sig.strategy] ?? art.priorByStrategy.earliest_arrival;

  // 1 + 2: strategy prior plus MyCa warm start.
  let w = applyMycaOffsets({ ...prior }, art, sig);

  // 3: global learned vector for this strategy, blended over the prior by count.
  const gLearned = art.learnedByStrategy[sig.strategy];
  const gCount = art.counts.byStrategy[sig.strategy] ?? 0;
  if (gLearned && gCount >= art.shrink.minDataGlobal) {
    w = shrinkToward(gLearned, w, gCount, art.shrink.pseudoCountGlobal);
  }

  // 4: this member's own learned vector, blended over whatever (3) produced.
  if (sig.memberId) {
    const mLearned = art.learnedByMember[sig.memberId];
    const mCount = art.counts.byMember[sig.memberId] ?? 0;
    if (mLearned && mCount >= art.shrink.minDataMember) {
      w = shrinkToward(mLearned, w, mCount, art.shrink.pseudoCountMember);
    }
  }

  return enforceMonotone(w, art);
}

/** MyCa warm start: the member's profile bumps the features it speaks to. */
function applyMycaOffsets(w: WeightVector, art: RankerArtifact, sig: MemberSignals): WeightVector {
  const o = art.mycaOffsets;
  if (sig.preferredCarriers.length > 0) w.loyalty += o.loyaltyIfPreferredCarriers;
  if (sig.avoidRedEye) w.redeye += o.redeyeIfAvoid;
  if (sig.premiumEntitled) w.cabin += o.cabinIfPremiumEntitled;
  return w;
}

/** Empirical-Bayes blend: the more observations, the closer to the learned
 *  vector; at n=0 it is exactly the prior. */
export function shrinkToward(
  learned: WeightVector,
  prior: WeightVector,
  n: number,
  k: number,
): WeightVector {
  const out = {} as WeightVector;
  for (const f of FEATURES) {
    const l = learned[f] ?? prior[f];
    out[f] = (l * n + prior[f] * k) / (n + k);
  }
  return out;
}

/** The monotonicity guarantee, enforced not assumed: non-negative weights on
 *  features oriented so that "better" is larger. */
export function enforceMonotone(w: WeightVector, art: RankerArtifact): WeightVector {
  const out = {} as WeightVector;
  const mono = new Set<FeatureName>(art.monotoneNonNegative);
  for (const f of FEATURES) {
    out[f] = mono.has(f) ? Math.max(0, w[f] ?? 0) : (w[f] ?? 0);
  }
  return out;
}
