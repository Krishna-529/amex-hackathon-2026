/**
 * Tests for the pure journey-prefs logic: which consent governs a flight, and
 * how a member-supplied window is validated. Both are the kind of decision that
 * should be executable rather than asserted in a comment.
 */

import { describe, it, expect } from 'vitest';
import { resolveConsent, validateJourneyWindow } from './journeyPrefs';

describe('resolveConsent — the per-flight human-in-the-loop choice', () => {
  it('uses the profile consent when there is no override', () => {
    expect(resolveConsent('autopilot', null)).toBe('autopilot');
    expect(resolveConsent('ask', null)).toBe('ask');
    expect(resolveConsent('autopilot', undefined)).toBe('autopilot');
  });

  it('a per-flight override wins over the profile default, both directions', () => {
    // a member on standing autopilot asks to be consulted for this one flight
    expect(resolveConsent('autopilot', 'ask')).toBe('ask');
    // a member who normally reviews grants autonomy for this one flight
    expect(resolveConsent('ask', 'autopilot')).toBe('autopilot');
  });
});

describe('validateJourneyWindow — never throws, drops bad values with a note', () => {
  it('passes through two valid, coherent instants', () => {
    const start = '2026-08-21T06:00:00.000Z';
    const end = '2026-08-21T20:00:00.000Z';
    const r = validateJourneyWindow({ earliestDepartISO: start, latestArriveISO: end });
    expect(r.earliestDepartISO).toBe(start);
    expect(r.latestArriveISO).toBe(end);
    expect(r.notes).toEqual([]);
  });

  it('accepts either bound alone', () => {
    const onlyStart = validateJourneyWindow({ earliestDepartISO: '2026-08-21T06:00:00Z' });
    expect(onlyStart.earliestDepartISO).not.toBeNull();
    expect(onlyStart.latestArriveISO).toBeNull();
    expect(onlyStart.notes).toEqual([]);

    const onlyEnd = validateJourneyWindow({ latestArriveISO: '2026-08-21T20:00:00Z' });
    expect(onlyEnd.latestArriveISO).not.toBeNull();
    expect(onlyEnd.earliestDepartISO).toBeNull();
  });

  it('drops an unreadable value with a member-facing note instead of throwing', () => {
    const r = validateJourneyWindow({ earliestDepartISO: 'sometime next week', latestArriveISO: '2026-08-21T20:00:00Z' });
    expect(r.earliestDepartISO).toBeNull();
    expect(r.latestArriveISO).not.toBeNull();
    expect(r.notes.some((n) => n.toLowerCase().includes('earliest departure'))).toBe(true);
  });

  it('refuses a contradictory window (arrive-by before depart-after), keeping the start', () => {
    const r = validateJourneyWindow({
      earliestDepartISO: '2026-08-21T18:00:00Z',
      latestArriveISO: '2026-08-21T09:00:00Z', // before the start
    });
    expect(r.earliestDepartISO).not.toBeNull();
    expect(r.latestArriveISO).toBeNull();
    expect(r.notes.some((n) => n.toLowerCase().includes('before your earliest departure'))).toBe(true);
  });

  it('empty and null inputs produce an open window with no notes', () => {
    const r = validateJourneyWindow({ earliestDepartISO: null, latestArriveISO: '' });
    expect(r.earliestDepartISO).toBeNull();
    expect(r.latestArriveISO).toBeNull();
    expect(r.notes).toEqual([]);
  });

  it('normalises a valid instant to ISO form', () => {
    const r = validateJourneyWindow({ latestArriveISO: '2026-08-21T20:00:00+05:30' });
    expect(r.latestArriveISO).toBe(new Date('2026-08-21T20:00:00+05:30').toISOString());
  });
});
