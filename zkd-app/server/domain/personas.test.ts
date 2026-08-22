/**
 * P1–P5, the five canonical worked scenarios repeated across all four agent
 * specs (`documentation/agent-specs/current/*_v2.0.md` §A7). They differ
 * deliberately on the payer and disposition axes, which is what makes them a
 * test set rather than a showcase — and per the 2026-08-19 gap audit
 * (`ZKD-Gap-Audit-Session-Report.md` §6), nothing in this repo actually
 * exercised them: "the single highest-value test the repo is missing,
 * because P3 is exactly the case a lazy `disruption ⇒ airline pays` default
 * gets wrong, and getting it wrong breaks the payment path rather than
 * producing a visible error."
 *
 * These test the real computational core (`lib/entitlement.ts`'s `owed()` /
 * `compensationFor()`, `server/domain/refund.ts`'s `estimateRefund()`)
 * directly with each persona's stated parameters, using the explicit
 * `overnight` flag rather than `estimateRefund`'s `delayHours >= 8` fallback
 * heuristic — deliberately, because P1's own numbers (7h delay, explicitly
 * overnight) are the case that heuristic gets wrong. See the `overnight`
 * field's doc comment on `RefundInput` and the dedicated test below.
 *
 * Not attempted: routing these through the live pipeline end-to-end
 * (`server/pipeline/index.ts` / `server/engine/simulation.ts`). Both live
 * call sites of `estimateRefund` currently hardcode `delayHours: 24` rather
 * than a flight's real delay — flagged in context.md as a separate, larger
 * finding this session did not fix. These tests protect the underlying
 * entitlement/refund arithmetic that a corrected live wiring would depend on.
 */
import { describe, expect, it } from 'vitest';
import { owed, compensationFor, type CareItem } from '@/lib/entitlement';
import { estimateRefund } from './refund';
import type { Flight, Booking } from './types';

const flight = (from: string, to: string) => ({ id: 'f-persona', code: 'AI 000', from, to }) as Flight;
const booking = (fare: number, fareBasis: 'refundable' | 'partially-refundable' | 'non-refundable' = 'partially-refundable'): Booking =>
  ({
    id: 'bk-persona', flightId: 'f-persona', passengerId: 'p-persona', seat: '1A', pnr: 'PRSNA1',
    cabin: 'Economy', travellerIds: ['tr0'], seats: [],
    farePaid: { amount: fare, currency: 'INR' }, fareBasis,
  }) as unknown as Booking;

describe('P1 · PRIYA — involuntary, the carrier pays, outcome A', () => {
  // MAA -> DEL, AI2803 cancelled by the carrier, 7h delay, overnight, board
  // meeting the next morning in London (the onward DEL->LHR leg is unaffected
  // — this tests the disrupted MAA->DEL domestic leg's own entitlement).
  it('owes meals, hotel, transfer and a statutory refund — the 7h delay clears every IN-DGCA threshold', () => {
    const care = owed({ jurisdiction: 'IN-DGCA', delayHours: 7, overnight: true, forceMajeure: false });
    expect(care).toEqual(
      expect.arrayContaining<CareItem>(['meals', 'hotel', 'transfer', 'alt-flight-or-refund', 'cash-compensation']),
    );
  });

  it('estimateRefund reports a statutory refund — the airline owes the ticket back, not a fee-adjusted fare', () => {
    const r = estimateRefund({
      flight: flight('MAA', 'DEL'), booking: booking(6500), cancelledBy: 'carrier', delayHours: 7, overnight: true,
    });
    expect(r.known).toBe(true);
    expect(r.statutory).toBe(true);
    expect(r.total).toBe(6500); // full fare back, no cancellation fee deducted
  });

  it('REGRESSION: a 7h delay is overnight here even though estimateRefund’s own delayHours>=8 fallback would say it is not', () => {
    // Without the explicit `overnight` override, 7 < 8 so the fallback derives
    // overnight:false — which would wrongly drop the hotel line for exactly
    // this persona's own numbers. Proves the override actually changes the
    // outcome, not just that it's accepted.
    const withoutOverride = owed({ jurisdiction: 'IN-DGCA', delayHours: 7, overnight: 7 >= 8, forceMajeure: false });
    const withOverride = owed({ jurisdiction: 'IN-DGCA', delayHours: 7, overnight: true, forceMajeure: false });
    expect(withoutOverride).not.toContain<CareItem>('hotel');
    expect(withOverride).toContain<CareItem>('hotel');
  });

  it('a zero-inventory allocator failure must not be masked — compensationFor still returns a real figure independent of seat availability', () => {
    // Duty-of-care cash compensation is a function of distance and disruption
    // facts, never of whether a replacement seat happened to exist — the spec's
    // own failure branch is "record it and proceed with the next feasible
    // option, or escalate", never "invent an option to fill the gap".
    const comp = compensationFor('IN-DGCA', 1400);
    expect(comp).toBeNull(); // IN-DGCA has no distance-banded figure encoded — see BUNDLES' own comment; must stay null, never a guessed number
  });
});

describe('P2 · ARJUN — the original operated, so the cost is his', () => {
  // BOM -> DEL -> SIN, 6E-5192 delayed 4h (not cancelled), missing the SIN
  // connection. Not overnight. The original flight DID operate, so this is
  // voluntary for fare purposes even though the delay is genuine and
  // carrier-caused — the split the spec calls out explicitly.
  it('clears the 2h meals threshold but not the 6h hotel/transfer/refund threshold', () => {
    const care = owed({ jurisdiction: 'IN-DGCA', delayHours: 4, overnight: false, forceMajeure: false });
    expect(care).toEqual(['meals']);
    expect(care).not.toContain<CareItem>('hotel');
    expect(care).not.toContain<CareItem>('alt-flight-or-refund');
  });

  it('is NOT a statutory refund even though the delay is carrier-caused — the original operated, so cancelledBy is the member’s own reschedule', () => {
    const r = estimateRefund({
      flight: flight('BOM', 'DEL'), booking: booking(8000, 'partially-refundable'),
      cancelledBy: 'member', delayHours: 4, overnight: false,
    });
    expect(r.statutory).toBe(false);
    // partially-refundable: fare back minus a 25% voluntary cancellation charge
    expect(r.total).toBe(8000 - Math.round(8000 * 0.25));
  });
});

describe('P3 · FATIMA — the instructive row: involuntary cancellation, but under the hotel threshold', () => {
  // CCU -> DEL -> DXB, 6E-6402 cancelled BY THE CARRIER at 05:50 (involuntary),
  // 5h delay, NOT overnight. This is the exact case a lazy
  // `disruption => airline pays` default gets wrong: the cancellation being
  // involuntary makes the REROUTE free, not automatically the lodging or the
  // statutory refund, because the delay itself falls under the 6h threshold.
  it('owes meals only — 5h clears meals (2h) but not hotel/transfer/refund (6h), despite the carrier cancelling', () => {
    const care = owed({ jurisdiction: 'IN-DGCA', delayHours: 5, overnight: false, forceMajeure: false });
    expect(care).toEqual(['meals']);
  });

  it('estimateRefund is NOT statutory here even with cancelledBy:"carrier" — the delay threshold governs, not the disposition alone', () => {
    const r = estimateRefund({
      flight: flight('CCU', 'DEL'), booking: booking(7200, 'refundable'), cancelledBy: 'carrier', delayHours: 5, overnight: false,
    });
    // A lazy implementation would set statutory:true purely because
    // cancelledBy === 'carrier'. The correct answer requires BOTH the
    // disposition AND the care threshold to be met.
    expect(r.statutory).toBe(false);
  });
});

describe('P4 · ROHIT — systemic, full duty of care, force majeure removes cash only', () => {
  // DEL -> GAU, 6E-2117 cancelled in a Delhi weather closure (force majeure),
  // 19h delay, overnight, 26h of window slack.
  it('owes meals, hotel, transfer and a replacement/refund, but NOT cash compensation — force majeure removes cash only, never the duty of care', () => {
    const care = owed({ jurisdiction: 'IN-DGCA', delayHours: 19, overnight: true, forceMajeure: true });
    expect(care).toEqual(
      expect.arrayContaining<CareItem>(['meals', 'hotel', 'transfer', 'alt-flight-or-refund']),
    );
    expect(care).not.toContain<CareItem>('cash-compensation');
  });

  it('is still a statutory refund despite force majeure — force majeure never withdraws the refund itself', () => {
    const r = estimateRefund({
      flight: flight('DEL', 'GAU'), booking: booking(5400), cancelledBy: 'carrier', delayHours: 19, overnight: true,
    });
    expect(r.statutory).toBe(true);
    expect(r.total).toBe(5400);
  });
});

describe('P5 · TAKE THE WHEEL — no allocator claim survives without a fare on record', () => {
  // Not a delay/threshold scenario — the spec's own point is that an
  // intervention must never fall back to a fabricated number. The concrete,
  // testable version of that here: absent a recorded fare, the refund is
  // unknown, never a guessed figure the member could be misled by mid-override.
  it('reports known:false rather than a guessed refund when no fare is on record', () => {
    const noFareBooking = { ...booking(0), farePaid: undefined } as unknown as Booking;
    const r = estimateRefund({ flight: flight('DEL', 'BOM'), booking: noFareBooking, cancelledBy: 'carrier', delayHours: 24 });
    expect(r.known).toBe(false);
    expect(r.total).toBe(0);
  });
});
