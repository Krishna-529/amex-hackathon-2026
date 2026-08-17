import { describe, expect, it } from 'vitest';
import { thresholdsFor } from './thresholds';

/**
 * Tests the real adaptive behavior against the real config/risk-thresholds.json
 * — no mocking of getThresholdConfig(). Deliberately asserts PROPERTIES
 * (ordering, monotonic response to each input) rather than hardcoded band
 * numbers, so recalibrating the config's floor/ceiling values (a real,
 * expected operational action) doesn't break these tests.
 */
describe('thresholdsFor (real config/risk-thresholds.json)', () => {
  const base = { seatsAvailable: 20, minutesToDeparture: 480, hasHardConstraint: false, confidence: 1 };

  it('bands are always ordered prepare < holdGate < preAuthorise', () => {
    const cases = [
      base,
      { ...base, seatsAvailable: 0 },
      { ...base, minutesToDeparture: 10 },
      { ...base, hasHardConstraint: true },
      { ...base, confidence: 0 },
    ];
    for (const input of cases) {
      const t = thresholdsFor(input);
      expect(t.prepare).toBeLessThan(t.holdGate);
      expect(t.holdGate).toBeLessThan(t.preAuthorise);
    }
  });

  it('fewer seats lowers every threshold — act earlier when scarce', () => {
    const many = thresholdsFor({ ...base, seatsAvailable: 20 });
    const none = thresholdsFor({ ...base, seatsAvailable: 0 });
    expect(none.prepare).toBeLessThanOrEqual(many.prepare);
    expect(none.holdGate).toBeLessThanOrEqual(many.holdGate);
    expect(none.preAuthorise).toBeLessThanOrEqual(many.preAuthorise);
  });

  it('less time to departure lowers every threshold — act on less certainty when urgent', () => {
    const far = thresholdsFor({ ...base, minutesToDeparture: 480 });
    const soon = thresholdsFor({ ...base, minutesToDeparture: 10 });
    expect(soon.prepare).toBeLessThanOrEqual(far.prepare);
    expect(soon.holdGate).toBeLessThanOrEqual(far.holdGate);
    expect(soon.preAuthorise).toBeLessThanOrEqual(far.preAuthorise);
  });

  it('lower forecast confidence raises every threshold — a less-sure forecast must clear a higher bar', () => {
    const confident = thresholdsFor({ ...base, confidence: 1 });
    const unsure = thresholdsFor({ ...base, confidence: 0 });
    expect(unsure.prepare).toBeGreaterThanOrEqual(confident.prepare);
    expect(unsure.holdGate).toBeGreaterThanOrEqual(confident.holdGate);
    expect(unsure.preAuthorise).toBeGreaterThanOrEqual(confident.preAuthorise);
  });

  it('a hard constraint (onward connection) lowers every threshold — act earlier when more is at stake', () => {
    const soft = thresholdsFor({ ...base, hasHardConstraint: false });
    const hard = thresholdsFor({ ...base, hasHardConstraint: true });
    expect(hard.prepare).toBeLessThanOrEqual(soft.prepare);
    expect(hard.holdGate).toBeLessThanOrEqual(soft.holdGate);
    expect(hard.preAuthorise).toBeLessThanOrEqual(soft.preAuthorise);
  });

  it('every threshold stays within a sane real percentage range under extreme inputs', () => {
    const extreme = thresholdsFor({ seatsAvailable: 0, minutesToDeparture: 0, hasHardConstraint: true, confidence: 0 });
    expect(extreme.prepare).toBeGreaterThan(0);
    expect(extreme.preAuthorise).toBeLessThanOrEqual(100);
  });

  it('echoes back the real inputs and a real config version, for the decision ledger to replay', () => {
    const t = thresholdsFor(base);
    expect(t.inputs).toEqual(base);
    expect(typeof t.configVersion).toBe('number');
  });
});
