import { describe, expect, it } from 'vitest';
import { tierFor, effectiveAltTtlMs, minutesToDeparture } from './rescoreTiming';
import type { ThresholdConfig } from '@/lib/thresholdConfig';
import type { Band } from '@/lib/thresholds';
import type { Flight } from '../domain/types';

/**
 * The adaptive interval strategy's core logic: which of three rescore tiers
 * a flight falls into (batchScorer.ts), and how much a flight's cache TTL
 * shrinks as departure approaches (altsCache.ts/groundCache.ts). Both used
 * to be flat constants shared by every flight; this is the regression
 * coverage for the replacement — real config values, real time math, no
 * mocking needed since both functions are pure.
 */
const cfg: ThresholdConfig = {
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
    ttlMs: 600_000, batchRescoreIntervalMs: 600_000,
    criticalRescoreIntervalMs: 90_000, criticalWindowMinutes: 180,
    dormantRescoreIntervalMs: 1_800_000, dormantWindowMinutes: 1_440,
    eventRescoreDebounceMs: 30_000,
  },
  neighborSmoothing: {
    enabled: true, tickIntervalMs: 180_000, windowMinutes: 90,
    maxNeighborScoreAgeMs: 3_600_000, recencyHalfLifeMs: 1_200_000, ownScorePseudoCount: 4,
    maxRiskScoreDeltaPerPass: 8, maxCancelProbabilityDeltaPerPass: 0.008,
    maxSmoothedAgeMs: 2_700_000, confidenceDiscount: 0.85,
  },
};

const NOW = Date.parse('2026-08-16T12:00:00Z');

function flightMinutesOut(minutes: number, band?: Band): Flight {
  return {
    id: 'flt-test', code: 'AI 2803', from: 'DEL', to: 'BOM',
    depISO: new Date(NOW + minutes * 60_000).toISOString(), durationMin: 130,
    connectionSlackMinutes: null, hasHardConstraint: false,
    candidates: { alts: [], hotels: [], cabs: [], cabLegs: [] },
    ...(band ? { forecast: { band } as Flight['forecast'] } : {}),
  };
}

describe('minutesToDeparture', () => {
  it('is positive for a future flight and negative for one already departed', () => {
    expect(minutesToDeparture(flightMinutesOut(90), NOW)).toBeCloseTo(90, 5);
    expect(minutesToDeparture(flightMinutesOut(-30), NOW)).toBeCloseTo(-30, 5);
  });
});

describe('tierFor — three rescore cadences, re-derived fresh each call', () => {
  it('inside criticalWindowMinutes of departure → critical, regardless of band', () => {
    expect(tierFor(flightMinutesOut(60), cfg, NOW)).toBe('critical');
  });

  it('already at hold-gate → critical even far from departure', () => {
    expect(tierFor(flightMinutesOut(2_000, 'hold-gate'), cfg, NOW)).toBe('critical');
  });

  it('already at pre-authorise → critical even far from departure', () => {
    expect(tierFor(flightMinutesOut(2_000, 'pre-authorise'), cfg, NOW)).toBe('critical');
  });

  it('far out, still at watch → dormant', () => {
    expect(tierFor(flightMinutesOut(2_000, 'watch'), cfg, NOW)).toBe('dormant');
  });

  it('far out, never scored at all → dormant (a watch-equivalent, not a reason to hold up the first score)', () => {
    expect(tierFor(flightMinutesOut(2_000), cfg, NOW)).toBe('dormant');
  });

  it('far out but already at prepare → standard, not dormant (a real signal exists, just not urgent yet)', () => {
    expect(tierFor(flightMinutesOut(2_000, 'prepare'), cfg, NOW)).toBe('standard');
  });

  it('mid-range distance and band → standard (today\'s original default cadence)', () => {
    expect(tierFor(flightMinutesOut(700, 'watch'), cfg, NOW)).toBe('standard');
  });

  it('a flight that has already departed (negative TTD) is critical, never dormant — most urgent, not least', () => {
    expect(tierFor(flightMinutesOut(-5), cfg, NOW)).toBe('critical');
  });
});

describe('effectiveAltTtlMs — TTL shrinks as departure approaches, floored, never inflated', () => {
  it('inside the urgent window: ttlMs * urgentTtlFactor', () => {
    expect(effectiveAltTtlMs(flightMinutesOut(30), cfg, NOW)).toBe(Math.round(600_000 * 0.33));
  });

  it('inside the near window but outside urgent: ttlMs * nearTtlFactor', () => {
    expect(effectiveAltTtlMs(flightMinutesOut(120), cfg, NOW)).toBe(Math.round(600_000 * 0.5));
  });

  it('inside the approaching window but outside near: ttlMs * approachingTtlFactor', () => {
    expect(effectiveAltTtlMs(flightMinutesOut(300), cfg, NOW)).toBe(Math.round(600_000 * 0.75));
  });

  it('beyond every window: the unscaled baseline ttlMs', () => {
    expect(effectiveAltTtlMs(flightMinutesOut(1_000), cfg, NOW)).toBe(600_000);
  });

  it('never scales below ttlFloorMs, even with an aggressive factor', () => {
    const tight: ThresholdConfig = { ...cfg, altCache: { ...cfg.altCache, ttlMs: 100_000, urgentTtlFactor: 0.01, ttlFloorMs: 180_000 } };
    expect(effectiveAltTtlMs(flightMinutesOut(10), tight, NOW)).toBe(180_000);
  });

  it('monotonic: strictly tighter TTL the closer departure gets, never the reverse', () => {
    const far = effectiveAltTtlMs(flightMinutesOut(1_000), cfg, NOW);
    const approaching = effectiveAltTtlMs(flightMinutesOut(300), cfg, NOW);
    const near = effectiveAltTtlMs(flightMinutesOut(120), cfg, NOW);
    const urgent = effectiveAltTtlMs(flightMinutesOut(30), cfg, NOW);
    expect(far).toBeGreaterThanOrEqual(approaching);
    expect(approaching).toBeGreaterThanOrEqual(near);
    expect(near).toBeGreaterThanOrEqual(urgent);
  });
});
