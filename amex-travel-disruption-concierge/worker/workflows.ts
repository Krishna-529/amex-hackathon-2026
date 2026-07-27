/**
 * The recovery saga.
 *
 * This file is deterministic Temporal workflow code: no I/O, no clock, no
 * randomness, and — deliberately — no policy logic. Its only jobs are to
 * sequence the activities and to own the compensation stack.
 *
 *   A1 reserveVAN   -> C1 releaseVAN
 *   A2 bookFlight   -> C2 voidFlight
 *   A3 bookHotel    -> C3 cancelHotel
 *   A4 bookGround   -> C4 cancelGround
 *
 * Each compensation is registered BEFORE its activity executes. If any
 * forward step fails, the stack unwinds LIFO: C4 -> C3 -> C2 -> C1.
 */

import { proxyActivities, workflowInfo, log, type ActivityOptions } from '@temporalio/workflow';
import type * as activities from './activities';
import type {
  ActivityId,
  BookingResult,
  CompensationId,
  CompensationResult,
  RecoveryResult,
} from './types';

const BASE_OPTS: ActivityOptions = {
  startToCloseTimeout: '2 minutes',
  retry: { initialInterval: '1 second', backoffCoefficient: 2, maximumAttempts: 3 },
};

/**
 * Every activity gets an explicit, readable activityId so the LIFO unwind is
 * legible at a glance in Temporal Web — A1..A4 down, C4..C1 back up.
 */
function step(activityId: string) {
  return proxyActivities<typeof activities>({ ...BASE_OPTS, activityId });
}

interface Registered {
  order: number;
  activityId: ActivityId;
  compensation: CompensationId;
  bookingRef: string | null;
}

export async function travelDisruptionRecovery(params: {
  mode: 'success' | 'rollback';
}): Promise<RecoveryResult> {
  const { runId, workflowId } = workflowInfo();

  // ---- Plan -------------------------------------------------------------
  const disruption = await step('P1-detectDisruption').detectDisruption();
  log.info('Disruption detected', { flight: disruption.flight, sector: disruption.sector });

  await step('P2-gatherContext').gatherContext();
  await step('P3-searchSuppliers').searchSuppliers();

  const offers = await step('P4-gateOffers').gateOffers();
  const ranked = await step('P5-rankOptions').rankOptions(offers);
  const dutyOfCare = await step('P6-assessDutyOfCare').assessDutyOfCare();

  const chosen = ranked[0] ?? null;
  if (!chosen) {
    throw new Error('No policy-approved re-accommodation option — nothing to book.');
  }
  const protection = offers.find((o) => o.offerId === 'O-PROT-AI111');
  if (!protection || !protection.allowed) {
    throw new Error('Onward DEL->LHR protection was not approved by policy.');
  }
  const stay = await step('P7-authoriseHotel').authoriseEntitlement('hotel_and_transfer');

  // ---- Forward saga -----------------------------------------------------
  const stack: Registered[] = [];
  const bookings: BookingResult[] = [];
  const compensations: CompensationResult[] = [];
  let failure: RecoveryResult['failure'] = null;

  const register = (order: number, activityId: ActivityId, compensation: CompensationId): Registered => {
    const entry: Registered = { order, activityId, compensation, bookingRef: null };
    stack.push(entry);
    return entry;
  };

  try {
    // A1 — reserve a single-use Amex virtual account number for the recovery spend
    const a1 = register(1, 'reserveVAN', 'releaseVAN');
    const van = await step('A1-reserveVAN').reserveVAN({
      amountInr: chosen.fareDeltaInr + 12800 + 1450,
      merchants: ['SABRE', 'ANDAZ_DELHI_AEROCITY', 'DELHI_AIRPORT_EXPRESS'],
      decisionId: chosen.decisionId,
      rulePath: chosen.rulePath,
    });
    a1.bookingRef = van.bookingRef;
    bookings.push(van);

    // A2 — rebook MAA->DEL and protect the onward DEL->LHR leg
    const a2 = register(2, 'bookFlight', 'voidFlight');
    const flight = await step('A2-bookFlight').bookFlight({
      offerId: chosen.offerId,
      decisionId: chosen.decisionId,
      rulePath: chosen.rulePath,
      protectionOfferId: protection.offerId,
      protectionDecisionId: protection.decisionId,
      protectionRulePath: protection.rulePath,
    });
    a2.bookingRef = flight.bookingRef;
    bookings.push(flight);

    // A3 — rebook the Delhi hotel, funded by the DGCA duty-of-care entitlement
    const a3 = register(3, 'bookHotel', 'cancelHotel');
    const hotel = await step('A3-bookHotel').bookHotel({
      offerId: 'H-1120',
      decisionId: stay.decisionId,
      rulePath: stay.rulePath,
    });
    a3.bookingRef = hotel.bookingRef;
    bookings.push(hotel);

    // A4 — reset the airport transfer. This is the step that fails on demand.
    const a4 = register(4, 'bookGround', 'cancelGround');
    const ground = await step('A4-bookGround').bookGround({
      offerId: 'G-6631',
      decisionId: stay.decisionId,
      rulePath: stay.rulePath,
    });
    a4.bookingRef = ground.bookingRef;
    bookings.push(ground);
  } catch (err) {
    failure = describeFailure(err, stack);
    log.warn('Forward saga failed — unwinding compensations LIFO', {
      failedActivity: failure.activityId,
      type: failure.type,
    });

    // ---- LIFO rollback: C4 -> C3 -> C2 -> C1 ----------------------------
    for (let i = stack.length - 1; i >= 0; i--) {
      const entry = stack[i];
      const proxy = step(`C${entry.order}-${entry.compensation}`) as unknown as Record<
        CompensationId,
        (a: { bookingRef: string | null; order: number }) => Promise<CompensationResult>
      >;
      const result = await proxy[entry.compensation]({
        bookingRef: entry.bookingRef,
        order: entry.order,
      });
      compensations.push(result);
    }
  }

  const rolledBack = failure !== null;
  const result: RecoveryResult = {
    mode: rolledBack ? 'rollback' : 'success',
    status: rolledBack ? 'ROLLED_BACK' : 'RECOVERED',
    runId,
    workflowId,
    pnr: disruption.sector === 'MAA-DEL' ? '6JQ8XZ' : '6JQ8XZ',
    offersConsidered: offers,
    ranked,
    chosen,
    dutyOfCare,
    bookings,
    compensations,
    failure,
    totalChargedInr: rolledBack ? 0 : bookings.reduce((s, b) => s + b.chargedInr, 0),
  };

  await step('P8-persistRun').persistRun(result);
  return result;
}

/**
 * Unwraps Temporal's ActivityFailure -> ApplicationFailure chain to recover the
 * original error `type` (CarrierUnavailableError) and which activity raised it.
 */
function describeFailure(err: unknown, stack: Registered[]): NonNullable<RecoveryResult['failure']> {
  let e: any = err;
  const seen = new Set<any>();
  while (e && typeof e === 'object' && !e.type && e.cause && !seen.has(e)) {
    seen.add(e);
    e = e.cause;
  }
  const failedActivity = stack.length ? stack[stack.length - 1].activityId : 'unknown';
  return {
    activityId: failedActivity,
    type: e?.type ?? e?.name ?? 'UnknownError',
    message: e?.message ?? String(err),
  };
}
