/**
 * The real end-to-end proof: starts actual workflow executions against the
 * actual running docker-compose stack (`docker compose up postgres temporal
 * opa zkd-execute`) — real Temporal server, real containerized worker
 * running the REAL `src/activities.ts` (not the mocked activities
 * `recoverySaga.test.ts` uses), which means every run here also exercises
 * the real OPA sidecar over the network and the realistic mock
 * suppliers/payment client inside the container. This is what
 * `npm run test:integration` runs — separate from the fast unit suite
 * because it needs the stack up first.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, Connection, WorkflowIdReusePolicy } from '@temporalio/client';
import type { RecoveryIntent } from 'zkd-shared';

const TEMPORAL_ADDRESS = process.env.TEMPORAL_ADDRESS ?? 'localhost:7234';
const TASK_QUEUE = 'execute';

let client: Client;
let connection: Connection;

beforeAll(async () => {
  connection = await Connection.connect({ address: TEMPORAL_ADDRESS });
  client = new Client({ connection });
}, 30_000);

afterAll(async () => {
  await connection?.close();
});

function baseIntent(overrides: Partial<RecoveryIntent> = {}): RecoveryIntent {
  const now = Date.now();
  return {
    idempotencyKey: `it-${randomUUID()}`,
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
    hotel: {
      supplierOfferId: 'htl-off-1', name: 'Test Hotel', checkin: '2026-01-01', rooms: 1,
      rate: { amount: 4000, currency: 'INR' },
    },
    ground: null,
    perTransactionCap: { amount: 25000, currency: 'INR' },
    policyInput: {
      // a "clean" candidate — passes every rule in policy/execute.rego
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

describe('recoverySaga — real Docker stack (Temporal + OPA + zkd-execute)', () => {
  it('confirms a clean recovery through the real containerized worker, real OPA, and the real (mocked-fallback) suppliers', async () => {
    const intent = baseIntent();
    const handle = await client.workflow.start('recoverySaga', {
      taskQueue: TASK_QUEUE,
      workflowId: intent.idempotencyKey,
      args: [intent],
    });
    const result = await handle.result();

    expect(result.terminal).toBe('CONFIRMED');
    expect(result.bookingRefs?.confirmationNumbers.bookFlight).toBeTruthy();
    expect(result.bookingRefs?.confirmationNumbers.bookHotel).toBeTruthy();
    expect(result.steps.map((s: { step: string }) => s.step)).toEqual([
      'reserveVAN', 'bookFlight', 'bookHotel', 'disposeOriginal',
    ]);
  });

  it('rejects a duplicate start of the same idempotency key — Temporal enforces this, not app code (matches server/engine/actExecutor.ts, which sets the same reuse policy)', async () => {
    const intent = baseIntent();
    const reusePolicy = WorkflowIdReusePolicy.WORKFLOW_ID_REUSE_POLICY_REJECT_DUPLICATE;
    const first = await client.workflow.start('recoverySaga', {
      taskQueue: TASK_QUEUE,
      workflowId: intent.idempotencyKey,
      workflowIdReusePolicy: reusePolicy,
      args: [intent],
    });
    await first.result();

    await expect(
      client.workflow.start('recoverySaga', {
        taskQueue: TASK_QUEUE,
        workflowId: intent.idempotencyKey, // same key — same business entity, same attempt
        workflowIdReusePolicy: reusePolicy,
        args: [intent],
      }),
    ).rejects.toThrow();
  });

  it('rolls back through the real stack when a booking is marked to fail — real OPA and real mock suppliers exercise the LIFO compensation', async () => {
    const intent = baseIntent({
      hotel: {
        supplierOfferId: 'INJECT-FAIL-hotel', name: 'Poisoned Hotel', checkin: '2026-01-01',
        rooms: 1, rate: { amount: 4000, currency: 'INR' },
      },
    });
    const handle = await client.workflow.start('recoverySaga', {
      taskQueue: TASK_QUEUE,
      workflowId: intent.idempotencyKey,
      args: [intent],
    });
    const result = await handle.result();

    expect(result.terminal).toBe('ROLLED_BACK');
    const stepNames = result.steps.map((s: { step: string }) => s.step);
    expect(stepNames).toEqual(['reserveVAN', 'bookFlight', 'bookHotel', 'voidFlight', 'releaseVAN']);
    expect(result.failureReason).toContain('bookHotel');
  });

  it('denies at the real OPA gate when the fare delta exceeds the cap — caught at the very first step, nothing else ever runs', async () => {
    const intent = baseIntent({
      policyInput: {
        ...baseIntent().policyInput,
        fareDelta: 99999,
        fareDeltaCap: 25000,
      },
    });
    const handle = await client.workflow.start('recoverySaga', {
      taskQueue: TASK_QUEUE,
      workflowId: intent.idempotencyKey,
      args: [intent],
    });
    const result = await handle.result();

    // enforcePolicy runs inside reserveVAN too — the very first step — so a
    // policy denial on the whole intent is caught before anything is
    // reserved and there is nothing to compensate.
    expect(result.terminal).toBe('ROLLED_BACK');
    expect(result.failureReason).toContain('policy denied');
    expect(result.failureReason).toContain('fare_delta_cap');
    expect(result.steps.map((s: { step: string }) => s.step)).toEqual(['reserveVAN']);
  });
});
