import { NextRequest, NextResponse } from 'next/server';
import * as store from '@/server/domain/store';
import { ensureSeeded } from '@/server/domain/seed';
import { verifyPassword, DUMMY_HASH } from '@/server/auth/passwords';
import { setSessionCookie, signSession } from '@/server/auth/session';
import { checkRateLimit } from '@/server/rateLimit';

export async function POST(req: NextRequest) {
  await ensureSeeded();

  // Added 2026-08-21: the dummy-hash compare below defends against
  // email-enumeration timing, not brute force — without a rate limit, a
  // script can try unlimited password guesses against a known demo email
  // at network speed.
  //
  // Raised 2026-08-22 from 8/8-per-minute: the rate limiter's key is the
  // client IP (server/rateLimit.ts), which collapses to one shared bucket
  // per machine — so signing into several demo accounts across several tabs
  // from one laptop (the exact multi-device convergence demo this app is
  // built to show) could exhaust the old ceiling before a single real
  // mistyped password. 30/30 keeps this a real defense against an automated
  // guessing loop while giving a demo real headroom.
  const limited = checkRateLimit(req, 'login', { capacity: 30, refillPerMinute: 30 });
  if (!limited.allowed) {
    return NextResponse.json({ error: 'too many attempts, try again shortly' }, { status: 429 });
  }

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

  // Signed once, given to both the cookie and the body: sessionToken lets
  // this browser tab (via lib/tabSession.ts) keep acting as this passenger
  // even after a different tab in the same browser signs in as someone else
  // and overwrites the shared cookie — see session.ts's header.
  const token = signSession(passenger.id);
  const res = NextResponse.json({
    id: passenger.id,
    displayName: passenger.displayName,
    consent: passenger.consent,
    sessionToken: token,
  });
  setSessionCookie(res, token);
  return res;
}
