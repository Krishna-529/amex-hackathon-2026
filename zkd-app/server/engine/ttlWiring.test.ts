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

/**
 * isAltsStale went async with the Postgres migration: it now calls
 * altsRefreshPlan, which reads the store three times (listFlights for the
 * watcher count, getDisruptionEvent, getRecoveryTasksForFlight). Unmocked,
 * those reach the real postgres driver and this test fails with UNDEFINED_VALUE
 * before it ever evaluates a TTL.
 *
 * The question this file asks is "is config.ttlMs actually wired in", not "does
 * Postgres work", so the store is stubbed to the empty, undisrupted case. That
 * keeps the cadence arithmetic deterministic and the assertion about the TTL
 * alone. `sustainableIntervalMs` needs no stub — it is pure.
 */
vi.mock('../domain/store', () => ({
  listFlights: async () => [],
  getDisruptionEvent: async () => undefined,
  getRecoveryTasksForFlight: async () => [],
}));

/**
 * ── Why these are STATIC imports and must stay that way ──
 *
 * These three used to be `await import('./forecast')` etc. inside each `it`.
 * That is the normal idiom for `vi.doMock` (which is NOT hoisted, so the mock
 * has to be registered before the import runs), but both mocks in this file are
 * `vi.mock`, which vitest DOES hoist above every import in the module. So the
 * dynamic form bought nothing here — and it cost us the suite.
 *
 * `forecast.ts` sits on top of a ~2,800-line transitive graph (riskModel ->
 * airportDirectory, ../suppliers -> seven supplier adapters, altsCache ->
 * governor + refreshInterval, groundCache, notify, decisionLedger). Vitest has
 * no persistent source-transform cache, so every run transforms all of it cold.
 * Measured on an idle machine that is ~2.0s (riskModel 808ms, altsCache 476ms,
 * suppliers 466ms) — 40% of vitest's 5s default `testTimeout`, and the timer
 * was running during all of it because the import happened INSIDE the test body.
 * On a loaded machine (parallel vitest workers, a dev server, a second agent
 * building) it reliably crossed 5s and the case died with
 * "Error: Test timed out in 5000ms" — pointing at a dynamic import that looked
 * like it never settled, when in fact it was only slow.
 *
 * Hoisting them to module scope moves that cost into the file's collection
 * phase, which `testTimeout` does not govern, so the tests below are timed on
 * what they actually do: compare two timestamps. Nothing is weakened — the
 * hoisted `vi.mock` above still replaces `@/lib/thresholdConfig` for these
 * imports, so the assertions still prove the TTL is read from config.
 *
 * Do not move these back inside the `it` bodies.
 */
import { isStale } from './forecast';
import { isAltsStale, altsRefreshPlan } from './altsCache';
import { isGroundStale } from './groundCache';

describe('cache staleness functions honor the live config TTL, not a hardcoded copy', () => {
  it('isStale (forecast.ts) uses config.forecast.ttlMs (mocked to 2s)', async () => {
    const now = Date.now();
    const fresh = { forecast: { asOf: now - 500 } } as unknown as Parameters<typeof isStale>[0];
    const stale = { forecast: { asOf: now - 2_500 } } as unknown as Parameters<typeof isStale>[0];
    expect(isStale(fresh)).toBe(false); // 0.5s old, under the mocked 2s TTL
    expect(isStale(stale)).toBe(true); // 2.5s old, over it
  });

  /**
   * ── This case changed meaning in the no-holds merge; read before editing ──
   *
   * It used to assert that isAltsStale honours config.altCache.ttlMs. It no
   * longer can: isAltsStale now delegates entirely to altsRefreshPlan ->
   * refreshIntervalFor(), whose inputs are departure proximity, severity,
   * seats, watchers, the supplier rate-limit floor, offer expiry and whether a
   * consent window is open. `altCache.ttlMs` is not among them.
   *
   * REAL FINDING, LEFT FOR THE TEAM: `altCache.ttlMs` is therefore a dead knob
   * for ALTS. It is still live for ground (see the isGroundStale case below,
   * which shares the same config field and still passes), so the field cannot
   * simply be deleted — someone has to decide whether alts staleness was meant
   * to escape ops control when the refresh loop replaced holds. That is a
   * design question, not a test repair, so this test no longer claims ttlMs is
   * wired here rather than asserting something it cannot honestly prove.
   *
   * What it guards INSTEAD is the same bug class the file exists for: that
   * isAltsStale derives its cutoff from the live plan rather than from a
   * hardcoded constant that happens to agree with it today.
   */
  it('isAltsStale (altsCache.ts) tracks the live altsRefreshPlan cadence, not a hardcoded constant', async () => {
    const now = Date.now();
    // `id` and `candidates` are needed now that altsRefreshPlan reads them —
    // an empty alt list is the honest "nothing cached yet" case.
    const base = { id: 'f-ttl-test', depISO: new Date(now + 6 * 3600_000).toISOString(),
      candidates: { alts: [], hotels: [], cabs: [], cabLegs: [] } };

    const plan = await altsRefreshPlan(base as unknown as Parameters<typeof altsRefreshPlan>[0]);
    expect(plan.ms).toBeGreaterThan(0);

    // Straddle the plan's own boundary rather than a number written down here,
    // so a retuned governor moves both sides together and only a reintroduced
    // hardcoded cutoff can break it.
    const fresh = { ...base, altsAsOf: now - Math.floor(plan.ms / 2) } as unknown as Parameters<typeof isAltsStale>[0];
    const stale = { ...base, altsAsOf: now - (plan.ms + 60_000) } as unknown as Parameters<typeof isAltsStale>[0];

    // isAltsStale became async with the Postgres migration. Without the await
    // both assertions compared a Promise object, which is never `false` — so
    // this test passed vacuously on one side and failed on the other.
    await expect(isAltsStale(fresh)).resolves.toBe(false);
    await expect(isAltsStale(stale)).resolves.toBe(true);
  });

  it('isGroundStale (groundCache.ts) shares config.altCache.ttlMs (mocked to 1s)', async () => {
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
