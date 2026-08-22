/**
 * Ranking the option portfolio.
 *
 * The hard part of multi-modal recovery is not finding options, it is comparing
 * things that are not alike. A same-night two-stop landing at 04:15, a direct
 * at 06:40 with a hotel, and a carrier-protected reroute that costs nothing are
 * not points on one axis. Ranking them requires saying, explicitly and in one
 * place, what the member is optimising for — and being able to show them that
 * reasoning afterwards.
 *
 * Weights come from their `optimization_strategy` preset
 * (server/preferences/presets.ts), so the member sets one comprehensible knob
 * and the scorer still does a principled six-criterion comparison.
 *
 * ── Hard rules are filters, not penalties ──────────────────────────────────
 *
 * `avoid_airlines`, `allow_cabin_downgrade: false` and party-fit are *rules*.
 * A weighted sum must never be able to outvote them — a beautifully-timed
 * flight on a blocked carrier is not a close call, it is disqualified. So they
 * run first, in `applyHardRules`, and what survives is scored.
 *
 * ── What was removed here on 2026-08-19, and why ──────────────────────────
 *
 * This file used to carry three separate guards — a ceiling on the cost weight,
 * a structural reliability penalty, and an outright override letting a paid
 * option beat a free one — all of them defending against a single problem:
 * `carrierProtectedAlt` fabricated an option with `fare: 0`, which swept every
 * comparison on price alone. Three pieces of defensive machinery existed to
 * contain one made-up row.
 *
 * The fabrication is gone (see server/domain/types.ts's AltKind), and all three
 * guards went with it. Every candidate is now real supplier inventory with a
 * real price, so cost can simply be scored against the range of real prices in
 * the candidate set. What the carrier owes is computed as money in
 * server/domain/refund.ts and shown to the member as a refund and a delta,
 * which is what it always was.
 *
 * ── Cost is scored relatively, not against a ceiling ───────────────────────
 *
 * There is no per-transaction cap any more, so there is no fixed number to
 * measure a fare against. Cost is normalised across the candidates actually on
 * the table: cheapest scores 1, dearest scores 0, and a set of near-identical
 * prices correctly makes cost stop discriminating. A member's OWN stated budget
 * (Part A's free-text intent) is a hard rule, applied in `applyHardRules` where
 * every other member-stated rule lives — never a soft penalty here.
 */

// Explicit .ts on the VALUE imports below (every type-only import is erased at
// runtime and needs none). It lets ./verify.ts exercise the scorer under
// `node --experimental-strip-types` with no build step and no test runner —
// Next resolves these identically.
//
// ── What changed on 2026-08-20 ─────────────────────────────────────────────
//
// The hand-set weighted sum that used to live in `score()` is gone. Ranking is
// now a learned conditional-logit model in ./ranker, seeded from those same
// presets so day-one behaviour is unchanged, and adaptive thereafter. This file
// keeps everything AROUND the ranker exactly as it was: `applyHardRules` (the
// safety filters), the `OptionScore` shape the whole pipeline consumes, and the
// `explain()` that turns per-feature contributions into the member's sentence.
// The ranker returns contributions in the same six-criterion vocabulary the UI
// and journal already speak, so nothing downstream moved.
import { STRATEGY_LABEL, type Criterion } from '../preferences/presets.ts';
import { costFor, type PartyCost } from '../domain/pricing.ts';
import { rankByModel, cabinRank as modelCabinRank } from './ranker/index.ts';
import { carriersOf } from './ranker/features.ts';
import { cancelRiskOf, BASE_CANCEL_RATE } from './ranker/cancelRisk.ts';
import type { RankOptions } from './ranker/index.ts';
import type { ModelScored } from './ranker/types.ts';
import type { PartyAlt } from '../domain/altsForParty';
import type { Flight } from '../domain/types';
import type { RebookingRules } from '../preferences/adapt';
import type { CabinClass } from '../myca';
import type { OptionScore } from './types';

const CABIN_ORDER = ['economy', 'premium economy', 'business', 'first'];
const cabinRank = (c: string) => {
  const i = CABIN_ORDER.indexOf(c.trim().toLowerCase());
  return i === -1 ? 0 : i;
};

export type ScoreContext = {
  flight: Flight;
  rules: RebookingRules;
  preferredCabin: CabinClass;
  partySize: number;
  /** the currency every candidate has been converted into, for display and comparison */
  displayCurrency: string;
  /** carriers the member holds status with, IATA codes */
  preferredCarriers: string[];
  hasHardConstraint: boolean;
  /** MyCa card-member id, so the ranker can apply this member's learned deltas.
   *  Optional: absent → the ranker uses strategy-global weights + MyCa warm start. */
  memberId?: string;
  /** MyCa red-eye preference, a ranker feature (never a hard filter). Optional:
   *  absent → treated as no stated preference. */
  avoidRedEye?: boolean;
  /** live disruption-risk maps (server/risk/), resolved once per recovery.
   *  Optional: absent → weatherRisk/advisoryRisk are constant, ranking unaffected. */
  weatherByAirport?: Map<string, number>;
  advisoryByAirport?: Map<string, number>;
  advisoryByCarrier?: Map<string, number>;
  /** the member's "no matter what" override (set later by the LLM intent layer);
   *  zeroes the advisoryRisk feature. Optional, default off. */
  overrideSevereRisk?: boolean;
};

export type ScoredAlt = {
  alt: PartyAlt;
  cost: PartyCost;
  score: OptionScore;
  /** the sentence the member reads under this option */
  why: string;
};

/** A display note, tagged with which criterion it's about — see explain(). */
type TaggedNote = { criterion: Criterion; text: string };

export type FilterOutcome = {
  kept: PartyAlt[];
  /** what was removed and by which rule — surfaced, never silently dropped */
  removed: { id: string; code: string; rule: string }[];
};

/**
 * Rules first. Each removal is recorded with the rule that caused it, because
 * "we found nothing" and "your own settings excluded everything" are different
 * answers and the member is owed the second one.
 */
export function applyHardRules(alts: PartyAlt[], ctx: ScoreContext): FilterOutcome {
  const removed: FilterOutcome['removed'] = [];
  const kept: PartyAlt[] = [];

  // "I must be there by X" is the thing the member is actually trying to
  // achieve, so an option that misses it is disqualified, not discounted — a
  // weighted sum must never be able to hand someone a cheap flight that lands
  // after the event they were flying to. Unknown arrival times are NOT removed:
  // we cannot prove they miss the deadline, and silently dropping every option
  // from a source that publishes no arrival time would be worse than ranking
  // them (score() already scores an unknown arrival neutrally).
  const deadline = ctx.flight.hardDeadlineISO ? Date.parse(ctx.flight.hardDeadlineISO) : NaN;
  // The symmetric lower bound: the earliest a replacement may depart. Same
  // discipline as the deadline — a departure the member cannot make is
  // impossible, not merely worse, so it is filtered, not penalised. Unknown
  // departure times are NOT removed, for the same reason unknown arrivals
  // survive the deadline check: we cannot prove they violate the window.
  const earliestDepart = ctx.flight.earliestDepartISO ? Date.parse(ctx.flight.earliestDepartISO) : NaN;

  for (const a of alts) {
    // Every leg's carrier, not just the first — `carriersOf` (shared with the
    // ranker's own advisoryRisk feature, ./ranker/features.ts) already parses
    // a connection's full code ("AI 101 + 6E 202") correctly. Checking only
    // `a.code.split(/\s+/)[0]` here used to mean a blocked carrier operating
    // the SECOND leg of a connection was invisible to this rule — a member
    // who said "never book me on X" could still be booked onto a connection
    // whose second leg was X. Fixed 2026-08-21.
    const legCarriers = carriersOf(a);
    const blockedCarrier = legCarriers.find((c) => ctx.rules.avoidAirlines.includes(c));

    if (blockedCarrier) {
      removed.push({ id: a.id, code: a.code, rule: `you asked us never to book ${blockedCarrier}` });
      continue;
    }
    if (!Number.isNaN(deadline) && typeof a.arrivesAt === 'number' && a.arrivesAt > deadline) {
      removed.push({
        id: a.id,
        code: a.code,
        rule: `arrives after the ${new Date(deadline).toUTCString().slice(0, 16)} deadline you gave us`,
      });
      continue;
    }
    if (!Number.isNaN(earliestDepart) && typeof a.departsAt === 'number' && a.departsAt < earliestDepart) {
      removed.push({
        id: a.id,
        code: a.code,
        rule: `leaves before the ${new Date(earliestDepart).toUTCString().slice(0, 16)} earliest start you gave us`,
      });
      continue;
    }
    // Never split a party — the guarantee altsForParty already makes.
    if (!a.fitsParty) {
      removed.push({ id: a.id, code: a.code, rule: `cannot seat all ${ctx.partySize} of you together` });
      continue;
    }
    if (!ctx.rules.allowCabinDowngrade && cabinRank(a.cabin) < cabinRank(ctx.preferredCabin)) {
      removed.push({
        id: a.id,
        code: a.code,
        rule: `${a.cabin} is below the ${ctx.preferredCabin} you asked us never to drop from`,
      });
      continue;
    }
    // `Alt.ok` is the card's own policy verdict — today that means cabin
    // entitlement, the one thing MyCa is still the system of record for.
    //
    // This check is new (2026-08-19) and it closes a real gap. Nothing here
    // ever filtered on `ok`, so an option the card does not entitle the member
    // to could be scored, out-rank everything on price and arrival, and be
    // selected. It never surfaced before because the other reason for
    // `ok: false` was the per-transaction cap, and the cap had its own hard
    // stop at spend time. That stop is gone, so this is now the only thing
    // standing between an out-of-entitlement fare and an automatic booking.
    //
    // Filtered rather than penalised, for the reason stated at the top of this
    // function: a weighted sum must never be able to outvote a rule. The
    // member's own `why` carries through as the reason, so they are told what
    // was excluded and on whose authority.
    if (!a.ok) {
      removed.push({ id: a.id, code: a.code, rule: a.why });
      continue;
    }
    kept.push(a);
  }

  return { kept, removed };
}

/**
 * Rank the surviving alternatives with the learned model, then project each one
 * back into the exact `ScoredAlt` / `OptionScore` shape the rest of the pipeline
 * already consumes. The order comes from the conditional logit; the per-criterion
 * `parts`/`weights` are the human-readable, set-relative view that the member's
 * explanation and the UI bars are built from — computed here, unchanged in
 * character from before, so nothing downstream had to move.
 */
export function rankAlts(alts: PartyAlt[], ctx: ScoreContext): ScoredAlt[] {
  if (alts.length === 0) return [];

  // Party totals: one costFor per alt, shared with the ranker so it and the
  // pipeline agree on "what this costs". (costFor is unchanged and outside this
  // component; we only read it.)
  const costById = new Map<string, PartyCost>();
  const partyTotalById = new Map<string, number>();
  // The alternate's OWN cancellation risk, from the ML model's historical rates.
  // Cheap and synchronous (no serve.py round-trip per candidate) — see
  // ranker/cancelRisk.ts. The alt's carrier comes off its code; the route is the
  // trip's endpoints (a hub connection is approximated by its endpoints, which is
  // the honest granularity the historical route table carries).
  const cancelRiskById = new Map<string, number>();
  for (const a of alts) {
    const c = costFor(ctx.flight, { chosenAltId: a.id, chosenHotelId: '', chosenCabId: '' }, ctx.partySize, ctx.displayCurrency);
    costById.set(a.id, c);
    partyTotalById.set(a.id, c.total);
    // Every leg's carrier, taking the WORST risk across them — the same
    // "conservative, not averaged" reasoning cancelRiskOf itself already
    // applies when blending carrier-rate vs. route-rate (see that file's
    // header). A connection is only as reliable as its riskiest leg; scoring
    // it on the first leg's carrier alone (the old behaviour) understated
    // the risk of a connection whose second leg was the shakier carrier.
    const legCarriers = carriersOf(a);
    const legRisk = legCarriers.length
      ? Math.max(...legCarriers.map((carrier) => cancelRiskOf(carrier, ctx.flight.from, ctx.flight.to)))
      : cancelRiskOf('', ctx.flight.from, ctx.flight.to);
    cancelRiskById.set(a.id, legRisk);
  }

  const { order } = rankByModel(
    {
      alts,
      strategy: ctx.rules.strategy,
      memberId: ctx.memberId,
      preferredCabinRank: modelCabinRank(ctx.preferredCabin),
      preferredCarriers: ctx.preferredCarriers,
      avoidRedEye: ctx.avoidRedEye ?? false,
      premiumEntitled: cabinRank(ctx.preferredCabin) > 0,
      partySize: ctx.partySize,
      flightId: ctx.flight.id,
      partyTotalById,
      cancelRiskById,
      baseCancelRate: BASE_CANCEL_RATE,
      from: ctx.flight.from,
      to: ctx.flight.to,
      weatherByAirport: ctx.weatherByAirport,
      advisoryByAirport: ctx.advisoryByAirport,
      advisoryByCarrier: ctx.advisoryByCarrier,
      overrideSevereRisk: ctx.overrideSevereRisk ?? false,
    },
    (ctx as ScoreContext & { rankOptions?: RankOptions }).rankOptions ?? {},
  );

  const byId = new Map(alts.map((a) => [a.id, a] as const));
  // `typeof NaN === 'number'` is true in JS, so a malformed candidate's NaN
  // arrivesAt/fare used to slip through this filter and poison `bestArrival`/
  // `band` for the WHOLE choice set (Math.min/Math.max with any NaN argument
  // returns NaN) — every OTHER candidate's display bars would go NaN too,
  // not just the broken one's. `Number.isFinite` actually excludes NaN.
  // Fixed 2026-08-21, alongside the same-shaped bug in the ranking features
  // themselves (features.ts's `sanitize`) — this is the display-layer half
  // of that fix; the two are computed on separate paths from the same raw
  // `alt`/`cost` values, so both needed the guard independently.
  const bestArrival = order
    .map((s) => byId.get(s.altId)?.arrivesAt)
    .filter((n): n is number => Number.isFinite(n))
    .reduce<number | null>((m, v) => (m === null ? v : Math.min(m, v)), null);
  const finiteTotals = [...partyTotalById.values()].filter((n) => Number.isFinite(n));
  // If every total came back non-finite (every candidate broken), fall back
  // to a zero-width band — costPart's own `span <= 0` branch already handles
  // that safely (everyone scores 1, cost stops discriminating), the same
  // degenerate-but-safe behaviour a genuinely all-equal-price set gets.
  const band = finiteTotals.length
    ? { min: Math.min(...finiteTotals), max: Math.max(...finiteTotals) }
    : { min: 0, max: 0 };

  const built = order.map((s) => {
    const alt = byId.get(s.altId)!;
    return toScoredAlt(alt, s, ctx, costById.get(alt.id)!, bestArrival, band);
  });
  return finalise(built, ctx);
}

/**
 * Turn one model-scored candidate into the legacy `OptionScore` shape.
 *
 * `parts` are set-relative 0-1 "goodness" values, kept close to the old scorer's
 * so the member-facing bars and notes read exactly as before. `weights` are the
 * member's RESOLVED model weights, mapped onto the six display criteria and
 * normalised — so `explain()` still leads with the criterion that actually
 * decided this option, now driven by the learned weights rather than hand-set
 * ones. `total` is the model's softmax choice probability for this option, which
 * is a genuine "how confident are we this is the pick" in [0,1].
 */
function toScoredAlt(
  alt: PartyAlt,
  m: ModelScored,
  ctx: ScoreContext,
  cost: PartyCost,
  bestArrival: number | null,
  band: { min: number; max: number },
): { scored: ScoredAlt; tagged: TaggedNote[] } {
  // Tagged by which criterion each note is ABOUT, so explain() can pick the
  // note that actually supports its stated reason rather than always taking
  // the first two in this fixed axis order. Fixed 2026-08-21: previously
  // `why` could say "we picked this because it keeps you on an airline you
  // hold status with" and then immediately follow with an arrival/cost
  // detail that had nothing to do with loyalty — technically not false, but
  // confusing exactly where a member's trust in the reasoning matters most.
  // `score.notes` (the public field) is unaffected — same strings, same
  // order, just also tagged internally.
  const tagged: TaggedNote[] = [];
  const notes: string[] = [];
  const push = (criterion: Criterion, text: string) => {
    tagged.push({ criterion, text });
    notes.push(text);
  };

  // arrival (display)
  if (bestArrival !== null && typeof alt.arrivesAt === 'number') {
    const hoursLate = Math.max(0, (alt.arrivesAt - bestArrival) / 3_600_000);
    push('arrival', hoursLate < 0.25 ? 'Earliest arrival we found' : `Arrives ${formatHours(hoursLate)} after the earliest option`);
  } else {
    push('arrival', 'Arrival time not published by this source');
  }
  const arrivalPart = bestArrival !== null && typeof alt.arrivesAt === 'number'
    ? clamp01(1 - Math.max(0, (alt.arrivesAt - bestArrival) / 3_600_000) / 12)
    : 0.5;

  // cost (display)
  const span = Math.max(band.max - band.min, band.min * 0.1);
  const costPart = span <= 0 ? 1 : clamp01(1 - (cost.total - band.min) / span);
  push('cost', cost.total <= band.min
    ? 'Cheapest of everything we found'
    : `${formatMoneyish(cost.total - band.min, cost.currency)} more than the cheapest option`);
  if (alt.quoted) push('cost', `Quoted by the supplier as ${alt.quoted.amount} ${alt.quoted.currency}, converted at market rates`);

  // reliability (display) — the bookability probability tempered by the
  // alternate's own cancellation risk. `stability` feature = -pCancel/scale, so
  // pCancel = -stability * scale (scale 0.05); recover it for the member note.
  const reliabilityPart = clamp01(m.bookability);
  if (m.bookability < 0.7) push('reliability', 'Bookability is uncertain for this source — ranked accordingly');
  const pCancel = Math.max(0, -m.features.stability * 0.05);
  if (pCancel >= 0.04) push('reliability', `Historically higher cancellation risk on this flight (${Math.round(pCancel * 100)}%) — weighed against it`);

  // cabin (display)
  const drop = Math.max(0, cabinRank(ctx.preferredCabin) - cabinRank(alt.cabin));
  const cabinPart = clamp01(1 - drop * 0.4);
  if (drop > 0) push('cabin', `A ${drop === 1 ? 'one-class' : `${drop}-class`} downgrade from ${ctx.preferredCabin}`);

  // loyalty (display) — every leg, matching the ranking feature (see
  // ranker/features.ts's `loyalty`); a connection whose second leg is a
  // status carrier is still a loyalty-relevant option.
  const legCarriers = carriersOf(alt);
  const preferredUpper = ctx.preferredCarriers.map((c) => c.toUpperCase());
  const matchedCarrier = legCarriers.find((c) => preferredUpper.includes(c));
  const onPreferred = matchedCarrier !== undefined;
  const loyaltyPart = ctx.preferredCarriers.length === 0 ? 0.5 : onPreferred ? 1 : 0.35;
  if (onPreferred) push('loyalty', `On ${matchedCarrier}, where you hold status`);

  // effort (display)
  const legs = alt.code.includes('+') ? alt.code.split('+').length : 1;
  const overnight = alt.id.startsWith('ovn:') ? 1 : 0;
  const effortPart = clamp01(1 - (legs - 1) * 0.3 - overnight * 0.3);
  if (legs > 1) push('effort', `${legs - 1} connection${legs > 2 ? 's' : ''} to make`);
  if (overnight) push('effort', 'An overnight stay, with transfers either side');

  const parts = { arrival: arrivalPart, cost: costPart, reliability: reliabilityPart, cabin: cabinPart, loyalty: loyaltyPart, effort: effortPart };
  const weights = displayWeights(m);

  return {
    tagged,
    scored: {
      alt,
      cost,
      score: {
        total: round3(m.choiceProbability),
        parts: roundAll(parts),
        weights: roundAll(weights),
        strategy: ctx.rules.strategy,
        notes,
      },
      why: '',
    },
  };
}

/**
 * Map the model's seven feature contributions onto the six display criteria and
 * normalise to sum 1, so `explain()` (which sorts `parts[k] * weights[k]`) leads
 * with the criterion that genuinely contributed most to THIS option's ranking.
 * `redeye` folds into effort (both comfort/routing) and `seats` into reliability
 * (both bookability-safety), since the display vocabulary is fixed at six.
 */
function displayWeights(m: ModelScored): Record<Criterion, number> {
  const c = m.contributions;
  // Use absolute contribution magnitude as the salience of each criterion for
  // this option — the axes where it was most decisive, in either direction.
  const raw: Record<Criterion, number> = {
    arrival: Math.abs(c.arrival),
    cost: Math.abs(c.cost),
    reliability: Math.abs(Math.log(Math.max(0.02, m.bookability))) + Math.abs(c.seats) + Math.abs(c.stability),
    cabin: Math.abs(c.cabin),
    loyalty: Math.abs(c.loyalty),
    effort: Math.abs(c.effort) + Math.abs(c.redeye),
  };
  const sum = (Object.values(raw) as number[]).reduce((a, b) => a + b, 0) || 1;
  const out = {} as Record<Criterion, number>;
  (Object.keys(raw) as Criterion[]).forEach((k) => (out[k] = raw[k] / sum));
  return out;
}

function finalise(built: { scored: ScoredAlt; tagged: TaggedNote[] }[], ctx: ScoreContext): ScoredAlt[] {
  return built.map(({ scored, tagged }) => ({ ...scored, why: explain(scored, tagged, ctx) }));
}

/**
 * Leads with the axis that actually contributed most, rather than a fixed
 * template — "we chose this because it gets you there first" and "because it is
 * the only one we can confirm" are different explanations and the member
 * deserves the true one.
 */
function explain(s: ScoredAlt, tagged: TaggedNote[], ctx: ScoreContext): string {
  const contributions = (Object.keys(s.score.parts) as Criterion[])
    .map((k) => ({ k, v: s.score.parts[k] * s.score.weights[k] }))
    .sort((a, b) => b.v - a.v);

  const lead: Record<Criterion, string> = {
    arrival: 'it gets you there soonest',
    cost: 'it costs you the least',
    reliability: 'it is the one we can actually confirm end to end',
    cabin: 'it holds the cabin you asked for',
    loyalty: 'it keeps you on an airline you hold status with',
    effort: 'it is the least punishing way through',
  };

  // The detail sentence used to be "the first two notes in a fixed axis
  // order" (arrival, then cost) regardless of which criterion actually led —
  // so a loyalty-led pick would say "we picked this because it keeps you on
  // an airline you hold status with" and then immediately talk about arrival
  // time, never mentioning the carrier. Fixed 2026-08-21: prefer notes that
  // are actually ABOUT the leading criterion, falling back to the natural
  // order only when the leading criterion has no note of its own (e.g. it
  // led on a margin too small to generate a specific remark).
  const leadNotes = tagged.filter((n) => n.criterion === contributions[0].k).map((n) => n.text);
  const otherNotes = tagged.filter((n) => n.criterion !== contributions[0].k).map((n) => n.text);
  const detail = [...leadNotes, ...otherNotes].slice(0, 2).join('. ');
  return `You asked us to optimise for ${STRATEGY_LABEL[ctx.rules.strategy]}, so we picked this because ${lead[contributions[0].k]}. ${detail}.`;
}

/**
 * A bare number with its currency code. Deliberately not lib/time.ts's `money`,
 * which hardcodes the rupee symbol — these notes now have to carry converted
 * figures in whatever the card bills in.
 */
function formatMoneyish(amount: number, currency: string): string {
  return `${currency} ${Math.round(amount).toLocaleString('en-IN')}`;
}

function formatHours(h: number): string {
  if (h < 1) return `${Math.round(h * 60)} min`;
  return `${h.toFixed(1)} h`;
}

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

/**
 * Rounds, and is the last checkpoint before a `parts`/`weights`/`total` value
 * reaches the public `OptionScore` a UI renders as a bar or a percentage.
 * `bestArrival`/`band` are now guarded upstream (see rankAlts), but a
 * candidate whose OWN cost/arrival is itself non-finite can still produce a
 * non-finite value in ITS OWN parts even with clean shared aggregates — this
 * is the final backstop so that candidate renders as "scores worst on this
 * axis" (0) rather than "NaN%" or a broken bar, on the same reasoning as
 * ranker/model.ts's utility guard: never let a broken row corrupt the
 * display, but never hide that it IS broken by inventing a good-looking number.
 */
function round3(v: number) {
  return Number.isFinite(v) ? Math.round(v * 1000) / 1000 : 0;
}

function roundAll<T extends Record<string, number>>(o: T): T {
  const out = {} as T;
  for (const k of Object.keys(o) as (keyof T)[]) out[k] = round3(o[k] as number) as T[keyof T];
  return out;
}
