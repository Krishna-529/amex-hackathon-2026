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
 *                      persisted RecoveryTask without any write here, which is why
 *                      this file adds no dependency on the saga.
 *
 * Storage mirrors server/decisionLedger.ts exactly — append-only JSONL under
 * server/.state, which is gitignored and process-local. That is the honest
 * minimum of a feature store at this scale; a real deployment points these at
 * the same Postgres the rest of the app now uses.
 */

import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { FeatureVector, WeightVector } from './types.ts';

const STATE_DIR = join(process.cwd(), 'server', '.state');
const SHOWN_PATH = join(STATE_DIR, 'ranker-shown.jsonl');
const CHOICE_PATH = join(STATE_DIR, 'ranker-choices.jsonl');

function appendLine(path: string, obj: unknown): void {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
  appendFileSync(path, JSON.stringify(obj) + '\n');
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
  try {
    appendLine(SHOWN_PATH, { ...entry, loggedAt: Date.now() } satisfies ShownSetEntry);
  } catch (e) {
    console.error('[ranker] failed to log shown set:', e);
  }
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
 * the persisted recovery task and join it to the shown-set log by decisionId.
 * The trainer supports both; its tests synthesise choices directly.
 */
export function logChoice(entry: Omit<ChoiceEntry, 'loggedAt'>): void {
  try {
    appendLine(CHOICE_PATH, { ...entry, loggedAt: Date.now() } satisfies ChoiceEntry);
  } catch (e) {
    console.error('[ranker] failed to log choice:', e);
  }
}

export const PATHS = { SHOWN_PATH, CHOICE_PATH, STATE_DIR };
