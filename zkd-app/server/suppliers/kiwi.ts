/**
 * Kiwi.com / Tequila.
 *
 * The complement to Duffel rather than a competitor to it, and registered for
 * one specific reason beyond coverage: **it is the only source here that
 * returns a real per-offer seat count.**
 *
 * That matters more than it sounds. `server/domain/altsForParty.ts` gates every
 * market option on `alt.seats >= partySize` and refuses to split a party — but
 * Duffel hardcodes `seatsRemaining: 9` (duffel.ts:54) and Travelport is
 * synthetic, so until now that check has been comparing a party against a
 * constant. Kiwi's `availability.seats` is the first honest input it has had,
 * which is what makes the party-of-six path (`f-multi` in the seed) a real test
 * rather than a decorative one.
 *
 * Coverage is the other half: Duffel's sandbox only knows its own dummy routes
 * and Sabre CERT returns nothing, so on Indian domestic routes Kiwi's
 * aggregation — which reaches the low-cost carriers that do not file through a
 * GDS, i.e. most of IndiGo — is the difference between a portfolio with options
 * and an empty one.
 *
 * ── Two things deliberately not faked ──────────────────────────────────────
 *
 *   `expiresAt: null`. Tequila publishes no price-hold instant. Duffel does,
 *   and lib/confirmWindow.ts derives the member's entire decision window from
 *   it — so inventing one here would put a fabricated number underneath a
 *   promise we make to a human. Null lets `confirmWindow` fall back to its
 *   check-in and ceiling bounds, exactly as it already does for Sabre.
 *
 *   `cabin: 'Economy'`. The search response does not carry a cabin. Assuming
 *   anything else would let a fare be ranked into an entitlement it was never
 *   in — `offersToAlts` compares cabin against `cabinEntitlement` and would
 *   silently approve a Business fare we had guessed at.
 *
 * Partner approval is not guaranteed, so `no-key` is the boring, expected path
 * and nothing about the demo depends on this source existing.
 */

import { withBudget } from '../governor';
import type { Offer, RevalidationResult, SearchParams, Supplier, SupplierStatus } from './types';

const API = 'https://api.tequila.kiwi.com';

type TequilaRoute = {
  flyFrom: string;
  flyTo: string;
  airline: string;
  flight_no: number;
  local_departure: string;
  local_arrival: string;
};

type TequilaFlight = {
  id: string;
  booking_token: string;
  price: number;
  local_departure: string;
  local_arrival: string;
  utc_departure?: string;
  utc_arrival?: string;
  flyFrom: string;
  flyTo: string;
  route: TequilaRoute[];
  availability?: { seats: number | null };
};

/** Tequila wants dd/mm/yyyy; the rest of this codebase speaks ISO. */
function toTequilaDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function toOffer(f: TequilaFlight, currency: string): Offer | null {
  const first = f.route[0];
  const last = f.route[f.route.length - 1];
  if (!first || !last) return null;

  // Prefer the UTC fields where present. `local_departure` carries no zone, and
  // comparing a local clock in Chennai against one in London is exactly the
  // nine-hour phantom delay server/airportDirectory.ts warns about.
  const departsAt = new Date(f.utc_departure ?? f.local_departure).getTime();
  const arrivesAt = new Date(f.utc_arrival ?? f.local_arrival).getTime();
  if (!Number.isFinite(departsAt) || !Number.isFinite(arrivesAt)) return null;

  return {
    id: `kiwi:${f.id}`,
    supplier: 'kiwi',
    // The booking_token is the bookable handle AND the revalidation handle.
    supplierOfferId: f.booking_token,
    flightCode: `${first.airline} ${first.flight_no}`,
    from: f.flyFrom,
    to: f.flyTo,
    departsAt,
    arrivesAt,
    cabin: 'Economy',
    // The whole reason this supplier is registered — see the header.
    seatsRemaining: f.availability?.seats ?? 0,
    price: { amount: Math.round(f.price), currency },
    expiresAt: null,
    live: true,
  };
}

export const kiwi: Supplier = {
  id: 'kiwi',

  async search(params: SearchParams) {
    const key = process.env.TEQUILA_API_KEY;
    if (!key) return { offers: [], status: 'no-key' as SupplierStatus };

    const currency = process.env.TEQUILA_CURRENCY ?? 'INR';
    const passengers = Math.max(1, params.passengers ?? 1);

    return withBudget(
      'kiwi',
      params.lane ?? 'refresh',
      1,
      async () => {
        const url = new URL(`${API}/v2/search`);
        url.searchParams.set('fly_from', params.origin);
        url.searchParams.set('fly_to', params.destination);
        url.searchParams.set('date_from', toTequilaDate(params.departureDate));
        url.searchParams.set('date_to', toTequilaDate(params.departureDate));
        url.searchParams.set('adults', String(passengers));
        url.searchParams.set('curr', currency);
        url.searchParams.set('limit', '20');
        url.searchParams.set('sort', 'date');
        // Recovery is same-day by definition; an overnight layover is the hotel
        // agent's problem, not a flight option. compose.ts builds those.
        url.searchParams.set('max_stopovers', '1');
        url.searchParams.set('vehicle_type', 'aircraft');

        const res = await fetch(url, { headers: { apikey: key }, cache: 'no-store' });
        if (!res.ok) return { offers: [], status: 'error' as SupplierStatus };

        const json = (await res.json()) as { data?: TequilaFlight[] };
        const offers = (json.data ?? [])
          .map((f) => toOffer(f, currency))
          .filter((o): o is Offer => o !== null)
          // A seat count we trust is a seat count we must honour: drop offers
          // that cannot seat the party rather than letting altsForParty reject
          // them later with a confusing "we will not split your party".
          .filter((o) => o.seatsRemaining === 0 || o.seatsRemaining >= passengers);

        return { offers, status: (offers.length ? 'ok' : 'empty') as SupplierStatus };
      },
      () => ({ offers: [], status: 'rate-limited' as SupplierStatus }),
    ).catch(() => ({ offers: [], status: 'error' as SupplierStatus }));
  },

  /**
   * `check_flights` is Kiwi's pre-booking confirmation call — it answers both
   * questions that matter at the moment of spend (is this itinerary still
   * sellable, is the price still what we quoted) about real inventory, so a
   * negative here is trustworthy enough to cascade on.
   *
   * Always `confirm` lane: this only ever runs on the path to spending money,
   * and must be able to draw on the reserve a background poller cannot touch.
   */
  async revalidate(offer): Promise<RevalidationResult> {
    const key = process.env.TEQUILA_API_KEY;
    if (!key) return { state: 'unknown' };

    return withBudget<RevalidationResult>(
      'kiwi',
      'confirm',
      1,
      async () => {
        const url = new URL(`${API}/v2/booking/check_flights`);
        url.searchParams.set('booking_token', offer.supplierOfferId);
        url.searchParams.set('bnum', '0');
        url.searchParams.set('pnum', '1');
        url.searchParams.set('currency', offer.price.currency);

        const res = await fetch(url, { headers: { apikey: key }, cache: 'no-store' });
        if (res.status === 404 || res.status === 410) return { state: 'gone' };
        if (!res.ok) return { state: 'unknown' };

        const json = (await res.json()) as {
          flights_checked?: boolean;
          flights_invalid?: boolean;
          price_change?: boolean;
          total?: number;
        };

        if (json.flights_invalid) return { state: 'gone' };
        // Kiwi answers asynchronously: `flights_checked: false` means it has not
        // finished, which is not evidence of anything. Conflating "still
        // checking" with "confirmed gone" would cascade off a seat that is fine.
        if (json.flights_checked === false) return { state: 'unknown' };

        if (json.price_change && typeof json.total === 'number') {
          const fresh: Offer = {
            ...offer,
            price: { amount: Math.round(json.total), currency: offer.price.currency },
          };
          return { state: 'price-changed', offer: fresh, previous: offer.price };
        }
        return { state: 'available', offer };
      },
      () => ({ state: 'unknown' }) as RevalidationResult,
    ).catch(() => ({ state: 'unknown' }) as RevalidationResult);
  },
};
