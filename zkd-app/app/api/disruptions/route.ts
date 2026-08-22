import { NextRequest, NextResponse } from 'next/server';
import * as store from '@/server/domain/store';
import { ensureSeeded } from '@/server/domain/seed';
import { toDisruptionOpsView } from '@/server/domain/views';
import { detectDisruption } from '@/server/engine/simulation';
import { requireOperator } from '@/server/auth/guard';
import { isSameOriginRequest } from '@/server/auth/csrf';
import { checkRateLimit } from '@/server/rateLimit';

/**
 * The operator console's own disruption feed and manual trigger. `requireOperator`
 * on both verbs — fixed 2026-08-21, was a real critical gap. GET returned real
 * passenger names and owed-dollar-amounts (`toDisruptionOpsView`) to any
 * anonymous request; POST let anyone on the internet trigger `detectDisruption`
 * on any real flight id (discoverable from `GET /api/flights`, also
 * unauthenticated by design), which fans out to every passenger booked on that
 * flight and, for anyone on autopilot consent or with an intact pre-auth, acts
 * IMMEDIATELY — no confirmation window, and (per `server/domain/pricing.ts`'s
 * own header) no dollar ceiling either, since the per-transaction cap was
 * deliberately removed 2026-08-19. The only caller of this route anywhere in
 * the app is `app/ops/page.tsx` (verified: `grep` across `app/`/`components/`
 * for `api/disruptions'` finds nothing else) — it was never meant to be a
 * member-reachable or public endpoint.
 */
export async function GET(req: NextRequest) {
  const g = await requireOperator(req);
  if ('response' in g) return g.response;

  await ensureSeeded();
  const events = await store.listDisruptionEvents();
  const views = (
    await Promise.all(events.map((e) => toDisruptionOpsView(e.flightId)))
  ).filter((v) => v !== null);
  return NextResponse.json(views);
}

export async function POST(req: NextRequest) {
  const g = await requireOperator(req);
  if ('response' in g) return g.response;
  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ error: 'cross-site request rejected' }, { status: 403 });
  }

  // This is the entry point a live status feed would call automatically —
  // it drives the entire recovery/booking pipeline, including real supplier
  // calls downstream. Rate-limited even behind operator auth (2026-08-21) so
  // a stuck demo script, or a compromised operator credential, can't hammer
  // it: 20 burst / 20-per-minute.
  const limited = checkRateLimit(req, 'disruption-trigger', { capacity: 20, refillPerMinute: 20 });
  if (!limited.allowed) {
    return NextResponse.json({ error: 'too many requests, try again shortly' }, { status: 429 });
  }

  await ensureSeeded();
  const body = (await req.json().catch(() => null)) as { flightId?: unknown } | null;
  if (typeof body?.flightId !== 'string' || !body.flightId) {
    return NextResponse.json({ error: 'flightId is required' }, { status: 400 });
  }

  const event = await detectDisruption(body.flightId);
  if (!event) return NextResponse.json({ error: 'flight not found' }, { status: 404 });
  return NextResponse.json(event);
}
