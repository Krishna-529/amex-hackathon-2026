/**
 * Keeps each flight's alternative-flight candidates fresh from real supplier
 * inventory, the same way server/engine/forecast.ts keeps the disruption
 * forecast fresh — same TTL/in-flight-request pattern, same "read paths kick
 * a non-blocking refresh" contract.
 *
 * Before this, `Flight.candidates.alts` was a hardcoded literal written once
 * in server/domain/seed.ts. Every member saw the same three seeded rows no
 * matter what Duffel/Sabre/Travelport actually had. This replaces that with
 * a live Duffel + Sabre + Travelport search, cached on the Flight.
 */
import { searchInventory } from '../suppliers';
import { fetchProfile } from '../myca';
import { offersToAlts, carrierProtectedAlt } from '../domain/altsFromOffers';
import { maxPartyOnFlight } from './forecast';
import * as store from '../domain/store';
import type { Flight } from '../domain/types';

const TTL_MS = 10 * 60 * 1000;

const inFlight = new Map<string, Promise<void>>();

export function isAltsStale(flight: Flight): boolean {
  return !flight.altsAsOf || Date.now() - flight.altsAsOf > TTL_MS;
}

/**
 * Fetches and caches. Concurrent callers for the same flight share one
 * request — five devices polling the same flight must not become five
 * supplier searches.
 */
export function refreshAlts(flightId: string): Promise<void> {
  const existing = inFlight.get(flightId);
  if (existing) return existing;

  const p = compute(flightId).finally(() => inFlight.delete(flightId));
  inFlight.set(flightId, p);
  return p;
}

async function compute(flightId: string): Promise<void> {
  const flight = store.getFlight(flightId);
  if (!flight) return;

  const date = flight.depISO.slice(0, 10);
  const partySize = maxPartyOnFlight(flightId);

  const [{ offers }, profile] = await Promise.all([
    searchInventory({ origin: flight.from, destination: flight.to, departureDate: date }),
    fetchProfile('demo'),
  ]);

  const market = offersToAlts(
    offers,
    flight.from,
    flight.to,
    profile.preferences.cabinEntitlement,
    profile.preferences.perTransactionCap,
  );
  // Real inventory can genuinely be empty on a sparse sandbox route (Sabre
  // cert especially) — carrierProtectedAlt returns null rather than fabricate
  // a flight when there is nothing real to build one from.
  const protectedAlt = carrierProtectedAlt(offers, flight.code, flight.from, flight.to, partySize);

  flight.candidates.alts = protectedAlt ? [protectedAlt, ...market] : market;
  flight.altsAsOf = Date.now();
}

/**
 * Non-blocking refresh for read paths. A page asking for a flight should
 * render whatever alternatives we already hold rather than waiting on three
 * supplier round trips; the next poll picks up the fresh set.
 */
export function refreshAltsIfStale(flight: Flight): void {
  if (!isAltsStale(flight)) return;
  void refreshAlts(flight.id).catch(() => {});
}
