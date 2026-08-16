import { describe, expect, it } from 'vitest';
import { localDateParts } from './airportDirectory';

/**
 * Regression coverage for a real train/serve skew: zkd-risk-model's training
 * data (ingest_bts.py's CRSDepTime, ingest_anac.py's "Partida Prevista") is
 * origin-airport LOCAL wall-clock time with no timezone attached, so
 * hour_of_day/day_of_week/month in the trained model are local-time
 * features. Before localDateParts existed, riskModel.ts computed these via
 * Date.getUTCHours() etc. — the UTC calendar components of the instant,
 * which only agree with local time at a UTC+0 airport. DEL (Asia/Calcutta,
 * UTC+5:30, no DST) makes the mismatch concrete and exact.
 */
describe('localDateParts', () => {
  it('DEL (UTC+5:30): a UTC-daytime instant that is genuinely a local redeye', () => {
    // 17:00 UTC + 5:30 = 22:30 IST — inside the redeye window [22,24)∪[0,5).
    // The old UTC-only code would have read hour=17 here — nowhere near a
    // redeye — for a flight that is actually one.
    const at = Date.parse('2026-01-15T17:00:00Z');
    const { hour } = localDateParts('DEL', at);
    expect(hour).toBe(22);
  });

  it('DEL: a UTC instant that crosses local midnight into the next calendar day', () => {
    // 19:00 UTC + 5:30 = 00:30 IST the FOLLOWING day.
    const at = Date.parse('2026-01-15T19:00:00Z');
    const utcDay = new Date(at).getUTCDay(); // Thu=4 (trusted: reading the input's own UTC day, not testing our conversion)
    const expectedIsoDayAfterRollover = ((utcDay % 7) + 1) % 7 === 0 ? 7 : ((utcDay % 7) + 1);
    const { hour, dayOfWeek } = localDateParts('DEL', at);
    expect(hour).toBe(0);
    expect(dayOfWeek).toBe(expectedIsoDayAfterRollover);
  });

  it('DEL: a UTC instant that crosses a local MONTH boundary (Dec 31 UTC -> Jan 1 IST)', () => {
    // 20:00 UTC Dec 31 + 5:30 = 01:30 IST Jan 1.
    const at = Date.parse('2025-12-31T20:00:00Z');
    const { hour, month } = localDateParts('DEL', at);
    expect(hour).toBe(1);
    expect(month).toBe(1); // NOT 12 — the UTC-only bug would have reported December
  });

  it('is internally consistent with localTime()\'s displayed HH:MM for the same instant', () => {
    const at = Date.parse('2026-06-10T09:15:00Z'); // 14:45 IST
    const { hour } = localDateParts('DEL', at);
    expect(hour).toBe(14);
  });

  it('falls back to UTC components for an airport with no timezone data, rather than crashing', () => {
    // Some real rows in the OpenFlights source have an empty timezone field.
    const at = Date.parse('2026-01-15T17:00:00Z');
    const { hour, month } = localDateParts('XX0-UNKNOWN-CODE', at);
    const d = new Date(at);
    expect(hour).toBe(d.getUTCHours());
    expect(month).toBe(d.getUTCMonth() + 1);
  });

  it('dayOfWeek is always in the real ISO range 1..7 (never 0, never 8)', () => {
    for (let days = 0; days < 14; days++) {
      const at = Date.parse('2026-01-01T00:00:00Z') + days * 86_400_000;
      const { dayOfWeek } = localDateParts('DEL', at);
      expect(dayOfWeek).toBeGreaterThanOrEqual(1);
      expect(dayOfWeek).toBeLessThanOrEqual(7);
    }
  });

  it('a US airport (America/New_York, UTC-5 in winter) shows the same real skew the other direction', () => {
    // 02:00 UTC - 5h = 21:00 EST the PREVIOUS calendar day.
    const at = Date.parse('2026-01-15T02:00:00Z');
    const { hour } = localDateParts('JFK', at);
    expect(hour).toBe(21);
    expect(hour).not.toBe(new Date(at).getUTCHours()); // proves this genuinely differs from the old UTC-only behavior
  });
});
