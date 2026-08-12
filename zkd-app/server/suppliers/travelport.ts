/**
 * Travelport — the third inventory source, named in docs/02 as the alternative
 * GDS once Amadeus Self-Service was decommissioned (17 Jul 2026).
 *
 * We have no credentials, so this returns a deterministic synthetic book built
 * from route physics and flags every offer `live: false`. It exists for two
 * honest reasons: to prove the supplier abstraction is not shaped around any one
 * vendor, and to give the scarcity input in lib/thresholds.ts something to count
 * on routes where the two live sandboxes return nothing. It must never be
 * presented as real inventory.
 */

import type { Offer, RevalidationResult, SearchParams, Supplier, SupplierStatus } from './types';

const CARRIERS = ['AI', '6E', 'UK', 'SG'];

export const travelport: Supplier = {
  id: 'travelport',

  async search(params) {
    if (!process.env.TRAVELPORT_API_KEY) {
      return { offers: syntheticOffers(params), status: 'ok' as SupplierStatus };
    }
    // Real integration lands here once access exists; the shape above is the contract.
    return { offers: syntheticOffers(params), status: 'ok' };
  },

  async revalidate(offer): Promise<RevalidationResult> {
    // Synthetic inventory cannot be re-checked against anything real.
    return { state: 'unknown' };
  },
};

function syntheticOffers(params: SearchParams): Offer[] {
  const base = Date.parse(`${params.departureDate}T00:00:00Z`);
  if (Number.isNaN(base)) return [];

  const seed = hash(`${params.origin}${params.destination}${params.departureDate}`);
  const count = 3 + (seed % 3);

  return Array.from({ length: count }, (_, i) => {
    const s = hash(`${seed}:${i}`);
    const depHour = 6 + ((s >> 3) % 15);
    const departsAt = base + depHour * 3600_000;
    const durationMin = 95 + (s % 120);
    return {
      id: `travelport:${params.origin}${params.destination}:${i}`,
      supplier: 'travelport' as const,
      supplierOfferId: `tp-${s}`,
      flightCode: `${CARRIERS[s % CARRIERS.length]} ${100 + (s % 899)}`,
      from: params.origin,
      to: params.destination,
      departsAt,
      arrivesAt: departsAt + durationMin * 60_000,
      cabin: params.cabin ?? 'Economy',
      seatsRemaining: 1 + (s % 9),
      price: { amount: 4200 + (s % 9000), currency: 'INR' },
      expiresAt: Date.now() + (10 + (s % 20)) * 60_000,
      live: false,
    };
  });
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}
