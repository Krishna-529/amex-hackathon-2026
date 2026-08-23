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
 * In production the fallback is refused outright rather than silently
 * signing every session with a key anyone can read on GitHub.
 */
if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
  throw new Error(
    'SESSION_SECRET is required in production — refusing to sign sessions with the checked-in dev secret.'
  );
}
const SECRET = process.env.SESSION_SECRET ?? 'zkd-dev-secret-not-for-production';

export type Session = { pid: string; iat: number };

/**
 * Whether THIS request actually arrived over HTTPS — not "are we in
 * production". `next start` always sets NODE_ENV=production internally
 * regardless of how it's launched, so a NODE_ENV check made every session
 * cookie `Secure` even when served over plain HTTP (e.g. a raw IP with no
 * TLS): browsers silently refuse to store a `Secure` cookie set over HTTP,
 * so login would 200 but no cookie was ever kept, and every route behind
 * middleware.ts's cookie-presence check bounced back to /login. Checking
 * `x-forwarded-proto` first also makes this correct behind a TLS-terminating
 * proxy, where the hop to this process itself is plain HTTP.
 */
function isHttps(req: NextRequest): boolean {
  return req.headers.get('x-forwarded-proto') === 'https' || req.nextUrl.protocol === 'https:';
}

/** Not `Secure` when the request itself isn't HTTPS: the Android app talks to
 *  http://192.168.x.x:5176 over plain LAN HTTP, and a Secure cookie would
 *  simply never be stored there. */
function cookieOptions(req: NextRequest) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: MAX_AGE_S,
    secure: isHttps(req),
  };
}

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

export function setSessionCookie(res: NextResponse, pid: string, req: NextRequest): void {
  res.cookies.set(SESSION_COOKIE, signSession(pid), cookieOptions(req));
}

export function clearSessionCookie(res: NextResponse, req: NextRequest): void {
  res.cookies.set(SESSION_COOKIE, '', { ...cookieOptions(req), maxAge: 0 });
}
