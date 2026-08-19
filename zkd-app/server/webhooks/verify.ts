/**
 * Signature verification, shared across providers.
 *
 * ── Why timing-safe comparison, on a hackathon project ─────────────────────
 *
 * Because getting it wrong here is not a hackathon-sized mistake. This endpoint
 * is the one place an unauthenticated stranger on the internet can make the
 * system believe a flight has been cancelled — and a believed cancellation now
 * starts a recovery that ends in a charge (the per-transaction cap was removed
 * on 2026-08-19; see server/domain/pricing.ts). A forged delivery is a way to
 * spend someone else's money.
 *
 * `crypto.timingSafeEqual` costs one import.
 *
 * ── Replay is a separate problem from forgery ──────────────────────────────
 *
 * A signature proves a payload was authored by someone holding the secret. It
 * says nothing about *when*. A genuine cancellation delivery captured off the
 * wire is still perfectly signed a week later, and replaying it would re-trigger
 * a recovery on a flight that has long since operated. Hence the timestamp
 * window: signatures are only accepted while fresh, which is why providers put
 * a timestamp inside the signed string rather than beside it.
 *
 * Deduplication (index.ts) is the third, independent guard: it stops the same
 * legitimate delivery being processed twice when the provider retries.
 */

import { createHmac, timingSafeEqual } from 'crypto';

/**
 * How stale a signed timestamp may be.
 *
 * Five minutes matches what Duffel, Stripe and most webhook senders assume, and
 * it has to absorb real clock skew between their servers and ours — too tight
 * and a correctly-signed delivery gets rejected on a machine whose NTP has
 * drifted, which is a far more likely failure here than a replay attack.
 */
export const REPLAY_WINDOW_MS = 5 * 60_000;

export type VerifyResult = { ok: true } | { ok: false; reason: string };

/**
 * Constant-time compare of two hex digests.
 *
 * Length is checked first and separately: `timingSafeEqual` THROWS on unequal
 * lengths rather than returning false, so a wrong-length signature would become
 * a 500 instead of a 401 — turning a rejected forgery into an endpoint that
 * looks broken, and handing the sender a trivially distinguishable response.
 */
export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

export function hmacHex(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
}

/**
 * Duffel's scheme: header `X-Duffel-Signature`, value `t=<unix>,v1=<hex>`,
 * signing the bytes `<timestamp>.<raw body>` with HMAC-SHA256.
 *
 * The RAW body matters and is why the route reads `await req.text()` rather
 * than `req.json()`. Re-serialising parsed JSON changes key order and
 * whitespace, and the resulting digest will never match — a bug that presents
 * as "verification mysteriously always fails" and costs an afternoon.
 */
export function verifyDuffel(rawBody: string, header: string | null, secret: string | undefined, now = Date.now()): VerifyResult {
  if (!secret) return { ok: false, reason: 'DUFFEL_WEBHOOK_SECRET is not configured' };
  if (!header) return { ok: false, reason: 'missing X-Duffel-Signature' };

  const parts = Object.fromEntries(
    header.split(',').map((kv) => {
      const i = kv.indexOf('=');
      return i === -1 ? [kv.trim(), ''] : [kv.slice(0, i).trim(), kv.slice(i + 1).trim()];
    }),
  );
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) return { ok: false, reason: 'malformed signature header' };

  const ts = Number(t);
  if (!Number.isFinite(ts)) return { ok: false, reason: 'malformed signature timestamp' };
  // Duffel sends seconds. Tolerate a millisecond timestamp too rather than
  // rejecting one: a sender switching units should not read as an attack.
  const tsMs = ts > 1e11 ? ts : ts * 1000;
  if (Math.abs(now - tsMs) > REPLAY_WINDOW_MS) {
    return { ok: false, reason: 'signature timestamp outside the replay window' };
  }

  return safeEqualHex(hmacHex(secret, `${t}.${rawBody}`), v1.toLowerCase())
    ? { ok: true }
    : { ok: false, reason: 'signature did not match' };
}

/**
 * AeroDataBox does not sign its deliveries, so the endpoint carries the secret
 * instead: the webhook URL we register contains a token that only we and the
 * provider know, and the route requires it.
 *
 * This is weaker than a signature and it is worth being clear about why rather
 * than pretending otherwise. A URL secret is bearer-style — it travels in full
 * on every request, it will end up in access logs and proxy traces, and it
 * cannot be scoped to one payload. It buys one thing, which is the thing that
 * matters most here: an anonymous stranger who finds the endpoint cannot make
 * us believe a flight was cancelled.
 *
 * Mitigations that make it defensible: the token is long and random, it never
 * appears in a member-facing surface, and rotating it is a single env change
 * plus a re-registration (subscriptions.ts re-registers whenever the URL it
 * last used differs from the current one).
 */
export function verifySharedSecret(provided: string | null, expected: string | undefined): VerifyResult {
  if (!expected) return { ok: false, reason: 'WEBHOOK_SHARED_SECRET is not configured' };
  if (!provided) return { ok: false, reason: 'missing webhook token' };
  // Hashed on both sides before comparison, so the constant-time compare gets
  // fixed-length inputs and the token's own length is not leaked by timing.
  return safeEqualHex(hmacHex(expected, provided), hmacHex(expected, expected))
    ? { ok: true }
    : { ok: false, reason: 'webhook token did not match' };
}
