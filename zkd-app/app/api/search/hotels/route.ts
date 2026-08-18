import { NextRequest, NextResponse } from 'next/server';
import { searchAccommodation } from '@/server/hotels';
import { airport, cityOf, countryCodeOf } from '@/server/airportDirectory';

/**
 * Hotels for a city and date range.
 *
 * Reuses `searchAccommodation()` — the same registry the recovery path already
 * uses (Duffel Stays / LiteAPI / Makcorps, deduped, each reporting its own
 * status). This route is origination, not new supplier work: the difference is
 * only that a member is choosing a room up front rather than being moved into
 * one after a cancellation.
 *
 * Unauthenticated like the flight search, and for the same reason: you can look
 * before you sign in. Booking is what needs a session.
 *
 * The city is resolved from an AIRPORT code rather than typed free-text,
 * because that is what the accommodation registry keys on (`iata` +
 * `cityName` + `countryCode`) and it is what a member searching from a travel
 * app already has to hand.
 */

function toIata(raw: string | null): string | null {
  if (!raw) return null;
  const m = raw.trim().toUpperCase().match(/^([A-Z]{3})\b/);
  return m ? m[1] : null;
}

const isDate = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const iata = toIata(p.get('city') ?? p.get('iata'));
  const checkin = p.get('checkin');
  const checkout = p.get('checkout');
  const rooms = Math.max(1, Math.min(9, Number(p.get('rooms') ?? '1') || 1));
  const adults = Math.max(1, Math.min(16, Number(p.get('adults') ?? '1') || 1));

  if (!iata) {
    return NextResponse.json(
      { error: 'city must start with a 3-letter airport code, e.g. "BOM" or "BOM - Mumbai"' },
      { status: 400 },
    );
  }
  if (!isDate(checkin) || !isDate(checkout)) {
    return NextResponse.json({ error: 'checkin and checkout must be YYYY-MM-DD' }, { status: 400 });
  }
  if (Date.parse(checkout) <= Date.parse(checkin)) {
    // A zero- or negative-night stay is a data-entry mistake, and suppliers
    // reject it with far less helpful errors than this one.
    return NextResponse.json({ error: 'checkout must be after checkin' }, { status: 400 });
  }

  const ap = airport(iata);
  if (!ap) {
    return NextResponse.json({ error: `unknown airport code "${iata}"` }, { status: 400 });
  }

  try {
    const result = await searchAccommodation({
      iata,
      cityName: cityOf(iata) ?? ap.city ?? iata,
      countryCode: countryCodeOf(iata),
      checkin,
      checkout,
      rooms,
      adults,
      // The registry prices in whatever the supplier quotes; this is the
      // currency we ASK for. No conversion happens anywhere downstream — see
      // the needsConversion refusal in server/domain/altsFromOffers.ts.
      currency: 'INR',
      guestNationality: 'IN',
      lane: 'refresh',
    });

    return NextResponse.json({
      city: iata,
      cityName: cityOf(iata) ?? ap.city ?? iata,
      checkin,
      checkout,
      rooms,
      // Per-source status, surfaced rather than flattened: "nobody had a key"
      // and "every supplier returned nothing" are different answers and only
      // one of them is a configuration problem.
      sources: result.sources,
      hotels: result.offers.map((o) => ({
        id: o.id,
        supplier: o.supplier,
        name: o.name,
        area: o.area,
        city: o.city,
        checkin: o.checkin,
        checkout: o.checkout,
        roomsAvailable: o.roomsAvailable,
        total: o.total,
        refundable: o.refundable,
        cancelDeadline: o.cancelDeadline,
        minutesFromAirport: o.minutesFromAirport,
        /** false means the source can price it but cannot be committed against —
         *  the same honesty flag the flight side uses. */
        live: o.live,
      })),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
