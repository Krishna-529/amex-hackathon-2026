/**
 * "I must be there by Saturday" — resolved against the clock on the wall at the
 * airport the member is flying INTO.
 *
 * ── The bug this exists to fix ─────────────────────────────────────────────
 *
 * The booking form used to build the hard deadline as `${date}T23:59:00Z`:
 * end of day in UTC, regardless of where the member was actually landing. On a
 * domestic Indian route that was merely sloppy — 23:59Z is 05:29 the next
 * morning in IST, so the deadline was ~5.5h too GENEROUS and nothing visibly
 * broke. Cross a timezone westward and the same expression flips to being too
 * STRICT: for a DEL->JFK arrival, 23:59Z is 19:59 local in New York, so a
 * member who said "Saturday" silently had every alternative landing Saturday
 * evening ruled out.
 *
 * That matters more than a display bug, because hardDeadlineISO is not a
 * preference — server/pipeline/score.ts treats it as a HARD RULE that
 * disqualifies alternatives outright. Getting it wrong produces exactly the
 * failure app/api/bookings/route.ts already warns about for a deadline set
 * before arrival: "an empty recovery screen and no explanation".
 *
 * ── Why the conversion is done here and not in the browser ─────────────────
 *
 * The client cannot do this. The airport directory (with its IANA zones) is
 * server-side by design, and the browser's OWN timezone is the wrong answer
 * anyway — a member booking from Mumbai for a New York arrival needs New York's
 * end of day, not Mumbai's. So the form now sends a plain calendar date and the
 * server resolves it against the destination.
 */
import { airport } from './airportDirectory';

/**
 * The UTC offset, in ms, in force in `tz` at the instant `at`.
 *
 * Derived by formatting the instant into the zone and reading the wall clock
 * back — the only way to get this right across DST without a tz library, since
 * the offset is a function of the instant, not of the zone alone.
 */
function tzOffsetMs(at: number, tz: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(new Date(at))
      .map((p) => [p.type, p.value] as const),
  );
  const asIfUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    // Some ICU builds render midnight as "24" under hour12:false rather than "0".
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  return asIfUtc - at;
}

/**
 * The absolute instant of a local wall-clock time in `tz`.
 *
 * Two passes, because the offset depends on the very instant we are solving
 * for: guess by treating the wall time as UTC, correct by the offset there,
 * then re-read the offset at the corrected instant and redo the correction if
 * a DST boundary moved it. That second pass is what keeps a deadline on a
 * spring-forward night from landing an hour out.
 */
function wallClockToUtc(date: string, time: string, tz: string): number {
  const naive = Date.parse(`${date}T${time}Z`);
  if (Number.isNaN(naive)) return NaN;
  const firstGuess = naive - tzOffsetMs(naive, tz);
  const settled = naive - tzOffsetMs(firstGuess, tz);
  return settled;
}

/**
 * End of the given calendar day at `iata`, as an ISO instant.
 *
 * Members think in days ("I must be there by Saturday"), so the deadline is the
 * last moment of that day where they are landing. Returns null on a malformed
 * date rather than a wrong instant.
 *
 * An airport we do not know, or one whose source row carried no timezone,
 * falls back to UTC — the same honest degradation airportDirectory.ts already
 * uses for unknown zones, and no worse than the behaviour this replaced.
 */
export function endOfDayAtAirport(iata: string, date: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const tz = airport(iata)?.timezone;
  if (!tz) {
    const utc = Date.parse(`${date}T23:59:59Z`);
    return Number.isNaN(utc) ? null : new Date(utc).toISOString();
  }
  const ts = wallClockToUtc(date, '23:59:59', tz);
  return Number.isNaN(ts) ? null : new Date(ts).toISOString();
}

/**
 * The instant of a given local wall-clock HOUR on a given local date at an
 * airport. Same machinery as endOfDayAtAirport, exposed because the seeder
 * needs "22:00 local at BOM", not "end of day".
 *
 * This exists because `hour_of_day` is the model's local-time feature: putting
 * a seeded flight at 22:00 UTC gives 03:30 in Mumbai, which is a completely
 * different — and much lower-risk — hour. See server/domain/seed.ts.
 */
export function localHourAtAirport(iata: string, date: string, hour: number): number {
  const hh = String(Math.max(0, Math.min(23, Math.trunc(hour)))).padStart(2, '0');
  const tz = airport(iata)?.timezone;
  if (!tz) return Date.parse(`${date}T${hh}:00:00Z`);
  return wallClockToUtc(date, `${hh}:00:00`, tz);
}

/** The local calendar date (YYYY-MM-DD) at an airport for a given instant. */
export function localDateISOAt(iata: string, at: number): string {
  const tz = airport(iata)?.timezone;
  const d = new Date(at);
  if (!tz) return d.toISOString().slice(0, 10);
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
  return p; // en-CA formats as YYYY-MM-DD
}
