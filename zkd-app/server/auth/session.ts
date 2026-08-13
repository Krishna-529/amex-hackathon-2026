/**
 * Signed session cookie. Node's built-in `node:crypto` only — no next-auth,
 * no jose, no cookie library. The payload is just "who": `{ pid, iat }`,
 * base64url-encoded, with an HMAC-SHA256 signature appended after a dot.
 *
 * This is the ONLY place a passenger id is allowed to become "who is acting"
 * for a request. Every protected route reads it via server/auth/guard.ts
 * rather than trusting a body/query param — that distinction is the entire
 * point of this file. See server/auth/guard.ts for why.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { NextRequest, NextResponse } from 'next/server';

export const SESSION_COOKIE = 'zkd_session';

const MAX_AGE_S = 60 * 60 * 12; // 12h

/**
 * DEV FALLBACK ONLY. A signing key checked into source lets anyone who can
 * read this repo forge a session for any passenger id. Set SESSION_SECRET in
 * any real deployment; this fallback exists so the prototype runs with zero
 * required env vars, matching every other provider adapter in this app.
 */
const SECRET = process.env.SESSION_SECRET ?? 'zkd-dev-secret-not-for-production';

export type Session = { pid: string; iat: number };

/** Not `Secure` in dev: the Android app talks to http://192.168.x.x:5176 over
 *  plain LAN HTTP, and a Secure cookie would simply never be stored there. */
export const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: MAX_AGE_S,
  secure: process.env.NODE_ENV === 'production',
};

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function hmac(payloadB64: string): string {
  return createHmac('sha256', SECRET).update(payloadB64).digest('base64url');
}

export function signSession(pid: string): string {
  const payload: Session = { pid, iat: Date.now() };
  const payloadB64 = b64url(JSON.stringify(payload));
  return `${payloadB64}.${hmac(payloadB64)}`;
}

export function verifySession(token: string | undefined | null): Session | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;

  try {
    const expected = hmac(payloadB64);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    // timingSafeEqual throws on unequal length rather than returning false.
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

    const session = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8')) as Session;
    if (typeof session.pid !== 'string' || typeof session.iat !== 'number') return null;
    if (Date.now() - session.iat > MAX_AGE_S * 1000) return null;
    return session;
  } catch {
    return null;
  }
}

export function sessionFrom(req: NextRequest): Session | null {
  return verifySession(req.cookies.get(SESSION_COOKIE)?.value);
}

export function setSessionCookie(res: NextResponse, pid: string): void {
  res.cookies.set(SESSION_COOKIE, signSession(pid), COOKIE_OPTIONS);
}

export function clearSessionCookie(res: NextResponse): void {
  res.cookies.set(SESSION_COOKIE, '', { ...COOKIE_OPTIONS, maxAge: 0 });
}
