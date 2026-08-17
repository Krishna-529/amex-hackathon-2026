import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  isPartialSuccess,
  notificationFor,
  outcomeFor,
  reportFor,
} from '@/server/domain/outcome';
import type { StepResult } from '@/server/domain/outcome';
import {
  FIRST_CHECK_SECONDS,
  fileClaim,
  onFinanceEscalation,
  outstandingFor,
  recordDenial,
  recordSettlement,
  recoveryRate,
  resetReconciliation,
  sweepBatches,
} from '@/server/ledger/reconciliation';
import type { FinanceEscalation } from '@/server/ledger/reconciliation';

const NOW = Date.parse('2026-08-25T09:00:00Z');
const INR = (amount: number) => ({ amount, currency: 'INR' });

/* ── partial success ─────────────────────────────────────────────────────── */

test('a reissue that succeeds before a hotel failure escalates dirty, not rolled back', () => {
  const steps: StepResult[] = [
    { kind: 'payment', state: 'succeeded', reference: 'VAN-1' },
    { kind: 'flight', state: 'succeeded', reference: 'AI-000123' },
    { kind: 'hotel', state: 'failed', reason: 'the last room went' },
    { kind: 'ground', state: 'not-reached' },
  ];
  const reports = reportFor(steps);
  const outcome = outcomeFor({ reports, irreversibleStepCompleted: true });

  assert.equal(outcome, 'ESCALATED');
  assert.equal(isPartialSuccess(reports), true);
  assert.equal(reports.find((r) => r.component === 'flight')!.status, 'CONFIRMED');
  assert.equal(reports.find((r) => r.component === 'hotel')!.status, 'PENDING_MANUAL_RESCUE');
});

test('ROLLED_BACK and NOT_ATTEMPTED are never conflated', () => {
  const reports = reportFor([
    { kind: 'hotel', state: 'compensated' },
    { kind: 'ground', state: 'not-reached' },
  ]);
  const hotel = reports.find((r) => r.component === 'hotel')!;
  const ground = reports.find((r) => r.component === 'ground')!;

  assert.equal(hotel.status, 'ROLLED_BACK');
  assert.equal(ground.status, 'NOT_ATTEMPTED');
  assert.notEqual(hotel.detail, ground.detail);
  assert.match(hotel.detail, /cancelled/);
  assert.match(ground.detail, /never booked/);
});

test('a confirmed component always carries a reference the member holds', () => {
  const reports = reportFor([{ kind: 'flight', state: 'succeeded', reference: 'AI-000123' }]);
  assert.equal(reports[0].reference, 'AI-000123');
  assert.match(reports[0].detail, /AI-000123/);
});

test('a failed component never carries a reference', () => {
  const reports = reportFor([{ kind: 'hotel', state: 'failed', reason: 'sold out' }]);
  assert.equal(reports[0].reference, null);
});

test('a clean unwind with nothing held rolls back rather than escalating', () => {
  const reports = reportFor([
    { kind: 'payment', state: 'compensated' },
    { kind: 'flight', state: 'compensated' },
    { kind: 'ground', state: 'failed', reason: 'no vehicle' },
  ]);
  assert.equal(outcomeFor({ reports, irreversibleStepCompleted: false }), 'ROLLED_BACK');
});

test('everything succeeding is CONFIRMED', () => {
  const reports = reportFor([
    { kind: 'flight', state: 'succeeded', reference: 'A' },
    { kind: 'hotel', state: 'succeeded', reference: 'B' },
  ]);
  assert.equal(outcomeFor({ reports, irreversibleStepCompleted: true }), 'CONFIRMED');
});

test('the push carries the same split as the screen', () => {
  const reports = reportFor([
    { kind: 'flight', state: 'succeeded', reference: 'AI-1' },
    { kind: 'hotel', state: 'failed', reason: 'sold out' },
  ]);
  const msg = notificationFor(reports, 'ESCALATED');
  assert.match(msg, /confirmed/);
  assert.match(msg, /still working on your room/);
  assert.doesNotMatch(msg, /^You are rebooked\./);
});

/* ── the reconciliation ledger ───────────────────────────────────────────── */

beforeEach(() => {
  resetReconciliation();
  onFinanceEscalation(() => {});
});

test('a filed claim is pending, and never counted as recovered', () => {
  const c = fileClaim({
    originalTicket: '6E-1', carrier: '6E', memberId: 'p-arjun',
    expected: INR(18_400), now: NOW,
  });
  assert.equal(c.status, 'pending');
  assert.equal(c.amountRecovered.amount, 0);
  assert.equal(outstandingFor('p-arjun', 'INR').amount, 18_400);
});

test('a denial raises finance escalation with a contestable case, not silence', () => {
  const seen: FinanceEscalation[] = [];
  onFinanceEscalation((e) => seen.push(e));

  const c = fileClaim({
    originalTicket: '6E-2', carrier: '6E', memberId: 'p-arjun',
    expected: INR(18_400), now: NOW,
  });
  recordDenial(c.id, { owed: INR(18_400), basis: 'DGCA CAR s3 M IV: cancellation, >6h' }, NOW);

  assert.equal(seen.length, 1);
  assert.equal(seen[0].claim.status, 'denied');
  assert.match(seen[0].contest.basis, /DGCA/);
});

test('a short settlement is partial, not settled, and escalates', () => {
  const seen: FinanceEscalation[] = [];
  onFinanceEscalation((e) => seen.push(e));

  const c = fileClaim({
    originalTicket: 'AI-9', carrier: 'AI', memberId: 'p-priya',
    expected: INR(10_000), now: NOW,
  });
  const after = recordSettlement(c.id, INR(6_000), NOW)!;

  assert.equal(after.status, 'partial');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].contest.owed.amount, 4_000);
});

test('recoveryRate is per carrier and reflects observed outcomes', () => {
  const good = fileClaim({
    originalTicket: 'AI-1', carrier: 'AI', memberId: 'm', expected: INR(10_000), now: NOW,
  });
  recordSettlement(good.id, INR(10_000), NOW);

  const bad = fileClaim({
    originalTicket: '6E-1', carrier: '6E', memberId: 'm', expected: INR(10_000), now: NOW,
  });
  recordDenial(bad.id, { owed: INR(10_000), basis: 'owed' }, NOW);

  assert.equal(recoveryRate('AI'), 1);
  assert.equal(recoveryRate('6E'), 0);
  // A carrier we have no history for falls back rather than being punished.
  assert.equal(recoveryRate('QP'), 0.9);
});

test('pending claims are not counted as failures', () => {
  fileClaim({ originalTicket: 'AI-2', carrier: 'AI', memberId: 'm', expected: INR(5_000), now: NOW });
  assert.equal(recoveryRate('AI'), 0.9, 'a pending claim is not yet evidence of anything');
});

test('the sweep batches by carrier, not one query per claim', () => {
  const later = NOW + (FIRST_CHECK_SECONDS + 1) * 1000;
  for (let i = 0; i < 5; i++) {
    fileClaim({ originalTicket: `6E-${i}`, carrier: '6E', memberId: 'm', expected: INR(1000), now: NOW });
  }
  for (let i = 0; i < 3; i++) {
    fileClaim({ originalTicket: `AI-${i}`, carrier: 'AI', memberId: 'm', expected: INR(1000), now: NOW });
  }

  const batches = sweepBatches(later);
  assert.equal(batches.length, 2, 'eight claims, two carriers, two queries');
  assert.equal(batches.find((b) => b.carrier === '6E')!.claimIds.length, 5);
});

test('a claim filed today is not swept today', () => {
  fileClaim({ originalTicket: 'AI-3', carrier: 'AI', memberId: 'm', expected: INR(1000), now: NOW });
  assert.equal(sweepBatches(NOW + 3600_000).length, 0);
});
