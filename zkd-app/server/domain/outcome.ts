/**
 * Turning what the saga actually did into what the member is told.
 *
 * A dirty escalation is a *partial success*, and it must never render as a
 * generic red error screen. The member's mental model is one trip; the reality
 * is a partly-completed plan, so the report is per component and says plainly
 * what they now hold, what is being chased, and what was never started.
 *
 * The narration and the execution record diverge here, which is exactly why they
 * cannot be the same array: the ledger records what happened, this records what
 * we say about it.
 */

import type {
  ComponentKind,
  ComponentReport,
  ComponentStatus,
  RecoveryOutcome,
} from './types';

/** What the saga observed for one step. */
export type StepResult =
  | { kind: ComponentKind; state: 'succeeded'; reference: string }
  | { kind: ComponentKind; state: 'failed'; reason: string }
  | { kind: ComponentKind; state: 'compensated' }
  | { kind: ComponentKind; state: 'not-reached' };

const ORDER: ComponentKind[] = ['payment', 'flight', 'hotel', 'ground'];

const STATUS: Record<StepResult['state'], ComponentStatus> = {
  succeeded: 'CONFIRMED',
  failed: 'PENDING_MANUAL_RESCUE',
  compensated: 'ROLLED_BACK',
  'not-reached': 'NOT_ATTEMPTED',
};

const NOUN: Record<ComponentKind, string> = {
  payment: 'Payment',
  flight: 'Your flight',
  hotel: 'Your room',
  ground: 'Your transfers',
};

/** The same things without the possessive, for use mid-sentence. */
const BARE: Record<ComponentKind, string> = {
  payment: 'payment',
  flight: 'flight',
  hotel: 'room',
  ground: 'transfers',
};

const PLURAL: ComponentKind[] = ['ground'];

function detailFor(r: StepResult): string {
  switch (r.state) {
    case 'succeeded':
      return `${NOUN[r.kind]} is confirmed. You hold reference ${r.reference}.`;
    case 'failed':
      return `${NOUN[r.kind]} could not be secured — ${r.reason}. Someone is completing this for you.`;
    case 'compensated':
      return `${NOUN[r.kind]} was booked and then cancelled, so nothing is owed for it.`;
    case 'not-reached':
      return `${NOUN[r.kind]} was never booked. You may need to arrange this yourself.`;
  }
}

export function reportFor(results: StepResult[]): ComponentReport[] {
  const byKind = new Map(results.map((r) => [r.kind, r]));
  return ORDER.filter((k) => byKind.has(k)).map((kind) => {
    const r = byKind.get(kind)!;
    return {
      component: kind,
      status: STATUS[r.state],
      reference: r.state === 'succeeded' ? r.reference : null,
      detail: detailFor(r),
    };
  });
}

/**
 * The terminal state for the recovery as a whole.
 *
 * The important case is the middle one. A failure *after* an irreversible step
 * cannot be cleanly unwound — you cannot re-reissue onto a cancelled flight — so
 * it escalates dirty rather than claiming a rollback that did not happen.
 */
export function outcomeFor(args: {
  reports: ComponentReport[];
  /** True when a step that has no inverse already succeeded. */
  irreversibleStepCompleted: boolean;
}): RecoveryOutcome {
  const statuses = args.reports.map((r) => r.status);
  const anyPending = statuses.includes('PENDING_MANUAL_RESCUE');
  const anyConfirmed = statuses.includes('CONFIRMED');

  if (!anyPending) return 'CONFIRMED';
  if (args.irreversibleStepCompleted || anyConfirmed) return 'ESCALATED';
  return 'ROLLED_BACK';
}

/** True when the member holds something usable despite the escalation. */
export function isPartialSuccess(reports: ComponentReport[]): boolean {
  return (
    reports.some((r) => r.status === 'CONFIRMED') &&
    reports.some((r) => r.status === 'PENDING_MANUAL_RESCUE')
  );
}

/**
 * The push must carry the same split as the screen. A "you're rebooked" message
 * when the room failed is worse than saying nothing.
 */
export function notificationFor(reports: ComponentReport[], outcome: RecoveryOutcome): string {
  if (outcome === 'CONFIRMED') return 'You are rebooked. Everything is confirmed.';
  if (outcome === 'ROLLED_BACK') {
    return 'We could not complete the change, so nothing was booked and nothing was charged.';
  }
  const heldKinds = reports.filter((r) => r.status === 'CONFIRMED').map((r) => r.component);
  const chasing = reports
    .filter((r) => r.status === 'PENDING_MANUAL_RESCUE')
    .map((r) => BARE[r.component]);
  if (heldKinds.length === 0) return 'We could not complete your recovery. Someone is on it now.';

  const held = heldKinds.map((k) => BARE[k]).join(' and ');
  const verb = heldKinds.length > 1 || PLURAL.includes(heldKinds[0]) ? 'are' : 'is';
  return `Your ${held} ${verb} confirmed. We are still working on your ${chasing.join(' and ')}.`;
}
