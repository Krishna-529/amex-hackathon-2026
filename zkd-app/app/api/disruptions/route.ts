import { NextRequest, NextResponse } from 'next/server';
import * as store from '@/server/domain/store';
import { ensureSeeded } from '@/server/domain/seed';
import { toDisruptionOpsView } from '@/server/domain/views';
import { detectDisruption } from '@/server/engine/simulation';
import { parseJsonBody, isNonEmptyString } from '@/server/jsonBody';
import { requireOperator } from '@/server/auth/guard';
import { isSameOriginRequest } from '@/server/auth/csrf';
import { checkRateLimit } from '@/server/rateLimit';

export async function GET(req: NextRequest) {
  const g = await requireOperator(req);
  if ('response' in g) return g.response;

  await ensureSeeded();
  const events = await store.listDisruptionEvents();
  const views = (await Promise.all(events.map((e) => toDisruptionOpsView(e.flightId))))
    .filter((v) => v !== null);
  return NextResponse.json(views);
}

function isDetectBody(v: unknown): v is { flightId: string } {
  return typeof v === 'object' && v !== null && isNonEmptyString((v as { flightId?: unknown }).flightId);
}

export async function POST(req: NextRequest) {
  const g = await requireOperator(req);
  if ('response' in g) return g.response;
  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ error: 'cross-site request rejected' }, { status: 403 });
  }

  // This is the entry point a live status feed would call automatically —
  // it drives the entire recovery/booking pipeline, including real supplier
  // calls downstream. Rate-limit it even behind operator auth so a stuck
  // demo script (or a compromised operator credential) can't hammer it.
  const limited = checkRateLimit(req, 'disruption-trigger', { capacity: 20, refillPerMinute: 20 });
  if (!limited.allowed) {
    return NextResponse.json({ error: 'too many requests, try again shortly' }, { status: 429 });
  }

  await ensureSeeded();
  const parsed = await parseJsonBody(req, isDetectBody);
  if ('response' in parsed) return parsed.response;
  const event = await detectDisruption(parsed.body.flightId);
  if (!event) return NextResponse.json({ error: 'flight not found' }, { status: 404 });
  return NextResponse.json(event);
}
