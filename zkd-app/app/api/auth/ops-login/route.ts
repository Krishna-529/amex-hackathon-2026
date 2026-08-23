import { NextRequest, NextResponse } from 'next/server';
import { verifyOpsKey, setOpsSessionCookie } from '@/server/auth/opsSession';
import { checkRateLimit } from '@/server/rateLimit';

/**
 * The operator console's own sign-in — separate credential, separate cookie
 * from a member's session (see opsSession.ts's header for why this exists).
 *
 * Rate-limited 2026-08-21: the operator key is a single shared secret —
 * unlike a member password, there's no per-account lockout to fall back on
 * — so this is the one login route where a tight limit matters most. 5
 * burst / 5-per-minute.
 */
export async function POST(req: NextRequest) {
  const limited = checkRateLimit(req, 'ops-login', { capacity: 5, refillPerMinute: 5 });
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
  setOpsSessionCookie(res, req);
  return res;
}
