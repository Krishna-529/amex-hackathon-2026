/**
 * Every airport with an IATA code — 6,072 of them, from the OpenFlights dataset.
 *
 * This replaced a hand-written table of seven airports, which was the single
 * hard blocker on the product working outside one Indian demo route. It lives
 * server-side deliberately: the dataset is ~430 KB and has no business in a
 * client bundle, so pages pass IATA codes and the server resolves them.
 *
 * Timezone is the field that matters most once routes cross zones. A reschedule
 * is detected by diffing departure times, and comparing a local clock in Chennai
 * with one in London without zone information produces a nine-hour "delay" that
 * never happened.
 */

import raw from './airports.json';

export type Airport = {
  iata: string;
  icao: string;
  city: string;
  country: string;
  /** IANA zone, e.g. "Asia/Kolkata"; empty when the source had none */
  timezone: string;
  lat: number;
  lon: number;
};

type Row = [string, string, string, string, string, number, number];

const index: Map<string, Airport> = new Map(
  (raw as Row[]).map((r) => [
    r[0],
    { iata: r[0], icao: r[1], city: r[2], country: r[3], timezone: r[4], lat: r[5], lon: r[6] },
  ]),
);

export function airport(iata: string): Airport | null {
  return index.get(iata.toUpperCase()) ?? null;
}

export function cityOf(iata: string): string | null {
  return airport(iata)?.city ?? null;
}

/**
 * Which duty-of-care regime governs this route.
 *
 * Entitlement is data, not code — the market changes the bundle, never the
 * engine. Two regimes are enough to prove that: India's DGCA CAR Section 3, and
 * EU261 for the EU/UK. Everywhere else falls back to the card product's own
 * benefit terms, which is what Amex actually relies on in most of the 130+
 * countries it operates in.
 */
export type Jurisdiction = 'IN-DGCA' | 'EU261' | 'CARD-TERMS';

const EU261_COUNTRIES = new Set([
  'Austria', 'Belgium', 'Bulgaria', 'Croatia', 'Cyprus', 'Czech Republic', 'Denmark', 'Estonia',
  'Finland', 'France', 'Germany', 'Greece', 'Hungary', 'Iceland', 'Ireland', 'Italy', 'Latvia',
  'Lithuania', 'Luxembourg', 'Malta', 'Netherlands', 'Norway', 'Poland', 'Portugal', 'Romania',
  'Slovakia', 'Slovenia', 'Spain', 'Sweden', 'Switzerland', 'United Kingdom',
]);

function regimeOf(iata: string): Jurisdiction | null {
  const ap = airport(iata);
  if (!ap) return null;
  if (ap.country === 'India') return 'IN-DGCA';
  if (EU261_COUNTRIES.has(ap.country)) return 'EU261';
  return null;
}

/**
 * EU261 attaches to departures from the EU/UK on any carrier, and to arrivals
 * into the EU/UK on an EU carrier. We do not model carrier nationality yet, so
 * we take the departure rule — the one that always holds — and note the gap.
 * DGCA governs Indian departures the same way.
 */
export function jurisdictionFor(from: string, to: string): Jurisdiction {
  return regimeOf(from) ?? regimeOf(to) ?? 'CARD-TERMS';
}

/** Great-circle distance in km — shared by riskModel.ts's distance_km feature
 *  and the mock supplier generators, so a route's "real" distance is computed
 *  once, not re-derived per caller. */
export function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function isInternational(from: string, to: string): boolean {
  const a = airport(from);
  const b = airport(to);
  if (!a || !b) return false;
  return a.country !== b.country;
}

/** Local wall-clock time at an airport, for departure and arrival display. */
export function localTime(iata: string, at: number): string {
  const tz = airport(iata)?.timezone;
  try {
    return new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: tz || 'UTC',
    }).format(new Date(at));
  } catch {
    return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }).format(
      new Date(at),
    );
  }
}

const ISO_WEEKDAY: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/**
 * Local calendar components (hour 0-23, ISO day-of-week 1=Mon..7=Sun, month
 * 1-12) at an airport's own timezone — NOT the UTC components of the same
 * instant. This is the fix for a real train/serve skew: zkd-risk-model's
 * training data (src/ingest_bts.py's CRSDepTime, src/ingest_anac.py's
 * "Partida Prevista") is origin-airport LOCAL wall-clock time with no
 * timezone attached, so features.py's hour_of_day/day_of_week/month are all
 * local-time features. Before this function existed,
 * server/engine/riskModel.ts computed them via `Date.getUTCHours()` etc. on
 * `flight.depISO` — the UTC calendar components of an absolute instant,
 * which only agree with local time for a UTC+0 airport. For India
 * (UTC+5:30, no DST) this was a constant, silent 5.5-hour shift on every
 * live prediction — is_redeye (5.5h off is almost always enough to flip it)
 * and hour_of_day are the 9th- and 5th-highest-gain features in the trained
 * model (reports/model_metrics.json), not minor ones.
 *
 * Falls back to UTC components when the airport or its timezone is unknown
 * (empty string in the IATA source data) — a defined, honest degradation,
 * not a crash, matching this file's existing null-airport handling.
 */
export function localDateParts(iata: string, at: number): { hour: number; dayOfWeek: number; month: number } {
  const tz = airport(iata)?.timezone;
  const date = new Date(at);
  if (!tz) {
    return { hour: date.getUTCHours(), dayOfWeek: date.getUTCDay() === 0 ? 7 : date.getUTCDay(), month: date.getUTCMonth() + 1 };
  }
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour: 'numeric', hour12: false, weekday: 'short', month: 'numeric',
    });
    const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value] as const));
    // Some ICU builds render midnight as "24" under hour12:false rather than "0".
    const hour = Number(parts.hour) % 24;
    const dayOfWeek = ISO_WEEKDAY[parts.weekday ?? ''] ?? (date.getUTCDay() === 0 ? 7 : date.getUTCDay());
    const month = Number(parts.month);
    return { hour, dayOfWeek, month };
  } catch {
    return { hour: date.getUTCHours(), dayOfWeek: date.getUTCDay() === 0 ? 7 : date.getUTCDay(), month: date.getUTCMonth() + 1 };
  }
}
