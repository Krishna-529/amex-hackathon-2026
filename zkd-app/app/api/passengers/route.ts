import { NextResponse } from 'next/server';
import * as store from '@/server/domain/store';
import { ensureSeeded } from '@/server/domain/seed';

// Deliberately open and deliberately minimal: /ops has no account of its own
// and needs a picker of who exists. This exposes display names and consent
// tiers to anyone — never a passport, contact detail or PNR — and stays open
// only because /ops needs it.
export async function GET() {
  ensureSeeded();
  return NextResponse.json(
    store.listPassengers().map((p) => ({ id: p.id, displayName: p.displayName, consent: p.consent })),
  );
}
