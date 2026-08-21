/**
 * P(this offer is still bookable when we go to ticket it).
 *
 * This used to be a preference term in the weighted sum — `reliability`, scored
 * 1 / 0.75 / 0.4 by hand — competing with cost and arrival as if bookability
 * were a matter of taste. It is not. It is a probability, and it belongs
 * OUTSIDE the linear utility, multiplying it:
 *
 *     score = P(bookable) * preferenceUtility
 *
 * which in the logit is the same as adding `log P(bookable)` to the utility as
 * a fixed-coefficient offset (see model.ts). The consequence is the point of
 * the whole redesign: because the coefficient is fixed at 1 and never learned,
 * no quantity of "member liked the cheap unbookable option" data can teach the
 * ranker to prefer something it cannot get. The old RELIABILITY_FLOOR existed
 * to guarantee exactly that, by pinning the reliability weight above zero. With
 * bookability as an offset the guarantee is automatic — a low probability drives
 * the utility strongly negative on its own.
 *
 * The probability is measured, not guessed: server/suppliers' `revalidateOffer`
 * already returns available | price-changed | gone | unknown at the moment of
 * spend, which is a labelled Bernoulli trial per supplier. train.ts folds those
 * outcomes into `learnedBySupplier`; until enough have accumulated, the priors
 * below stand in, shrunk toward the coarse prior by observation count.
 */

import type { PartyAlt } from '../../domain/altsForParty';
import type { RankerArtifact } from './types.ts';

/**
 * The starting-tier prior, matching the old hand-set reliability exactly so
 * day-one behaviour is unchanged: a live offer with a real expiry is the
 * strongest bookability signal, an entitled offer with no expiry is weaker,
 * anything else weaker still.
 */
function priorFor(alt: PartyAlt, art: RankerArtifact): number {
  const p = art.bookability.priors;
  if (alt.expiresAt !== null) return p.liveWithExpiry;
  if (alt.ok) return p.okNoExpiry;
  return p.other;
}

/**
 * P(bookable) for one candidate. If we have observed this supplier's
 * revalidation outcomes, shrink the observed rate toward the tier prior by
 * count (empirical Bayes, pseudo-count k): a supplier we have checked twice
 * does not get to overrule the prior on the strength of two data points.
 */
export function bookabilityOf(alt: PartyAlt, art: RankerArtifact): number {
  const prior = priorFor(alt, art);
  const learned = alt.supplier ? art.bookability.learnedBySupplier[alt.supplier] : undefined;
  if (!learned || learned.n <= 0) return prior;

  const k = art.bookability.shrink.pseudoCount;
  const shrunk = (learned.p * learned.n + prior * k) / (learned.n + k);
  return clampProb(shrunk);
}

/** The offset the utility receives: log P, floored so a `gone` offer is very
 *  negative but never −∞ (which would make the softmax degenerate). */
export function bookabilityOffset(pBookable: number, art: RankerArtifact): number {
  return Math.log(Math.max(art.bookability.logFloor, clampProb(pBookable)));
}

function clampProb(p: number): number {
  return Math.max(0, Math.min(1, p));
}
