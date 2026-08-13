/** Response-shaping helpers — turn domain entities into the API contract shapes in lib/apiTypes.ts. */
import * as store from './store';
import { refreshIfStale } from '../engine/forecast';
import { refreshAltsIfStale } from '../engine/altsCache';
import { altsForParty } from './altsForParty';
import { costFor } from './pricing';
import { DEFAULT_PER_TRANSACTION_CAP } from '../myca';
import type { Flight, Booking } from './types';
import type { FlightSummary, FlightDetail, DisruptionOpsView } from '@/lib/apiTypes';

function travellerSummary(b: Booking) {
  return store.getTravellersForBooking(b).map((t, i) => ({
    id: t.id,
    displayName: t.displayName,
    type: t.type,
    seat: b.seats[i]?.seat ?? b.seat,
  }));
}

export function toFlightSummary(flight: Flight, passengerId?: string): FlightSummary {
  // Kick a refresh if the cached forecast/alts have aged out. Deliberately not
  // awaited: a device asking for a flight gets whatever we hold now, and the
  // next poll picks up the fresh numbers rather than blocking this response
  // on a vendor.
  refreshIfStale(flight);
  refreshAltsIfStale(flight);
  const event = store.getDisruptionEvent(flight.id);
  const bookings = store.getBookingsForFlight(flight.id);
  const summary: FlightSummary = {
    id: flight.id, code: flight.code, from: flight.from, to: flight.to,
    depISO: flight.depISO, durationMin: flight.durationMin,
    aircraft: flight.aircraft, terminal: flight.terminal,
    forecast: flight.forecast,
    // Tickets, not PNRs — a single booking can cover a party of six.
    passengerCount: bookings.reduce((n, b) => n + store.partySize(b), 0),
    disruptionPhase: event?.phase ?? 'none',
  };
  if (passengerId) {
    const b = bookings.find((x) => x.passengerId === passengerId);
    if (b) {
      summary.booking = {
        id: b.id, seat: b.seat, pnr: b.pnr, cabin: b.cabin,
        partySize: store.partySize(b),
        travellers: travellerSummary(b),
      };
    }
  }
  return summary;
}

/**
 * `viewerPassengerId` is required, not optional: this is what makes the
 * response both party-aware (alts are projected through altsForParty for the
 * VIEWER's own party size) and privacy-correct (bookings is filtered to the
 * viewer's own row — without this, every co-passenger's name, seat and PNR
 * would be visible to anyone who could reach this flight's id).
 */
export function toFlightDetail(flight: Flight, viewerPassengerId: string): FlightDetail {
  const bookings = store.getBookingsForFlight(flight.id);
  const own = bookings.find((b) => b.passengerId === viewerPassengerId);
  const partySize = own ? store.partySize(own) : 1;

  return {
    ...toFlightSummary(flight, viewerPassengerId),
    candidates: {
      ...flight.candidates,
      alts: altsForParty(flight.candidates.alts, partySize),
    },
    connectionSlackMinutes: flight.connectionSlackMinutes,
    hasHardConstraint: flight.hasHardConstraint,
    rescheduledToISO: flight.rescheduledToISO,
    bookings: own
      ? [{ id: own.id, passengerId: own.passengerId, passengerName: store.getPassenger(own.passengerId)?.displayName ?? own.passengerId, seat: own.seat, pnr: own.pnr, partySize }]
      : [],
  };
}

export function toDisruptionOpsView(flightId: string): DisruptionOpsView | null {
  const event = store.getDisruptionEvent(flightId);
  const flight = store.getFlight(flightId);
  if (!event || !flight) return null;
  const tasks = store.getRecoveryTasksForFlight(flightId).map((t) => {
    const alt = flight.candidates.alts.find((a) => a.id === t.chosenAltId);
    return {
      passengerId: t.passengerId,
      passengerName: store.getPassenger(t.passengerId)?.displayName ?? t.passengerId,
      phase: t.phase,
      secondsLeft: t.phase === 'waiting' ? Math.max(0, Math.ceil((t.windowExpiresAt - Date.now()) / 1000)) : 0,
      partySize: t.partySize,
      chosenAltCode: alt?.code ?? null,
      owedNow: costFor(flight, t, t.partySize, DEFAULT_PER_TRANSACTION_CAP).total,
      resolution: t.resolution,
    };
  });
  return { flightId, flightCode: flight.code, detectedAt: event.detectedAt, phase: event.phase, tasks };
}
