import { NextRequest, NextResponse } from 'next/server';
import * as store from '@/server/domain/store';
import { ensureSeeded } from '@/server/domain/seed';
import { requireOperator } from '@/server/auth/guard';

// /ops's picker of who exists. Deliberately minimal — display names and
// consent tiers only, never a passport, contact detail or PNR — but "minimal
// payload" isn't a substitute for an auth boundary, so this is gated the
// same as the rest of the operator console.
export async function GET(req: NextRequest) {
  const g = await requireOperator(req);
  if ('response' in g) return g.response;

  await ensureSeeded();
  const passengers = await store.listPassengers();
  return NextResponse.json(
    passengers.map((p) => ({ id: p.id, displayName: p.displayName, consent: p.consent })),
  );
}
