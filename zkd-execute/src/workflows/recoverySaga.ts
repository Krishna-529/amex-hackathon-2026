/**
 * The saga (03-action-policy.md §6, architecture diagram Part 04): forward
 * `reserveVAN → bookFlight → bookHotel → bookGround`, then terminal
 * `disposeOriginal` outside the chain. Each compensation is registered
 * BEFORE its side effect runs — pushed onto `compensations` only after the
 * forward activity itself succeeds — and on any failure the stack unwinds
 * LIFO: `cancelGround → cancelHotel → voidFlight → releaseVAN`.
 *
 * Temporal is what makes this a *real* saga rather than a try/catch that
 * only looks like one: activities are durably retried per their own retry
 * policy before this workflow ever sees a failure, the workflow's own
 * execution history survives a worker crash and resumes exactly where it
 * left off, and the workflowId (== the idempotency key derived from the
 * business entity, never from this run) is what Temporal itself uses to
 * reject a duplicate start — see zkd-shared/src/idempotency.ts.
 */
import { proxyActivities } from '@temporalio/workflow';
import type { RecoveryIntent, SagaResult, SagaStepRecord, CompensationStepName } from 'zkd-shared';
import type * as activities from '../activities';

const {
  reserveVAN, bookFlight, bookHotel, bookGround, disposeOriginal,
  releaseVAN, voidFlight, cancelHotel, cancelGround,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: '30 seconds',
  retry: { maximumAttempts: 3, initialInterval: '1 second', backoffCoefficient: 2 },
});

type Compensation = { step: CompensationStepName; run: () => Promise<{ cancelled: boolean } | { released: boolean }> };

/** Temporal wraps an activity's thrown error in ActivityFailure (often with
 *  a generic top-level message like "Activity task failed") with the real
 *  cause chained underneath — unwrap to the deepest message so the saga's
 *  own failure reason is the actual reason, not Temporal's envelope. */
function unwrapMessage(e: unknown): string {
  if (e instanceof Error) {
    const cause = (e as Error & { cause?: unknown }).cause;
    if (cause) return unwrapMessage(cause);
    return e.message;
  }
  return String(e);
}

export async function recoverySaga(intent: RecoveryIntent): Promise<SagaResult> {
  const steps: SagaStepRecord[] = [];
  const compensations: Compensation[] = [];

  async function record<T>(
    name: SagaStepRecord['step'],
    action: () => Promise<T>,
  ): Promise<T> {
    const startedAt = Date.now();
    try {
      const result = await action();
      steps.push({ step: name, kind: 'forward', startedAt, finishedAt: Date.now(), outcome: 'ok' });
      return result;
    } catch (e) {
      steps.push({
        step: name, kind: 'forward', startedAt, finishedAt: Date.now(), outcome: 'failed',
        detail: unwrapMessage(e),
      });
      throw e;
    }
  }

  try {
    const van = await record('reserveVAN', () => reserveVAN(intent));
    compensations.push({ step: 'releaseVAN', run: () => releaseVAN(intent, van) });

    const flightBooking = await record('bookFlight', () => bookFlight(intent));
    compensations.push({ step: 'voidFlight', run: () => voidFlight(intent, flightBooking) });

    const hotelBooking = intent.hotel ? await record('bookHotel', () => bookHotel(intent)) : null;
    if (hotelBooking) compensations.push({ step: 'cancelHotel', run: () => cancelHotel(intent, hotelBooking) });

    const groundBooking = intent.ground ? await record('bookGround', () => bookGround(intent)) : null;
    if (groundBooking) compensations.push({ step: 'cancelGround', run: () => cancelGround(intent, groundBooking) });

    // Outside the compensation chain by construction — nothing above pushed
    // a compensation for it, and nothing below can trigger one either.
    const disposeStart = Date.now();
    await disposeOriginal(intent);
    steps.push({ step: 'disposeOriginal', kind: 'forward', startedAt: disposeStart, finishedAt: Date.now(), outcome: 'ok' });

    return {
      idempotencyKey: intent.idempotencyKey,
      terminal: 'CONFIRMED',
      steps,
      bookingRefs: {
        pnr: flightBooking.pnr,
        confirmationNumbers: {
          reserveVAN: van.confirmationNumber,
          bookFlight: flightBooking.confirmationNumber,
          bookHotel: hotelBooking?.confirmationNumber,
          bookGround: groundBooking?.confirmationNumber,
        },
      },
      settledAt: Date.now(),
    };
  } catch (e) {
    // LIFO unwind — reverse of push order, i.e. reverse of forward order.
    for (const comp of [...compensations].reverse()) {
      const startedAt = Date.now();
      try {
        await comp.run();
        steps.push({ step: comp.step, kind: 'compensation', startedAt, finishedAt: Date.now(), outcome: 'ok' });
      } catch (compErr) {
        // Compensation *initiated* is not compensation *completed* — record
        // the failure and keep unwinding the rest of the stack; a void
        // outside the airline's void window becomes an async refund and
        // this state routes to escalation rather than a clean no-op.
        steps.push({
          step: comp.step, kind: 'compensation', startedAt, finishedAt: Date.now(), outcome: 'failed',
          detail: unwrapMessage(compErr),
        });
      }
    }
    return {
      idempotencyKey: intent.idempotencyKey,
      terminal: 'ROLLED_BACK',
      steps,
      failureReason: unwrapMessage(e),
      settledAt: Date.now(),
    };
  }
}
