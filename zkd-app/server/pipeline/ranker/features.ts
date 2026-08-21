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
  /** the journey's endpoints, so a candidate's touched airports can be resolved */
  from: string;
  to: string;
  /** live disruption-risk signals, resolved once per recovery (server/risk/).
   *  Empty maps make weatherRisk/advisoryRisk constant and ranking unchanged. */
  weatherByAirport: Map<string, number>;
  advisoryByAirport: Map<string, number>;
  advisoryByCarrier: Map<string, number>;
  /** when true, the advisoryRisk feature is zeroed — the member's "no matter
   *  what" override, set (later) by the LLM intent layer. */
  overrideSevereRisk: boolean;
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

  // weatherRisk: worst live weather across the airports THIS candidate touches
  // — its origin, destination, and (for a connection) its hub. Negated so lower
  // risk is a higher feature. The shared endpoints are the same for every
  // same-route candidate and cancel in the softmax; the hub is what makes a
  // connection through a storm rank below a direct.
  const airports = touchedAirports(alt, ctx.from, ctx.to);
  const wRisk = maxOver(airports, ctx.weatherByAirport);
  const weatherRisk = -wRisk / s.weatherRisk;

  // advisoryRisk: worst live advisory (closures via NOTAM, news via GDELT) over
  // the touched airports OR the candidate's operating carrier(s) — a striking or
  // grounded airline demotes every one of its options. Zeroed when the member
  // has overridden ("get me there no matter what"), which is why this is a heavy
  // weight rather than a hard rule.
  const aRisk = ctx.overrideSevereRisk
    ? 0
    : Math.max(maxOver(airports, ctx.advisoryByAirport), maxOver(carriersOf(alt), ctx.advisoryByCarrier));
  const advisoryRisk = -aRisk / s.advisoryRisk;

  return { arrival, cost, cabin, effort, loyalty, redeye, seats, stability, weatherRisk, advisoryRisk };
}

/** The airports a candidate touches: its journey endpoints, plus the hub of a
 *  composed connection (recorded as "…via XXX…" in the alt's `why`). Accepts any
 *  Alt or PartyAlt — only `why` is read. */
export function touchedAirports(alt: { why?: string }, from: string, to: string): string[] {
  const set = new Set<string>([from, to]);
  const hub = /via\s+([A-Z]{3})/.exec(alt.why ?? '')?.[1];
  if (hub) set.add(hub);
  return [...set];
}

/** The operating carrier(s) of a candidate — one for a direct, both legs of a
 *  connection (code "AI 101 + 6E 202"). Only `code` is read. */
export function carriersOf(alt: { code: string }): string[] {
  return [...(alt.code.match(/\b([A-Z0-9]{2})\s*\d/g) ?? [])]
    .map((m) => m.trim().slice(0, 2).toUpperCase());
}

function maxOver(keys: string[], m: Map<string, number>): number {
  let max = 0;
  for (const k of keys) max = Math.max(max, m.get(k) ?? 0);
  return max;
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
