import { NextRequest, NextResponse } from 'next/server';
import * as store from '@/server/domain/store';
import { requireSelf } from '@/server/auth/guard';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = requireSelf(req, id);
  if ('response' in g) return g.response;
  return NextResponse.json(g.passenger);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = requireSelf(req, id);
  if ('response' in g) return g.response;
  const body = (await req.json()) as { consent: 'autopilot' | 'ask' };
  const p = store.updateConsent(id, body.consent)!;
  return NextResponse.json({ id: p.id, displayName: p.displayName, consent: p.consent });
}
