/**
 * Real weather signal for the risk model — no synthetic values.
 *
 * NOAA Aviation Weather Center publishes METAR observations for ICAO stations
 * worldwide (not just the US), keyless and free — the aviation-grade fields
 * (ceiling, visibility, wind, significant weather codes) that actually drive
 * cancellations. Open-Meteo is the global fallback when a station has no
 * recent METAR (small/regional airports): real forecast data, keyless, free,
 * by lat/lon — coarser (no ceiling/visibility) but always available.
 *
 * If both are unreachable this returns `null` fields rather than a guess.
 * Absence is honest; a fabricated number is not.
 */
import { getOrSet } from './cache';
import { airport } from './airportDirectory';

export type WeatherSeverity = {
  source: 'metar' | 'open-meteo';
  observedAt: number;
  /** feet AGL to the lowest broken/overcast layer; null when sky clear or unreported */
  ceilingFt: number | null;
  /** statute miles; null when unreported */
  visibilitySm: number | null;
  windSpeedKt: number | null;
  windGustKt: number | null;
  /** true on METAR significant-weather codes: TS, FZ*, SN, FG, etc. */
  hazardousPhenomena: boolean;
  precipitationMm: number | null;
};

const METAR_URL = 'https://aviationweather.gov/api/data/metar';
const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';

type MetarRaw = {
  icaoId: string;
  obsTime: number; // epoch seconds
  wdir?: number | string;
  wspd?: number | null;
  wgst?: number | null;
  visib?: string | number | null;
  wxString?: string | null;
  clouds?: { cover: string; base: number | null }[];
};

const HAZARD_CODES = ['TS', 'FZ', 'SN', 'FG', 'GR', 'SQ', 'FC', 'GS', 'PL'];

export async function metarSeverity(icao: string): Promise<WeatherSeverity | null> {
  return getOrSet(`metar:${icao}`, 15 * 60 * 1000, async () => {
    try {
      const url = `${METAR_URL}?ids=${encodeURIComponent(icao)}&format=json&hours=2`;
      const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
      if (!res.ok) return null;
      const rows = (await res.json()) as MetarRaw[];
      const latest = rows.sort((a, b) => b.obsTime - a.obsTime)[0];
      if (!latest) return null;

      const ceiling = (latest.clouds ?? [])
        .filter((c) => c.cover === 'BKN' || c.cover === 'OVC')
        .map((c) => c.base)
        .filter((b): b is number => typeof b === 'number')
        .sort((a, b) => a - b)[0];

      const visib =
        typeof latest.visib === 'string' ? parseFloat(latest.visib.replace('+', '')) : latest.visib ?? null;

      const wx = (latest.wxString ?? '').toUpperCase();

      return {
        source: 'metar' as const,
        observedAt: latest.obsTime * 1000,
        ceilingFt: ceiling ?? null,
        visibilitySm: Number.isFinite(visib) ? (visib as number) : null,
        windSpeedKt: typeof latest.wspd === 'number' ? latest.wspd : null,
        windGustKt: typeof latest.wgst === 'number' ? latest.wgst : null,
        hazardousPhenomena: HAZARD_CODES.some((c) => wx.includes(c)),
        precipitationMm: null,
      };
    } catch {
      return null;
    }
  });
}

type OpenMeteoRaw = {
  current?: {
    time: string;
    wind_speed_10m?: number;
    wind_gusts_10m?: number;
    precipitation?: number;
    visibility?: number;
    cloud_cover?: number;
    weather_code?: number;
  };
};

/** WMO weather codes for thunderstorm/freezing/heavy snow — treated as hazardous. */
const OPEN_METEO_HAZARD_CODES = new Set([65, 67, 75, 82, 86, 95, 96, 99, 56, 57, 66]);

export async function openMeteoSeverity(iata: string): Promise<WeatherSeverity | null> {
  const ap = airport(iata);
  if (!ap) return null;
  return getOrSet(`open-meteo:${iata}`, 15 * 60 * 1000, async () => {
    try {
      const params = new URLSearchParams({
        latitude: String(ap.lat),
        longitude: String(ap.lon),
        current:
          'wind_speed_10m,wind_gusts_10m,precipitation,visibility,cloud_cover,weather_code',
        wind_speed_unit: 'kn',
      });
      const res = await fetch(`${OPEN_METEO_URL}?${params}`, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
      if (!res.ok) return null;
      const json = (await res.json()) as OpenMeteoRaw;
      const c = json.current;
      if (!c) return null;
      return {
        source: 'open-meteo' as const,
        observedAt: Date.parse(c.time),
        ceilingFt: null,
        visibilitySm: typeof c.visibility === 'number' ? c.visibility / 1609.34 : null,
        windSpeedKt: c.wind_speed_10m ?? null,
        windGustKt: c.wind_gusts_10m ?? null,
        hazardousPhenomena: typeof c.weather_code === 'number' && OPEN_METEO_HAZARD_CODES.has(c.weather_code),
        precipitationMm: c.precipitation ?? null,
      };
    } catch {
      return null;
    }
  });
}

/** METAR first (aviation-accurate); Open-Meteo only when no station data exists. */
export async function weatherFor(iata: string): Promise<WeatherSeverity | null> {
  const ap = airport(iata);
  const metar = ap?.icao ? await metarSeverity(ap.icao) : null;
  if (metar) return metar;
  return openMeteoSeverity(iata);
}
