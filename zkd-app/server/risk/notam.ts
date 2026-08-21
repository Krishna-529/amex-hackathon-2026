/**
 * FAA NOTAM provider — airspace and airport closures, GPS/navaid outages,
 * military/VIP restrictions, per airport.
 *
 * Two honest constraints, both handled by returning an empty map (zero risk)
 * rather than pretending:
 *   1. It needs FAA API credentials. Without them, like every other keyless
 *      supplier in this app, it returns nothing.
 *   2. It covers US airports only. This app's home is Indian domestic aviation
 *      (DGCA); an Indian airport gets no NOTAM signal here until an AAI/ICAO
 *      source is wired. That is a stated gap, not a silent zero.
 */

const NOTAM_URL = 'https://external-api.faa.gov/notamapi/v1/notams';

/** Keywords that mark a NOTAM as operationally severe rather than routine. */
const SEVERE = ['CLSD', 'CLOSED', 'RWY CLSD', 'AD CLSD', 'GPS', 'UNSERVICEABLE', 'U/S', 'OBST'];

/**
 * NOTAM-derived risk per airport. Returns an empty map unless FAA credentials
 * are present AND the airport is one the FAA covers. Every fetch is wrapped so a
 * timeout or a bad response degrades to "no signal", never an exception on the
 * recovery path.
 */
export async function notamRiskForAirports(iatas: Iterable<string>): Promise<Map<string, number>> {
  const clientId = process.env.FAA_NOTAM_CLIENT_ID;
  const clientSecret = process.env.FAA_NOTAM_CLIENT_SECRET;
  const out = new Map<string, number>();
  if (!clientId || !clientSecret) return out; // no creds → no signal, same as any keyless supplier

  const unique = [...new Set([...iatas].filter(Boolean))];
  await Promise.all(
    unique.map(async (iata) => {
      try {
        const url = `${NOTAM_URL}?icaoLocation=${encodeURIComponent(iata)}&responseFormat=geoJson`;
        const res = await fetch(url, {
          headers: { client_id: clientId, client_secret: clientSecret },
          cache: 'no-store',
          signal: AbortSignal.timeout(6000),
        });
        if (!res.ok) return;
        const json = (await res.json()) as { items?: { properties?: { coreNOTAMData?: { notam?: { text?: string } } } }[] };
        const texts = (json.items ?? [])
          .map((i) => i.properties?.coreNOTAMData?.notam?.text?.toUpperCase() ?? '')
          .filter(Boolean);
        const severe = texts.some((t) => SEVERE.some((k) => t.includes(k)));
        const risk = severe ? 0.9 : texts.length > 0 ? 0.2 : 0;
        if (risk > 0) out.set(iata, risk);
      } catch {
        /* dead feed → no signal */
      }
    }),
  );
  return out;
}
