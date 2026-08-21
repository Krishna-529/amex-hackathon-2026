import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Booking, DisruptionEvent, Flight, Passenger, RecoveryTask } from '../domain/types';

/**
 * Regression coverage for the safety defect ZKD-Gap-Audit-Session-Report.md §3
 * found and this session fixed: `dispatch()`'s `delivered` result used to be
 * computed, logged, and never read by the consent path. Under notify-then-
 * proceed (the ₹25,000 cap was removed 2026-08-19), a member whose WhatsApp
 * and push both failed was indistinguishable from one who saw rung 3 and
 * chose not to object — and got charged either way.
 *
 * These tests drive the real public entry point (`detectDisruption`) through
 * the real timer chain with fake timers, mocking only the store/notify/
 * pipeline boundaries — the same pattern forecastEventRescore.test.ts uses —
 * so what's under test is the actual `settleExpired` logic, not a stand-in
 * for it.
 */

let flights: Map<string, Flight>;
let bookings: Map<string, Booking[]>;
let passengers: Map<string, Passenger>;
let events: Map<string, DisruptionEvent>;
let tasks: Map<string, RecoveryTask>;

const dispatchMock = vi.fn(async () => ({ event: {} as never, results: [], delivered: true }));
const pipelineExecute = vi.fn(async () => {});

vi.mock('../domain/seed', () => ({ ensureSeeded: vi.fn(async () => {}) }));
vi.mock('../notify', () => ({ dispatch: (...args: unknown[]) => dispatchMock(...(args as [])) }));
vi.mock('../notify/templates', () => ({
  cancelledAlert: (x: unknown) => ({ kind: 'cancelled', ...(x as object) }),
  aboutToBookAlert: (x: unknown) => ({ kind: 'about-to-book', ...(x as object) }),
}));
vi.mock('../pipeline', () => ({
  onDisruptionDetected: vi.fn(),
  ensurePlanned: vi.fn(async () => {}),
  preferredPlan: () => null,
  execute: (...args: unknown[]) => pipelineExecute(...(args as [])),
}));
vi.mock('../domain/store', () => ({
  getDisruptionEvent: async (flightId: string) => events.get(flightId),
  createDisruptionEvent: async (e: DisruptionEvent) => { events.set(e.flightId, e); },
  getFlight: async (id: string) => flights.get(id),
  getBookingsForFlight: async (flightId: string) => bookings.get(flightId) ?? [],
  getPassenger: async (id: string) => passengers.get(id),
  getPreAuth: async () => undefined,
  getJourneyPrefs: async () => undefined,
  nextTaskId: async () => `task-${tasks.size + 1}`,
  partySize: (b: Booking) => b.travellerIds.length,
  getRecoveryTask: async (flightId: string, passengerId: string) => tasks.get(`${flightId}:${passengerId}`),
  setRecoveryTask: async (t: RecoveryTask) => { tasks.set(`${t.flightId}:${t.passengerId}`, t); },
  listWaitingRecoveryTasks: async () =>
    [...tasks.values()].filter((t) => t.phase === 'waiting' && t.resolution === null),
}));

const FLIGHT_ID = 'flt-delivery-test';
const PASSENGER_ID = 'p-delivery-test';

function flight(): Flight {
  return {
    id: FLIGHT_ID, code: 'AI 2803', from: 'DEL', to: 'BOM',
    depISO: new Date(Date.now() + 48 * 3_600_000).toISOString(), durationMin: 130,
    connectionSlackMinutes: null, hasHardConstraint: false,
    candidates: { alts: [], hotels: [], cabs: [], cabLegs: [] },
  };
}

function passenger(): Passenger {
  return {
    id: PASSENGER_ID, displayName: 'Test Member', legalName: 'Test Member', dob: '1990-01-01',
    gender: 'unspecified', nationality: 'IN',
    passport: { number: 'X0000000', expiry: '2030-01-01', issued: '2020-01-01' },
    contact: { email: 't@example.com', phone: '+911234567890' },
    consent: 'ask',
    loyalty: [], prefs: [], payment: { card: 'amex-test', method: 'card' },
  };
}

function booking(): Booking {
  return {
    id: 'bk-delivery-test', flightId: FLIGHT_ID, passengerId: PASSENGER_ID,
    seat: '12A', pnr: 'TESTPNR', cabin: 'economy', travellerIds: [PASSENGER_ID], seats: [],
  };
}

async function runToRung3Deadline() {
  // finishDecide's delay is small (DECIDE_TOTAL * PLAY, well under a minute);
  // 60s clears it and runs createTaskForBooking, which dispatches rung 3 and
  // schedules settleExpired against confirmWindow's ceiling (20 minutes, since
  // this fixture has no offer expiry and a departure far enough out that
  // check-in isn't the binding constraint).
  await vi.advanceTimersByTimeAsync(60_000);
  await vi.advanceTimersByTimeAsync(21 * 60_000);
}

describe('settleExpired — the notification-delivery safety check', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    flights = new Map([[FLIGHT_ID, flight()]]);
    bookings = new Map([[FLIGHT_ID, [booking()]]]);
    passengers = new Map([[PASSENGER_ID, passenger()]]);
    events = new Map();
    tasks = new Map();
    dispatchMock.mockClear();
    pipelineExecute.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('proceeds to book when rung 3 is confirmed delivered', async () => {
    dispatchMock.mockImplementation(async () => ({ event: {} as never, results: [], delivered: true }));

    const { detectDisruption } = await import('./simulation');
    await detectDisruption(FLIGHT_ID);
    await runToRung3Deadline();

    const task = tasks.get(`${FLIGHT_ID}:${PASSENGER_ID}`);
    expect(task?.resolution?.kind).toBe('autopilot');
    expect(task?.phase).toBe('acting');
    expect(pipelineExecute).toHaveBeenCalledTimes(1);
  });

  it('does NOT book on a fully-undelivered rung 3, and hands over to a human instead', async () => {
    dispatchMock.mockImplementation(async () => ({ event: {} as never, results: [], delivered: false }));

    const { detectDisruption } = await import('./simulation');
    await detectDisruption(FLIGHT_ID);
    await runToRung3Deadline();

    // First expiry with nothing delivered grants the one grace extension,
    // not a booking.
    let task = tasks.get(`${FLIGHT_ID}:${PASSENGER_ID}`);
    expect(task?.resolution).toBeNull();
    expect(task?.undeliveredGraceUsed).toBe(true);
    expect(pipelineExecute).not.toHaveBeenCalled();

    // The grace retry also goes undelivered — this must halt to a human, not
    // proceed to book on an amount the member was never confirmably told.
    await vi.advanceTimersByTimeAsync(6 * 60_000);

    task = tasks.get(`${FLIGHT_ID}:${PASSENGER_ID}`);
    expect(task?.resolution?.kind).toBe('handed-over');
    expect(task?.phase).toBe('handed');
    expect(pipelineExecute).not.toHaveBeenCalled();
  });

  it('recovers and books once the grace-retry delivery succeeds', async () => {
    // Call 0 is rung 2 (cancelledAlert, irrelevant here); call 1 is rung 3's
    // first attempt (undelivered); call 2 is the grace retry (delivered).
    let call = 0;
    dispatchMock.mockImplementation(async () => ({
      event: {} as never, results: [], delivered: (call++ > 1),
    }));

    const { detectDisruption } = await import('./simulation');
    await detectDisruption(FLIGHT_ID);
    await runToRung3Deadline();

    let task = tasks.get(`${FLIGHT_ID}:${PASSENGER_ID}`);
    expect(task?.resolution).toBeNull();
    expect(task?.undeliveredGraceUsed).toBe(true);

    await vi.advanceTimersByTimeAsync(6 * 60_000);

    task = tasks.get(`${FLIGHT_ID}:${PASSENGER_ID}`);
    expect(task?.resolution?.kind).toBe('autopilot');
    expect(task?.phase).toBe('acting');
    expect(pipelineExecute).toHaveBeenCalledTimes(1);
  });
});

describe('reconcileStrandedTasks — resuming a consent window a restart abandoned', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    flights = new Map([[FLIGHT_ID, flight()]]);
    bookings = new Map([[FLIGHT_ID, [booking()]]]);
    passengers = new Map([[PASSENGER_ID, passenger()]]);
    events = new Map();
    tasks = new Map();
    dispatchMock.mockClear();
    pipelineExecute.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function strandedTask(overrides: Partial<RecoveryTask> = {}): RecoveryTask {
    return {
      id: 'task-1', flightId: FLIGHT_ID, passengerId: PASSENGER_ID,
      phase: 'waiting', shown: [], note: null, resolution: null,
      windowExpiresAt: Date.now() - 5 * 60_000, // already in the past — simulates a dead timer
      windowBoundBy: 'ceiling', partySize: 1,
      chosenAltId: '', chosenHotelId: '', chosenCabId: '', rejectedAltIds: [],
      undeliveredGraceUsed: false,
      ...overrides,
    } as RecoveryTask;
  }

  it('sends a fresh rung-3 message and resolves once it is confirmed delivered', async () => {
    tasks.set(`${FLIGHT_ID}:${PASSENGER_ID}`, strandedTask());
    dispatchMock.mockImplementation(async () => ({ event: {} as never, results: [], delivered: true }));

    const { reconcileStrandedTasks } = await import('./simulation');
    await reconcileStrandedTasks();

    expect(dispatchMock).toHaveBeenCalledTimes(1); // the fresh rung-3, nothing more
    const task = tasks.get(`${FLIGHT_ID}:${PASSENGER_ID}`);
    expect(task?.resolution?.kind).toBe('autopilot');
    expect(pipelineExecute).toHaveBeenCalledTimes(1);
  });

  it('does NOT resolve blind if the fresh rung-3 fails to deliver — grants the grace retry instead', async () => {
    tasks.set(`${FLIGHT_ID}:${PASSENGER_ID}`, strandedTask());
    dispatchMock.mockImplementation(async () => ({ event: {} as never, results: [], delivered: false }));

    const { reconcileStrandedTasks } = await import('./simulation');
    await reconcileStrandedTasks();

    const task = tasks.get(`${FLIGHT_ID}:${PASSENGER_ID}`);
    expect(task?.resolution).toBeNull();
    expect(task?.undeliveredGraceUsed).toBe(true);
    expect(pipelineExecute).not.toHaveBeenCalled();
  });

  it('a task that already used its grace retry before the restart goes straight to hand-over on a second undelivered attempt', async () => {
    tasks.set(`${FLIGHT_ID}:${PASSENGER_ID}`, strandedTask({ undeliveredGraceUsed: true }));
    dispatchMock.mockImplementation(async () => ({ event: {} as never, results: [], delivered: false }));

    const { reconcileStrandedTasks } = await import('./simulation');
    await reconcileStrandedTasks();

    const task = tasks.get(`${FLIGHT_ID}:${PASSENGER_ID}`);
    expect(task?.resolution?.kind).toBe('handed-over');
    expect(pipelineExecute).not.toHaveBeenCalled();
  });

  it('skips a task whose window has not actually expired yet', async () => {
    tasks.set(`${FLIGHT_ID}:${PASSENGER_ID}`, strandedTask({ windowExpiresAt: Date.now() + 10 * 60_000 }));

    const { reconcileStrandedTasks } = await import('./simulation');
    await reconcileStrandedTasks();

    expect(dispatchMock).not.toHaveBeenCalled();
    const task = tasks.get(`${FLIGHT_ID}:${PASSENGER_ID}`);
    expect(task?.resolution).toBeNull();
    expect(task?.phase).toBe('waiting'); // untouched — a live timer still owns this one
  });

  it('skips a task that is not actually stranded (already resolved or not waiting)', async () => {
    tasks.set(`${FLIGHT_ID}:${PASSENGER_ID}`, strandedTask({ phase: 'acting' }));

    const { reconcileStrandedTasks } = await import('./simulation');
    await reconcileStrandedTasks();

    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it('one stranded task with no matching booking does not stop the sweep from erroring loudly rather than silently', async () => {
    // No booking in the `bookings` map for this flight/passenger.
    bookings = new Map([[FLIGHT_ID, []]]);
    tasks.set(`${FLIGHT_ID}:${PASSENGER_ID}`, strandedTask());

    const { reconcileStrandedTasks } = await import('./simulation');
    await expect(reconcileStrandedTasks()).resolves.not.toThrow();
    expect(dispatchMock).not.toHaveBeenCalled(); // no booking to compute rung-3 content against
  });
});
