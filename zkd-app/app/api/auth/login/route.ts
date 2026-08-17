import { NextRequest, NextResponse } from 'next/server';
import * as store from '@/server/domain/store';
import { ensureSeeded } from '@/server/domain/seed';
import { verifyPassword, DUMMY_HASH } from '@/server/auth/passwords';
import { setSessionCookie } from '@/server/auth/session';

export async function POST(req: NextRequest) {
  await ensureSeeded();
  const body = (await req.json().catch(() => null)) as { email?: unknown; password?: unknown } | null;

  if (typeof body?.email !== 'string' || typeof body?.password !== 'string' || !body.email || !body.password) {
    return NextResponse.json({ error: 'email and password are required' }, { status: 400 });
  }

  const cred = await store.findCredentialByEmail(body.email);
  // Verify against a real hash even on an unknown email, so the response time
  // for "no such account" is indistinguishable from "wrong password" — a fast
  // 401 on unknown emails would let an attacker enumerate accounts by timing.
  const ok = verifyPassword(body.password, cred?.passwordHash ?? DUMMY_HASH);

  if (!cred || !ok) {
    return NextResponse.json({ error: 'Those details do not match an account.' }, { status: 401 });
  }

  const passenger = await store.getPassenger(cred.passengerId);
  if (!passenger) {
    return NextResponse.json({ error: 'Those details do not match an account.' }, { status: 401 });
  }

  const res = NextResponse.json({ id: passenger.id, displayName: passenger.displayName, consent: passenger.consent });
  setSessionCookie(res, passenger.id);
  return res;
}
