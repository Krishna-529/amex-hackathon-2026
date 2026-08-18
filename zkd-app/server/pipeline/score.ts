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

/** Beyond this much later than the best available arrival, everything scores 0. */
const ARRIVAL_HORIZON_HOURS = 12;

/**
 * The smallest price gap allowed to saturate the cost scale, as a fraction of
 * the cheapest option on the table.
 *
 * Normalising cost across the candidate range has one failure mode, and the
 * executable checks caught it: when every fare is nearly the same, dividing by
 * the range magnifies a trivial difference into a full-scale signal. Two
 * options ₹100 apart on a ₹7,000 fare would score 1.0 and 0.0 on cost — enough
 * to outvote reliability and hand the member the option we cannot confirm, over
 * 1.4% of the price.
 *
 * So the denominator has a floor. Below a 10% spread, cost still ranks in the
 * right direction but stops being decisive, which is the honest reading: a
 * rounding difference is not a reason to choose a worse itinerary.
 */
const MATERIAL_SPREAD_FRACTION = 0.1;

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

  // "I must be there by X" is the thing the member is actually trying to
  // achieve, so an option that misses it is disqualified, not discounted — a
  // weighted sum must never be able to hand someone a cheap flight that lands
  // after the event they were flying to. Unknown arrival times are NOT removed:
  // we cannot prove they miss the deadline, and silently dropping every option
  // from a source that publishes no arrival time would be worse than ranking
  // them (score() already scores an unknown arrival neutrally).
  const deadline = ctx.flight.hardDeadlineISO ? Date.parse(ctx.flight.hardDeadlineISO) : NaN;

  for (const a of alts) {
    const carrier = a.code.split(/\s+/)[0]?.toUpperCase() ?? '';

    if (ctx.rules.avoidAirlines.includes(carrier)) {
      removed.push({ id: a.id, code: a.code, rule: `you asked us never to book ${carrier}` });
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

export function rankAlts(alts: PartyAlt[], ctx: ScoreContext): ScoredAlt[] {
  if (alts.length === 0) return [];

  const weights = weightsFor(ctx.rules.strategy, { hasHardConstraint: ctx.hasHardConstraint });

  const arrivals = alts.map((a) => a.arrivesAt).filter((n): n is number => typeof n === 'number');
  const bestArrival = arrivals.length ? Math.min(...arrivals) : null;

  // Cost is relative to what is actually on the table, so the range has to be
  // known before any single option can be scored.
  const totals = alts.map((a) =>
    costFor(ctx.flight, { chosenAltId: a.id, chosenHotelId: '', chosenCabId: '' }, ctx.partySize, ctx.displayCurrency).total,
  );
  const band = { min: Math.min(...totals), max: Math.max(...totals) };

  const scored = alts.map((a) => score(a, ctx, weights, bestArrival, band));
  scored.sort((x, y) => y.score.total - x.score.total);

  return finalise(scored, ctx);
}

function score(
  alt: PartyAlt,
  ctx: ScoreContext,
  weights: Weights,
  bestArrival: number | null,
  band: { min: number; max: number },
): ScoredAlt {
  const notes: string[] = [];
  const cost = costFor(
    ctx.flight,
    { chosenAltId: alt.id, chosenHotelId: '', chosenCabId: '' },
    ctx.partySize,
    ctx.displayCurrency,
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
  //
  // Scored against the spread of prices actually on the table rather than
  // against a fixed ceiling. When every candidate costs about the same, `span`
  // collapses and cost stops discriminating — which is correct: a ₹200
  // difference should not decide a member's day, and a fixed denominator would
  // have let it.
  const span = Math.max(band.max - band.min, band.min * MATERIAL_SPREAD_FRACTION);
  const costScore = span <= 0 ? 1 : clamp01(1 - (cost.total - band.min) / span);
  if (cost.total <= band.min) {
    notes.push('Cheapest of everything we found');
  } else {
    notes.push(`${formatMoneyish(cost.total - band.min, cost.currency)} more than the cheapest option`);
  }
  if (alt.quoted) {
    notes.push(
      `Quoted by the supplier as ${alt.quoted.amount} ${alt.quoted.currency}, converted at market rates`,
    );
  }

  // ── reliability ──
  //
  // Can we actually book this? An offer carrying a real expiry came from a
  // supplier willing to honour a price for a stated period, which is the
  // strongest signal of bookability available without attempting the booking.
  // No expiry means generated or scraped inventory: worth showing, worth
  // ranking, not worth trusting equally.
  //
  // RELIABILITY_FLOOR in presets.ts holds this term's weight above zero under
  // every strategy, so "lowest cost" can never talk the agent into an option it
  // cannot book.
  const reliability = alt.expiresAt !== null ? 1 : alt.ok ? 0.75 : 0.4;

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

function round3(v: number) {
  return Math.round(v * 1000) / 1000;
}

function roundAll<T extends Record<string, number>>(o: T): T {
  const out = {} as T;
  for (const k of Object.keys(o) as (keyof T)[]) out[k] = round3(o[k] as number) as T[keyof T];
  return out;
}
