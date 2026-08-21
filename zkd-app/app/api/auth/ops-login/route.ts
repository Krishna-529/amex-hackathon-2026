import { NextRequest, NextResponse } from 'next/server';
import { verifyOpsKey, setOpsSessionCookie } from '@/server/auth/opsSession';

/**
 * The operator console's own sign-in — separate credential, separate cookie
 * from a member's session (see opsSession.ts's header for why this exists).
 * No rate limiting here yet (tracked alongside the broader rate-limiting gap
 * this session's audit found across the whole app) — flagged, not silently
 * assumed safe.
 */
export async function POST(req: NextRequest) {
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
