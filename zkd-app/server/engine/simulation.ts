/**
 * The simulation engine. This is the one place that decides anything —
 * every API route and every client device is downstream of what happens
 * here. Uses real setTimeout chains (module-level, process-lifetime) so a
 * disruption's lifecycle advances on schedule whether or not any client is
 * currently polling — the whole point of this redesign.
 *
 * `detectDisruption` is the single entry point for "we caught a disruption
 * signal for this flight." The /ops panel calls it manually (a human can't
 * make a real airline cancel a flight on cue for a demo), but the function
 * itself doesn't know or care who called it — a future live AviationStack-
 * status poller would call this exact same function. Only the caller differs.
 *
 * Long-running-process caveat (same tradeoff as server/cache.ts and
 * server/domain/store.ts): this only behaves correctly under `npm run dev` /
 * `npm start` as one continuous Node process. A serverless deployment would
 * spin up fresh isolates per request and these setTimeout chains would not
 * survive between invocations. Not solved here — acceptable for a prototype.
 */
import { risk } from '@/lib/risk';
import {
  DECIDE_STEPS, ACT_STEPS, DECIDE_TOTAL, QUIET_WINDOW_SECONDS, PLAY, FLOOR,
} from '@/lib/recovery';
import { money } from '@/lib/time';
import * as store from '../domain/store';
import { ensureSeeded } from '../domain/seed';
import type {
  DisruptionEvent, RecoveryTask, DisruptionResolution, Flight, Booking, Step, PreAuthRecord,
} from '../domain/types';

export type ResolveAction =
  | { kind: 'approve' }
  | { kind: 'hand-over' }
  | { kind: 'browse' }
  | { kind: 'back' }
  | { kind: 'choose'; altId: string }
  | { kind: 'swap-hotel'; hotelId: string }
  | { kind: 'swap-cab'; cabId: string };

export type RecoveryView = {
  taskId: string | null;
  flightId: string;
  detectedAt: number;
  phase: 'deciding' | 'waiting' | 'choosing' | 'acting' | 'booked' | 'handed';
  shown: Step[];
  secondsLeft: number;
  chosenAltId: string;
  chosenHotelId: string;
  chosenCabId: string;
  rejectedAltIds: string[];
  owedNow: number;
  note: string | null;
  resolution: DisruptionResolution | null;
};

function isPlanIntact(flight: Flight, pre: PreAuthRecord): boolean {
  return !!(
    flight.candidates.alts.find((a) => a.id === pre.altId)?.ok
    && flight.candidates.hotels.find((h) => h.id === pre.hotelId)?.ok
    && flight.candidates.cabs.find((c) => c.id === pre.cabId)?.ok
  );
}

function hotelCostOf(flight: Flight, hotelId: string): number {
  const h = flight.candidates.hotels.find((x) => x.id === hotelId);
  if (!h) return 0;
  return h.extra || h.rate; // mock hotels price via extra (rate always 0); live-search hotels price via rate (extra always 0)
}

function owedFor(flight: Flight, task: Pick<RecoveryTask, 'chosenAltId' | 'chosenHotelId' | 'chosenCabId'>): number {
  const alt = flight.candidates.alts.find((a) => a.id === task.chosenAltId);
  const cab = flight.candidates.cabs.find((c) => c.id === task.chosenCabId);
  return (alt?.fare ?? 0) + hotelCostOf(flight, task.chosenHotelId) + (cab?.extra ?? 0);
}

/** The single entry point for "a disruption was detected on this flight." */
export function detectDisruption(flightId: string): DisruptionEvent | null {
  ensureSeeded();
  const existing = store.getDisruptionEvent(flightId);
  if (existing) return existing;

  const flight = store.getFlight(flightId);
  if (!flight) return null;

  const r = risk(flight.signals);
  flight.riskPct = r.pct;
  flight.riskBand = r.band;

  const event: DisruptionEvent = { id: `de-${flightId}`, flightId, detectedAt: Date.now(), phase: 'DECIDING' };
  store.createDisruptionEvent(event);

  const decideDelayMs = Math.max(FLOOR, DECIDE_TOTAL * PLAY);
  setTimeout(() => finishDecide(flightId), decideDelayMs);
  return event;
}

function finishDecide(flightId: string) {
  const event = store.getDisruptionEvent(flightId);
  const flight = store.getFlight(flightId);
  if (!event || !flight) return;
  event.phase = 'READY';
  event.decidedAt = Date.now();

  for (const booking of store.getBookingsForFlight(flightId)) {
    createTaskForBooking(event, flight, booking);
  }
}

function createTaskForBooking(event: DisruptionEvent, flight: Flight, booking: Booking) {
  const passenger = store.getPassenger(booking.passengerId);
  if (!passenger) return;
  const preAuth = store.getPreAuth(flight.id, passenger.id);
  const planIntact = preAuth ? isPlanIntact(flight, preAuth) : false;

  const task: RecoveryTask = {
    id: store.nextTaskId(),
    disruptionEventId: event.id,
    flightId: flight.id,
    bookingId: booking.id,
    passengerId: passenger.id,
    phase: 'waiting',
    windowExpiresAt: 0,
    chosenAltId: '',
    chosenHotelId: '',
    chosenCabId: '',
    rejectedAltIds: [],
    shown: [...DECIDE_STEPS],
    note: null,
    resolution: null,
  };

  if (preAuth && planIntact) {
    task.chosenAltId = preAuth.altId;
    task.chosenHotelId = preAuth.hotelId;
    task.chosenCabId = preAuth.cabId;
    task.note = 'You authorised this in advance, so there was no window to wait for — we acted the moment the airline filed.';
    task.phase = 'acting';
    store.setRecoveryTask(task);
    scheduleAct(flight.id, passenger.id);
    return;
  }

  if (preAuth && !planIntact) {
    task.note = 'You had authorised a plan, but part of it is no longer available. We are not substituting something you never saw — over to you.';
  }
  task.chosenAltId = flight.candidates.alts.find((a) => a.ok)?.id ?? flight.candidates.alts[0]?.id ?? '';
  task.chosenHotelId = flight.candidates.hotels[0]?.id ?? '';
  task.chosenCabId = flight.candidates.cabs[0]?.id ?? '';
  task.windowExpiresAt = Date.now() + QUIET_WINDOW_SECONDS * 1000;
  store.setRecoveryTask(task);
  setTimeout(() => settleExpired(flight.id, passenger.id), QUIET_WINDOW_SECONDS * 1000);
}

/** The window ran out with nobody having acted — resolves it on schedule regardless of whether anyone is watching. */
function settleExpired(flightId: string, passengerId: string) {
  const task = store.getRecoveryTask(flightId, passengerId);
  const flight = store.getFlight(flightId);
  const passenger = store.getPassenger(passengerId);
  if (!task || !flight || !passenger || task.resolution || task.phase !== 'waiting') return;

  const owedNow = owedFor(flight, task);
  let resolution: DisruptionResolution;
  // Silence means different things depending on what was asked for — but consent
  // gates SPENDING, not care. If the recovery costs nothing there is nothing to
  // consent to, and stranding someone because they didn't pick up is worse.
  if (passenger.consent === 'autopilot') {
    task.note = "You didn't answer, so we went ahead — that's the permission you gave us.";
    resolution = { kind: 'autopilot', at: Date.now(), altId: task.chosenAltId, hotelId: task.chosenHotelId, cabId: task.chosenCabId };
  } else if (owedNow === 0) {
    task.note = "You didn't answer. This costs you nothing, so we booked it rather than leave you stranded — there was no spend to ask about.";
    resolution = { kind: 'autopilot', at: Date.now(), altId: task.chosenAltId, hotelId: task.chosenHotelId, cabId: task.chosenCabId };
  } else {
    task.note = `You didn't answer, and this one would cost you ${money(owedNow)} — so we stopped. Nothing was booked and nothing was charged. Your seats are still held.`;
    resolution = { kind: 'handed-over', at: Date.now() };
  }
  finalizeResolution(task, resolution);
}

function finalizeResolution(task: RecoveryTask, resolution: DisruptionResolution) {
  if (task.resolution) { store.setRecoveryTask(task); return; } // first wins
  task.resolution = resolution;
  if (resolution.kind === 'handed-over') {
    task.phase = 'handed';
  } else {
    task.chosenAltId = resolution.altId;
    task.chosenHotelId = resolution.hotelId;
    task.chosenCabId = resolution.cabId;
    task.phase = 'acting';
    store.setRecoveryTask(task);
    scheduleAct(task.flightId, task.passengerId);
    return;
  }
  store.setRecoveryTask(task);
}

function renderActStepBody(raw: Step, task: RecoveryTask, flight: Flight, booking: Booking): string {
  const alt = flight.candidates.alts.find((a) => a.id === task.chosenAltId);
  const hotel = flight.candidates.hotels.find((h) => h.id === task.chosenHotelId);
  const cab = flight.candidates.cabs.find((c) => c.id === task.chosenCabId);
  const owedNow = owedFor(flight, task);
  switch (raw.live) {
    case 'seat':
      return alt ? `${alt.code} at ${alt.dep}, seat ${booking.seat}. The airline cancelled, so the fare difference is theirs — you pay nothing.` : raw.s;
    case 'van':
      return `A single-use card locked to ${owedNow ? money(owedNow) : '₹0'} and today's date — exactly the plan you were shown, and it cannot be reused or overspent.`;
    case 'hotel':
      return hotel ? `${hotel.name}, check-in ${hotel.checkin}. ${hotel.why}.` : raw.s;
    case 'cab': {
      if (!cab) return raw.s;
      const legs = flight.candidates.cabLegs;
      if (legs.length >= 2) return `${cab.kind} booked for both legs — ${legs[0].from} → ${legs[0].to} at ${legs[0].pickup}, and back at ${legs[1].pickup}.`;
      if (legs.length === 1) return `${cab.kind} booked — ${legs[0].from} → ${legs[0].to} at ${legs[0].pickup}.`;
      return raw.s;
    }
    case 'onward': {
      const next = store.getNextLeg(booking.id);
      if (!next) return raw.s;
      return `${next.flight.code} to ${next.flight.to} re-checked and still valid — a no-show on this leg can silently void the rest of an itinerary.`;
    }
    default:
      return raw.s;
  }
}

function scheduleAct(flightId: string, passengerId: string) {
  const flight = store.getFlight(flightId);
  const booking = store.getBookingsForFlight(flightId).find((b) => b.passengerId === passengerId);
  if (!flight || !booking) return;
  // Omit the "onward leg" step entirely when this passenger has no connection —
  // unlike the old single-flight version, this is no longer unconditional.
  const steps = ACT_STEPS.filter((s) => s.live !== 'onward' || store.getNextLeg(booking.id) !== null);

  let i = 0;
  const run = () => {
    const task = store.getRecoveryTask(flightId, passengerId);
    if (!task) return;
    if (i >= steps.length) { task.phase = 'booked'; store.setRecoveryTask(task); return; }
    const raw = steps[i];
    const rendered: Step = { ...raw, s: renderActStepBody(raw, task, flight, booking) };
    task.shown = [...task.shown, rendered];
    store.setRecoveryTask(task);
    i += 1;
    setTimeout(run, Math.max(FLOOR, raw.d * PLAY));
  };
  run();
}

/** Member actions — approve / hand over / browse alternatives / choose / swap / go back. */
export function resolveTask(flightId: string, passengerId: string, action: ResolveAction): RecoveryTask | null {
  const task = store.getRecoveryTask(flightId, passengerId);
  if (!task) return null;
  if (task.resolution) return task; // already resolved — no further action changes anything

  switch (action.kind) {
    case 'browse':
      task.phase = 'choosing';
      task.note = 'You stepped in, so the clock is held. Nothing proceeds while you are deciding.';
      break;
    case 'back':
      task.phase = 'waiting';
      break;
    case 'choose': {
      if (task.chosenAltId !== action.altId && task.chosenAltId) {
        task.rejectedAltIds = task.rejectedAltIds.includes(task.chosenAltId)
          ? task.rejectedAltIds
          : [...task.rejectedAltIds, task.chosenAltId];
      }
      task.chosenAltId = action.altId;
      task.note = 'Swapped. The one we had picked is now permanently excluded — it can never be re-proposed.';
      task.phase = 'waiting';
      break;
    }
    case 'swap-hotel': {
      const flight = store.getFlight(flightId);
      const hotel = flight?.candidates.hotels.find((h) => h.id === action.hotelId);
      task.chosenHotelId = action.hotelId;
      task.note = hotel ? `Room swapped to ${hotel.name}.` : task.note;
      break;
    }
    case 'swap-cab': {
      const flight = store.getFlight(flightId);
      const cab = flight?.candidates.cabs.find((c) => c.id === action.cabId);
      task.chosenCabId = action.cabId;
      task.note = cab ? `Cab swapped to ${cab.kind}.` : task.note;
      break;
    }
    case 'approve': {
      task.note = 'You approved it, so we went straight through.';
      finalizeResolution(task, { kind: 'approved', at: Date.now(), altId: task.chosenAltId, hotelId: task.chosenHotelId, cabId: task.chosenCabId });
      return store.getRecoveryTask(flightId, passengerId) ?? task;
    }
    case 'hand-over': {
      task.note = 'You took the wheel. We stopped immediately — nothing confirmed, nothing paid, and your held seats stay held.';
      finalizeResolution(task, { kind: 'handed-over', at: Date.now() });
      return store.getRecoveryTask(flightId, passengerId) ?? task;
    }
  }
  store.setRecoveryTask(task);
  return task;
}

/** Assembles the response shape a passenger's device polls — everything app/recovery/[id]/page.tsx needs to render, computed here, not on the client. */
export function getRecoveryView(flightId: string, passengerId: string): RecoveryView | null {
  ensureSeeded();
  const event = store.getDisruptionEvent(flightId);
  if (!event) return null;
  const flight = store.getFlight(flightId);
  if (!flight) return null;

  if (event.phase === 'DECIDING') {
    return {
      taskId: null, flightId, detectedAt: event.detectedAt, phase: 'deciding',
      shown: [], secondsLeft: QUIET_WINDOW_SECONDS,
      chosenAltId: '', chosenHotelId: '', chosenCabId: '', rejectedAltIds: [],
      owedNow: 0, note: null, resolution: null,
    };
  }

  const task = store.getRecoveryTask(flightId, passengerId);
  if (!task) return null; // this passenger has no booking on this flight

  const secondsLeft = task.phase === 'waiting'
    ? Math.max(0, Math.ceil((task.windowExpiresAt - Date.now()) / 1000))
    : 0;

  return {
    taskId: task.id, flightId, detectedAt: event.detectedAt, phase: task.phase,
    shown: task.shown, secondsLeft,
    chosenAltId: task.chosenAltId, chosenHotelId: task.chosenHotelId, chosenCabId: task.chosenCabId,
    rejectedAltIds: task.rejectedAltIds,
    owedNow: owedFor(flight, task), note: task.note, resolution: task.resolution,
  };
}
