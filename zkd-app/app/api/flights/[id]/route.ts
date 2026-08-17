import { NextRequest, NextResponse } from 'next/server';
import * as store from '@/server/domain/store';
import { toFlightDetail } from '@/server/domain/views';
import { requireSession } from '@/server/auth/guard';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireSession(req);
  if ('response' in g) return g.response;

  const { id } = await params;
  const flight = await store.getFlight(id);
  if (!flight) return NextResponse.json({ error: 'not found' }, { status: 404 });
  // toFlightDetail requires the viewer's id so it can project alts to their
  // party size and filter bookings to their own row — a co-passenger's PNR
  // must never be visible here.
  return NextResponse.json(await toFlightDetail(flight, g.passenger.id));
}
