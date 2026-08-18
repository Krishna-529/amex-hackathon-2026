import { describe, expect, it } from 'vitest';
import { confirmWindow, WINDOW_FLOOR_SECONDS, WINDOW_CEILING_SECONDS, AUTOPILOT_NOTICE_CEILING_SECONDS } from './confirmWindow';

const NOW = Date.parse('2026-08-18T12:00:00Z');

describe('confirmWindow — ceilingSeconds override', () => {
  it('with no ceilingSeconds, behaves byte-identically to before (regression guard)', () => {
    const w = confirmWindow({
      offerExpiresAt: null,
      departureAt: NOW + 5 * 24 * 3_600_000, // far out — nothing else binds
      international: false,
      now: NOW,
    });
    expect(w.seconds).toBe(WINDOW_CEILING_SECONDS);
    expect(w.boundBy).toBe('ceiling');
    expect(w.askable).toBe(true);
  });

  it('a custom ceilingSeconds is honored when it is the tightest bound', () => {
    const w = confirmWindow({
      offerExpiresAt: null,
      departureAt: NOW + 5 * 24 * 3_600_000,
      international: false,
      now: NOW,
      ceilingSeconds: AUTOPILOT_NOTICE_CEILING_SECONDS,
    });
    expect(w.seconds).toBe(AUTOPILOT_NOTICE_CEILING_SECONDS);
    expect(w.boundBy).toBe('ceiling');
    expect(w.askable).toBe(true);
  });

  it('never overrides the floor — a tighter real bound below the floor still returns askable:false', () => {
    const w = confirmWindow({
      offerExpiresAt: NOW + 60_000, // 60s out — below the 120s floor once budget/margin are netted
      departureAt: NOW + 5 * 24 * 3_600_000,
      international: false,
      now: NOW,
      ceilingSeconds: AUTOPILOT_NOTICE_CEILING_SECONDS,
    });
    expect(w.askable).toBe(false);
    expect(w.boundBy).toBe('floor');
    expect(w.seconds).toBe(0);
  });

  it('a real offer-expiry bound tighter than the autopilot ceiling still wins', () => {
    const w = confirmWindow({
      offerExpiresAt: NOW + 191_000, // nets to ~160s after budget/margin — between the 120s floor and the 180s ceiling
      departureAt: NOW + 5 * 24 * 3_600_000,
      international: false,
      now: NOW,
      ceilingSeconds: AUTOPILOT_NOTICE_CEILING_SECONDS,
    });
    expect(w.boundBy).toBe('offer-expiry');
    expect(w.seconds).toBeLessThan(AUTOPILOT_NOTICE_CEILING_SECONDS);
    expect(w.seconds).toBeGreaterThanOrEqual(WINDOW_FLOOR_SECONDS);
  });

  it('AUTOPILOT_NOTICE_CEILING_SECONDS sits strictly between the floor and the ask ceiling', () => {
    expect(AUTOPILOT_NOTICE_CEILING_SECONDS).toBeGreaterThan(WINDOW_FLOOR_SECONDS);
    expect(AUTOPILOT_NOTICE_CEILING_SECONDS).toBeLessThan(WINDOW_CEILING_SECONDS);
  });
});
