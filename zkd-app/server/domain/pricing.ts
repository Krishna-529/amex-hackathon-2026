/**
 * The single source of "what does this cost" for a recovery — one PNR can now
 * cover a party, so duty-of-care items scale per head (rooms, vehicles) while
 * the flight itself is bought once per traveller.
 *
 * lib/entitlement.ts answers WHAT is owed and stays party-agnostic on purpose
 * — it is a jurisdiction lookup, not a cost calculator. This file answers HOW
 * MUCH, by how many. server/domain/refund.ts answers what comes BACK, and the
 * difference between the two is the only number a member actually decides on.
 *
 * ── Two things this file used to do and deliberately no longer does ────────
 *
 * 1. It zeroed the fare for `kind: 'carrier-protected'` options. That kind no
 *    longer exists — it was a fabricated free row, not a real entitlement, and
 *    server/domain/types.ts's AltKind records why it went.
 *
 * 2. It computed `overCap` against the card's per-transaction ceiling, which
 *    was the hard stop on every spend path. The ceiling was removed on
 *    2026-08-19. Nothing is refused for being expensive any more; instead the
 *    member is told what is about to be spent and given a window to stop it.
 *    That trade is deliberate and it is the product's safety story now, so it
 *    is worth being explicit about what was given up: an unattended recovery
 *    can now spend an arbitrary amount if the member never answers. What
 *    stands between them and that is the notification ladder in
 *    server/notify/templates.ts, and it has to actually reach them — which is
 *    why delivery is ledger-logged and why an undeliverable alert is a real
 *    defect rather than a cosmetic one.
 */
import type { Flight, RecoveryTask } from './types';

/** Two travellers to a room, same assumption a travel desk would use. */
export const ROOM_OCCUPANCY = 2;

export type PartyCost = {
  partySize: number;
  fare: number;
  rooms: number;
  hotel: number;
  vehicles: number;
  cab: number;
  /** what the replacement plan costs, before anything comes back */
  total: number;
  currency: string;
};

export function costFor(
  flight: Flight,
  choice: Pick<RecoveryTask, 'chosenAltId' | 'chosenHotelId' | 'chosenCabId'>,
  partySize: number,
  displayCurrency: string,
): PartyCost {
  const alt = flight.candidates.alts.find((a) => a.id === choice.chosenAltId);
  const hotel = flight.candidates.hotels.find((h) => h.id === choice.chosenHotelId);
  const cab = flight.candidates.cabs.find((c) => c.id === choice.chosenCabId);

  const fare = alt ? alt.fare * partySize : 0;

  const rooms = Math.ceil(partySize / ROOM_OCCUPANCY);
  const hotelUnit = hotel ? hotel.extra || hotel.rate : 0;
  const hotelCost = hotelUnit * rooms;

  const vehicles = cab && cab.seats > 0 ? Math.ceil(partySize / cab.seats) : 0;
  const cabCost = (cab?.extra ?? 0) * vehicles;

  const total = fare + hotelCost + cabCost;

  return {
    partySize,
    fare,
    rooms,
    hotel: hotelCost,
    vehicles,
    cab: cabCost,
    total,
    currency: alt?.currency ?? displayCurrency,
  };
}
