import { NextRequest, NextResponse } from 'next/server';
import { clearSessionCookie } from '@/server/auth/session';

// POST, not GET — a prefetched <Link> or a crawler must not be able to sign
// a member out just by requesting the URL.
export async function POST(req: NextRequest) {
  const res = NextResponse.json({ ok: true });
  clearSessionCookie(res, req);
  return res;
}
