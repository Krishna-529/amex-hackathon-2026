import { hhmm } from '@/lib/time';
import type { Alt } from '@/lib/data';

/**
 * Duffel test-mode sandbox. Reliably returns offers for its own dummy routes
 * (e.g. LHR<->JFK); real Indian domestic routes will almost always come back
 * empty — that's expected sandbox behaviour, not a bug, and is handled by the
 * caller as an empty result, not an error.
 */

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
  slices: { segments: DuffelSegment[] }[];
};

export async function searchDuffelAlts(params: {
  origin: string;
  destination: string;
  departureDate: string;
  cabin?: string;
}): Promise<Alt[]> {
  const token = process.env.DUFFEL_ACCESS_TOKEN;
  if (!token) return [];

  try {
    const res = await fetch('https://api.duffel.com/air/offer_requests?return_offers=true', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Duffel-Version': 'v2',
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
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
    if (!res.ok) return [];
    const json = (await res.json()) as { data: { offers: DuffelOffer[] } };
    const offers = json.data?.offers ?? [];

    return offers.map((o): Alt => {
      const seg = o.slices[0]?.segments[0];
      const code = seg
        ? `${seg.operating_carrier.iata_code} ${seg.marketing_carrier_flight_number ?? ''}`.trim()
        : 'Unknown';
      return {
        id: `duffel:${o.id}`,
        code,
        dep: seg ? hhmm(new Date(seg.departing_at)) : '',
        arr: seg ? hhmm(new Date(seg.arriving_at)) : '',
        cabin: o.cabin_class ? o.cabin_class[0].toUpperCase() + o.cabin_class.slice(1) : 'Economy',
        seats: 9,
        fare: Math.round(parseFloat(o.total_amount)),
        ok: true,
        why: 'Live search result — demo data; real routes will differ from your actual leg.',
      };
    });
  } catch {
    return [];
  }
}
