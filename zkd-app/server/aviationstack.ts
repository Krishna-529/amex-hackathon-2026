import { getOrSet, noteAviationstackCall } from './cache';

/**
 * AviationStack free tier: 100 requests/month, 1 req/60s. Cached per flight per
 * calendar day so revisiting a page never re-spends the budget.
 *
 * We read the scheduled and estimated departure times, not just the delay,
 * because a reschedule is a change to the SCHEDULE — the carrier moves the
 * flight and the delay against that new schedule reads as zero. Diffing
 * `scheduled` against what the member actually booked is the only way to see it
 * (lib/disruptionKind.ts). This is also our independent observation of what
 * really happened, which is what a vendor forecast eventually gets scored against.
 */

type RawFlight = {
  flight_date: string;
  flight_status: string;
  departure: { delay: number | null; scheduled?: string | null; estimated?: string | null };
  arrival: { delay: number | null; scheduled?: string | null; estimated?: string | null };
};

export type FlightStatusMatch = {
  flightStatus: string;
  depDelayMin: number | null;
  arrDelayMin: number | null;
  /** epoch ms of the carrier's current published departure, null when not given */
  depScheduledAt: number | null;
  depEstimatedAt: number | null;
  arrScheduledAt: number | null;
} | null;

function epoch(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

export async function lookupFlightStatus(flightIata: string): Promise<FlightStatusMatch> {
  const key = process.env.AVIATIONSTACK_API_KEY;
  if (!key) return null;

  const today = new Date().toISOString().slice(0, 10);
  return getOrSet(`aviationstack:${flightIata}:${today}`, 24 * 60 * 60 * 1000, async () => {
    try {
      noteAviationstackCall();
      const url = `http://api.aviationstack.com/v1/flights?access_key=${encodeURIComponent(key)}&flight_iata=${encodeURIComponent(flightIata)}`;
      const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
      if (!res.ok) return null;
      const json = (await res.json()) as { data: RawFlight[] };
      const match = json.data?.find((f) => f.flight_date === today) ?? json.data?.[0];
      if (!match) return null;
      return {
        flightStatus: match.flight_status,
        depDelayMin: match.departure.delay,
        arrDelayMin: match.arrival.delay,
        depScheduledAt: epoch(match.departure.scheduled),
        depEstimatedAt: epoch(match.departure.estimated),
        arrScheduledAt: epoch(match.arrival.scheduled),
      };
    } catch {
      return null;
    }
  });
}
