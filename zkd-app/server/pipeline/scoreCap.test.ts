/**
 * Regressions for the cap contradiction between score.ts and pricing.ts.
 *
 * A cap of zero used to mean two opposite things inside a single `score()`
 * call: `score.ts` read `cap.amount <= 0` as "no cap, perfect cost score",
 * while `costFor` computed `overCap: total > cap.amount`, which is true for
 * every paid option when the cap is 0. So an option could be scored as
 * maximally affordable and flagged as over the limit at the same time.
 *
 * This is reachable, not theoretical: `capOf(undefined)` in
 * preferences/adapt.ts returns exactly `{amount: 0}` for any profile that
 * states no out-of-pocket limit.
 *
 * These live in vitest rather than server/pipeline/verify.ts because CI runs
 * `vitest run` and does not run `npm run verify`.
 */
import { describe, test, expect } from 'vitest';
import { rankAlts, type ScoreContext } from './score';
import type { RebookingRules } from '../preferences/adapt';
import type { PartyAlt } from '../domain/altsForParty';
import type { Alt, Flight } from '../domain/types';

const T0 = Date.UTC(2026, 7, 16, 12, 0, 0);
const hours = (n: number) => T0 + n * 3_600_000;

function alt(over: Partial<PartyAlt> & { id: string; code: string }): PartyAlt {
  return {
    dep: '10:00', arr: '13:00',
    departsAt: hours(0), arrivesAt: hours(3),
    cabin: 'Economy', seats: 9,
    fare: 8000, currency: 'INR',
    expiresAt: T0 + 900_000,
    kind: 'market', ok: true, why: '',
    fitsParty: true, partyFare: 8000,
    ...over,
  } as PartyAlt;
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

function ctxFor(alts: PartyAlt[], over: Partial<ScoreContext> = {}): ScoreContext {
  return {
    flight: {
      id: 'u1', code: 'AI 2803', from: 'MAA', to: 'DEL',
      depISO: new Date(T0).toISOString(),
      durationMin: 160,
      connectionSlackMinutes: null,
      hasHardConstraint: false,
      candidates: { alts: alts as unknown as Alt[], hotels: [], cabs: [], cabLegs: [] },
    } as Flight,
    rules: rules(),
    preferredCabin: 'Economy',
    partySize: 1,
    cap: { amount: 25000, currency: 'INR' },
    preferredCarriers: ['AI'],
    hasHardConstraint: false,
    ...over,
  };
}

const NO_CAP = { amount: 0, currency: 'INR' };

describe('a cap of zero means no headroom, not unlimited', () => {
  test('a paid option does not score a perfect cost part when the cap is zero', () => {
    const paid = alt({ id: 'p', code: 'AI 202', fare: 8000, partyFare: 8000 });
    const ranked = rankAlts([paid], ctxFor([paid], { cap: NO_CAP }));

    // The bug: this was 1 — the best possible cost score — for an option the
    // pricer was simultaneously flagging as over the cap.
    expect(ranked[0].score.parts.cost).toBe(0);
    expect(ranked[0].cost.overCap).toBe(true);
  });

  test('an option that costs nothing still scores a perfect cost part', () => {
    const free = alt({ id: 'f', code: 'AI 303', fare: 0, partyFare: 0, kind: 'carrier-protected' });
    const ranked = rankAlts([free], ctxFor([free], { cap: NO_CAP }));

    expect(ranked[0].score.parts.cost).toBe(1);
    expect(ranked[0].cost.overCap).toBe(false);
  });

  test('the cost part separates free from paid instead of tying them', () => {
    // Both arrive at the same moment, so cost is the only axis that can move.
    const free = alt({ id: 'f', code: 'AI 303', fare: 0, partyFare: 0, kind: 'carrier-protected', arrivesAt: hours(4) });
    const paid = alt({ id: 'p', code: '6E 404', fare: 8000, partyFare: 8000, arrivesAt: hours(4) });

    const ranked = rankAlts([free, paid], ctxFor([free, paid], { cap: NO_CAP }));
    const costParts = ranked.map((r) => r.score.parts.cost);

    // Previously both were 1 and the cost axis carried no information at all.
    expect(new Set(costParts).size).toBe(2);
    expect(ranked[0].alt.id).toBe('f');
  });

  test('a real cap still scores on the gradient, unchanged', () => {
    const cheap = alt({ id: 'c', code: 'AI 202', fare: 2000, partyFare: 2000 });
    const dear = alt({ id: 'd', code: '6E 404', fare: 20000, partyFare: 20000 });
    const ctx = ctxFor([cheap, dear], { cap: { amount: 25000, currency: 'INR' } });

    const byId = new Map(rankAlts([cheap, dear], ctx).map((r) => [r.alt.id, r.score.parts.cost]));
    const cheapCost = byId.get('c')!;
    const dearCost = byId.get('d')!;

    expect(cheapCost).toBeGreaterThan(dearCost);
    expect(cheapCost).toBeLessThan(1);
    expect(dearCost).toBeGreaterThan(0);
  });
});
