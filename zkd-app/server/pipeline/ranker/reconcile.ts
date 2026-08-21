/**
 * Joins resolved recoveries back onto the shown-set log to produce real
 * training pairs for train.ts — the piece `decisionLog.ts`'s own comment
 * names as one of the two valid ways to close the loop ("with no code
 * change at all — have the offline job read `resolution.chosenAltId` from
 * the persisted recovery task and join it to the shown-set log").
 *
 * Deliberately NOT done by wiring `logChoice` into the live consent/spend
 * path (`server/engine/simulation.ts`). That path was just hardened
 * (2026-08-21, the rung-3 delivery check) and stays safer to reason about
 * with the fewest possible call sites added under time pressure. A
 * RecoveryTask's `resolution` already carries everything a choice label
 * needs — `chosenAltId`, `at`, and `kind` — so the join can run entirely
 * offline, out of the request path, exactly like the trainer itself.
 *
 * The join key is NOT a stored decisionId (none is persisted on
 * RecoveryTask — adding one would be exactly the kind of live-path change
 * this file exists to avoid). Instead: for a resolved task on
 * (flightId, passengerId), take the most recently shown set for that same
 * (flightId, memberId) pair with `loggedAt <= resolution.at`, and only
 * accept it if the chosen alt id actually appears among its candidates. A
 * flight can be re-ranked many times before a member decides (the no-holds
 * refresh loop re-shops periodically) — the last shown set before the
 * decision is the one that's operationally true to what the member saw.
 */

import type { ShownSetEntry } from './decisionLog.ts';

export type ResolvedChoice = {
  flightId: string;
  /** == passengerId; the ranker's own memberId is threaded from run.passengerId */
  memberId: string;
  chosenAltId: string;
  /** DisruptionResolution.at */
  resolvedAt: number;
  /** DisruptionResolution.kind, restricted to the two kinds that carry an altId */
  kind: 'autopilot' | 'approved';
  bookedOk?: boolean;
};

export type ReconciledChoice = {
  decisionId: string;
  loggedAt: number;
  flightId: string;
  memberId: string;
  chosenAltId: string;
  by: string;
  bookedOk?: boolean;
};

/**
 * Pure and DB-free on purpose, so it's unit-testable without Postgres and
 * reusable from both the trainer's CLI entrypoint and, if it's ever wanted,
 * a scheduled job. `shown` and `resolved` are expected sorted by nothing in
 * particular — this does its own sort per flight+member group.
 */
export function reconcileChoices(shown: ShownSetEntry[], resolved: ResolvedChoice[]): ReconciledChoice[] {
  const byKey = new Map<string, ShownSetEntry[]>();
  for (const s of shown) {
    const key = `${s.flightId}:${s.memberId}`;
    (byKey.get(key) ?? byKey.set(key, []).get(key)!).push(s);
  }
  for (const entries of byKey.values()) entries.sort((a, b) => a.loggedAt - b.loggedAt);

  const out: ReconciledChoice[] = [];
  for (const r of resolved) {
    if (!r.chosenAltId) continue;
    const key = `${r.flightId}:${r.memberId}`;
    const candidates = byKey.get(key);
    if (!candidates) continue;

    let match: ShownSetEntry | undefined;
    for (const s of candidates) {
      if (s.loggedAt > r.resolvedAt) break; // sorted ascending — first one past the resolution ends the search
      if (s.candidates.some((c) => c.altId === r.chosenAltId)) match = s;
    }
    if (!match) continue; // no shown set that both precedes the decision and contains the chosen alt — not a usable pair

    out.push({
      decisionId: match.decisionId,
      loggedAt: r.resolvedAt,
      flightId: r.flightId,
      memberId: r.memberId,
      chosenAltId: r.chosenAltId,
      by: r.kind,
      bookedOk: r.bookedOk,
    });
  }
  return out;
}
