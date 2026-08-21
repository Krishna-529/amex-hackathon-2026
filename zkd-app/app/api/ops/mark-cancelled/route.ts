import { NextRequest, NextResponse } from 'next/server';
import * as store from '@/server/domain/store';
import { requireSession } from '@/server/auth/guard';

/**
 * DEMO / operator control — mark a flight cancelled IN OUR DATA without starting
 * a recovery. This is the ground truth a member's "this flight was cancelled"
 * report is checked against: with this set, the report is corroborated and we
 * start rebooking; without it, the report is answered "we checked, it is not
 * cancelled" plus a helpline. Contrast the /ops "Trigger" button (POST
 * /api/disruptions), which cancels AND kicks off the recovery immediately.
 * Cleared by "Reset demo".
 */
export async function POST(req: NextRequest) {
  const g = await requireSession(req);
  if ('response' in g) return g.response;

  const body = (await req.json().catch(() => ({}))) as { flightId?: unknown; cancelled?: unknown };
  if (typeof body.flightId !== 'string' || body.flightId.length === 0) {
    return NextResponse.json({ error: 'flightId required' }, { status: 400 });
  }
  const cancelled = body.cancelled === undefined ? true : body.cancelled === true;

  const flight = await store.getFlight(body.flightId);
  if (!flight) return NextResponse.json({ error: 'flight not found' }, { status: 404 });

  flight.cancelledInData = cancelled;
  await store.createFlight(flight);

  return NextResponse.json({ ok: true, flightId: flight.id, cancelledInData: cancelled });
}
