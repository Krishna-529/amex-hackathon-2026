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
 * ── The carrier-protected `fare: 0` problem ────────────────────────────────
 *
 * `carrierProtectedAlt` zeroes the fare by construction, because the airline
 * owes it. On a naive weighted sum that sweeps every comparison on price alone
 * and a member optimising for "lowest cost" gets whatever is free regardless of
 * when it lands. Three guards, in increasing order of bluntness:
 *
 *   1. `cost` is capped at COST_WEIGHT_MAX of the total, so free-vs-paid can
 *      only ever move the needle so far.
 *   2. `reliability` structurally penalises it — a carrier-protected alt has no
 *      offer expiry and no NDC behind it, so it scores below a live bookable
 *      offer and gives back most of what it won on price.
 *   3. An explicit override: a paid option that arrives materially earlier and
 *      is within the member's cap wins outright. A system where "free" beats
 *      "four hours earlier" is wrong in a way no weight tuning fixes.
 */

// Explicit .ts on the two VALUE imports below (every type-only import is erased
// at runtime and needs none). It lets ./verify.ts exercise the scorer under
// `node --experimental-strip-types` with no build step and no test runner —
// Next resolves these identically. The three fare:0 guards documented above are
// the kind of claim that should be executable rather than asserted in a comment.
import { weightsFor, STRATEGY_LABEL, type Criterion, type Weights } from '../preferences/presets.ts';
import { costFor, type PartyCost } from '../domain/pricing.ts';
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

/** Ceiling on how much of the total the cost term may ever command. */
const COST_WEIGHT_MAX = 0.4;

/** A paid option arriving at least this much earlier beats a free one outright. */
const TIE_ARRIVAL_MINUTES = 45;

/** Beyond this much later than the best available arrival, everything scores 0. */
const ARRIVAL_HORIZON_HOURS = 12;

export type ScoreContext = {
  flight: Flight;
  rules: RebookingRules;
  preferredCabin: CabinClass;
  partySize: number;
  cap: { amount: number; currency: string };
  /** carriers the member holds status with, IATA codes */
  preferredCarriers: string[];
  hasHardConstraint: boolean;
};

export type ScoredAlt = {
  alt: PartyAlt;
  cost: PartyCost;
  score: OptionScore;
  /** the sentence the member reads under this option */
  why: string;
};

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

  for (const a of alts) {
    const carrier = a.code.split(/\s+/)[0]?.toUpperCase() ?? '';

    if (ctx.rules.avoidAirlines.includes(carrier)) {
      removed.push({ id: a.id, code: a.code, rule: `you asked us never to book ${carrier}` });
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
    kept.push(a);
  }

  return { kept, removed };
}

export function rankAlts(alts: PartyAlt[], ctx: ScoreContext): ScoredAlt[] {
  if (alts.length === 0) return [];

  const weights = capCost(weightsFor(ctx.rules.strategy, { hasHardConstraint: ctx.hasHardConstraint }));

  const arrivals = alts.map((a) => a.arrivesAt).filter((n): n is number => typeof n === 'number');
  const bestArrival = arrivals.length ? Math.min(...arrivals) : null;

  const scored = alts.map((a) => score(a, ctx, weights, bestArrival));
  scored.sort((x, y) => y.score.total - x.score.total);

  return applyEarlyArrivalOverride(scored, ctx);
}

function capCost(w: Weights): Weights {
  if (w.cost <= COST_WEIGHT_MAX) return w;
  const excess = w.cost - COST_WEIGHT_MAX;
  const others = (Object.keys(w) as Criterion[]).filter((k) => k !== 'cost');
  const sum = others.reduce((n, k) => n + w[k], 0);
  const out = { ...w, cost: COST_WEIGHT_MAX };
  if (sum > 0) for (const k of others) out[k] = w[k] + excess * (w[k] / sum);
  return out;
}

function score(
  alt: PartyAlt,
  ctx: ScoreContext,
  weights: Weights,
  bestArrival: number | null,
): ScoredAlt {
  const notes: string[] = [];
  const cost = costFor(
    ctx.flight,
    { chosenAltId: alt.id, chosenHotelId: '', chosenCabId: '' },
    ctx.partySize,
    ctx.cap,
  );

  // ── arrival ──
  let arrival = 0.5;
  if (bestArrival !== null && typeof alt.arrivesAt === 'number') {
    const hoursLate = Math.max(0, (alt.arrivesAt - bestArrival) / 3_600_000);
    arrival = clamp01(1 - hoursLate / ARRIVAL_HORIZON_HOURS);
    notes.push(
      hoursLate < 0.25
        ? 'Earliest arrival we found'
        : `Arrives ${formatHours(hoursLate)} after the earliest option`,
    );
  } else {
    // Unknown arrival scores neutral rather than best or worst — guessing in
    // either direction would be worse than admitting we cannot compare.
    notes.push('Arrival time not published by this source');
  }

  // ── cost ──
  // What the MEMBER pays, not the ticket price. On the involuntary path the
  // carrier pays and this term correctly stops mattering.
  const comparable = alt.currency === ctx.cap.currency;
  const costScore = !comparable
    ? 0.5
    : ctx.cap.amount <= 0
      ? 1
      : clamp01(1 - cost.total / (ctx.cap.amount * 2));
  if (!comparable) {
    notes.push(`Priced in ${alt.currency} against a cap set in ${ctx.cap.currency} — we will not convert it automatically`);
  } else if (cost.total === 0) {
    notes.push('Costs you nothing — the airline is covering this');
  } else if (cost.overCap) {
    notes.push('Over the amount you pre-authorised, so it needs your explicit approval');
  }

  // ── reliability ──
  //
  // Guard 2 on the fare:0 problem, and it is deliberately gentle.
  //
  // A carrier-protected alt is not *unlikely* — it is what the airline
  // statutorily owes on an involuntary cancellation, and is probably the single
  // most likely thing here to actually happen. The deduction reflects only that
  // we cannot programmatically confirm or hold it (no NDC access, no offer
  // expiry), not doubt that the member will be re-accommodated.
  //
  // An earlier draft scored it 0.6, and the executable checks caught what that
  // did: a member who asked for `lowest_cost` was handed a paid fare that
  // arrived twenty minutes earlier, because the reliability gap alone outvoted
  // being free. That is overriding a stated preference, which is precisely what
  // this guard must not do — and it also made Guard 3 unreachable, since
  // reliability always decided first. Guard 2 should nudge; Guard 3 is what
  // handles the genuinely lopsided cases.
  const reliability = alt.kind === 'carrier-protected'
    ? 0.8
    : alt.expiresAt !== null
      ? 1
      : alt.ok ? 0.75 : 0.4;

  // ── cabin ──
  const drop = Math.max(0, cabinRank(ctx.preferredCabin) - cabinRank(alt.cabin));
  const cabin = clamp01(1 - drop * 0.4);
  if (drop > 0) notes.push(`A ${drop === 1 ? 'one-class' : `${drop}-class`} downgrade from ${ctx.preferredCabin}`);

  // ── loyalty ──
  const carrier = alt.code.split(/\s+/)[0]?.toUpperCase() ?? '';
  const preferred = ctx.preferredCarriers.map((c) => c.toUpperCase());
  const loyalty = preferred.length === 0 ? 0.5 : preferred.includes(carrier) ? 1 : 0.35;
  if (preferred.includes(carrier)) notes.push(`On ${carrier}, where you hold status`);

  // ── effort ──
  // Connections are materialised into a single Alt whose code names both legs,
  // so leg count is readable straight off it.
  const legs = alt.code.includes('+') ? alt.code.split('+').length : 1;
  const overnight = alt.id.startsWith('ovn:') ? 1 : 0;
  const effort = clamp01(1 - (legs - 1) * 0.3 - overnight * 0.3);
  if (legs > 1) notes.push(`${legs - 1} connection${legs > 2 ? 's' : ''} to make`);
  if (overnight) notes.push('An overnight stay, with transfers either side');

  const parts = { arrival, cost: costScore, reliability, cabin, loyalty, effort };
  const total =
    arrival * weights.arrival +
    costScore * weights.cost +
    reliability * weights.reliability +
    cabin * weights.cabin +
    loyalty * weights.loyalty +
    effort * weights.effort;

  return {
    alt,
    cost,
    score: {
      total: round3(total),
      parts: roundAll(parts),
      weights: roundAll(weights),
      strategy: ctx.rules.strategy,
      notes,
    },
    why: '',
  };
}

/**
 * Guard 3. A free option that lands hours later than a paid one the member has
 * already authorised is not the better answer, whatever the weights say.
 *
 * Deliberately narrow: it only fires when the paid option is genuinely within
 * cap and genuinely much earlier, so it cannot be used to justify spending.
 */
function applyEarlyArrivalOverride(scored: ScoredAlt[], ctx: ScoreContext): ScoredAlt[] {
  const leader = scored[0];
  if (!leader || leader.alt.kind !== 'carrier-protected') return finalise(scored, ctx);
  if (typeof leader.alt.arrivesAt !== 'number') return finalise(scored, ctx);

  const challenger = scored.find(
    (s) =>
      s !== leader &&
      s.alt.ok &&
      !s.cost.overCap &&
      typeof s.alt.arrivesAt === 'number' &&
      leader.alt.arrivesAt! - s.alt.arrivesAt >= TIE_ARRIVAL_MINUTES * 60_000,
  );
  if (!challenger) return finalise(scored, ctx);

  const minutes = Math.round((leader.alt.arrivesAt - challenger.alt.arrivesAt!) / 60_000);
  challenger.score.notes.unshift(
    `Gets you there ${formatHours(minutes / 60)} earlier than the free option, within what you authorised`,
  );
  return finalise([challenger, ...scored.filter((s) => s !== challenger)], ctx);
}

function finalise(scored: ScoredAlt[], ctx: ScoreContext): ScoredAlt[] {
  return scored.map((s) => ({ ...s, why: explain(s, ctx) }));
}

/**
 * Leads with the axis that actually contributed most, rather than a fixed
 * template — "we chose this because it gets you there first" and "because it is
 * the only one we can confirm" are different explanations and the member
 * deserves the true one.
 */
function explain(s: ScoredAlt, ctx: ScoreContext): string {
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

  const detail = s.score.notes.slice(0, 2).join('. ');
  return `You asked us to optimise for ${STRATEGY_LABEL[ctx.rules.strategy]}, so we picked this because ${lead[contributions[0].k]}. ${detail}.`;
}

function formatHours(h: number): string {
  if (h < 1) return `${Math.round(h * 60)} min`;
  return `${h.toFixed(1)} h`;
}

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

function round3(v: number) {
  return Math.round(v * 1000) / 1000;
}

function roundAll<T extends Record<string, number>>(o: T): T {
  const out = {} as T;
  for (const k of Object.keys(o) as (keyof T)[]) out[k] = round3(o[k] as number) as T[keyof T];
  return out;
}
