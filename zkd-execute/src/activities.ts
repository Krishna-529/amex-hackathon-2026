/**
 * Every activity below is a real side effect (or the realistic mock standing
 * in for one — see suppliers/*). Every one of them calls the local OPA
 * sidecar FIRST, immediately before mutating anything: this is the actual
 * enforcement point for "every side effect requires exactly one allow"
 * (architecture diagram Part 03) — PLAN's own OPA check (in zkd-app) is a
 * cheap early filter, never trusted as the authorization on its own.
 *
 * Compensations take the forward step's own result as an argument rather
 * than re-deriving what to undo — a compensation cancels the SPECIFIC
 * booking reference that was made, never "whatever is under this key".
 */
import { ApplicationFailure } from '@temporalio/common';
import { evaluatePolicy, type RecoveryIntent, type SagaStepName } from 'zkd-shared';
import { issueVirtualCard, releaseVirtualCard } from './payments/vpayment';
import { bookFlight as duffelBookFlight, cancelFlight as duffelCancelFlight } from './suppliers/duffelWrite';
import { mockBook, mockCancel } from './suppliers/mockBookingSupplier';
import { checkInjectedFailure } from './failureInjection';
import { logPolicyDecision, logSagaStep } from './ledger';

async function enforcePolicy(step: SagaStepName, intent: RecoveryIntent): Promise<void> {
  const decision = await evaluatePolicy(intent.policyInput);
  logPolicyDecision({ idempotencyKey: intent.idempotencyKey, step, decision });
  if (!decision.allow) {
    const reason = decision.failClosed
      ? `OPA unreachable (${decision.note ?? 'fail-closed'})`
      : `policy denied: ${decision.deny.join(', ')}`;
    throw new Error(`${step} blocked — ${reason}`);
  }
}

// --- Forward steps -----------------------------------------------------

export async function reserveVAN(intent: RecoveryIntent): Promise<{ confirmationNumber: string }> {
  await enforcePolicy('reserveVAN', intent);
  const totalOwed = (intent.hotel ? intent.hotel.rate.amount * intent.hotel.rooms : 0) + (intent.ground?.extra.amount ?? 0);
  const card = await issueVirtualCard({
    idempotencyKey: intent.idempotencyKey,
    amount: totalOwed,
    currency: intent.perTransactionCap.currency,
  });
  return { confirmationNumber: card.cardId };
}

export async function bookFlight(intent: RecoveryIntent): Promise<{ confirmationNumber: string; pnr: string }> {
  checkInjectedFailure('bookFlight', intent);
  await enforcePolicy('bookFlight', intent);
  if (intent.flight.supplier === 'duffel') {
    return duffelBookFlight(intent.idempotencyKey, {
      supplierOfferId: intent.flight.supplierOfferId,
      amount: intent.flight.price.amount,
      currency: intent.flight.price.currency,
      passenger: intent.passenger,
    });
  }
  const mock = await mockBook(intent.idempotencyKey, 'flight');
  return { confirmationNumber: mock.confirmationNumber, pnr: intent.pnr };
}

export async function bookHotel(intent: RecoveryIntent): Promise<{ confirmationNumber: string } | null> {
  if (!intent.hotel) return null;
  checkInjectedFailure('bookHotel', intent);
  await enforcePolicy('bookHotel', intent);
  return mockBook(intent.idempotencyKey, 'hotel');
}

export async function bookGround(intent: RecoveryIntent): Promise<{ confirmationNumber: string } | null> {
  if (!intent.ground) return null;
  checkInjectedFailure('bookGround', intent);
  await enforcePolicy('bookGround', intent);
  return mockBook(intent.idempotencyKey, 'ground');
}

/**
 * Deliberately outside the compensation chain — a cancellation has no
 * inverse, so the original is only released once every step above has
 * succeeded (03-action-policy.md §6). If this throws, the workflow does NOT
 * roll back the new booking that already succeeded — the replacement
 * stands; disposal is retried by Temporal's own activity retry policy, and
 * persistent failure here routes to escalation, never to silently stranding
 * the member with two live bookings.
 */
export async function disposeOriginal(intent: RecoveryIntent): Promise<{ disposed: boolean }> {
  await mockCancel(intent.originalBookingId, 'flight');
  return { disposed: true };
}

// --- Compensations (LIFO) -----------------------------------------------

export async function releaseVAN(
  intent: RecoveryIntent,
  card: { confirmationNumber: string },
): Promise<{ released: boolean }> {
  const result = await releaseVirtualCard(intent.idempotencyKey);
  void card;
  logSagaStepCompensation('releaseVAN', intent, result.released);
  return result;
}

export async function voidFlight(
  intent: RecoveryIntent,
  booking: { confirmationNumber: string },
): Promise<{ cancelled: boolean }> {
  const result =
    intent.flight.supplier === 'duffel'
      ? await duffelCancelFlight(intent.idempotencyKey, booking.confirmationNumber)
      : await mockCancel(intent.idempotencyKey, 'flight', booking.confirmationNumber);
  logSagaStepCompensation('voidFlight', intent, result.cancelled);
  return result;
}

export async function cancelHotel(
  intent: RecoveryIntent,
  booking: { confirmationNumber: string },
): Promise<{ cancelled: boolean }> {
  const result = await mockCancel(intent.idempotencyKey, 'hotel', booking.confirmationNumber);
  logSagaStepCompensation('cancelHotel', intent, result.cancelled);
  return result;
}

export async function cancelGround(
  intent: RecoveryIntent,
  booking: { confirmationNumber: string },
): Promise<{ cancelled: boolean }> {
  const result = await mockCancel(intent.idempotencyKey, 'ground', booking.confirmationNumber);
  logSagaStepCompensation('cancelGround', intent, result.cancelled);
  return result;
}

function logSagaStepCompensation(step: string, intent: RecoveryIntent, ok: boolean): void {
  logSagaStep({
    idempotencyKey: intent.idempotencyKey,
    step: step as SagaStepName,
    kind: 'compensation',
    startedAt: Date.now(),
    finishedAt: Date.now(),
    outcome: ok ? 'ok' : 'failed',
  });
}
