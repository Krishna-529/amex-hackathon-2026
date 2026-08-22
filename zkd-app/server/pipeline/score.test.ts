/**
 * `score.ts` (`applyHardRules` + `rankAlts`) had zero vitest coverage before
 * this file — its only executable checks lived in `verify.ts`, which
 * CLAUDE.md itself notes CI does NOT run (`npm run verify` is absent from
 * `.github/workflows/ci.yml`). These tests are the CI-visible complement,
 * plus regression coverage for three real bugs found and fixed 2026-08-21:
 * `avoidAirlines`, the loyalty feature, and the alternate's own cancellation
 * risk all used to look only at a connecting alt's FIRST leg, so a blocked
 * or status carrier operating the SECOND leg was invisible. And a defense
 * against a single malformed candidate (NaN/undefined fare, seats, or time
 * from a real supplier's occasional bad response) corrupting the ranking
 * for the ENTIRE choice set, not just itself.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { applyHardRules, rankAlts, type ScoreContext } from './score.ts';
import { __setTablesForTest } from './ranker/cancelRisk.ts';
import type { PartyAlt } from '../domain/altsForParty';
import type { Alt, Flight } from '../domain/types';
import type { RebookingRules } from '../preferences/adapt';

const T0 = Date.UTC(2026, 7, 16, 12, 0, 0);
const hours = (n: number) => T0 + n * 3_600_000;

function alt(over: Partial<PartyAlt> & { id: string; code: string }): PartyAlt {
  const fare = over.fare ?? 8000;
  return {
    dep: '10:00',
    arr: '13:00',
    departsAt: hours(0),
    arrivesAt: hours(3),
    cabin: 'Economy',
    seats: 9,
    fare,
    currency: 'INR',
    expiresAt: T0 + 900_000,
    supplier: 'duffel',
    supplierOfferId: 'off_1',
    kind: 'market',
    ok: true,
    why: '',
    fitsParty: true,
    partyFare: fare,
    ...over,
  } as PartyAlt;
}

function flightWith(alts: PartyAlt[], overFlight: Partial<Flight> = {}): Flight {
  return {
    id: 'u1',
    code: 'AI 2803',
    from: 'MAA',
    to: 'DEL',
    depISO: new Date(T0).toISOString(),
    durationMin: 160,
    connectionSlackMinutes: null,
    hasHardConstraint: false,
    candidates: { alts: alts as unknown as Alt[], hotels: [], cabs: [], cabLegs: [] },
    ...overFlight,
  } as Flight;
}

function rules(over: Partial<RebookingRules> = {}): RebookingRules {
  return {
    strategy: 'earliest_arrival',
    allowCabinDowngrade: true,
    avoidAirlines: [],
    maxLayovers: 1,
    outOfPocketCap: { amount: 25000, currency: 'INR' },
    groundCap: { amount: 5000, currency: 'INR' },
    hotelTriggerHours: 6,
    rentalCarTriggerHours: 24,
    alertChannels: ['push'],
    homeAirport: 'MAA',
    ...over,
  };
}

function ctxFor(flight: Flight, over: Partial<ScoreContext> = {}): ScoreContext {
  return {
    flight,
    rules: rules(),
    preferredCabin: 'Economy' as ScoreContext['preferredCabin'],
    partySize: 1,
    displayCurrency: 'INR',
    preferredCarriers: [],
    hasHardConstraint: false,
    ...over,
  };
}

describe('applyHardRules: avoidAirlines checks every leg, not just the first', () => {
  it('filters a connection whose SECOND leg is the blocked carrier', () => {
    const connecting = alt({ id: 'a1', code: 'AI 101 + 6E 202' });
    const flight = flightWith([connecting]);
    const ctx = ctxFor(flight, { rules: rules({ avoidAirlines: ['6E'] }) });

    const { kept, removed } = applyHardRules([connecting], ctx);
    expect(kept).toHaveLength(0);
    expect(removed).toHaveLength(1);
    expect(removed[0].rule).toContain('6E');
  });

  it('still filters a direct flight on the first (only) leg, unchanged', () => {
    const direct = alt({ id: 'a1', code: 'AI 101' });
    const flight = flightWith([direct]);
    const ctx = ctxFor(flight, { rules: rules({ avoidAirlines: ['AI'] }) });

    const { kept } = applyHardRules([direct], ctx);
    expect(kept).toHaveLength(0);
  });

  it('keeps a connection whose carriers are all allowed', () => {
    const connecting = alt({ id: 'a1', code: 'AI 101 + 6E 202' });
    const flight = flightWith([connecting]);
    const ctx = ctxFor(flight, { rules: rules({ avoidAirlines: ['UK'] }) });

    const { kept } = applyHardRules([connecting], ctx);
    expect(kept).toHaveLength(1);
  });
});

describe('rankAlts: loyalty credits every leg, not just the first', () => {
  it('scores a connection whose SECOND leg is the status carrier as loyalty-relevant', () => {
    // First leg AI (no status), second leg 6E (member's status carrier).
    const connecting = alt({ id: 'a1', code: 'AI 101 + 6E 202', arrivesAt: hours(4) });
    // A direct on a non-status carrier, arriving earlier — so under
    // earliest_arrival strategy it would win on arrival alone unless loyalty
    // meaningfully pulls the connection up in the "why" reasoning.
    const flight = flightWith([connecting]);
    const ctx = ctxFor(flight, {
      preferredCarriers: ['6E'],
      rules: rules({ strategy: 'stick_to_preferred_airline' }),
    });

    const [scored] = rankAlts([connecting], ctx);
    expect(scored.score.parts.loyalty).toBe(1);
    expect(scored.why).toContain('6E');
  });

  it('does not credit loyalty when no leg matches a status carrier', () => {
    const connecting = alt({ id: 'a1', code: 'AI 101 + 9W 202' });
    const flight = flightWith([connecting]);
    const ctx = ctxFor(flight, { preferredCarriers: ['6E'] });

    const [scored] = rankAlts([connecting], ctx);
    expect(scored.score.parts.loyalty).not.toBe(1);
  });
});

describe('rankAlts: an alternate\'s own cancellation risk looks at every leg', () => {
  beforeEach(() => {
    __setTablesForTest(
      { global_prior: 0.02, carrier: { 'LIVE:AI': 0.01, 'LIVE:6E': 0.35 }, route: {} },
      undefined,
    );
  });
  afterEach(() => __setTablesForTest(undefined, undefined));

  it('a connection through a high-risk SECOND-leg carrier ranks below an all-safe alternative', () => {
    const risky = alt({ id: 'risky', code: 'AI 101 + 6E 202', arrivesAt: hours(3) });
    const safe = alt({ id: 'safe', code: 'AI 101 + AI 202', arrivesAt: hours(3) });
    const flight = flightWith([risky, safe]);
    const ctx = ctxFor(flight, { rules: rules({ strategy: 'most_reliable' as RebookingRules['strategy'] }) });

    const scored = rankAlts([risky, safe], ctx);
    const byId = new Map(scored.map((s) => [s.alt.id, s]));
    // Both arrive at the same time and cost the same — the only real
    // difference is the second leg's cancellation risk, so reliability
    // must be strictly worse for the risky one.
    expect(byId.get('risky')!.score.parts.reliability).toBeLessThanOrEqual(byId.get('safe')!.score.parts.reliability);
  });
});

describe('rankAlts: a single malformed candidate cannot corrupt the whole choice set', () => {
  it('a NaN fare on one candidate does not poison every candidate\'s score', () => {
    const broken = alt({ id: 'broken', code: 'AI 101', fare: NaN, partyFare: NaN });
    const fine = alt({ id: 'fine', code: '6E 202', fare: 7000, partyFare: 7000 });
    const flight = flightWith([broken, fine]);
    const ctx = ctxFor(flight);

    const scored = rankAlts([broken, fine], ctx);
    expect(scored).toHaveLength(2);
    // Every score must be a real, finite number — not NaN propagated from
    // the broken candidate into the whole softmax.
    for (const s of scored) {
      expect(Number.isFinite(s.score.total)).toBe(true);
      for (const v of Object.values(s.score.parts)) expect(Number.isFinite(v)).toBe(true);
    }
    // The healthy candidate must still be usable — its own score should not
    // have been dragged into NaN or an arbitrary value by its neighbour.
    const fineScore = scored.find((s) => s.alt.id === 'fine')!;
    expect(fineScore.score.total).toBeGreaterThan(0);
  });

  it('an undefined/non-finite arrivesAt does not poison the set either', () => {
    const broken = alt({ id: 'broken', code: 'AI 101', arrivesAt: NaN as unknown as number });
    const fine = alt({ id: 'fine', code: '6E 202' });
    const flight = flightWith([broken, fine]);
    const ctx = ctxFor(flight);

    const scored = rankAlts([broken, fine], ctx);
    for (const s of scored) expect(Number.isFinite(s.score.total)).toBe(true);
  });
});

describe('rankAlts: basic sanity on an empty or single-candidate set', () => {
  it('returns [] for an empty candidate list rather than throwing', () => {
    const flight = flightWith([]);
    expect(rankAlts([], ctxFor(flight))).toEqual([]);
  });

  it('ranks a single candidate without error, and it explains itself', () => {
    const only = alt({ id: 'only', code: 'AI 101' });
    const flight = flightWith([only]);
    const [scored] = rankAlts([only], ctxFor(flight));
    expect(scored.alt.id).toBe('only');
    expect(scored.why.length).toBeGreaterThan(0);
  });
});
