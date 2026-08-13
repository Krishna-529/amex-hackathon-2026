/**
 * Client-side mirror of the room/vehicle math in server/domain/pricing.ts,
 * used only for display before the member has acted — the server recomputes
 * the authoritative total itself (preauth route, and the recovery engine) so
 * nothing here is ever trusted for the actual charge.
 */
export const ROOM_OCCUPANCY = 2;

export function roomsFor(partySize: number): number {
  return Math.ceil(partySize / ROOM_OCCUPANCY);
}

export function vehiclesFor(partySize: number, cabSeats: number): number {
  return cabSeats > 0 ? Math.ceil(partySize / cabSeats) : 0;
}
