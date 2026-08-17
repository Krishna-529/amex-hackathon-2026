import { describe, expect, it, vi } from 'vitest';

/**
 * Regression coverage for a real bug: isStale/isAltsStale/isGroundStale
 * each hardcoded their own `const TTL_MS = 10 * 60 * 1000` instead of
 * reading config/risk-thresholds.json's forecast.ttlMs / altCache.ttlMs —
 * currently harmless only because the hardcoded value happened to equal
 * the config default, but any ops retune of the config (the file's own
 * stated purpose: "so ops can retune... without a redeploy") would
 * silently do nothing. These tests mock lib/thresholdConfig to a
 * DIFFERENT TTL than the real default and assert the staleness functions
 * actually honor it — proving they're live-wired, not hardcoded copies
 * that happen to agree with the default today.
 *
 * isAltsStale (altsCache.ts) no longer reads config.altCache.ttlMs at all —
 * server/engine/altsCache.ts's adaptive-refresh rewrite replaced the flat
 * config-driven TTL with a real computed interval (lib/refreshInterval.ts's
 * refreshIntervalFor, floored by server/governor.ts's sustainableIntervalMs),
 * and made isAltsStale async to read the disruption/recovery-task state that
 * interval depends on. Its own second describe block below covers the
 * equivalent property for the new contract — "is this wired to the live
 * plan, not a hardcoded copy" — with the interval math itself already
 * covered by tests/refreshCadence.test.ts.
 */
vi.mock('@/lib/thresholdConfig', () => ({
  getThresholdConfig: () => ({
    version: 1,
    bands: { base: { prepare: 4, holdGate: 6, preAuthorise: 11 }, floor: { prepare: 2, holdGate: 7, preAuthorise: 9 }, ceiling: { prepare: 6, holdGate: 9, preAuthorise: 15 } },
    scarcity: { soldOutFactor: 0.6, amplePlateauSeats: 20 },
    urgency: { insideWindowFactor: 0.65, insideWindowMinutes: 60, amplePlateauMinutes: 480 },
    criticality: { hardConstraintFactor: 0.85 },
    confidence: { floor: 0.7, span: 0.3 },
    holdGate: { minHoldConversion: 0.85 },
    // Deliberately NOT the real default (600000ms / 10min) — a short TTL
    // that makes "is this respected" observable in milliseconds. ttdScale
    // factors all set to 1 / windows to 0 so the departure-proximity scaling
    // (rescoreTiming.ts) is a no-op here — that behavior gets its own
    // dedicated test in rescoreTiming.test.ts rather than being entangled
    // with this file's "is the raw ttlMs wired at all" question.
    altCache: {
      prefetchAtOrAboveRiskScore: 75, ttlMs: 1_000, ttlFloorMs: 0,
      urgentWindowMinutes: 0, urgentTtlFactor: 1,
      nearWindowMinutes: 0, nearTtlFactor: 1,
      approachingWindowMinutes: 0, approachingTtlFactor: 1,
    },
    forecast: {
      ttlMs: 2_000, batchRescoreIntervalMs: 600000, eventRescoreDebounceMs: 30000,
      criticalRescoreIntervalMs: 90000, criticalWindowMinutes: 180,
      dormantRescoreIntervalMs: 1800000, dormantWindowMinutes: 1440,
    },
  }),
  refreshThresholdConfigIfStale: () => {},
}));

describe('cache staleness functions honor the live config TTL, not a hardcoded copy', () => {
  it('isStale (forecast.ts) uses config.forecast.ttlMs (mocked to 2s)', async () => {
    const { isStale } = await import('./forecast');
    const now = Date.now();
    const fresh = { forecast: { asOf: now - 500 } } as unknown as Parameters<typeof isStale>[0];
    const stale = { forecast: { asOf: now - 2_500 } } as unknown as Parameters<typeof isStale>[0];
    expect(isStale(fresh)).toBe(false); // 0.5s old, under the mocked 2s TTL
    expect(isStale(stale)).toBe(true); // 2.5s old, over it
  });

  it('isGroundStale (groundCache.ts) shares config.altCache.ttlMs (mocked to 1s)', async () => {
    const { isGroundStale } = await import('./groundCache');
    const now = Date.now();
    const fresh = { groundAsOf: now - 200 } as unknown as Parameters<typeof isGroundStale>[0];
    const stale = { groundAsOf: now - 1_500 } as unknown as Parameters<typeof isGroundStale>[0];
    expect(isGroundStale(fresh)).toBe(false);
    expect(isGroundStale(stale)).toBe(true);
  });
});

// isAltsStale's own dependencies, mocked separately from the block above:
// the interval math (refreshIntervalFor) is already covered by
// tests/refreshCadence.test.ts, so it's stubbed to a fixed value here — this
// block only has to prove isAltsStale actually calls into the live plan and
// compares against it, not that the plan's arithmetic is correct.
vi.mock('../domain/store', () => ({
  listFlights: async () => [],
  getDisruptionEvent: async () => undefined,
  getRecoveryTasksForFlight: async () => [],
}));
vi.mock('../governor', () => ({ sustainableIntervalMs: () => 0 }));
vi.mock('@/lib/refreshInterval', () => ({
  refreshIntervalFor: () => ({
    ms: 1_000, boundBy: 'floor', targetMs: 1_000,
    factors: { urgency: 1, severity: 1, scarcity: 1, window: 1 },
    inputs: {},
  }),
}));

describe('isAltsStale (altsCache.ts) is wired to the live adaptive refresh plan, not a hardcoded copy', () => {
  function flightWith(altsAsOf: number | undefined) {
    return {
      id: 'flt-ttl-test', depISO: new Date(Date.now() + 3_600_000).toISOString(),
      candidates: { alts: [] }, altsAsOf,
    } as unknown as Parameters<typeof import('./altsCache').isAltsStale>[0];
  }

  it('honors whatever altsRefreshPlan computes (mocked to 1s), not a fixed constant', async () => {
    const { isAltsStale } = await import('./altsCache');
    const now = Date.now();
    expect(await isAltsStale(flightWith(now - 200))).toBe(false);
    expect(await isAltsStale(flightWith(now - 1_500))).toBe(true);
  });

  it('a flight never refreshed (altsAsOf undefined) is always stale, regardless of the plan', async () => {
    const { isAltsStale } = await import('./altsCache');
    expect(await isAltsStale(flightWith(undefined))).toBe(true);
  });
});
