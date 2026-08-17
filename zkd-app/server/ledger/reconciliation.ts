/**
 * The reconciliation ledger — what we are owed.
 *
 * Deliberately separate from the decision ledger. One records *why we decided*,
 * the other *what we are owed*; conflating them makes both harder to audit and
 * puts a slow financial process on the same page as a fast operational one.
 *
 * Three things this file exists to get right:
 *
 *   A denial is absorbed financially but never silently. It raises
 *   `ESCALATED_FINANCE` onto a back-office queue — asynchronous and non-urgent,
 *   unlike traveller escalation, which is neither. They never share a queue.
 *
 *   Settlement is polled in batches by carrier, never per claim, and on a cadence
 *   matched to the settlement cycle rather than to wall-clock convenience. One
 *   query per carrier per sweep is the per-route coordinator pattern applied to
 *   finance, and it is the difference between a handful of calls and thousands.
 *
 *   `recoveryRate` is the successor to churn governance: a per-carrier signal,
 *   measured from outcomes we observe ourselves, that changes behaviour by
 *   feeding the expected-recovery term when ranking on net economic cost.
 */

import type { RefundClaim, RefundClaimStatus } from '@/server/domain/types';
import type { Money } from '@/server/suppliers/types';

/** Settlement runs on periodic cycles; polling hourly burns quota to observe nothing. */
export const SETTLEMENT_SWEEP_SECONDS = 24 * 3600;
/** A claim filed today will not settle today. First check at the typical lag. */
export const FIRST_CHECK_SECONDS = 7 * 24 * 3600;

export type FinanceEscalation = {
  claim: RefundClaim;
  /** What our own encoded entitlement rules say is owed, for the operator to contest. */
  contest: { owed: Money; basis: string };
};

const claims = new Map<string, RefundClaim>();
let seq = 0;
let escalate: (e: FinanceEscalation) => void = () => {};

export function onFinanceEscalation(sink: (e: FinanceEscalation) => void): void {
  escalate = sink;
}

export function resetReconciliation(): void {
  claims.clear();
  seq = 0;
}

export function fileClaim(args: {
  originalTicket: string;
  carrier: string;
  memberId: string;
  expected: Money;
  now: number;
}): RefundClaim {
  const claim: RefundClaim = {
    id: `CLM-${(++seq).toString().padStart(5, '0')}`,
    originalTicket: args.originalTicket,
    carrier: args.carrier,
    memberId: args.memberId,
    amountExpected: args.expected,
    amountRecovered: { amount: 0, currency: args.expected.currency },
    status: 'pending',
    filedAt: args.now,
    settledAt: null,
    contest: null,
  };
  claims.set(claim.id, claim);
  return claim;
}

/**
 * Record what the carrier actually paid. A short payment is `partial`, never
 * `settled` — initiated is not completed, and a partial recovery is a case for a
 * human rather than a rounding difference to absorb.
 */
export function recordSettlement(id: string, paid: Money, now: number): RefundClaim | null {
  const c = claims.get(id);
  if (!c) return null;
  c.amountRecovered = paid;
  c.settledAt = now;
  c.status = paid.amount >= c.amountExpected.amount ? 'settled' : 'partial';
  if (c.status === 'partial') {
    const owed: Money = {
      amount: c.amountExpected.amount - paid.amount,
      currency: c.amountExpected.currency,
    };
    c.contest = { owed, basis: 'carrier settled short of the filed amount' };
    escalate({ claim: c, contest: c.contest });
  }
  return c;
}

/**
 * The carrier refused. The money is absorbed within the exposure cap — that is
 * what fronting means — but the *evidence* is not thrown away.
 */
export function recordDenial(
  id: string,
  computedEntitlement: { owed: Money; basis: string },
  now: number,
): RefundClaim | null {
  const c = claims.get(id);
  if (!c) return null;
  c.status = 'denied';
  c.settledAt = now;
  c.contest = computedEntitlement;
  escalate({ claim: c, contest: computedEntitlement });
  return c;
}

export function getClaim(id: string): RefundClaim | undefined {
  return claims.get(id);
}

export function outstanding(): RefundClaim[] {
  return [...claims.values()].filter((c) => c.status === 'pending');
}

/** Total fronted and not yet recovered, for the exposure cap. */
export function outstandingFor(memberId: string, currency: string): Money {
  const amount = outstanding()
    .filter((c) => c.memberId === memberId && c.amountExpected.currency === currency)
    .reduce((n, c) => n + c.amountExpected.amount, 0);
  return { amount, currency };
}

/**
 * One query per carrier per sweep, covering every outstanding claim for it —
 * not one query per claim. This is the single largest saving available here.
 */
export function sweepBatches(now: number): Array<{ carrier: string; claimIds: string[] }> {
  const due = outstanding().filter((c) => now - c.filedAt >= FIRST_CHECK_SECONDS * 1000);
  const byCarrier = new Map<string, string[]>();
  for (const c of due) {
    const list = byCarrier.get(c.carrier) ?? [];
    list.push(c.id);
    byCarrier.set(c.carrier, list);
  }
  return [...byCarrier.entries()].map(([carrier, claimIds]) => ({ carrier, claimIds }));
}

/**
 * How reliably a carrier settles what it owes, 0–1. Feeds the expected-recovery
 * term in `lib/ranking.ts`, so a carrier that routinely refuses valid claims
 * makes fronting against it visibly more expensive.
 *
 * Unresolved claims are excluded rather than counted as failures: a pending claim
 * is not yet evidence of anything.
 */
export function recoveryRate(carrier: string, fallback = 0.9): number {
  const resolved = [...claims.values()].filter(
    (c) => c.carrier === carrier && c.status !== 'pending',
  );
  if (resolved.length === 0) return fallback;
  const expected = resolved.reduce((n, c) => n + c.amountExpected.amount, 0);
  if (expected === 0) return fallback;
  const recovered = resolved.reduce((n, c) => n + c.amountRecovered.amount, 0);
  return Math.max(0, Math.min(1, recovered / expected));
}

export function countByStatus(): Record<RefundClaimStatus, number> {
  const out: Record<RefundClaimStatus, number> = {
    pending: 0, partial: 0, settled: 0, denied: 0,
  };
  for (const c of claims.values()) out[c.status] += 1;
  return out;
}
