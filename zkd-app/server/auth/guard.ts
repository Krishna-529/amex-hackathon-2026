/**
 * The one place a route handler turns "whoever the cookie says" into "the
 * actual Passenger to act as". Every protected route calls one of these
 * instead of trusting a body/query passengerId — that is the whole fix.
 */
import { NextResponse, type NextRequest } from 'next/server';
import * as store from '@/server/domain/store';
import { ensureSeeded } from '@/server/domain/seed';
import { sessionFrom } from './session';
import { opsSessionFrom } from './opsSession';
import type { Passenger } from '@/server/domain/types';

export type Guard = { passenger: Passenger } | { response: NextResponse };
export type OpsGuard = { ok: true } | { response: NextResponse };

function unauthorized(): Guard {
  return { response: NextResponse.json({ error: 'not signed in' }, { status: 401 }) };
}

function forbidden(): Guard {
  return { response: NextResponse.json({ error: 'not your account' }, { status: 403 }) };
}

/** Session cookie -> the signed-in Passenger. 401 when absent, forged, expired,
 *  or pointing at a passenger the store no longer has (e.g. a dev restart). */
export async function requireSession(req: NextRequest): Promise<Guard> {
  await ensureSeeded();
  const session = sessionFrom(req);
  if (!session) return unauthorized();
  const passenger = await store.getPassenger(session.pid);
  if (!passenger) return unauthorized();
  return { passenger };
}

/** requireSession, and the session must BE `id`. 403 (not 401) when it is
 *  someone else, so "signed in as the wrong person" stays distinguishable
 *  from "not signed in at all" in the network tab. */
export async function requireSelf(req: NextRequest, id: string): Promise<Guard> {
  const g = await requireSession(req);
  if ('response' in g) return g;
  if (g.passenger.id !== id) return forbidden();
  return g;
}

/**
 * The operator boundary — deliberately NOT `requireSession`. A signed-in
 * member is not an operator; conflating the two is the exact gap this
 * function closes (see `opsSession.ts`'s header for what was reachable
 * without it). Every `/ops`-mutating route and the `/api/disruptions`
 * manual-trigger route (its only caller is the `/ops` console) must use
 * this, not `requireSession`.
 */
export async function requireOperator(req: NextRequest): Promise<OpsGuard> {
  const session = opsSessionFrom(req);
  if (!session) {
    return { response: NextResponse.json({ error: 'operator sign-in required' }, { status: 401 }) };
  }
  return { ok: true };
}
