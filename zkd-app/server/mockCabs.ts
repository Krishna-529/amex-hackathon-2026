/**
 * Deterministic synthetic ground-transfer generator. No real cab supplier is
 * wired anywhere in this app — UBER_API_KEY exists in .env.example but
 * nothing calls it — so this is the only source for `candidates.cabs`,
 * always generated, never a live quote. Fleet/rate data comes from
 * server/mockData/cabFleet.json.
 */
import { hash, mulberry32 } from './suppliers/mockFlights';
import type { CabOpt } from './domain/types';
import fleet from './mockData/cabFleet.json';

type Vehicle = { kind: string; seats: number; baseFare: number; perKm: number };
const FLEET = fleet as { vehicles: Vehicle[]; dutyOfCareAllowance: number; notOkOverAllowance: number };

/** No precise hotel coordinate exists in server/mockData/hotelInventory.json
 *  (area strings are descriptive, e.g. "Aerocity · 8 min from DEL T3"), so
 *  transfer distance is a representative airport-to-city-hotel band rather
 *  than a per-property lookup — the same "illustrative, not filed" honesty
 *  server/mockHotels.ts's rates already carry. */
const REPRESENTATIVE_TRANSFER_KM = 14;

export function generateMockCabs(destinationIata: string, currency: string, seedKey: string): CabOpt[] {
  const rng = mulberry32(hash(`cab:${destinationIata}:${seedKey}`));

  return FLEET.vehicles.map((v, i): CabOpt => {
    const jitter = 0.9 + rng() * 0.2;
    const fare = Math.round(((v.baseFare + v.perKm * REPRESENTATIVE_TRANSFER_KM) * jitter) / 10) * 10;
    const extra = Math.max(0, fare - FLEET.dutyOfCareAllowance);
    const ok = extra <= FLEET.notOkOverAllowance;
    const why = extra === 0
      ? 'Within the transfer allowance the airline reimburses'
      : ok
        ? `₹${extra.toLocaleString('en-IN')} over the allowance`
        : 'Beyond the transfer allowance the airline will reimburse';

    return {
      id: `mock-cab:${destinationIata}:${i}`,
      kind: v.kind,
      seats: v.seats,
      extra,
      currency,
      ok,
      why,
    };
  });
}
