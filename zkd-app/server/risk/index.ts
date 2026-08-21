/**
 * The one call the pipeline makes to resolve live disruption risk for a whole
 * recovery: fan out weather + NOTAM + news over the UNIQUE airports and carriers
 * the candidate set touches (never per candidate), take the worst signal per
 * key, and hand back three maps the ranker reads synchronously.
 *
 * Every provider degrades to an empty map on failure or when its feed is not
 * enabled, so `resolveRiskMaps` can never throw and never blocks a rebooking —
 * a missing key is read downstream as zero risk. This runs once, off the
 * per-candidate hot path, matching how the ranker already treats cancelRisk.
 */

import { weatherRiskForAirports } from './weatherRisk';
import { notamRiskForAirports } from './notam';
import { gdeltRiskForCarriers, gdeltRiskForPlaces } from './gdelt';
import { emptyRiskMaps, type RiskMaps } from './types';

export * from './types';

export type RiskInput = {
  /** every airport the candidate set touches — origins, destinations, hubs */
  airports: { iata: string; city: string }[];
  /** every operating carrier across the candidates */
  carriers: { code: string; name: string }[];
};

export async function resolveRiskMaps(input: RiskInput): Promise<RiskMaps> {
  const iatas = input.airports.map((a) => a.iata);

  const [weatherByAirport, notamByAirport, newsByPlace, advisoryByCarrier] = await Promise.all([
    weatherRiskForAirports(iatas).catch(() => new Map<string, number>()),
    notamRiskForAirports(iatas).catch(() => new Map<string, number>()),
    gdeltRiskForPlaces(input.airports).catch(() => new Map<string, number>()),
    gdeltRiskForCarriers(input.carriers).catch(() => new Map<string, number>()),
  ]);

  // Airport advisory = worst of the structured closure signal (NOTAM) and the
  // softer news signal (GDELT) at that airport.
  const advisoryByAirport = mergeMax(notamByAirport, newsByPlace);

  return { weatherByAirport, advisoryByAirport, advisoryByCarrier };
}

export { emptyRiskMaps };

function mergeMax(a: Map<string, number>, b: Map<string, number>): Map<string, number> {
  const out = new Map(a);
  for (const [k, v] of b) out.set(k, Math.max(out.get(k) ?? 0, v));
  return out;
}
