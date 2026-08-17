/**
 * WhatsApp, via the Twilio sandbox.
 *
 * This is the channel a judge pictures when they hear "we message the member",
 * so it is worth the setup friction — but the friction is real and worth
 * writing down rather than rediscovering:
 *
 *   1. Every recipient must first send the sandbox join code (e.g. "join
 *      <two-words>") to the Twilio sandbox number, ONCE per phone.
 *   2. That session expires after 24 hours of inactivity. On demo morning,
 *      re-send the join code from every phone that will be shown on stage.
 *   3. Outside an open session Twilio only permits pre-approved templates, and
 *      the sandbox has none — so an expired session fails with a real error
 *      (63016) rather than silently dropping. index.ts logs it; it does not
 *      pretend the message went out.
 *
 * Numbers are `whatsapp:+E164` on both ends — a bare number is a different
 * (SMS) product and will not reach WhatsApp.
 */
import type { ChannelResult, NotifyEvent } from './types';
import { linkFor } from './types';

export function isConfigured(): boolean {
  return (
    !!process.env.TWILIO_ACCOUNT_SID &&
    !!process.env.TWILIO_AUTH_TOKEN &&
    !!process.env.TWILIO_WHATSAPP_FROM &&
    !!process.env.TWILIO_WHATSAPP_TO
  );
}

export async function send(event: NotifyEvent): Promise<ChannelResult> {
  if (!isConfigured()) return { channel: 'whatsapp', ok: false, skipped: true };

  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const token = process.env.TWILIO_AUTH_TOKEN!;

  // WhatsApp has no button primitive on the sandbox, so the deep link goes in
  // the body. Actions are deliberately dropped rather than faked as text that
  // looks tappable and is not.
  const text = `*${event.title}*\n\n${event.body}\n\n${linkFor(event.path)}`;

  const form = new URLSearchParams({
    From: waAddress(process.env.TWILIO_WHATSAPP_FROM!),
    To: waAddress(process.env.TWILIO_WHATSAPP_TO!),
    Body: text,
  });

  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });
    const json = (await res.json().catch(() => null)) as { sid?: string; message?: string; code?: number } | null;
    if (!res.ok) {
      const hint =
        json?.code === 63016
          ? ' (sandbox session expired — re-send the join code from the recipient phone)'
          : '';
      return { channel: 'whatsapp', ok: false, error: `${json?.message ?? `HTTP ${res.status}`}${hint}` };
    }
    return { channel: 'whatsapp', ok: true, ref: json?.sid };
  } catch (e) {
    return { channel: 'whatsapp', ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Idempotent — accepts a bare E.164 number or an already-prefixed address. */
function waAddress(n: string): string {
  const trimmed = n.trim();
  return trimmed.startsWith('whatsapp:') ? trimmed : `whatsapp:${trimmed}`;
}
