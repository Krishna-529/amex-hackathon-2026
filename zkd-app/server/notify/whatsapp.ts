/**
 * WhatsApp, via Twilio.
 *
 * ── The rule that shapes this whole file ───────────────────────────────────
 *
 * A business may not OPEN a WhatsApp conversation with free-form text. Free
 * text is permitted only inside the 24-hour window that begins when the
 * customer messages first. To reach someone who has not written to you — which
 * is every real member, since nobody texts a concierge before their flight is
 * in trouble — you must send a **pre-approved Content Template**.
 *
 * That single rule produces two different setups:
 *
 * **Demo (sandbox).** The `join <phrase>` code IS the opt-in: it is how Twilio
 * proves consent without a verified WhatsApp Business Account. Every recipient
 * sends it once per phone, and the window closes after 24h idle — so it must be
 * re-sent on demo morning, from every phone shown on stage. A template does not
 * exempt you here; the sandbox requires the join regardless.
 *
 * **Production.** A verified WABA, a registered sender, and a template approved
 * by Meta. A flight-disruption alert is a UTILITY template — the category
 * approved precisely for time-sensitive information about something the
 * customer already bought. Opt-in is then collected by Amex at card enrolment,
 * not by asking a member to text a join code. Set
 * `TWILIO_WHATSAPP_CONTENT_SID` and `send()` switches to that path.
 *
 * Both failure modes surface as real, named errors (63016 expired session,
 * 21654 no session and no template) rather than a silent drop — index.ts logs
 * them and never pretends the message went out.
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
  });

  // ── Free-form vs template: the difference between a demo and a product ────
  //
  // WhatsApp forbids a business from OPENING a conversation with free-form
  // text. Free text is only allowed inside the 24-hour window that starts when
  // the customer messages first — which is fine in the sandbox, where the
  // `join <phrase>` code is the opt-in, but useless for a real Amex member who
  // will never text a join code.
  //
  // The production answer is a pre-approved Content Template. A "your flight
  // may be cancelled" alert is a UTILITY template, the category Meta approves
  // for exactly this: time-sensitive information about something the customer
  // already bought. With one, this call needs no session and no prior message —
  // opt-in is collected by Amex at enrolment instead.
  //
  // So: send the template when one is configured, free text otherwise. Without
  // this branch the code would be structurally incapable of ever reaching a
  // real customer, whatever credentials it was given.
  const contentSid = process.env.TWILIO_WHATSAPP_CONTENT_SID;
  if (contentSid) {
    form.set('ContentSid', contentSid);
    // Positional variables, per Twilio's Content API. Kept to the two facts a
    // UTILITY template may carry: what is at risk, and how bad it looks.
    form.set(
      'ContentVariables',
      JSON.stringify({ '1': event.title, '2': event.body, '3': linkFor(event.path) }),
    );
  } else {
    form.set('Body', text);
  }

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
          : json?.code === 21654
            ? ' (no open session and no template: WhatsApp forbids business-initiated free text. ' +
              'In the sandbox the recipient must send the join code; in production set ' +
              'TWILIO_WHATSAPP_CONTENT_SID to an approved UTILITY template)'
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
