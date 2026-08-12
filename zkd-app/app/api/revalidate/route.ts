import { NextRequest, NextResponse } from 'next/server';
import { revalidateOffer, firstBookable } from '@/server/suppliers';
import { formatMoney } from '@/lib/airports';
import type { RevalidateRequest, RevalidateResponse } from '@/lib/apiTypes';

/**
 * Called at the moment of spend, never before.
 *
 * The member may have spent minutes deciding, and inventory does not wait for
 * them. Rather than shortening the window until nobody can answer it, we confirm
 * the seat is still there before ticketing — and if it is gone, we move to the
 * next ranked candidate instead of failing. The consent we hold was to the
 * outcome, not to one specific seat.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as RevalidateRequest;
  const chosen = body.candidates.find((o) => o.id === body.offerId);

  if (!chosen) {
    return NextResponse.json({
      state: 'gone',
      offer: null,
      switchedFrom: null,
      message: 'That option is no longer on the table.',
    } satisfies RevalidateResponse);
  }

  const result = await revalidateOffer(chosen);

  if (result.state === 'available') {
    return NextResponse.json({
      state: 'available',
      offer: result.offer,
      switchedFrom: null,
      message: 'Still available at the price you were shown.',
    } satisfies RevalidateResponse);
  }

  if (result.state === 'price-changed') {
    const was = formatMoney(result.previous.amount, result.previous.currency);
    const now = formatMoney(result.offer.price.amount, result.offer.price.currency);
    return NextResponse.json({
      state: 'price-changed',
      offer: result.offer,
      switchedFrom: null,
      message: `The fare moved from ${was} to ${now} while you were deciding.`,
    } satisfies RevalidateResponse);
  }

  // Gone, or we could not confirm it — either way, do not ticket it. Cascade.
  const rest = body.candidates.filter((o) => o.id !== chosen.id);
  const next = await firstBookable(rest);

  if (!next) {
    return NextResponse.json({
      state: 'gone',
      offer: null,
      switchedFrom: chosen.id,
      message: 'That seat went while you were deciding, and nothing else on this route is bookable right now.',
    } satisfies RevalidateResponse);
  }

  return NextResponse.json({
    state: 'switched',
    offer: next.offer,
    switchedFrom: chosen.id,
    message: `${chosen.flightCode} went while you were deciding. ${next.offer.flightCode} still works and keeps your trip together.`,
  } satisfies RevalidateResponse);
}
