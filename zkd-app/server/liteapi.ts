import type { HotelOpt } from '@/lib/data';

/**
 * LiteAPI (Nuitee Connect) sandbox — real inventory, no card required.
 *
 * Currency and guest nationality used to be hardcoded to INR/IN, which quietly
 * made every hotel search an Indian one. Both now come from the caller: currency
 * from the card member's billing currency in MyCa, nationality from their
 * passport.
 */

type RawHotel = { id: string; name: string; address: string; city: string };

type RawRate = {
  hotelId: string;
  roomTypes: { offerRetailRate: { amount: number; currency: string } }[];
};

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
    const listRes = await fetch(listUrl, { headers: { 'X-API-Key': key }, cache: 'no-store' });
    if (!listRes.ok) return [];
    const listJson = (await listRes.json()) as { data: RawHotel[] };
    const candidates = (listJson.data ?? []).slice(0, 8);
    if (candidates.length === 0) return [];

    const ratesRes = await fetch('https://api.liteapi.travel/v3.0/hotels/rates', {
      method: 'POST',
      headers: { 'X-API-Key': key, 'Content-Type': 'application/json' },
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
