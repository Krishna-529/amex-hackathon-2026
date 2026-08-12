/**
 * Lumo (thinklumo.com) — the commercial disruption-prediction API the deck buys
 * rather than builds. We do not have a commercial key, so every call falls back
 * to a deterministic mock and says so in `source`. Nothing in the UI or the
 * ledger is allowed to present a mocked probability as a vendor one.
 *
 * Shaped against Lumo's published surface: a Flights API for per-leg risk, and a
 * Subscription API that pushes schedule changes and cancellations by webhook —
 * the latter is what makes reschedule detection possible at all (see
 * lib/disruptionKind.ts).
 */

import { getOrSet } from './cache';

export type FlightLeg = {
  /** carrier + number, e.g. "AI2803" */
  flightIata: string;
  from: string;
  to: string;
  /** ISO date of scheduled departure */
  date: string;
};

/** null maxMinutes is Lumo's terminal bucket: 4h+ or cancelled. */
export type DelayBucket = { maxMinutes: number | null; p: number };

export type DisruptionForecast = {
  flightKey: string;
  cancelProbability: number;
  delayBuckets: DelayBucket[];
  /** risk to the onward connection, where the trip has one */
  connectionRisk: number | null;
  /** how much the forecast trusts itself — feeds threshold adaptation */
  confidence: number;
  source: 'lumo' | 'mock';
  asOf: number;
};

const keyOf = (leg: FlightLeg) => `${leg.flightIata}:${leg.date}`;

export async function forecast(legs: FlightLeg[]): Promise<DisruptionForecast[]> {
  const key = process.env.LUMO_API_KEY;
  if (!key) return legs.map(mockForecast);

  try {
    const res = await fetch('https://api.thinklumo.com/v2/flights/predict', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        flights: legs.map((l) => ({
          flight_number: l.flightIata,
          origin: l.from,
          destination: l.to,
          departure_date: l.date,
        })),
      }),
      cache: 'no-store',
    });
    if (!res.ok) return legs.map(mockForecast);
    const json = (await res.json()) as { predictions?: unknown[] };
    const parsed = (json.predictions ?? []).map(parseLumo).filter((f): f is DisruptionForecast => f !== null);
    return parsed.length === legs.length ? parsed : legs.map(mockForecast);
  } catch {
    return legs.map(mockForecast);
  }
}

type LumoPrediction = {
  flight_key?: string;
  cancellation_probability?: number;
  delay_distribution?: { max_minutes: number | null; probability: number }[];
  connection_risk?: number;
  confidence?: number;
};

function parseLumo(raw: unknown): DisruptionForecast | null {
  const p = raw as LumoPrediction;
  if (typeof p?.cancellation_probability !== 'number') return null;
  return {
    flightKey: p.flight_key ?? '',
    cancelProbability: clamp01(p.cancellation_probability),
    delayBuckets: (p.delay_distribution ?? []).map((b) => ({
      maxMinutes: b.max_minutes,
      p: clamp01(b.probability),
    })),
    connectionRisk: typeof p.connection_risk === 'number' ? clamp01(p.connection_risk) : null,
    confidence: typeof p.confidence === 'number' ? clamp01(p.confidence) : 0.5,
    source: 'lumo',
    asOf: Date.now(),
  };
}

/**
 * The three legs in the demo trip, pinned so the scenario is reachable.
 *
 * Without this the mock hashes to whatever the date makes it, and the Chennai
 * leg — the one the entire walkthrough is about — reads 11% and never crosses
 * its own threshold, so the early-ask flow simply cannot be demonstrated. These
 * are fixtures for a story, and they still report `source: 'mock'` so nothing on
 * screen claims otherwise.
 */
const DEMO_FIXTURES: Record<string, number> = {
  AI2803: 0.83, // Priya's Chennai leg — the one that cancels
  AI2201: 0.09, // the London connection it feeds
  '6E5192': 0.21, // a later, unremarkable flight
};

/**
 * Deterministic from the flight key otherwise, so the demo tells the same story
 * twice and reproducibility survives. This is a stand-in for a vendor model, not
 * an estimate of anything — hence the low confidence it reports.
 */
function mockForecast(leg: FlightLeg): DisruptionForecast {
  const k = keyOf(leg);
  const h = hash(k);
  const fixture = DEMO_FIXTURES[leg.flightIata.replace(/\s+/g, '')];
  const cancelProbability = fixture ?? clamp01(((h % 1000) / 1000) * 0.9);
  const remaining = 1 - cancelProbability;
  return {
    flightKey: k,
    cancelProbability,
    delayBuckets: [
      { maxMinutes: 15, p: remaining * 0.55 },
      { maxMinutes: 60, p: remaining * 0.25 },
      { maxMinutes: 180, p: remaining * 0.14 },
      { maxMinutes: 240, p: remaining * 0.06 },
      { maxMinutes: null, p: cancelProbability },
    ],
    connectionRisk: clamp01(((hash(k + ':conn') % 1000) / 1000) * 0.8),
    confidence: 0.35,
    source: 'mock',
    asOf: Date.now(),
  };
}

export type SubscriptionRef = { id: string; source: 'lumo' | 'mock' };

/**
 * Registers a trip for push updates. Lumo's Subscription API is what delivers
 * schedule changes — without it a reschedule is only visible by polling flight
 * status and diffing against the booked time.
 */
export async function subscribe(legs: FlightLeg[]): Promise<SubscriptionRef> {
  const key = process.env.LUMO_API_KEY;
  const webhook = process.env.LUMO_WEBHOOK_URL;
  if (!key || !webhook) return { id: `mock:${legs.map(keyOf).join(',')}`, source: 'mock' };

  try {
    const res = await fetch('https://api.thinklumo.com/v2/subscriptions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        webhook_url: webhook,
        events: ['schedule_change', 'cancellation', 'delay_prediction'],
        flights: legs.map((l) => ({
          flight_number: l.flightIata,
          origin: l.from,
          destination: l.to,
          departure_date: l.date,
        })),
      }),
      cache: 'no-store',
    });
    if (!res.ok) return { id: `mock:${legs.map(keyOf).join(',')}`, source: 'mock' };
    const json = (await res.json()) as { id?: string };
    return json.id ? { id: json.id, source: 'lumo' } : { id: 'mock', source: 'mock' };
  } catch {
    return { id: `mock:${legs.map(keyOf).join(',')}`, source: 'mock' };
  }
}

/** Airport-level disruption, used as the scarcity hint when a whole hub is degrading. */
export async function airportOutlook(iata: string): Promise<{ disruptionIndex: number; source: 'lumo' | 'mock' }> {
  const key = process.env.LUMO_API_KEY;
  if (!key) return { disruptionIndex: clamp01((hash(iata) % 1000) / 1000 * 0.6), source: 'mock' };

  return getOrSet(`lumo:airport:${iata}`, 10 * 60 * 1000, async () => {
    const res = await fetch(`https://api.thinklumo.com/v2/airports/${encodeURIComponent(iata)}/outlook`, {
      headers: { Authorization: `Bearer ${key}` },
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`lumo airport ${res.status}`);
    const json = (await res.json()) as { disruption_index?: number };
    return { disruptionIndex: clamp01(json.disruption_index ?? 0), source: 'lumo' as const };
  }).catch(() => ({ disruptionIndex: clamp01((hash(iata) % 1000) / 1000 * 0.6), source: 'mock' as const }));
}

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}
