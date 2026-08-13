import { NextRequest, NextResponse } from 'next/server';
import { getRecoveryView } from '@/server/engine/simulation';
import { requireSession } from '@/server/auth/guard';

export async function GET(req: NextRequest, { params }: { params: Promise<{ flightId: string }> }) {
  const g = requireSession(req);
  if ('response' in g) return g.response;
  const { flightId } = await params;
  const view = getRecoveryView(flightId, g.passenger.id);
  if (!view) return NextResponse.json({ error: 'no disruption or no booking for this passenger' }, { status: 404 });
  return NextResponse.json(view);
}
