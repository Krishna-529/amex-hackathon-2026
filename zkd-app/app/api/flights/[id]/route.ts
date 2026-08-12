import { NextResponse } from 'next/server';
import * as store from '@/server/domain/store';
import { ensureSeeded } from '@/server/domain/seed';
import { toFlightDetail } from '@/server/domain/views';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  ensureSeeded();
  const { id } = await params;
  const flight = store.getFlight(id);
  if (!flight) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(toFlightDetail(flight));
}
