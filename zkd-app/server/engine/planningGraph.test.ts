import { describe, expect, it } from 'vitest';
import { planRecovery } from './planningGraph';
import type { Flight, Alt, HotelOpt, CabOpt } from '../domain/types';
import type { AdaptedPreferences } from '../preferences/adapt';

function alt(overrides: Partial<Alt> = {}): Alt {
  return {
    id: 'alt-1', code: 'AI101', dep: '10:00', arr: '12:00', cabin: 'Economy',
    seats: 4, fare: 0, currency: 'INR', expiresAt: null, kind: 'carrier-protected',
    ok: true, why: 'owed by the carrier', ...overrides,
  };
}

function hotel(overrides: Partial<HotelOpt> = {}): HotelOpt {
  return {
    id: 'htl-1', name: 'Test Hotel', area: 'Airport', checkin: '2026-01-01',
    rate: 4000, extra: 0, currency: 'INR', ok: true, why: 'nearest to the gate', walk: '5 min',
    ...overrides,
  };
}

function cab(overrides: Partial<CabOpt> = {}): CabOpt {
  return { id: 'cab-1', kind: 'sedan', seats: 4, extra: 0, currency: 'INR', ok: true, why: 'available now', ...overrides };
}

function flightWith(candidates: Partial<Flight['candidates']>): Flight {
  return {
    id: 'flt-1', code: 'AI101', from: 'MAA', to: 'DEL', depISO: new Date().toISOString(),
    durationMin: 150, connectionSlackMinutes: null, hasHardConstraint: false,
    candidates: { alts: [], hotels: [], cabs: [], cabLegs: [], ...candidates },
  };
}

const CAP = { amount: 25000, currency: 'INR' };

/** Default member-preference fixture: earliest_arrival, no hard exclusions,
 *  cabin entitlement matches every alt in these fixtures (Economy) so cabin
 *  rules never accidentally interfere with what each test is actually
 *  checking. Override `rules` per test when a case needs to. */
function defaultPreferences(rulesOverrides: Partial<AdaptedPreferences['rules']> = {}): AdaptedPreferences {
  return {
    preferences: {
      seat: 'No preference', meal: 'No preference', cabinEntitlement: 'Economy',
      preferredCarriers: [], perTransactionCap: CAP, avoidRedEye: false,
    },
    preferredCabin: 'Economy',
    consent: 'ask',
    rules: {
      strategy: 'earliest_arrival', allowCabinDowngrade: false, avoidAirlines: [], maxLayovers: 1,
      arrivalBeforeLocal: null, outOfPocketCap: null, groundCap: null,
      hotelTriggerHours: 6, rentalCarTriggerHours: 24, alertChannels: ['push'], homeAirport: '',
      ...rulesOverrides,
    },
    hotel: { accessibilityRequired: false, mustHaveAmenities: [], maxDistanceKm: 15, roomType: 'any', loyaltyChains: [] },
    ground: { providerHierarchy: ['uber'], vehicleTier: 'standard' },
  };
}

const cancelledSignal = {
  status: 'cancelled', bookedDepartureAt: Date.now(), scheduledDepartureAt: null,
  delayMinutes: null, connectionSlackMinutes: null,
};

const rescheduleSurvivesSignal = {
  status: 'scheduled', bookedDepartureAt: Date.now(), scheduledDepartureAt: Date.now() + 60 * 60_000,
  delayMinutes: null, connectionSlackMinutes: 120,
};

describe('planRecovery (LangGraph planning graph)', () => {
  it('a cancellation picks the carrier-protected seat over a market alt, hotel, and ground', async () => {
    const flight = flightWith({
      alts: [alt({ id: 'market-1', kind: 'market', fare: 5000, ok: true }), alt({ id: 'owed-1', kind: 'carrier-protected' })],
      hotels: [hotel()],
      cabs: [cab()],
    });
    const plan = await planRecovery({
      flight, partySize: 1, rejectedAltIds: [], signal: cancelledSignal,
      adaptedPreferences: defaultPreferences(), cap: CAP,
    });
    expect(plan.kind).toBe('cancellation');
    expect(plan.needsRebooking).toBe(true);
    // Under the real scorer (server/pipeline/score.ts) rather than the old
    // bare find(), this is no longer "carrier-protected always wins by
    // priority" — it's the real ranking outcome: with neither alt's arrival
    // time known (score neutral for both), the carrier-protected seat's
    // free cost + real-owed reliability edge out a paid market alt with
    // otherwise-equal cabin/loyalty/effort scores. Confirmed by direct
    // calculation against the earliest_arrival preset's weights — see
    // server/pipeline/score.test.ts for the scorer's own unit coverage of
    // this exact "free vs paid, no other differentiator" shape.
    expect(plan.chosenAltId).toBe('owed-1');
    expect(plan.chosenAltReason?.text).toBeTruthy();
    expect(plan.chosenHotelId).toBe('htl-1');
    expect(plan.chosenCabId).toBe('cab-1');
    expect(plan.disposition).toBe('involuntary');
  });

  it('a reschedule the connection survives needs no new seat, only hotel/ground re-timing', async () => {
    const flight = flightWith({
      alts: [alt()],
      hotels: [hotel()],
      cabs: [cab()],
    });
    const plan = await planRecovery({
      flight, partySize: 1, rejectedAltIds: [], signal: rescheduleSurvivesSignal,
      adaptedPreferences: defaultPreferences(), cap: CAP,
    });
    expect(plan.needsRebooking).toBe(false);
    expect(plan.chosenAltId).toBeNull();
    expect(plan.chosenAltReason).toBeNull();
    expect(plan.needsRetiming).toBe(true);
    expect(plan.chosenHotelId).toBe('htl-1');
  });

  it('excludes a rejected alt and falls back to the next eligible one', async () => {
    const flight = flightWith({
      alts: [alt({ id: 'owed-1', kind: 'carrier-protected' }), alt({ id: 'market-2', kind: 'market', ok: true, seats: 4 })],
    });
    const plan = await planRecovery({
      flight, partySize: 1, rejectedAltIds: ['owed-1'], signal: cancelledSignal,
      adaptedPreferences: defaultPreferences(), cap: CAP,
    });
    expect(plan.chosenAltId).toBe('market-2');
    // The rejected alt must never resurface anywhere in the ranked list either.
    expect(plan.rankedAlts.some((r) => r.altId === 'owed-1')).toBe(false);
  });

  it('hard rules can empty the portfolio — chosenAltId is null with a real, surfaced reason, not a bad pick', async () => {
    // A market alt that structurally cannot seat the party (no carrier-
    // protected alternative present) — applyHardRules' party-fit rule
    // removes it, unlike the old code's bare `.ok` check, this is a real
    // hard-rule exclusion the member can be shown the reason for.
    const flight = flightWith({ alts: [alt({ id: 'small', kind: 'market', ok: true, seats: 2 })] });
    const plan = await planRecovery({
      flight, partySize: 5, rejectedAltIds: [], signal: cancelledSignal,
      adaptedPreferences: defaultPreferences(), cap: CAP,
    });
    expect(plan.chosenAltId).toBeNull();
    expect(plan.chosenAltReason).toBeNull();
    expect(plan.excludedAlts).toHaveLength(1);
    expect(plan.excludedAlts[0].altId).toBe('small');
    expect(plan.excludedAlts[0].rule).toContain('5');
  });

  it('avoid_airlines is a hard exclusion, never a ranking penalty', async () => {
    const flight = flightWith({
      alts: [alt({ id: 'blocked', kind: 'market', code: 'SG 202', ok: true }), alt({ id: 'owed-1', kind: 'carrier-protected' })],
    });
    const plan = await planRecovery({
      flight, partySize: 1, rejectedAltIds: [], signal: cancelledSignal,
      adaptedPreferences: defaultPreferences({ avoidAirlines: ['SG'] }), cap: CAP,
    });
    expect(plan.excludedAlts.some((e) => e.altId === 'blocked' && e.rule.includes('SG'))).toBe(true);
    expect(plan.chosenAltId).toBe('owed-1');
  });

  it('never picks an alt that cannot seat the whole party', async () => {
    const flight = flightWith({
      alts: [alt({ id: 'small', kind: 'market', seats: 2, ok: true }), alt({ id: 'owed-1', kind: 'carrier-protected' })],
    });
    const plan = await planRecovery({
      flight, partySize: 5, rejectedAltIds: [], signal: cancelledSignal,
      adaptedPreferences: defaultPreferences(), cap: CAP,
    });
    // carrier-protected always fits (owed per ticket), so it should still win here
    expect(plan.chosenAltId).toBe('owed-1');
  });

  it('chosenAltReason is always non-null whenever chosenAltId is, and always carries real text', async () => {
    const flight = flightWith({ alts: [alt({ id: 'owed-1', kind: 'carrier-protected' })] });
    const plan = await planRecovery({
      flight, partySize: 1, rejectedAltIds: [], signal: cancelledSignal,
      adaptedPreferences: defaultPreferences(), cap: CAP,
    });
    expect(plan.chosenAltId).not.toBeNull();
    expect(plan.chosenAltReason).not.toBeNull();
    expect(plan.chosenAltReason?.kind).toBe('deterministic-score');
    expect(plan.chosenAltReason?.text.length).toBeGreaterThan(0);
  });

  it('rankedAlts length equals the number of alts surviving hard rules, in descending-score order', async () => {
    const flight = flightWith({
      alts: [
        alt({ id: 'owed-1', kind: 'carrier-protected' }),
        alt({ id: 'market-1', kind: 'market', ok: true, fare: 1000 }),
      ],
    });
    const plan = await planRecovery({
      flight, partySize: 1, rejectedAltIds: [], signal: cancelledSignal,
      adaptedPreferences: defaultPreferences(), cap: CAP,
    });
    expect(plan.rankedAlts).toHaveLength(2);
    expect(plan.rankedAlts[0].altId).toBe(plan.chosenAltId);
  });

  it('rationale records every specialist and the supervisor, in order', async () => {
    const flight = flightWith({ alts: [alt()], hotels: [hotel()], cabs: [cab()] });
    const plan = await planRecovery({
      flight, partySize: 1, rejectedAltIds: [], signal: cancelledSignal,
      adaptedPreferences: defaultPreferences(), cap: CAP,
    });
    expect(plan.rationale.some((r) => r.startsWith('Classified as'))).toBe(true);
    expect(plan.rationale.some((r) => r.startsWith('Flight specialist'))).toBe(true);
    expect(plan.rationale.some((r) => r.startsWith('Hotel specialist'))).toBe(true);
    expect(plan.rationale.some((r) => r.startsWith('Ground specialist'))).toBe(true);
    expect(plan.rationale.some((r) => r.startsWith('Supervisor'))).toBe(true);
  });
});
