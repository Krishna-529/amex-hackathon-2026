/**
 * Keeps each flight's hotel and cab candidates fresh, the same TTL/in-flight
 * pattern server/engine/altsCache.ts already uses for alternative flights.
 * Before this, `Flight.candidates.hotels`/`cabs`/`cabLegs` were either a
 * hardcoded literal written once in server/domain/seed.ts (2 of the 6 seeded
 * flights) or permanently empty (the other 4) — nothing ever refreshed them.
 * This gives every flight a real LiteAPI hotel search (falling back to
 * server/mockHotels.ts when there's no key or no result) and a generated cab
 * list (server/mockCabs.ts — there is no real ground-transfer supplier to
 * call), triggered by the same real risk-crossing gate that already pre-caches
 * alts (server/engine/forecast.ts's triggerAltPrefetchIfWarranted).
 */
import { searchHotels, countryCodeFor, nationalityCode } from '../liteapi';
import { generateMockHotels } from '../mockHotels';
import { generateMockCabs } from '../mockCabs';
import { fetchProfile } from '../myca';
import { airport, localTime } from '../airportDirectory';
import { getThresholdConfig } from '@/lib/thresholdConfig';
import { effectiveAltTtlMs } from './rescoreTiming';
import * as store from '../domain/store';
import type { Flight, CabLeg } from '../domain/types';

const inFlight = new Map<string, Promise<void>>();

/** Shares config/risk-thresholds.json's altCache.ttlMs (and its
 *  departure-proximity scaling, rescoreTiming.ts's effectiveAltTtlMs) with
 *  altsCache.ts — no separate config field exists for ground, and hotels/
 *  cabs ride the same risk-crossing gate as alts do (forecast.ts's
 *  triggerAltPrefetchIfWarranted fires both together), so they share the
 *  same freshness window rather than drifting from a second hardcoded
 *  constant. */
export function isGroundStale(flight: Flight): boolean {
  const ttlMs = effectiveAltTtlMs(flight, getThresholdConfig());
  return !flight.groundAsOf || Date.now() - flight.groundAsOf > ttlMs;
}

/** Fetches/generates and caches, UNCONDITIONALLY — this has no staleness
 *  check of its own, only the in-flight (concurrent-caller) dedup above. A
 *  caller that wants "only if actually stale" must go through
 *  refreshGroundIfStale below; calling this directly on every risk-gate
 *  crossing (as forecast.ts's triggerAltPrefetchIfWarranted used to) means
 *  a flight that stays above the gate across several scoring ticks
 *  re-searches every tick regardless of how fresh the cache still is —
 *  exactly the "search on every poll" cost the whole threshold-gated
 *  pre-cache design exists to avoid. Same contract as refreshAlts. */
export function refreshGround(flightId: string): Promise<void> {
  const existing = inFlight.get(flightId);
  if (existing) return existing;

  const p = compute(flightId).finally(() => inFlight.delete(flightId));
  inFlight.set(flightId, p);
  return p;
}

/** Non-blocking, staleness-gated refresh — the one the threshold-crossing
 *  trigger (forecast.ts's triggerAltPrefetchIfWarranted) should call: a
 *  flight that keeps re-crossing the risk gate across several scoring
 *  ticks inside the TTL window must not re-search every tick, same
 *  contract as altsCache.ts's refreshAltsIfStale. */
export function refreshGroundIfStale(flight: Flight): void {
  if (!isGroundStale(flight)) return;
  void refreshGround(flight.id).catch(() => {});
}

function buildCabLegs(flight: Flight, hotelName: string, arrivesAt: number): CabLeg[] {
  const departAt = arrivesAt + 14 * 60 * 60_000; // representative next-morning departure to the airport
  return [
    {
      id: 'gl1', from: `${flight.to} Airport`, to: hotelName,
      pickup: localTime(flight.to, arrivesAt), note: 'Timed around your actual arrival',
    },
    {
      id: 'gl2', from: hotelName, to: `${flight.to} Airport`,
      pickup: localTime(flight.to, departAt), note: 'Timed for your onward departure',
    },
  ];
}

async function compute(flightId: string): Promise<void> {
  const flight = await store.getFlight(flightId);
  if (!flight) return;

  const ap = airport(flight.to);
  const profile = await fetchProfile('demo');
  const currency = profile.payment.billingCurrency;

  const arrivesAt = new Date(flight.depISO).getTime() + flight.durationMin * 60_000;
  const checkin = new Date(arrivesAt);
  const checkout = new Date(arrivesAt + 24 * 60 * 60_000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  let hotels = ap
    ? await searchHotels({
        cityName: ap.city,
        countryCode: countryCodeFor(ap.country),
        checkin: fmt(checkin),
        checkout: fmt(checkout),
        currency,
        guestNationality: nationalityCode(profile.traveller.nationality),
      }).catch(() => [])
    : [];

  if (hotels.length === 0) {
    hotels = generateMockHotels(flight.to, currency, flightId);
  }

  const cabs = generateMockCabs(flight.to, currency, flightId);
  const cabLegs = buildCabLegs(flight, hotels[0]?.name ?? `${flight.to} area hotel`, arrivesAt);

  flight.candidates.hotels = hotels;
  flight.candidates.cabs = cabs;
  flight.candidates.cabLegs = cabLegs;
  flight.groundAsOf = Date.now();
  // Persist — see forecast.ts's applyScore for why.
  await store.createFlight(flight);
}
