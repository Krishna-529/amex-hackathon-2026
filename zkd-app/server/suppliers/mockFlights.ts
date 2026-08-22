/**
 * Deterministic synthetic flight-offer generator — the data behind
 * server/suppliers/travelport.ts's fallback path. Not a real GDS: built from
 * server/mockData/airlines.json (real carrier codes/names/fleets, illustrative
 * fare bands) and real route geometry (server/airportDirectory.ts's
 * distanceKm, the same great-circle function riskModel.ts uses for
 * distance_km), so offers land on realistic durations and fares for the
 * actual origin/destination instead of a flat random band. Every offer this
 * produces carries `live: false` — see server/suppliers/types.ts — so nothing
 * downstream can mistake it for real inventory.
 */
import { airport, distanceKm, isInternational } from '../airportDirectory';
import type { Offer, SearchParams } from './types';
import airlinesData from '../mockData/airlines.json';

type Carrier = { code: string; name: string; country: string; aircraft: string[]; fareIndexPerKm: number; minFare: number };
const AIRLINES = airlinesData as {
  domestic: Carrier[];
  international: Carrier[];
  cabinsByRank: string[];
  cabinMultiplier: Record<string, number>;
};

/** Small deterministic PRNG (mulberry32) seeded from a string hash — same
 *  route+date always produces the same offer set within a process, matching
 *  the contract the old inline hash-based generator already had. Exported so
 *  server/mockHotels.ts and server/mockCabs.ts share one seeding scheme
 *  instead of each rolling its own. */
export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Cruise + taxi/climb model, tuned to land close to real scheduled block
 *  times for Indian domestic (e.g. MAA-DEL ~2h35m at 1700km) and long-haul
 *  international sectors, without a per-route lookup table. */
export function scheduledDurationMin(km: number): number {
  const cruiseKmh = km > 4000 ? 870 : 780;
  return Math.round((km / cruiseKmh) * 60 + 35);
}

export function generateFlightOffers(params: SearchParams): Offer[] {
  const origin = airport(params.origin);
  const dest = airport(params.destination);
  const base = Date.parse(`${params.departureDate}T00:00:00Z`);
  if (!origin || !dest || Number.isNaN(base)) return [];

  const km = distanceKm(origin, dest);
  const international = isInternational(params.origin, params.destination);
  const pool = international ? AIRLINES.international : AIRLINES.domestic;
  if (pool.length === 0) return [];

  const seed = hash(`${params.origin}${params.destination}${params.departureDate}`);
  const rng = mulberry32(seed);
  // Long-haul international routes run fewer daily frequencies than a busy
  // domestic trunk route — reflected in offer count, not just fare.
  const count = international ? 3 + Math.floor(rng() * 3) : 5 + Math.floor(rng() * 5);
  const durationMin = scheduledDurationMin(km);

  const offers: Offer[] = [];
  for (let i = 0; i < count; i++) {
    const carrier = pool[Math.floor(rng() * pool.length)];
    const depHour = 5 + Math.floor(rng() * 19); // 05:00–23:59 spread across the day
    const depMin = Math.floor(rng() * 12) * 5;
    const departsAt = base + (depHour * 60 + depMin) * 60_000;
    const arrivesAt = departsAt + durationMin * 60_000;

    // Cabin mix: mostly Economy, a real minority of premium cabins — matches
    // how a live search actually skews rather than one offer per cabin.
    const cabinRoll = rng();
    const cabin = cabinRoll > 0.93 ? 'First' : cabinRoll > 0.78 ? 'Business' : cabinRoll > 0.62 ? 'Premium Economy' : 'Economy';
    const cabinMult = AIRLINES.cabinMultiplier[cabin] ?? 1;

    const jitter = 0.85 + rng() * 0.3; // ±15% day-to-day fare variance
    const fareAmount = Math.round(Math.max(carrier.minFare, km * carrier.fareIndexPerKm * cabinMult * jitter) / 10) * 10;

    const flightNumber = 100 + Math.floor(rng() * 2899);
    const seatsRemaining = 1 + Math.floor(rng() * 9);
    // Held for a plausible window like a real search result would be, not a
    // fixed constant — feeds lib/confirmWindow.ts on the same footing as a
    // live Duffel expires_at when this is the offer actually chosen.
    const expiresAt = Date.now() + (12 + Math.floor(rng() * 18)) * 60_000;

    // Economy demo fares are changeable and mostly refundable; premium cabins
    // always refundable. Without carriers + fareRules an offer reaches the
    // policy gate incomplete and is default-denied (canon rule), which is what
    // used to leave the recovery with nothing bookable — so a synthetic offer
    // that stands in for real inventory has to carry a complete, plausible set.
    const refundable = cabin !== 'Economy' ? true : rng() > 0.35;

    offers.push({
      id: `mock:${params.origin}${params.destination}:${params.departureDate}:${i}`,
      supplier: 'travelport',
      supplierOfferId: `mock-${seed}-${i}`,
      flightCode: `${carrier.code} ${flightNumber}`,
      from: params.origin,
      to: params.destination,
      departsAt,
      arrivesAt,
      cabin,
      seatsRemaining,
      price: { amount: fareAmount, currency: 'INR' },
      expiresAt,
      live: false,
      supplierType: 'coupon',
      carriers: { marketing: carrier.code, operating: carrier.code, validating: carrier.code },
      fareRules: {
        fareBasis: `${cabin.charAt(0).toUpperCase()}DEMO`,
        changeable: true,
        refundable,
        reissuePermitted: true,
        interlinePermitted: true,
        voidWindowMinutes: null,
      },
    });
  }

  return offers.sort((a, b) => a.departsAt - b.departsAt);
}
