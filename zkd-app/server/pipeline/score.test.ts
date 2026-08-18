import { describe, expect, it } from 'vitest';
import { applyHardRules, rankAlts, type ScoreContext } from './score';
import type { PartyAlt } from '../domain/altsForParty';
import type { Alt, Flight } from '../domain/types';
import type { RebookingRules } from '../preferences/adapt';
import type { OptimizationStrategy } from '../preferences/schema';

/**
 * Converted from the source branch's server/pipeline/verify.ts (a standalone
 * `node --experimental-strip-types` script) into real vitest tests — see
 * server/preferences/adapt.test.ts's header for why. The three guards on the
 * carrier-protected `fare: 0` problem are this scorer's load-bearing claims:
 * without them a member who asked for "lowest cost" is handed whatever is
 * free regardless of when it lands, because the airline-owed alternative is
 * zero-rated by construction. `fallbackNote` checks from the source script
 * are deliberately NOT converted — that function belongs to the separate
 * saga/journal system this repo does not port (see the implementation plan).
 */
const T0 = Date.UTC(2026, 7, 16, 12, 0, 0);
const hours = (n: number) => T0 + n * 3_600_000;

function alt(over: Partial<PartyAlt> & { id: string; code: string }): PartyAlt {
  return {
    dep: '10:00',
    arr: '13:00',
    departsAt: hours(0),
    arrivesAt: hours(3),
    cabin: 'Economy',
    seats: 9,
    fare: 8000,
    currency: 'INR',
    expiresAt: T0 + 900_000,
    kind: 'market',
    ok: true,
    why: '',
    fitsParty: true,
    partyFare: 8000,
    ...over,
  } as PartyAlt;
}

function flightWith(alts: PartyAlt[]): Flight {
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
  } as Flight;
}

function rules(over: Partial<RebookingRules> = {}): RebookingRules {
  return {
    strategy: 'earliest_arrival',
    allowCabinDowngrade: true,
    avoidAirlines: [],
    maxLayovers: 1,
    arrivalBeforeLocal: null,
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
    flight: flightWith(alts),
    rules: rules(),
    preferredCabin: 'Economy',
    partySize: 1,
    cap: { amount: 25000, currency: 'INR' },
    preferredCarriers: ['AI'],
    hasHardConstraint: false,
    ...over,
  };
}

describe('hard rules are filters, not penalties', () => {
  it('a blocked carrier is removed even though it arrives first, and a weighted sum cannot resurrect it', () => {
    const blocked = alt({ id: 'a1', code: 'SG 101', arrivesAt: hours(1) }); // earliest by far
    const fine = alt({ id: 'a2', code: 'AI 202', arrivesAt: hours(5) });
    const ctx = ctxFor([blocked, fine], { rules: rules({ avoidAirlines: ['SG'] }) });

    const { kept, removed } = applyHardRules([blocked, fine], ctx);
    expect(kept).toHaveLength(1);
    expect(kept[0].id).toBe('a2');
    expect(removed).toHaveLength(1);
    expect(removed[0].rule).toContain('SG');

    const ranked = rankAlts(kept, ctx);
    expect(ranked.some((r) => r.alt.id === 'a1')).toBe(false);
  });
});

describe('never split a party', () => {
  it('a party of 6 drops a 3-seat option, with a reason naming the party', () => {
    const tooSmall = alt({ id: 'a1', code: 'AI 1', arrivesAt: hours(1), fitsParty: false, seats: 3 });
    const fits = alt({ id: 'a2', code: 'AI 2', arrivesAt: hours(6) });
    const ctx = ctxFor([tooSmall, fits], { partySize: 6 });
    const { kept, removed } = applyHardRules([tooSmall, fits], ctx);
    expect(kept).toHaveLength(1);
    expect(kept[0].id).toBe('a2');
    expect(removed[0]?.rule).toContain('6');
  });
});

describe('allow_cabin_downgrade:false is a hard filter that can leave nothing', () => {
  it('drops an economy-only portfolio when downgrades are forbidden, and keeps it when allowed', () => {
    const economyOnly = alt({ id: 'a1', code: 'AI 1', cabin: 'Economy' });

    const denied = applyHardRules([economyOnly], ctxFor([economyOnly], {
      preferredCabin: 'Business',
      rules: rules({ allowCabinDowngrade: false }),
    }));
    expect(denied.kept).toHaveLength(0);
    expect(denied.removed[0]?.rule).toContain('Business');

    const allowed = applyHardRules([economyOnly], ctxFor([economyOnly], {
      preferredCabin: 'Business',
      rules: rules({ allowCabinDowngrade: true }),
    }));
    expect(allowed.kept).toHaveLength(1);
  });
});

describe('Guard 1+2: free does not automatically beat better', () => {
  it.each(['earliest_arrival', 'minimize_layovers', 'stick_to_preferred_airline'] as OptimizationStrategy[])(
    '%s: a 4h-earlier, in-cap paid option beats a free but later carrier-protected one',
    (strategy) => {
      const free = alt({ id: 'cp-1', code: 'AI 900', kind: 'carrier-protected', fare: 0, partyFare: 0, expiresAt: null, arrivesAt: hours(8) });
      const paid = alt({ id: 'm-1', code: 'AI 500', fare: 6000, partyFare: 6000, arrivesAt: hours(4) });
      const ctx = ctxFor([free, paid], { rules: rules({ strategy }) });
      const ranked = rankAlts([free, paid], ctx);
      expect(ranked[0].alt.id).toBe('m-1');
    },
  );
});

describe('Guard 3: the override backstops lopsided cases without being used when unneeded', () => {
  it('a 10h-earlier in-cap option wins despite scoring lower on the raw weighted sum, and says why', () => {
    const free = alt({ id: 'cp-1', code: 'AI 900', kind: 'carrier-protected', fare: 0, partyFare: 0, expiresAt: null, arrivesAt: hours(12) });
    const paid = alt({ id: 'm-1', code: 'AI 500', fare: 24000, partyFare: 24000, arrivesAt: hours(2) });
    const ctx = ctxFor([free, paid], { rules: rules({ strategy: 'lowest_cost' }) });
    const ranked = rankAlts([free, paid], ctx);
    expect(ranked[0].alt.id).toBe('m-1');
    expect(ranked[0].score.notes.some((n) => /earlier than the free option/.test(n))).toBe(true);
  });

  it('stays silent when plain scoring already gets it right', () => {
    const free = alt({ id: 'cp-1', code: 'AI 900', kind: 'carrier-protected', fare: 0, partyFare: 0, expiresAt: null, arrivesAt: hours(9) });
    const paid = alt({ id: 'm-1', code: 'AI 500', fare: 6000, partyFare: 6000, arrivesAt: hours(4) });
    const ranked = rankAlts([free, paid], ctxFor([free, paid], { rules: rules({ strategy: 'lowest_cost' }) }));
    expect(ranked[0].alt.id).toBe('m-1');
    expect(ranked[0].score.notes.some((n) => /earlier than the free option/.test(n))).toBe(false);
  });

  it('never fires for a merely-marginal (sub-tie-threshold) arrival gap', () => {
    const free = alt({ id: 'cp-1', code: 'AI 900', kind: 'carrier-protected', fare: 0, partyFare: 0, expiresAt: null, arrivesAt: hours(4) + 20 * 60_000 });
    const paid = alt({ id: 'm-1', code: 'AI 500', fare: 6000, partyFare: 6000, arrivesAt: hours(4) });
    const ctx = ctxFor([free, paid], { rules: rules({ strategy: 'lowest_cost' }) });
    const ranked = rankAlts([free, paid], ctx);
    expect(ranked[0].alt.id).toBe('cp-1');
  });

  it('never fires for an over-cap option, however early it arrives', () => {
    const free = alt({ id: 'cp-1', code: 'AI 900', kind: 'carrier-protected', fare: 0, partyFare: 0, expiresAt: null, arrivesAt: hours(12) });
    const pricey = alt({ id: 'm-1', code: 'AI 500', fare: 90000, partyFare: 90000, arrivesAt: hours(2) });
    const ctx = ctxFor([free, pricey], { rules: rules({ strategy: 'lowest_cost' }) });
    const ranked = rankAlts([free, pricey], ctx);
    expect(ranked[0].alt.id).toBe('cp-1');
  });
});

describe('strategy actually changes the ranking', () => {
  const fast = alt({ id: 'fast', code: '6E 1', arrivesAt: hours(2), fare: 14000, partyFare: 14000 });
  const cheap = alt({ id: 'cheap', code: '6E 2', arrivesAt: hours(7), fare: 3000, partyFare: 3000 });
  const loyal = alt({ id: 'loyal', code: 'AI 3', arrivesAt: hours(6), fare: 9000, partyFare: 9000 });
  const pick = (s: OptimizationStrategy) =>
    rankAlts([fast, cheap, loyal], ctxFor([fast, cheap, loyal], { rules: rules({ strategy: s }) }))[0].alt.id;

  it('earliest_arrival picks the fastest', () => expect(pick('earliest_arrival')).toBe('fast'));
  it('lowest_cost picks the cheapest', () => expect(pick('lowest_cost')).toBe('cheap'));
  it('stick_to_preferred_airline picks the flight on the preferred carrier', () => expect(pick('stick_to_preferred_airline')).toBe('loyal'));
});

describe('unknown arrival scores neutral, never best', () => {
  it('a source with no published arrival time does not win on arrival, and says so', () => {
    const known = alt({ id: 'k', code: 'AI 1', arrivesAt: hours(3) });
    const unknown = alt({ id: 'u', code: 'AI 2', arrivesAt: undefined, departsAt: undefined });
    const ctx = ctxFor([known, unknown], { rules: rules({ strategy: 'earliest_arrival' }) });
    const ranked = rankAlts([known, unknown], ctx);
    expect(ranked[0].alt.id).toBe('k');
    expect(ranked.find((r) => r.alt.id === 'u')!.score.notes.some((n) => /not published/.test(n))).toBe(true);
  });
});

describe('leadingCriterion (additive beyond the ported source) matches what explain() actually names', () => {
  it('names the axis that actually dominates the winning score', () => {
    const fast = alt({ id: 'fast', code: '6E 1', arrivesAt: hours(1), fare: 14000, partyFare: 14000 });
    const slow = alt({ id: 'slow', code: '6E 2', arrivesAt: hours(9), fare: 3000, partyFare: 3000 });
    const ranked = rankAlts([fast, slow], ctxFor([fast, slow], { rules: rules({ strategy: 'earliest_arrival' }) }));
    const winner = ranked[0];
    expect(winner.alt.id).toBe('fast');
    expect(winner.score.leadingCriterion).toBe('arrival');
    expect(winner.why).toContain('soonest');
  });
});
