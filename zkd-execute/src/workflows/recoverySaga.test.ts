/**
 * The real Temporal saga-ordering test: runs the actual `recoverySaga`
 * workflow against Temporal's official local test server
 * (`@temporalio/testing`), with mock activity implementations swapped in so
 * this test asserts WORKFLOW LOGIC (forward order, compensation
 * registration, LIFO unwind, disposeOriginal never firing on a rollback) —
 * not OPA/payment/supplier behaviour, which the mocks below stand in for.
 * `zkd-execute/src/activities.ts` (the real activities, calling real OPA and
 * the real/mock suppliers) is exercised separately by the docker-compose
 * integration test — see documentation/architecture/execution-plane.md.
 *
 * Needs network access on first run only, to fetch Temporal's test-server
 * binary (cached afterwards under the OS temp dir).
 */
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { ApplicationFailure } from '@temporalio/common';
import type { RecoveryIntent } from 'zkd-shared';
import type * as activities from '../activities';
import { recoverySaga } from './recoverySaga';

let testEnv: TestWorkflowEnvironment;
let calls: string[] = [];
let failAt: string | null = null;

beforeAll(async () => {
  testEnv = await TestWorkflowEnvironment.createLocal();
}, 60_000);

afterAll(async () => {
  await testEnv?.teardown();
});

beforeEach(() => {
  calls = [];
  failAt = null;
});

function maybeFail(step: string) {
  calls.push(step);
  // Non-retryable: this is a deliberate test trigger, not a transient fault,
  // so the workflow should see exactly one failed attempt, matching how
  // failureInjection.ts's real INJECT-FAIL- marker behaves in production.
  if (failAt === step) throw ApplicationFailure.nonRetryable(`injected failure at ${step}`, 'InjectedFailure');
}

const mockActivities: typeof activities = {
  reserveVAN: async () => {
    maybeFail('reserveVAN');
    return { confirmationNumber: 'van-1' };
  },
  bookFlight: async () => {
    maybeFail('bookFlight');
    return { confirmationNumber: 'flt-1', pnr: 'ABC123' };
  },
  bookHotel: async (intent) => {
    if (!intent.hotel) return null;
    maybeFail('bookHotel');
    return { confirmationNumber: 'htl-1' };
  },
  bookGround: async (intent) => {
    if (!intent.ground) return null;
    maybeFail('bookGround');
    return { confirmationNumber: 'grd-1' };
  },
  disposeOriginal: async () => {
    maybeFail('disposeOriginal');
    return { disposed: true };
  },
  releaseVAN: async () => {
    calls.push('releaseVAN');
    return { released: true };
  },
  voidFlight: async () => {
    calls.push('voidFlight');
    return { cancelled: true };
  },
  cancelHotel: async () => {
    calls.push('cancelHotel');
    return { cancelled: true };
  },
  cancelGround: async () => {
    calls.push('cancelGround');
    return { cancelled: true };
  },
};

function baseIntent(overrides: Partial<RecoveryIntent> = {}): RecoveryIntent {
  const now = Date.now();
  return {
    idempotencyKey: `test-${randomUUID()}`,
    pnr: 'ABC123',
    originalBookingId: 'orig-1',
    memberId: 'mem-1',
    partySize: 1,
    travellerIds: ['trav-1'],
    passenger: {
      givenName: 'Priya', familyName: 'Sundaram', dob: '1988-03-14',
      gender: 'f', email: 'p@example.com', phoneNumber: '+911234567890',
    },
    consent: 'ask',
    disposition: 'involuntary',
    flight: {
      supplier: 'sabre', supplierOfferId: 'off-1', flightCode: 'AI101', from: 'MAA', to: 'DEL',
      departsAtMs: now + 3_600_000, cabin: 'Economy', price: { amount: 5000, currency: 'INR' },
      expiresAtMs: now + 600_000,
    },
    hotel: null,
    ground: null,
    perTransactionCap: { amount: 25000, currency: 'INR' },
    policyInput: {
      consent: 'ask', originalFlightOperated: false, offerId: 'off-1', rejectedOfferIds: [],
      cabinRank: 0, cabinEntitlementRank: 0, fareDelta: 0, fareDeltaCap: 25000,
      departureAtMs: now + 3_600_000, travelWindowStartMs: now, travelWindowEndMs: now + 86_400_000,
      seatsAvailable: 4, partySize: 1,
    },
    callbackUrl: null,
    requestedAt: now,
    ...overrides,
  };
}

async function runSaga(intent: RecoveryIntent) {
  // A fresh task queue per call — the Temporal Core runtime rejects a second
  // worker registering on a queue it's already bound to within the same
  // process, even sequentially across tests, so reusing one queue name
  // across `it()` blocks fails on the second call.
  const taskQueue = `test-execute-${randomUUID()}`;
  const worker = await Worker.create({
    connection: testEnv.nativeConnection,
    taskQueue,
    workflowsPath: fileURLToPath(new URL('./recoverySaga.ts', import.meta.url)),
    activities: mockActivities,
  });
  return worker.runUntil(
    testEnv.client.workflow.execute(recoverySaga, {
      workflowId: `wf-${randomUUID()}`,
      taskQueue,
      args: [intent],
    }),
  );
}

describe('recoverySaga', () => {
  it('runs the full forward chain and disposes the original last, on a clean success', async () => {
    const result = await runSaga(baseIntent({ hotel: hotelSnapshot(), ground: groundSnapshot() }));
    expect(result.terminal).toBe('CONFIRMED');
    expect(calls).toEqual(['reserveVAN', 'bookFlight', 'bookHotel', 'bookGround', 'disposeOriginal']);
  });

  it('skips hotel/ground steps entirely when the intent has none, without erroring', async () => {
    const result = await runSaga(baseIntent());
    expect(result.terminal).toBe('CONFIRMED');
    expect(calls).toEqual(['reserveVAN', 'bookFlight', 'disposeOriginal']);
  });

  it('rolls back LIFO when bookHotel fails: voidFlight then releaseVAN, in that order, and cancelGround never runs because bookGround was never reached', async () => {
    failAt = 'bookHotel';
    const result = await runSaga(baseIntent({ hotel: hotelSnapshot(), ground: groundSnapshot() }));
    expect(result.terminal).toBe('ROLLED_BACK');
    expect(calls).toEqual(['reserveVAN', 'bookFlight', 'bookHotel', 'voidFlight', 'releaseVAN']);
    expect(calls).not.toContain('cancelGround');
    expect(calls).not.toContain('disposeOriginal');
  });

  it('rolls back the full chain when bookGround fails: cancelGround, cancelHotel, voidFlight, releaseVAN', async () => {
    failAt = 'bookGround';
    const result = await runSaga(baseIntent({ hotel: hotelSnapshot(), ground: groundSnapshot() }));
    expect(result.terminal).toBe('ROLLED_BACK');
    expect(calls).toEqual([
      'reserveVAN', 'bookFlight', 'bookHotel', 'bookGround',
      'cancelHotel', 'voidFlight', 'releaseVAN',
    ]);
    expect(calls).not.toContain('disposeOriginal');
  });

  it('never disposes the original when the saga rolls back — a cancellation has no inverse', async () => {
    failAt = 'bookFlight';
    const result = await runSaga(baseIntent());
    expect(result.terminal).toBe('ROLLED_BACK');
    expect(calls).not.toContain('disposeOriginal');
  });

  it('reports the failure reason and the full step ledger on rollback', async () => {
    failAt = 'bookHotel';
    const result = await runSaga(baseIntent({ hotel: hotelSnapshot() }));
    expect(result.failureReason).toContain('bookHotel');
    const stepNames = result.steps.map((s) => s.step);
    expect(stepNames).toEqual(['reserveVAN', 'bookFlight', 'bookHotel', 'voidFlight', 'releaseVAN']);
    expect(result.steps.find((s) => s.step === 'bookHotel')?.outcome).toBe('failed');
    expect(result.steps.find((s) => s.step === 'voidFlight')?.outcome).toBe('ok');
  });
});

function hotelSnapshot() {
  return { supplierOfferId: 'htl-off-1', name: 'Test Hotel', checkin: '2026-01-01', rooms: 1, rate: { amount: 4000, currency: 'INR' } };
}

function groundSnapshot() {
  return {
    supplierOfferId: 'grd-off-1', kind: 'sedan', vehicles: 1,
    legs: [{ from: 'MAA', to: 'City', pickupISO: '2026-01-01T10:00:00Z' }],
    extra: { amount: 500, currency: 'INR' },
  };
}
