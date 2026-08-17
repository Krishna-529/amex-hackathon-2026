/**
 * Signed operator-session cookie, parallel to server/auth/session.ts but for
 * the /ops console rather than a member. /ops has no per-user account (see
 * app/ops/page.tsx's own comment on that), but "no account" had drifted into
 * "no auth at all" on the routes it drives — POST /api/disruptions and POST
 * /api/flights can trigger real spend-adjacent pipeline actions and were
 * reachable by anyone with the URL. This adds a single shared operator
 * credential (OPS_ACCESS_KEY) behind the same HMAC-signed-cookie mechanism
 * session.ts already uses, rather than inventing a second auth primitive.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { NextRequest, NextResponse } from 'next/server';

export const OPS_COOKIE = 'zkd_ops_session';

const MAX_AGE_S = 60 * 60 * 8; // 8h — shorter than a member session; re-auth for a fresh op shift.

/**
 * DEV FALLBACK ONLY, same rationale as session.ts's SESSION_SECRET: lets the
 * prototype run with zero required env vars. Refused outright in production.
 */
if (process.env.NODE_ENV === 'production' && !process.env.OPS_SECRET) {
  throw new Error(
    'OPS_SECRET is required in production — refusing to sign operator sessions with the checked-in dev secret.'
  );
}
if (process.env.NODE_ENV === 'production' && !process.env.OPS_ACCESS_KEY) {
  throw new Error(
    'OPS_ACCESS_KEY is required in production — refusing to run the operator console with the checked-in dev key.'
  );
}
const SECRET = process.env.OPS_SECRET ?? 'zkd-dev-ops-secret-not-for-production';
const ACCESS_KEY = process.env.OPS_ACCESS_KEY ?? 'zkd-ops-dev-key';

export type OpsSession = { role: 'operator'; iat: number };

export const OPS_COOKIE_OPTIONS = {
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

/** Timing-safe compare of the submitted operator key against the configured one. */
export function checkOpsAccessKey(submitted: string): boolean {
  const a = Buffer.from(submitted);
  const b = Buffer.from(ACCESS_KEY);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function signOpsSession(): string {
  const payload: OpsSession = { role: 'operator', iat: Date.now() };
  const payloadB64 = b64url(JSON.stringify(payload));
  return `${payloadB64}.${hmac(payloadB64)}`;
}

export function verifyOpsSession(token: string | undefined | null): OpsSession | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;

  try {
    const expected = hmac(payloadB64);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

    const session = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8')) as OpsSession;
    if (session.role !== 'operator' || typeof session.iat !== 'number') return null;
    if (Date.now() - session.iat > MAX_AGE_S * 1000) return null;
    return session;
  } catch {
    return null;
  }
}

export function opsSessionFrom(req: NextRequest): OpsSession | null {
  return verifyOpsSession(req.cookies.get(OPS_COOKIE)?.value);
}

export function setOpsSessionCookie(res: NextResponse): void {
  res.cookies.set(OPS_COOKIE, signOpsSession(), OPS_COOKIE_OPTIONS);
}

export function clearOpsSessionCookie(res: NextResponse): void {
  res.cookies.set(OPS_COOKIE, '', { ...OPS_COOKIE_OPTIONS, maxAge: 0 });
}
