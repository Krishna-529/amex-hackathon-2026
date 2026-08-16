/**
 * Persistence, the transition gate, and the single writer of the member-facing
 * timeline.
 *
 * Three jobs in one module because they are the same job: nothing changes a
 * run's state except through `transition`, every change it accepts is appended
 * to the run's journal, and every journal entry with a member-facing step is
 * mirrored into `RecoveryTask.shown` — which is what the recovery page renders.
 *
 * A state variable you can assign to directly is not a state machine, and a
 * state machine with no record of how it got there cannot be replayed. This
 * repo already treats that as disqualifying (lib/thresholds.ts: "an adaptive
 * threshold nobody can replay is not auditable").
 *
 * ── Why this writes RecoveryTask.shown ─────────────────────────────────────
 *
 * The act path used to be a `setTimeout` chain in simulation.ts revealing seven
 * pre-written ACT_STEPS. Replacing it with real work would normally mean
 * rewriting the UI too — except the page maps `view.shown` generically as
 * `{n, d, s}` and does not know the steps were scripted. So the pipeline
 * projects its real events into that same shape and the UI needs no change,
 * with one honest improvement: `d` is now a *measured* duration rather than a
 * budgeted one.
 *
 * ── The write race ─────────────────────────────────────────────────────────
 *
 * `resolveTask` in simulation.ts mutates the same RecoveryTask object. Node is
 * single-threaded, so the rule below is sufficient — and mandatory: **never
 * hold a task reference across an `await`.** Every mirror re-reads from the
 * store immediately before mutating.
 */

import * as store from '../domain/store';
import { PLAY, FLOOR } from '@/lib/recovery';
import {
  JOURNAL_CAP, LEGAL_TRANSITIONS, PHASE_OF, IRREVERSIBLE_EDGE,
  type PipelineEvent, type PipelineEventKind, type PipelineRun, type PipelineState,
} from './types';
import type { Step } from '../domain/types';

export function canTransition(from: PipelineState, to: PipelineState): boolean {
  return LEGAL_TRANSITIONS[from].includes(to);
}

export function isTerminal(s: PipelineState): boolean {
  return LEGAL_TRANSITIONS[s].length === 0;
}

export function isIrreversible(from: PipelineState, to: PipelineState): boolean {
  return from === IRREVERSIBLE_EDGE.from && to === IRREVERSIBLE_EDGE.to;
}

/**
 * Creates a run, or returns the one already in flight.
 *
 * Idempotent on purpose: `detectDisruption` is idempotent, a status poller will
 * re-fire, and a webhook will redeliver. Canon calls this edge dedup and puts
 * it in WATCH. Making the entry point idempotent by construction is cheaper
 * than making every caller careful.
 */
export function ensureRun(flightId: string, passengerId: string): PipelineRun {
  const existing = store.getPipelineRun(flightId, passengerId);
  if (existing) return existing;

  const now = Date.now();
  const run: PipelineRun = {
    id: `pr-${flightId}:${passengerId}`,
    flightId,
    passengerId,
    state: 'TRIGGERED',
    startedAt: now,
    changedAt: now,
    replans: 0,
    plan: null,
    sources: {},
    committed: [],
    orphans: [],
    mutationsEnabled: process.env.PIPELINE_ALLOW_MUTATIONS === '1',
    journal: [],
  };
  store.setPipelineRun(run);
  return run;
}

export type AppendInput = {
  kind: PipelineEventKind;
  /** the member-facing row, or null for internal-only events */
  step?: Step | null;
  detail?: Record<string, string | number | boolean | null>;
};

/**
 * Appends to the journal and, when the event has a member-facing step, mirrors
 * it into the task timeline.
 *
 * `step.d` is filled in here from wall-clock time since the previous step, so
 * what the member sees is what actually happened rather than what was budgeted.
 * That also makes `view.shown.reduce(...)` — which the page already uses for
 * elapsed time — a real total for the first time.
 */
export function append(run: PipelineRun, input: AppendInput): PipelineEvent {
  const at = Date.now();
  const previousAt = run.journal.length > 0 ? run.journal[run.journal.length - 1].at : run.startedAt;

  const event: PipelineEvent = {
    seq: run.journal.length,
    at,
    kind: input.kind,
    state: run.state,
    step: input.step
      ? { ...input.step, d: Math.max(0, Math.round(((at - previousAt) / 1000) * 10) / 10) }
      : null,
    detail: input.detail ?? {},
  };

  run.journal.push(event);
  // Ring-cap rather than unbounded growth: this process is expected to stay up
  // for days, and a journal is a diagnostic, not an archive.
  if (run.journal.length > JOURNAL_CAP) run.journal.splice(0, run.journal.length - JOURNAL_CAP);
  run.changedAt = at;
  store.setPipelineRun(run);

  if (event.step) mirrorToTask(run, event.step);
  return event;
}

/**
 * Re-reads the task from the store before mutating — never a reference held
 * across an await. See the module header.
 */
function mirrorToTask(run: PipelineRun, step: Step): void {
  const task = store.getRecoveryTask(run.flightId, run.passengerId);
  if (!task) return;
  task.shown = [...task.shown, step];
  store.setRecoveryTask(task);
}

export type TransitionResult =
  | { ok: true; run: PipelineRun }
  | { ok: false; reason: string; run: PipelineRun };

/**
 * The only way a run's state changes.
 *
 * **Never throws.** `detectDisruption` is synchronous and its return value is
 * the HTTP response for POST /api/disruptions, so an exception escaping the
 * pipeline would take the trigger endpoint down with it. An illegal edge is
 * recorded as a `transition-rejected` event and the state is left alone, which
 * is loud in the ledger and harmless at runtime.
 */
export function transition(run: PipelineRun, to: PipelineState, why: string): TransitionResult {
  const from = run.state;
  if (from === to && to !== 'HOLD_PENDING') return { ok: true, run };

  if (!canTransition(from, to)) {
    append(run, {
      kind: 'transition-rejected',
      detail: { from, to, why, phase: PHASE_OF[from] },
    });
    return { ok: false, reason: `illegal transition ${from} → ${to}`, run };
  }

  run.state = to;
  append(run, {
    kind: 'state',
    detail: {
      from,
      to,
      phase: PHASE_OF[to],
      why,
      irreversible: isIrreversible(from, to),
    },
  });
  return { ok: true, run };
}

/** Records a committed side effect. This array is the rollback stack — order matters. */
export function recordCommit(run: PipelineRun, component: string, ref: string, step: Step | null): void {
  run.committed.push({ component, ref, at: Date.now() });
  append(run, { kind: 'commit', step, detail: { component, ref } });
}

/**
 * Records something we created and could not undo.
 *
 * Surfaced on /ops and on the run endpoint, never left only in a log — an
 * orphan nobody can see is an orphan nobody fixes, and it is a real charge on a
 * real card.
 */
export function recordOrphan(run: PipelineRun, o: Omit<import('./types').Orphan, 'at'>): void {
  run.orphans.push({ ...o, at: Date.now() });
  append(run, {
    kind: 'orphan',
    detail: { component: o.component, ref: o.ref, error: o.error, uncertain: o.uncertain },
  });
}

/**
 * How long to wait before revealing the next step.
 *
 * Without this the whole timeline lands in a single poll. In intent mode every
 * saga step completes in ~0 ms, and the recovery page's "busy" affordance —
 * which marks the last row while `phase === 'acting'` — never gets a chance to
 * show. Real work runs underneath; this only ever *delays* an already-finished
 * step, never a slow one, so it cannot mask latency.
 *
 * Paced against the same PLAY/FLOOR constants the scripted reveal used, so the
 * demo keeps its rhythm while the content becomes real.
 */
export function paceFor(budgetSeconds: number): number {
  return Math.max(FLOOR, budgetSeconds * PLAY);
}

export async function pace(budgetSeconds: number): Promise<void> {
  await new Promise((r) => setTimeout(r, paceFor(budgetSeconds)));
}

/** Measured decide/execute durations, for the UI's actual-vs-budget display. */
export function timings(run: PipelineRun): { decideSeconds: number; actSeconds: number } {
  const firstCommit = run.journal.find((e) => e.kind === 'commit');
  const last = run.journal[run.journal.length - 1];
  if (!last) return { decideSeconds: 0, actSeconds: 0 };

  const decideEnd = firstCommit?.at ?? last.at;
  return {
    decideSeconds: Math.round(((decideEnd - run.startedAt) / 1000) * 10) / 10,
    actSeconds: firstCommit ? Math.round(((last.at - firstCommit.at) / 1000) * 10) / 10 : 0,
  };
}

/** What a polling device reads. `since` is a cursor over the append-only journal. */
export function snapshot(run: PipelineRun, since = 0) {
  return {
    id: run.id,
    flightId: run.flightId,
    passengerId: run.passengerId,
    state: run.state,
    phase: PHASE_OF[run.state],
    replans: run.replans,
    plan: run.plan,
    sources: run.sources,
    committed: run.committed,
    orphans: run.orphans,
    mutationsEnabled: run.mutationsEnabled,
    timings: timings(run),
    events: run.journal.slice(Math.max(0, since)),
    eventCount: run.journal.length,
    startedAt: run.startedAt,
    changedAt: run.changedAt,
  };
}

export type PipelineSnapshot = ReturnType<typeof snapshot>;
