import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { flightInstancesByRoute } from './oag';

/**
 * Parses a REAL recorded OAG response (server/oag-fixtures/, committed) through
 * the real code path in replay mode. Costs nothing and needs no key.
 *
 * This exists because parseInstance was wrong for months in a way no unit test
 * with a hand-written fixture would have caught: the hand-written shape and the
 * parser agreed with each other, and both disagreed with OAG. The only fixture
 * worth asserting against is one the API actually sent.
 */
describe('flightInstancesByRoute (replay against a real recorded response)', () => {
  beforeEach(() => {
    process.env.OAG_REPLAY = '1';
  });
  afterEach(() => {
    delete process.env.OAG_REPLAY;
  });

  it('parses real BOM->DEL instances with times, terminals and equipment', async () => {
    const rows = await flightInstancesByRoute('BOM', 'DEL', '2026-08-24');
    expect(rows.length).toBe(10);

    const sg = rows.find((r) => r.carrierIata === 'SG' && r.flightNumber === '803');
    expect(sg).toBeDefined();
    expect(sg!.origin).toBe('BOM');
    expect(sg!.destination).toBe('DEL');
    expect(sg!.departureTerminal).toBe('1');
    expect(sg!.aircraftType).toBe('73G');
    expect(sg!.elapsedTimeMin).toBe(140);
    expect(sg!.localDepartureTime).toBe('01:50');
  });

  it('normalises the flight number to a string — v2 sends it as a number', () => {
    // Guards a silent mismatch: 803 !== "803" against any stored flight code.
    return flightInstancesByRoute('BOM', 'DEL', '2026-08-24').then((rows) => {
      expect(rows.every((r) => typeof r.flightNumber === 'string')).toBe(true);
    });
  });

  it('builds the UTC instant from the UTC date, not the local one', async () => {
    // The real trap this catches: SG803 departs 01:50 local on 2026-08-24,
    // which is 20:20 UTC on 2026-08-23 — a DIFFERENT DAY. Pairing date.local
    // with time.utc would shift the flight forward 24h and quietly corrupt
    // every downstream time-to-departure calculation.
    const rows = await flightInstancesByRoute('BOM', 'DEL', '2026-08-24');
    const sg = rows.find((r) => r.flightNumber === '803')!;
    expect(sg.departureDate).toBe('2026-08-24'); // local, what a member calls it
    expect(sg.scheduledDepartureUtc).toBe('2026-08-23T20:20:00Z');
    expect(new Date(sg.scheduledDepartureUtc!).getTime()).toBeGreaterThan(0);
  });

  it('leaves live-status fields null on a schedules query rather than guessing', async () => {
    const rows = await flightInstancesByRoute('BOM', 'DEL', '2026-08-24');
    // "we did not ask for status" must stay distinguishable from "on time".
    expect(rows.every((r) => r.status === null)).toBe(true);
    expect(rows.every((r) => r.actualDepartureUtc === null)).toBe(true);
  });

  it('fails loudly on an unrecorded route instead of returning an empty list', async () => {
    // In replay, empty and unrecorded look identical to a caller — and on stage
    // that reads as "the demo is broken" with no clue why.
    await expect(flightInstancesByRoute('BOM', 'GOI', '2026-08-24')).rejects.toThrow(/no fixture/i);
  });
});
