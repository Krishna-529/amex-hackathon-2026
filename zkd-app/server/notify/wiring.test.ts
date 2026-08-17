import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { dispatch, channelStatus } from './index';
import { thresholdAlert } from './templates';

/**
 * No mocks in this file, deliberately. dispatch.test.ts proves the fan-out
 * LOGIC with every channel stubbed; this proves the real modules actually load
 * and agree on their contracts — the failure this catches is a channel that
 * throws at import time, or an isConfigured() that reads an env var nobody
 * sets, neither of which a mocked test can ever see.
 *
 * It runs with no credentials configured, which is also the state a fresh
 * checkout and CI are in. That is the case that must not break prediction.
 */
const KEYS = [
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_WHATSAPP_FROM',
  'TWILIO_WHATSAPP_TO',
];

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('notify wiring (real modules, no credentials)', () => {
  it('reports every channel unconfigured rather than pretending', () => {
    const status = channelStatus('p-1');
    expect(status.map((s) => s.channel).sort()).toEqual(['push', 'whatsapp']);
    expect(status.every((s) => s.configured === false)).toBe(true);
  });

  it('resolves cleanly with nothing configured — the CI and fresh-checkout case', async () => {
    const event = thresholdAlert({
      flightId: 'f-wiring',
      code: '6E 5231',
      from: 'BOM',
      to: 'GOI',
      departsDisplay: '23 Aug, 22:05',
      pct: 4,
      band: 'hold-gate',
      consent: 'ask',
    });

    const result = await dispatch(event);

    expect(result.delivered).toBe(false);
    // Skipped, not errored: nothing was attempted, so nothing can have failed.
    expect(result.results.every((r) => r.skipped === true)).toBe(true);
  });
});

describe('thresholdAlert copy', () => {
  const base = {
    flightId: 'f-1',
    code: '6E 5231',
    from: 'BOM',
    to: 'GOI',
    departsDisplay: '23 Aug, 22:05',
    pct: 4,
    band: 'hold-gate' as const,
  };

  it('asks an ask-me-first member for a preference', () => {
    const e = thresholdAlert({ ...base, consent: 'ask' });
    expect(e.body).toContain('Tell us what you would prefer');
    expect(e.path).toBe('/prepare/f-1');
  });

  it('tells an autopilot member what will happen and how to stop it', () => {
    const e = thresholdAlert({ ...base, consent: 'autopilot' });
    expect(e.body).toContain('autopilot');
    expect(e.body).toContain('preferences on your card');
  });

  it('never claims an option is held or reserved — the no-holds design', () => {
    // A passenger cannot hold two tickets; carriers' auditors cancel
    // duplicates. See memory.md 2026-08-17. Copy that promises a reservation
    // promises something the system deliberately does not do.
    for (const consent of ['ask', 'autopilot'] as const) {
      const body = thresholdAlert({ ...base, consent }).body.toLowerCase();
      expect(body).not.toMatch(/\bheld\b|\breserved\b|\bholding\b/);
    }
  });

  it('states the band alongside the bare percentage', () => {
    // "4%" alone reads as reassuring; next to "high risk" it reads correctly.
    const e = thresholdAlert({ ...base, consent: 'ask' });
    expect(e.body).toContain('4%');
    expect(e.body.toLowerCase()).toContain('high risk');
  });

  it('says it is still searching when no option has been ranked yet', () => {
    const e = thresholdAlert({ ...base, consent: 'ask' });
    expect(e.body).toContain('searching alternatives');
  });

  it('names the ranked option and its reason once one exists', () => {
    const e = thresholdAlert({
      ...base,
      consent: 'ask',
      topOption: { code: 'AI 662', arr: '23:40', why: 'It gets you there soonest.' },
    });
    expect(e.body).toContain('AI 662');
    expect(e.body).toContain('It gets you there soonest.');
  });
});
