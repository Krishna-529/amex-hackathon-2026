/**
 * The single source of "what does this cost" for a recovery — one PNR can now
 * cover a party, so duty-of-care items scale per head (rooms, vehicles) while
 * the flight itself is either owed for free or bought once per traveller.
 *
 * lib/entitlement.ts answers WHAT is owed and stays party-agnostic on purpose
 * — it is a jurisdiction lookup, not a cost calculator. This file answers HOW
 * MUCH, by how many.
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
  total: number;
  currency: string;
  cap: number;
  /** the per-transaction cap is a single-transaction ceiling on the PARTY
   *  total, not a per-head allowance — see the comment at the call site in
   *  server/engine/simulation.ts settleExpired() for what this triggers. */
  overCap: boolean;
};

export function costFor(
  flight: Flight,
  choice: Pick<RecoveryTask, 'chosenAltId' | 'chosenHotelId' | 'chosenCabId'>,
  partySize: number,
  cap: { amount: number; currency: string },
): PartyCost {
  const alt = flight.candidates.alts.find((a) => a.id === choice.chosenAltId);
  const hotel = flight.candidates.hotels.find((h) => h.id === choice.chosenHotelId);
  const cab = flight.candidates.cabs.find((c) => c.id === choice.chosenCabId);

  // Carrier-protected is owed, not bought — zero regardless of the seeded
  // fare field, so a future data mistake there can't silently charge for it.
  const fare = alt ? (alt.kind === 'carrier-protected' ? 0 : alt.fare * partySize) : 0;

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
    currency: alt?.currency ?? cap.currency,
    cap: cap.amount,
    overCap: total > cap.amount,
  };
}
