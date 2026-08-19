/**
 * This endpoint is the one place an unauthenticated stranger can make the
 * system believe a flight was cancelled — and since the per-transaction cap was
 * removed, a believed cancellation ends in a charge. So verification gets
 * tested like the security boundary it is, not like a formality.
 */
import { describe, expect, it } from 'vitest';
import { verifyDuffel, verifySharedSecret, safeEqualHex, hmacHex, REPLAY_WINDOW_MS } from './verify';

const SECRET = 'whsec_test_1234567890';
const BODY = '{"id":"evt_1","type":"order.airline_initiated_change_detected"}';

function signedHeader(body: string, secret: string, atMs: number): string {
  const t = Math.floor(atMs / 1000);
  return `t=${t},v1=${hmacHex(secret, `${t}.${body}`)}`;
}

describe('safeEqualHex', () => {
  it('matches identical digests', () => {
    const d = hmacHex(SECRET, 'x');
    expect(safeEqualHex(d, d)).toBe(true);
  });

  it('rejects a different digest of the same length', () => {
    expect(safeEqualHex(hmacHex(SECRET, 'a'), hmacHex(SECRET, 'b'))).toBe(false);
  });

  it('returns false rather than throwing on a length mismatch', () => {
    // timingSafeEqual throws on unequal lengths. Unguarded, a wrong-length
    // signature would 500 instead of 401 — a rejected forgery presenting as a
    // broken endpoint, and a response an attacker can distinguish.
    expect(() => safeEqualHex('abcd', 'ab')).not.toThrow();
    expect(safeEqualHex('abcd', 'ab')).toBe(false);
  });

  it('returns false on non-hex input rather than throwing', () => {
    expect(safeEqualHex('zzzz', 'zzzz')).toBe(true); // Buffer.from tolerates it; still constant-time
    expect(() => safeEqualHex('nothex!!', hmacHex(SECRET, 'x'))).not.toThrow();
  });
});

describe('verifyDuffel', () => {
  const now = Date.UTC(2026, 7, 19, 12, 0, 0);

  it('accepts a correctly signed body', () => {
    expect(verifyDuffel(BODY, signedHeader(BODY, SECRET, now), SECRET, now)).toEqual({ ok: true });
  });

  it('rejects a body that was tampered with after signing', () => {
    const header = signedHeader(BODY, SECRET, now);
    const r = verifyDuffel(BODY.replace('evt_1', 'evt_2'), header, SECRET, now);
    expect(r.ok).toBe(false);
  });

  it('rejects a signature made with the wrong secret', () => {
    const r = verifyDuffel(BODY, signedHeader(BODY, 'whsec_wrong', now), SECRET, now);
    expect(r).toEqual({ ok: false, reason: 'signature did not match' });
  });

  it('rejects a replayed delivery outside the window', () => {
    // A genuine cancellation payload captured off the wire stays perfectly
    // signed forever. Only the timestamp stops it being replayed next week
    // onto a flight that has long since operated.
    const stale = now - REPLAY_WINDOW_MS - 60_000;
    const r = verifyDuffel(BODY, signedHeader(BODY, SECRET, stale), SECRET, now);
    expect(r).toEqual({ ok: false, reason: 'signature timestamp outside the replay window' });
  });

  it('accepts one just inside the window', () => {
    const fresh = now - REPLAY_WINDOW_MS + 30_000;
    expect(verifyDuffel(BODY, signedHeader(BODY, SECRET, fresh), SECRET, now).ok).toBe(true);
  });

  it('tolerates a millisecond timestamp instead of seconds', () => {
    // A sender changing units should read as a unit change, not an attack.
    const header = `t=${now},v1=${hmacHex(SECRET, `${now}.${BODY}`)}`;
    expect(verifyDuffel(BODY, header, SECRET, now).ok).toBe(true);
  });

  it('refuses when no secret is configured, and says which one', () => {
    const r = verifyDuffel(BODY, signedHeader(BODY, SECRET, now), undefined, now);
    expect(r).toEqual({ ok: false, reason: 'DUFFEL_WEBHOOK_SECRET is not configured' });
  });

  it('rejects a missing or malformed header without throwing', () => {
    expect(verifyDuffel(BODY, null, SECRET, now).ok).toBe(false);
    expect(verifyDuffel(BODY, 'garbage', SECRET, now).ok).toBe(false);
    expect(verifyDuffel(BODY, 't=,v1=', SECRET, now).ok).toBe(false);
    expect(verifyDuffel(BODY, 't=notanumber,v1=abcd', SECRET, now).ok).toBe(false);
  });
});

describe('verifySharedSecret', () => {
  it('accepts the configured token', () => {
    expect(verifySharedSecret('tok_abc', 'tok_abc')).toEqual({ ok: true });
  });

  it('rejects a wrong token', () => {
    expect(verifySharedSecret('tok_wrong', 'tok_abc').ok).toBe(false);
  });

  it('rejects a missing token', () => {
    expect(verifySharedSecret(null, 'tok_abc').ok).toBe(false);
  });

  it('refuses when nothing is configured — never falls open', () => {
    // The failure that matters: an unset secret must not mean "allow anyone".
    expect(verifySharedSecret('anything', undefined)).toEqual({
      ok: false,
      reason: 'WEBHOOK_SHARED_SECRET is not configured',
    });
    expect(verifySharedSecret(null, undefined).ok).toBe(false);
  });

  it('does not leak the expected length through a short-circuit', () => {
    // Both sides are hashed before comparison, so a one-character guess costs
    // the same as a nearly-correct one.
    expect(verifySharedSecret('a', 'tok_abcdefghijklmnop').ok).toBe(false);
  });
});
