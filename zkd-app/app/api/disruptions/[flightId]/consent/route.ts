import { NextRequest, NextResponse } from 'next/server';
import { resolveTask, getRecoveryView, isResolveAction, type ResolveAction } from '@/server/engine/simulation';
import { requireSession } from '@/server/auth/guard';
import { parseJsonBody } from '@/server/jsonBody';

// The single most important auth fix in this codebase: this endpoint approves
// spend. `passengerId` used to arrive in the request body — anyone could
// approve anyone's booking. It now comes ONLY from the signed-in session.
function isActionBody(v: unknown): v is { action: ResolveAction } {
  return typeof v === 'object' && v !== null && isResolveAction((v as { action?: unknown }).action);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ flightId: string }> }) {
  const g = await requireSession(req);
  if ('response' in g) return g.response;

  const { flightId } = await params;
  // Validated, not cast. The session already decides *who* may approve; this
  // decides *what* they actually asked for, so a malformed body is a 400 rather
  // than an undefined `action.kind` falling through resolveTask's switch.
  const parsed = await parseJsonBody(req, isActionBody);
  if ('response' in parsed) return parsed.response;

  const task = await resolveTask(flightId, g.passenger.id, parsed.body.action);
  if (!task) return NextResponse.json({ error: 'no recovery task for this passenger' }, { status: 404 });
  return NextResponse.json(await getRecoveryView(flightId, g.passenger.id));
}
