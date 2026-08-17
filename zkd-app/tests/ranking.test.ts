import { test } from 'node:test';
import assert from 'node:assert/strict';

import { compose } from '@/lib/bundle';
import { costsFor, rank } from '@/lib/ranking';
import type { Candidate } from '@/lib/ranking';
import type { Offer, ReissueMechanism } from '@/server/suppliers/types';

const NOW = Date.parse('2026-08-25T09:00:00Z');

function offer(patch: Partial<Offer> = {}): Offer {
  return {
    id: 'o',
    supplier: 'sandbox',
    supplierOfferId: 'k',
    flightCode: 'AI 101',
    from: 'MAA',
    to: 'DEL',
    departsAt: NOW + 2 * 3600_000,
    arrivesAt: NOW + 4 * 3600_000,
    cabin: 'economy',
    seatsRemaining: 5,
    price: { amount: 5_000, currency: 'INR' },
    expiresAt: NOW + 6 * 60_000,
    live: false,
    supplierType: 'coupon',
    carriers: { marketing: 'AI', operating: 'AI', validating: 'AI' },
    fareRules: {
      fareBasis: 'Y', changeable: true, refundable: true,
      reissuePermitted: true, interlinePermitted: true, voidWindowMinutes: 1440,
    },
    ...patch,
  };
}

function candidate(args: {
  mechanism: ReissueMechanism;
  price: number;
  arrivesAt?: number;
  fronting?: boolean;
  recoveryRate?: number;
  reversible?: boolean;
  id?: string;
}): Candidate {
  const o = offer({
    supplierOfferId: args.id ?? args.mechanism,
    price: { amount: args.price, currency: 'INR' },
    arrivesAt: args.arrivesAt ?? NOW + 4 * 3600_000,
  });
  const bundle = compose({ flight: o, stay: null, ground: [], now: NOW });
  const cost = costsFor({
    bundle,
    mechanism: args.mechanism,
    originalFare: { amount: 4_500, currency: 'INR' },
    fronting: args.fronting ?? false,
    recoveryRate: args.recoveryRate ?? 0.9,
    stayOwedByCarrier: true,
  });
  return { bundle, mechanism: args.mechanism, cost, reversible: args.reversible ?? false };
}

/* ── the two costs ───────────────────────────────────────────────────────── */

test('an involuntary reissue costs nobody anything', () => {
  const c = candidate({ mechanism: 'same-carrier', price: 40_000 });
  assert.equal(c.cost.netEconomic.amount, 0);
  assert.equal(c.cost.memberVisible.amount, 0);
  assert.equal(c.cost.flightSource, 'airline_owed');
});

test('a fronted purchase shows zero to the member but is not economically free', () => {
  const c = candidate({ mechanism: 'fresh-purchase', price: 18_400, fronting: true, recoveryRate: 0.9 });
  assert.equal(c.cost.memberVisible.amount, 0);
  assert.equal(c.cost.netEconomic.amount, 1_840); // the unrecovered 10%
  assert.equal(c.cost.flightSource, 'fronted_pending_recovery');
});

test('a carrier that refuses valid claims makes fronting against it dearer', () => {
  const good = candidate({ mechanism: 'fresh-purchase', price: 10_000, fronting: true, recoveryRate: 0.95 });
  const bad = candidate({ mechanism: 'fresh-purchase', price: 10_000, fronting: true, recoveryRate: 0.2 });
  assert.ok(bad.cost.netEconomic.amount > good.cost.netEconomic.amount);
  assert.equal(good.cost.memberVisible.amount, bad.cost.memberVisible.amount);
});

test('without fronting the member pays the delta, not the whole fare', () => {
  const c = candidate({ mechanism: 'fresh-purchase', price: 7_000, fronting: false });
  assert.equal(c.cost.memberVisible.amount, 2_500);
  assert.equal(c.cost.flightSource, 'member_paid');
});

/* ── the inversion this exists to prevent ────────────────────────────────── */

test('a free reissue still outranks a fronted purchase that shows the member zero', () => {
  const reissue = candidate({ mechanism: 'same-carrier', price: 6_000, id: 'reissue' });
  const fronted = candidate({
    mechanism: 'fresh-purchase', price: 18_400, fronting: true, recoveryRate: 0.9,
    reversible: true, id: 'fronted',
  });

  // Both show zero to the member, and the fronted one is the reversible one — so
  // ranking on member-visible cost would put it first. It must not.
  assert.equal(reissue.cost.memberVisible.amount, fronted.cost.memberVisible.amount);
  assert.equal(fronted.reversible, true);

  const [first] = rank([fronted, reissue], { materialityMinutes: 90 });
  assert.equal(first.mechanism, 'same-carrier', 'net economic cost must dominate, not what is shown');
});

/* ── materiality gates cost dominance ────────────────────────────────────── */

test('a free seat that arrives materially later loses to a paid one', () => {
  const slowFree = candidate({
    mechanism: 'same-carrier', price: 6_000,
    arrivesAt: NOW + 10 * 3600_000, id: 'slow',
  });
  const fastPaid = candidate({
    mechanism: 'fresh-purchase', price: 18_400, fronting: true, recoveryRate: 0.9,
    arrivesAt: NOW + 4 * 3600_000, id: 'fast',
  });
  const [first] = rank([slowFree, fastPaid], { materialityMinutes: 90 });
  assert.equal(first.mechanism, 'fresh-purchase');
});

test('an immaterially later free seat still wins', () => {
  const slightlySlowFree = candidate({
    mechanism: 'same-carrier', price: 6_000,
    arrivesAt: NOW + 4 * 3600_000 + 30 * 60_000, id: 'slow',
  });
  const fastPaid = candidate({
    mechanism: 'fresh-purchase', price: 18_400, fronting: true, recoveryRate: 0.9,
    arrivesAt: NOW + 4 * 3600_000, id: 'fast',
  });
  const [first] = rank([slightlySlowFree, fastPaid], { materialityMinutes: 90 });
  assert.equal(first.mechanism, 'same-carrier');
});

test('reversibility separates candidates that are otherwise equal', () => {
  const a = candidate({ mechanism: 'fresh-purchase', price: 7_000, reversible: false, id: 'a' });
  const b = candidate({ mechanism: 'fresh-purchase', price: 7_000, reversible: true, id: 'b' });
  const [first] = rank([a, b], { materialityMinutes: 90 });
  assert.equal(first.reversible, true);
});
