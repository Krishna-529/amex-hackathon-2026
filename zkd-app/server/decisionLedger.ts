/**
 * Local, real shape of the same decision ledger
 * zkd-risk-model/src/handler.py writes to S3 in the AWS path
 * (`DECISION_LEDGER_BUCKET`, see infra/scoring.tf) — this is the dev/pilot
 * equivalent, so "every prediction and every observed outcome gets logged"
 * (README.md / documentation/design/05-cancellation-risk-model.md §2) is
 * true in this environment too, not only in unapplied Terraform.
 *
 * Each of the five streams below is its own hash chain (server/hashChain.ts):
 * every entry embeds the previous entry's hash, so an after-the-fact edit or
 * deletion anywhere in a file breaks every hash after it — checkable with
 * verifyChain() without trusting the file's own claims about itself. Every
 * write is also best-effort mirrored to S3 (server/decisionLedgerS3.ts) when
 * DECISION_LEDGER_BUCKET is configured, so the record survives a container
 * restart — local disk alone does not survive an ECS redeploy, and
 * app_desired_count >= 2 in prod means "local disk" was never one file to
 * begin with.
 *
 * Reconciliation (joining a flight's logged predictions against its
 * eventually-observed outcome, to measure real accuracy on LIVE: entities
 * as they accumulate) is intentionally NOT built here — that's an offline
 * read over both JSONL files below, and belongs in the retrain pipeline
 * (zkd-risk-model/) once there's enough real outcome volume to be worth
 * running, not duplicated as a second implementation in the Node app.
 */
import { join } from 'path';
import { appendChainedLine } from './hashChain';
import { mirrorToS3 } from './decisionLedgerS3';
import type { ModelScore } from './engine/riskModel';
import type { ThresholdEvaluationLedgerEntry, PolicyDecisionLedgerEntry, SagaStepLedgerEntry } from 'zkd-shared';

const STATE_DIR = join(process.cwd(), 'server', '.state');
const PREDICTIONS_PATH = join(STATE_DIR, 'predictions.jsonl');
const OUTCOMES_PATH = join(STATE_DIR, 'outcomes.jsonl');
const THRESHOLDS_PATH = join(STATE_DIR, 'threshold-evaluations.jsonl');
const POLICY_PATH = join(STATE_DIR, 'policy-decisions.jsonl');
const SAGA_PATH = join(STATE_DIR, 'saga-steps.jsonl');

function record(stream: string, path: string, entry: object): void {
  try {
    const chained = appendChainedLine(path, entry);
    mirrorToS3(stream, chained);
  } catch (e) {
    // Never let ledger I/O break a real forecast — logging is observability,
    // not the critical path.
    console.error(`[decisionLedger] failed to log ${stream} entry:`, e);
  }
}

export type PredictionLedgerEntry = {
  flightId: string;
  cancelProbability: number;
  confidence: number;
  modelVersion: string;
  source: ModelScore['source'];
  loggedAt: number;
};

/** Called from server/engine/forecast.ts's applyScore — the single place a
 *  real ModelScore becomes a forecast, on-demand or from the batch scorer. */
export function logPrediction(flightId: string, score: ModelScore): void {
  record('predictions', PREDICTIONS_PATH, {
    flightId,
    cancelProbability: score.cancelProbability,
    confidence: score.confidence,
    modelVersion: score.modelVersion,
    source: score.source,
  });
}

export type OutcomeLedgerEntry = {
  flightId: string;
  outcome: 'cancelled';
  observedAt: number;
};

/** Called from server/engine/simulation.ts's detectDisruption — the real
 *  "a cancellation was observed" moment, whichever caller reached it
 *  (the /ops console in a demo, or a real status poller in production;
 *  same entry point either way — see detectDisruption's own comment). */
export function logOutcome(flightId: string, outcome: OutcomeLedgerEntry['outcome']): void {
  record('outcomes', OUTCOMES_PATH, { flightId, outcome, observedAt: Date.now() });
}

/**
 * Every threshold evaluation, with its inputs — 03-action-policy.md §2: "An
 * adaptive threshold that cannot be reconstructed after the fact is not
 * auditable." Called from server/engine/forecast.ts's applyScore, right
 * alongside logPrediction — same moment, same flight, same real inputs.
 */
export function logThresholdEvaluation(entry: Omit<ThresholdEvaluationLedgerEntry, 'loggedAt'>): void {
  record('threshold-evaluations', THRESHOLDS_PATH, entry);
}

/**
 * PLAN's own early-filter OPA calls (e.g. before showing a candidate to the
 * member at all) — the authoritative decisions live in zkd-execute's own
 * ledger (zkd-execute/src/ledger.ts), this is only PLAN's side of the audit
 * trail, kept separate deliberately: two planes, two ledgers, matching the
 * two-IAM-role split elsewhere in this system.
 */
export function logPolicyDecision(entry: Omit<PolicyDecisionLedgerEntry, 'loggedAt'>): void {
  record('policy-decisions', POLICY_PATH, entry);
}

/** A saga's settlement, as reported back to PLAN when a Temporal workflow
 *  completes — the step-by-step detail lives in zkd-execute's own ledger;
 *  this records PLAN's view of the outcome for the flight's own audit trail. */
export function logSagaStep(entry: Omit<SagaStepLedgerEntry, 'loggedAt'>): void {
  record('saga-steps', SAGA_PATH, entry);
}
