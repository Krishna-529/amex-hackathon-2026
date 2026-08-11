import { NextResponse } from 'next/server';
import * as store from '@/server/domain/store';
import { ensureSeeded } from '@/server/domain/seed';

export async function GET() {
  ensureSeeded();
  return NextResponse.json(
    store.listPassengers().map((p) => ({ id: p.id, displayName: p.displayName, consent: p.consent })),
  );
}
