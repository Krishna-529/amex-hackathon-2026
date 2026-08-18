/**
 * "My flight is cancelled" — the member as a detection source.
 *
 * ── Why this lane has to exist ─────────────────────────────────────────────
 *
 * A member standing at a gate knows before any feed does. The status poller
 * (server/engine/statusPoller.ts) is the primary lane and it is bounded by a
 * hundred AviationStack calls a month, which means most flights are not being
 * watched most of the time. Somebody in the terminal, looking at the board, is
 * the highest-quality signal available — and until now there was no way for
 * them to tell us.
 *
 * ── Why it cannot simply trigger a recovery ────────────────────────────────
 *
 * Because the cost of a false report is not symmetric. Acting on one spends
 * real money on real cards belonging to *every other passenger on the flight*,
 * and the person who pressed the button might have misread a board, opened the
 * wrong booking, or been curious what it did.
 *
 * So a report is a CLAIM, never an event. It is scored against corroborating
 * evidence, and only a corroborated claim fans out. The asymmetry is resolved
 * by splitting the two things a report could do:
 *
 *   - **For the reporter**, act immediately. They said they are stranded;
 *     believing them costs one recovery, and disbelieving a truthful member is
 *     exactly the failure this product exists to prevent.
 *   - **For everyone else**, wait for corroboration. One person cannot move a
 *     planeload.
 *
 * That split maps onto the authority boundary the pipeline already draws:
 * `onDisruptionDetected` searches and plans and is reversible by construction;
 * `execute` is the only thing that spends. An uncorroborated report reaches the
 * first for its reporter and the second for nobody.
 */

import * as store from '../domain/store';
import { lookupFlightStatus } from '../aviationstack';
import { classify } from '@/lib/disruptionKind';
import { logMemberReport } from '../decisionLedger';
import type { Band } from '@/lib/thresholds';
import { BAND_RANK } from '../notify/bandCrossing';

export type ReportSource = 'member' | 'ops';

export type MemberReport = {
  flightId: string;
  passengerId: string;
  at: number;
  source: ReportSource;
};

export type Corroboration = {
  /** true when we are willing to act for everyone on the flight */
  confirmed: boolean;
  /** every signal considered, so a decision can be reconstructed afterwards */
  evidence: string[];
  /** distinct members who have reported this flight */
  reports: number;
};

/**
 * How many independent members must agree before we act on their word alone.
 *
 * Three, not two. Two is reachable by one person with two accounts and by two
 * friends travelling together who misread the same board; three strangers
 * agreeing is a different kind of claim. It is also deliberately reachable —
 * on a disrupted flight, three people reaching for their phones is the normal
 * case, not an edge one.
 */
export const INDEPENDENT_REPORTS_NEEDED = 3;

/**
 * One report per member per flight, kept in process memory.
 *
 * Same lifetime caveat as server/cache.ts and the simulation timers: this is a
 * single continuous Node process, and a restart forgets outstanding claims. The
 * consequence is bounded and acceptable — a forgotten claim means we ask for
 * corroboration again, never that we act on one we should not have.
 */
const reports = new Map<string, Map<string, MemberReport>>();

/** Records the report and returns the corroboration verdict for the flight. */
export async function report(
  flightId: string,
  passengerId: string,
  source: ReportSource = 'member',
): Promise<Corroboration> {
  const forFlight = reports.get(flightId) ?? new Map<string, MemberReport>();
  // Keyed by passenger, so pressing the button five times is one report. The
  // "pressed it for fun" case is mostly this one, and it costs nothing.
  forFlight.set(passengerId, { flightId, passengerId, at: Date.now(), source });
  reports.set(flightId, forFlight);

  const verdict = await corroborate(flightId, forFlight);

  try {
    logMemberReport({
      flightId,
      passengerId,
      source,
      confirmed: verdict.confirmed,
      reports: verdict.reports,
      evidence: verdict.evidence,
    });
  } catch {
    // A ledger write must never break the member's screen.
  }

  return verdict;
}

/**
 * The corroboration ladder, cheapest signal first.
 *
 * Order matters for cost, not just for logic: the live status check spends one
 * of a very small monthly allowance, so it runs only when the free signals have
 * not already settled the question.
 */
async function corroborate(
  flightId: string,
  forFlight: Map<string, MemberReport>,
): Promise<Corroboration> {
  const evidence: string[] = [];
  const count = forFlight.size;

  // 0. An operator said so. Free, and authoritative by definition.
  if ([...forFlight.values()].some((r) => r.source === 'ops')) {
    evidence.push('confirmed from the operations console');
    return { confirmed: true, evidence, reports: count };
  }

  // 1. Independent members agreeing. Free.
  if (count >= INDEPENDENT_REPORTS_NEEDED) {
    evidence.push(`${count} passengers on this flight reported it independently`);
    return { confirmed: true, evidence, reports: count };
  }
  evidence.push(`${count} of ${INDEPENDENT_REPORTS_NEEDED} independent reports`);

  const flight = await store.getFlight(flightId);
  if (!flight) return { confirmed: false, evidence, reports: count };

  // 2. The model already believed it. Free, and a strong prior: a report on a
  //    flight our own forecast has escalated is a very different claim from one
  //    on a flight we think is healthy.
  const band = flight.forecast?.band as Band | undefined;
  const alreadyWorried = !!band && BAND_RANK[band] >= BAND_RANK['hold-gate'];
  if (alreadyWorried) {
    evidence.push(`our own forecast already had this flight at ${band}`);
  }

  // 3. Ask the carrier's feed. Costs one call from a ~100/month allowance, so
  //    it is spent only when a member has actually reported something — never
  //    on a schedule. A report is exactly the moment the call is worth making.
  const match = await lookupFlightStatus(flight.code.replace(/\s+/g, '')).catch(() => null);
  if (match) {
    const classification = classify({
      status: match.flightStatus,
      bookedDepartureAt: new Date(flight.depISO).getTime(),
      scheduledDepartureAt: match.depScheduledAt,
      delayMinutes: match.depDelayMin,
      connectionSlackMinutes: flight.connectionSlackMinutes,
    });
    if (classification.kind === 'cancellation') {
      evidence.push('the airline’s own status feed reports it cancelled');
      return { confirmed: true, evidence, reports: count };
    }
    evidence.push(`the airline’s status feed says "${match.flightStatus}"`);

    // An explicit contradiction is worth stating rather than treating as mere
    // absence of support: the carrier saying the flight is fine is real
    // evidence against, and a single member's word does not outweigh it.
    if (classification.kind === 'none') {
      return { confirmed: false, evidence, reports: count };
    }
  } else {
    evidence.push('no live status available (unconfigured, cached, or out of allowance)');
  }

  // 4. Nothing conclusive. A single report on a flight the model already
  //    distrusts is enough — the report is not carrying the decision alone,
  //    it is confirming something we already suspected.
  if (alreadyWorried) return { confirmed: true, evidence, reports: count };

  return { confirmed: false, evidence, reports: count };
}

/** Who has reported this flight — used to decide who we may act for. */
export function reportersFor(flightId: string): string[] {
  return [...(reports.get(flightId)?.keys() ?? [])];
}

export function hasReported(flightId: string, passengerId: string): boolean {
  return reports.get(flightId)?.has(passengerId) ?? false;
}

/** Test seam. */
export function _reset(): void {
  reports.clear();
}
