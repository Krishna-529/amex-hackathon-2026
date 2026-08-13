import { NextRequest, NextResponse } from 'next/server';
import { resolveTask, getRecoveryView, type ResolveAction } from '@/server/engine/simulation';
import { requireSession } from '@/server/auth/guard';

// The single most important auth fix in this codebase: this endpoint approves
// spend. `passengerId` used to arrive in the request body — anyone could
// approve anyone's booking. It now comes ONLY from the signed-in session.
export async function POST(req: NextRequest, { params }: { params: Promise<{ flightId: string }> }) {
  const g = requireSession(req);
  if ('response' in g) return g.response;

  const { flightId } = await params;
  const body = (await req.json()) as { action: ResolveAction };
  const task = await resolveTask(flightId, g.passenger.id, body.action);
  if (!task) return NextResponse.json({ error: 'no recovery task for this passenger' }, { status: 404 });
  return NextResponse.json(getRecoveryView(flightId, g.passenger.id));
}
