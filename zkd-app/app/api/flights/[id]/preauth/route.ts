import { NextRequest, NextResponse } from 'next/server';
import * as store from '@/server/domain/store';
import { costFor } from '@/server/domain/pricing';
import { BILLING_CURRENCY } from '@/server/myca';
import { requireSession } from '@/server/auth/guard';
import { isSameOriginRequest } from '@/server/auth/csrf';
import type { PreAuthRequest, PreAuthResponse } from '@/lib/apiTypes';
import { parseJsonBody, isNonEmptyString } from '@/server/jsonBody';

/** Only the alternative is mandatory. Hotel and cab are optional add-ons to the
 *  pre-authorised plan (the detail screen offers no picker for them), so each
 *  must be either a non-empty string or explicitly null — anything else is a
 *  malformed body. */
function isNullableString(v: unknown): v is string | null {
  return v === null || isNonEmptyString(v);
}
function isPreAuthBody(v: unknown): v is PreAuthRequest {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return isNonEmptyString(o.altId) && isNullableString(o.hotelId) && isNullableString(o.cabId);
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireSession(req);
  if ('response' in g) return g.response;
  const { id } = await params;
  const rec = (await store.getPreAuth(id, g.passenger.id)) ?? null;
  return NextResponse.json(rec as PreAuthResponse);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireSession(req);
  if ('response' in g) return g.response;
  // CSRF check added 2026-08-21 — this pre-authorises a real spend amount.
  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ error: 'cross-site request rejected' }, { status: 403 });
  }

  const { id } = await params;
  const parsed = await parseJsonBody(req, isPreAuthBody);
  if ('response' in parsed) return parsed.response;
  const body = parsed.body;
  const flight = await store.getFlight(id);
  if (!flight) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const bookings = await store.getBookingsForFlight(id);
  const booking = bookings.find((b) => b.passengerId === g.passenger.id);
  const partySize = booking ? store.partySize(booking) : 1;
  // Same shared calculation the recovery engine uses, so a pre-authorised
  // amount can never disagree with what the same plan would cost if the
  // window ran unanswered — see server/domain/pricing.ts.
  const { total: owed } = costFor(
    flight,
    { chosenAltId: body.altId, chosenHotelId: body.hotelId, chosenCabId: body.cabId },
    partySize,
    BILLING_CURRENCY,
  );

  const rec = {
    flightId: id, passengerId: g.passenger.id, altId: body.altId, hotelId: body.hotelId, cabId: body.cabId,
    owed, grantedAt: Date.now(),
  };
  await store.setPreAuth(rec);
  return NextResponse.json(rec as PreAuthResponse);
}
