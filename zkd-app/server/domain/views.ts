/** Response-shaping helpers — turn domain entities into the API contract shapes in lib/apiTypes.ts. */
import * as store from './store';
import type { Flight } from './types';
import type { FlightSummary, FlightDetail, DisruptionOpsView } from '@/lib/apiTypes';

export function toFlightSummary(flight: Flight, passengerId?: string): FlightSummary {
  const event = store.getDisruptionEvent(flight.id);
  const bookings = store.getBookingsForFlight(flight.id);
  const summary: FlightSummary = {
    id: flight.id, code: flight.code, from: flight.from, to: flight.to,
    depISO: flight.depISO, durationMin: flight.durationMin,
    aircraft: flight.aircraft, terminal: flight.terminal,
    riskPct: flight.riskPct, riskBand: flight.riskBand,
    passengerCount: bookings.length,
    disruptionPhase: event?.phase ?? 'none',
  };
  if (passengerId) {
    const b = bookings.find((x) => x.passengerId === passengerId);
    if (b) summary.booking = { id: b.id, seat: b.seat, pnr: b.pnr, cabin: b.cabin };
  }
  return summary;
}

export function toFlightDetail(flight: Flight): FlightDetail {
  const bookings = store.getBookingsForFlight(flight.id).map((b) => ({
    id: b.id, passengerId: b.passengerId,
    passengerName: store.getPassenger(b.passengerId)?.displayName ?? b.passengerId,
    seat: b.seat, pnr: b.pnr,
  }));
  return {
    ...toFlightSummary(flight),
    signals: flight.signals,
    candidates: flight.candidates,
    bookings,
  };
}

export function toDisruptionOpsView(flightId: string): DisruptionOpsView | null {
  const event = store.getDisruptionEvent(flightId);
  const flight = store.getFlight(flightId);
  if (!event || !flight) return null;
  const tasks = store.getRecoveryTasksForFlight(flightId).map((t) => ({
    passengerId: t.passengerId,
    passengerName: store.getPassenger(t.passengerId)?.displayName ?? t.passengerId,
    phase: t.phase,
    secondsLeft: t.phase === 'waiting' ? Math.max(0, Math.ceil((t.windowExpiresAt - Date.now()) / 1000)) : 0,
    resolution: t.resolution,
  }));
  return { flightId, flightCode: flight.code, detectedAt: event.detectedAt, phase: event.phase, tasks };
}
