/**
 * Turns the real weather signal (server/weather.ts — METAR/Open-Meteo, free,
 * keyless, and until now dead code) into a [0,1] risk per airport for the
 * ranker.
 *
 * The mapping is deliberately coarse and aviation-shaped: the things that
 * actually ground flights are a low ceiling, poor visibility, strong gusts, and
 * any significant-weather phenomenon (thunderstorm, freezing, snow, fog, ash,
 * sand — the METAR hazard codes). We take the worst of those. Absence of data
 * is zero risk, never a guess — same honesty rule weather.ts itself follows.
 */

import { weatherFor, type WeatherSeverity } from '../weather';

/** Map one station's observation to a [0,1] risk. */
export function severityToRisk(w: WeatherSeverity | null): number {
  if (!w) return 0;

  // A significant-weather phenomenon is the strongest single signal a flight is
  // at risk — thunderstorm, freezing, snow, fog, volcanic ash, sand/dust.
  const hazard = w.hazardousPhenomena ? 0.85 : 0;

  // Ceiling: below ~500 ft is near-minimums; scales to 0 by ~3000 ft.
  const ceiling = w.ceilingFt !== null && w.ceilingFt < 3000
    ? clamp01((3000 - w.ceilingFt) / 2500)
    : 0;

  // Visibility: below ~3 statute miles starts to bite; 0 by ~6 sm.
  const visibility = w.visibilitySm !== null && w.visibilitySm < 6
    ? clamp01((6 - w.visibilitySm) / 5)
    : 0;

  // Wind gusts: 30 kt starts to matter, saturating by ~55 kt.
  const gust = w.windGustKt !== null && w.windGustKt > 30
    ? clamp01((w.windGustKt - 30) / 25)
    : 0;

  return Math.max(hazard, ceiling, visibility, gust);
}

/**
 * Weather risk per airport, batched over the unique set. One fetch per airport
 * (weather.ts caches for 15 min), all concurrent, and any station that fails or
 * has no data simply doesn't appear in the map — the ranker reads a missing key
 * as zero risk and proceeds.
 */
export async function weatherRiskForAirports(iatas: Iterable<string>): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  // Live risk is opt-in, the same way every other live integration in this app
  // is: off by default so the demo and the test suite are deterministic and the
  // recovery path makes no surprise outbound calls; ZKD_LIVE_RISK=1 turns the
  // real feeds on. When off, every risk feature is simply neutral.
  if (process.env.ZKD_LIVE_RISK !== '1') return out;

  const unique = [...new Set([...iatas].filter(Boolean))];
  await Promise.all(
    unique.map(async (iata) => {
      try {
        const w = await weatherFor(iata);
        const risk = severityToRisk(w);
        if (risk > 0) out.set(iata, risk);
      } catch {
        /* a dead station never blocks a rebooking */
      }
    }),
  );
  return out;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
