import { getOrSet, noteAviationstackCall } from './cache';

/**
 * AviationStack free tier: 100 requests/month, 1 req/60s. Purely informational in
 * this app — never feeds the numeric risk signals — and cached per flight per
 * calendar day so revisiting a page never re-spends the budget.
 */

type RawFlight = {
  flight_date: string;
  flight_status: string;
  departure: { delay: number | null };
  arrival: { delay: number | null };
};

export type FlightStatusMatch = {
  flightStatus: string;
  depDelayMin: number | null;
  arrDelayMin: number | null;
} | null;

export async function lookupFlightStatus(flightIata: string): Promise<FlightStatusMatch> {
  const key = process.env.AVIATIONSTACK_API_KEY;
  if (!key) return null;

  const today = new Date().toISOString().slice(0, 10);
  return getOrSet(`aviationstack:${flightIata}:${today}`, 24 * 60 * 60 * 1000, async () => {
    try {
      noteAviationstackCall();
      const url = `http://api.aviationstack.com/v1/flights?access_key=${encodeURIComponent(key)}&flight_iata=${encodeURIComponent(flightIata)}`;
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) return null;
      const json = (await res.json()) as { data: RawFlight[] };
      const match = json.data?.find((f) => f.flight_date === today) ?? json.data?.[0];
      if (!match) return null;
      return {
        flightStatus: match.flight_status,
        depDelayMin: match.departure.delay,
        arrDelayMin: match.arrival.delay,
      };
    } catch {
      return null;
    }
  });
}
