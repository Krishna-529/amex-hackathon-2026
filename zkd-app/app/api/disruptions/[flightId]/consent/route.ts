import { NextRequest, NextResponse } from 'next/server';
import { resolveTask, getRecoveryView, type ResolveAction } from '@/server/engine/simulation';
import { requireSession } from '@/server/auth/guard';
import { isSameOriginRequest } from '@/server/auth/csrf';
import { parseJsonBody, isNonEmptyString } from '@/server/jsonBody';

const SIMPLE_KINDS = new Set(['approve', 'hand-over', 'browse', 'back']);

function isResolveBody(v: unknown): v is { action: ResolveAction } {
  if (typeof v !== 'object' || v === null) return false;
  const action = (v as { action?: unknown }).action;
  if (typeof action !== 'object' || action === null) return false;
  const a = action as Record<string, unknown>;
  if (typeof a.kind !== 'string') return false;
  if (SIMPLE_KINDS.has(a.kind)) return true;
  if (a.kind === 'choose') return isNonEmptyString(a.altId);
  if (a.kind === 'swap-hotel') return isNonEmptyString(a.hotelId);
  if (a.kind === 'swap-cab') return isNonEmptyString(a.cabId);
  return false;
}

// The single most important auth fix in this codebase: this endpoint approves
// spend. `passengerId` used to arrive in the request body — anyone could
// approve anyone's booking. It now comes ONLY from the signed-in session.
export async function POST(req: NextRequest, { params }: { params: Promise<{ flightId: string }> }) {
  const g = await requireSession(req);
  if ('response' in g) return g.response;
  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ error: 'cross-site request rejected' }, { status: 403 });
  }

  const { flightId } = await params;
  const parsed = await parseJsonBody(req, isResolveBody);
  if ('response' in parsed) return parsed.response;
  const task = await resolveTask(flightId, g.passenger.id, parsed.body.action);
  if (!task) return NextResponse.json({ error: 'no recovery task for this passenger' }, { status: 404 });
  return NextResponse.json(await getRecoveryView(flightId, g.passenger.id));
}
