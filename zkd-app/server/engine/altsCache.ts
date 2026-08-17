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
import { getThresholdConfig } from '@/lib/thresholdConfig';
import { effectiveAltTtlMs } from './rescoreTiming';
import * as store from '../domain/store';
import type { Flight } from '../domain/types';

const inFlight = new Map<string, Promise<void>>();

/** config/risk-thresholds.json's altCache.ttlMs, read live and scaled down as
 *  departure approaches (rescoreTiming.ts's effectiveAltTtlMs — inventory
 *  churns faster close in, so the same absolute staleness matters more) —
 *  this is the same TTL that gates when a stale cache is worth refreshing at
 *  all; a hardcoded constant here would silently defeat the config file's
 *  whole stated purpose ("ops can retune... without a redeploy") even though
 *  every other alt-cache knob already goes through it. */
export function isAltsStale(flight: Flight): boolean {
  const ttlMs = effectiveAltTtlMs(flight, getThresholdConfig());
  return !flight.altsAsOf || Date.now() - flight.altsAsOf > ttlMs;
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
  const flight = await store.getFlight(flightId);
  if (!flight) return;

  const date = flight.depISO.slice(0, 10);
  const partySize = await maxPartyOnFlight(flightId);

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
  // Persist — see forecast.ts's applyScore for why createFlight() (an
  // upsert-on-id) is the write-back call here rather than a mutation on a
  // shared in-memory reference.
  await store.createFlight(flight);
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
