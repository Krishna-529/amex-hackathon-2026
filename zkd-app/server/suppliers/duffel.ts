/**
 * Duffel test-mode sandbox. Reliably returns offers for its own dummy routes
 * (e.g. LHR<->JFK); real Indian domestic routes come back empty — expected
 * sandbox behaviour, reported as `empty`, not an error.
 *
 * Duffel is the one supplier here that gives us a real `expires_at` on every
 * offer, which is what the confirmation window is derived from.
 */

import { withBudget, noteOutcome } from '../governor';
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

    // Search for the whole party, not one seat. This used to be a hardcoded
    // single adult, which meant a party of six was priced and availability-
    // checked as a solo traveller — the fare came back per-person plausible and
    // the seat count told us nothing about whether six could actually board.
    const passengers = Array.from(
      { length: Math.max(1, params.passengers ?? 1) },
      () => ({ type: 'adult' as const }),
    );

    return withBudget(
      'duffel',
      params.lane ?? 'refresh',
      1,
      async () => {
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
              passengers,
              cabin_class: (params.cabin ?? 'economy').toLowerCase(),
            },
          }),
          cache: 'no-store',
        });
        if (!res.ok) {
          noteOutcome('duffel', { ok: false, status: res.status });
          return { offers: [], status: 'error' as SupplierStatus };
        }

        const json = (await res.json()) as { data?: { offers?: DuffelOffer[] } };
        const offers = (json.data?.offers ?? [])
          .map((o) => toOffer(o, params))
          .filter((o): o is Offer => o !== null);
        return { offers, status: (offers.length ? 'ok' : 'empty') as SupplierStatus };
      },
      () => ({ offers: [], status: 'rate-limited' as SupplierStatus }),
    ).catch(() => ({ offers: [], status: 'error' as SupplierStatus }));
  },

  /**
   * Always the `confirm` lane: revalidation only ever runs on the path to
   * spending the member's money, so it must be able to draw on the reserve that
   * background polling cannot touch. This is the call that must never be the
   * one refused because a warm-up loop drank the quota an hour ago.
   */
  async revalidate(offer): Promise<RevalidationResult> {
    const token = process.env.DUFFEL_ACCESS_TOKEN;
    if (!token) return { state: 'unknown' };

    return withBudget<RevalidationResult>(
      'duffel',
      'confirm',
      1,
      async () => {
        const res = await fetch(`${API}/air/offers/${encodeURIComponent(offer.supplierOfferId)}`, {
          headers: headers(token),
          cache: 'no-store',
        });
        // Duffel expires offers rather than deleting them; either way it is gone.
        if (res.status === 404 || res.status === 410) return { state: 'gone' };
        if (!res.ok) {
          noteOutcome('duffel', { ok: false, status: res.status });
          return { state: 'unknown' };
        }

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
      },
      // A throttled revalidation is emphatically not `gone` — treating it as
      // such would cascade the member off a seat that is still there.
      () => ({ state: 'unknown' }) as RevalidationResult,
    ).catch(() => ({ state: 'unknown' }) as RevalidationResult);
  },
};
