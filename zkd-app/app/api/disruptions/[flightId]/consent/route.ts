import { NextRequest, NextResponse } from 'next/server';
import { resolveTask, getRecoveryView, type ResolveAction } from '@/server/engine/simulation';

export async function POST(req: NextRequest, { params }: { params: Promise<{ flightId: string }> }) {
  const { flightId } = await params;
  const body = (await req.json()) as { passengerId: string; action: ResolveAction };
  const task = resolveTask(flightId, body.passengerId, body.action);
  if (!task) return NextResponse.json({ error: 'no recovery task for this passenger' }, { status: 404 });
  return NextResponse.json(getRecoveryView(flightId, body.passengerId));
}
