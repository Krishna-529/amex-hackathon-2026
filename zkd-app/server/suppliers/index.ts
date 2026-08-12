/**
 * One search across every inventory source, because no single GDS carries enough
 * of the market to recover a trip from — and because the union of what they hold
 * is what the scarcity input in lib/thresholds.ts counts.
 *
 * Nothing here is load-bearing on any one vendor: sources register themselves,
 * a dead one degrades the result rather than failing it, and per-source status
 * is reported so the UI can say what it actually looked at.
 */

import { duffel } from './duffel';
import { sabre } from './sabre';
import { travelport } from './travelport';
import type { Offer, RevalidationResult, SearchParams, SearchResult, Supplier, SupplierId, SupplierStatus } from './types';

export * from './types';

const SUPPLIERS: Supplier[] = [duffel, sabre, travelport];

const byId = new Map<SupplierId, Supplier>(SUPPLIERS.map((s) => [s.id, s]));

export async function searchInventory(params: SearchParams): Promise<SearchResult> {
  const settled = await Promise.allSettled(SUPPLIERS.map((s) => s.search(params)));

  const sources = {} as Record<SupplierId, SupplierStatus>;
  const all: Offer[] = [];

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
 * The same physical flight reaches us from more than one source. Keep the one
 * that can actually be booked and re-checked: live inventory over synthetic,
 * then a known expiry over none, then cheaper.
 */
function dedupe(offers: Offer[]): Offer[] {
  const best = new Map<string, Offer>();
  for (const o of offers) {
    const key = `${o.flightCode}:${new Date(o.departsAt).toISOString().slice(0, 16)}`;
    const held = best.get(key);
    if (!held || preferOver(o, held)) best.set(key, o);
  }
  return [...best.values()];
}

function preferOver(a: Offer, b: Offer): boolean {
  if (a.live !== b.live) return a.live;
  const aExp = a.expiresAt !== null;
  const bExp = b.expiresAt !== null;
  if (aExp !== bExp) return aExp;
  return a.price.amount < b.price.amount;
}

function rank(offers: Offer[]): Offer[] {
  return [...offers].sort((a, b) => a.departsAt - b.departsAt || a.price.amount - b.price.amount);
}

/**
 * Re-check an offer immediately before ticketing.
 *
 * This is the answer to "the seat filled up while the member was deciding". We
 * do not shorten the window to outrun the market — we confirm the seat is still
 * there at the moment of spend, and the caller cascades to the next candidate if
 * it is not. Consent was to the outcome, not to this specific seat.
 */
export async function revalidateOffer(offer: Offer): Promise<RevalidationResult> {
  const supplier = byId.get(offer.supplier);
  if (!supplier) return { state: 'unknown' };
  try {
    return await supplier.revalidate(offer);
  } catch {
    return { state: 'unknown' };
  }
}

/**
 * Walks the ranked portfolio until something is confirmably bookable.
 *
 * `unknown` is deliberately not treated as available — a source we could not
 * re-check is a source we cannot promise, so it falls through to the next
 * candidate and is only returned if nothing better survives.
 */
export async function firstBookable(
  candidates: Offer[],
): Promise<{ offer: Offer; result: RevalidationResult } | null> {
  let fallback: { offer: Offer; result: RevalidationResult } | null = null;

  for (const candidate of candidates) {
    const result = await revalidateOffer(candidate);
    if (result.state === 'available' || result.state === 'price-changed') {
      return { offer: result.offer, result };
    }
    if (result.state === 'unknown' && !fallback) fallback = { offer: candidate, result };
  }
  return fallback;
}

/** Total seats we can see across every source — the scarcity input for thresholds. */
export function seatsAcross(offers: Offer[]): number {
  return offers.reduce((n, o) => n + o.seatsRemaining, 0);
}
