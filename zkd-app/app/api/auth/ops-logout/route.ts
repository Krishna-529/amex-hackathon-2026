import { NextResponse } from 'next/server';
import { clearOpsSessionCookie } from '@/server/auth/opsSession';

export async function POST() {
  const res = NextResponse.json({ ok: true });
  clearOpsSessionCookie(res);
  return res;
}
