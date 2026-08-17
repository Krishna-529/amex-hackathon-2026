import { NextRequest, NextResponse } from 'next/server';
import { checkOpsAccessKey, setOpsSessionCookie } from '@/server/auth/opsSession';
import { checkRateLimit } from '@/server/rateLimit';

export async function POST(req: NextRequest) {
  // Brute-force defense: the operator key is a single shared secret (unlike
  // a member password, there's no per-account lockout to fall back on), so
  // this is the one login route where a tight IP-scoped limit matters most.
  const limited = checkRateLimit(req, 'ops-login', { capacity: 5, refillPerMinute: 5 });
  if (!limited.allowed) {
    return NextResponse.json({ error: 'too many attempts, try again shortly' }, { status: 429 });
  }

  const body = (await req.json().catch(() => null)) as { key?: unknown } | null;
  if (typeof body?.key !== 'string' || !body.key) {
    return NextResponse.json({ error: 'operator key is required' }, { status: 400 });
  }

  if (!checkOpsAccessKey(body.key)) {
    return NextResponse.json({ error: 'incorrect operator key' }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  setOpsSessionCookie(res);
  return res;
}
