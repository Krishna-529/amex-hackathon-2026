import { describe, expect, it } from 'vitest';
import { blendNeighborScore, eligibleForSmoothing } from './neighborSmoothing';
import type { ThresholdConfig } from '@/lib/thresholdConfig';
import type { NeighborSnapshotRow } from '../domain/store';
import type { Band } from '@/lib/thresholds';
import type { Flight } from '../domain/types';

/**
 * blendNeighborScore is the core math behind "nudge a flight's cancellation
 * estimate using other flights at the same airport around a similar time"
 * (config/risk-thresholds.json's neighborSmoothing block). These tests
 * assert the guardrails that make the feature safe rather than exact
 * output numbers, since the formula itself is an implementation detail that
 * should be free to retune — zero neighbors must be a true no-op, a
 * same-instant/fresh neighbor must move the estimate but never past the
 * per-pass cap, a window-edge or stale neighbor must have negligible
 * effect, and riskScore must never be fabricated when the real score or a
 * neighbor doesn't have one.
 */
const cfg: ThresholdConfig['neighborSmoothing'] = {
  enabled: true,
  tickIntervalMs: 180_000,
  windowMinutes: 90,
  maxNeighborScoreAgeMs: 3_600_000,
  recencyHalfLifeMs: 1_200_000,
  ownScorePseudoCount: 4,
  maxRiskScoreDeltaPerPass: 8,
  maxCancelProbabilityDeltaPerPass: 0.008,
  maxSmoothedAgeMs: 2_700_000,
  confidenceDiscount: 0.85,
};

const NOW = Date.parse('2026-08-18T12:00:00Z');
const DEP = Date.parse('2026-08-18T15:00:00Z'); // 3h after NOW

function neighbor(overrides: Partial<NeighborSnapshotRow> = {}): NeighborSnapshotRow {
  return {
    flightId: 'nbr', pct: 5, cancelProbability: 0.05, riskScore: 50,
    depEpochMs: DEP, asOfMs: NOW,
    ...overrides,
  };
}

describe('blendNeighborScore', () => {
  const real = { cancelProbability: 0.02, riskScore: 20 };

  it('zero neighbors: reduces exactly to the real score, unchanged — no drift with no evidence', () => {
    expect(blendNeighborScore(real, [], DEP, cfg, NOW)).toEqual(real);
  });

  it('a same-instant, freshly-scored neighbor with a much higher score moves the estimate toward it, but never past the per-pass cap', () => {
    const result = blendNeighborScore(real, [neighbor({ cancelProbability: 0.9, riskScore: 95 })], DEP, cfg, NOW);
    expect(result.cancelProbability).toBeGreaterThan(real.cancelProbability);
    expect(result.cancelProbability).toBeLessThanOrEqual(real.cancelProbability + cfg.maxCancelProbabilityDeltaPerPass);
    expect(result.riskScore).toBeGreaterThan(real.riskScore);
    expect(result.riskScore).toBeLessThanOrEqual(real.riskScore + cfg.maxRiskScoreDeltaPerPass);
  });

  it('a neighbor departing exactly at the window edge has zero weight — negligible effect', () => {
    const edgeMs = cfg.windowMinutes * 60_000;
    const result = blendNeighborScore(real, [neighbor({ cancelProbability: 0.9, depEpochMs: DEP + edgeMs })], DEP, cfg, NOW);
    expect(result.cancelProbability).toBeCloseTo(real.cancelProbability, 6);
  });

  it('a neighbor outside the window entirely has zero weight', () => {
    const outside = cfg.windowMinutes * 60_000 * 2;
    const result = blendNeighborScore(real, [neighbor({ cancelProbability: 0.9, depEpochMs: DEP + outside })], DEP, cfg, NOW);
    expect(result.cancelProbability).toBeCloseTo(real.cancelProbability, 6);
  });

  it('a very stale neighbor (many recency half-lives old) has negligible effect regardless of proximity', () => {
    const veryOld = cfg.recencyHalfLifeMs * 20;
    const result = blendNeighborScore(real, [neighbor({ cancelProbability: 0.9, asOfMs: NOW - veryOld })], DEP, cfg, NOW);
    expect(result.cancelProbability).toBeCloseTo(real.cancelProbability, 6);
  });

  it('never fabricates a riskScore when the real score does not have one', () => {
    const noRiskScore = { cancelProbability: 0.02 };
    const result = blendNeighborScore(noRiskScore, [neighbor({ riskScore: 80 })], DEP, cfg, NOW);
    expect(result.riskScore).toBeUndefined();
  });

  it('a neighbor with no riskScore still contributes to the cancelProbability blend without breaking it', () => {
    const result = blendNeighborScore(
      real,
      [neighbor({ riskScore: null, cancelProbability: 0.9 })],
      DEP,
      cfg,
      NOW,
    );
    expect(result.cancelProbability).toBeGreaterThan(real.cancelProbability);
    // No neighbor contributed a riskScore, so it stays exactly the real value.
    expect(result.riskScore).toBe(real.riskScore);
  });

  it('result is always a valid probability/percentile, even under an extreme neighbor mix', () => {
    const neighbors = Array.from({ length: 20 }, (_, i) => neighbor({ cancelProbability: 1, riskScore: 100, asOfMs: NOW - i * 1000 }));
    const result = blendNeighborScore({ cancelProbability: 0.01, riskScore: 5 }, neighbors, DEP, cfg, NOW);
    expect(result.cancelProbability).toBeGreaterThanOrEqual(0);
    expect(result.cancelProbability).toBeLessThanOrEqual(1);
    expect(result.riskScore).toBeGreaterThanOrEqual(0);
    expect(result.riskScore).toBeLessThanOrEqual(100);
  });
});

const cfgFull: ThresholdConfig = {
  version: 1,
  bands: { base: { prepare: 4, holdGate: 6, preAuthorise: 11 }, floor: { prepare: 2, holdGate: 7, preAuthorise: 9 }, ceiling: { prepare: 6, holdGate: 9, preAuthorise: 15 } },
  scarcity: { soldOutFactor: 0.6, amplePlateauSeats: 20 },
  urgency: { insideWindowFactor: 0.65, insideWindowMinutes: 60, amplePlateauMinutes: 480 },
  criticality: { hardConstraintFactor: 0.85 },
  confidence: { floor: 0.7, span: 0.3 },
  holdGate: { minHoldConversion: 0.85 },
  altCache: {
    prefetchAtOrAboveRiskScore: 75, ttlMs: 600_000, ttlFloorMs: 180_000,
    urgentWindowMinutes: 60, urgentTtlFactor: 0.33,
    nearWindowMinutes: 180, nearTtlFactor: 0.5,
    approachingWindowMinutes: 480, approachingTtlFactor: 0.75,
  },
  forecast: {
    ttlMs: 600_000, batchRescoreIntervalMs: 900_000,
    criticalRescoreIntervalMs: 90_000, criticalWindowMinutes: 180,
    dormantRescoreIntervalMs: 3_600_000, dormantWindowMinutes: 1_440,
    eventRescoreDebounceMs: 30_000,
  },
  neighborSmoothing: cfg,
};

function flight(id: string, minutesOut: number, band?: Band): Flight {
  return {
    id, code: 'AI 2803', from: 'DEL', to: 'BOM',
    depISO: new Date(NOW + minutesOut * 60_000).toISOString(), durationMin: 130,
    connectionSlackMinutes: null, hasHardConstraint: false,
    candidates: { alts: [], hotels: [], cabs: [], cabLegs: [] },
    ...(band ? { forecast: { band } as Flight['forecast'] } : {}),
  };
}

describe('eligibleForSmoothing', () => {
  const fleet = [
    flight('critical-near', 60), // inside critical window
    flight('critical-holdgate', 3000, 'hold-gate'), // critical despite distance
    flight('standard', 700, 'watch'),
    flight('dormant', 3000, 'watch'),
  ];

  it('excludes critical-tier flights — they already get real 90s-cadence calls', () => {
    const ids = eligibleForSmoothing(fleet, cfgFull, NOW).map((f) => f.id);
    expect(ids).not.toContain('critical-near');
    expect(ids).not.toContain('critical-holdgate');
  });

  it('includes standard and dormant tier flights', () => {
    const ids = eligibleForSmoothing(fleet, cfgFull, NOW).map((f) => f.id);
    expect(ids).toContain('standard');
    expect(ids).toContain('dormant');
  });

  it('returns nothing when disabled via config', () => {
    const disabled: ThresholdConfig = { ...cfgFull, neighborSmoothing: { ...cfg, enabled: false } };
    expect(eligibleForSmoothing(fleet, disabled, NOW)).toEqual([]);
  });
});
