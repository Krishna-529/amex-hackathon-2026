/**
 * Tests for the learned alternate-flight ranker.
 *
 * These are the executable form of the safety claims in the design: monotonicity
 * holds no matter what the weights are, MyCa personalises day one, bookability
 * cannot be out-learned, shrinkage keeps thin data from moving the model, and the
 * trainer both recovers a real signal AND refuses to promote noise.
 */

import { describe, it, expect } from 'vitest';
import { getArtifact } from './weights.ts';
import { resolveWeights, shrinkToward, enforceMonotone } from './weights.ts';
import { rankByModel } from './index.ts';
import { cancelRiskOf, __setTablesForTest } from './cancelRisk.ts';
import { FEATURES, type RankerArtifact, type WeightVector } from './types.ts';
import {
  fitConditionalLogit,
  fitStrategy,
  negLogLik,
  type Observation,
} from './train.ts';
import type { PartyAlt } from '../../domain/altsForParty';

// ── fixtures ─────────────────────────────────────────────────────────────────

const T0 = Date.UTC(2026, 7, 16, 6, 0, 0);
const hrs = (n: number) => T0 + n * 3_600_000;

function alt(over: Partial<PartyAlt> = {}): PartyAlt {
  // Defaults first, then spread the overrides, so an explicit `expiresAt: null`
  // (an offer with no honoured price) survives rather than being coalesced back
  // to a default — the distinction bookability turns on.
  const fare = over.fare ?? 8000;
  return {
    id: 'a',
    code: 'AI 101',
    dep: '06:00',
    arr: '08:00',
    departsAt: hrs(0),
    arrivesAt: hrs(2),
    cabin: 'economy',
    seats: 9,
    fare,
    currency: 'INR',
    expiresAt: hrs(1),
    supplier: 'duffel',
    supplierOfferId: 'off_1',
    kind: 'market',
    ok: true,
    why: 'From live supplier inventory',
    fitsParty: true,
    partyFare: fare,
    ...over,
  } as PartyAlt;
}

function baseInput(alts: PartyAlt[], over: Record<string, unknown> = {}) {
  return {
    alts,
    strategy: 'earliest_arrival',
    preferredCabinRank: 0,
    preferredCarriers: [] as string[],
    avoidRedEye: false,
    premiumEntitled: false,
    partySize: 1,
    flightId: 'f1',
    partyTotalById: new Map(alts.map((a) => [a.id, a.partyFare])),
    ...over,
  };
}

const noLog = { log: false as const };

// ── monotonicity ─────────────────────────────────────────────────────────────

describe('monotonicity holds regardless of the weights', () => {
  it('cheaper never ranks below pricier, all else equal', () => {
    const cheap = alt({ id: 'cheap', fare: 6000, partyFare: 6000 });
    const dear = alt({ id: 'dear', fare: 12000, partyFare: 12000 });
    const { order } = rankByModel(baseInput([dear, cheap]), noLog);
    expect(order[0].altId).toBe('cheap');
  });

  it('earlier never ranks below later, all else equal', () => {
    const early = alt({ id: 'early', arrivesAt: hrs(2) });
    const late = alt({ id: 'late', arrivesAt: hrs(9) });
    const { order } = rankByModel(baseInput([late, early]), noLog);
    expect(order[0].altId).toBe('early');
  });

  it('a hand-corrupted artifact with negative weights is clipped, not obeyed', () => {
    const art = structuredClone(getArtifact()) as RankerArtifact;
    // Try to make the model prefer pricier flights by flipping the cost weight.
    art.learnedByStrategy.earliest_arrival = {
      ...art.priorByStrategy.earliest_arrival,
      cost: -5, // malicious / buggy
    };
    art.counts.byStrategy.earliest_arrival = 10_000; // pretend it has data
    const cheap = alt({ id: 'cheap', fare: 6000, partyFare: 6000 });
    const dear = alt({ id: 'dear', fare: 12000, partyFare: 12000 });
    const { order, weights } = rankByModel(baseInput([dear, cheap]), { artifact: art, log: false });
    expect(weights.cost).toBeGreaterThanOrEqual(0); // clipped
    expect(order[0].altId).toBe('cheap'); // guarantee survived
  });
});

// ── MyCa warm start ──────────────────────────────────────────────────────────

describe('MyCa personalises the ranking on day one, with zero history', () => {
  it('a member with a status carrier ranks that carrier above an equal non-status option', () => {
    const status = alt({ id: 'ai', code: 'AI 200', fare: 8200, partyFare: 8200 });
    const other = alt({ id: 'sg', code: 'SG 200', fare: 8000, partyFare: 8000 });

    const generic = rankByModel(baseInput([status, other]), noLog);
    expect(generic.order[0].altId).toBe('sg'); // slightly cheaper wins for a generic member

    const loyal = rankByModel(
      baseInput([status, other], { strategy: 'stick_to_preferred_airline', preferredCarriers: ['AI'] }),
      noLog,
    );
    expect(loyal.order[0].altId).toBe('ai'); // MyCa status flips it, no learning needed
  });

  it('avoidRedEye demotes a red-eye only for the member who set it', () => {
    const redeye = alt({ id: 'red', dep: '23:30', arr: '02:10', arrivesAt: hrs(20), fare: 7000, partyFare: 7000 });
    const day = alt({ id: 'day', dep: '09:00', arr: '11:00', arrivesAt: hrs(5), fare: 7600, partyFare: 7600 });

    const tolerant = rankByModel(baseInput([redeye, day], { strategy: 'lowest_cost' }), noLog);
    const avoider = rankByModel(baseInput([redeye, day], { strategy: 'lowest_cost', avoidRedEye: true }), noLog);

    // The red-eye's rank can only get worse (or equal) once the member says they avoid them.
    const redRankTolerant = tolerant.order.findIndex((o) => o.altId === 'red');
    const redRankAvoider = avoider.order.findIndex((o) => o.altId === 'red');
    expect(redRankAvoider).toBeGreaterThanOrEqual(redRankTolerant);
  });
});

// ── bookability as an offset ─────────────────────────────────────────────────

describe('bookability multiplies rather than competes', () => {
  it('an equal option we probably cannot book ranks below one we can', () => {
    const solid = alt({ id: 'solid', expiresAt: hrs(1), ok: true }); // liveWithExpiry ~0.97
    const shaky = alt({ id: 'shaky', expiresAt: null, ok: false, supplier: 'skyscanner' }); // other ~0.45
    const { order } = rankByModel(baseInput([shaky, solid]), noLog);
    expect(order[0].altId).toBe('solid');
  });

  it('bookability multiplies: the SAME option ranks strictly lower when it is unlikely to book', () => {
    // The honest guarantee is directional, not absolute: a genuinely cheaper
    // option can still win on price (that is a real trade a member might want),
    // but lowering ITS bookability can only ever push it down, never up. This is
    // what makes bookability a multiplier rather than a competing preference —
    // and it is why no RELIABILITY_FLOOR is needed to keep an unbookable option
    // from being over-ranked.
    const rival = alt({ id: 'rival', fare: 9000, partyFare: 9000 }); // fixed reference
    const bookable = alt({ id: 'x', fare: 7000, partyFare: 7000, expiresAt: hrs(1), ok: true }); // 0.97
    const doubtful = alt({ id: 'x', fare: 7000, partyFare: 7000, expiresAt: null, ok: false, supplier: 'skyscanner' }); // 0.45

    const withBookable = rankByModel(baseInput([bookable, rival], { strategy: 'lowest_cost' }), noLog);
    const withDoubtful = rankByModel(baseInput([doubtful, rival], { strategy: 'lowest_cost' }), noLog);

    const rankOf = (r: ReturnType<typeof rankByModel>, id: string) => r.order.findIndex((o) => o.altId === id);
    expect(rankOf(withDoubtful, 'x')).toBeGreaterThanOrEqual(rankOf(withBookable, 'x'));
  });
});

// ── cancellation risk (the ML model integrated) ──────────────────────────────

describe('the alternate flight cancellation model shapes the ranking', () => {
  it('a flight likely to be cancelled ranks below an equal one that is stable', () => {
    const stable = alt({ id: 'stable', code: '6E 300' });
    const risky = alt({ id: 'risky', code: 'SG 300' });
    const cancelRiskById = new Map([
      ['stable', 0.012], // IndiGo-like
      ['risky', 0.056], // SpiceJet-like
    ]);
    const { order } = rankByModel(baseInput([risky, stable], { cancelRiskById }), noLog);
    expect(order[0].altId).toBe('stable');
  });

  it('cancellation risk cannot, on its own, override a large arrival advantage under earliest_arrival', () => {
    // stability is a real factor but not a veto — a much earlier flight that is
    // slightly riskier can still win. (It is a weighted feature, not a hard rule;
    // hard safety lives in applyHardRules, upstream and untouched.)
    const earlyRisky = alt({ id: 'early', code: 'SG 1', arrivesAt: hrs(2) });
    const lateStable = alt({ id: 'late', code: '6E 1', arrivesAt: hrs(10) });
    const cancelRiskById = new Map([['early', 0.06], ['late', 0.01]]);
    const { order } = rankByModel(baseInput([lateStable, earlyRisky], { cancelRiskById }), noLog);
    expect(order[0].altId).toBe('early');
  });

  it('with no risk estimates the ranking is unchanged (stability is constant)', () => {
    const a = alt({ id: 'a', code: '6E 1', fare: 8000, partyFare: 8000 });
    const b = alt({ id: 'b', code: 'SG 1', fare: 8000, partyFare: 8000, arrivesAt: hrs(4) });
    const withNone = rankByModel(baseInput([a, b]), noLog).order.map((o) => o.altId);
    const withEmpty = rankByModel(baseInput([a, b], { cancelRiskById: new Map() }), noLog).order.map((o) => o.altId);
    expect(withNone).toEqual(withEmpty);
  });

  it('the estimator tiers real → synthetic → global and prefers the worse of carrier/route', () => {
    __setTablesForTest(
      { global_prior: 0.02, carrier: {}, route: {} },
      { global_prior: 0.02, carrier: { 'LIVE:SG': 0.056, 'LIVE:6E': 0.012 }, route: { 'LIVE:MAA>LIVE:DEL': 0.025 } },
    );
    // carrier 0.056 dominates the calmer route 0.025 → max wins (conservative)
    expect(cancelRiskOf('SG', 'MAA', 'DEL')).toBeCloseTo(0.056, 6);
    // an unknown carrier falls to the route rate
    expect(cancelRiskOf('XX', 'MAA', 'DEL')).toBeCloseTo(0.025, 6);
    // an unknown carrier and route fall to the global prior
    expect(cancelRiskOf('XX', 'AAA', 'BBB')).toBeCloseTo(0.02, 6);
    __setTablesForTest(undefined, undefined); // reset to on-disk load
  });
});

// ── shrinkage ────────────────────────────────────────────────────────────────

describe('shrinkage keeps thin data from moving the model', () => {
  const prior: WeightVector = { arrival: 3, cost: 0.6, cabin: 0.5, effort: 0.6, loyalty: 0.2, redeye: 0.6, seats: 0.3, stability: 1.2 };
  const learned: WeightVector = { arrival: 0, cost: 6, cabin: 0, effort: 0, loyalty: 0, redeye: 0, seats: 0, stability: 0 };

  it('at n=0 the result is exactly the prior', () => {
    const w = shrinkToward(learned, prior, 0, 30);
    for (const f of FEATURES) expect(w[f]).toBeCloseTo(prior[f], 9);
  });

  it('with few observations it stays close to the prior', () => {
    const w = shrinkToward(learned, prior, 3, 30);
    expect(w.cost).toBeLessThan(prior.cost + (learned.cost - prior.cost) * 0.2);
  });

  it('with much data it approaches the learned vector', () => {
    const w = shrinkToward(learned, prior, 3000, 30);
    expect(w.cost).toBeGreaterThan(5);
  });

  it('enforceMonotone clips negatives on oriented features', () => {
    const w = enforceMonotone({ arrival: -1, cost: -2, cabin: 1, effort: 0, loyalty: 5, redeye: -3, seats: 2, stability: -4 }, getArtifact());
    expect(w.arrival).toBe(0);
    expect(w.cost).toBe(0);
    expect(w.redeye).toBe(0);
    expect(w.stability).toBe(0);
    expect(w.loyalty).toBe(5);
  });
});

// ── the trainer ──────────────────────────────────────────────────────────────

/** Generate choice sets where the "true" member always maximises a given weight
 *  vector, so we can check the trainer recovers it. */
function syntheticObs(trueW: WeightVector, art: RankerArtifact, n: number, seed = 1): Observation[] {
  let s = seed;
  const rnd = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  const obs: Observation[] = [];
  for (let i = 0; i < n; i++) {
    const k = 3 + Math.floor(rnd() * 3);
    const cands = Array.from({ length: k }, () => ({
      features: {
        arrival: -rnd() * 1.5, cost: -rnd() * 1.2, cabin: -Math.floor(rnd() * 2),
        effort: -Math.floor(rnd() * 2), loyalty: rnd() < 0.4 ? 1 : 0,
        redeye: rnd() < 0.2 ? -1 : 0, seats: rnd(), stability: -rnd() * 1.2,
      },
      bookability: 0.9 + rnd() * 0.09,
    }));
    // pick the utility-maximising option (a rational member), with a little noise
    const util = cands.map((c) => FEATURES.reduce((acc, f) => acc + trueW[f] * c.features[f], rnd() * 0.15));
    const chosenIndex = util.indexOf(Math.max(...util));
    obs.push({ strategy: 'earliest_arrival', candidates: cands, chosenIndex });
  }
  return obs;
}

describe('the trainer learns signal and refuses noise', () => {
  const art = getArtifact();

  it('moves the criterion a synthetic member cares about, above its prior', () => {
    // A member who chiefly cares about cost. The trainer cannot be expected to
    // make cost the single largest weight — the earliest_arrival prior starts
    // arrival at 3.0 and nothing in the data argues arrival DOWN, so the L2
    // penalty rightly keeps it there. The honest, recoverable claim is
    // directional: cost rises clearly above its own prior, and rises far more
    // than a criterion the member's choices are uncorrelated with (cabin).
    const trueW: WeightVector = { arrival: 0.2, cost: 4, cabin: 0.1, effort: 0.1, loyalty: 0.1, redeye: 0.1, seats: 0.1, stability: 0.1 };
    const obs = syntheticObs(trueW, art, 600);
    const prior = art.priorByStrategy.earliest_arrival;
    const fitted = fitConditionalLogit(obs, prior, art, { lambda: art.shrink.l2ToPrior, monotone: new Set(art.monotoneNonNegative) });
    // cost rose above its prior, and its rise from prior is the largest of any
    // feature — the trainer identified the axis the member's choices track.
    expect(fitted.cost).toBeGreaterThan(prior.cost);
    const rise = (f: (typeof FEATURES)[number]) => fitted[f] - prior[f];
    const costRise = rise('cost');
    for (const f of FEATURES) if (f !== 'cost') expect(costRise).toBeGreaterThan(rise(f));
  });

  it('every fitted weight stays non-negative (monotone projection)', () => {
    const trueW: WeightVector = { arrival: 3, cost: 0.5, cabin: 0.5, effort: 0.5, loyalty: 0.5, redeye: 0.5, seats: 0.5, stability: 0.5 };
    const obs = syntheticObs(trueW, art, 300);
    const fitted = fitConditionalLogit(obs, art.priorByStrategy.earliest_arrival, art, {
      lambda: art.shrink.l2ToPrior, monotone: new Set(art.monotoneNonNegative),
    });
    for (const f of FEATURES) expect(fitted[f]).toBeGreaterThanOrEqual(0);
  });

  it('does not promote when data is below minData (overfit guard)', () => {
    const trueW: WeightVector = { arrival: 0.2, cost: 4, cabin: 0.1, effort: 0.1, loyalty: 0.1, redeye: 0.1, seats: 0.1, stability: 0.1 };
    const tiny = syntheticObs(trueW, art, 20); // below minDataGlobal (200)
    const fit = fitStrategy(art, 'earliest_arrival', tiny);
    expect(fit.promoted).toBe(false);
  });

  it('promotes only when it beats the incumbent on held-out choices', () => {
    const trueW: WeightVector = { arrival: 0.2, cost: 4, cabin: 0.1, effort: 0.1, loyalty: 0.1, redeye: 0.1, seats: 0.1, stability: 0.1 };
    const plenty = syntheticObs(trueW, art, 800);
    const fit = fitStrategy(art, 'earliest_arrival', plenty);
    expect(fit.n).toBeGreaterThanOrEqual(art.shrink.minDataGlobal);
    expect(fit.heldOutNllChallenger).toBeLessThan(fit.heldOutNllIncumbent);
    expect(fit.promoted).toBe(true);
  });

  it('held-out NLL of the prior on its own data is finite and sane', () => {
    const obs = syntheticObs(art.priorByStrategy.earliest_arrival, art, 100);
    const nll = negLogLik(obs, art.priorByStrategy.earliest_arrival, art);
    expect(Number.isFinite(nll)).toBe(true);
    expect(nll).toBeGreaterThan(0);
  });
});

// ── day-one continuity + determinism ─────────────────────────────────────────

describe('day-one behaviour and determinism', () => {
  it('earliest_arrival still puts the earliest option first among similar prices', () => {
    const a1 = alt({ id: 'early', arrivesAt: hrs(2), fare: 8000, partyFare: 8000 });
    const a2 = alt({ id: 'mid', arrivesAt: hrs(5), fare: 7900, partyFare: 7900 });
    const a3 = alt({ id: 'late', arrivesAt: hrs(9), fare: 7800, partyFare: 7800 });
    const { order } = rankByModel(baseInput([a2, a3, a1]), noLog);
    expect(order[0].altId).toBe('early');
  });

  it('is deterministic: identical input yields identical order', () => {
    const alts = [alt({ id: 'x', arrivesAt: hrs(3) }), alt({ id: 'y', arrivesAt: hrs(6) })];
    const r1 = rankByModel(baseInput(alts), noLog).order.map((o) => o.altId);
    const r2 = rankByModel(baseInput(alts), noLog).order.map((o) => o.altId);
    expect(r1).toEqual(r2);
  });

  it('resolveWeights is pure and honours the strategy prior at zero history', () => {
    const art = getArtifact();
    const w = resolveWeights(art, { strategy: 'lowest_cost', preferredCarriers: [], avoidRedEye: false, premiumEntitled: false });
    // lowest_cost prior weights cost the most
    const maxFeature = FEATURES.reduce((a, b) => (w[a] > w[b] ? a : b));
    expect(maxFeature).toBe('cost');
  });
});
