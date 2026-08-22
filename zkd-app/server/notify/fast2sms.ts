/**
 * SMS, via Fast2SMS — the India-native SMS limb.
 *
 * ── Why not Twilio for SMS ─────────────────────────────────────────────────
 *
 * Twilio cannot deliver SMS to an Indian mobile on a trial, and not for the
 * usual "verify the number first" reason. India's TRAI/DLT regime (TCCCPR)
 * requires a PAID account plus a registered Principal Entity, a registered
 * Sender ID, and Meta/operator-approved templates before a single A2P SMS
 * reaches a +91 handset. A verified caller-ID does not clear it. So the SMS
 * channel uses Fast2SMS instead, whose "Quick SMS" route (`route: "q"`) sends
 * without DLT or a sender-ID registration, to DND and non-DND numbers alike,
 * via an international operator with a random numeric sender.
 *
 * That route is right for a demo and for internal alerts. It is explicitly NOT
 * a production duty-of-care channel: the sender is anonymous-numeric and
 * delivery is less reliable at peak hours. When there is a paid DLT setup, a
 * registered transactional route replaces this — the seam is `send()` and the
 * `route` field, nothing above this file changes.
 *
 * ── The rule this file shares with every other channel ─────────────────────
 *
 * NOTIFYING MUST NEVER BREAK PREDICTING. `send()` is awaited inside
 * server/notify/index.ts's `Promise.allSettled`, must never throw, and returns
 * a value on every path — including the not-configured path, which is a
 * `skipped` result, not a failure. A fresh checkout and CI have no key set, and
 * that case has to stay green.
 *
 * Numbers are bare 10-digit here, not E.164 — Fast2SMS's `numbers` field wants
 * the national number, so a leading `+91`/`91`/`0` is stripped before sending.
 */
import type { ChannelResult, NotifyEvent } from './types';
import { linkFor } from './types';

const ENDPOINT = 'https://www.fast2sms.com/dev/bulkV2';

export function isConfigured(): boolean {
  return !!process.env.FAST2SMS_API_KEY && !!process.env.FAST2SMS_TO;
}

/**
 * Fast2SMS wants the national 10-digit number: no `+`, no country code, no
 * leading zero. `+91 89494 62906`, `918949462906`, `08949462906` and
 * `8949462906` must all become `8949462906`.
 */
export function toLocalNumber(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return digits;
}

export async function send(event: NotifyEvent): Promise<ChannelResult> {
  if (!isConfigured()) return { channel: 'sms', ok: false, skipped: true };

  const apiKey = process.env.FAST2SMS_API_KEY!;
  const numbers = toLocalNumber(process.env.FAST2SMS_TO!);

  // SMS carries no markup and no buttons, so the deep link goes in the body as
  // plain text — the same shape the WhatsApp sandbox uses.
  const message = `${event.title}\n\n${event.body}\n\n${linkFor(event.path)}`;

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: apiKey,
        'Content-Type': 'application/json',
      },
      // route "q" = Quick SMS (no DLT). See the header comment for why.
      body: JSON.stringify({ route: 'q', numbers, message }),
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });

    // Fast2SMS answers `{ return: true, request_id, message: [...] }` on success
    // and `{ return: false, status_code, message: "…" }` on failure. Surface the
    // provider's own words rather than a bare HTTP code — "Invalid Authentication"
    // and "Insufficient wallet balance" are the two a demo actually hits.
    const json = (await res.json().catch(() => null)) as
      | { return?: boolean; request_id?: string; message?: unknown; status_code?: number }
      | null;

    const providerMessage = Array.isArray(json?.message)
      ? json?.message.join('; ')
      : typeof json?.message === 'string'
        ? json?.message
        : undefined;

    if (!res.ok || json?.return !== true) {
      const hint =
        json?.status_code === 412
          ? ' (invalid API key — check FAST2SMS_API_KEY)'
          : json?.status_code === 402 || /balance/i.test(providerMessage ?? '')
            ? ' (insufficient Fast2SMS credit — top up, or the ₹50 signup credit is spent)'
            : '';
      return {
        channel: 'sms',
        ok: false,
        error: `${providerMessage ?? `HTTP ${res.status}`}${hint}`,
      };
    }

    return { channel: 'sms', ok: true, ref: json.request_id };
  } catch (e) {
    return { channel: 'sms', ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
