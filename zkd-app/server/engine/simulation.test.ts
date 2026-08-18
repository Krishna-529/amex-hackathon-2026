/**
 * The autopilot-notice lifecycle end to end (Part 2 of the feature — see
 * the implementation plan), against a real Postgres, same
 * describe.skipIf(!hasDb) pattern as store.integration.test.ts. This is the
 * highest-risk regression surface in the whole feature: simulation.ts's
 * createTaskForBooking/settleExpired are the module's core state machine.
 *
 * Uses REAL fake timers (vi.useFakeTimers) driving REAL Postgres I/O inside
 * the scheduled callbacks — vitest's advanceTimersByTimeAsync is built for
 * exactly this (it awaits between ticks so in-flight real I/O gets a chance
 * to settle), so this does not need multi-second/multi-minute real waits
 * despite the autopilot notice's real 180s ceiling.
 *
 * Seeded alts deliberately omit `supplier`/`supplierOfferId` so
 * revalidateChoice() short-circuits to null (see simulation.ts) without
 * ever calling out to a real/mocked supplier — keeps this test to pure
 * domain logic + real Postgres, no network mocking required.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Booking, Flight, Passenger } from '../domain/types';

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)('autopilot notice window (createTaskForBooking / settleExpired)', () => {
  let store: typeof import('../domain/store');
  let sim: typeof import('./simulation');

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    store = await import('../domain/store');
    sim = await import('./simulation');
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function seed(
    suffix: string,
    consent: 'autopilot' | 'ask',
    alt: Flight['candidates']['alts'][number] = {
      id: 'alt-1', code: 'AI 900', dep: '10:00', arr: '13:00', cabin: 'Economy',
      seats: 4, fare: 0, currency: 'INR', expiresAt: null, kind: 'carrier-protected',
      ok: true, why: 'owed by the carrier',
    },
  ) {
    const flightId = `sim-flt-${suffix}-${Date.now()}`;
    const passengerId = `sim-pax-${suffix}-${Date.now()}`;
    const bookingId = `sim-bk-${suffix}-${Date.now()}`;

    const flight: Flight = {
      id: flightId, code: 'TT 1', from: 'BOM', to: 'DEL',
      // Close enough that a real window is bounded well under the
      // AUTOPILOT_NOTICE_CEILING_SECONDS default, so the fake-timer advance
      // below only needs to cover a small, deterministic span.
      depISO: new Date(Date.now() + 90 * 60_000).toISOString(),
      durationMin: 130, connectionSlackMinutes: null, hasHardConstraint: false,
      candidates: { alts: [alt], hotels: [], cabs: [], cabLegs: [] },
    };
    await store.createFlight(flight);

    const passenger: Passenger = {
      id: passengerId, displayName: 'Test', legalName: 'TEST PASSENGER', dob: '01 Jan 1990',
      gender: 'Other', nationality: 'Indian',
      passport: { number: 'X1234567', expiry: 'Jan 2030', issued: 'India' },
      contact: { email: `${passengerId}@example.com`, phone: '+91 00000 00000' },
      consent, loyalty: [], prefs: [], payment: { card: 'test', method: 'test' },
    };
    await store.createPassenger(passenger);

    const booking: Booking = {
      id: bookingId, flightId, passengerId, seat: '1A', pnr: 'TEST01', cabin: 'Economy',
      travellerIds: [], seats: [],
    };
    await store.createBooking(booking);

    return { flightId, passengerId };
  }

  test('autopilot with a real seat decision opens a real countdown notice, then books on timeout — genuinely new behavior', async () => {
    const { flightId, passengerId } = await seed('autopilot-notice', 'autopilot');

    await sim.detectDisruption(flightId);
    // finishDecide's own delay (lib/recovery.ts's DECIDE_TOTAL*PLAY, floored
    // at 260ms) plus slack for the fire-and-forget createTaskForBooking
    // chain's real DB awaits to settle.
    await vi.advanceTimersByTimeAsync(15_000);

    const midway = await store.getRecoveryTask(flightId, passengerId);
    expect(midway?.resolution).toBeNull();
    expect(midway?.phase).toBe('waiting');
    // This is the behavior that did not exist before this feature: autopilot
    // used to resolve here already, with no window at all.
    expect(midway?.windowExpiresAt).toBeGreaterThan(Date.now());

    // Advance past the notice window's ceiling to let settleExpired fire.
    await vi.advanceTimersByTimeAsync(200_000);

    const after = await store.getRecoveryTask(flightId, passengerId);
    expect(after?.resolution?.kind).toBe('autopilot');
    expect(after?.terminal).not.toBe('ESCALATED');
  });

  test('ask consent is unchanged: an unanswered window for a real, non-free seat decision still escalates, never silently books', async () => {
    // A market (paid) alt, not carrier-protected — cost.total > 0, so
    // settleExpired's real regression case (escalate on silence, never
    // spend unapproved money) is what actually gets exercised here.
    const { flightId, passengerId } = await seed('ask-unchanged', 'ask', {
      id: 'alt-1', code: 'AI 900', dep: '10:00', arr: '13:00', cabin: 'Economy',
      seats: 4, fare: 5000, currency: 'INR', expiresAt: null, kind: 'market',
      ok: true, why: 'within entitlement',
    });

    await sim.detectDisruption(flightId);
    await vi.advanceTimersByTimeAsync(15_000);

    const midway = await store.getRecoveryTask(flightId, passengerId);
    expect(midway?.phase).toBe('waiting');

    // ask's window can be as long as 20 minutes (WINDOW_CEILING_SECONDS) —
    // advance well past any bound this fixture could produce.
    await vi.advanceTimersByTimeAsync(21 * 60_000);

    const after = await store.getRecoveryTask(flightId, passengerId);
    // Unanswered + would cost money => escalate, never auto-book. This is
    // the pre-existing behavior this feature must NOT have changed for 'ask'.
    expect(after?.resolution?.kind).toBe('handed-over');
    expect(after?.terminal).toBe('ESCALATED');
  });
});
