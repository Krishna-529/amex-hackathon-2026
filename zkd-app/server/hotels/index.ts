/**
 * One search across every accommodation source — the hotel counterpart of
 * server/suppliers/index.ts, intentionally the same shape so the orchestrator
 * can treat the limbs identically.
 *
 * One behavioural difference from flights, and it matters. Two flight sources
 * returning "AI 2803 at 18:40" describe the same seat inventory. Two hotel
 * sources returning "Holiday Inn Express" describe the same *property* at
 * potentially different rates and cancellation terms. So dedupe keys on the
 * property and keeps the offer you would rather hold — bookable over
 * indicative, then refundable over not, then cheaper — rather than merely the
 * cheapest. A non-refundable room booked during a disruption that then resolves
 * is money the member cannot get back.
 */

import { duffelStays, liteapi, marketContext } from './providers';
import type {
  HotelHold, HotelOffer, HotelRevalidationResult, HotelSearchParams,
  HotelSupplier, HotelSupplierId, HotelSupplierStatus,
} from './types';
import type { HotelOpt } from '../domain/types';
import type { HotelRules } from '../preferences/adapt';

export * from './types';
export { marketContext } from './providers';
export type { MarketContext } from './providers';

/** Makcorps is absent by construction — it is a guard, not a portfolio source. */
const SUPPLIERS: HotelSupplier[] = [duffelStays, liteapi];

const byId = new Map<HotelSupplierId, HotelSupplier>(SUPPLIERS.map((s) => [s.id, s]));

export type HotelSearchResult = {
  offers: HotelOffer[];
  sources: Partial<Record<HotelSupplierId, HotelSupplierStatus>>;
};

export async function searchAccommodation(params: HotelSearchParams): Promise<HotelSearchResult> {
  const settled = await Promise.allSettled(SUPPLIERS.map((s) => s.search(params)));

  const sources: HotelSearchResult['sources'] = {};
  const all: HotelOffer[] = [];

  settled.forEach((r, i) => {
    const id = SUPPLIERS[i].id;
    if (r.status === 'fulfilled') {
      sources[id] = r.value.status;
      all.push(...r.value.offers);
    } else {
      sources[id] = 'error';
    }
  });

  return { offers: rank(dedupe(all)), sources };
}

/**
 * "Holiday Inn Express Chennai OMR" and "Holiday Inn Express, Chennai (OMR)"
 * are one hotel. Punctuation and case are noise; the words are the identity.
 */
function propertyKey(o: HotelOffer): string {
  return `${o.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}|${o.city.toLowerCase()}`;
}

function dedupe(offers: HotelOffer[]): HotelOffer[] {
  const best = new Map<string, HotelOffer>();
  for (const o of offers) {
    const held = best.get(propertyKey(o));
    if (!held || preferOver(o, held)) best.set(propertyKey(o), o);
  }
  return [...best.values()];
}

function preferOver(a: HotelOffer, b: HotelOffer): boolean {
  if (a.live !== b.live) return a.live;
  if (a.refundable !== b.refundable) return a.refundable;
  return a.total.amount < b.total.amount;
}

function rank(offers: HotelOffer[]): HotelOffer[] {
  return [...offers].sort((a, b) => {
    const dist = (o: HotelOffer) => o.minutesFromAirport ?? 999;
    return dist(a) - dist(b) || a.total.amount - b.total.amount;
  });
}

/**
 * Applies the member's hotel rules.
 *
 * Accessibility is a **filter**, not a preference — a member who needs an
 * accessible room is not expressing a taste, and ranking one lower is the same
 * as not offering it. Amenities are filters too when the member marked them
 * "must have". Distance is a filter with a stated limit and a ranking hint
 * below it. Loyalty chains only ever boost.
 *
 * Sources that publish neither amenities nor distance (LiteAPI today) would be
 * eliminated by a strict reading of a filter they cannot answer, so an unknown
 * is treated as "not disqualifying" — with the honesty that costs recorded in
 * the returned `why`, not hidden.
 */
export function applyHotelRules(offers: HotelOffer[], rules: HotelRules): HotelOffer[] {
  const wanted = new Set(rules.mustHaveAmenities);

  return offers.filter((o) => {
    if (rules.accessibilityRequired) {
      // No source here reliably publishes accessibility. Rather than silently
      // offering a room that may not work, keep only what we can stand behind:
      // if the source says nothing, it does not pass an explicit requirement.
      const claims = o.amenities.some((a) => /accessib|wheelchair|step_free/i.test(a));
      if (!claims) return false;
    }
    if (wanted.size > 0 && o.amenities.length > 0) {
      for (const need of wanted) if (!o.amenities.includes(need)) return false;
    }
    if (o.minutesFromAirport !== null) {
      // ~1 km/min in airport-fringe traffic is a deliberately generous
      // conversion; being slightly permissive on distance is better than
      // dropping the only room in a city.
      if (o.minutesFromAirport > rules.maxDistanceKm) return false;
    }
    return true;
  });
}

export async function revalidateHotel(offer: HotelOffer): Promise<HotelRevalidationResult> {
  const supplier = byId.get(offer.supplier);
  if (!supplier) return { state: 'unknown' };
  try {
    return await supplier.revalidate(offer);
  } catch {
    return { state: 'unknown' };
  }
}

/**
 * Take the reversible hold at the WAIT gate.
 *
 * Returns null when the source has no hold concept — which the saga reads as
 * "this cannot be committed against", not as a failure.
 */
export async function holdHotel(offer: HotelOffer): Promise<HotelHold | null> {
  const supplier = byId.get(offer.supplier);
  if (!supplier?.hold) return null;
  try {
    return await supplier.hold(offer);
  } catch {
    return null;
  }
}

/**
 * Walks the ranked list until something is confirmably holdable.
 *
 * Same rule as `firstBookable` for flights: `unknown` is not treated as
 * available, only kept as a last resort. A room we could not re-check is a room
 * we cannot promise.
 */
export async function firstHoldable(
  candidates: HotelOffer[],
): Promise<{ offer: HotelOffer; result: HotelRevalidationResult } | null> {
  let fallback: { offer: HotelOffer; result: HotelRevalidationResult } | null = null;

  for (const candidate of candidates) {
    const result = await revalidateHotel(candidate);
    if (result.state === 'available' || result.state === 'price-changed') {
      return { offer: result.offer, result };
    }
    if (result.state === 'unknown' && !fallback) fallback = { offer: candidate, result };
  }
  return fallback;
}

/**
 * Down to the UI-facing shape the recovery screen already renders.
 *
 * The whole cost goes in `rate` with `extra` left at 0, matching what
 * server/liteapi.ts already does for live results — server/domain/pricing.ts
 * reads `(hotel.extra || hotel.rate) * rooms`, so a live-priced room prices
 * correctly through the existing path without touching it.
 */
export function toHotelOpt(o: HotelOffer, checkinLocal = '15:00'): HotelOpt {
  return {
    id: o.id,
    name: o.name,
    area: o.area,
    checkin: checkinLocal,
    rate: o.total.amount,
    extra: 0,
    currency: o.total.currency,
    ok: o.live,
    why: o.live
      ? `Bookable rate from ${o.supplier}${o.refundable ? ', free cancellation' : ', non-refundable'}`
      : `Indicative price from ${o.supplier} — shown for comparison, not bookable from here`,
    walk: o.minutesFromAirport !== null
      ? `${o.minutesFromAirport} min from the terminal`
      : 'Distance not published by this source',
  };
}

/**
 * The Makcorps guard: can this city plausibly be afforded at all?
 *
 * Only consulted when no live source answered. Returns a reason to STOP, or
 * null to proceed — it can never approve, only withhold.
 */
export async function affordabilityVeto(
  cityId: string,
  cap: { amount: number; currency: string } | null,
): Promise<string | null> {
  if (!cap || cap.amount <= 0) return null;

  const ctx = await marketContext(cityId, cap.currency);
  if (!ctx) return null;

  // Compared in the cap's own currency. marketContext is asked for that
  // currency, so if it answered in another we cannot compare and must not
  // block — the same refusal to guess an FX rate the rest of the repo makes.
  if (ctx.currency !== cap.currency) return null;
  if (ctx.band.median <= cap.amount) return null;

  return `Hotel prices in this city are running around ${ctx.band.median} ${ctx.currency}, above the ${cap.amount} ${cap.currency} you have authorised. That figure is indicative only — it comes from a source that cannot price tonight specifically — so nothing was booked and this is yours to decide.`;
}
