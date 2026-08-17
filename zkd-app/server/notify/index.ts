/**
 * Fan-out.
 *
 * ── The one rule this file exists to enforce ───────────────────────────────
 *
 * NOTIFYING MUST NEVER BREAK PREDICTING. `dispatch` is called from inside
 * server/engine/forecast.ts's applyScore, which is the single path a real model
 * score takes to become a forecast. An expired Twilio session or a revoked
 * Telegram token must not cost a member their risk score, so every channel is
 * awaited inside allSettled, every result is a value rather than an exception,
 * and dispatch itself cannot reject. The alert is observability on top of the
 * product; the forecast IS the product.
 *
 * Channels are addressed in parallel rather than in sequence: they are
 * independent HTTP calls to three unrelated providers, and a member waiting on
 * a WhatsApp timeout before their push is sent is a worse outcome than any
 * ordering guarantee is worth.
 *
 * Every attempt — delivered, failed, or skipped-because-unconfigured — is
 * written to the decision ledger. "We told the member" is a claim the system
 * makes about itself, and it should be checkable after the fact rather than
 * taken on trust.
 */
import { logNotification } from '@/server/decisionLedger';
import * as telegram from './telegram';
import * as whatsapp from './whatsapp';
import * as push from './push';
import type { ChannelResult, NotifyEvent } from './types';

export type DispatchResult = {
  event: NotifyEvent;
  results: ChannelResult[];
  /** true when at least one channel actually delivered */
  delivered: boolean;
};

export async function dispatch(event: NotifyEvent): Promise<DispatchResult> {
  const settled = await Promise.allSettled([
    telegram.send(event),
    whatsapp.send(event),
    push.send(event),
  ]);

  const channels = ['telegram', 'whatsapp', 'push'] as const;
  const results: ChannelResult[] = settled.map((s, i) =>
    s.status === 'fulfilled'
      ? s.value
      : {
          channel: channels[i],
          ok: false,
          error: s.reason instanceof Error ? s.reason.message : String(s.reason),
        },
  );

  const delivered = results.some((r) => r.ok);

  try {
    logNotification({
      flightId: event.flightId,
      kind: event.kind,
      passengerId: event.passengerId,
      delivered,
      channels: results.map((r) => ({
        channel: r.channel,
        ok: r.ok,
        skipped: !!r.skipped,
        ref: r.ref,
        error: r.error,
      })),
    });
  } catch {
    // Ledger I/O is the last thing that should be able to break a notification.
  }

  if (!delivered) {
    const why = results
      .map((r) => `${r.channel}: ${r.skipped ? 'not configured' : (r.error ?? 'failed')}`)
      .join(' · ');
    console.warn(`[notify] no channel delivered ${event.kind} for ${event.flightId} — ${why}`);
  }

  return { event, results, delivered };
}

/** Which channels could deliver right now — surfaced on /ops so a dead demo
 *  channel is discovered during setup rather than on stage. */
export function channelStatus(passengerId?: string): { channel: string; configured: boolean }[] {
  return [
    { channel: 'telegram', configured: telegram.isConfigured() },
    { channel: 'whatsapp', configured: whatsapp.isConfigured() },
    { channel: 'push', configured: push.isConfigured(passengerId) },
  ];
}

export { registerDevice, forgetDevice, isExpoToken } from './push';
export type { NotifyEvent, ChannelResult } from './types';
