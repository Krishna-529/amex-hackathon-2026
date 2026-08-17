import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { NotifyEvent } from './types';

/**
 * The one invariant that matters here: dispatch is called from inside
 * applyScore, the single path a real model score takes to become a forecast.
 * If it can throw, a revoked Telegram token costs a member their risk score.
 * Every case below is a way a channel can misbehave.
 */

const telegramSend = vi.fn();
const whatsappSend = vi.fn();
const pushSend = vi.fn();
const logNotification = vi.fn();

vi.mock('./telegram', () => ({ send: (e: NotifyEvent) => telegramSend(e), isConfigured: () => true }));
vi.mock('./whatsapp', () => ({ send: (e: NotifyEvent) => whatsappSend(e), isConfigured: () => true }));
vi.mock('./push', () => ({
  send: (e: NotifyEvent) => pushSend(e),
  isConfigured: () => true,
  registerDevice: vi.fn(),
  forgetDevice: vi.fn(),
  isExpoToken: () => true,
}));
vi.mock('@/server/decisionLedger', () => ({ logNotification: (e: unknown) => logNotification(e) }));

const event: NotifyEvent = {
  kind: 'risk-threshold',
  flightId: 'f-1',
  passengerId: 'p-1',
  title: 'test',
  body: 'test',
  path: '/prepare/f-1',
};

const ok = (channel: string) => ({ channel, ok: true, ref: 'r' });
const failed = (channel: string) => ({ channel, ok: false, error: 'boom' });
const skipped = (channel: string) => ({ channel, ok: false, skipped: true });

describe('dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports delivered when any single channel succeeds', async () => {
    const { dispatch } = await import('./index');
    telegramSend.mockResolvedValue(ok('telegram'));
    whatsappSend.mockResolvedValue(failed('whatsapp'));
    pushSend.mockResolvedValue(skipped('push'));

    const result = await dispatch(event);
    expect(result.delivered).toBe(true);
    expect(result.results).toHaveLength(3);
  });

  it('does not throw when a channel REJECTS, and still reports the others', async () => {
    const { dispatch } = await import('./index');
    // A rejection, not a returned failure — the case allSettled exists for.
    whatsappSend.mockRejectedValue(new Error('socket hang up'));
    telegramSend.mockResolvedValue(ok('telegram'));
    pushSend.mockResolvedValue(skipped('push'));

    const result = await dispatch(event);
    expect(result.delivered).toBe(true);
    const wa = result.results.find((r) => r.channel === 'whatsapp')!;
    expect(wa.ok).toBe(false);
    expect(wa.error).toContain('socket hang up');
  });

  it('resolves rather than throwing when EVERY channel fails', async () => {
    const { dispatch } = await import('./index');
    telegramSend.mockRejectedValue(new Error('revoked token'));
    whatsappSend.mockRejectedValue(new Error('session expired'));
    pushSend.mockRejectedValue(new Error('no credentials'));

    const result = await dispatch(event);
    expect(result.delivered).toBe(false);
    expect(result.results.every((r) => !r.ok)).toBe(true);
  });

  it('logs every attempt, including the ones that were skipped as unconfigured', async () => {
    const { dispatch } = await import('./index');
    telegramSend.mockResolvedValue(ok('telegram'));
    whatsappSend.mockResolvedValue(skipped('whatsapp'));
    pushSend.mockResolvedValue(skipped('push'));

    await dispatch(event);

    expect(logNotification).toHaveBeenCalledTimes(1);
    const entry = logNotification.mock.calls[0][0] as {
      delivered: boolean;
      channels: { channel: string; skipped: boolean }[];
    };
    expect(entry.delivered).toBe(true);
    // "nobody was told because nothing was configured" must stay
    // distinguishable from "we tried and it was rejected".
    expect(entry.channels.filter((c) => c.skipped).map((c) => c.channel).sort()).toEqual(['push', 'whatsapp']);
  });

  it('survives a ledger that throws — logging must never break notifying', async () => {
    const { dispatch } = await import('./index');
    telegramSend.mockResolvedValue(ok('telegram'));
    whatsappSend.mockResolvedValue(skipped('whatsapp'));
    pushSend.mockResolvedValue(skipped('push'));
    logNotification.mockImplementation(() => {
      throw new Error('disk full');
    });

    await expect(dispatch(event)).resolves.toMatchObject({ delivered: true });
  });
});
