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
const INTENTS_PATH = join(STATE_DIR, 'member-intents.jsonl');
const REPORTS_PATH = join(STATE_DIR, 'member-reports.jsonl');

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

export type MemberIntentLedgerEntry = {
  flightId: string;
  passengerId: string;
  /** how we read them back to themselves — not their raw text, see below */
  restated: string | null;
  confidence: string;
  /** what we said we would change */
  changes: string[];
  /** what we altered from the model's proposal, and told them about */
  clamped: string[];
  /** what they asked for that we could not do */
  unsupported: string[];
  keptCount: number;
  removedCount: number;
  loggedAt: number;
};

/**
 * What a member asked for in their own words, and what we did with it.
 *
 * Worth logging for the same reason predictions are: a stated deadline can
 * remove every option and a stated budget is a hard rule, so "you told us to"
 * needs to be checkable after the fact rather than taken on trust.
 *
 * The member's RAW TEXT is deliberately not stored. It is free-form prose typed
 * under stress and can contain anything — a medical reason for the deadline, a
 * family situation, a phone number. The restated one-liner is what we acted on
 * and is enough to reconstruct the decision, so the ledger keeps that and the
 * structured changes instead of the original sentence.
 */
export function logMemberIntent(entry: Omit<MemberIntentLedgerEntry, 'loggedAt'>): void {
  try {
    appendLine(INTENTS_PATH, { ...entry, loggedAt: Date.now() } satisfies MemberIntentLedgerEntry);
  } catch (e) {
    console.error('[decisionLedger] failed to log member intent:', e);
  }
}

export type MemberReportLedgerEntry = {
  flightId: string;
  passengerId: string;
  source: string;
  /** whether this report was corroborated enough to act on for everyone */
  confirmed: boolean;
  /** how many distinct members had reported this flight at the time */
  reports: number;
  /** every signal weighed, in the order it was weighed */
  evidence: string[];
  loggedAt: number;
};

/**
 * A member telling us their flight is cancelled, and what we did about it.
 *
 * The most attributable thing in the ledger, and it needs to be. A report can
 * start a recovery for a whole aircraft, so both outcomes need a record: acting
 * on a false report has to be traceable to whoever filed it, and *declining* to
 * act on a true one has to be explainable to the member who was standing in the
 * terminal telling us the truth. `evidence` carries the reasoning either way.
 */
export function logMemberReport(entry: Omit<MemberReportLedgerEntry, 'loggedAt'>): void {
  try {
    appendLine(REPORTS_PATH, { ...entry, loggedAt: Date.now() } satisfies MemberReportLedgerEntry);
  } catch (e) {
    console.error('[decisionLedger] failed to log member report:', e);
  }
}
