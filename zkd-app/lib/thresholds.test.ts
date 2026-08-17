import { describe, expect, it } from 'vitest';
import { bandFor, type Thresholds, ACT_AT_RISK_SCORE, isActingOnRisk } from './thresholds';

function thresholds(overrides: Partial<Thresholds> = {}): Thresholds {
  return {
    prepare: 25,
    holdGate: 55,
    preAuthorise: 80,
    factors: { scarcity: 1, urgency: 1, criticality: 1, confidence: 1 },
    inputs: { seatsAvailable: 20, minutesToDeparture: 480, hasHardConstraint: false, confidence: 1 },
    configVersion: 1,
    ...overrides,
  };
}

describe('bandFor', () => {
  const t = thresholds();

  it('returns watch below the prepare floor', () => {
    expect(bandFor(0, t)).toBe('watch');
    expect(bandFor(t.prepare - 1, t)).toBe('watch');
  });

  it('returns prepare at and above the prepare floor, below holdGate', () => {
    expect(bandFor(t.prepare, t)).toBe('prepare');
    expect(bandFor(t.holdGate - 1, t)).toBe('prepare');
  });

  it('returns hold-gate at and above holdGate, below preAuthorise', () => {
    expect(bandFor(t.holdGate, t)).toBe('hold-gate');
    expect(bandFor(t.preAuthorise - 1, t)).toBe('hold-gate');
  });

  it('returns pre-authorise at and above the preAuthorise ceiling', () => {
    expect(bandFor(t.preAuthorise, t)).toBe('pre-authorise');
    expect(bandFor(100, t)).toBe('pre-authorise');
  });

  it('band boundaries belong to the HIGHER band — a regression here would silently under-react at the exact crossing point', () => {
    expect(bandFor(t.prepare, t)).not.toBe('watch');
    expect(bandFor(t.holdGate, t)).not.toBe('prepare');
    expect(bandFor(t.preAuthorise, t)).not.toBe('hold-gate');
  });
});

describe('ACT_AT_RISK_SCORE', () => {
  it('agrees with config/risk-thresholds.json, which is the authority', async () => {
    // The constant is duplicated into this client-safe file because the config
    // is read through lib/thresholdConfig.ts, which pulls in `fs`. Duplication
    // is fine; SILENT duplication is not — if ops retunes the config, this
    // fails rather than leaving the UI highlighting a threshold nothing uses.
    const cfg = JSON.parse(
      await (await import('node:fs/promises')).readFile('config/risk-thresholds.json', 'utf-8'),
    );
    expect(ACT_AT_RISK_SCORE).toBe(cfg.altCache.prefetchAtOrAboveRiskScore);
  });

  it('never highlights a flight the model declined to score', () => {
    // riskScore is omitted rather than fabricated when the percentile lookup
    // is missing. Absent is not high.
    expect(isActingOnRisk(undefined)).toBe(false);
    expect(isActingOnRisk(0)).toBe(false);
  });

  it('is inclusive at the boundary', () => {
    expect(isActingOnRisk(ACT_AT_RISK_SCORE - 0.1)).toBe(false);
    expect(isActingOnRisk(ACT_AT_RISK_SCORE)).toBe(true);
    expect(isActingOnRisk(95.2)).toBe(true);
  });
});
