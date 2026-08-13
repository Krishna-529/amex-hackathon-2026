import { NextRequest, NextResponse } from 'next/server';
import { searchHotels } from '@/server/liteapi';
import { airport } from '@/server/airportDirectory';
import { fetchProfile } from '@/server/myca';
import type { HotelsResponse } from '@/lib/apiTypes';

/**
 * Takes the destination IATA rather than a city name: resolving the city is the
 * server's job, because the airport directory is 6,000 entries and has no
 * business in a client bundle. Currency and nationality come from MyCa, so a
 * London stay is not priced in rupees.
 */
export async function GET(req: NextRequest) {
  const iata = req.nextUrl.searchParams.get('iata') ?? req.nextUrl.searchParams.get('city') ?? '';
  const checkin = req.nextUrl.searchParams.get('checkin') ?? '';
  const checkout = req.nextUrl.searchParams.get('checkout') ?? '';

  const ap = airport(iata);
  if (!ap) return NextResponse.json({ hotels: [], source: 'empty' } satisfies HotelsResponse);

  const profile = await fetchProfile('demo');
  const hotels = await searchHotels({
    cityName: ap.city,
    countryCode: countryCodeFor(ap.country),
    checkin,
    checkout,
    currency: profile.payment.billingCurrency,
    guestNationality: nationalityCode(profile.traveller.nationality),
  });

  const body: HotelsResponse = { hotels, source: hotels.length > 0 ? 'ok' : 'empty' };
  return NextResponse.json(body);
}

/**
 * OpenFlights stores country names, LiteAPI wants ISO-3166 alpha-2. Only the
 * countries the demo can actually reach are mapped; anything else falls through
 * to the two-letter prefix, which LiteAPI rejects cleanly rather than silently
 * searching the wrong country.
 */
function countryCodeFor(country: string): string {
  const map: Record<string, string> = {
    India: 'IN', 'United Kingdom': 'GB', 'United States': 'US', France: 'FR', Germany: 'DE',
    Netherlands: 'NL', Singapore: 'SG', 'United Arab Emirates': 'AE', Australia: 'AU', Japan: 'JP',
  };
  return map[country] ?? country.slice(0, 2).toUpperCase();
}

function nationalityCode(nationality: string): string {
  const map: Record<string, string> = { Indian: 'IN', British: 'GB', American: 'US' };
  return map[nationality] ?? 'IN';
}
