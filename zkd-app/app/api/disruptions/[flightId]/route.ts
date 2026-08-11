import { NextRequest, NextResponse } from 'next/server';
import { getRecoveryView } from '@/server/engine/simulation';

export async function GET(req: NextRequest, { params }: { params: Promise<{ flightId: string }> }) {
  const { flightId } = await params;
  const passengerId = req.nextUrl.searchParams.get('passengerId') ?? '';
  const view = getRecoveryView(flightId, passengerId);
  if (!view) return NextResponse.json({ error: 'no disruption or no booking for this passenger' }, { status: 404 });
  return NextResponse.json(view);
}
