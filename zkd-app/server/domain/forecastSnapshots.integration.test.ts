/**
 * Proves server/domain/migrations/0002_forecast_snapshots.sql's table and
 * store.ts's insertForecastSnapshot/getLastRealSnapshot/getNeighborRealSnapshots
 * actually round-trip and filter correctly through a real database — not
 * just that they typecheck. Same skip-without-DATABASE_URL pattern as
 * store.integration.test.ts.
 *
 * getLastRealSnapshot's "never a neighbor-smoothed row, even if newer" test
 * is the single most safety-critical query in the whole neighbor-smoothing
 * feature (server/engine/neighborSmoothing.ts) — it's what makes "never
 * smooth from smoothed" structurally true rather than a runtime check
 * someone could forget.
 */
import { describe, test, expect, beforeAll } from 'vitest';

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)('forecast_snapshots against real Postgres', () => {
  let store: typeof import('./store');

  beforeAll(async () => {
    store = await import('./store');
  });

  async function seedFlight(id: string, from: string, depISO: string): Promise<void> {
    await store.createFlight({
      id, code: 'TT 1', from, to: 'XXX', depISO, durationMin: 100,
      connectionSlackMinutes: null, hasHardConstraint: false,
      candidates: { alts: [], hotels: [], cabs: [], cabLegs: [] },
    });
  }

  test('getLastRealSnapshot returns only internal-ml rows, even when a neighbor-smoothed row is newer', async () => {
    const flightId = `snap-real-${Date.now()}`;
    const depEpochMs = Date.now() + 3_600_000;
    await seedFlight(flightId, 'BOM', new Date(depEpochMs).toISOString());

    const base = { flightId, origin: 'BOM', depEpochMs, band: 'watch', modelVersion: 'test', confidence: 0.8 };
    await store.insertForecastSnapshot({
      ...base, cancelProbability: 0.02, pct: 2, riskScore: 20, source: 'internal-ml', asOfMs: Date.now() - 10_000,
    });
    // Newer, but smoothed — must NOT be what getLastRealSnapshot returns.
    await store.insertForecastSnapshot({
      ...base, cancelProbability: 0.05, pct: 5, riskScore: 50, source: 'neighbor-smoothed', asOfMs: Date.now(),
    });

    const last = await store.getLastRealSnapshot(flightId);
    expect(last?.cancelProbability).toBe(0.02);
    expect(last?.riskScore).toBe(20);
  });

  test('getLastRealSnapshot returns null for a flight that has never been real-scored', async () => {
    const flightId = `snap-nonexistent-${Date.now()}`;
    await seedFlight(flightId, 'BOM', new Date(Date.now() + 3_600_000).toISOString());
    expect(await store.getLastRealSnapshot(flightId)).toBeNull();
  });

  test('getNeighborRealSnapshots filters by origin, time window, and minAsOfMs, and returns each flight\'s latest real row', async () => {
    const now = Date.now();
    const targetDep = now + 3 * 3_600_000;
    const windowMs = 90 * 60_000;

    const targetId = `snap-target-${now}`;
    await seedFlight(targetId, 'DEL', new Date(targetDep).toISOString());

    const inWindowId = `snap-inwindow-${now}`;
    const inWindowDep = targetDep + 30 * 60_000; // 30min later — inside the 90min window
    await seedFlight(inWindowId, 'DEL', new Date(inWindowDep).toISOString());

    const outsideWindowId = `snap-outside-${now}`;
    const outsideDep = targetDep - 120 * 60_000; // 120min earlier — outside the 90min window
    await seedFlight(outsideWindowId, 'DEL', new Date(outsideDep).toISOString());

    const differentOriginId = `snap-diff-origin-${now}`;
    await seedFlight(differentOriginId, 'BOM', new Date(targetDep).toISOString());

    const staleId = `snap-stale-${now}`;
    await seedFlight(staleId, 'DEL', new Date(targetDep).toISOString());

    await store.insertForecastSnapshot({
      flightId: inWindowId, origin: 'DEL', depEpochMs: inWindowDep,
      cancelProbability: 0.03, pct: 3, riskScore: 30, band: 'watch', confidence: 0.8,
      modelVersion: 'test', source: 'internal-ml', asOfMs: now,
    });
    // An OLDER real row for the same flight — must not be what comes back.
    await store.insertForecastSnapshot({
      flightId: inWindowId, origin: 'DEL', depEpochMs: inWindowDep,
      cancelProbability: 0.09, pct: 9, riskScore: 90, band: 'hold-gate', confidence: 0.9,
      modelVersion: 'test', source: 'internal-ml', asOfMs: now - 1_000,
    });
    await store.insertForecastSnapshot({
      flightId: outsideWindowId, origin: 'DEL', depEpochMs: outsideDep,
      cancelProbability: 0.5, pct: 50, riskScore: 99, band: 'pre-authorise', confidence: 0.9,
      modelVersion: 'test', source: 'internal-ml', asOfMs: now,
    });
    await store.insertForecastSnapshot({
      flightId: differentOriginId, origin: 'BOM', depEpochMs: targetDep,
      cancelProbability: 0.5, pct: 50, riskScore: 99, band: 'pre-authorise', confidence: 0.9,
      modelVersion: 'test', source: 'internal-ml', asOfMs: now,
    });
    // Real, same origin, in window — but older than minAsOfMs below.
    await store.insertForecastSnapshot({
      flightId: staleId, origin: 'DEL', depEpochMs: targetDep,
      cancelProbability: 0.5, pct: 50, riskScore: 99, band: 'pre-authorise', confidence: 0.9,
      modelVersion: 'test', source: 'internal-ml', asOfMs: now - 10_000_000,
    });

    const minAsOfMs = now - 3_600_000; // 1h lookback
    const neighbors = await store.getNeighborRealSnapshots('DEL', targetDep, windowMs, targetId, minAsOfMs);
    const ids = neighbors.map((n) => n.flightId);

    expect(ids).toEqual([inWindowId]);
    const row = neighbors.find((n) => n.flightId === inWindowId);
    expect(row?.cancelProbability).toBe(0.03); // the newer of the two rows, not the older one
  });
});
