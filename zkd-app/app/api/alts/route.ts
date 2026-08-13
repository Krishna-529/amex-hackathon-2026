import { NextRequest, NextResponse } from 'next/server';
import { searchInventory, seatsAcross, type Offer } from '@/server/suppliers';
import { formatMoney } from '@/lib/airports';
import { localTime } from '@/server/airportDirectory';
import { fetchProfile } from '@/server/myca';
import type { AltsResponse } from '@/lib/apiTypes';
import type { Alt } from '@/server/domain/types';

export async function GET(req: NextRequest) {
  const origin = req.nextUrl.searchParams.get('from') ?? '';
  const destination = req.nextUrl.searchParams.get('to') ?? '';
  const departureDate = req.nextUrl.searchParams.get('date') ?? '';
  const cabin = req.nextUrl.searchParams.get('cabin') ?? undefined;

  const [{ offers, sources }, profile] = await Promise.all([
    searchInventory({ origin, destination, departureDate, cabin }),
    fetchProfile('demo'),
  ]);

  const body: AltsResponse = {
    alts: offers.map((o) =>
      toAlt(o, origin, destination, profile.preferences.cabinEntitlement, profile.preferences.perTransactionCap),
    ),
    offers,
    seatsAvailable: seatsAcross(offers),
    sources,
  };
  return NextResponse.json(body);
}

/**
 * Ranking is against MyCa's entitlement, not a hardcoded rule — the card is the
 * system of record for the cabin the member may be moved into and what a single
 * transaction may cost. A candidate outside either is surfaced and marked, never
 * silently dropped: the member is allowed to see what was ruled out and why.
 */
function toAlt(
  o: Offer,
  from: string,
  to: string,
  entitledCabin: string,
  cap: { amount: number; currency: string },
): Alt {
  const overCabin = rank(o.cabin) > rank(entitledCabin);
  // The cap is set in the card's billing currency. We hold no FX rates, so a
  // fare quoted in another currency cannot be compared to it — and guessing
  // would be worse than admitting it.
  const comparable = o.price.currency === cap.currency;
  const overCap = comparable && o.price.amount > cap.amount;
  const needsConversion = !comparable;

  const why = overCabin
    ? `${o.cabin} is above the ${entitledCabin} your card entitles you to`
    : overCap
      ? `${formatMoney(o.price.amount, o.price.currency)} is over your ${formatMoney(cap.amount, cap.currency)} single-transaction cap`
      : needsConversion
        ? `Priced in ${o.price.currency} while your cap is set in ${cap.currency} — we will not approve this automatically without converting it`
        : o.live
          ? 'Within your entitlement, from live supplier inventory'
          : 'Within your entitlement — generated inventory, not a bookable seat';

  return {
    id: o.id,
    code: o.flightCode,
    dep: localTime(from, o.departsAt),
    arr: localTime(to, o.arrivesAt),
    cabin: o.cabin,
    seats: o.seatsRemaining,
    fare: o.price.amount,
    currency: o.price.currency,
    expiresAt: o.expiresAt,
    supplier: o.supplier,
    supplierOfferId: o.supplierOfferId,
    ok: !overCabin && !overCap && !needsConversion,
    why,
  };
}

const CABIN_ORDER = ['economy', 'premium economy', 'business', 'first'];
const rank = (c: string) => {
  const i = CABIN_ORDER.indexOf(c.toLowerCase());
  return i === -1 ? 0 : i;
};
