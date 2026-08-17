import type { HotelOpt } from '@/server/domain/types';

/**
 * LiteAPI (Nuitee Connect) sandbox — real inventory, no card required.
 *
 * Currency and guest nationality used to be hardcoded to INR/IN, which quietly
 * made every hotel search an Indian one. Both now come from the caller:
 * currency from the card member's billing currency, nationality from their
 * passport.
 */

type RawHotel = { id: string; name: string; address: string; city: string };

type RawRate = {
  hotelId: string;
  roomTypes: { offerRetailRate: { amount: number; currency: string } }[];
};

/**
 * OpenFlights stores country names, LiteAPI wants ISO-3166 alpha-2. Only the
 * countries the demo can actually reach are mapped; anything else falls
 * through to the two-letter prefix, which LiteAPI rejects cleanly rather
 * than silently searching the wrong country. Shared by app/api/hotels/route.ts
 * and server/engine/groundCache.ts so there is one mapping, not two.
 */
export function countryCodeFor(country: string): string {
  const map: Record<string, string> = {
    India: 'IN', 'United Kingdom': 'GB', 'United States': 'US', France: 'FR', Germany: 'DE',
    Netherlands: 'NL', Singapore: 'SG', 'United Arab Emirates': 'AE', Australia: 'AU', Japan: 'JP',
  };
  return map[country] ?? country.slice(0, 2).toUpperCase();
}

export function nationalityCode(nationality: string): string {
  const map: Record<string, string> = { Indian: 'IN', British: 'GB', American: 'US' };
  return map[nationality] ?? 'IN';
}

export async function searchHotels(params: {
  cityName: string;
  countryCode: string;
  checkin: string;
  checkout: string;
  currency: string;
  guestNationality: string;
}): Promise<HotelOpt[]> {
  const key = process.env.LITEAPI_API_KEY;
  if (!key) return [];

  try {
    const listUrl = `https://api.liteapi.travel/v3.0/data/hotels?countryCode=${encodeURIComponent(params.countryCode)}&cityName=${encodeURIComponent(params.cityName)}`;
    const listRes = await fetch(listUrl, { headers: { 'X-API-Key': key }, cache: 'no-store', signal: AbortSignal.timeout(10000) });
    if (!listRes.ok) return [];
    const listJson = (await listRes.json()) as { data: RawHotel[] };
    const candidates = (listJson.data ?? []).slice(0, 8);
    if (candidates.length === 0) return [];

    const ratesRes = await fetch('https://api.liteapi.travel/v3.0/hotels/rates', {
      method: 'POST',
      headers: { 'X-API-Key': key, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10000),
      body: JSON.stringify({
        hotelIds: candidates.map((h) => h.id),
        checkin: params.checkin,
        checkout: params.checkout,
        occupancies: [{ adults: 1 }],
        currency: params.currency,
        guestNationality: params.guestNationality,
      }),
      cache: 'no-store',
    });
    if (!ratesRes.ok) return [];
    const ratesJson = (await ratesRes.json()) as { data: RawRate[] };

    const byId = new Map(candidates.map((h) => [h.id, h]));
    return (ratesJson.data ?? [])
      .map((r): HotelOpt | null => {
        const hotel = byId.get(r.hotelId);
        const amount = r.roomTypes?.[0]?.offerRetailRate?.amount;
        if (!hotel || amount === undefined) return null;
        return {
          id: `liteapi:${r.hotelId}`,
          name: hotel.name,
          area: hotel.address || hotel.city,
          checkin: '15:00',
          rate: Math.round(amount),
          extra: 0,
          currency: params.currency,
          ok: true,
          why: `Live search result for ${params.cityName} — real inventory, sandbox environment.`,
          walk: 'Live sandbox result',
        };
      })
      .filter((h): h is HotelOpt => h !== null);
  } catch {
    return [];
  }
}
