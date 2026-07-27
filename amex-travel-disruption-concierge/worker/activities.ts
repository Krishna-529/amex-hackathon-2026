/**
 * Temporal activities — every side effect the concierge has on the world.
 *
 * Activities are the only place that talks to suppliers or to OPA. The
 * workflow (workflows.ts) contains no I/O and no policy logic; it only
 * sequences these and owns the compensation stack.
 */

import { Context } from '@temporalio/activity';
import * as suppliers from '../mocks/suppliers';
import * as ledger from '../src/ledger';
import * as vclock from '../src/clock';
import { evaluateRebook, evaluateDutyOfCare } from '../src/opa';
import { DISRUPTION, ORIGINAL_ITINERARY, RECOVERY, LATENCY_MS, CARD_MEMBER } from '../src/scenario';
import type {
  ActivityId,
  BookingResult,
  CompensationResult,
  DutyOfCarePacket,
  OfferDecision,
  RankedOption,
} from './types';

function ids(): { runId: string; workflowId: string } {
  const exec = Context.current().info.workflowExecution;
  if (!exec) throw new Error('Activity ran outside a workflow execution — no run id to key on.');
  return { runId: exec.runId, workflowId: exec.workflowId };
}

const hours = (fromIso: string, toIso: string) =>
  Math.round(((Date.parse(toIso) - Date.parse(fromIso)) / 3_600_000) * 100) / 100;

// ---------------------------------------------------------------------------
// Planning phase — signal, context, supplier fan-out, policy gate, ranking
// ---------------------------------------------------------------------------

export async function detectDisruption(): Promise<typeof DISRUPTION> {
  await suppliers.sleep(suppliers.latency().signal);
  vclock.advance(LATENCY_MS.signal);
  return DISRUPTION;
}

export async function gatherContext(): Promise<{
  pnr: string;
  cardMember: string;
  invalidated: string[];
  atRisk: string[];
  purpose: string;
}> {
  await suppliers.sleep(suppliers.latency().context);
  vclock.advance(LATENCY_MS.context);
  return {
    pnr: ORIGINAL_ITINERARY.pnr,
    cardMember: CARD_MEMBER.name,
    invalidated: DISRUPTION.invalidates,
    atRisk: DISRUPTION.atRisk,
    purpose: CARD_MEMBER.purpose,
  };
}

/** Parallel fan-out to every supplier mock. Recorded fixtures, no network. */
export async function searchSuppliers(): Promise<{ air: any; hotel: any; ground: any }> {
  const [air, hotel, ground] = await Promise.all([
    suppliers.sabreSearch(),
    Promise.resolve(suppliers.hotelOffers()),
    Promise.resolve(suppliers.groundOffers()),
  ]);
  vclock.advance(LATENCY_MS.supplierFanout);
  return { air, hotel, ground };
}

/**
 * Runs EVERY candidate offer through the Rego gate. The denials matter as much
 * as the approval — they are what the escalation packet cites.
 */
export async function gateOffers(): Promise<OfferDecision[]> {
  const { runId, workflowId } = ids();
  const air = suppliers.sabreOffers();
  const candidates = [...air.offers, air.protection];
  const out: OfferDecision[] = [];

  for (const o of candidates) {
    const decision = await evaluateRebook({
      runId,
      workflowId,
      subject: `${o.flight} ${o.from}->${o.to} (${o.offer_id})`,
      action: {
        type: 'rebook_flight',
        offer_id: o.offer_id,
        offer_ttl_s: o.offer_ttl_s,
        cabin: o.cabin,
        carrier: o.carrier,
        fare_delta_inr: o.fare_delta_inr,
      },
    });
    out.push({
      offerId: o.offer_id,
      label: `${o.flight} ${o.from}→${o.to}`,
      carrier: o.carrier,
      carrierName: o.carrier_name,
      flight: o.flight,
      departIso: o.departIso,
      arriveIso: o.arriveIso,
      cabin: o.cabin,
      fareDeltaInr: o.fare_delta_inr,
      offerTtlS: o.offer_ttl_s,
      allowed: decision.allowed,
      reasons: decision.reasons,
      rulePath: decision.rulePath,
      decisionId: decision.decisionId,
    });
  }
  return out;
}

/**
 * Ranks only the offers the policy allowed. Scoring is a pure, deterministic
 * function of arrival delay, fare delta and connection buffer — no randomness.
 */
export async function rankOptions(offers: OfferDecision[]): Promise<RankedOption[]> {
  await suppliers.sleep(suppliers.latency().rank);
  vclock.advance(LATENCY_MS.rank);

  const originalArrival = ORIGINAL_ITINERARY.legs[0].arriveIso;
  const onwardDeparture = ORIGINAL_ITINERARY.legs[1].departIso;

  const ranked = offers
    .filter((o) => o.allowed && o.offerId !== 'O-PROT-AI111')
    .map((o) => {
      const arrivalDelayHours = hours(originalArrival, o.arriveIso);
      const connectionBufferHours = hours(o.arriveIso, onwardDeparture);
      const score =
        Math.round(
          (100 -
            arrivalDelayHours * 4 -
            (o.fareDeltaInr / 10_000) * 3 +
            Math.min(connectionBufferHours, 8) * 2) *
            100,
        ) / 100;
      return { ...o, arrivalDelayHours, connectionBufferHours, score, rank: 0 };
    })
    .sort((a, b) => b.score - a.score || a.offerId.localeCompare(b.offerId))
    .map((o, i) => ({ ...o, rank: i + 1 }));

  return ranked;
}

/** DGCA duty of care for the disruption as re-accommodated. */
export async function assessDutyOfCare(): Promise<DutyOfCarePacket> {
  const { runId, workflowId } = ids();
  const input = {
    delay_hours: RECOVERY.delayHours,
    overnight_window: RECOVERY.overnightWindow,
    force_majeure: DISRUPTION.forceMajeure,
    block_time_hours: DISRUPTION.blockTimeHours,
    booked_fare_inr: ORIGINAL_ITINERARY.sectorFareInr,
  };
  const d = await evaluateDutyOfCare({
    runId,
    workflowId,
    subject: `DGCA duty of care — ${DISRUPTION.flight} ${DISRUPTION.sector}`,
    input,
  });
  const packet = d.result.packet ?? {};
  return {
    decisionId: d.decisionId,
    rulePath: 'concierge.dutyofcare.packet',
    owed: (d.result.owed ?? []).slice().sort(),
    cashDue: d.result.cash_due === true,
    slabInr: d.result.slab_inr ?? 0,
    compensationInr: d.result.compensation_inr ?? 0,
    delayHours: packet.delay_hours ?? input.delay_hours,
    regulation: packet.regulation ?? 'DGCA CAR Section 3, Series M, Part IV',
    currency: 'INR',
    input,
  };
}

/** Authorises a duty-of-care funded booking (hotel / transfer) against Rego. */
export async function authoriseEntitlement(entitlement: string): Promise<{ decisionId: number; rulePath: string; allowed: boolean }> {
  const { runId, workflowId } = ids();
  const d = await evaluateDutyOfCare({
    runId,
    workflowId,
    subject: `entitlement:${entitlement}`,
    requires: entitlement,
    input: {
      delay_hours: RECOVERY.delayHours,
      overnight_window: RECOVERY.overnightWindow,
      force_majeure: DISRUPTION.forceMajeure,
      block_time_hours: DISRUPTION.blockTimeHours,
      booked_fare_inr: ORIGINAL_ITINERARY.sectorFareInr,
    },
  });
  return { decisionId: d.decisionId, rulePath: d.rulePath, allowed: d.allowed };
}

// ---------------------------------------------------------------------------
// A1..A4 — the forward saga
// ---------------------------------------------------------------------------

export async function reserveVAN(args: {
  amountInr: number;
  merchants: string[];
  decisionId: number;
  rulePath: string;
}): Promise<BookingResult> {
  const { runId } = ids();
  const van = await suppliers.vPaymentReserve({
    amountInr: args.amountInr,
    merchants: args.merchants,
    idempotencyKey: `${runId}:reserveVAN`,
  });
  vclock.advance(LATENCY_MS.book);
  return {
    activityId: 'reserveVAN',
    bookingRef: van.van_id,
    chargedInr: 0,
    status: van.status,
    detail: { ...van },
    decisionId: args.decisionId,
    rulePath: args.rulePath,
  };
}

/**
 * A2 books the replacement MAA->DEL sector and re-protects the onward
 * DEL->LHR leg on the same PNR. Both segments live under one booking, so one
 * compensation (voidFlight) reverts the whole PNR change.
 */
export async function bookFlight(args: {
  offerId: string;
  decisionId: number;
  rulePath: string;
  protectionOfferId: string;
  protectionDecisionId: number;
  protectionRulePath: string;
}): Promise<BookingResult> {
  const { runId } = ids();
  const rebooked = await suppliers.sabreBook({
    offerId: args.offerId,
    pnr: ORIGINAL_ITINERARY.pnr,
    idempotencyKey: `${runId}:bookFlight:${args.offerId}`,
  });
  const protectedLeg = await suppliers.sabreBook({
    offerId: args.protectionOfferId,
    pnr: ORIGINAL_ITINERARY.pnr,
    idempotencyKey: `${runId}:bookFlight:${args.protectionOfferId}`,
  });
  vclock.advance(LATENCY_MS.book);
  return {
    activityId: 'bookFlight',
    bookingRef: rebooked.booking_ref,
    chargedInr: rebooked.charged_inr + protectedLeg.charged_inr,
    status: rebooked.status,
    detail: {
      ...rebooked,
      segments: [
        { ...rebooked, role: 'REBOOKED', decisionId: args.decisionId, rulePath: args.rulePath },
        {
          ...protectedLeg,
          role: 'PROTECTED',
          decisionId: args.protectionDecisionId,
          rulePath: args.protectionRulePath,
        },
      ],
    },
    decisionId: args.decisionId,
    rulePath: args.rulePath,
  };
}

export async function bookHotel(args: {
  offerId: string;
  decisionId: number;
  rulePath: string;
}): Promise<BookingResult> {
  const { runId } = ids();
  const booking = await suppliers.hotelBook({
    offerId: args.offerId,
    idempotencyKey: `${runId}:bookHotel:${args.offerId}`,
  });
  vclock.advance(LATENCY_MS.book);
  return {
    activityId: 'bookHotel',
    bookingRef: booking.booking_ref,
    chargedInr: booking.charged_inr,
    status: booking.status,
    detail: { ...booking },
    decisionId: args.decisionId,
    rulePath: args.rulePath,
  };
}

export async function bookGround(args: {
  offerId: string;
  decisionId: number;
  rulePath: string;
}): Promise<BookingResult> {
  const { runId } = ids();
  const booking = await suppliers.groundBook({
    offerId: args.offerId,
    idempotencyKey: `${runId}:bookGround:${args.offerId}`,
  });
  vclock.advance(LATENCY_MS.book);
  return {
    activityId: 'bookGround',
    bookingRef: booking.booking_ref,
    chargedInr: booking.charged_inr,
    status: booking.status,
    detail: { ...booking },
    decisionId: args.decisionId,
    rulePath: args.rulePath,
  };
}

// ---------------------------------------------------------------------------
// C1..C4 — compensations. Idempotent, keyed on `${workflowRunId}:${activityId}`
// ---------------------------------------------------------------------------

async function compensate(
  activityId: ActivityId,
  compensation: CompensationResult['compensation'],
  bookingRef: string | null,
  order: number,
  run: () => Promise<{ status: string }>,
): Promise<CompensationResult> {
  const { runId } = ids();
  const idempotencyKey = ledger.compensationKey(runId, activityId);
  const claimed = ledger.claimCompensation({ runId, activityId, compensation, payload: { bookingRef } });
  if (!claimed) {
    vclock.advance(LATENCY_MS.compensate);
    return { compensation, activityId, idempotencyKey, applied: false, bookingRef, status: 'ALREADY_COMPENSATED', order };
  }
  const result = bookingRef ? await run() : { status: 'NOTHING_TO_UNDO' };
  vclock.advance(LATENCY_MS.compensate);
  return { compensation, activityId, idempotencyKey, applied: true, bookingRef, status: result.status, order };
}

export async function cancelGround(args: { bookingRef: string | null; order: number }): Promise<CompensationResult> {
  return compensate('bookGround', 'cancelGround', args.bookingRef, args.order, () =>
    suppliers.groundCancel({ bookingRef: args.bookingRef }),
  );
}

export async function cancelHotel(args: { bookingRef: string | null; order: number }): Promise<CompensationResult> {
  return compensate('bookHotel', 'cancelHotel', args.bookingRef, args.order, () =>
    suppliers.hotelCancel({ bookingRef: args.bookingRef! }),
  );
}

export async function voidFlight(args: { bookingRef: string | null; order: number }): Promise<CompensationResult> {
  return compensate('bookFlight', 'voidFlight', args.bookingRef, args.order, () =>
    suppliers.sabreVoid({ bookingRef: args.bookingRef! }),
  );
}

export async function releaseVAN(args: { bookingRef: string | null; order: number }): Promise<CompensationResult> {
  return compensate('reserveVAN', 'releaseVAN', args.bookingRef, args.order, () =>
    suppliers.vPaymentRelease({ vanId: args.bookingRef! }),
  );
}

// ---------------------------------------------------------------------------
// Persistence of the finished run, for the dashboard API
// ---------------------------------------------------------------------------

export async function persistRun(result: unknown): Promise<void> {
  const { runId, workflowId } = ids();
  const r = result as { status: string; mode: string };
  ledger.startRun({ runId, workflowId, mode: r.mode });
  ledger.finishRun({ runId, status: r.status, result });
}
