import { NextRequest, NextResponse } from 'next/server';
import * as store from '@/server/domain/store';
import { ensureSeeded } from '@/server/domain/seed';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  ensureSeeded();
  const { id } = await params;
  const p = store.getPassenger(id);
  if (!p) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(p);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  ensureSeeded();
  const { id } = await params;
  const body = (await req.json()) as { consent: 'autopilot' | 'ask' };
  const p = store.updateConsent(id, body.consent);
  if (!p) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ id: p.id, displayName: p.displayName, consent: p.consent });
}
