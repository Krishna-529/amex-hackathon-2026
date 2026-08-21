import { NextRequest, NextResponse } from 'next/server';
import { resolveTask, getRecoveryView, type ResolveAction } from '@/server/engine/simulation';
import { requireSession } from '@/server/auth/guard';
import { isSameOriginRequest } from '@/server/auth/csrf';

// The single most important auth fix in this codebase: this endpoint approves
// spend. `passengerId` used to arrive in the request body — anyone could
// approve anyone's booking. It now comes ONLY from the signed-in session.
//
// CSRF check added 2026-08-21: this literally approves spend, so it's the
// route the sameSite=lax cookie default alone was weakest protection for.
export async function POST(req: NextRequest, { params }: { params: Promise<{ flightId: string }> }) {
  const g = await requireSession(req);
  if ('response' in g) return g.response;
  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ error: 'cross-site request rejected' }, { status: 403 });
  }

  const { flightId } = await params;
  const body = (await req.json().catch(() => null)) as { action?: ResolveAction } | null;
  const kind = body?.action?.kind;
  const validKinds = ['approve', 'hand-over', 'browse', 'back', 'choose', 'swap-hotel', 'swap-cab'];
  if (!body?.action || typeof kind !== 'string' || !validKinds.includes(kind)) {
    return NextResponse.json({ error: 'a valid action is required' }, { status: 400 });
  }
  const task = await resolveTask(flightId, g.passenger.id, body.action);
  if (!task) return NextResponse.json({ error: 'no recovery task for this passenger' }, { status: 404 });
  return NextResponse.json(await getRecoveryView(flightId, g.passenger.id));
}
