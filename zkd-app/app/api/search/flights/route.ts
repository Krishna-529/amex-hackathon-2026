import { NextRequest, NextResponse } from 'next/server';
import { flightInstancesByRoute, trialBudget } from '@/server/oag';
import { cityOf } from '@/server/airportDirectory';

/**
 * Real flights on a route and date, straight from OAG — the search behind the
 * booking form.
 *
 * Deliberately unauthenticated, like the real Amex site: you can look at what
 * flies before you sign in. Booking one is what requires a session (see
 * POST /api/flights).
 *
 * OAG Flight Info returns SCHEDULES, not offers — real carriers, numbers,
 * times, terminals and equipment, but no fares or seat inventory. Price is
 * therefore not invented here; the response carries no `fare` field at all
 * rather than a plausible-looking number, and the UI says so.
 */

/** "DEL - New Delhi", "del", " DEL " all mean DEL. Anything else is rejected
 *  rather than guessed at — a wrong airport is worse than an error message. */
function toIata(raw: string | null): string | null {
  if (!raw) return null;
  const m = raw.trim().toUpperCase().match(/^([A-Z]{3})\b/);
  return m ? m[1] : null;
}

/**
 * Whole local calendar days between two YYYY-MM-DD dates. Both are parsed as
 * UTC midnight purely to subtract them — no zone conversion is involved or
 * wanted here, since each date is already local to its own airport.
 */
function dayOffset(departureDate: string, arrivalDate: string): number {
  if (!departureDate || !arrivalDate) return 0;
  const a = Date.parse(`${departureDate}T00:00:00Z`);
  const b = Date.parse(`${arrivalDate}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const from = toIata(params.get('from'));
  const to = toIata(params.get('to'));
  const date = params.get('date');

  if (!from || !to) {
    return NextResponse.json(
      { error: 'from and to must start with a 3-letter IATA code, e.g. "DEL" or "DEL - New Delhi"' },
      { status: 400 },
    );
  }
  if (from === to) {
    return NextResponse.json({ error: 'origin and destination are the same' }, { status: 400 });
  }
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 });
  }

  try {
    const instances = await flightInstancesByRoute(from, to, date);

    return NextResponse.json({
      from,
      to,
      date,
      fromCity: cityOf(from),
      toCity: cityOf(to),
      // Surfaced so a rehearsal can see the allowance draining before it runs
      // out mid-demo, rather than discovering it from a thrown error.
      trialCallsRemaining: trialBudget().remaining,
      flights: instances.map((f) => ({
        id: `${f.carrierIata}${f.flightNumber}-${f.departureDate}`,
        code: `${f.carrierIata} ${f.flightNumber}`,
        carrier: f.carrierIata,
        from: f.origin,
        to: f.destination,
        departureDate: f.departureDate,
        arrivalDate: f.arrivalDate,
        departsLocal: f.localDepartureTime,
        arrivesLocal: f.localArrivalTime,
        // How many local calendar days the arrival is past the departure —
        // +1 on most eastbound long-haul, -1 across the dateline. The UI needs
        // it to avoid printing "23:45 → 06:20" as though it were a short hop.
        arrivesDayOffset: dayOffset(f.departureDate, f.arrivalDate),
        departsUtc: f.scheduledDepartureUtc,
        durationMin: f.elapsedTimeMin,
        aircraft: f.aircraftType,
        terminal: f.departureTerminal,
      })),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // Logged in full server-side — this is where the detail belongs. Never
    // returned verbatim to the client: this route is deliberately
    // unauthenticated (public, browse-before-signin), and the raw message can
    // contain OAG's own upstream response body (server/oag.ts:336, up to 500
    // chars of vendor error text) or, in OAG_REPLAY mode, this server's own
    // absolute file path to the missing fixture (server/oag.ts's "no
    // fixture" throw). Both are real information disclosure to an anonymous
    // caller — fixed 2026-08-21. The two failures worth telling an operator
    // apart on stage (trial allowance gone vs. replay mode missing a
    // recording) still get their own clean, pre-written message and status;
    // everything else collapses to one generic 502.
    console.error('[search/flights] OAG lookup failed:', message);
    const budgetExhausted = /budget exhausted/i.test(message);
    const noFixture = /no fixture/i.test(message);
    if (budgetExhausted) {
      return NextResponse.json({ error: 'The flight-search trial allowance is exhausted for now.' }, { status: 503 });
    }
    if (noFixture) {
      return NextResponse.json(
        { error: 'This route is not available in replay mode — ask an operator to record it.' },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: 'Flight search is temporarily unavailable.' }, { status: 502 });
  }
}
