import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelScore } from './riskModel';
import type { Flight } from '../domain/types';

/**
 * Regression coverage for a real bug: the risk-gate trigger
 * (triggerAltPrefetchIfWarranted, private to forecast.ts) used to call
 * refreshAlts/refreshGround directly — functions with NO staleness check of
 * their own, only an in-flight concurrency dedup — so a flight sitting
 * above the risk gate across multiple scoring ticks re-searched suppliers
 * on every single tick, silently defeating "search once per risk-crossing
 * event" (the whole point of the threshold-gated pre-cache, per
 * documentation/design/01-prediction-model.md §1 and the atlas's "one
 * coordinator reshop... 300->102 calls" claim). Fixed by routing through
 * refreshAltsIfStale/refreshGroundIfStale instead. This test asserts the
 * WIRING — that applyScore's gate calls the staleness-aware functions, not
 * the raw always-search ones — by mocking every dependency and inspecting
 * which mock actually got called.
 */
vi.mock('../suppliers', () => ({
  searchInventory: vi.fn(async () => ({ offers: [], sources: {} })),
  seatsAcross: () => 0,
}));
vi.mock('../domain/store', () => ({
  getBookingsForFlight: vi.fn(async () => []),
  createFlight: vi.fn(async () => {}),
  insertForecastSnapshot: vi.fn(async () => {}),
  partySize: () => 1,
}));
vi.mock('../decisionLedger', () => ({
  logPrediction: vi.fn(),
  logThresholdEvaluation: vi.fn(),
}));
const refreshAltsIfStale = vi.fn();
const refreshGroundIfStale = vi.fn();
vi.mock('./altsCache', () => ({ refreshAltsIfStale: (...a: unknown[]) => refreshAltsIfStale(...a) }));
vi.mock('./groundCache', () => ({ refreshGroundIfStale: (...a: unknown[]) => refreshGroundIfStale(...a) }));

function realFlight(): Flight {
  return {
    id: 'flt-gate-test', code: 'AI 2803', from: 'DEL', to: 'BOM',
    depISO: new Date(Date.now() + 3_600_000).toISOString(), durationMin: 130,
    connectionSlackMinutes: null, hasHardConstraint: false,
    candidates: { alts: [], hotels: [], cabs: [], cabLegs: [] },
  };
}

function scoreWith(riskScore: number | undefined): ModelScore {
  return { cancelProbability: 0.03, confidence: 0.8, modelVersion: 'test', source: 'internal-ml', riskScore };
}

describe('applyScore — alt/ground pre-cache gate calls the staleness-aware refresh, not the raw always-search one', () => {
  beforeEach(() => {
    refreshAltsIfStale.mockClear();
    refreshGroundIfStale.mockClear();
  });

  it('above the risk-score gate: calls refreshAltsIfStale/refreshGroundIfStale (never the un-gated refreshAlts/refreshGround)', async () => {
    const { applyScore } = await import('./forecast');
    await applyScore(realFlight(), scoreWith(90)); // default gate is 75
    expect(refreshAltsIfStale).toHaveBeenCalledTimes(1);
    expect(refreshGroundIfStale).toHaveBeenCalledTimes(1);
  });

  it('below the gate: neither fires at all', async () => {
    const { applyScore } = await import('./forecast');
    await applyScore(realFlight(), scoreWith(10));
    expect(refreshAltsIfStale).not.toHaveBeenCalled();
    expect(refreshGroundIfStale).not.toHaveBeenCalled();
  });

  it('riskScore undefined (percentile lookup not generated yet): neither fires — never guessed', async () => {
    const { applyScore } = await import('./forecast');
    await applyScore(realFlight(), scoreWith(undefined));
    expect(refreshAltsIfStale).not.toHaveBeenCalled();
    expect(refreshGroundIfStale).not.toHaveBeenCalled();
  });
});
