import { NextRequest, NextResponse } from 'next/server';
import { refreshAlts } from '@/server/engine/altsCache';
import { refreshGround } from '@/server/engine/groundCache';
import { requireSession } from '@/server/auth/guard';
import { opsSessionFrom } from '@/server/auth/opsSession';
import * as store from '@/server/domain/store';

/**
 * Force-warms a flight's alt/hotel/cab candidates from real supplier search,
 * unconditionally — the same real code path server/engine/forecast.ts's
 * `triggerAltPrefetchIfWarranted` calls, just without waiting for the real
 * ML risk-scoring service to cross the prefetch threshold first. In normal
 * operation that gate is the point (it's the whole reason the per-route
 * coordinator exists — search once the flight is actually worth searching
 * for, not on every page view), but a demo or a member manually checking
 * "what would you rebook me onto right now" shouldn't have to wait on the
 * scorer being up. The /ops console's "Warm candidates" action calls this.
 *
 * Ownership check added 2026-08-21: `requireSession` alone let any signed-in
 * member force a real (budget-consuming) supplier search against any flight
 * id, not only their own. An operator session (the /ops caller) still passes
 * unconditionally, matching the pattern `report-cancellation` already
 * established for the member-self-service case.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireSession(req);
  if ('response' in g) return g.response;

  const { id } = await params;
  const flight = await store.getFlight(id);
  if (!flight) return NextResponse.json({ error: 'flight not found' }, { status: 404 });

  if (!opsSessionFrom(req)) {
    const bookings = await store.getBookingsForFlight(id);
    const own = bookings.find((b) => b.passengerId === g.passenger.id);
    if (!own) {
      return NextResponse.json({ error: 'you do not have a booking on this flight' }, { status: 403 });
    }
  }

  await Promise.all([refreshAlts(id), refreshGround(id)]);
  const warmed = await store.getFlight(id);
  return NextResponse.json({ candidates: warmed?.candidates ?? flight.candidates });
}
