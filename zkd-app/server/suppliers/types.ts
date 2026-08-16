/**
 * The one offer shape every supplier normalises to.
 *
 * Two fields exist here that the old per-supplier `Alt` never carried, and both
 * are load-bearing:
 *
 *   expiresAt — how long the supplier will honour this price. lib/confirmWindow.ts
 *   derives the member's decision window from it, which is the whole reason the
 *   window is defensible rather than a guessed 90 seconds.
 *
 *   currency — money without a currency is an India-only assumption. Every fare
 *   crossing this boundary carries its own.
 */

/**
 * `kiwi`, `skyscanner` and `travelfusion` join the original three. Nothing
 * downstream distinguishes them — they satisfy the same contract, which is the
 * point: swapping a sandbox for an enterprise source later is a registry edit
 * in ./index.ts, not a rewrite of anything that consumes offers.
 */
export type SupplierId =
  | 'duffel'
  | 'sabre'
  | 'travelport'
  | 'kiwi'
  | 'skyscanner'
  | 'travelfusion';

export type Money = { amount: number; currency: string };

export type Offer = {
  id: string;
  supplier: SupplierId;
  /** the supplier's own offer id, needed to re-price and to book */
  supplierOfferId: string;
  flightCode: string;
  from: string;
  to: string;
  /** epoch ms */
  departsAt: number;
  arrivesAt: number;
  cabin: string;
  seatsRemaining: number;
  price: Money;
  /** epoch ms after which the price is no longer honoured; null when unknown */
  expiresAt: number | null;
  live: boolean;
};

export type SearchParams = {
  origin: string;
  destination: string;
  /** ISO date */
  departureDate: string;
  cabin?: string;
  /**
   * Party size. Kiwi needs it to report truthful `availability.seats`, and a
   * search that ignores it can return offers the party cannot actually fit on —
   * which altsForParty would then have to reject after the fact.
   */
  passengers?: number;
  /**
   * Which budget lane pays for this call (server/governor.ts). Speculative
   * warming is `refresh`; anything on the path to spending the member's money
   * is `confirm` and may draw on the reserve. Defaults to `refresh` — the safe
   * side, since forgetting to mark a poll as speculative is the mistake that
   * drains a quota.
   */
  lane?: 'refresh' | 'confirm';
};

/**
 * `rate-limited` is distinct from `error` on purpose: a throttled source is not
 * a broken one, and the UI should say "we backed off to protect a free tier"
 * rather than implying the supplier fell over. Set by server/governor.ts.
 */
export type SupplierStatus = 'ok' | 'empty' | 'no-key' | 'error' | 'rate-limited';

export type SearchResult = {
  offers: Offer[];
  sources: Record<SupplierId, SupplierStatus>;
};

export type Supplier = {
  id: SupplierId;
  search(params: SearchParams): Promise<{ offers: Offer[]; status: SupplierStatus }>;
  /**
   * Re-check a specific offer immediately before ticketing. The member may have
   * spent minutes deciding, and inventory does not wait for them.
   */
  revalidate(offer: Offer): Promise<RevalidationResult>;
};

export type RevalidationResult =
  | { state: 'available'; offer: Offer }
  | { state: 'price-changed'; offer: Offer; previous: Money }
  | { state: 'gone' }
  | { state: 'unknown' };
