/**
 * Loads the adaptive-threshold parameters that lib/thresholds.ts turns into
 * prepare/holdGate/preAuthorise bands, and the band that gates alternative-
 * flight pre-caching (server/engine/altsCache.ts).
 *
 * This is deliberately not a hardcoded TS const: the whole point of an
 * "adaptive" threshold is that ops can retune it — make the system act
 * earlier during a known-bad weather week, or pull back if hold-conversion
 * degrades — without a redeploy. Local file today; AWS AppConfig in
 * production (see zkd-risk-model/infra/appconfig.tf). Same interface either
 * way, so lib/thresholds.ts never knows which one it is talking to.
 */
import { readFileSync, statSync } from 'fs';
import { join } from 'path';

export type ThresholdConfig = {
  version: number;
  bands: {
    base: { prepare: number; holdGate: number; preAuthorise: number };
    floor: { prepare: number; holdGate: number; preAuthorise: number };
    ceiling: { prepare: number; holdGate: number; preAuthorise: number };
  };
  scarcity: { soldOutFactor: number; amplePlateauSeats: number };
  urgency: { insideWindowFactor: number; insideWindowMinutes: number; amplePlateauMinutes: number };
  criticality: { hardConstraintFactor: number };
  confidence: { floor: number; span: number };
  holdGate: { minHoldConversion: number };
  altCache: {
    prefetchAtOrAboveRiskScore: number;
    ttlMs: number;
    ttlFloorMs: number;
    urgentWindowMinutes: number;
    urgentTtlFactor: number;
    nearWindowMinutes: number;
    nearTtlFactor: number;
    approachingWindowMinutes: number;
    approachingTtlFactor: number;
  };
  forecast: {
    ttlMs: number;
    batchRescoreIntervalMs: number;
    criticalRescoreIntervalMs: number;
    criticalWindowMinutes: number;
    dormantRescoreIntervalMs: number;
    dormantWindowMinutes: number;
    eventRescoreDebounceMs: number;
  };
};

const LOCAL_PATH = join(process.cwd(), 'config', 'risk-thresholds.json');

/** Re-read at most this often; a hot file edit is visible within one poll window. */
const RELOAD_INTERVAL_MS = 30_000;

// Local-file cache (bootstrap / no-THRESHOLD_CONFIG_URL fallback) and the
// remote (AppConfig) cache are deliberately SEPARATE state: they used to
// share one `cached` variable, which meant getThresholdConfig() re-reading
// the bundled local file every RELOAD_INTERVAL_MS would silently clobber a
// good value just fetched from AppConfig back to the stale bundled default
// — and worse, nothing ever called the remote refresh at all (see below),
// so in a real deployment with THRESHOLD_CONFIG_URL set, AppConfig was
// never actually read; every request silently served the file baked into
// the image forever. Fixed: once a remote value has ever loaded
// successfully, it's authoritative; the local file is only the bootstrap
// value before that first successful fetch (or the only source when no
// THRESHOLD_CONFIG_URL is configured at all, e.g. local dev).
let localCache: ThresholdConfig | null = null;
let localCachedMtimeMs = 0;

let remoteCache: ThresholdConfig | null = null;
let remoteCachedAt = 0;

/**
 * AWS AppConfig / SSM Parameter Store hook. Set THRESHOLD_CONFIG_URL to a
 * fully-qualified AppConfig data URL (via the AppConfig Agent/Lambda
 * extension sidecar, which exposes configuration over local HTTP so the app
 * never calls AppConfig's control-plane API on the request path) and this
 * takes over from the local file with the same polling contract.
 */
async function loadRemote(url: string): Promise<ThresholdConfig> {
  const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`threshold config fetch ${res.status}`);
  return (await res.json()) as ThresholdConfig;
}

function loadLocal(): ThresholdConfig {
  const stat = statSync(LOCAL_PATH);
  if (localCache && stat.mtimeMs === localCachedMtimeMs) return localCache;
  const raw = readFileSync(LOCAL_PATH, 'utf-8');
  localCache = JSON.parse(raw) as ThresholdConfig;
  localCachedMtimeMs = stat.mtimeMs;
  return localCache;
}

/**
 * Synchronous by design: lib/thresholds.ts runs on every forecast compute
 * and must not block on network I/O. When THRESHOLD_CONFIG_URL is set, this
 * itself kicks off (fire-and-forget) the remote refresh check on every call
 * — every threshold evaluation across the app naturally keeps the AppConfig
 * cache warm, no separate wiring required — and prefers that cache once it
 * has ever loaded. Falls back to the local bundled file only before the
 * first successful remote load, or when no remote source is configured.
 */
export function getThresholdConfig(): ThresholdConfig {
  const remoteUrl = process.env.THRESHOLD_CONFIG_URL;
  if (remoteUrl) {
    refreshThresholdConfigIfStale();
    if (remoteCache) return remoteCache;
  }
  try {
    return loadLocal();
  } catch {
    if (remoteCache) return remoteCache; // last known good beats a hard failure
    throw new Error('risk-thresholds.json missing and no cached config available');
  }
}

/**
 * Non-blocking refresh for the remote (AppConfig) source; no-op when
 * THRESHOLD_CONFIG_URL is unset. Safe to call from getThresholdConfig()
 * itself (the common case) or eagerly at process startup
 * (instrumentation.ts) — either way it only ever fires a new fetch once per
 * RELOAD_INTERVAL_MS, advancing the debounce clock before the fetch even
 * resolves so concurrent callers within the window never pile up requests.
 */
export function refreshThresholdConfigIfStale(): void {
  const url = process.env.THRESHOLD_CONFIG_URL;
  if (!url) return;
  if (Date.now() - remoteCachedAt < RELOAD_INTERVAL_MS) return;
  remoteCachedAt = Date.now();
  void loadRemote(url)
    .then((c) => {
      remoteCache = c;
    })
    .catch(() => {}); // last known good (remoteCache) stays in effect; remoteCachedAt already advanced so a failing endpoint isn't hammered every call
}
