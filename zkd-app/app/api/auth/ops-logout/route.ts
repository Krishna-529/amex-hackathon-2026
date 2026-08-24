import { NextRequest, NextResponse } from 'next/server';
import { clearOpsSessionCookie } from '@/server/auth/opsSession';

export async function POST(req: NextRequest) {
  const res = NextResponse.json({ ok: true });
  clearOpsSessionCookie(res, req);
  return res;
}
