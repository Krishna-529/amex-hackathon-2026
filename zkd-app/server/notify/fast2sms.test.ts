import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { isConfigured, toLocalNumber, send } from './fast2sms';
import type { NotifyEvent } from './types';

/**
 * The SMS limb, in isolation. Proves three things a mocked fan-out test cannot:
 * that no-credentials is skipped-not-failed (the CI case), that the +91 number
 * is reduced to the bare 10 digits Fast2SMS wants, and that a provider refusal
 * comes back as a named error rather than a silent success.
 */

const KEYS = ['FAST2SMS_API_KEY', 'FAST2SMS_TO'];
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
  vi.restoreAllMocks();
});

const event: NotifyEvent = {
  kind: 'about-to-book',
  flightId: 'f-1',
  passengerId: 'p-1',
  title: 'Your flight may be cancelled',
  body: 'We are lining up an alternative.',
  path: '/flights/f-1',
};

describe('fast2sms.toLocalNumber', () => {
  it('reduces every Indian format to bare 10 digits', () => {
    for (const raw of ['+91 89494 62906', '918949462906', '08949462906', '8949462906', '+918949462906']) {
      expect(toLocalNumber(raw)).toBe('8949462906');
    }
  });
});

describe('fast2sms.isConfigured', () => {
  it('is false with nothing set — the fresh-checkout / CI case', () => {
    expect(isConfigured()).toBe(false);
  });

  it('needs both the key and the recipient', () => {
    process.env.FAST2SMS_API_KEY = 'k';
    expect(isConfigured()).toBe(false);
    process.env.FAST2SMS_TO = '8949462906';
    expect(isConfigured()).toBe(true);
  });
});

describe('fast2sms.send', () => {
  it('skips — does not fail — when unconfigured, and never calls the network', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const r = await send(event);
    expect(r).toMatchObject({ channel: 'sms', ok: false, skipped: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('posts route "q" with the bare national number', async () => {
    process.env.FAST2SMS_API_KEY = 'test-key';
    process.env.FAST2SMS_TO = '+91 89494 62906';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ return: true, request_id: 'req-1' }), { status: 200 }),
    );

    const r = await send(event);

    expect(r).toMatchObject({ channel: 'sms', ok: true, ref: 'req-1' });
    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse(String(init?.body));
    expect(body.route).toBe('q');
    expect(body.numbers).toBe('8949462906');
    expect((init?.headers as Record<string, string>).Authorization).toBe('test-key');
  });

  it('maps a provider refusal to a named error rather than a silent success', async () => {
    process.env.FAST2SMS_API_KEY = 'bad';
    process.env.FAST2SMS_TO = '8949462906';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ return: false, status_code: 412, message: 'Invalid Authentication' }), {
        status: 200,
      }),
    );

    const r = await send(event);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('Invalid Authentication');
    expect(r.error).toContain('FAST2SMS_API_KEY');
  });
});
