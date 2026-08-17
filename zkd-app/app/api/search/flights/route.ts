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
        departsLocal: f.localDepartureTime,
        arrivesLocal: f.localArrivalTime,
        departsUtc: f.scheduledDepartureUtc,
        durationMin: f.elapsedTimeMin,
        aircraft: f.aircraftType,
        terminal: f.departureTerminal,
      })),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // The two failures worth telling apart on stage: the trial allowance is
    // gone, or replay was on and this route was never recorded. Both are
    // operator problems with different fixes, and neither is "no flights".
    const status = /budget exhausted|no fixture/i.test(message) ? 503 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
