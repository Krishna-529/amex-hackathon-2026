import { NextRequest, NextResponse } from 'next/server';
import * as store from '@/server/domain/store';
import { ensureSeeded } from '@/server/domain/seed';
import type { PreAuthRequest, PreAuthResponse } from '@/lib/apiTypes';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  ensureSeeded();
  const { id } = await params;
  const passengerId = req.nextUrl.searchParams.get('passengerId') ?? '';
  const rec = store.getPreAuth(id, passengerId) ?? null;
  return NextResponse.json(rec as PreAuthResponse);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  ensureSeeded();
  const { id } = await params;
  const body = (await req.json()) as PreAuthRequest;
  const flight = store.getFlight(id);
  if (!flight) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const alt = flight.candidates.alts.find((a) => a.id === body.altId);
  const hotel = flight.candidates.hotels.find((h) => h.id === body.hotelId);
  const cab = flight.candidates.cabs.find((c) => c.id === body.cabId);
  const hotelCost = hotel ? hotel.extra || hotel.rate : 0;
  const owed = (alt?.fare ?? 0) + hotelCost + (cab?.extra ?? 0);

  const rec = {
    flightId: id, passengerId: body.passengerId, altId: body.altId, hotelId: body.hotelId, cabId: body.cabId,
    owed, grantedAt: Date.now(),
  };
  store.setPreAuth(rec);
  return NextResponse.json(rec as PreAuthResponse);
}
