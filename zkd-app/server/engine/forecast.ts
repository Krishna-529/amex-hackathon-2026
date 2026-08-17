/**
 * Keeps each flight's disruption forecast fresh.
 *
 * Risk is a standing prediction on any upcoming flight, not something that only
 * exists once a disruption has been caught — the flights list shows a gauge and
 * offers pre-authorisation *before* anything has gone wrong, which is the whole
 * point of pre-auth. But unlike the old local model, the forecast is now bought
 * from a vendor, so it cannot be computed synchronously inside createFlight().
 * It is fetched here and cached on the Flight.
 *
 * The thresholds it is judged against are computed alongside it, because they
 * depend on how much inventory is actually left on the route — which means the
 * bar for acting moves as seats disappear, not just as the probability climbs.
 */

import { forecast as lumoForecast } from '../lumo';
import { searchInventory, seatsAcross } from '../suppliers';
import { thresholdsFor, bandFor, BAND_TONE } from '@/lib/thresholds';
import * as store from '../domain/store';
import type { Flight, FlightForecast } from '../domain/types';

/** How long a cached forecast is considered current. */
const TTL_MS = 10 * 60 * 1000;

const inFlight = new Map<string, Promise<FlightForecast | null>>();

export function isStale(f: Flight): boolean {
  return !f.forecast || Date.now() - f.forecast.asOf > TTL_MS;
}

/**
 * Fetches and caches. Concurrent callers for the same flight share one request —
 * five devices polling the same flight must not become five vendor calls.
 */
export async function refreshForecast(flightId: string): Promise<FlightForecast | null> {
  const existing = inFlight.get(flightId);
  if (existing) return existing;

  const p = compute(flightId).finally(() => inFlight.delete(flightId));
  inFlight.set(flightId, p);
  return p;
}

async function compute(flightId: string): Promise<FlightForecast | null> {
  const flight = store.getFlight(flightId);
  if (!flight) return null;

  const departsAt = new Date(flight.depISO).getTime();
  const date = flight.depISO.slice(0, 10);

  const [forecasts, inventory] = await Promise.all([
    lumoForecast([
      { flightIata: flight.code.replace(/\s+/g, ''), from: flight.from, to: flight.to, date },
    ]),
    searchInventory({ origin: flight.from, destination: flight.to, departureDate: date }),
  ]);

  const f = forecasts[0];
  if (!f) return null;

  // Seats we can actually see across every supplier — the scarcity input. Falls
  // back to the seeded candidates when no supplier returned anything, so the
  // threshold never treats a dead sandbox as a sold-out route.
  const seatsAvailable = inventory.offers.length
    ? seatsAcross(inventory.offers)
    : flight.candidates.alts.filter((a) => a.ok).reduce((n, a) => n + a.seats, 0);

  const thresholds = thresholdsFor({
    seatsAvailable,
    // The forecast is per flight, but scarcity is felt per party. Until bookings
    // are grouped by PNR this is the single-traveller case, which is what the
    // factor reduces to anyway; the largest party on the flight belongs here.
    partySize: 1,
    minutesToDeparture: Math.max(0, Math.round((departsAt - Date.now()) / 60_000)),
    hasHardConstraint: flight.hasHardConstraint,
    confidence: f.confidence,
  });

  const pct = Math.round(f.cancelProbability * 100);
  const band = bandFor(pct, thresholds);

  const out: FlightForecast = {
    pct,
    band,
    tone: BAND_TONE[band],
    connectionRisk: f.connectionRisk,
    confidence: f.confidence,
    source: f.source,
    thresholds,
    asOf: Date.now(),
  };

  flight.forecast = out;
  return out;
}

/**
 * Non-blocking refresh for read paths. A page asking for a flight should render
 * whatever forecast we already hold rather than waiting on a vendor round trip;
 * the next poll picks up the fresh one.
 */
export function refreshIfStale(flight: Flight): void {
  if (!isStale(flight)) return;
  void refreshForecast(flight.id).catch(() => {});
}
