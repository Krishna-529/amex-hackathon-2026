/**
 * The featuriser: the ONE place that knows what a candidate flight looks like as
 * numbers. Everything else in the ranker works on the FeatureVector this
 * produces, which means the model can be retrained, replaced, or explained
 * without any other file having to agree on how a fare becomes a feature.
 *
 * Two rules the whole design rests on:
 *
 *  1. Features are RAW and SIGNED so that higher is always "more preferred".
 *     There are no hand-tuned transform constants here (no 0.4-per-cabin-class,
 *     no 12-hour horizon) — those numbers were the second, hidden set of magic
 *     weights in the old scorer. A raw feature paired with a learnable weight
 *     expresses the same thing without pre-baking the response curve.
 *
 *  2. Every feature is oriented so its weight is NON-NEGATIVE. "Cheaper is
 *     never worse", "earlier is never worse", "more spare seats is never worse".
 *     That orientation is what lets monotonicity be enforced as a single rule —
 *     clip weights at zero — rather than as seven separate sign arguments. It is
 *     the guardrail that makes a learned ranker safe to put in a spend path.
 *
 * MyCa is load-bearing here: `cabin`, `loyalty` and `redeye` are computed
 * directly from the member's MyCa profile (preferred cabin, status carriers,
 * red-eye tolerance). The ranker is personalised at the feature level, not only
 * at the weight level.
 */

import type { FeatureVector, RankerArtifact } from './types.ts';
import type { PartyAlt } from '../../domain/altsForParty';

const CABIN_ORDER = ['economy', 'premium economy', 'business', 'first'];
export function cabinRank(c: string): number {
  const i = CABIN_ORDER.indexOf(c.trim().toLowerCase());
  return i === -1 ? 0 : i;
}

/** Seats-spare beyond this stops mattering — plenty is plenty. */
const SEATS_SATURATION = 8;

export type FeatureContext = {
  /** epoch ms of the earliest arrival across the whole candidate set */
  bestArrival: number | null;
  /** cheapest party total across the whole candidate set, in display currency */
  cheapestTotal: number;
  /** the cabin the member prefers (from MyCa), as a rank */
  preferredCabinRank: number;
  /** IATA carrier codes the member holds status with (from MyCa) */
  preferredCarriers: string[];
  /** whether the member asked to avoid red-eyes (from MyCa). Undefined = no preference. */
  avoidRedEye: boolean;
  partySize: number;
  /**
   * P(this alternate is itself cancelled), per alt id, from the cancellation
   * model's historical rates (cancelRisk.ts). Absent id → treated as the base
   * rate, so a candidate with no estimate does not look artificially safe or
   * risky. An empty map makes `stability` a constant, leaving ranking unchanged.
   */
  cancelRiskById: Map<string, number>;
  /** the base rate used for any alt not present in cancelRiskById */
  baseCancelRate: number;
};

/** Local night window used only to label a departure/arrival as a "red-eye". */
function isRedEye(alt: PartyAlt): boolean {
  // `dep`/`arr` are pre-localised "HH:MM" strings on the Alt. A red-eye is a
  // departure late at night or an arrival in the small hours — deliberately a
  // coarse rule, because it only feeds a feature the member can outweigh, never
  // a hard filter.
  const depHour = parseHour(alt.dep);
  const arrHour = parseHour(alt.arr);
  const lateDep = depHour !== null && (depHour >= 23 || depHour < 1);
  const earlyArr = arrHour !== null && arrHour >= 0 && arrHour < 5;
  return lateDep || earlyArr;
}

function parseHour(hhmm: string | undefined): number | null {
  if (!hhmm) return null;
  const m = /^(\d{1,2}):/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  return Number.isFinite(h) ? h : null;
}

function legCount(alt: PartyAlt): number {
  return alt.code.includes('+') ? alt.code.split('+').length : 1;
}

/**
 * Raw goodness features for one candidate. Divided by the artifact's fixed
 * scales so the learned weights are comparable across routes and retrains, but
 * NOT centred: a conditional-logit softmax is invariant to a per-set constant,
 * so within-set centring would not change any ranking or choice probability and
 * only cost the display its natural units.
 */
export function featurise(alt: PartyAlt, ctx: FeatureContext, art: RankerArtifact): FeatureVector {
  const s = art.scales;

  // arrival: how many hours later than the best option, negated (earlier better)
  const hoursLate =
    ctx.bestArrival !== null && typeof alt.arrivesAt === 'number'
      ? Math.max(0, (alt.arrivesAt - ctx.bestArrival) / 3_600_000)
      : 0; // unknown arrival scores neutral (0), never best or worst
  const arrival = -hoursLate / s.arrival;

  // cost: fractional premium over the cheapest option, negated (cheaper better),
  // floored so a single freak-expensive option cannot dominate the scale
  const partyTotal = altPartyTotal(alt, ctx.partySize);
  const priceDeltaFrac =
    ctx.cheapestTotal > 0 ? Math.min(2, (partyTotal - ctx.cheapestTotal) / ctx.cheapestTotal) : 0;
  const cost = -priceDeltaFrac / s.cost;

  // cabin: classes below the member's preferred cabin, negated (less drop better)
  const drop = Math.max(0, ctx.preferredCabinRank - cabinRank(alt.cabin));
  const cabin = -drop / s.cabin;

  // effort: extra legs plus an overnight, negated (fewer changes better)
  const overnight = alt.id.startsWith('ovn:') ? 1 : 0;
  const effort = -((legCount(alt) - 1) + overnight) / s.effort;

  // loyalty: on a status carrier or not (MyCa)
  const carrier = alt.code.split(/\s+/)[0]?.toUpperCase() ?? '';
  const onPreferred = ctx.preferredCarriers.map((c) => c.toUpperCase()).includes(carrier);
  const loyalty = (onPreferred ? 1 : 0) / s.loyalty;

  // redeye: a red-eye the member specifically asked to avoid (MyCa), negated
  const redeye = -(ctx.avoidRedEye && isRedEye(alt) ? 1 : 0) / s.redeye;

  // seats: headroom for the party beyond the exact count needed
  const spare = Math.max(0, alt.seats - ctx.partySize);
  const seats = Math.min(spare, SEATS_SATURATION) / SEATS_SATURATION / s.seats;

  // stability: the alternate's OWN cancellation risk, from the ML model's
  // historical rates. Negated and scaled so a lower cancellation probability is
  // a higher (better) feature — we would rather not recover a member onto a
  // flight that is itself about to be cancelled.
  const pCancel = ctx.cancelRiskById.get(alt.id) ?? ctx.baseCancelRate;
  const stability = -pCancel / s.stability;

  return { arrival, cost, cabin, effort, loyalty, redeye, seats, stability };
}

/**
 * The party total for an alt, kept here so the featuriser has one definition of
 * "what this costs the party" without depending on pricing.ts (which is
 * outside this component and priced against the full recovery, not the flight
 * alone). `partyFare` is already the whole-party flight cost that altsForParty
 * computed; this is the flight-search view of cost, deliberately.
 */
export function altPartyTotal(alt: PartyAlt, _partySize: number): number {
  return alt.partyFare;
}
