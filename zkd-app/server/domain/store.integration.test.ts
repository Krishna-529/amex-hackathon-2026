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
      rejectedAltIds: [], shown: [], note: null, resolution: null, undeliveredGraceUsed: false,
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

  // 2026-08-21: listWaitingRecoveryTasks is the query the reconciliation
  // sweep (server/engine/simulation.ts) depends on to resume anything a
  // process restart stranded — it can only be validated against a real
  // Postgres because it relies on a specific JSON-null-vs-SQL-null
  // distinction (jsonb_typeof(...) = 'null', NOT `IS NULL`) that mocks
  // cannot meaningfully exercise.
  test('listWaitingRecoveryTasks finds a waiting/unresolved task and excludes a resolved one', async () => {
    const flightId = `flt-waiting-${Date.now()}`;
    const passengerId = `p-waiting-${Date.now()}`;
    const waitingTask = {
      id: `task-waiting-${Date.now()}`, disruptionEventId: 'evt-1', flightId, bookingId: 'bk-1', passengerId,
      phase: 'waiting' as const, terminal: null, needsRebooking: true, partySize: 1,
      windowExpiresAt: Date.now() - 60_000, windowBoundBy: 'ceiling' as const,
      chosenAltId: '', chosenHotelId: '', chosenCabId: '', rejectedAltIds: [],
      shown: [], note: null, resolution: null, undeliveredGraceUsed: false,
    };
    await store.setRecoveryTask(waitingTask);

    const resolvedFlightId = `flt-resolved-${Date.now()}`;
    const resolvedTask = {
      ...waitingTask,
      id: `task-resolved-${Date.now()}`, flightId: resolvedFlightId,
      resolution: { kind: 'handed-over' as const, at: Date.now() },
      phase: 'handed' as const,
    };
    await store.setRecoveryTask(resolvedTask);

    const waiting = await store.listWaitingRecoveryTasks();
    const ids = waiting.map((t) => t.id);
    expect(ids).toContain(waitingTask.id);
    expect(ids).not.toContain(resolvedTask.id);
  });

  // 2026-08-21: updateConsent used to be read-modify-write (getPassenger,
  // mutate .consent in application code, blind overwrite the whole
  // document) — a real lost-update race. Now a single atomic
  // `jsonb_set(...)` inside the UPDATE itself.
  test('updateConsent is atomic under concurrent writers — the final value is one of the writes, never lost or corrupted', async () => {
    const passengerId = `test-consent-${Date.now()}`;
    await store.createPassenger({
      id: passengerId, displayName: 'Consent Race Test', legalName: 'CONSENT RACE TEST',
      dob: '01 Jan 1990', gender: 'Other', nationality: 'Indian',
      passport: { number: 'X1234567', expiry: 'Jan 2030', issued: 'India' },
      contact: { email: `consent-${Date.now()}@example.com`, phone: '+91 00000 00000' },
      consent: 'ask',
      loyalty: [], prefs: [], payment: { card: 'test', method: 'test' },
    });

    // Fire both concurrently — this is exactly the shape of race the old
    // read-modify-write implementation could silently lose one side of.
    const [a, b] = await Promise.all([
      store.updateConsent(passengerId, 'autopilot'),
      store.updateConsent(passengerId, 'ask'),
    ]);
    expect(a).toBeDefined();
    expect(b).toBeDefined();

    const final = await store.getPassenger(passengerId);
    // Whichever write landed last, the persisted value must be exactly one
    // of the two real values written — never undefined, never merged/
    // corrupted, and both concurrent calls must have completed successfully
    // (asserted above) rather than one throwing or silently no-oping.
    expect(['autopilot', 'ask']).toContain(final?.consent);
  });

  // 2026-08-21: createItinerary used to be a separate insert plus one
  // update per booking, none of it transactional — a crash mid-loop could
  // leave Itinerary.bookingIds and a Booking's itineraryId/legIndex
  // permanently disagreeing.
  test('createItinerary atomically links every booking to the new itinerary', async () => {
    const passengerId = `test-itin-${Date.now()}`;
    const flightId = `test-itin-flight-${Date.now()}`;
    await store.createPassenger({
      id: passengerId, displayName: 'Itinerary Test', legalName: 'ITINERARY TEST',
      dob: '01 Jan 1990', gender: 'Other', nationality: 'Indian',
      passport: { number: 'X1234567', expiry: 'Jan 2030', issued: 'India' },
      contact: { email: `itin-${Date.now()}@example.com`, phone: '+91 00000 00000' },
      consent: 'ask',
      loyalty: [], prefs: [], payment: { card: 'test', method: 'test' },
    });
    await store.createFlight({
      id: flightId, code: 'IT 100', from: 'MAA', to: 'DEL',
      depISO: new Date(Date.now() + 3_600_000).toISOString(), durationMin: 150,
      connectionSlackMinutes: null, hasHardConstraint: false,
      candidates: { alts: [], hotels: [], cabs: [], cabLegs: [] },
    });
    const b1 = await store.createBooking({ flightId, passengerId, seat: '1A', pnr: 'ITIN01', cabin: 'Economy' });
    const b2 = await store.createBooking({ flightId, passengerId, seat: '1B', pnr: 'ITIN02', cabin: 'Economy' });

    const it = await store.createItinerary(passengerId, [b1.id, b2.id]);
    expect(it.bookingIds).toEqual([b1.id, b2.id]);

    const readB1 = await store.getScheduleForPassenger(passengerId);
    const leg1 = readB1.find((r) => r.booking.id === b1.id);
    const leg2 = readB1.find((r) => r.booking.id === b2.id);
    expect(leg1?.booking.itineraryId).toBe(it.id);
    expect(leg1?.booking.legIndex).toBe(0);
    expect(leg2?.booking.itineraryId).toBe(it.id);
    expect(leg2?.booking.legIndex).toBe(1);
  });

  // 2026-08-21: pipelineRuns was the one piece of domain state left fully
  // in-memory when everything else moved to Postgres. setPipelineRun now
  // fire-and-forget mirrors to a real pipeline_runs table (same pattern
  // journal.ts's mirrorToTask already used); hydratePipelineRunsFromDb
  // reads it back at startup. This proves the actual round trip, not just
  // that it typechecks — a `void (async () => {...})()` fire-and-forget
  // write racing this test's own read is exactly the kind of bug that only
  // shows up against a real database.
  test('setPipelineRun mirrors to Postgres, and hydratePipelineRunsFromDb reads it back into a fresh Map', async () => {
    const flightId = `test-pr-flight-${Date.now()}`;
    const passengerId = `test-pr-passenger-${Date.now()}`;
    const run = {
      id: `pr-${flightId}:${passengerId}`, flightId, passengerId,
      state: 'TRIGGERED' as const, startedAt: Date.now(), changedAt: Date.now(),
      replans: 0, memberReplans: 0, plan: null, sources: {}, committed: [], orphans: [],
      mutationsEnabled: false, journal: [],
    };
    store.setPipelineRun(run);

    // The mirror is fire-and-forget — give it a real tick to land before
    // asserting against the database it wrote to, rather than racing it.
    await new Promise((r) => setTimeout(r, 200));

    // Simulate what a restart looks like: a Map with nothing in it yet.
    store.pipelineRuns.clear();
    expect(store.getPipelineRun(flightId, passengerId)).toBeUndefined();

    await store.hydratePipelineRunsFromDb();
    const rehydrated = store.getPipelineRun(flightId, passengerId);
    expect(rehydrated).toBeDefined();
    expect(rehydrated?.state).toBe('TRIGGERED');
    expect(rehydrated?.flightId).toBe(flightId);
  });

  test('getPreAuthsForFlight returns only that flight\'s pre-auths', async () => {
    const flightA = `flt-preauth-a-${Date.now()}`;
    const flightB = `flt-preauth-b-${Date.now()}`;
    const passengerId = `p-preauth-${Date.now()}`;
    await store.setPreAuth({ flightId: flightA, passengerId, altId: 'a1', hotelId: 'h1', cabId: 'c1', owed: 0, grantedAt: Date.now() });
    await store.setPreAuth({ flightId: flightB, passengerId, altId: 'a2', hotelId: 'h2', cabId: 'c2', owed: 0, grantedAt: Date.now() });

    const forA = await store.getPreAuthsForFlight(flightA);
    expect(forA).toHaveLength(1);
    expect(forA[0].altId).toBe('a1');

    await store.clearPreAuth(flightA, passengerId);
    await store.clearPreAuth(flightB, passengerId);
  });

  test('session prefs round-trip through Postgres, isolate per flight+passenger, and clear', async () => {
    const flightId = `flt-session-${Date.now()}`;
    const passengerId = `p-session-${Date.now()}`;
    const override: import('../preferences/intent').PreferenceOverride = {
      restated_intent: 'Avoid Air India, an SUV is fine',
      strategy: null, hard_deadline_iso: null, deadline_reason: null,
      earliest_departure_iso: null, clarifying_question: null,
      avoid_airlines: ['AI'], prefer_airlines: [], max_layovers: null,
      allow_cabin_downgrade: null, max_out_of_pocket: null, overnight_ok: null,
      needs_hotel: null, hotel_max_distance_km: null, hotel_amenities: [],
      vehicle_tier: 'xl', accessibility: null, unsupported: [], confidence: 'high',
    };
    await store.setSessionPrefs({ flightId, passengerId, override, restated: override.restated_intent, setAt: Date.now() });

    const back = await store.getSessionPrefs(flightId, passengerId);
    expect(back?.override.avoid_airlines).toEqual(['AI']);
    expect(back?.override.vehicle_tier).toBe('xl');
    expect(back?.restated).toBe('Avoid Air India, an SUV is fine');

    // Keyed per flight+passenger, exactly like journey_prefs: another passenger
    // on the same flight has their own (here, none).
    expect(await store.getSessionPrefs(flightId, `${passengerId}-other`)).toBeUndefined();

    await store.clearSessionPrefs(flightId, passengerId);
    expect(await store.getSessionPrefs(flightId, passengerId)).toBeUndefined();
  });
});
