import { describe, expect, it } from 'vitest';
import { bandFor, type Thresholds } from './thresholds';

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
