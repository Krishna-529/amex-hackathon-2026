/**
 * Deterministic synthetic hotel generator — the fallback server/engine/
 * groundCache.ts falls back to when server/liteapi.ts has no key or returns
 * empty for a destination. Property/area names follow the same
 * "plausible, clearly-fictional" convention server/domain/seed.ts already
 * uses for its own seeded rows; nightly rates come from
 * server/mockData/hotelInventory.json, not a live rate shop. Every row here
 * is `why`-labeled as generated, never presented as a live LiteAPI result.
 */
import { airport } from './airportDirectory';
import { hash, mulberry32 } from './suppliers/mockFlights';
import type { HotelOpt } from './domain/types';
import inventory from './mockData/hotelInventory.json';

type HotelRow = { name: string; area: string; star: number; nightlyRate: number };
const INVENTORY = inventory as { cities: Record<string, HotelRow[]>; genericFallback: HotelRow[] };

/** What the airline's duty-of-care typically covers per night before the
 *  member is shown an "over your entitlement" figure — an illustrative
 *  policy constant, the same role h1/h2/h3's hand-picked `extra` values
 *  played in server/domain/seed.ts before this generator existed. */
const DUTY_OF_CARE_CEILING = 6000;
/** Beyond this much over the ceiling, the option is marked not bookable —
 *  mirrors seed.ts's h3 row ("Beyond the duty-of-care rate"). */
const NOT_OK_OVER = 6000;

export function generateMockHotels(
  destinationIata: string,
  currency: string,
  seedKey: string,
): HotelOpt[] {
  const city = airport(destinationIata)?.city;
  const rows = (city && INVENTORY.cities[city]) || INVENTORY.genericFallback;
  const rng = mulberry32(hash(`hotel:${destinationIata}:${seedKey}`));

  return rows.map((row, i): HotelOpt => {
    const jitter = 0.92 + rng() * 0.16; // ±8% night-to-night rate variance
    const nightly = Math.round((row.nightlyRate * jitter) / 10) * 10;
    const extra = Math.max(0, nightly - DUTY_OF_CARE_CEILING);
    const ok = extra <= NOT_OK_OVER;
    const why = extra === 0
      ? 'Within the duty-of-care rate the airline will reimburse'
      : ok
        ? `Airline-covered up to your entitlement; ₹${extra.toLocaleString('en-IN')} over`
        : 'Beyond the duty-of-care rate the airline will reimburse';

    return {
      id: `mock-hotel:${destinationIata}:${i}`,
      name: row.name,
      area: row.area,
      checkin: '15:00',
      rate: 0,
      extra,
      currency,
      ok,
      why,
      walk: `New booking · ${row.star}★ · generated inventory, not a live rate shop`,
    };
  });
}
