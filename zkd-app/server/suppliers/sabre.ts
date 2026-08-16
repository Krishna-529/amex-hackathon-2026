/**
 * Sabre Dev Studio, cert environment.
 *
 * Auth quirk, confirmed working: client_id and client_secret are each base64'd
 * separately, joined with ":", then base64'd AGAIN as the Basic value. A single
 * pass returns 401 invalid_client.
 *
 * InstaFlights authenticates fine but every route/date tried against cert has
 * returned "No results were found", so the parser below has never seen a
 * populated response. It is written to return empty rather than throw on any
 * unexpected shape, and should be re-checked when real data turns up.
 *
 * Sabre prices do not carry an offer expiry the way Duffel's do — a ticketing
 * time limit lives on the PNR, not the shop response — so `expiresAt` is null
 * here and the confirmation window falls back to its other bounds.
 */

import { getOrSet } from '../cache';
import type { Offer, RevalidationResult, SearchParams, Supplier, SupplierStatus } from './types';

const API = 'https://api.cert.sabre.com';

async function getSabreToken(): Promise<string | null> {
  const clientId = process.env.SABRE_CLIENT_ID;
  const clientSecret = process.env.SABRE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  return getOrSet('sabre:token', 6 * 24 * 60 * 60 * 1000, async () => {
    const idB64 = Buffer.from(clientId).toString('base64');
    const secretB64 = Buffer.from(clientSecret).toString('base64');
    const combined = Buffer.from(`${idB64}:${secretB64}`).toString('base64');

    const res = await fetch(`${API}/v2/auth/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${combined}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      signal: AbortSignal.timeout(10000),
      body: 'grant_type=client_credentials',
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`sabre token ${res.status}`);
    const json = (await res.json()) as { access_token: string };
    return json.access_token;
  }).catch(() => null);
}

export const sabre: Supplier = {
  id: 'sabre',

  async search(params) {
    if (!process.env.SABRE_CLIENT_ID || !process.env.SABRE_CLIENT_SECRET) {
      return { offers: [], status: 'no-key' as SupplierStatus };
    }

    try {
      const token = await getSabreToken();
      if (!token) return { offers: [], status: 'error' };

      const q = new URLSearchParams({
        origin: params.origin,
        destination: params.destination,
        departuredate: params.departureDate,
      });
      const res = await fetch(`${API}/v1/shop/flights?${q}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return { offers: [], status: 'error' };

      const json = await res.json();
      const itineraries = json?.PricedItineraries;
      if (!Array.isArray(itineraries)) return { offers: [], status: 'empty' };

      const offers: Offer[] = [];
      for (const it of itineraries) {
        const segments = it?.AirItinerary?.OriginDestinationOptions?.[0]?.FlightSegment;
        const fare = it?.AirItineraryPricingInfo?.ItinTotalFare?.TotalFare;
        const seg = Array.isArray(segments) ? segments[0] : null;
        if (!seg || !fare) continue;

        const id = String(it.SequenceNumber ?? offers.length);
        offers.push({
          id: `sabre:${id}`,
          supplier: 'sabre',
          supplierOfferId: id,
          flightCode: `${seg.MarketingAirline?.Code ?? ''} ${seg.FlightNumber ?? ''}`.trim(),
          from: params.origin,
          to: params.destination,
          departsAt: seg.DepartureDateTime ? new Date(seg.DepartureDateTime).getTime() : 0,
          arrivesAt: seg.ArrivalDateTime ? new Date(seg.ArrivalDateTime).getTime() : 0,
          cabin: params.cabin ?? 'Economy',
          seatsRemaining: Number(seg.SeatsRemaining ?? 9),
          price: {
            amount: Math.round(parseFloat(fare.Amount ?? '0')),
            currency: fare.CurrencyCode ?? 'INR',
          },
          expiresAt: null,
          live: true,
        });
      }
      return { offers, status: offers.length ? 'ok' : 'empty' };
    } catch {
      return { offers: [], status: 'error' };
    }
  },

  /**
   * Sabre's shop response has no re-fetchable offer handle, so the only honest
   * re-validation is a fresh search for the same flight. Returning `unknown`
   * rather than `available` matters: the caller must not treat "we could not
   * check" as "confirmed still there".
   */
  async revalidate(offer): Promise<RevalidationResult> {
    const date = new Date(offer.departsAt).toISOString().slice(0, 10);
    const { offers } = await sabre.search({
      origin: offer.from,
      destination: offer.to,
      departureDate: date,
      cabin: offer.cabin,
    });
    const match = offers.find((o) => o.flightCode === offer.flightCode);
    if (!offers.length) return { state: 'unknown' };
    if (!match) return { state: 'gone' };
    if (match.price.amount !== offer.price.amount) {
      return { state: 'price-changed', offer: match, previous: offer.price };
    }
    return { state: 'available', offer: match };
  },
};
