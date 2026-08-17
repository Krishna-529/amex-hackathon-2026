import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/server/auth/guard';
import { snapshot, replan } from '@/server/pipeline';
import * as store from '@/server/domain/store';

/**
 * One passenger's pipeline run.
 *
 * Guarded, and returns **only the caller's own run** — the same privacy rule
 * server/domain/views.ts:toFlightDetail enforces. `middleware.ts` excludes
 * /api, so the guard has to be called here; there is no ambient protection.
 *
 * `?since=` is a cursor into the append-only journal, so a device polling this
 * asks only for what it has not seen. That is safe precisely because the
 * journal is append-only — events are never removed or reordered, so an index
 * remains a valid cursor for the life of the run.
 *
 * This is a debug and ops surface, not the member's path. The recovery page
 * gets its pipeline summary inside RecoveryView at 1500ms rather than polling
 * here as well.
 */

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ flightId: string }> }) {
  const g = await requireSession(req);
  if ('response' in g) return g.response;

  const { flightId } = await params;
  const since = Number(req.nextUrl.searchParams.get('since') ?? '0');

  const run = store.getPipelineRun(flightId, g.passenger.id);
  if (!run) {
    return NextResponse.json({ error: 'no pipeline run for you on this flight' }, { status: 404 });
  }

  return NextResponse.json(snapshot(run, Number.isFinite(since) ? since : 0));
}

/**
 * Ask for a fresher set of options.
 *
 * Bounded by MAX_REPLANS inside the pipeline — an unbounded re-plan loop
 * against a thin market is a way to burn a free tier without ever converging.
 * Returns 409 rather than 500 when refused: being out of re-plans is a state
 * the caller should handle, not an error.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ flightId: string }> }) {
  const g = await requireSession(req);
  if ('response' in g) return g.response;

  const { flightId } = await params;
  const body = (await req.json().catch(() => ({}))) as { action?: string };
  if (body.action !== 'replan') {
    return NextResponse.json({ error: "action must be 'replan'" }, { status: 400 });
  }

  const ok = await replan(flightId, g.passenger.id);
  const run = store.getPipelineRun(flightId, g.passenger.id);
  if (!run) return NextResponse.json({ error: 'no pipeline run' }, { status: 404 });

  return NextResponse.json(snapshot(run), { status: ok ? 200 : 409 });
}
