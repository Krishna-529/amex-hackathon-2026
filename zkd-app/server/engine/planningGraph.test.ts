import { describe, expect, it } from 'vitest';
import { planRecovery } from './planningGraph';
import type { Flight, Alt, HotelOpt, CabOpt } from '../domain/types';

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
    const plan = await planRecovery({ flight, partySize: 1, rejectedAltIds: [], signal: cancelledSignal });
    expect(plan.kind).toBe('cancellation');
    expect(plan.needsRebooking).toBe(true);
    expect(plan.chosenAltId).toBe('owed-1');
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
    const plan = await planRecovery({ flight, partySize: 1, rejectedAltIds: [], signal: rescheduleSurvivesSignal });
    expect(plan.needsRebooking).toBe(false);
    expect(plan.chosenAltId).toBeNull();
    expect(plan.needsRetiming).toBe(true);
    expect(plan.chosenHotelId).toBe('htl-1');
  });

  it('excludes a rejected alt and falls back to the next eligible one', async () => {
    const flight = flightWith({
      alts: [alt({ id: 'owed-1', kind: 'carrier-protected' }), alt({ id: 'market-2', kind: 'market', ok: true, seats: 4 })],
    });
    const plan = await planRecovery({ flight, partySize: 1, rejectedAltIds: ['owed-1'], signal: cancelledSignal });
    expect(plan.chosenAltId).toBe('market-2');
  });

  it('never proposes an alt with no eligible candidate — chosenAltId is null, not a bad pick', async () => {
    const flight = flightWith({ alts: [alt({ id: 'owed-1', ok: false, why: 'sold out' })] });
    const plan = await planRecovery({ flight, partySize: 1, rejectedAltIds: [], signal: cancelledSignal });
    expect(plan.chosenAltId).toBeNull();
  });

  it('never picks an alt that cannot seat the whole party', async () => {
    const flight = flightWith({
      alts: [alt({ id: 'small', kind: 'market', seats: 2, ok: true }), alt({ id: 'owed-1', kind: 'carrier-protected' })],
    });
    const plan = await planRecovery({ flight, partySize: 5, rejectedAltIds: [], signal: cancelledSignal });
    // carrier-protected always fits (owed per ticket), so it should still win here
    expect(plan.chosenAltId).toBe('owed-1');
  });

  it('rationale records every specialist and the supervisor, in order', async () => {
    const flight = flightWith({ alts: [alt()], hotels: [hotel()], cabs: [cab()] });
    const plan = await planRecovery({ flight, partySize: 1, rejectedAltIds: [], signal: cancelledSignal });
    expect(plan.rationale.some((r) => r.startsWith('Classified as'))).toBe(true);
    expect(plan.rationale.some((r) => r.startsWith('Flight specialist'))).toBe(true);
    expect(plan.rationale.some((r) => r.startsWith('Hotel specialist'))).toBe(true);
    expect(plan.rationale.some((r) => r.startsWith('Ground specialist'))).toBe(true);
    expect(plan.rationale.some((r) => r.startsWith('Supervisor'))).toBe(true);
  });
});
