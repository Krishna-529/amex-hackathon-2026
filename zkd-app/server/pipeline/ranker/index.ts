/**
 * The ranker's public surface — one function, `rankByModel`, that score.ts calls
 * in place of the old weighted sum.
 *
 * It composes the pieces: build the feature context for the set, featurise each
 * candidate, resolve the member's weight vector (strategy prior + MyCa warm
 * start + any learned deltas), score the choice set as a conditional logit,
 * apply the (default-off) near-tie exploration, log the shown set for training,
 * and hand back a ranking plus everything score.ts needs to build the exact
 * OptionScore shape the rest of the pipeline already consumes.
 *
 * Nothing here is aware of the saga, the journal, or the UI. It takes candidates
 * that already passed applyHardRules and returns them ordered.
 */

import type { PartyAlt } from '../../domain/altsForParty';
import { featurise, cabinRank, type FeatureContext } from './features.ts';
import { bookabilityOf } from './bookability.ts';
import { getArtifact } from './weights.ts';
import { resolveWeights, type MemberSignals } from './weights.ts';
import { scoreSet, type Candidate } from './model.ts';
import { applyExploration, type Rng } from './explore.ts';
import { logShownSet, type ShownCandidate } from './decisionLog.ts';
import type { ModelScored, RankerArtifact, WeightVector } from './types.ts';

export type RankInput = {
  alts: PartyAlt[];
  strategy: string;
  memberId?: string;
  preferredCabinRank: number;
  preferredCarriers: string[];
  avoidRedEye: boolean;
  premiumEntitled: boolean;
  partySize: number;
  flightId: string;
  /** party totals per alt in display currency, already computed by the caller so
   *  the ranker and the rest of the pipeline agree on "what this costs". */
  partyTotalById: Map<string, number>;
  /** P(alt itself cancelled) per alt id, from the cancellation model. Optional:
   *  omitted/empty → the `stability` feature is constant and ranking is unaffected. */
  cancelRiskById?: Map<string, number>;
  /** base cancellation rate for alts absent from the map. Optional. */
  baseCancelRate?: number;
};

export type RankOutput = {
  order: ModelScored[];
  weights: WeightVector;
  artifact: RankerArtifact;
};

/** Overridable seams for tests: an explicit artifact and a deterministic RNG. */
export type RankOptions = { artifact?: RankerArtifact; rng?: Rng; log?: boolean };

export function rankByModel(input: RankInput, opts: RankOptions = {}): RankOutput {
  const art = opts.artifact ?? getArtifact();

  const arrivals = input.alts
    .map((a) => a.arrivesAt)
    .filter((n): n is number => typeof n === 'number');
  const totals = input.alts.map((a) => input.partyTotalById.get(a.id) ?? a.partyFare);

  const fctx: FeatureContext = {
    bestArrival: arrivals.length ? Math.min(...arrivals) : null,
    cheapestTotal: totals.length ? Math.min(...totals) : 0,
    preferredCabinRank: input.preferredCabinRank,
    preferredCarriers: input.preferredCarriers,
    avoidRedEye: input.avoidRedEye,
    partySize: input.partySize,
    cancelRiskById: input.cancelRiskById ?? new Map(),
    baseCancelRate: input.baseCancelRate ?? 0.02,
  };

  const sig: MemberSignals = {
    strategy: input.strategy,
    memberId: input.memberId,
    preferredCarriers: input.preferredCarriers,
    avoidRedEye: input.avoidRedEye,
    premiumEntitled: input.premiumEntitled,
  };
  const weights = resolveWeights(art, sig);

  const cands: Candidate[] = input.alts.map((a) => ({
    altId: a.id,
    features: featurise(a, fctx, art),
    bookability: bookabilityOf(a, art),
  }));

  const scored = scoreSet(cands, weights, art);
  const order = applyExploration(scored, art, opts.rng);

  if (opts.log !== false) {
    const byId = new Map(input.alts.map((a) => [a.id, a] as const));
    const candidates: ShownCandidate[] = order.map((s) => ({
      altId: s.altId,
      code: byId.get(s.altId)?.code ?? s.altId,
      features: s.features,
      bookability: s.bookability,
      utility: round4(s.utility),
      rank: s.rank,
      propensity: round4(s.propensity),
    }));
    logShownSet({
      decisionId: `${input.flightId}:${input.memberId ?? 'anon'}:${Date.now()}`,
      flightId: input.flightId,
      memberId: input.memberId ?? 'anon',
      strategy: input.strategy,
      weightsVersion: art.version,
      weights,
      candidates,
    });
  }

  return { order, weights, artifact: art };
}

export { cabinRank };
export type { ModelScored, WeightVector, RankerArtifact } from './types.ts';

function round4(v: number): number {
  return Math.round(v * 1e4) / 1e4;
}
