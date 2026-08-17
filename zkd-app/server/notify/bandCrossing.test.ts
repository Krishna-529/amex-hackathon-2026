import { describe, expect, it } from 'vitest';
import { crossedUpward, ALERT_AT, BAND_RANK } from './bandCrossing';
import type { Band } from '@/lib/thresholds';

/**
 * The rule that decides whether a member's phone buzzes. The interesting cases
 * are all about NOT sending: the batch re-scorer re-evaluates every flight on
 * an interval, so anything that fires on a steady state fires forever.
 */
describe('crossedUpward', () => {
  it('stays silent below the alert band, however many times it is asked', () => {
    expect(crossedUpward(undefined, 'watch')).toBe(false);
    expect(crossedUpward('watch', 'watch')).toBe(false);
  });

  it('fires on a first crossing into the alert band', () => {
    expect(crossedUpward(undefined, 'prepare')).toBe(true);
    expect(crossedUpward('watch', 'prepare')).toBe(true);
  });

  it('fires once, then stays silent while the band holds — the re-scorer case', () => {
    // Simulates applyScore's mark-then-send: the marker only advances when we
    // actually alert, so repeated identical scores must not re-alert.
    let lastNotified: Band | undefined;
    let alerts = 0;
    for (let cycle = 0; cycle < 10; cycle++) {
      if (crossedUpward(lastNotified, 'hold-gate')) {
        alerts++;
        lastNotified = 'hold-gate';
      }
    }
    expect(alerts).toBe(1);
  });

  it('escalates: each worse band is its own alert', () => {
    expect(crossedUpward('prepare', 'hold-gate')).toBe(true);
    expect(crossedUpward('hold-gate', 'pre-authorise')).toBe(true);
  });

  it('never fires on a de-escalation', () => {
    expect(crossedUpward('pre-authorise', 'hold-gate')).toBe(false);
    expect(crossedUpward('hold-gate', 'prepare')).toBe(false);
    expect(crossedUpward('prepare', 'watch')).toBe(false);
  });

  it('does not re-announce a dip and recovery — the documented, deliberate cost', () => {
    // Member was told about hold-gate. Score dips to prepare, then returns.
    // They already know it is in hold-gate; saying it twice is how a warning
    // becomes background noise.
    expect(crossedUpward('hold-gate', 'prepare')).toBe(false);
    expect(crossedUpward('hold-gate', 'hold-gate')).toBe(false);
  });

  it('ranks every band and treats the alert floor as one of them', () => {
    // Guards against a new band being added to lib/thresholds.ts without a rank
    // here, which would make crossedUpward compare against undefined.
    const bands: Band[] = ['watch', 'prepare', 'hold-gate', 'pre-authorise'];
    for (const b of bands) expect(typeof BAND_RANK[b]).toBe('number');
    expect(BAND_RANK[ALERT_AT]).toBeGreaterThan(BAND_RANK.watch);
  });
});
