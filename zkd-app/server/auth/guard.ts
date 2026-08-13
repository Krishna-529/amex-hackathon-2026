/**
 * The one place a route handler turns "whoever the cookie says" into "the
 * actual Passenger to act as". Every protected route calls one of these
 * instead of trusting a body/query passengerId — that is the whole fix.
 */
import { NextResponse, type NextRequest } from 'next/server';
import * as store from '@/server/domain/store';
import { ensureSeeded } from '@/server/domain/seed';
import { sessionFrom } from './session';
import type { Passenger } from '@/server/domain/types';

export type Guard = { passenger: Passenger } | { response: NextResponse };

function unauthorized(): Guard {
  return { response: NextResponse.json({ error: 'not signed in' }, { status: 401 }) };
}

function forbidden(): Guard {
  return { response: NextResponse.json({ error: 'not your account' }, { status: 403 }) };
}

/** Session cookie -> the signed-in Passenger. 401 when absent, forged, expired,
 *  or pointing at a passenger the store no longer has (e.g. a dev restart). */
export function requireSession(req: NextRequest): Guard {
  ensureSeeded();
  const session = sessionFrom(req);
  if (!session) return unauthorized();
  const passenger = store.getPassenger(session.pid);
  if (!passenger) return unauthorized();
  return { passenger };
}

/** requireSession, and the session must BE `id`. 403 (not 401) when it is
 *  someone else, so "signed in as the wrong person" stays distinguishable
 *  from "not signed in at all" in the network tab. */
export function requireSelf(req: NextRequest, id: string): Guard {
  const g = requireSession(req);
  if ('response' in g) return g;
  if (g.passenger.id !== id) return forbidden();
  return g;
}
