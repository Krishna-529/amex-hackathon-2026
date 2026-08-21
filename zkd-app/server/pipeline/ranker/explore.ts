/**
 * Exploration — deliberately the smallest, safest amount that still lets the
 * data teach us anything, and off by default.
 *
 * The tension this file resolves: a purely deterministic argmax ranker never
 * shows the member anything other than what it already believes is best, so the
 * choices it logs mostly just confirm its current weights — the ranker cannot
 * learn that it was wrong about an option it never surfaces. Recommender systems
 * at YouTube/Instagram scale solve this by randomising exposure and measuring
 * what happens. We cannot: showing an Amex member a worse flight to see whether
 * they take it has a real cost measured in missed weddings, not in a lower
 * watch-time metric.
 *
 * So exploration here is confined to NEAR-TIES: two adjacent options whose
 * utilities differ by less than `nearTieDelta` are, by the model's own account,
 * interchangeable. Swapping their display order costs the member nothing —
 * either option is one the model would have been happy to rank first — while
 * still producing the off-diagonal data that makes the fit identifiable. It is
 * safe for a structural reason worth stating: every candidate here has already
 * passed applyHardRules, so a swap only ever reorders options that are all
 * bookable, entitled, party-fitting and deadline-meeting.
 *
 * The propensity (probability this particular ordering was shown) is recorded so
 * that offline/counterfactual evaluation of a new weight vector stays unbiased —
 * inverse-propensity weighting needs it. This is the "no online A/B" answer: we
 * evaluate candidate weights against logged history, not by experimenting on
 * live members.
 *
 * Even with epsilon at 0 the ranker still learns, from the un-engineered
 * exploration of members overriding the top rank of their own accord.
 */

import type { ModelScored, RankerArtifact } from './types.ts';

export type Rng = () => number; // returns [0,1); injectable so tests are deterministic

/**
 * Given the model's preference-ordered list, optionally swap adjacent near-ties
 * and stamp each result with the propensity of the ordering it ended up in.
 * Mutates rank/propensity on the passed objects and returns them in display
 * order.
 */
export function applyExploration(
  scored: ModelScored[],
  art: RankerArtifact,
  rng: Rng = Math.random,
): ModelScored[] {
  const eps = art.explore.epsilon;
  const delta = art.explore.nearTieDelta;

  // Default (eps = 0): no swaps. Every option was shown in its model rank with
  // probability 1. Nothing to log beyond the deterministic order.
  if (eps <= 0) {
    scored.forEach((s, i) => {
      s.rank = i;
      s.propensity = 1;
    });
    return scored;
  }

  // Every element's propensity must be assigned before this function returns
  // — IPW is only unbiased if it is. Initialised to a sentinel (not a real
  // probability) specifically so a bug leaving one unset is loud, not a
  // silently-wrong 1. The bug this replaces: the old loop only ever wrote
  // `out[i].propensity` in its "near-tie, not swapped" branch, never
  // `out[i+1]`'s — for an interior pair that gap got closed by the NEXT
  // iteration re-visiting that same element as its own `out[i]`, but the
  // LAST element in the array has no next iteration, so an unswapped
  // near-tie against the second-to-last element left it stamped with a
  // stale default of 1 instead of the correct `1 - eps/2`. That silently
  // biased any propensity-weighted (IPW) offline evaluation the moment
  // exploration was ever turned on.
  const out = [...scored];
  const UNSET = -1;
  out.forEach((s) => (s.propensity = UNSET));

  for (let i = 0; i < out.length - 1; i++) {
    const gap = Math.abs(out[i].utility - out[i + 1].utility);
    if (gap < delta && rng() < eps) {
      // swap i and i+1; both members of the swap carry propensity eps/2 for the
      // half of orderings that placed them where they now are, 1 - eps/2 for the
      // other. Recorded per option so IPW can use it.
      [out[i], out[i + 1]] = [out[i + 1], out[i]];
      out[i].propensity = eps / 2;
      out[i + 1].propensity = eps / 2;
    } else if (gap < delta) {
      out[i].propensity = 1 - eps / 2;
      out[i + 1].propensity = 1 - eps / 2;
    } else {
      out[i].propensity = 1;
      // out[i + 1] is intentionally left for the next iteration (as the new
      // `out[i]`) to decide, UNLESS it's the last element — the fallback
      // below covers that case.
    }
  }
  // Anything still unset (only possible for the last element, when its pair
  // with the second-to-last fell into the "not near-tied" branch above) was
  // shown in its model rank with probability 1 — no swap ever touched it.
  out.forEach((s) => { if (s.propensity === UNSET) s.propensity = 1; });
  out.forEach((s, i) => (s.rank = i));
  return out;
}
