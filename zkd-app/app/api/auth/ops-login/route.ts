import { NextRequest, NextResponse } from 'next/server';
import { verifyOpsKey, setOpsSessionCookie } from '@/server/auth/opsSession';
import { checkRateLimit } from '@/server/rateLimit';

/**
 * The operator console's own sign-in — separate credential, separate cookie
 * from a member's session (see opsSession.ts's header for why this exists).
 *
 * Rate-limited 2026-08-21: the operator key is a single shared secret —
 * unlike a member password, there's no per-account lockout to fall back on
 * — so this is a login route where a tight limit matters. Originally 5
 * burst / 5-per-minute; raised to 15/15 on 2026-08-22 because the limiter's
 * key is the client IP (one shared bucket per machine, see rateLimit.ts) and
 * an operator legitimately re-authenticates more than 5 times/minute across
 * a demo — a fresh /ops tab, a page reload, rehearsing "Reset demo" a few
 * times. The key itself is a long random secret (see .env's OPS_ACCESS_KEY),
 * so this ceiling is about absorbing real re-auth traffic, not the thing
 * standing between an attacker and the key — 15/min is still nowhere near
 * enough attempts to brute-force it either way.
 */
export async function POST(req: NextRequest) {
  const limited = checkRateLimit(req, 'ops-login', { capacity: 15, refillPerMinute: 15 });
  if (!limited.allowed) {
    return NextResponse.json({ error: 'too many attempts, try again shortly' }, { status: 429 });
  }

  const body = (await req.json().catch(() => null)) as { key?: unknown } | null;
  if (typeof body?.key !== 'string' || !body.key) {
    return NextResponse.json({ error: 'operator key is required' }, { status: 400 });
  }

  if (!verifyOpsKey(body.key)) {
    return NextResponse.json({ error: 'incorrect operator key' }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  setOpsSessionCookie(res);
  return res;
}
