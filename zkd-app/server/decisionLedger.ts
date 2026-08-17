/**
 * Local, real shape of the same decision ledger
 * zkd-risk-model/src/handler.py writes to S3 in the AWS path
 * (`DECISION_LEDGER_BUCKET`, see infra/scoring.tf) — this is the dev/pilot
 * equivalent, so "every prediction and every observed outcome gets logged"
 * (README.md / documentation/design/05-cancellation-risk-model.md §2) is
 * true in this environment too, not only in unapplied Terraform.
 *
 * Reconciliation (joining a flight's logged predictions against its
 * eventually-observed outcome, to measure real accuracy on LIVE: entities
 * as they accumulate) is intentionally NOT built here — that's an offline
 * read over both JSONL files below, and belongs in the retrain pipeline
 * (zkd-risk-model/) once there's enough real outcome volume to be worth
 * running, not duplicated as a second implementation in the Node app.
 */
import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { ModelScore } from './engine/riskModel';
import type { Thresholds } from '@/lib/thresholds';
import type { Band } from '@/lib/thresholds';

const STATE_DIR = join(process.cwd(), 'server', '.state');
const PREDICTIONS_PATH = join(STATE_DIR, 'predictions.jsonl');
const OUTCOMES_PATH = join(STATE_DIR, 'outcomes.jsonl');
const THRESHOLDS_PATH = join(STATE_DIR, 'threshold-evaluations.jsonl');
const NOTIFICATIONS_PATH = join(STATE_DIR, 'notifications.jsonl');

function appendLine(path: string, obj: unknown): void {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
  appendFileSync(path, JSON.stringify(obj) + '\n');
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
  const entry: PredictionLedgerEntry = {
    flightId,
    cancelProbability: score.cancelProbability,
    confidence: score.confidence,
    modelVersion: score.modelVersion,
    source: score.source,
    loggedAt: Date.now(),
  };
  try {
    appendLine(PREDICTIONS_PATH, entry);
  } catch (e) {
    // Never let ledger I/O break a real forecast — logging is observability,
    // not the critical path.
    console.error('[decisionLedger] failed to log prediction:', e);
  }
}

export type OutcomeLedgerEntry = {
  flightId: string;
  outcome: 'cancelled';
  observedAt: number;
};

/** The real "a cancellation was observed" moment — called wherever a
 *  disruption is actually detected (a status poller, an operator trigger).
 *  Kept here so a flight's real outcome is logged independent of which
 *  plane observed it. */
export function logOutcome(flightId: string, outcome: OutcomeLedgerEntry['outcome']): void {
  const entry: OutcomeLedgerEntry = { flightId, outcome, observedAt: Date.now() };
  try {
    appendLine(OUTCOMES_PATH, entry);
  } catch (e) {
    console.error('[decisionLedger] failed to log outcome:', e);
  }
}

export type ThresholdEvaluationLedgerEntry = {
  flightId: string;
  inputs: Thresholds['inputs'];
  thresholds: { prepare: number; holdGate: number; preAuthorise: number; configVersion: number };
  pct: number;
  band: Band;
  loggedAt: number;
};

/**
 * Every threshold evaluation, with its inputs — 03-action-policy.md §2: "An
 * adaptive threshold that cannot be reconstructed after the fact is not
 * auditable." Called from server/engine/forecast.ts's applyScore, right
 * alongside logPrediction — same moment, same flight, same real inputs.
 */
export function logThresholdEvaluation(entry: Omit<ThresholdEvaluationLedgerEntry, 'loggedAt'>): void {
  try {
    appendLine(THRESHOLDS_PATH, { ...entry, loggedAt: Date.now() } satisfies ThresholdEvaluationLedgerEntry);
  } catch (e) {
    console.error('[decisionLedger] failed to log threshold evaluation:', e);
  }
}

export type NotificationLedgerEntry = {
  flightId: string;
  /** matches server/notify/types.ts's AlertKind — kept as a string here so the
   *  ledger never drags the notify module into anything that imports it */
  kind: string;
  passengerId?: string;
  /** at least one channel accepted the message */
  delivered: boolean;
  channels: { channel: string; ok: boolean; skipped: boolean; ref?: string; error?: string }[];
  loggedAt: number;
};

/**
 * Every attempt to reach the member, delivered or not.
 *
 * "We warned you in advance" is the single strongest claim this product makes,
 * and an unlogged notification makes it unfalsifiable. A skipped channel is
 * recorded too: "nobody was told because nothing was configured" and "we tried
 * and the provider rejected it" are different failures needing different fixes.
 */
export function logNotification(entry: Omit<NotificationLedgerEntry, 'loggedAt'>): void {
  try {
    appendLine(NOTIFICATIONS_PATH, { ...entry, loggedAt: Date.now() } satisfies NotificationLedgerEntry);
  } catch (e) {
    console.error('[decisionLedger] failed to log notification:', e);
  }
}
