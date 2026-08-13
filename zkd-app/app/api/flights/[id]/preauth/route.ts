import { NextRequest, NextResponse } from 'next/server';
import * as store from '@/server/domain/store';
import { costFor } from '@/server/domain/pricing';
import { DEFAULT_PER_TRANSACTION_CAP } from '@/server/myca';
import { requireSession } from '@/server/auth/guard';
import type { PreAuthRequest, PreAuthResponse } from '@/lib/apiTypes';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = requireSession(req);
  if ('response' in g) return g.response;
  const { id } = await params;
  const rec = store.getPreAuth(id, g.passenger.id) ?? null;
  return NextResponse.json(rec as PreAuthResponse);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = requireSession(req);
  if ('response' in g) return g.response;

  const { id } = await params;
  const body = (await req.json()) as PreAuthRequest;
  const flight = store.getFlight(id);
  if (!flight) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const booking = store.getBookingsForFlight(id).find((b) => b.passengerId === g.passenger.id);
  const partySize = booking ? store.partySize(booking) : 1;
  // Same shared calculation the recovery engine uses, so a pre-authorised
  // amount can never disagree with what the same plan would cost if the
  // window ran unanswered — see server/domain/pricing.ts.
  const { total: owed } = costFor(
    flight,
    { chosenAltId: body.altId, chosenHotelId: body.hotelId, chosenCabId: body.cabId },
    partySize,
    DEFAULT_PER_TRANSACTION_CAP,
  );

  const rec = {
    flightId: id, passengerId: g.passenger.id, altId: body.altId, hotelId: body.hotelId, cabId: body.cabId,
    owed, grantedAt: Date.now(),
  };
  store.setPreAuth(rec);
  return NextResponse.json(rec as PreAuthResponse);
}
