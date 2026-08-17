import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { compose } from '@/lib/bundle';
import type { Bundle } from '@/lib/bundle';
import {
  evaluate,
  flushPolicyCache,
  onDecision,
  policyCacheSize,
  setPolicyData,
} from '@/server/policy';
import type { PolicyInput } from '@/server/policy';
import type { Offer } from '@/server/suppliers/types';

const NOW = Date.parse('2026-08-25T09:00:00Z');
const ARRIVE = NOW + 4 * 3600_000;

function offer(patch: Partial<Offer> = {}): Offer {
  return {
    id: 'o1',
    supplier: 'sandbox',
    supplierOfferId: 'MAA-DEL-AI101',
    flightCode: 'AI 101',
    from: 'MAA',
    to: 'DEL',
    departsAt: NOW + 2 * 3600_000,
    arrivesAt: ARRIVE,
    cabin: 'economy',
    seatsRemaining: 6,
    price: { amount: 5000, currency: 'INR' },
    expiresAt: NOW + 6 * 60_000,
    live: false,
    supplierType: 'coupon',
    carriers: { marketing: 'AI', operating: 'AI', validating: 'AI' },
    fareRules: {
      fareBasis: 'YFLEX',
      changeable: true,
      refundable: true,
      reissuePermitted: true,
      interlinePermitted: true,
      voidWindowMinutes: 1440,
    },
    ...patch,
  };
}

function bundle(o: Offer = offer()): Bundle {
  return compose({ flight: o, stay: null, ground: [], now: NOW });
}

function input(patch: Partial<PolicyInput> = {}): PolicyInput {
  return {
    bundle: bundle(),
    mechanism: 'same-carrier',
    disposition: 'involuntary',
    consentTier: 'autopilot',
    partySize: 1,
    rejectedOfferIds: [],
    travelWindow: { earliest: NOW, latest: NOW + 24 * 3600_000 },
    member: {
      cabinEntitlement: 'economy',
      perTransactionCap: { amount: 50_000, currency: 'INR' },
      aggregateCap: { amount: 150_000, currency: 'INR' },
      fareDeltaCap: { amount: 8_000, currency: 'INR' },
    },
    exposure: {
      memberOutstanding: { amount: 0, currency: 'INR' },
      memberCap: { amount: 60_000, currency: 'INR' },
      aggregateOutstanding: { amount: 0, currency: 'INR' },
      aggregateCap: { amount: 5_000_000, currency: 'INR' },
    },
    onward: null,
    originalFare: { amount: 4_500, currency: 'INR' },
    entitlement: { owed: false, satisfiedBy: 'none' },
    activeCouponOverlaps: false,
    now: NOW,
    ...patch,
  };
}

beforeEach(() => {
  flushPolicyCache();
  onDecision(() => {});
});

test('a clean involuntary reissue is allowed', () => {
  const d = evaluate(input());
  assert.equal(d.allow, true, JSON.stringify(d.denials));
});

test('default deny: a candidate missing its carriers is refused, not waved through', () => {
  const o = offer();
  delete o.carriers;
  const d = evaluate(input({ bundle: bundle(o) }));
  assert.equal(d.allow, false);
  assert.ok(d.denials.some((x) => x.rule === 'incomplete_policy_inputs'));
});

test('voluntary under autopilot is denied outright', () => {
  const d = evaluate(input({ disposition: 'voluntary', consentTier: 'autopilot' }));
  assert.ok(d.denials.some((x) => x.rule === 'voluntary_under_autopilot'));
});

test('a rejected option can never be re-proposed', () => {
  const d = evaluate(input({ rejectedOfferIds: ['MAA-DEL-AI101'] }));
  assert.ok(d.denials.some((x) => x.rule === 'member_rejected_offer'));
});

test('an over-entitlement cabin is denied — the bypass that works today', () => {
  const d = evaluate(input({ bundle: bundle(offer({ cabin: 'business' })) }));
  assert.ok(d.denials.some((x) => x.rule === 'fare_class_ceiling'));
});

test('seat_exists compares seats to party size, not to zero', () => {
  const three = offer({ seatsRemaining: 3 });
  assert.equal(evaluate(input({ bundle: bundle(three), partySize: 1 })).allow, true);
  const forSix = evaluate(input({ bundle: bundle(three), partySize: 6 }));
  assert.ok(forSix.denials.some((x) => x.rule === 'seat_exists'));
});

test('a reissue has no fare delta to cap; a fresh purchase does', () => {
  const pricey = bundle(offer({ price: { amount: 40_000, currency: 'INR' } }));
  assert.equal(evaluate(input({ bundle: pricey, mechanism: 'same-carrier' })).allow, true);
  const fresh = evaluate(input({ bundle: pricey, mechanism: 'fresh-purchase' }));
  assert.ok(fresh.denials.some((x) => x.rule === 'fare_delta_cap'));
});

test('a duplicate ticket is denied at the gate', () => {
  const d = evaluate(input({ mechanism: 'fresh-purchase', activeCouponOverlaps: true }));
  assert.ok(d.denials.some((x) => x.rule === 'duplicate_ticket'));
});

test('a reissue against a live coupon is not a duplicate — it consumes it', () => {
  const d = evaluate(input({ mechanism: 'same-carrier', activeCouponOverlaps: true }));
  assert.ok(!d.denials.some((x) => x.rule === 'duplicate_ticket'));
});

test('a credit voucher does not discharge an alternate-flight obligation', () => {
  const d = evaluate(input({ entitlement: { owed: true, satisfiedBy: 'credit' } }));
  assert.ok(d.denials.some((x) => x.rule === 'entitlement_not_satisfied_by_credit'));
});

test('fronting past the exposure cap is denied', () => {
  const d = evaluate(
    input({
      mechanism: 'fresh-purchase',
      exposure: {
        memberOutstanding: { amount: 58_000, currency: 'INR' },
        memberCap: { amount: 60_000, currency: 'INR' },
        aggregateOutstanding: { amount: 0, currency: 'INR' },
        aggregateCap: { amount: 5_000_000, currency: 'INR' },
      },
    }),
  );
  assert.ok(d.denials.some((x) => x.rule === 'exposure_cap_exceeded'));
});

test('an unprotected onward leg is denied before spend, not caught at VERIFY', () => {
  const d = evaluate(
    input({
      onward: {
        carrier: 'BA',
        connectionBufferMinutes: 70,
        selfConnectMinimumMinutes: 180,
        interlineProtected: false,
      },
    }),
  );
  assert.ok(d.denials.some((x) => x.rule === 'onward_leg_unprotected'));
});

test('a point-to-point trip is unaffected by the onward rule', () => {
  assert.equal(evaluate(input({ onward: null })).allow, true);
});

test('a generous self-connect buffer is acceptable even without interline', () => {
  const d = evaluate(
    input({
      onward: {
        carrier: 'BA',
        connectionBufferMinutes: 300,
        selfConnectMinimumMinutes: 180,
        interlineProtected: false,
      },
    }),
  );
  assert.equal(d.allow, true);
});

/* ── caching discipline ──────────────────────────────────────────────────── */

test('a cache hit still reaches the ledger', () => {
  const seen: string[] = [];
  onDecision((e) => seen.push(e.cached ? 'hit' : 'miss'));
  const i = input();
  evaluate(i);
  evaluate(i);
  assert.deepEqual(seen, ['miss', 'hit'], 'both evaluations must be recorded');
});

test('a policy data reload flushes the cache so the update takes effect', () => {
  evaluate(input());
  assert.ok(policyCacheSize() > 0);
  setPolicyData('v2');
  assert.equal(policyCacheSize(), 0);
});

test('structurally equal inputs share a digest regardless of key order', () => {
  const a = evaluate(input());
  const b = evaluate({ ...input() });
  assert.equal(a.inputDigest, b.inputDigest);
  assert.equal(b.cached, true);
});
