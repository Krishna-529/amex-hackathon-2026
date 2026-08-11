/** NOAA Aviation Weather Center. No auth. No CORS — server-only. */

export type RawMetar = {
  icaoId: string;
  temp: number | null;
  wspd: number | null;
  wgst: number | null;
  visib: number | string | null;
  wxString: string | null;
  fltCat: 'VFR' | 'MVFR' | 'IFR' | 'LIFR' | null;
  rawOb: string;
};

export async function fetchMetar(icao: string): Promise<RawMetar | null> {
  try {
    const res = await fetch(
      `https://aviationweather.gov/api/data/metar?ids=${encodeURIComponent(icao)}&format=json`,
      { cache: 'no-store' },
    );
    if (!res.ok) return null;
    const arr = (await res.json()) as RawMetar[];
    return arr[0] ?? null;
  } catch {
    return null;
  }
}

/** 0 (clear) .. 1 (severe). Uses NOAA's own flight-category classification as the base signal. */
export function weatherSeverityFromMetar(m: RawMetar): number {
  const base: Record<string, number> = { VFR: 0.1, MVFR: 0.35, IFR: 0.65, LIFR: 0.9 };
  let v = m.fltCat ? (base[m.fltCat] ?? 0.3) : 0.3;

  const wx = (m.wxString ?? '').toUpperCase();
  if (/TS/.test(wx)) v += 0.15; // thunderstorm
  if (/FZ/.test(wx)) v += 0.15; // freezing precip
  if (/\+RA|\+SN|\+SH/.test(wx)) v += 0.1; // heavy rain/snow/showers

  const gust = m.wgst ?? m.wspd ?? 0;
  if (gust >= 30) v += 0.1;
  else if (gust >= 20) v += 0.05;

  return Math.max(0, Math.min(1, v));
}
