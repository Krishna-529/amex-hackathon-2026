/**
 * GDELT news provider — the "news update" channel. GDELT's DOC 2.0 API is
 * keyless and updates every 15 minutes, coding worldwide news by event and
 * place. It is the only source that carries the causes no aviation feed does:
 * strikes, protests, civil unrest, conflict. We use it as a SOFT signal —
 * because it reports what is being written about near a place, not a verified
 * incident, it feeds a heavy but overridable weight, never a hard filter.
 *
 * Gated behind ZKD_LIVE_RISK=1 so the demo and the test suite never make a live,
 * rate-limited call unless deliberately turned on — the same gating pattern the
 * synthetic sandbox supplier uses. Off, it returns an empty map (zero risk).
 */

const GDELT_URL = 'https://api.gdeltproject.org/api/v2/doc/doc';

/** Disruption-relevant terms; an article matching these near a place/airline is a weak risk signal. */
const DISRUPTION_TERMS = '(strike OR walkout OR "air traffic" OR unrest OR protest OR shutdown OR closure OR grounded)';

function enabled(): boolean {
  return process.env.ZKD_LIVE_RISK === '1';
}

/**
 * Query GDELT for recent disruption-coded coverage matching a phrase, mapped to
 * a small [0,1] severity by article volume. Deliberately conservative: a few
 * articles is a faint signal, a flood is a strong one, and it saturates low so
 * noisy coverage can never dominate a real bookability or arrival advantage.
 */
async function gdeltRisk(phrase: string): Promise<number> {
  if (!enabled()) return 0;
  try {
    const query = `${phrase} ${DISRUPTION_TERMS}`;
    const url = `${GDELT_URL}?query=${encodeURIComponent(query)}&mode=artlist&format=json&timespan=1d&maxrecords=50`;
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(6000) });
    if (!res.ok) return 0;
    const json = (await res.json()) as { articles?: unknown[] };
    const n = Array.isArray(json.articles) ? json.articles.length : 0;
    // 0 articles → 0; ~10 → 0.3; saturates at 0.6 so news alone never dominates.
    return Math.min(0.6, n / 30);
  } catch {
    return 0;
  }
}

/** News risk per carrier, keyed by IATA code, queried by the carrier's display name. */
export async function gdeltRiskForCarriers(carriers: { code: string; name: string }[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!enabled()) return out;
  const unique = dedupeBy(carriers, (c) => c.code);
  await Promise.all(
    unique.map(async (c) => {
      const risk = await gdeltRisk(`"${c.name}"`);
      if (risk > 0) out.set(c.code.toUpperCase(), risk);
    }),
  );
  return out;
}

/** News risk per airport, keyed by IATA code, queried by the airport's city name. */
export async function gdeltRiskForPlaces(places: { iata: string; city: string }[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!enabled()) return out;
  const unique = dedupeBy(places, (p) => p.iata);
  await Promise.all(
    unique.map(async (p) => {
      const risk = await gdeltRisk(`"${p.city}" airport`);
      if (risk > 0) out.set(p.iata.toUpperCase(), risk);
    }),
  );
  return out;
}

function dedupeBy<T>(xs: T[], key: (x: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const x of xs) {
    const k = key(x);
    if (k && !seen.has(k)) { seen.add(k); out.push(x); }
  }
  return out;
}
