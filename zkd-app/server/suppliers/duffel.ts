/**
 * Duffel test-mode sandbox. Reliably returns offers for its own dummy routes
 * (e.g. LHR<->JFK); real Indian domestic routes come back empty — expected
 * sandbox behaviour, reported as `empty`, not an error.
 *
 * Duffel is the one supplier here that gives us a real `expires_at` on every
 * offer, which is what the confirmation window is derived from.
 */

import type { Offer, RevalidationResult, SearchParams, Supplier, SupplierStatus } from './types';

const API = 'https://api.duffel.com';

type DuffelSegment = {
  departing_at: string;
  arriving_at: string;
  operating_carrier: { iata_code: string };
  marketing_carrier_flight_number?: string;
};

type DuffelOffer = {
  id: string;
  total_amount: string;
  total_currency: string;
  cabin_class?: string;
  expires_at?: string;
  available_services?: unknown[];
  slices: { segments: DuffelSegment[] }[];
};

function headers(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    'Duffel-Version': 'v2',
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

function toOffer(o: DuffelOffer, params: SearchParams): Offer | null {
  const seg = o.slices[0]?.segments[0];
  if (!seg) return null;
  return {
    id: `duffel:${o.id}`,
    supplier: 'duffel',
    supplierOfferId: o.id,
    flightCode: `${seg.operating_carrier.iata_code} ${seg.marketing_carrier_flight_number ?? ''}`.trim(),
    from: params.origin,
    to: params.destination,
    departsAt: new Date(seg.departing_at).getTime(),
    arrivesAt: new Date(seg.arriving_at).getTime(),
    cabin: o.cabin_class ? o.cabin_class[0].toUpperCase() + o.cabin_class.slice(1) : 'Economy',
    seatsRemaining: 9,
    price: { amount: Math.round(parseFloat(o.total_amount)), currency: o.total_currency },
    expiresAt: o.expires_at ? new Date(o.expires_at).getTime() : null,
    live: true,
  };
}

export const duffel: Supplier = {
  id: 'duffel',

  async search(params) {
    const token = process.env.DUFFEL_ACCESS_TOKEN;
    if (!token) return { offers: [], status: 'no-key' as SupplierStatus };

    try {
      const res = await fetch(`${API}/air/offer_requests?return_offers=true`, {
        method: 'POST',
        headers: headers(token),
        body: JSON.stringify({
          data: {
            slices: [
              {
                origin: params.origin,
                destination: params.destination,
                departure_date: params.departureDate,
              },
            ],
            passengers: [{ type: 'adult' }],
            cabin_class: (params.cabin ?? 'economy').toLowerCase(),
          },
        }),
        cache: 'no-store',
      });
      if (!res.ok) return { offers: [], status: 'error' };

      const json = (await res.json()) as { data?: { offers?: DuffelOffer[] } };
      const offers = (json.data?.offers ?? [])
        .map((o) => toOffer(o, params))
        .filter((o): o is Offer => o !== null);
      return { offers, status: offers.length ? 'ok' : 'empty' };
    } catch {
      return { offers: [], status: 'error' };
    }
  },

  async revalidate(offer) {
    const token = process.env.DUFFEL_ACCESS_TOKEN;
    if (!token) return { state: 'unknown' };

    try {
      const res = await fetch(`${API}/air/offers/${encodeURIComponent(offer.supplierOfferId)}`, {
        headers: headers(token),
        cache: 'no-store',
      });
      // Duffel expires offers rather than deleting them; either way it is gone.
      if (res.status === 404 || res.status === 410) return { state: 'gone' };
      if (!res.ok) return { state: 'unknown' };

      const json = (await res.json()) as { data?: DuffelOffer };
      if (!json.data) return { state: 'gone' };
      if (json.data.expires_at && new Date(json.data.expires_at).getTime() < Date.now()) {
        return { state: 'gone' };
      }

      const fresh = toOffer(json.data, { origin: offer.from, destination: offer.to, departureDate: '' });
      if (!fresh) return { state: 'unknown' };
      if (fresh.price.amount !== offer.price.amount || fresh.price.currency !== offer.price.currency) {
        return { state: 'price-changed', offer: fresh, previous: offer.price };
      }
      return { state: 'available', offer: fresh };
    } catch {
      return { state: 'unknown' };
    }
  },
};
