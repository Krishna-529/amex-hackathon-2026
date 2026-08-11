/**
 * The domain data store. Module-level Maps — process-lifetime only, resets on
 * dev-server restart, same tradeoff already documented in server/cache.ts and
 * (previously) server/disruptionState.ts. Good enough for a demo; a real
 * deployment would back this with a shared store (Postgres/Redis) so it
 * survives restarts and works across multiple server instances.
 */
import type {
  Passenger, Flight, Booking, Itinerary, PreAuthRecord, PastFlight,
  DisruptionEvent, RecoveryTask,
} from './types';

export const flights = new Map<string, Flight>();
export const passengers = new Map<string, Passenger>();
export const bookings = new Map<string, Booking>();
export const itineraries = new Map<string, Itinerary>();
export const preAuths = new Map<string, PreAuthRecord>();          // key: `${flightId}:${passengerId}`
export const pastFlights = new Map<string, PastFlight[]>();        // key: passengerId
export const disruptionEvents = new Map<string, DisruptionEvent>(); // key: flightId — one active event per flight
export const recoveryTasks = new Map<string, RecoveryTask>();      // key: `${flightId}:${passengerId}`

let bookingSeq = 0;
let itinerarySeq = 0;
let taskSeq = 0;

export function createFlight(f: Flight) {
  flights.set(f.id, f);
}

export function listFlights(): Flight[] {
  return [...flights.values()].sort((a, b) => a.depISO.localeCompare(b.depISO));
}

export function getFlight(id: string): Flight | undefined {
  return flights.get(id);
}

export function createPassenger(p: Passenger) {
  passengers.set(p.id, p);
}

export function listPassengers(): Passenger[] {
  return [...passengers.values()];
}

export function getPassenger(id: string): Passenger | undefined {
  return passengers.get(id);
}

export function updateConsent(passengerId: string, consent: Passenger['consent']) {
  const p = passengers.get(passengerId);
  if (p) p.consent = consent;
  return p;
}

export function createBooking(b: Omit<Booking, 'id'>): Booking {
  bookingSeq += 1;
  const booking: Booking = { ...b, id: `bk${bookingSeq}` };
  bookings.set(booking.id, booking);
  return booking;
}

export function getBookingsForFlight(flightId: string): Booking[] {
  return [...bookings.values()].filter((b) => b.flightId === flightId);
}

export function getBooking(id: string): Booking | undefined {
  return bookings.get(id);
}

export function createItinerary(passengerId: string, bookingIds: string[]): Itinerary {
  itinerarySeq += 1;
  const it: Itinerary = { id: `it${itinerarySeq}`, passengerId, bookingIds };
  itineraries.set(it.id, it);
  bookingIds.forEach((bid, i) => {
    const b = bookings.get(bid);
    if (b) { b.itineraryId = it.id; b.legIndex = i; }
  });
  return it;
}

/** A passenger's upcoming flights (their "schedule"), joined Booking → Flight, soonest first. */
export function getScheduleForPassenger(passengerId: string): { booking: Booking; flight: Flight }[] {
  return [...bookings.values()]
    .filter((b) => b.passengerId === passengerId)
    .map((booking) => ({ booking, flight: flights.get(booking.flightId)! }))
    .filter((row) => row.flight)
    .sort((a, b) => a.flight.depISO.localeCompare(b.flight.depISO));
}

/** The next leg after this booking in its itinerary, if any — for "onward leg verified" narration. */
export function getNextLeg(bookingId: string): { booking: Booking; flight: Flight } | null {
  const b = bookings.get(bookingId);
  if (!b?.itineraryId) return null;
  const it = itineraries.get(b.itineraryId);
  if (!it) return null;
  const nextId = it.bookingIds[(b.legIndex ?? 0) + 1];
  if (!nextId) return null;
  const nb = bookings.get(nextId);
  const nf = nb ? flights.get(nb.flightId) : undefined;
  return nb && nf ? { booking: nb, flight: nf } : null;
}

export function getPreAuth(flightId: string, passengerId: string): PreAuthRecord | undefined {
  return preAuths.get(`${flightId}:${passengerId}`);
}

export function setPreAuth(rec: PreAuthRecord) {
  preAuths.set(`${rec.flightId}:${rec.passengerId}`, rec);
}

export function clearPreAuth(flightId: string, passengerId: string) {
  preAuths.delete(`${flightId}:${passengerId}`);
}

export function getPastFlights(passengerId: string): PastFlight[] {
  return pastFlights.get(passengerId) ?? [];
}

export function setPastFlights(passengerId: string, rows: PastFlight[]) {
  pastFlights.set(passengerId, rows);
}

/** Per-route cancellation record for a passenger, same math as the old routeRecord() in lib/data.ts. */
export function routeRecord(passengerId: string, from: string, to: string) {
  const rows = getPastFlights(passengerId).filter((p) => p.from === from && p.to === to);
  return { flown: rows.length, cancelled: rows.filter((p) => p.outcome === 'cancelled').length };
}

export function getDisruptionEvent(flightId: string): DisruptionEvent | undefined {
  return disruptionEvents.get(flightId);
}

export function createDisruptionEvent(ev: DisruptionEvent) {
  disruptionEvents.set(ev.flightId, ev);
}

export function listDisruptionEvents(): DisruptionEvent[] {
  return [...disruptionEvents.values()];
}

export function nextTaskId(): string {
  taskSeq += 1;
  return `rt${taskSeq}`;
}

export function getRecoveryTask(flightId: string, passengerId: string): RecoveryTask | undefined {
  return recoveryTasks.get(`${flightId}:${passengerId}`);
}

export function setRecoveryTask(task: RecoveryTask) {
  recoveryTasks.set(`${task.flightId}:${task.passengerId}`, task);
}

export function getRecoveryTasksForFlight(flightId: string): RecoveryTask[] {
  return [...recoveryTasks.values()].filter((t) => t.flightId === flightId);
}
