/**
 * Signed operator session cookie — the same HMAC-SHA256-over-base64url shape
 * as `session.ts`'s member session, but deliberately a SEPARATE cookie,
 * SEPARATE secret, and SEPARATE credential: an operator is not a member, and
 * a member's own signed-in session must never double as operator access.
 *
 * Added 2026-08-21. Before this, every `/ops`-mutating route (`mark-cancelled`,
 * `demo-reset`) and the `/api/disruptions` manual-trigger route (the ONLY
 * caller of which is the `/ops` console — verified: `grep` across `app/` and
 * `components/` for `api/disruptions'` finds no other caller) checked only
 * `requireSession` — "is ANY member signed in" — which is not an operator
 * check at all. Any of the demo accounts, or any real card member's own
 * session, could wipe the whole demo/disruption state
 * (`POST /api/ops/demo-reset`), mark an arbitrary flight cancelled
 * (`POST /api/ops/mark-cancelled`, with no ownership check, and
 * `cancelledInData` is treated as instantly-authoritative corroboration —
 * see `server/engine/memberReports.ts`), or trigger a real disruption on any
 * flight (`POST /api/disruptions`, which fans out to autopilot/pre-auth
 * passengers with NO confirmation window). `GET /api/disruptions` had no
 * auth at all and returned real passenger names + owed amounts.
 *
 * The credential is one shared operator key (`OPS_ACCESS_KEY`), matching the
 * shape a real ops console for a small internal team actually has — this is
 * not a per-operator identity system, it's the boundary between "a member"
 * and "someone who was handed the operator key."
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { NextRequest, NextResponse } from 'next/server';

export const OPS_SESSION_COOKIE = 'zkd_ops_session';

const MAX_AGE_S = 60 * 60 * 8; // 8h — shorter than the member session's 12h; an
// operator session is meant for one active demo/incident window, not a
// standing login.

/**
 * DEV FALLBACK ONLY, mirroring session.ts's own guard exactly. Refuses to
 * boot in production without a real secret rather than silently signing
 * every operator session with a key anyone can read on GitHub.
 */
if (process.env.NODE_ENV === 'production' && !process.env.OPS_SESSION_SECRET) {
  throw new Error(
    'OPS_SESSION_SECRET is required in production — refusing to sign operator sessions with the checked-in dev secret.'
  );
}
const SECRET = process.env.OPS_SESSION_SECRET ?? 'zkd-dev-ops-secret-not-for-production';

/**
 * The shared operator credential itself. Deliberately separate from
 * SESSION_SECRET (which signs cookies, not authenticates a human) — this is
 * the thing a real operator actually types in. No dev fallback: an unset
 * OPS_ACCESS_KEY means ops login is impossible rather than guessable, which
 * is the safe default (a locked-out operator console is recoverable by
 * setting an env var; a guessable one is not).
 */
const OPS_ACCESS_KEY = process.env.OPS_ACCESS_KEY;

export type OpsSession = { iat: number };

/**
 * Whether THIS request actually arrived over HTTPS — see session.ts's
 * identical helper for why NODE_ENV is the wrong signal here (next start
 * always sets NODE_ENV=production regardless of whether the origin is
 * actually TLS-terminated).
 */
function isHttps(req: NextRequest): boolean {
  return req.headers.get('x-forwarded-proto') === 'https' || req.nextUrl.protocol === 'https:';
}

function opsCookieOptions(req: NextRequest) {
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

/** Constant-time check against the configured key. Returns false (never
 *  throws) when OPS_ACCESS_KEY is unset — ops login is simply unavailable,
 *  not a 500. */
export function verifyOpsKey(candidate: string): boolean {
  if (!OPS_ACCESS_KEY || !candidate) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(OPS_ACCESS_KEY);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function signOpsSession(): string {
  const payload: OpsSession = { iat: Date.now() };
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
    if (typeof session.iat !== 'number') return null;
    if (Date.now() - session.iat > MAX_AGE_S * 1000) return null;
    return session;
  } catch {
    return null;
  }
}

export function opsSessionFrom(req: NextRequest): OpsSession | null {
  return verifyOpsSession(req.cookies.get(OPS_SESSION_COOKIE)?.value);
}

export function setOpsSessionCookie(res: NextResponse, req: NextRequest): void {
  res.cookies.set(OPS_SESSION_COOKIE, signOpsSession(), opsCookieOptions(req));
}

export function clearOpsSessionCookie(res: NextResponse, req: NextRequest): void {
  res.cookies.set(OPS_SESSION_COOKIE, '', { ...opsCookieOptions(req), maxAge: 0 });
}
