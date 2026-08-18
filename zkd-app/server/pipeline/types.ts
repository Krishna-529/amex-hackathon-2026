/**
 * The rebooking pipeline's state machine and data shapes.
 *
 * ── Six states, when canon already has seven phases ────────────────────────
 *
 * `## A2. FROZEN ARCHITECTURAL FACTS` defines a seven-phase lifecycle —
 * WATCH · WARM · ASK · WAIT · ACT · VERIFY · CLAIM — and that block is canon:
 * it may not be contradicted or extended. These six states do not replace it.
 * They are the *executable projection* of it: phases are what a recovery is
 * doing conceptually, states are what the scheduler can actually be in. Every
 * state carries its phase in PHASE_OF so the two cannot drift.
 *
 * The projection is many-to-one in two places, both deliberate:
 *
 *   EVALUATING covers WARM's tail and all of ASK, because scoring the portfolio
 *   and putting it to the member are one scheduling unit — the member is asked
 *   about a *ranked* portfolio, so the ranking must already exist.
 *
 *   CONFIRMED covers ACT, VERIFY and CLAIM, because they are one saga
 *   downstream of a single consent. Splitting them would imply a member can be
 *   left durably parked between them, and they cannot: a booking that is
 *   ticketed but unverified is a bug, not a state.
 *
 * ── Mapping onto the lifecycle that already exists ─────────────────────────
 *
 * This does not replace `DisruptionEvent.phase` or `RecoveryTask.phase` either.
 * Those stay authoritative for the member-facing flow; PipelineState is the
 * engine's own view, and STATE_TO_TASK_PHASE records the correspondence so a
 * reviewer can check the two never disagree.
 *
 * ── The one irreversible edge ──────────────────────────────────────────────
 *
 * HOLD_PENDING → CONFIRMED is the WAIT→ACT boundary, and canon is explicit that
 * "nothing irreversible happens to its left". IRREVERSIBLE_EDGE names it so the
 * orchestrator can assert on it rather than relying on everyone remembering,
 * and so the ledger can mark exactly where a recovery stopped being free to
 * abandon.
 */

import type { Step, RecoveryTaskPhase } from '../domain/types';
import type { OptimizationStrategy } from '../preferences/schema';

export type PipelineState =
  | 'TRIGGERED'
  | 'SEARCHING'
  | 'EVALUATING'
  | 'HOLD_PENDING'
  | 'CONFIRMED'
  | 'FAILED_FALLBACK';

/** The canonical lifecycle phase each state sits inside. Canon, not a re-cut of it. */
export const PHASE_OF: Record<PipelineState, string> = {
  TRIGGERED: 'WATCH',
  SEARCHING: 'WARM',
  EVALUATING: 'WARM/ASK',
  HOLD_PENDING: 'WAIT',
  CONFIRMED: 'ACT/VERIFY/CLAIM',
  FAILED_FALLBACK: 'HALT',
};

/**
 * What the member-facing task phase should be while the pipeline is in each
 * state. `null` means the task does not exist yet — the pipeline starts before
 * `finishDecide` has fanned out per-booking tasks.
 */
export const STATE_TO_TASK_PHASE: Record<PipelineState, RecoveryTaskPhase | null> = {
  TRIGGERED: null,
  SEARCHING: null,
  EVALUATING: null,
  HOLD_PENDING: 'waiting',
  CONFIRMED: 'booked',
  FAILED_FALLBACK: 'handed',
};

/**
 * Legal transitions. Anything not listed is a bug, and `transition()` refuses
 * it rather than recording it — a state machine that accepts illegal edges is a
 * log, not a machine.
 *
 * Note what is deliberately absent: there is no edge out of CONFIRMED.
 * Compensation is a *new* recovery with its own trigger, not a reverse
 * transition on this one. Pretending a booking can be un-made by moving a
 * variable backwards is exactly the confusion the WAIT gate exists to prevent.
 */
export const LEGAL_TRANSITIONS: Record<PipelineState, readonly PipelineState[]> = {
  TRIGGERED: ['SEARCHING', 'FAILED_FALLBACK'],
  SEARCHING: ['EVALUATING', 'FAILED_FALLBACK'],
  // Back to SEARCHING when invalidation fires mid-evaluation: the portfolio
  // being scored is stale and scoring it further is wasted work.
  EVALUATING: ['HOLD_PENDING', 'SEARCHING', 'FAILED_FALLBACK'],
  // Self-loop for a cascade, a member swap, or a re-price. Back to SEARCHING
  // when the held option dies before consent — bounded by MAX_REPLANS.
  HOLD_PENDING: ['HOLD_PENDING', 'CONFIRMED', 'SEARCHING', 'FAILED_FALLBACK'],
  CONFIRMED: [],
  FAILED_FALLBACK: [],
};

export const IRREVERSIBLE_EDGE = { from: 'HOLD_PENDING', to: 'CONFIRMED' } as const;

/** A re-plan loop that never terminates is worse than an honest halt. */
export const MAX_REPLANS = 3;

// ── Portfolio ──────────────────────────────────────────────────────────────

/**
 * How the member gets there. Three shapes, compared against each other rather
 * than ranked within each — the whole point of a multi-modal search is that an
 * overnight hotel plus an 06:40 departure can beat a same-night two-stop that
 * lands at 04:15 with a missed connection behind it.
 */
export type OptionShape = 'direct' | 'connection' | 'overnight';

export type OptionScore = {
  /** 0-1, higher is better */
  total: number;
  parts: { arrival: number; cost: number; reliability: number; cabin: number; loyalty: number; effort: number };
  weights: { arrival: number; cost: number; reliability: number; cabin: number; loyalty: number; effort: number };
  /** the strategy that produced these weights, so a ranking can be replayed */
  strategy: OptimizationStrategy;
  /** one line per component, for the explanation the member reads */
  notes: string[];
};

// ── Journal ────────────────────────────────────────────────────────────────

export type PipelineEventKind =
  | 'triggered'
  | 'search'
  | 'composed'
  | 'ranked'
  | 'ranking-not-ready'
  | 'filtered'
  | 'refresh'
  | 'invalidated'
  | 'hold'
  | 'revalidated'
  | 'switched'
  | 'commit'
  | 'compensated'
  | 'orphan'
  | 'state'
  | 'transition-rejected'
  | 'halt'
  | 'error';

export type PipelineEvent = {
  seq: number;
  at: number;
  kind: PipelineEventKind;
  state: PipelineState;
  /**
   * The member-facing timeline row this event renders as, or null for
   * internal-only events. Reusing the existing `Step` shape is what lets
   * app/recovery/[id]/page.tsx keep rendering with no change — it maps
   * `{n, d, s}` generically and does not know the steps were once scripted.
   */
  step: Step | null;
  /** machine detail for /ops and the ledger — never rendered to a member */
  detail: Record<string, string | number | boolean | null>;
};

/** A side effect we created and could not undo. Never left only in a log. */
export type Orphan = {
  component: string;
  ref: string;
  error: string;
  at: number;
  /** true when we cannot even be sure the remote resource exists */
  uncertain: boolean;
};

export type PipelineRun = {
  id: string;
  flightId: string;
  passengerId: string;
  state: PipelineState;
  startedAt: number;
  changedAt: number;
  replans: number;
  /** ids of the chosen plan, in the domain's own vocabulary */
  plan: { altId: string; hotelId: string; cabId: string } | null;
  /**
   * Options a hard rule disqualified, with the rule that did it.
   *
   * Member-facing, unlike `journal[].detail`: "we found nothing" and "your own
   * settings excluded everything" are different answers and the recovery page
   * already promises the second one in copy. Kept on the run rather than read
   * back out of the journal so the wording reaching the member is a real field,
   * not a parsed log line.
   */
  excluded: { code: string; rule: string }[];
  /** per-source status from the last search, for /ops */
  sources: Record<string, string>;
  /** components actually committed, in order — the rollback stack */
  committed: { component: string; ref: string; at: number }[];
  orphans: Orphan[];
  /** snapshot of PIPELINE_ALLOW_MUTATIONS at run start, so the UI can be honest */
  mutationsEnabled: boolean;
  /** append-only; ring-capped so a long-lived process cannot grow without bound */
  journal: PipelineEvent[];
};

export const JOURNAL_CAP = 200;
