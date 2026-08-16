/**
 * Proves the Postgres-backed store.ts actually round-trips data through a
 * real database — not just that it typechecks. Requires DATABASE_URL to
 * point at a real, reachable Postgres (see zkd-app/README.md); skips itself
 * entirely rather than failing when one isn't configured, so `npx vitest
 * run` stays green in an environment with no database (e.g. a plain `npm
 * test` on a laptop with nothing running).
 */
import { describe, test, expect, beforeAll } from 'vitest';

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)('store.ts against real Postgres', () => {
  let store: typeof import('./store');
  let seed: typeof import('./seed');

  beforeAll(async () => {
    store = await import('./store');
    seed = await import('./seed');
  });

  test('ensureSeeded populates the demo dataset and is idempotent', async () => {
    await seed.ensureSeeded();
    await seed.ensureSeeded(); // second call must be a no-op, not a duplicate seed

    const flights = await store.listFlights();
    const passengers = await store.listPassengers();
    expect(flights.length).toBeGreaterThanOrEqual(6);
    expect(passengers.length).toBeGreaterThanOrEqual(5);

    const priya = await store.getPassenger('p-priya');
    expect(priya?.displayName).toBe('Priya S.');

    // Idempotence check: seeding twice must not double the party-of-6 booking's
    // travellers, which is exactly the failure mode the advisory-lock-guarded
    // doSeed() in seed.ts exists to prevent.
    const multiFlightBookings = await store.getBookingsForFlight('f-multi');
    const arjunBooking = multiFlightBookings.find((b) => b.passengerId === 'p-arjun');
    expect(arjunBooking?.travellerIds.length).toBe(6);
  });

  test('a flight, passenger, booking, disruption event and recovery task round-trip through Postgres', async () => {
    await seed.ensureSeeded();

    const flightId = `test-flight-${Date.now()}`;
    const passengerId = `test-passenger-${Date.now()}`;

    await store.createPassenger({
      id: passengerId, displayName: 'Test Traveller', legalName: 'TEST TRAVELLER',
      dob: '01 Jan 1990', gender: 'Other', nationality: 'Indian',
      passport: { number: 'X1234567', expiry: 'Jan 2030', issued: 'India' },
      contact: { email: 'test@example.com', phone: '+91 00000 00000' },
      consent: 'ask',
      loyalty: [], prefs: [], payment: { card: 'test', method: 'test' },
    });

    await store.createFlight({
      id: flightId, code: 'TT 100', from: 'MAA', to: 'DEL',
      depISO: new Date(Date.now() + 3_600_000).toISOString(), durationMin: 150,
      connectionSlackMinutes: null, hasHardConstraint: false,
      candidates: { alts: [], hotels: [], cabs: [], cabLegs: [] },
    });

    const booking = await store.createBooking({
      flightId, passengerId, seat: '1A', pnr: 'TEST01', cabin: 'Economy',
    });

    // Round-trip reads
    const readFlight = await store.getFlight(flightId);
    const readPassenger = await store.getPassenger(passengerId);
    const readBooking = await store.getBooking(booking.id);
    const bookingsForFlight = await store.getBookingsForFlight(flightId);

    expect(readFlight?.code).toBe('TT 100');
    expect(readPassenger?.displayName).toBe('Test Traveller');
    expect(readBooking?.pnr).toBe('TEST01');
    expect(bookingsForFlight.map((b) => b.id)).toContain(booking.id);
    // Backfilled solo traveller round-trips too — this is what proves
    // createBooking's conditional createTraveller path survived the rewrite.
    expect(booking.travellerIds.length).toBe(1);
    const travellers = await store.getTravellersForBooking(readBooking!);
    expect(travellers[0]?.displayName).toBe('Test Traveller');

    // Disruption event + recovery task
    const event = {
      id: `de-${flightId}`, flightId, detectedAt: Date.now(), phase: 'DECIDING' as const,
    };
    await store.createDisruptionEvent(event);
    const readEvent = await store.getDisruptionEvent(flightId);
    expect(readEvent?.phase).toBe('DECIDING');

    // Simulate finishDecide()'s in-place mutation + re-persist pattern.
    readEvent!.phase = 'READY';
    readEvent!.decidedAt = Date.now();
    await store.createDisruptionEvent(readEvent!);
    const readEventAgain = await store.getDisruptionEvent(flightId);
    expect(readEventAgain?.phase).toBe('READY');
    expect(readEventAgain?.decidedAt).toBeDefined();

    const taskId = await store.nextTaskId();
    const task = {
      id: taskId, disruptionEventId: event.id, flightId, bookingId: booking.id, passengerId,
      phase: 'waiting' as const, terminal: null, needsRebooking: true, partySize: 1, windowExpiresAt: Date.now() + 60_000,
      windowBoundBy: 'ceiling' as const, chosenAltId: '', chosenHotelId: '', chosenCabId: '',
      rejectedAltIds: [], shown: [], note: null, resolution: null,
    };
    await store.setRecoveryTask(task);
    const readTask = await store.getRecoveryTask(flightId, passengerId);
    expect(readTask?.id).toBe(taskId);
    expect(readTask?.phase).toBe('waiting');

    const tasksForFlight = await store.getRecoveryTasksForFlight(flightId);
    expect(tasksForFlight.map((t) => t.id)).toContain(taskId);

    // Pre-auth round-trip
    await store.setPreAuth({ flightId, passengerId, altId: 'a1', hotelId: 'h1', cabId: 'c1', owed: 0, grantedAt: Date.now() });
    const readPreAuth = await store.getPreAuth(flightId, passengerId);
    expect(readPreAuth?.altId).toBe('a1');
    await store.clearPreAuth(flightId, passengerId);
    expect(await store.getPreAuth(flightId, passengerId)).toBeUndefined();
  });

  test('sequences produce unique ids across calls (the multi-instance concern this migration exists to fix)', async () => {
    const ids = await Promise.all([store.nextTaskId(), store.nextTaskId(), store.nextTaskId()]);
    expect(new Set(ids).size).toBe(3);
  });
});
