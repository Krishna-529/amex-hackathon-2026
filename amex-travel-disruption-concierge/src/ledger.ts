/**
 * The decision ledger.
 *
 * EVERY OPA evaluation lands in `decision_ledger` with its input, its result,
 * the rule path that produced it and a timestamp. The dashboard's "why" chip
 * renders `rule_path` straight out of this table — nothing on the screen is
 * hard-coded.
 *
 * Also holds the compensation ledger, which is what makes rollback idempotent:
 * every compensation is keyed on `${workflowRunId}:${activityId}`.
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { nowIso } from './clock';

const DB_PATH = process.env.LEDGER_DB ?? join(__dirname, '..', 'data', 'ledger.db');

let db: DatabaseSync | null = null;

export function open(): DatabaseSync {
  if (db) return db;
  mkdirSync(dirname(DB_PATH), { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS decision_ledger (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id        TEXT NOT NULL,
      workflow_id   TEXT NOT NULL,
      seq           INTEGER NOT NULL,
      subject       TEXT NOT NULL,
      package       TEXT NOT NULL,
      rule_path     TEXT NOT NULL,
      input         TEXT NOT NULL,
      result        TEXT NOT NULL,
      allowed       INTEGER NOT NULL,
      reasons       TEXT NOT NULL DEFAULT '[]',
      eval_ms       INTEGER NOT NULL DEFAULT 0,
      timestamp     TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS compensation_ledger (
      idempotency_key TEXT PRIMARY KEY,
      run_id          TEXT NOT NULL,
      activity_id     TEXT NOT NULL,
      compensation    TEXT NOT NULL,
      status          TEXT NOT NULL,
      payload         TEXT NOT NULL,
      timestamp       TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS saga_runs (
      run_id       TEXT PRIMARY KEY,
      workflow_id  TEXT NOT NULL,
      mode         TEXT NOT NULL,
      status       TEXT NOT NULL,
      started_at   TEXT NOT NULL,
      finished_at  TEXT,
      result       TEXT
    );
  `);
  return db;
}

export interface DecisionRow {
  id: number;
  run_id: string;
  workflow_id: string;
  seq: number;
  subject: string;
  package: string;
  rule_path: string;
  input: string;
  result: string;
  allowed: number;
  reasons: string;
  eval_ms: number;
  timestamp: string;
}

export function recordDecision(d: {
  runId: string;
  workflowId: string;
  subject: string;
  package: string;
  rulePath: string;
  input: unknown;
  result: unknown;
  allowed: boolean;
  reasons?: string[];
  evalMs?: number;
}): number {
  const conn = open();
  const seq =
    (conn.prepare('SELECT COALESCE(MAX(seq), 0) AS s FROM decision_ledger WHERE run_id = ?').get(d.runId) as any)
      ?.s ?? 0;
  const info = conn
    .prepare(
      `INSERT INTO decision_ledger
        (run_id, workflow_id, seq, subject, package, rule_path, input, result, allowed, reasons, eval_ms, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      d.runId,
      d.workflowId,
      Number(seq) + 1,
      d.subject,
      d.package,
      d.rulePath,
      JSON.stringify(d.input),
      JSON.stringify(d.result),
      d.allowed ? 1 : 0,
      JSON.stringify(d.reasons ?? []),
      d.evalMs ?? 0,
      nowIso(),
    );
  return Number(info.lastInsertRowid);
}

export function decisionsForRun(runId: string): DecisionRow[] {
  return open()
    .prepare('SELECT * FROM decision_ledger WHERE run_id = ? ORDER BY seq ASC')
    .all(runId) as unknown as DecisionRow[];
}

export function decisionById(id: number): DecisionRow | undefined {
  return open().prepare('SELECT * FROM decision_ledger WHERE id = ?').get(id) as unknown as DecisionRow | undefined;
}

// ---------------------------------------------------------------------------
// Compensation idempotency — keyed on `${workflowRunId}:${activityId}`
// ---------------------------------------------------------------------------

export function compensationKey(runId: string, activityId: string): string {
  return `${runId}:${activityId}`;
}

/** Returns false when this compensation has already been applied. */
export function claimCompensation(args: {
  runId: string;
  activityId: string;
  compensation: string;
  payload: unknown;
}): boolean {
  const conn = open();
  const key = compensationKey(args.runId, args.activityId);
  const existing = conn.prepare('SELECT 1 FROM compensation_ledger WHERE idempotency_key = ?').get(key);
  if (existing) return false;
  conn
    .prepare(
      `INSERT INTO compensation_ledger (idempotency_key, run_id, activity_id, compensation, status, payload, timestamp)
       VALUES (?, ?, ?, ?, 'APPLIED', ?, ?)`,
    )
    .run(key, args.runId, args.activityId, args.compensation, JSON.stringify(args.payload), nowIso());
  return true;
}

export function compensationsForRun(runId: string) {
  return open()
    .prepare('SELECT * FROM compensation_ledger WHERE run_id = ? ORDER BY timestamp ASC, rowid ASC')
    .all(runId) as any[];
}

// ---------------------------------------------------------------------------
// Saga runs
// ---------------------------------------------------------------------------

export function startRun(args: { runId: string; workflowId: string; mode: string }): void {
  open()
    .prepare(
      `INSERT OR REPLACE INTO saga_runs (run_id, workflow_id, mode, status, started_at)
       VALUES (?, ?, ?, 'RUNNING', ?)`,
    )
    .run(args.runId, args.workflowId, args.mode, nowIso());
}

export function finishRun(args: { runId: string; status: string; result: unknown }): void {
  open()
    .prepare('UPDATE saga_runs SET status = ?, finished_at = ?, result = ? WHERE run_id = ?')
    .run(args.status, nowIso(), JSON.stringify(args.result), args.runId);
}

export function latestRun(mode?: string): any | undefined {
  const conn = open();
  return mode
    ? (conn
        .prepare('SELECT * FROM saga_runs WHERE mode = ? ORDER BY rowid DESC LIMIT 1')
        .get(mode) as any)
    : (conn.prepare('SELECT * FROM saga_runs ORDER BY rowid DESC LIMIT 1').get() as any);
}

/** Wipes prior runs so each demo starts from a known state. */
export function resetLedger(): void {
  const conn = open();
  conn.exec('DELETE FROM decision_ledger; DELETE FROM compensation_ledger; DELETE FROM saga_runs;');
  conn.exec("DELETE FROM sqlite_sequence WHERE name = 'decision_ledger';");
}
