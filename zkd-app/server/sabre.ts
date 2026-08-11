import { getOrSet } from './cache';
import { hhmm } from '@/lib/time';
import type { Alt } from '@/server/domain/types';

/**
 * Sabre Dev Studio "Try It Out" trial credentials, cert environment.
 *
 * Auth confirmed working this session: the REST token endpoint needs the
 * client_id and client_secret each base64-encoded separately, then those two
 * base64 strings joined with ":" and base64-encoded AGAIN as the Basic auth
 * value (Sabre's documented double-encoding quirk) — a single-pass encoding
 * returns 401 invalid_client.
 *
 * The InstaFlights search endpoint itself was reachable and auth'd correctly
 * in testing, but every route/date tried against the cert sandbox returned
 * "No results were found" (no populated example was available to verify the
 * exact response field names against). The parser below is written
 * defensively — it returns [] rather than throwing on any unexpected shape —
 * and should be re-checked against a real populated response when one turns up.
 */

async function getSabreToken(): Promise<string | null> {
  const clientId = process.env.SABRE_CLIENT_ID;
  const clientSecret = process.env.SABRE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  return getOrSet('sabre:token', 6 * 24 * 60 * 60 * 1000, async () => {
    const idB64 = Buffer.from(clientId).toString('base64');
    const secretB64 = Buffer.from(clientSecret).toString('base64');
    const combined = Buffer.from(`${idB64}:${secretB64}`).toString('base64');

    const res = await fetch('https://api.cert.sabre.com/v2/auth/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${combined}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`sabre token ${res.status}`);
    const json = (await res.json()) as { access_token: string };
    return json.access_token;
  }).catch(() => null);
}

export async function searchSabreAlts(params: {
  origin: string;
  destination: string;
  departureDate: string;
}): Promise<Alt[]> {
  try {
    const token = await getSabreToken();
    if (!token) return [];

    const q = new URLSearchParams({
      origin: params.origin,
      destination: params.destination,
      departuredate: params.departureDate,
    });
    const res = await fetch(`https://api.cert.sabre.com/v1/shop/flights?${q}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (!res.ok) return [];
    const json = await res.json();

    const itineraries = json?.PricedItineraries;
    if (!Array.isArray(itineraries)) return [];

    const alts: Alt[] = [];
    for (const it of itineraries) {
      const segments = it?.AirItinerary?.OriginDestinationOptions?.[0]?.FlightSegment;
      const fare = it?.AirItineraryPricingInfo?.ItinTotalFare?.TotalFare;
      if (!Array.isArray(segments) || !segments[0] || !fare) continue;
      const seg = segments[0];
      alts.push({
        id: `sabre:${it.SequenceNumber ?? alts.length}`,
        code: `${seg.MarketingAirline?.Code ?? ''} ${seg.FlightNumber ?? ''}`.trim(),
        dep: seg.DepartureDateTime ? hhmm(new Date(seg.DepartureDateTime)) : '',
        arr: seg.ArrivalDateTime ? hhmm(new Date(seg.ArrivalDateTime)) : '',
        cabin: 'Economy',
        seats: 9,
        fare: Math.round(parseFloat(fare.Amount ?? '0')),
        ok: true,
        why: 'Live search result — demo data; real routes will differ from your actual leg.',
      });
    }
    return alts;
  } catch {
    return [];
  }
}
