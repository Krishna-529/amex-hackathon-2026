/**
 * PLAN's only touchpoint with EXECUTE: start a Temporal workflow and await
 * its result. This module depends on `@temporalio/client` (a generic client
 * SDK — it can start a workflow by task-queue + registered name, it cannot
 * run one) and `zkd-shared` (types only). It never imports zkd-execute's
 * package, which is where the actual booking-write code and secrets live —
 * there is no dependency edge by which this process could even reach that
 * code, let alone run it.
 *
 * Starting a workflow is a proposal, not an execution: the Temporal WORKER
 * (a separate process, in zkd-execute) is what actually runs the saga's
 * activities. This mirrors the atlas's Layer A/Layer B split onto Temporal's
 * own client/worker split, rather than inventing a parallel mechanism.
 */
import { Client, Connection, WorkflowIdReusePolicy } from '@temporalio/client';
import type { RecoveryIntent, SagaResult } from 'zkd-shared';

const TASK_QUEUE = process.env.TEMPORAL_TASK_QUEUE ?? 'execute';
const WORKFLOW_TYPE = 'recoverySaga';

let clientPromise: Promise<Client> | null = null;

async function getClient(): Promise<Client> {
  if (!clientPromise) {
    // Local dev default matches docker-compose.yml's host port (7234, not
    // Temporal's usual 7233) — this machine may already run an unrelated
    // project's Temporal on 7233, see docker-compose.yml's header comment.
    clientPromise = Connection.connect({ address: process.env.TEMPORAL_ADDRESS ?? 'localhost:7234' }).then(
      (connection) => new Client({ connection, namespace: process.env.TEMPORAL_NAMESPACE ?? 'default' }),
    );
  }
  return clientPromise;
}

/**
 * Starts (or, on a retried idempotency key, reuses) the recovery saga and
 * awaits its terminal result. `intent.idempotencyKey` is the workflowId —
 * `REJECT_DUPLICATE` means a second call with the same key never starts a
 * second real booking; it errors, and the caller should fetch the existing
 * run's result instead (see `awaitExistingSaga` below) rather than treating
 * that error as a failure to report to the member.
 */
export async function startRecoverySaga(intent: RecoveryIntent): Promise<SagaResult> {
  const client = await getClient();
  const handle = await client.workflow.start(WORKFLOW_TYPE, {
    taskQueue: TASK_QUEUE,
    workflowId: intent.idempotencyKey,
    workflowIdReusePolicy: WorkflowIdReusePolicy.WORKFLOW_ID_REUSE_POLICY_REJECT_DUPLICATE,
    args: [intent],
  });
  return handle.result() as Promise<SagaResult>;
}

/** Awaits an already-running (or already-completed) saga by its idempotency
 *  key — the path a retry after escalation should take instead of starting
 *  a second workflow with the same business entity. */
export async function awaitExistingSaga(idempotencyKey: string): Promise<SagaResult> {
  const client = await getClient();
  const handle = client.workflow.getHandle(idempotencyKey);
  return handle.result() as Promise<SagaResult>;
}

export type RunningSaga = { workflowId: string; runId: string; startTime: string | null };

/** The /ops console's visibility into in-flight sagas — before this, an
 *  operator watching /ops could trigger a disruption and see it settle, but
 *  had no way to see or interrupt a saga once ACT started it. Uses
 *  Temporal's standard visibility query (works against the basic SQL
 *  visibility store docker-compose.yml provisions — no Elasticsearch
 *  required), not a separate tracking table. */
export async function listRunningSagas(): Promise<RunningSaga[]> {
  const client = await getClient();
  const sagas: RunningSaga[] = [];
  for await (const info of client.workflow.list({ query: `WorkflowType='${WORKFLOW_TYPE}' AND ExecutionStatus='Running'` })) {
    sagas.push({
      workflowId: info.workflowId,
      runId: info.runId,
      startTime: info.startTime ? new Date(info.startTime).toISOString() : null,
    });
  }
  return sagas;
}

/**
 * The kill switch itself: requests Temporal-level cancellation of a running
 * saga. recoverySaga.ts needs no changes to support this — its own forward
 * chain is wrapped in a single try/catch that already runs full LIFO
 * compensation on ANY thrown error, and Temporal's default cancellation
 * scope propagates a CancelledFailure into whichever activity the workflow
 * is currently awaiting. A cancelled saga therefore unwinds through the
 * exact same, already-tested compensation path a real activity failure
 * would (see zkd-execute/src/workflows/recoverySaga.integration.test.ts),
 * not a special case bolted on here.
 */
export async function haltRecoverySaga(workflowId: string): Promise<void> {
  const client = await getClient();
  const handle = client.workflow.getHandle(workflowId);
  await handle.cancel();
}
