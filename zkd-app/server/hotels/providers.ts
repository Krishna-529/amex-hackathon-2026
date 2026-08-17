/**
 * The three accommodation sources, in descending order of how much you can
 * trust them at the moment of spend.
 *
 *   duffel-stays — PRIMARY. Same duffel_test_ token as flights, so one client,
 *                  one auth, one rate ledger. search → rates → quote → book,
 *                  where `quote` is the reversible hold.
 *   liteapi      — second live source. search → prebook → book with simulated
 *                  payment; `prebook` is the hold. Already wired for search in
 *                  server/liteapi.ts, wrapped here rather than rewritten.
 *   makcorps     — NOT a HotelSupplier at all. See the bottom of this file.
 */

import { withBudget, noteOutcome } from '../governor';
import { searchHotels as liteapiSearch } from '../liteapi';
import type {
  HotelHold, HotelOffer, HotelRevalidationResult, HotelSearchParams,
  HotelSupplier, HotelSupplierStatus,
} from './types';

// ── Duffel Stays ───────────────────────────────────────────────────────────

const DUFFEL_API = 'https://api.duffel.com';

function duffelHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    'Duffel-Version': 'v2',
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

type StaysResult = {
  id?: string;
  accommodation?: {
    id?: string;
    name?: string;
    rating?: number;
    location?: { address?: { city_name?: string; line_one?: string } };
    amenities?: { type?: string }[];
    rooms?: {
      rates?: {
        id?: string;
        total_amount?: string;
        total_currency?: string;
        available_payment_methods?: string[];
        cancellation_timeline?: { refund_amount?: string; before?: string }[];
      }[];
    }[];
  };
};

function toDuffelOffer(r: StaysResult, p: HotelSearchParams): HotelOffer | null {
  const acc = r.accommodation;
  const rate = acc?.rooms?.[0]?.rates?.[0];
  if (!acc?.name || !rate?.total_amount || !rate.id) return null;

  // A refund window is only meaningful if it is still open. A timeline entry
  // whose `before` has passed is a cancellation right the member no longer has.
  const timeline = rate.cancellation_timeline ?? [];
  const refundable = timeline.some(
    (t) => Number(t.refund_amount ?? 0) > 0 && (!t.before || new Date(t.before).getTime() > Date.now()),
  );
  const deadline = timeline
    .map((t) => (t.before ? new Date(t.before).getTime() : NaN))
    .filter((n) => Number.isFinite(n) && n > Date.now())
    .sort((a, b) => a - b)[0];

  return {
    id: `duffel-stays:${rate.id}`,
    supplier: 'duffel-stays',
    supplierHotelId: acc.id ?? '',
    supplierRateId: rate.id,
    name: acc.name,
    area: acc.location?.address?.line_one ?? acc.location?.address?.city_name ?? p.cityName,
    city: acc.location?.address?.city_name ?? p.cityName,
    checkin: p.checkin,
    checkout: p.checkout,
    roomsAvailable: null,
    total: {
      amount: Math.round(parseFloat(rate.total_amount)),
      currency: rate.total_currency ?? p.currency,
    },
    refundable,
    cancelDeadline: deadline ?? null,
    minutesFromAirport: null,
    amenities: (acc.amenities ?? []).map((a) => a.type ?? '').filter(Boolean),
    live: true,
  };
}

export const duffelStays: HotelSupplier = {
  id: 'duffel-stays',

  async search(params) {
    const token = process.env.DUFFEL_ACCESS_TOKEN;
    if (!token) return { offers: [], status: 'no-key' as HotelSupplierStatus };

    // Charged to the shared `duffel` ledger — one token, one account limit.
    return withBudget(
      'duffel-stays',
      params.lane ?? 'refresh',
      1,
      async () => {
        const res = await fetch(`${DUFFEL_API}/stays/search`, {
          method: 'POST',
          headers: duffelHeaders(token),
          body: JSON.stringify({
            data: {
              check_in_date: params.checkin,
              check_out_date: params.checkout,
              rooms: params.rooms,
              guests: Array.from({ length: params.adults }, () => ({ type: 'adult' })),
              location: { radius: 20, geographic_coordinates: undefined, address: params.cityName },
            },
          }),
          cache: 'no-store',
        });
        if (!res.ok) {
          noteOutcome('duffel-stays', { ok: false, status: res.status });
          return { offers: [], status: 'error' as HotelSupplierStatus };
        }

        const json = (await res.json()) as { data?: { results?: StaysResult[] } };
        const offers = (json.data?.results ?? [])
          .map((r) => toDuffelOffer(r, params))
          .filter((o): o is HotelOffer => o !== null);
        return { offers, status: (offers.length ? 'ok' : 'empty') as HotelSupplierStatus };
      },
      () => ({ offers: [], status: 'rate-limited' as HotelSupplierStatus }),
    ).catch(() => ({ offers: [], status: 'error' as HotelSupplierStatus }));
  },

  async revalidate(offer): Promise<HotelRevalidationResult> {
    const token = process.env.DUFFEL_ACCESS_TOKEN;
    if (!token || !offer.supplierRateId) return { state: 'unknown' };

    return withBudget<HotelRevalidationResult>(
      'duffel-stays',
      'confirm',
      1,
      async () => {
        // A quote IS the re-check for Stays: it re-prices the rate and tells us
        // whether it can still be sold.
        const res = await fetch(`${DUFFEL_API}/stays/quotes`, {
          method: 'POST',
          headers: duffelHeaders(token),
          body: JSON.stringify({ data: { rate_id: offer.supplierRateId } }),
          cache: 'no-store',
        });
        if (res.status === 404 || res.status === 410 || res.status === 422) return { state: 'gone' };
        if (!res.ok) return { state: 'unknown' };

        const json = (await res.json()) as { data?: { total_amount?: string; total_currency?: string } };
        const amount = json.data?.total_amount;
        if (amount === undefined) return { state: 'unknown' };

        const fresh: HotelOffer = {
          ...offer,
          total: {
            amount: Math.round(parseFloat(amount)),
            currency: json.data?.total_currency ?? offer.total.currency,
          },
        };
        return fresh.total.amount !== offer.total.amount
          ? { state: 'price-changed', offer: fresh, previous: offer.total }
          : { state: 'available', offer: fresh };
      },
      () => ({ state: 'unknown' }) as HotelRevalidationResult,
    ).catch(() => ({ state: 'unknown' }) as HotelRevalidationResult);
  },

  /**
   * The reversible half of the WAIT gate. A quote holds the rate and returns an
   * id that `book` is called against; letting it lapse costs nothing.
   */
  async hold(offer): Promise<HotelHold | null> {
    const token = process.env.DUFFEL_ACCESS_TOKEN;
    if (!token || !offer.supplierRateId) return null;

    return withBudget<HotelHold | null>(
      'duffel-stays',
      'confirm',
      1,
      async () => {
        const res = await fetch(`${DUFFEL_API}/stays/quotes`, {
          method: 'POST',
          headers: duffelHeaders(token),
          body: JSON.stringify({ data: { rate_id: offer.supplierRateId } }),
          cache: 'no-store',
        });
        if (!res.ok) return null;
        const json = (await res.json()) as {
          data?: { id?: string; total_amount?: string; total_currency?: string; expires_at?: string };
        };
        if (!json.data?.id) return null;
        return {
          supplier: 'duffel-stays',
          holdRef: json.data.id,
          expiresAt: json.data.expires_at ? new Date(json.data.expires_at).getTime() : null,
          total: {
            amount: Math.round(parseFloat(json.data.total_amount ?? String(offer.total.amount))),
            currency: json.data.total_currency ?? offer.total.currency,
          },
        };
      },
      () => null,
    ).catch(() => null);
  },
};

// ── LiteAPI ────────────────────────────────────────────────────────────────

/**
 * Adapter over the existing server/liteapi.ts rather than a rewrite.
 *
 * That module returns `HotelOpt`, which carries no rate handle — so `prebook`
 * cannot be wired through it without changing it, and it is load-bearing for
 * app/api/hotels/route.ts today. Search is adapted here; `hold` is left absent,
 * which is the honest signal that this source cannot yet be committed against.
 * Wiring LiteAPI's own prebook/book pair is a contained follow-up.
 */
export const liteapi: HotelSupplier = {
  id: 'liteapi',

  async search(params) {
    if (!process.env.LITEAPI_API_KEY) return { offers: [], status: 'no-key' };

    return withBudget(
      'liteapi',
      params.lane ?? 'refresh',
      1,
      async () => {
        const rows = await liteapiSearch({
          cityName: params.cityName,
          countryCode: params.countryCode,
          checkin: params.checkin,
          checkout: params.checkout,
          currency: params.currency,
          guestNationality: params.guestNationality,
        });

        const offers: HotelOffer[] = rows.map((h) => ({
          id: h.id,
          supplier: 'liteapi' as const,
          supplierHotelId: h.id.replace(/^liteapi:/, ''),
          supplierRateId: null,
          name: h.name,
          area: h.area,
          city: params.cityName,
          checkin: params.checkin,
          checkout: params.checkout,
          roomsAvailable: null,
          total: { amount: h.rate, currency: h.currency },
          refundable: true,
          cancelDeadline: null,
          minutesFromAirport: null,
          amenities: [],
          live: true,
        }));
        return { offers, status: (offers.length ? 'ok' : 'empty') as HotelSupplierStatus };
      },
      () => ({ offers: [], status: 'rate-limited' as HotelSupplierStatus }),
    ).catch(() => ({ offers: [], status: 'error' as HotelSupplierStatus }));
  },

  async revalidate() {
    // No rate handle survives the existing search, so there is nothing to
    // re-check. `unknown` rather than `available` — the house rule is that a
    // source we cannot re-check is a source we cannot promise.
    return { state: 'unknown' };
  },
};

// ── Makcorps ───────────────────────────────────────────────────────────────

export type MarketContext = {
  band: { low: number; median: number; high: number };
  currency: string;
  sampleSize: number;
  /** travels with the number, always — see below */
  caveat: 'arbitrary-dates-no-occupancy';
};

/**
 * Deliberately NOT a HotelSupplier, and deliberately not exported into the
 * portfolio.
 *
 * Makcorps cannot accept check-in/check-out dates — it returns rates for
 * arbitrary future dates — and accepts no occupancy. A recovery prices
 * *tonight's* room for a party of N, so a plausible-looking number for the
 * wrong date is worse than no number at all: it would flow into costFor(), set
 * owedNow, and pass or fail the member's spend cap on a fiction.
 *
 * What it CAN answer is the one coarse question it is actually shaped for: are
 * hotel prices in this city plausibly within reach at all? So it returns a
 * band, never a rate, and its only power is to WITHHOLD — if the median is
 * already above what the member has authorised, the pipeline can stop rather
 * than simulate a booking it has cause to believe is unaffordable.
 *
 * It may never override a live source. If Duffel Stays or LiteAPI answered,
 * their real prices win outright.
 */
export async function marketContext(
  cityId: string,
  currency: string,
): Promise<MarketContext | null> {
  const key = process.env.MAKCORPS_API_KEY;
  if (!key) return null;

  return withBudget<MarketContext | null>(
    'makcorps',
    'confirm',
    1,
    async () => {
      const url = new URL('https://api.makcorps.com/free');
      url.searchParams.set('api_key', key);
      url.searchParams.set('cityid', cityId);
      url.searchParams.set('cur', currency);

      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) return null;

      const json = (await res.json()) as unknown;
      const prices = extractPrices(json);
      if (prices.length === 0) return null;

      prices.sort((a, b) => a - b);
      return {
        band: {
          low: prices[0],
          median: prices[Math.floor(prices.length / 2)],
          high: prices[prices.length - 1],
        },
        currency,
        sampleSize: prices.length,
        caveat: 'arbitrary-dates-no-occupancy',
      };
    },
    () => null,
  ).catch(() => null);
}

/**
 * Makcorps' free response shape is loose and has changed between versions, so
 * this walks whatever came back for anything price-shaped rather than assuming
 * a schema. Being wrong here costs a null, not a bad booking.
 */
function extractPrices(json: unknown): number[] {
  const out: number[] = [];
  const visit = (node: unknown, depth: number) => {
    if (depth > 4 || node === null || typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (/price/i.test(k)) {
        const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v.replace(/[^\d.]/g, '')) : NaN;
        if (Number.isFinite(n) && n > 0) out.push(n);
      } else if (typeof v === 'object') {
        visit(v, depth + 1);
      }
    }
  };
  if (Array.isArray(json)) json.forEach((r) => visit(r, 0));
  else visit(json, 0);
  return out;
}
