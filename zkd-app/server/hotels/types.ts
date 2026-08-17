/**
 * The one hotel-offer shape every accommodation source normalises to — the
 * direct counterpart of server/suppliers/types.ts, and deliberately the same
 * shape of contract so the orchestrator need not care which limb of the trip it
 * is rebooking.
 *
 * server/liteapi.ts predates this and returns the UI-facing `HotelOpt`
 * directly. That was fine when hotels had one source. With three it is not,
 * because `HotelOpt` carries no provenance, no expiry and no room handle —
 * which means nothing downstream can re-check a room before spending on it, and
 * nothing can say which source a room came from when two disagree on price.
 *
 * ── The hold is real here, unlike flights ─────────────────────────────────
 *
 * Both live hotel sources expose a genuine two-phase flow: LiteAPI `prebook`
 * and Duffel Stays `quote` reserve a rate and return a short-lived handle
 * *before* anything is bought. That maps exactly onto the canon WAIT gate —
 * `holdRef` is taken in HOLD_PENDING and is reversible (it lapses free), and
 * only `book` against that handle in CONFIRMED is irreversible.
 *
 * It is worth the extra call: it turns "we think this room is still there" into
 * "the supplier has set this rate aside for us", which is the difference
 * between a hold gate that means something and one that is only a countdown.
 */

import type { Money } from '../suppliers/types';

export type HotelSupplierId = 'duffel-stays' | 'liteapi' | 'makcorps';

/** Reuses the flight status vocabulary — same governor, same degradation rules. */
export type HotelSupplierStatus = 'ok' | 'empty' | 'no-key' | 'error' | 'rate-limited';

export type HotelOffer = {
  id: string;
  supplier: HotelSupplierId;
  /** the supplier's own handle for the property */
  supplierHotelId: string;
  /** the specific rate — what a hold is taken against; null when the source has no rate concept */
  supplierRateId: string | null;
  name: string;
  area: string;
  city: string;
  checkin: string;
  checkout: string;
  /** rooms the source says are left; null when it does not say */
  roomsAvailable: number | null;
  /** total for the stay for ONE room — pricing.ts multiplies by rooms needed */
  total: Money;
  refundable: boolean;
  /** epoch ms the free-cancellation window closes; null when unknown */
  cancelDeadline: number | null;
  /** minutes by road from the terminal; null when the source does not say */
  minutesFromAirport: number | null;
  amenities: string[];
  /** false for sources that quote market prices rather than bookable rates */
  live: boolean;
};

export type HotelSearchParams = {
  /** the airport the member is stranded at — the registry resolves it to a city */
  iata: string;
  cityName: string;
  countryCode: string;
  checkin: string;
  checkout: string;
  /** rooms needed for the party — ceil(partySize / ROOM_OCCUPANCY), from pricing.ts */
  rooms: number;
  adults: number;
  currency: string;
  guestNationality: string;
  lane?: 'refresh' | 'confirm';
};

/** A reversible reservation taken at the WAIT gate. Lapses free if never booked. */
export type HotelHold = {
  supplier: HotelSupplierId;
  /** the handle `book` is called against */
  holdRef: string;
  /** epoch ms the hold lapses; null when the supplier does not say */
  expiresAt: number | null;
  /** the price the hold locks — may differ from the searched price */
  total: Money;
};

export type HotelRevalidationResult =
  | { state: 'available'; offer: HotelOffer }
  | { state: 'price-changed'; offer: HotelOffer; previous: Money }
  | { state: 'gone' }
  | { state: 'unknown' };

export type HotelSupplier = {
  id: HotelSupplierId;
  search(params: HotelSearchParams): Promise<{ offers: HotelOffer[]; status: HotelSupplierStatus }>;
  /** re-check immediately before spend; sources that cannot are honest about it */
  revalidate(offer: HotelOffer): Promise<HotelRevalidationResult>;
  /**
   * Take the reversible hold. Absent on sources that have no such concept —
   * which is itself the signal that they cannot be committed against.
   */
  hold?(offer: HotelOffer): Promise<HotelHold | null>;
};
