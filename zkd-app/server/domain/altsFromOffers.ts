/**
 * Turns real supplier offers (server/suppliers) into the domain's own `Alt`
 * shape. Shared by the live alts cache (server/engine/altsCache.ts) and the
 * manual /api/alts diagnostic route, so there is exactly one place that knows
 * how a supplier offer becomes something a member is shown.
 */
import { formatMoney } from '@/lib/airports';
import { localTime } from '../airportDirectory';
import type { Offer } from '../suppliers/types';
import type { Alt } from './types';

const CABIN_ORDER = ['economy', 'premium economy', 'business', 'first'];
const cabinRank = (c: string) => {
  const i = CABIN_ORDER.indexOf(c.toLowerCase());
  return i === -1 ? 0 : i;
};

/**
 * Ranking is against MyCa's entitlement, not a hardcoded rule — the card is
 * the system of record for the cabin the member may be moved into and what a
 * single transaction may cost. A candidate outside either is surfaced and
 * marked, never silently dropped: the member is allowed to see what was
 * ruled out and why.
 */
export function offersToAlts(
  offers: Offer[],
  from: string,
  to: string,
  entitledCabin: string,
  cap: { amount: number; currency: string },
): Alt[] {
  return offers.map((o) => marketAlt(o, from, to, entitledCabin, cap));
}

function marketAlt(
  o: Offer,
  from: string,
  to: string,
  entitledCabin: string,
  cap: { amount: number; currency: string },
): Alt {
  const overCabin = cabinRank(o.cabin) > cabinRank(entitledCabin);
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
    // Supplier inventory is by definition bought, never a statutory
    // entitlement — the carrier's own re-accommodation (below) is a
    // domain-level concept built from the best real seat we can see, not
    // something a supplier search itself returns.
    kind: 'market',
    ok: !overCabin && !overCap && !needsConversion,
    why,
  };
}

/**
 * There is no airline NDC access here, so we cannot fetch a real
 * airline-issued re-accommodation. The honest version: the best real seat we
 * can see on this route (same carrier as the cancelled flight preferred,
 * cheapest otherwise), fare zeroed and labelled `carrier-protected` — the
 * statutory entitlement (lib/entitlement.ts) says the airline owes this, not
 * that we invented a flight number for it. Returns null when there is
 * genuinely no real inventory to build one from — no fallback fabrication.
 */
export function carrierProtectedAlt(
  offers: Offer[],
  bookedFlightCode: string,
  from: string,
  to: string,
  partySize: number,
): Alt | null {
  if (!offers.length) return null;

  const carrierPrefix = bookedFlightCode.split(' ')[0];
  const sameCarrier = offers.filter((o) => o.flightCode.startsWith(carrierPrefix));
  const pool = sameCarrier.length ? sameCarrier : offers;
  const best = [...pool].sort((a, b) => a.price.amount - b.price.amount)[0];

  return {
    id: `cp-${best.id}`,
    code: best.flightCode,
    dep: localTime(from, best.departsAt),
    arr: localTime(to, best.arrivesAt),
    cabin: best.cabin,
    seats: 99,
    fare: 0,
    currency: best.price.currency,
    expiresAt: null,
    supplier: best.supplier,
    supplierOfferId: best.supplierOfferId,
    kind: 'carrier-protected',
    ok: true,
    why: partySize > 1
      ? `The airline cancelled, so it owes re-accommodation for all ${partySize} tickets on this booking — this is owed, not bought.`
      : 'The airline owes you this seat — this is owed, not bought.',
  };
}
