/** Open-Meteo. No auth. Used only when NOAA has no METAR for an airport. */

export type RawForecast = {
  current: { precipitation: number; wind_speed_10m: number; weather_code: number };
};

export async function fetchForecast(lat: number, lon: number): Promise<RawForecast | null> {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=precipitation,wind_speed_10m,weather_code`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as RawForecast;
  } catch {
    return null;
  }
}

/** 0 (clear) .. 1 (severe), from WMO weather_code + wind/precipitation. */
export function weatherSeverityFromForecast(f: RawForecast): number {
  const code = f.current.weather_code;
  let v = 0.3;
  if (code === 0 || code === 1) v = 0.05;
  else if (code === 2 || code === 3) v = 0.2;
  else if (code === 45 || code === 48) v = 0.5; // fog
  else if (code >= 51 && code <= 57) v = 0.3; // drizzle
  else if (code >= 61 && code <= 67) v = 0.45; // rain
  else if (code >= 71 && code <= 77) v = 0.5; // snow
  else if (code >= 80 && code <= 82) v = 0.55; // showers
  else if (code >= 95) v = 0.85; // thunderstorm

  if (f.current.wind_speed_10m >= 60) v += 0.2;
  else if (f.current.wind_speed_10m >= 40) v += 0.1;

  if (f.current.precipitation >= 5) v += 0.1;

  return Math.max(0, Math.min(1, v));
}
