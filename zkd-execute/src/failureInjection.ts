import { ApplicationFailure } from '@temporalio/common';
import type { RecoveryIntent, SagaStepName } from 'zkd-shared';

/**
 * A demo/test-only hook: any supplier offer id prefixed `INJECT-FAIL-`
 * deliberately fails at book time. This is what lets a demo (via the /ops
 * console picking a specifically-tagged seeded candidate) or an integration
 * test reliably exercise the compensation path — without it, there would be
 * no way to demo ROLLED_BACK on stage without waiting for a real supplier to
 * genuinely fail.
 */
export function checkInjectedFailure(step: SagaStepName, intent: RecoveryIntent): void {
  const marker = 'INJECT-FAIL-';
  const targets: Partial<Record<SagaStepName, string | undefined>> = {
    bookFlight: intent.flight.supplierOfferId,
    bookHotel: intent.hotel?.supplierOfferId,
    bookGround: intent.ground?.supplierOfferId,
  };
  const id = targets[step];
  if (id?.startsWith(marker)) {
    // Deliberate and deterministic — retrying it 3 times would just waste
    // the demo's time before landing on the same rollback either way.
    throw ApplicationFailure.nonRetryable(`injected failure at ${step} (offer ${id})`, 'InjectedFailure');
  }
}
