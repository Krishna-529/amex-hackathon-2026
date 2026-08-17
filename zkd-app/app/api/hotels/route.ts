import { NextRequest, NextResponse } from 'next/server';
import { searchHotels, countryCodeFor, nationalityCode } from '@/server/liteapi';
import { generateMockHotels } from '@/server/mockHotels';
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
  let hotels = await searchHotels({
    cityName: ap.city,
    countryCode: countryCodeFor(ap.country),
    checkin,
    checkout,
    currency: profile.payment.billingCurrency,
    guestNationality: nationalityCode(profile.traveller.nationality),
  });
  // LiteAPI has no key or returned nothing for this city — fall back to the
  // synthetic generator (server/mockHotels.ts) rather than an empty result;
  // each row's own `why` text says it's generated, not a live rate.
  if (hotels.length === 0) hotels = generateMockHotels(iata, profile.payment.billingCurrency, `${checkin}:${checkout}`);

  const body: HotelsResponse = { hotels, source: hotels.length > 0 ? 'ok' : 'empty' };
  return NextResponse.json(body);
}
