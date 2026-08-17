/**
 * Skyscanner via RapidAPI — the breadth source, and deliberately the weakest.
 *
 * Registered for coverage, never for execution. The RapidAPI mirrors are
 * unofficial redistributions: they give good *market* breadth (which carriers
 * fly this route today, at roughly what price) and nothing you can ticket.
 * There is no booking path, no PNR, no price hold and no seat count.
 *
 * That shapes three decisions here, all deliberate:
 *
 *   `live: false`. server/suppliers/index.ts `preferOver` prefers a live offer
 *   over a synthetic one, so the moment Duffel or Kiwi returns the same
 *   physical flight this one is dropped in dedupe; and app/api/alts/route.ts
 *   will label whatever survives as "generated inventory, not a bookable seat".
 *   It fills gaps in the portfolio; it never wins a booking.
 *
 *   `revalidate` returns `unknown` unconditionally. There is nothing to
 *   re-check. `firstBookable` already treats `unknown` as not-confirmable and
 *   falls through, so a Skyscanner offer can only ever be reached if literally
 *   nothing else survived — which is the correct priority.
 *
 *   `seatsRemaining: 0`. No seat count is published, and this feeds both the
 *   scarcity input in lib/thresholds.ts and the party-fit gate in
 *   altsForParty. Inventing a number there would make the system act *later*
 *   on a route that is actually emptying, and would let a party of six be
 *   offered a flight nobody has checked has six seats.
 *
 * Host and path are env-driven because the RapidAPI listing behind this renames
 * itself more often than anything else in the stack. Hardcoding one makes the
 * integration rot silently; making it configuration means a dead mirror is a
 * `.env.local` edit, not a code change.
 *
 * At 500 calls/month this is the tightest flight budget we hold, so it will be
 * the first source the refresh manager reports as `rate-limited`.
 */

import { withBudget } from '../governor';
import type { Offer, SearchParams, Supplier, SupplierStatus } from './types';

const DEFAULT_HOST = 'sky-scanner3.p.rapidapi.com';
const DEFAULT_PATH = '/flights/search-one-way';

type RawItinerary = {
  id?: string;
  price?: { raw?: number; amount?: number; currency?: string };
  legs?: {
    departure?: string;
    arrival?: string;
    origin?: { displayCode?: string; id?: string };
    destination?: { displayCode?: string; id?: string };
    carriers?: { marketing?: { alternateId?: string; iata?: string; name?: string }[] };
    segments?: { flightNumber?: string; marketingCarrier?: { alternateId?: string } }[];
  }[];
};

function toOffer(it: RawItinerary, params: SearchParams, fallbackCurrency: string): Offer | null {
  const leg = it.legs?.[0];
  if (!leg?.departure || !leg.arrival) return null;

  const amount = it.price?.raw ?? it.price?.amount;
  if (typeof amount !== 'number') return null;

  const carrier =
    leg.carriers?.marketing?.[0]?.alternateId ??
    leg.carriers?.marketing?.[0]?.iata ??
    leg.segments?.[0]?.marketingCarrier?.alternateId ??
    '';
  const number = leg.segments?.[0]?.flightNumber ?? '';
  const code = `${carrier} ${number}`.trim();
  // Without a carrier + number there is nothing to dedupe against or show a
  // member. A priced row we cannot name is noise.
  if (!code || !carrier) return null;

  const departsAt = new Date(leg.departure).getTime();
  const arrivesAt = new Date(leg.arrival).getTime();
  if (!Number.isFinite(departsAt) || !Number.isFinite(arrivesAt)) return null;

  const id = it.id ?? `${code}:${leg.departure}`;

  return {
    id: `skyscanner:${id}`,
    supplier: 'skyscanner',
    supplierOfferId: id,
    flightCode: code,
    from: leg.origin?.displayCode ?? leg.origin?.id ?? params.origin,
    to: leg.destination?.displayCode ?? leg.destination?.id ?? params.destination,
    departsAt,
    arrivesAt,
    cabin: params.cabin ?? 'Economy',
    seatsRemaining: 0,
    price: { amount: Math.round(amount), currency: it.price?.currency ?? fallbackCurrency },
    expiresAt: null,
    live: false,
  };
}

export const skyscanner: Supplier = {
  id: 'skyscanner',

  async search(params) {
    const key = process.env.RAPIDAPI_KEY;
    if (!key) return { offers: [], status: 'no-key' as SupplierStatus };

    const host = process.env.RAPIDAPI_SKYSCANNER_HOST ?? DEFAULT_HOST;
    const path = process.env.RAPIDAPI_SKYSCANNER_PATH ?? DEFAULT_PATH;
    const currency = process.env.RAPIDAPI_CURRENCY ?? 'INR';

    return withBudget(
      'skyscanner',
      params.lane ?? 'refresh',
      1,
      async () => {
        const url = new URL(`https://${host}${path}`);
        url.searchParams.set('fromEntityId', params.origin);
        url.searchParams.set('toEntityId', params.destination);
        url.searchParams.set('departDate', params.departureDate);
        url.searchParams.set('currency', currency);
        url.searchParams.set('adults', String(Math.max(1, params.passengers ?? 1)));

        const res = await fetch(url, {
          headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': host },
          cache: 'no-store',
        });
        if (!res.ok) return { offers: [], status: 'error' as SupplierStatus };

        const json = (await res.json()) as { data?: { itineraries?: RawItinerary[] } };
        const offers = (json.data?.itineraries ?? [])
          .map((it) => toOffer(it, params, currency))
          .filter((o): o is Offer => o !== null);

        return { offers, status: (offers.length ? 'ok' : 'empty') as SupplierStatus };
      },
      () => ({ offers: [], status: 'rate-limited' as SupplierStatus }),
    ).catch(() => ({ offers: [], status: 'error' as SupplierStatus }));
  },

  /** Nothing to re-check — see the header. `unknown` is the honest answer, not a failure. */
  async revalidate() {
    return { state: 'unknown' };
  },
};
