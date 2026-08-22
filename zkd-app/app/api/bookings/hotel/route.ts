import { NextRequest, NextResponse } from 'next/server';
import * as store from '@/server/domain/store';
import { requireSession } from '@/server/auth/guard';
import { parseJsonBody, isNonEmptyString } from '@/server/jsonBody';
import { airport, cityOf } from '@/server/airportDirectory';
import { isSameOriginRequest } from '@/server/auth/csrf';
import type { Stay } from '@/server/domain/types';

/**
 * The member booking a hotel they found in search.
 *
 * Session-bound, for the same reason POST /api/bookings is: a body-supplied
 * passenger id would let anyone attach a reservation to someone else's account.
 *
 * What is real here and what is not, stated plainly because the distinction
 * matters more for hotels than flights: the OFFERS are real — LiteAPI returns
 * live, bookable properties with real rates — but this endpoint does not call
 * the supplier's book API. It records the member's committed choice locally,
 * exactly as the flight path does. Nothing is charged and no supplier is told.
 * Committing for real is `firstHoldable`/`holdHotel` in server/hotels/, which
 * the recovery saga uses and which needs a write-capable key.
 */

type Body = {
  /** airport code the city was resolved from */
  city: string;
  name: string;
  area?: string;
  checkin: string;
  checkout: string;
  rooms?: number;
  total: number;
  currency: string;
  refundable?: boolean;
  cancelDeadline?: number | null;
  supplier?: string;
  /** set when this stay is being arranged because a specific flight broke */
  flightId?: string | null;
};

const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

function isBody(v: unknown): v is Body {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    isNonEmptyString(o.city) &&
    isNonEmptyString(o.name) &&
    isDate(o.checkin) &&
    isDate(o.checkout) &&
    typeof o.total === 'number' &&
    Number.isFinite(o.total) &&
    o.total >= 0 &&
    isNonEmptyString(o.currency)
  );
}

export async function POST(req: NextRequest) {
  const g = await requireSession(req);
  if ('response' in g) return g.response;
  // CSRF check added 2026-08-21, same reasoning as POST /api/bookings.
  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ error: 'cross-site request rejected' }, { status: 403 });
  }

  const parsed = await parseJsonBody(req, isBody);
  if ('response' in parsed) return parsed.response;
  const body = parsed.body;

  const city = body.city.trim().toUpperCase().slice(0, 3);
  if (!airport(city)) {
    return NextResponse.json({ error: `unknown airport code "${city}"` }, { status: 400 });
  }
  if (Date.parse(body.checkout) <= Date.parse(body.checkin)) {
    return NextResponse.json({ error: 'checkout must be after checkin' }, { status: 400 });
  }

  // Idempotent on the thing a member would consider "the same booking" — same
  // property, same city, same first night. Confirming twice (a double-click, an
  // impatient retry) must not produce two reservations, the same guard the
  // flight path needed after it was observed issuing a second PNR.
  const existing = await store.findStay(g.passenger.id, city, body.checkin, body.name.trim());
  if (existing) return NextResponse.json(existing, { status: 200 });

  const stay: Omit<Stay, 'id'> = {
    passengerId: g.passenger.id,
    flightId: body.flightId ?? null,
    city,
    cityName: cityOf(city) ?? city,
    name: body.name.trim(),
    area: body.area?.trim() ?? '',
    checkin: body.checkin,
    checkout: body.checkout,
    rooms: Math.max(1, Math.min(9, body.rooms ?? 1)),
    // Kept in the currency the supplier quoted. Nothing converts it — the same
    // refusal as server/domain/altsFromOffers.ts's needsConversion.
    total: body.total,
    currency: body.currency,
    refundable: body.refundable ?? false,
    cancelDeadline: body.cancelDeadline ?? null,
    supplier: body.supplier ?? 'unknown',
    reference: reference(),
    bookedAt: Date.now(),
  };

  return NextResponse.json(await store.createStay(stay), { status: 201 });
}

export async function GET(req: NextRequest) {
  const g = await requireSession(req);
  if ('response' in g) return g.response;
  return NextResponse.json(await store.getStaysForPassenger(g.passenger.id));
}

/** Locally generated. Ambiguous characters removed so a member reading it off a
 *  screen onto a phone call gets it right — same alphabet as the flight PNR. */
function reference(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}
