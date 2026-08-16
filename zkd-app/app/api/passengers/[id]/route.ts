import { NextRequest, NextResponse } from 'next/server';
import * as store from '@/server/domain/store';
import { requireSelf } from '@/server/auth/guard';
import { parseJsonBody } from '@/server/jsonBody';

function isConsentBody(v: unknown): v is { consent: 'autopilot' | 'ask' } {
  return typeof v === 'object' && v !== null && ((v as { consent?: unknown }).consent === 'autopilot' || (v as { consent?: unknown }).consent === 'ask');
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await requireSelf(req, id);
  if ('response' in g) return g.response;
  return NextResponse.json(g.passenger);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await requireSelf(req, id);
  if ('response' in g) return g.response;
  const parsed = await parseJsonBody(req, isConsentBody);
  if ('response' in parsed) return parsed.response;
  const p = (await store.updateConsent(id, parsed.body.consent))!;
  return NextResponse.json({ id: p.id, displayName: p.displayName, consent: p.consent });
}
