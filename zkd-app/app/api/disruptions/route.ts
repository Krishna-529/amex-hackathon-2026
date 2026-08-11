import { NextRequest, NextResponse } from 'next/server';
import * as store from '@/server/domain/store';
import { ensureSeeded } from '@/server/domain/seed';
import { toDisruptionOpsView } from '@/server/domain/views';
import { detectDisruption } from '@/server/engine/simulation';

export async function GET() {
  ensureSeeded();
  const views = store.listDisruptionEvents()
    .map((e) => toDisruptionOpsView(e.flightId))
    .filter((v) => v !== null);
  return NextResponse.json(views);
}

export async function POST(req: NextRequest) {
  ensureSeeded();
  const body = (await req.json()) as { flightId: string };
  const event = detectDisruption(body.flightId);
  if (!event) return NextResponse.json({ error: 'flight not found' }, { status: 404 });
  return NextResponse.json(event);
}
