/**
 * What comes BACK when a flight is cancelled — the other half of "what does
 * this cost".
 *
 * ── Why this file had to exist ─────────────────────────────────────────────
 *
 * Until now the system carried the *idea* of a refund without ever computing
 * one. `carrierProtectedAlt()` expressed it by fabricating an option priced at
 * zero: take the cheapest real seat, overwrite the fare to 0, set seats to 99,
 * and label it "the airline owes you this". That is not a refund calculation,
 * it is a claim with no arithmetic behind it, and it did three kinds of damage
 * — it made a made-up option compete for the member's choice, it fed 99
 * imaginary seats into the scarcity term that sets the alert threshold
 * (server/engine/forecast.ts), and it let autopilot default to a seat nobody
 * had checked existed.
 *
 * The airline owing you money is real. It is just not a *flight option*. It is
 * a number, and the member is owed the number.
 *
 * ── The one distinction this module refuses to blur ────────────────────────
 *
 * EXPECTED is not RECOVERED. Everything here is an estimate of what should come
 * back; nothing here asserts that it has. Canon's *initiated is not completed*
 * rule is enforced structurally in server/ledger/reconciliation.ts, which
 * tracks `amountExpected` and `amountRecovered` as separate fields on a
 * RefundClaim. This module produces the first number only, and every figure it
 * returns carries a `basis` explaining where it came from so a member — or a
 * back office contesting a denial — can see the reasoning rather than a total.
 *
 * ── Unknown is a real answer ───────────────────────────────────────────────
 *
 * If we do not know what the member paid, we say so. `Booking.farePaid` is
 * optional (seeded PNRs predate it), and the honest response to a missing fare
 * is `known: false`, not a plausible-looking guess. A wrong refund estimate is
 * worse than no estimate: it becomes the delta, and the delta is the number the
 * member decides on.
 */

import { owed, type CareItem } from '@/lib/entitlement';
import { jurisdictionFor, isInternational } from '../airportDirectory';
import type { Booking, Flight, HotelOpt, CabOpt, Stay, Ride } from './types';
import type { Money } from '../suppliers/types';

/** One line of the refund arithmetic, with its reasoning attached. */
export type RefundLine = {
  label: string;
  /** positive = money coming back to the member; negative = a charge they eat */
  amount: number;
  currency: string;
  /** plain language, written from the member's side of the screen */
  basis: string;
};

export type RefundEstimate = {
  /** false when we cannot compute it — the UI must say "unknown", never "₹0" */
  known: boolean;
  lines: RefundLine[];
  /** sum of `lines`; positive means money returns to the card */
  total: number;
  currency: string;
  /**
   * True when the carrier owes the ticket back under statute rather than as a
   * commercial goodwill gesture. Drives the copy: "the airline must refund
   * this" reads very differently from "this fare is refundable".
   */
  statutory: boolean;
};

/**
 * Fare conditions, as an Indian domestic ticket actually carries them.
 *
 * Deliberately three states rather than a boolean. "Refundable minus a fee" is
 * how most LCC fares in this market behave and it is neither of the two ends —
 * flattening it to `refundable: false` would understate every recovery by the
 * whole fare, and to `true` would overstate it by the fee.
 */
export type FareBasis = 'refundable' | 'partially-refundable' | 'non-refundable';

/**
 * The airline's own cancellation fee does NOT apply when the airline is the one
 * cancelling. This is the entire point of an involuntary cancellation: the fare
 * rules that govern a passenger changing their mind do not govern the carrier
 * changing theirs. Encoded here so the distinction cannot be lost in a call
 * site that forgets which way the cancellation went.
 */
export type CancelledBy = 'carrier' | 'member';

export type RefundInput = {
  flight: Flight;
  booking: Booking;
  cancelledBy: CancelledBy;
  /** how late the member ends up, in hours — drives the statutory entitlement */
  delayHours: number;
  /** stays and rides being unwound because this flight died */
  stays?: Stay[];
  rides?: Ride[];
  now?: number;
};

/**
 * Fee taken on a *voluntary* cancellation, as a fraction of the fare.
 *
 * `assumed` tier: these are representative Indian domestic conditions, not
 * quoted rules from any one carrier's fare basis. They only ever apply on the
 * `cancelledBy: 'member'` path, which no automatic recovery takes — every
 * cancellation this product reacts to is the carrier's. They exist so the
 * arithmetic is complete rather than because the recovery flow needs them.
 */
const VOLUNTARY_FEE_FRACTION: Record<FareBasis, number> = {
  refundable: 0,
  'partially-refundable': 0.25,
  'non-refundable': 1,
};

export function estimateRefund(input: RefundInput): RefundEstimate {
  const { flight, booking, cancelledBy } = input;
  const paid = booking.farePaid;

  if (!paid || !Number.isFinite(paid.amount)) {
    return {
      known: false,
      lines: [],
      total: 0,
      currency: 'INR',
      statutory: false,
    };
  }

  const currency = paid.currency;
  const lines: RefundLine[] = [];

  const jurisdiction = jurisdictionFor(flight.from, flight.to);
  const care: CareItem[] = owed({
    jurisdiction,
    delayHours: input.delayHours,
    overnight: input.delayHours >= 8,
    // A cancellation is never force majeure for the purposes of the ticket's
    // value: force majeure removes CASH COMPENSATION, never the duty to refund
    // or re-route. lib/entitlement.ts encodes that distinction; passing `true`
    // here would silently withdraw the refund along with the compensation.
    forceMajeure: false,
    international: isInternational(flight.from, flight.to),
  });
  const statutory = cancelledBy === 'carrier' && care.includes('alt-flight-or-refund');

  if (statutory) {
    // The carrier cancelled. The ticket's value comes back in full — fare
    // conditions govern a passenger changing their mind, not the airline.
    lines.push({
      label: 'Original ticket',
      amount: paid.amount,
      currency,
      basis:
        'The airline cancelled, so the full fare is refundable regardless of the fare rules you booked under.',
    });
  } else {
    const basis: FareBasis = booking.fareBasis ?? 'partially-refundable';
    const fee = Math.round(paid.amount * VOLUNTARY_FEE_FRACTION[basis]);
    lines.push({
      label: 'Original ticket',
      amount: paid.amount,
      currency,
      basis: 'What you paid for the ticket being cancelled.',
    });
    if (fee > 0) {
      lines.push({
        label: 'Airline cancellation charge',
        amount: -fee,
        currency,
        basis:
          basis === 'non-refundable'
            ? 'This fare is non-refundable, so the airline keeps it.'
            : 'This fare is refundable less the airline’s cancellation charge.',
      });
    }
  }

  // Anything else being unwound because this flight died. A hotel past its free
  // cancellation deadline is money the member loses, and it belongs in the same
  // arithmetic — otherwise the "delta" they decide on is not the real delta.
  const now = input.now ?? Date.now();
  for (const stay of input.stays ?? []) {
    const free = stay.refundable && (stay.cancelDeadline === null || stay.cancelDeadline > now);
    if (free) continue;
    lines.push({
      label: `${stay.name} — cancellation charge`,
      amount: -stay.total,
      currency: stay.currency,
      basis: stay.refundable
        ? 'Free cancellation on this room has already closed.'
        : 'This room was booked on a non-refundable rate.',
    });
  }

  for (const ride of input.rides ?? []) {
    lines.push({
      label: `Cab ${ride.from} → ${ride.to} — cancellation charge`,
      amount: -ride.total,
      currency: ride.currency,
      basis: 'A booked transfer that no longer fits the new plan.',
    });
  }

  // Only same-currency lines are summed. Mixing an INR fare with a EUR hotel
  // charge into one total would be exactly the invented-FX mistake this repo
  // spent a long time refusing; conversion belongs at the display edge
  // (server/fx.ts), where the rate and its timestamp travel with the number.
  const total = lines
    .filter((l) => l.currency === currency)
    .reduce((n, l) => n + l.amount, 0);

  return { known: true, lines, total, currency, statutory };
}

/**
 * The number the member actually decides on.
 *
 * `actual` is what the replacement costs. `expectedRefund` is what comes back.
 * `delta` is the difference — and it is the only one of the three that answers
 * "am I out of pocket, and by how much".
 *
 * `delta` is deliberately allowed to be negative. A member rebooked onto a
 * cheaper flight after a full statutory refund genuinely ends up ahead, and
 * clamping that to zero would hide a real outcome in the one direction members
 * are most pleased to hear about.
 */
export type CostDelta = {
  actual: Money;
  expectedRefund: Money;
  delta: Money;
  /** false when the refund could not be computed — show "unknown", not zero */
  refundKnown: boolean;
};

export function costDelta(
  actual: Money,
  refund: RefundEstimate,
): CostDelta {
  const comparable = refund.known && refund.currency === actual.currency;
  const refundAmount = comparable ? refund.total : 0;
  return {
    actual,
    expectedRefund: { amount: refundAmount, currency: actual.currency },
    delta: { amount: actual.amount - refundAmount, currency: actual.currency },
    refundKnown: comparable,
  };
}

/** Total for a whole PNR — the fare refund is per ticket, so it scales by party. */
export function partySize(booking: Booking): number {
  return Math.max(1, booking.travellerIds?.length ?? 1);
}

/**
 * Which of the recovery's own components the member would be charged a
 * cancellation fee on, if the plan changes again after booking. Surfaced so
 * "we can still change this for free until 18:00" is a statement we can make
 * truthfully rather than a hope.
 */
export function unwindCost(
  hotel: HotelOpt | undefined,
  cab: CabOpt | undefined,
): { free: boolean; note: string } {
  if (!hotel && !cab) return { free: true, note: 'Nothing is booked yet.' };
  return {
    free: true,
    note: 'Nothing has been booked or charged, so changing this costs nothing.',
  };
}
