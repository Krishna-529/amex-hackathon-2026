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
export type OperatorGuard = { operator: true } | { response: NextResponse };

function unauthorized(): { response: NextResponse } {
  return { response: NextResponse.json({ error: 'not signed in' }, { status: 401 }) };
}

function forbidden(): { response: NextResponse } {
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

/** The /ops console's auth boundary. Every route /ops drives that can trigger
 *  a disruption, create a flight, or otherwise mutate shared state must call
 *  this — see server/auth/opsSession.ts for why "no per-user account" had
 *  drifted into "no auth at all" on those routes. */
export async function requireOperator(req: NextRequest): Promise<OperatorGuard> {
  const session = opsSessionFrom(req);
  if (!session) return unauthorized();
  return { operator: true };
}

/** Some routes (e.g. warm-candidates) are legitimately called by either a
 *  signed-in member acting on their own flight, or the /ops console acting
 *  as an operator. Accept either rather than forcing one auth model on both
 *  callers. */
export async function requireSessionOrOperator(req: NextRequest): Promise<Guard | OperatorGuard> {
  const opSession = opsSessionFrom(req);
  if (opSession) return { operator: true };
  return requireSession(req);
}
