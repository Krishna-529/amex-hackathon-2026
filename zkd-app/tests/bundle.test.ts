import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  bundleCost,
  compose,
  isCoherent,
  lapsedComponents,
  repairPlan,
  singleCurrency,
  stalestAt,
} from '@/lib/bundle';
import type { GroundOption, StayOption } from '@/lib/bundle';
import type { Offer } from '@/server/suppliers/types';

const NOW = Date.parse('2026-08-25T09:00:00Z');
const ARRIVE = NOW + 4 * 3600_000;

function offer(patch: Partial<Offer> = {}): Offer {
  return {
    id: 'o', supplier: 'sandbox', supplierOfferId: 'k', flightCode: 'AI 101',
    from: 'MAA', to: 'DEL',
    departsAt: NOW + 2 * 3600_000, arrivesAt: ARRIVE,
    cabin: 'economy', seatsRemaining: 6,
    price: { amount: 5_000, currency: 'INR' },
    expiresAt: NOW + 6 * 60_000, live: false,
    ...patch,
  };
}

function stay(patch: Partial<StayOption> = {}): StayOption {
  return {
    id: 's', name: 'Andaz Aerocity', checkInAt: ARRIVE + 90 * 60_000,
    checkOutAt: ARRIVE + 20 * 3600_000, rate: 9_400, currency: 'INR',
    cancellationDeadline: ARRIVE + 3600_000, expiresAt: NOW + 2 * 3600_000,
    ...patch,
  };
}

function ground(patch: Partial<GroundOption> = {}): GroundOption {
  return {
    id: 'g', kind: 'sedan', seats: 4, pickupAt: ARRIVE + 30 * 60_000,
    fare: 1_450, currency: 'INR', expiresAt: NOW + 30 * 60_000,
    ...patch,
  };
}

/* ── coherence is a hard constraint, not a ranking term ──────────────────── */

test('a coherent bundle passes', () => {
  const b = compose({ flight: offer(), stay: stay(), ground: [ground()], now: NOW });
  assert.equal(isCoherent(b, 1), true);
});

test('a room you cannot reach in time is not a worse room, it is not a room', () => {
  const b = compose({
    flight: offer(),
    stay: stay({ checkInAt: ARRIVE - 2 * 3600_000 }),
    ground: [ground()],
    now: NOW,
  });
  assert.equal(isCoherent(b, 1), false);
});

test('a pickup before the flight lands is incoherent', () => {
  const b = compose({
    flight: offer(),
    stay: null,
    ground: [ground({ pickupAt: ARRIVE - 60 * 60_000 })],
    now: NOW,
  });
  assert.equal(isCoherent(b, 1), false);
});

test('coherence is evaluated against party size, not against one', () => {
  const b = compose({ flight: offer({ seatsRemaining: 3 }), stay: stay(), ground: [ground({ seats: 4 })], now: NOW });
  assert.equal(isCoherent(b, 1), true);
  assert.equal(isCoherent(b, 6), false, 'three seats and a four-seat cab cannot carry six');
});

/* ── the repair hierarchy ────────────────────────────────────────────────── */

test('only a dead flight kills a bundle', () => {
  const r = repairPlan({ flightGone: true, stayGone: true, groundStale: true, flightRetimed: false });
  assert.equal(r.action, 'cascade');
});

test('a sold-out hotel is repaired against the same flight, not discarded', () => {
  const r = repairPlan({ flightGone: false, stayGone: true, groundStale: false, flightRetimed: false });
  assert.equal(r.action, 'rederive-stay');
  assert.equal(r.cost, 'moderate');
});

test('a stale cab quote is the cheapest possible repair', () => {
  const r = repairPlan({ flightGone: false, stayGone: false, groundStale: true, flightRetimed: false });
  assert.equal(r.action, 'requote-ground');
  assert.equal(r.cost, 'cheapest');
});

test('a re-timed flight invalidates both derived windows even when nothing is gone', () => {
  const r = repairPlan({ flightGone: false, stayGone: false, groundStale: false, flightRetimed: true });
  assert.equal(r.action, 'rederive-windows');
});

test('an intact bundle needs no repair', () => {
  const r = repairPlan({ flightGone: false, stayGone: false, groundStale: false, flightRetimed: false });
  assert.equal(r.action, 'none');
});

/* ── staleness: cheaper to avoid a stale cascade than to detect one ──────── */

test('a bundle is only as fresh as its weakest component', () => {
  const b = compose({ flight: offer(), stay: stay(), ground: [ground()], now: NOW });
  b.validatedAt.stay = NOW - 40 * 60_000;
  assert.equal(stalestAt(b), NOW - 40 * 60_000);
});

test('lapsed components are reported per component, so a cascade revalidates all', () => {
  const b = compose({
    flight: offer({ expiresAt: NOW - 1 }),
    stay: stay({ expiresAt: NOW - 1 }),
    ground: [ground({ expiresAt: NOW + 3600_000 })],
    now: NOW,
  });
  assert.deepEqual(lapsedComponents(b, NOW), ['flight', 'stay']);
});

test('a fallback whose hotel quote quietly expired is caught', () => {
  const b = compose({
    flight: offer({ expiresAt: NOW + 3600_000 }),
    stay: stay({ expiresAt: NOW - 60_000 }),
    ground: [ground()],
    now: NOW,
  });
  assert.deepEqual(lapsedComponents(b, NOW), ['stay']);
});

/* ── money ───────────────────────────────────────────────────────────────── */

test('a bundle in one currency totals its parts', () => {
  const b = compose({ flight: offer(), stay: stay(), ground: [ground()], now: NOW });
  assert.equal(singleCurrency(b), true);
  assert.equal(bundleCost(b).amount, 5_000 + 9_400 + 1_450);
});

test('mixed currencies are never silently summed', () => {
  const b = compose({
    flight: offer(),
    stay: stay({ currency: 'GBP', rate: 120 }),
    ground: [ground()],
    now: NOW,
  });
  assert.equal(singleCurrency(b), false);
  assert.equal(bundleCost(b).amount, 5_000 + 1_450, 'the GBP room is excluded, not converted');
});
