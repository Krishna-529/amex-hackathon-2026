/**
 * The durable record of what the ranker showed, and — later — what the member
 * chose. This is the piece that has to exist before any learning is possible,
 * for a specific reason: the member's choice survives elsewhere as a supplier
 * offer id (RecoveryTask.chosenAltId / rejectedAltIds), but offer ids expire and
 * then resolve to nothing. An hour after a recovery you can see that offer
 * `off_a3f1` was rejected and never again recover what it cost or when it landed.
 *
 * So we log the full FEATURE VECTOR of every option shown, keyed by its alt id,
 * at the moment we show it. The offline trainer then joins the member's recorded
 * choice against this log by alt id and recovers the features of the losers from
 * our own record, not from a supplier that has long since dropped the offer.
 *
 * Two append points, both fire-and-forget and both wrapped so logging can never
 * break a live recovery:
 *   - `logShownSet`  — called from the ranker when a choice set is presented.
 *   - `logChoice`    — the outcome. Exposed for a future one-line wiring at the
 *                      point the member resolves (see the note on logChoice); the
 *                      offline job can equally reconstruct the label from the
 *                      persisted RecoveryTask without any write here (see
 *                      reconcile.ts), which is why this file adds no dependency
 *                      on the saga.
 *
 * Postgres-backed since 2026-08-21 (migration 0007, one generic
 * `ranker_decision_log` table with a `kind` discriminator) — previously two
 * local JSONL files under `server/.state/`, same "true on one instance, false
 * the moment a second one exists" gap as decisionLedger.ts had before
 * migration 0006, and fixed the same way: exact original synchronous `void`
 * signatures kept (the ranker's serve path, ranker/index.ts, never awaited
 * `logShownSet`), fire-and-forget Postgres write underneath.
 */

import { sql, ensureReady } from '../../domain/db.ts';
import type { FeatureVector, WeightVector } from './types.ts';

async function insertEntry(
  kind: 'shown' | 'choice',
  decisionId: string,
  flightId: string,
  memberId: string | undefined,
  data: Record<string, unknown>,
): Promise<void> {
  await ensureReady();
  // Same JSONValue-typing note as decisionLedger.ts's insertEntry: every
  // entry here is a plain JSON-serializable interface, `as never` sidesteps
  // `postgres`'s JSONValue only structurally verifying concretely-typed
  // named interfaces, not a generic Record.
  await sql`
    insert into ranker_decision_log (kind, decision_id, flight_id, member_id, data)
    values (${kind}, ${decisionId}, ${flightId}, ${memberId ?? null}, ${sql.json(data as never)})
  `;
}

function logAsync(
  kind: 'shown' | 'choice',
  decisionId: string,
  flightId: string,
  memberId: string | undefined,
  data: Record<string, unknown>,
  whatFailed: string,
): void {
  void insertEntry(kind, decisionId, flightId, memberId, data).catch((e) => {
    console.error(`[ranker] failed to log ${whatFailed}:`, e);
  });
}

export type ShownCandidate = {
  altId: string;
  code: string;
  features: FeatureVector;
  bookability: number;
  utility: number;
  rank: number;
  propensity: number;
};

export type ShownSetEntry = {
  decisionId: string;
  loggedAt: number;
  flightId: string;
  memberId: string;
  strategy: string;
  weightsVersion: number;
  weights: WeightVector;
  candidates: ShownCandidate[];
};

/** Called by the ranker every time a choice set is presented to a member. This
 *  is the training-data write, and the whole reason the trainer can ever run. */
export function logShownSet(entry: Omit<ShownSetEntry, 'loggedAt'>): void {
  const full = { ...entry, loggedAt: Date.now() } satisfies ShownSetEntry;
  logAsync('shown', entry.decisionId, entry.flightId, entry.memberId, full, 'shown set');
}

export type ChoiceEntry = {
  decisionId: string;
  loggedAt: number;
  flightId: string;
  memberId: string;
  /** the alt id the member actually ended up on */
  chosenAltId: string;
  /** how the choice was made: approve | choose | autopilot | handed-over | expired */
  by: string;
  /** whether the saga then actually booked it — the ground truth for bookability */
  bookedOk?: boolean;
};

/**
 * The outcome half of a training pair.
 *
 * Left as an exposed function rather than wired into the saga, so this component
 * changes nothing outside itself. A production deployment does ONE of two things:
 * call this from the single point where a RecoveryTask resolves, or — with no
 * code change at all — have the offline job read `resolution.chosenAltId` from
 * the persisted recovery task and join it to the shown-set log by decisionId
 * (see reconcile.ts, which is how train.ts actually does it today). The trainer
 * supports both; its tests synthesise choices directly.
 */
export function logChoice(entry: Omit<ChoiceEntry, 'loggedAt'>): void {
  const full = { ...entry, loggedAt: Date.now() } satisfies ChoiceEntry;
  logAsync('choice', entry.decisionId, entry.flightId, entry.memberId, full, 'choice');
}

/** Every logged shown-set, oldest first. Read path for train.ts's CLI
 *  entrypoint — offline, out of the request path, same as the rest of this
 *  file's writes. */
export async function loadShownSetsFromDb(): Promise<ShownSetEntry[]> {
  await ensureReady();
  const rows = await sql<{ data: ShownSetEntry }[]>`
    select data from ranker_decision_log where kind = 'shown' order by logged_at asc
  `;
  return rows.map((r) => r.data);
}

/** Every directly-logged choice, oldest first. See the note on logChoice —
 *  this is currently unpopulated in production since nothing calls
 *  logChoice yet; train.ts merges this with reconcile.ts's DB-derived
 *  choices, preferring a direct log entry when both exist for a decisionId. */
export async function loadChoicesFromDb(): Promise<ChoiceEntry[]> {
  await ensureReady();
  const rows = await sql<{ data: ChoiceEntry }[]>`
    select data from ranker_decision_log where kind = 'choice' order by logged_at asc
  `;
  return rows.map((r) => r.data);
}
