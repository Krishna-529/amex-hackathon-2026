/**
 * Signed session cookie. Node's built-in `node:crypto` only — no next-auth,
 * no jose, no cookie library. The payload is just "who": `{ pid, iat }`,
 * base64url-encoded, with an HMAC-SHA256 signature appended after a dot.
 *
 * This is the ONLY place a passenger id is allowed to become "who is acting"
 * for a request. Every protected route reads it via server/auth/guard.ts
 * rather than trusting a body/query param — that distinction is the entire
 * point of this file. See server/auth/guard.ts for why.
 *
 * ── The cookie is shared by every tab; a per-tab header is not ─────────────
 *
 * A real, reported bug (2026-08-22): sign in as one member in one tab, then
 * sign in as a DIFFERENT member in a second tab of the same browser — the
 * first tab silently stops working. The cause is unavoidable if the cookie
 * is the only source of identity: `zkd_session` is one value per browser,
 * not per tab, so the second login overwrites the first tab's identity out
 * from under it. Every subsequent request from tab one now authenticates as
 * the second member, and routes that check ownership (`requireSelf`) start
 * returning 403 for a passenger id the response body never mentions — which
 * reads as "broken", not as an auth error, because nothing in the UI
 * distinguishes the two.
 *
 * The fix is `SESSION_HEADER`: `signSession`'s token is also handed to the
 * client in the login response, which stores it in `sessionStorage` — a
 * browser storage area that is genuinely per-tab (a new tab, unlike a new
 * request, does not inherit it; see lib/tabSession.ts). A small client-side
 * fetch patch replays it on every request. `sessionFrom` below checks the
 * header first, falling back to the shared cookie only when a tab never
 * captured its own token — which is exactly the pre-existing, single-account
 * behaviour, so a tab that never explicitly logged in in this browser session
 * is unaffected. The cookie itself is kept, unchanged, as that fallback and
 * because a header cannot ride along on the very first server-rendered
 * request of a fresh page load, before any client JS has run.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { NextRequest, NextResponse } from 'next/server';

export const SESSION_COOKIE = 'zkd_session';

/** Per-tab identity override — see this file's header. Carries the exact
 *  same signed token shape as the cookie; `verifySession` doesn't care which
 *  transport it arrived on. */
export const SESSION_HEADER = 'x-zkd-session';

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
  // Header first: a tab that captured its own token stays that identity
  // regardless of what another tab's login just did to the shared cookie.
  const fromHeader = verifySession(req.headers.get(SESSION_HEADER));
  if (fromHeader) return fromHeader;
  return verifySession(req.cookies.get(SESSION_COOKIE)?.value);
}

/** Takes the already-signed token, not a pid — the caller (the login route)
 *  signs once and gives the same token to both this cookie and the response
 *  body's `sessionToken`, so the two can never disagree on `iat`. */
export function setSessionCookie(res: NextResponse, token: string): void {
  res.cookies.set(SESSION_COOKIE, token, COOKIE_OPTIONS);
}

export function clearSessionCookie(res: NextResponse): void {
  res.cookies.set(SESSION_COOKIE, '', { ...COOKIE_OPTIONS, maxAge: 0 });
}
