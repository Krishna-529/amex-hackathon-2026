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

export type SupplierId = 'duffel' | 'sabre' | 'travelport';

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
};

export type SupplierStatus = 'ok' | 'empty' | 'no-key' | 'error';

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
