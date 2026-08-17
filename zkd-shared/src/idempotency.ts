import { createHash } from 'node:crypto';

export type IdempotencyInput = {
  pnr: string;
  /** the leg/segment being recovered — a party with two legs must not share one key */
  segment: string;
  memberId: string;
  /** e.g. 'recover-cancellation' — bump only for a genuinely new business
   *  attempt, never for a retry of the same one */
  intent: string;
};

/**
 * The idempotency key MUST derive from the business entity, never from a
 * workflow/process run — a run-scoped key defeats activity retry and books
 * the leg twice on a reset or a re-run after escalation (03-action-policy.md
 * §6). This is used directly as the Temporal workflowId, so
 * WorkflowIdReusePolicy.REJECT_DUPLICATE enforces the dedupe structurally —
 * this function's only job is to be a stable, deterministic function of the
 * business entity, never of when or how many times it was called.
 */
export function deriveIdempotencyKey(input: IdempotencyInput): string {
  const material = `${input.pnr}:${input.segment}:${input.memberId}:${input.intent}`;
  const hash = createHash('sha256').update(material).digest('hex').slice(0, 32);
  return `recovery-${hash}`;
}
