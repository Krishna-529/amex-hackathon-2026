/**
 * EXECUTE's own decision ledger — same JSONL-append pattern as
 * zkd-app/server/decisionLedger.ts (deliberately not shared code: this is a
 * separately-deployed process with its own filesystem/eventual S3 prefix,
 * see infra/execution-plane/README.md). Every policy decision and every
 * saga step this plane makes is logged here, so "reconstructable after the
 * fact" (03-action-policy.md §2) holds for the EXECUTE side too, not just
 * predictions and thresholds on the PLAN side.
 */
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { PolicyDecisionLedgerEntry, SagaStepLedgerEntry } from 'zkd-shared';

const STATE_DIR = join(process.cwd(), '.state');
const POLICY_PATH = join(STATE_DIR, 'policy-decisions.jsonl');
const SAGA_PATH = join(STATE_DIR, 'saga-steps.jsonl');

function appendLine(path: string, obj: unknown): void {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
  appendFileSync(path, JSON.stringify(obj) + '\n');
}

export function logPolicyDecision(entry: Omit<PolicyDecisionLedgerEntry, 'loggedAt'>): void {
  try {
    appendLine(POLICY_PATH, { ...entry, loggedAt: Date.now() } satisfies PolicyDecisionLedgerEntry);
  } catch (e) {
    console.error('[zkd-execute ledger] failed to log policy decision:', e);
  }
}

export function logSagaStep(entry: Omit<SagaStepLedgerEntry, 'loggedAt'>): void {
  try {
    appendLine(SAGA_PATH, { ...entry, loggedAt: Date.now() } satisfies SagaStepLedgerEntry);
  } catch (e) {
    console.error('[zkd-execute ledger] failed to log saga step:', e);
  }
}
