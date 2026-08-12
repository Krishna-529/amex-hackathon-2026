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
