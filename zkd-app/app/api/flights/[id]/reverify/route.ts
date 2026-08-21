import { NextRequest, NextResponse } from 'next/server';
import { reverify } from '@/server/engine/forecast';
import { requireSession } from '@/server/auth/guard';
import { opsSessionFrom } from '@/server/auth/opsSession';
import * as store from '@/server/domain/store';

/**
 * The audit "reverify" action — forces an immediate real re-score (never a
 * cached read) and reports how it compares to what was last shown. See
 * server/engine/forecast.ts's reverify() for what "flagged" means.
 *
 * Ownership check added 2026-08-21: `requireSession` alone let any signed-in
 * member force a real, costed re-score against any flight id, not only their
 * own. An operator session passes unconditionally.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireSession(req);
  if ('response' in g) return g.response;

  const { id } = await params;

  if (!opsSessionFrom(req)) {
    const bookings = await store.getBookingsForFlight(id);
    const own = bookings.find((b) => b.passengerId === g.passenger.id);
    if (!own) {
      return NextResponse.json({ error: 'you do not have a booking on this flight' }, { status: 403 });
    }
  }

  const result = await reverify(id);
  if (!result) return NextResponse.json({ error: 'flight not found or model unreachable' }, { status: 404 });
  return NextResponse.json(result);
}
