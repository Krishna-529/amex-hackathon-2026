import { describe, expect, it } from 'vitest';
import { flightsInTier } from './batchScorer';
import type { ThresholdConfig } from '@/lib/thresholdConfig';
import type { Band } from '@/lib/thresholds';
import type { Flight } from '../domain/types';

/**
 * Regression coverage for the tiered rescheduling: batchScorer.ts used to
 * run ONE flat interval loop that re-scored every flight together, so a
 * flight 45 minutes from departure and a flight 3 days out were rescored on
 * the exact same clock. flightsInTier() is the partitioning step each of the
 * three tier loops runs before its one real scoreFlightsBatch() HTTP call —
 * this asserts every flight lands in exactly one tier and the partitioning
 * matches rescoreTiming.ts's tierFor() (covered on its own in
 * rescoreTiming.test.ts) end to end against a realistic mixed fleet.
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
};

const NOW = Date.parse('2026-08-16T12:00:00Z');

function flight(id: string, minutesOut: number, band?: Band): Flight {
  return {
    id, code: 'AI 2803', from: 'DEL', to: 'BOM',
    depISO: new Date(NOW + minutesOut * 60_000).toISOString(), durationMin: 130,
    connectionSlackMinutes: null, hasHardConstraint: false,
    candidates: { alts: [], hotels: [], cabs: [], cabLegs: [] },
    ...(band ? { forecast: { band } as Flight['forecast'] } : {}),
  };
}

describe('flightsInTier — partitions a mixed fleet into exactly the right cadence bucket', () => {
  const fleet = [
    flight('soon-unscored', 60), // inside critical window, no forecast yet
    flight('far-watch', 3000, 'watch'), // dormant
    flight('far-holdgate', 3000, 'hold-gate'), // critical despite distance
    flight('mid-watch', 700, 'watch'), // standard
    flight('mid-prepare', 700, 'prepare'), // standard
  ];

  it('every flight appears in exactly one tier', () => {
    const critical = flightsInTier(fleet, 'critical', cfg, NOW);
    const standard = flightsInTier(fleet, 'standard', cfg, NOW);
    const dormant = flightsInTier(fleet, 'dormant', cfg, NOW);
    const ids = (arr: Flight[]) => arr.map((f) => f.id).sort();

    expect(ids(critical).length + ids(standard).length + ids(dormant).length).toBe(fleet.length);
    const seen = new Set([...ids(critical), ...ids(standard), ...ids(dormant)]);
    expect(seen.size).toBe(fleet.length);
  });

  it('critical tier: near-departure unscored flight and far-out hold-gate flight, nothing else', () => {
    const ids = flightsInTier(fleet, 'critical', cfg, NOW).map((f) => f.id).sort();
    expect(ids).toEqual(['far-holdgate', 'soon-unscored']);
  });

  it('dormant tier: only the far-out watch flight', () => {
    const ids = flightsInTier(fleet, 'dormant', cfg, NOW).map((f) => f.id);
    expect(ids).toEqual(['far-watch']);
  });

  it('standard tier: the two mid-distance flights', () => {
    const ids = flightsInTier(fleet, 'standard', cfg, NOW).map((f) => f.id).sort();
    expect(ids).toEqual(['mid-prepare', 'mid-watch']);
  });

  it('an empty fleet produces an empty result for every tier (no call worth making)', () => {
    expect(flightsInTier([], 'critical', cfg, NOW)).toEqual([]);
    expect(flightsInTier([], 'standard', cfg, NOW)).toEqual([]);
    expect(flightsInTier([], 'dormant', cfg, NOW)).toEqual([]);
  });
});
