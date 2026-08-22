/**
 * Building option shapes the supplier search does not return on its own.
 *
 * A search for MAA→DEL returns direct flights. It does not return "MAA→BOM,
 * then BOM→DEL two hours later", and on a thin route that pairing may be the
 * only way home. So connections are constructed here — really constructed, from
 * two independent searches, not relabelled.
 *
 * ── The materialisation trick ──────────────────────────────────────────────
 *
 * A constructed connection is written into `flight.candidates.alts` as a real
 * `Alt` with a `conn:` id and a code naming both legs. Every downstream
 * consumer then works unchanged: `altsForParty` checks its seat count,
 * `costFor` prices it, `toFlightDetail` projects it, and the recovery page's
 * `find(a => a.id === view.chosenAltId)` resolves it. Nothing had to learn a
 * new shape.
 *
 * ── Overnight is NOT a fourth shape ────────────────────────────────────────
 *
 * It was tempting to materialise "flight + hotel + transfers" as one composite
 * option too, but the domain already models exactly that: a `RecoveryTask`
 * carries `chosenAltId`, `chosenHotelId` and `chosenCabId` as three separate
 * fields, and `costFor` already sums them with party-aware room and vehicle
 * counts. An overnight is therefore not a different kind of alternative — it is
 * an alternative that happens to need a bed, and all this module has to decide
 * is *whether* it does. See `needsOvernight`.
 */

import { searchInventory } from '../suppliers';
import { getRate, CONVERSION_NOTE } from '../fx';
import { localTime, isInternational } from '../airportDirectory';
import type { Offer } from '../suppliers/types';
import type { Alt, Flight } from '../domain/types';
import type { RebookingRules } from '../preferences/adapt';

/** Hubs we will route through when the direct market is thin. Indian domestic first. */
const HUBS = ['DEL', 'BOM', 'BLR', 'HYD', 'MAA', 'CCU'];

/** Below this many usable directs, spend quota building multi-leg options. */
const MIN_DIRECT_BEFORE_HUB_SEARCH = 3;

/** Minimum connection we will construct. Below this we are offering a second disruption. */
const MIN_CONNECT_MINUTES = { domestic: 60, international: 90 };

/** Past this, a layover stops being a connection and becomes a night in a hub. */
const MAX_CONNECT_HOURS = 6;

export type ComposeResult = {
  alts: Alt[];
  /** hubs actually searched, for the ledger */
  hubsTried: string[];
  /** extra supplier calls this cost — the governor is paying for these */
  callsSpent: number;
};

/**
 * Constructs viable two-leg options through a hub.
 *
 * Gated on the direct market being thin, because each hub costs two searches
 * against free-tier quotas the governor is already rationing. Hubs are tried in
 * order and the loop stops as soon as anything viable is found — breadth here
 * is cheap to want and expensive to have.
 */
export async function composeConnections(
  flight: Flight,
  directCount: number,
  partySize: number,
  rules: RebookingRules,
  entitledCabin: string,
  displayCurrency: string,
): Promise<ComposeResult> {
  const result: ComposeResult = { alts: [], hubsTried: [], callsSpent: 0 };

  // `max_acceptable_layovers: 0` is a member saying "direct only". Honour it
  // before spending anything, rather than building options we would then filter.
  if (rules.maxLayovers < 1) return result;
  if (directCount >= MIN_DIRECT_BEFORE_HUB_SEARCH) return result;

  const date = flight.depISO.slice(0, 10);
  const intl = isInternational(flight.from, flight.to);
  const minGapMs = (intl ? MIN_CONNECT_MINUTES.international : MIN_CONNECT_MINUTES.domestic) * 60_000;
  const maxGapMs = MAX_CONNECT_HOURS * 3_600_000;

  const hubs = HUBS.filter((h) => h !== flight.from && h !== flight.to);

  for (const hub of hubs) {
    result.hubsTried.push(hub);
    const [first, second] = await Promise.all([
      searchInventory({ origin: flight.from, destination: hub, departureDate: date, passengers: partySize }),
      searchInventory({ origin: hub, destination: flight.to, departureDate: date, passengers: partySize }),
    ]);
    result.callsSpent += 2;

    // One rate per currency for this hub's pairings, fetched before any
    // materialisation: two legs of the same connection converted at two
    // different rates would not sum to anything meaningful.
    const rates = new Map<string, number>();
    for (const c of new Set([...first.offers, ...second.offers].map((o) => o.price.currency))) {
      rates.set(c, (await getRate(c, displayCurrency)).rate);
    }

    for (const a of first.offers) {
      for (const b of second.offers) {
        const gap = b.departsAt - a.arrivesAt;
        if (gap < minGapMs || gap > maxGapMs) continue;
        // Both legs must seat the whole party, or the connection cannot be
        // booked as one journey and altsForParty would reject it anyway.
        if (a.seatsRemaining > 0 && a.seatsRemaining < partySize) continue;
        if (b.seatsRemaining > 0 && b.seatsRemaining < partySize) continue;
        result.alts.push(materialise(a, b, flight, hub, entitledCabin, displayCurrency, rates));
      }
    }

    if (result.alts.length > 0) break;
  }

  // Soonest arrival first, then cheapest — and cap the list so a hub with a
  // dense schedule cannot flood the member's choices.
  result.alts.sort((x, y) => (x.arrivesAt ?? 0) - (y.arrivesAt ?? 0) || x.fare - y.fare);
  result.alts = result.alts.slice(0, 4);
  return result;
}

/**
 * Two offers become one `Alt`.
 *
 * Fare sums, seats take the minimum (a connection can only carry as many as its
 * tightest leg), and expiry takes the earliest — the whole itinerary stops
 * being honoured when its first component does, which is what
 * lib/confirmWindow.ts must derive the member's window from.
 */
function materialise(
  a: Offer,
  b: Offer,
  flight: Flight,
  hub: string,
  entitledCabin: string,
  displayCurrency: string,
  rates: Map<string, number>,
): Alt {
  // Legs quoted in different currencies used to disqualify a connection
  // outright. With server/fx.ts in place both legs convert into the card's
  // billing currency and the sum is meaningful, so a mixed-currency connection
  // is now an ordinary option rather than a refusal.
  const rateA = rates.get(a.price.currency) ?? 1;
  const rateB = rates.get(b.price.currency) ?? 1;
  const converted = a.price.currency !== displayCurrency || b.price.currency !== displayCurrency;
  const fare = Math.round(a.price.amount * rateA) + Math.round(b.price.amount * rateB);
  const expiries = [a.expiresAt, b.expiresAt].filter((e): e is number => e !== null);
  const seats = Math.min(
    a.seatsRemaining || Number.MAX_SAFE_INTEGER,
    b.seatsRemaining || Number.MAX_SAFE_INTEGER,
  );
  const gapMinutes = Math.round((b.departsAt - a.arrivesAt) / 60_000);

  // Worst cabin across the legs decides: a business first leg does not
  // compensate for being downgraded on the second.
  const worstCabin = rankCabin(a.cabin) <= rankCabin(b.cabin) ? a.cabin : b.cabin;
  const overCabin = rankCabin(worstCabin) > rankCabin(entitledCabin);

  const base = `Two legs via ${hub}, ${gapMinutes} min to connect. Both booked together or neither.`;
  const why = overCabin
    ? `${worstCabin} is above the ${entitledCabin} your card entitles you to`
    : converted
      ? `${base} ${CONVERSION_NOTE}`
      : base;

  return {
    id: `conn:${a.id}+${b.id}`,
    code: `${a.flightCode} + ${b.flightCode}`,
    dep: localTime(flight.from, a.departsAt),
    arr: localTime(flight.to, b.arrivesAt),
    departsAt: a.departsAt,
    arrivesAt: b.arrivesAt,
    cabin: worstCabin,
    seats: seats === Number.MAX_SAFE_INTEGER ? 0 : seats,
    fare,
    currency: displayCurrency,
    quoted: converted
      ? {
          amount: a.price.amount + b.price.amount,
          currency: a.price.currency === b.price.currency ? a.price.currency : 'mixed',
          rate: rateA,
          rateAsOf: Date.now(),
          rateSource: 'live',
        }
      : undefined,
    expiresAt: expiries.length ? Math.min(...expiries) : null,
    // Both legs must be live for the pair to be bookable as one journey.
    supplier: a.live && b.live ? a.supplier : undefined,
    supplierOfferId: undefined,
    kind: 'market',
    ok: !overCabin && a.live && b.live,
    why,
  };
}

/**
 * Does this alternative strand the member long enough to need a bed?
 *
 * Driven by the member's own `hotel_trigger_threshold_hours` rather than a
 * hardcoded heuristic — six hours in an airport is tolerable to some people and
 * not to others, and the schema lets them say which.
 *
 * Measured from when they were originally due to depart, not from now: the
 * question is how long their day has been extended, not how long we have been
 * working on it.
 */
export function needsOvernight(flight: Flight, alt: Alt, rules: RebookingRules): boolean {
  if (flight.rescheduledToISO) return true; // Postponed/rescheduled flights always include hotel provisioning
  if (typeof alt.departsAt !== 'number') return false;
  const originalDeparture = new Date(flight.depISO).getTime();
  const waitHours = (alt.departsAt - originalDeparture) / 3_600_000;
  return waitHours >= rules.hotelTriggerHours;
}

/**
 * Is a multi-day rental indicated?
 *
 * Reported, never acted on: no rental provider is wired, because every free
 * route to one runs through a vendor this project cannot use. The pipeline
 * records that the threshold was crossed and degrades to the rideshare path
 * rather than pretending a car was arranged.
 */
export function needsRentalCar(flight: Flight, alt: Alt, rules: RebookingRules): boolean {
  if (typeof alt.departsAt !== 'number') return false;
  const originalDeparture = new Date(flight.depISO).getTime();
  return (alt.departsAt - originalDeparture) / 3_600_000 >= rules.rentalCarTriggerHours;
}

const CABIN_ORDER = ['economy', 'premium economy', 'business', 'first'];
function rankCabin(c: string): number {
  const i = CABIN_ORDER.indexOf(c.trim().toLowerCase());
  return i === -1 ? 0 : i;
}
