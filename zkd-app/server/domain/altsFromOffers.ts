/**
 * Turns real supplier offers (server/suppliers) into the domain's own `Alt`
 * shape. Shared by the live alts cache (server/engine/altsCache.ts) and the
 * manual /api/alts diagnostic route, so there is exactly one place that knows
 * how a supplier offer becomes something a member is shown.
 *
 * ── Two rules that used to live here and no longer do ──────────────────────
 *
 * 1. **The per-transaction cap.** An option costing more than the card's
 *    single-transaction ceiling was marked `ok: false` and greyed out. The cap
 *    was removed on 2026-08-19: hiding the only seat home because it is
 *    expensive serves nobody, and the protection it offered has been replaced
 *    by telling the member what is about to be spent at every step and giving
 *    them a window to stop it (server/notify/templates.ts).
 *
 * 2. **The refusal to convert currency.** A fare quoted outside the card's
 *    billing currency was marked `needsConversion` and forced `ok: false`
 *    rather than guess a rate. That was defensible while the converted number
 *    would be compared against a hard spend ceiling. With the ceiling gone it
 *    stopped protecting anyone and started emptying the option list — live
 *    Duffel inventory prices in EUR, so on a real search every bookable row
 *    disappeared. We now convert through server/fx.ts, show the original
 *    alongside the converted figure, and say plainly that the rate is a market
 *    rate and the charge may differ.
 *
 * What survives is the rule that was always the real one: **cabin entitlement
 * comes from the card, and an option outside it is surfaced and marked, never
 * silently dropped.** The member is allowed to see what was ruled out and why.
 */
import { localTime } from '../airportDirectory';
import { getRate, convertWith, CONVERSION_NOTE, type Rate } from '../fx';
import type { Offer } from '../suppliers/types';
import type { Alt } from './types';

const CABIN_ORDER = ['economy', 'premium economy', 'business', 'first'];
const cabinRank = (c: string) => {
  const i = CABIN_ORDER.indexOf(c.toLowerCase());
  return i === -1 ? 0 : i;
};

/**
 * Converts every offer against ONE rate, fetched once.
 *
 * Not a micro-optimisation. Awaiting a rate per offer would let two options in
 * the same list be converted at two different rates, and a comparison between
 * prices measured with different rulers is not a comparison. One rate per
 * search is also what a member would expect if they asked.
 */
export async function offersToAlts(
  offers: Offer[],
  from: string,
  to: string,
  entitledCabin: string,
  displayCurrency: string,
): Promise<Alt[]> {
  // Currencies actually present, so a single-currency search costs no lookup.
  const currencies = [...new Set(offers.map((o) => o.price.currency))];
  const rates = new Map<string, Rate>();
  await Promise.all(
    currencies.map(async (c) => {
      rates.set(c, await getRate(c, displayCurrency));
    }),
  );

  return offers.map((o) =>
    marketAlt(o, from, to, entitledCabin, displayCurrency, rates.get(o.price.currency)),
  );
}

function marketAlt(
  o: Offer,
  from: string,
  to: string,
  entitledCabin: string,
  displayCurrency: string,
  rate: Rate | undefined,
): Alt {
  const overCabin = cabinRank(o.cabin) > cabinRank(entitledCabin);
  const converted = rate && rate.source !== 'identity';
  const fare = converted ? convertWith(o.price.amount, rate) : o.price.amount;

  const why = overCabin
    ? `${o.cabin} is above the ${entitledCabin} your card entitles you to`
    : converted
      ? o.live
        ? `Priced by the supplier in ${o.price.currency}. ${CONVERSION_NOTE}`
        : `Generated inventory, not a bookable seat. ${CONVERSION_NOTE}`
      : o.live
        ? 'From live supplier inventory'
        : 'Generated inventory, not a bookable seat';

  return {
    id: o.id,
    code: o.flightCode,
    dep: localTime(from, o.departsAt),
    arr: localTime(to, o.arrivesAt),
    departsAt: o.departsAt,
    arrivesAt: o.arrivesAt,
    cabin: o.cabin,
    seats: o.seatsRemaining,
    fare,
    currency: displayCurrency,
    // What the supplier actually quoted, kept so the member can always see the
    // real number behind a converted one — and so a settled charge can be
    // reconciled against the quote rather than against our arithmetic.
    quoted: converted
      ? { amount: o.price.amount, currency: o.price.currency, rate: rate.rate, rateAsOf: rate.asOf, rateSource: rate.source }
      : undefined,
    expiresAt: o.expiresAt,
    supplier: o.supplier,
    supplierOfferId: o.supplierOfferId,
    kind: 'market',
    // Cabin entitlement is the only policy rule left that can disqualify an
    // option outright. Price no longer can.
    ok: !overCabin,
    why,
  };
}
