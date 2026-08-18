import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Flight } from '../domain/types';

/**
 * Regression coverage for a real gap: config/risk-thresholds.json's
 * forecast.eventRescoreDebounceMs was defined from day one but nothing ever
 * called a function that used it — an AviationStack status change never
 * triggered an out-of-cycle rescore; a disrupted flight sat on whatever the
 * next batchScorer.ts tick or page-view TTL happened to produce. Fixed by
 * forecast.ts's triggerEventRescore(), wired into
 * app/api/flight-status/route.ts. This tests the debounce itself: a real
 * status-change signal must fire an immediate rescore, but a second signal
 * within the debounce window must not re-trigger it (a flapping status feed
 * must not become a rescore storm), and once the window has passed a new
 * signal must fire again.
 *
 * Uses vi.resetModules() + dynamic import per test: triggerEventRescore's
 * per-flight debounce clock is mutable top-level module state, so each test
 * needs a genuinely fresh module instance rather than one shared across
 * cases (same reasoning as lib/thresholdConfig.test.ts).
 */
const scoreFlight = vi.fn(async () => ({
  cancelProbability: 0.03, confidence: 0.8, modelVersion: 'test', source: 'internal-ml', riskScore: 10,
}) satisfies import('./riskModel').ModelScore);
vi.mock('./riskModel', () => ({ scoreFlight }));
vi.mock('../suppliers', () => ({
  searchInventory: vi.fn(async () => ({ offers: [], sources: {} })),
  seatsAcross: () => 0,
}));
vi.mock('../domain/store', () => ({
  getFlight: vi.fn(async () => realFlight()),
  getBookingsForFlight: vi.fn(async () => []),
  createFlight: vi.fn(async () => {}),
  insertForecastSnapshot: vi.fn(async () => {}),
  partySize: () => 1,
}));
vi.mock('../decisionLedger', () => ({ logPrediction: vi.fn(), logThresholdEvaluation: vi.fn() }));
vi.mock('./altsCache', () => ({ refreshAltsIfStale: vi.fn() }));
vi.mock('./groundCache', () => ({ refreshGroundIfStale: vi.fn() }));

const EVENT_DEBOUNCE_MS = 30_000;
vi.mock('@/lib/thresholdConfig', () => ({
  getThresholdConfig: () => ({
    version: 1,
    bands: { base: { prepare: 4, holdGate: 6, preAuthorise: 11 }, floor: { prepare: 2, holdGate: 7, preAuthorise: 9 }, ceiling: { prepare: 6, holdGate: 9, preAuthorise: 15 } },
    scarcity: { soldOutFactor: 0.6, amplePlateauSeats: 20 },
    urgency: { insideWindowFactor: 0.65, insideWindowMinutes: 60, amplePlateauMinutes: 480 },
    criticality: { hardConstraintFactor: 0.85 },
    confidence: { floor: 0.7, span: 0.3 },
    holdGate: { minHoldConversion: 0.85 },
    altCache: {
      prefetchAtOrAboveRiskScore: 75, ttlMs: 600000, ttlFloorMs: 180000,
      urgentWindowMinutes: 60, urgentTtlFactor: 0.33, nearWindowMinutes: 180, nearTtlFactor: 0.5,
      approachingWindowMinutes: 480, approachingTtlFactor: 0.75,
    },
    forecast: {
      ttlMs: 600000, batchRescoreIntervalMs: 600000,
      criticalRescoreIntervalMs: 90000, criticalWindowMinutes: 180,
      dormantRescoreIntervalMs: 1800000, dormantWindowMinutes: 1440,
      eventRescoreDebounceMs: EVENT_DEBOUNCE_MS,
    },
  }),
}));

function realFlight(): Flight {
  return {
    id: 'flt-event-test', code: 'AI 2803', from: 'DEL', to: 'BOM',
    depISO: new Date(Date.now() + 3_600_000).toISOString(), durationMin: 130,
    connectionSlackMinutes: null, hasHardConstraint: false,
    candidates: { alts: [], hotels: [], cabs: [], cabLegs: [] },
  };
}

describe('triggerEventRescore — debounced out-of-cycle rescore on a real status-change signal', () => {
  beforeEach(() => {
    vi.resetModules();
    scoreFlight.mockClear();
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse('2026-08-16T12:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('fires an immediate real rescore on the first call', async () => {
    const { triggerEventRescore } = await import('./forecast');
    triggerEventRescore('flt-event-test');
    await vi.runAllTimersAsync();
    expect(scoreFlight).toHaveBeenCalledTimes(1);
  });

  it('a second signal inside the debounce window does not re-trigger', async () => {
    const { triggerEventRescore } = await import('./forecast');
    triggerEventRescore('flt-event-test');
    await vi.runAllTimersAsync();
    vi.setSystemTime(Date.now() + EVENT_DEBOUNCE_MS - 1000);
    triggerEventRescore('flt-event-test');
    await vi.runAllTimersAsync();
    expect(scoreFlight).toHaveBeenCalledTimes(1);
  });

  it('a signal after the debounce window elapses fires again', async () => {
    const { triggerEventRescore } = await import('./forecast');
    triggerEventRescore('flt-event-test');
    await vi.runAllTimersAsync();
    vi.setSystemTime(Date.now() + EVENT_DEBOUNCE_MS + 1000);
    triggerEventRescore('flt-event-test');
    await vi.runAllTimersAsync();
    expect(scoreFlight).toHaveBeenCalledTimes(2);
  });

  it('two different flights each get their own debounce clock', async () => {
    const { triggerEventRescore } = await import('./forecast');
    triggerEventRescore('flt-event-test');
    triggerEventRescore('flt-event-test-2');
    await vi.runAllTimersAsync();
    expect(scoreFlight).toHaveBeenCalledTimes(2);
  });
});
