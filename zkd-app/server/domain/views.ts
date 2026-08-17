/** Response-shaping helpers — turn domain entities into the API contract shapes in lib/apiTypes.ts. */
import * as store from './store';
import { refreshIfStale } from '../engine/forecast';
import { altsForParty } from './altsForParty';
import { costFor } from './pricing';
import { DEFAULT_PER_TRANSACTION_CAP } from '../myca';
import type { Flight, Booking } from './types';
import type { FlightSummary, FlightDetail, DisruptionOpsView } from '@/lib/apiTypes';

async function travellerSummary(b: Booking) {
  const travellers = await store.getTravellersForBooking(b);
  return travellers.map((t, i) => ({
    id: t.id,
    displayName: t.displayName,
    type: t.type,
    seat: b.seats[i]?.seat ?? b.seat,
  }));
}

export async function toFlightSummary(flight: Flight, passengerId?: string): Promise<FlightSummary> {
  // Kick a forecast refresh if it has aged out. Deliberately not awaited: a
  // device asking for a flight gets whatever we hold now, and the next poll
  // picks up the fresh number. Alternative-flight search is NOT kicked from
  // here any more — it is gated on the forecast's own risk band inside
  // refreshForecast/compute() (server/engine/forecast.ts), so a page view on
  // a low-risk flight never spends a supplier search it doesn't need.
  refreshIfStale(flight);
  const event = await store.getDisruptionEvent(flight.id);
  const bookings = await store.getBookingsForFlight(flight.id);
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
        travellers: await travellerSummary(b),
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
export async function toFlightDetail(flight: Flight, viewerPassengerId: string): Promise<FlightDetail> {
  const bookings = await store.getBookingsForFlight(flight.id);
  const own = bookings.find((b) => b.passengerId === viewerPassengerId);
  const partySize = own ? store.partySize(own) : 1;
  const summary = await toFlightSummary(flight, viewerPassengerId);

  return {
    ...summary,
    candidates: {
      ...flight.candidates,
      alts: altsForParty(flight.candidates.alts, partySize),
    },
    connectionSlackMinutes: flight.connectionSlackMinutes,
    hasHardConstraint: flight.hasHardConstraint,
    rescheduledToISO: flight.rescheduledToISO,
    forecastHistory: flight.forecastHistory ?? [],
    bookings: own
      ? [{ id: own.id, passengerId: own.passengerId, passengerName: (await store.getPassenger(own.passengerId))?.displayName ?? own.passengerId, seat: own.seat, pnr: own.pnr, partySize }]
      : [],
  };
}

export async function toDisruptionOpsView(flightId: string): Promise<DisruptionOpsView | null> {
  const event = await store.getDisruptionEvent(flightId);
  const flight = await store.getFlight(flightId);
  if (!event || !flight) return null;
  const rawTasks = await store.getRecoveryTasksForFlight(flightId);
  const tasks = await Promise.all(rawTasks.map(async (t) => {
    const alt = flight.candidates.alts.find((a) => a.id === t.chosenAltId);
    return {
      passengerId: t.passengerId,
      passengerName: (await store.getPassenger(t.passengerId))?.displayName ?? t.passengerId,
      phase: t.phase,
      secondsLeft: t.phase === 'waiting' ? Math.max(0, Math.ceil((t.windowExpiresAt - Date.now()) / 1000)) : 0,
      partySize: t.partySize,
      chosenAltCode: alt?.code ?? null,
      owedNow: costFor(flight, t, t.partySize, DEFAULT_PER_TRANSACTION_CAP).total,
      resolution: t.resolution,
    };
  }));
  return { flightId, flightCode: flight.code, detectedAt: event.detectedAt, phase: event.phase, tasks };
}
