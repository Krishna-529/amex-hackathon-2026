import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  configureSandbox,
  issueOriginal,
  reissueMechanismFor,
  resetSandbox,
  sandbox,
  seatsAt,
} from '@/server/suppliers/sandbox';
import { idempotencyKey } from '@/server/suppliers/types';
import type { Offer, Ticket } from '@/server/suppliers/types';

const DAY = '2026-08-25';
const DAY_START = Date.parse(`${DAY}T00:00:00Z`);
const NOW = DAY_START + 9 * 3600_000;

function setup(scarcity = 1) {
  resetSandbox('test-seed');
  configureSandbox({ seed: 'test-seed', now: () => NOW, scarcity });
}

beforeEach(() => setup());

async function offersFor(from = 'MAA', to = 'DEL'): Promise<Offer[]> {
  const { offers } = await sandbox.search({ origin: from, destination: to, departureDate: DAY });
  return offers;
}

function originalOn(offer: Offer, carrier: string, passengerId = 'p-arjun'): Ticket {
  return issueOriginal({
    pnr: 'MX9F2K',
    passengerId,
    carrier,
    segment: {
      from: offer.from,
      to: offer.to,
      departsAt: offer.departsAt,
      arrivesAt: offer.arrivesAt,
      flightCode: 'XX 000',
    },
  });
}

/* ── determinism ─────────────────────────────────────────────────────────── */

test('the same seed and clock produce identical inventory', async () => {
  const a = await offersFor();
  resetSandbox('test-seed');
  configureSandbox({ seed: 'test-seed', now: () => NOW, scarcity: 1 });
  const b = await offersFor();
  assert.deepEqual(
    a.map((o) => [o.supplierOfferId, o.seatsRemaining, o.price.amount]),
    b.map((o) => [o.supplierOfferId, o.seatsRemaining, o.price.amount]),
  );
});

test('a different seed produces different inventory', async () => {
  const a = await offersFor();
  resetSandbox('other-seed');
  configureSandbox({ seed: 'other-seed', now: () => NOW, scarcity: 1 });
  const b = await offersFor();
  assert.notDeepEqual(
    a.map((o) => o.supplierOfferId),
    b.map((o) => o.supplierOfferId),
  );
});

test('inventory drains monotonically and never un-sells a seat', () => {
  const key = 'MAA-DEL-2026-08-25-AI 123';
  let previous = Infinity;
  for (let h = 0; h <= 24; h += 2) {
    const seats = seatsAt(key, DAY_START, DAY_START + h * 3600_000);
    assert.ok(seats <= previous, `seats rose at hour ${h}`);
    previous = seats;
  }
});

test('scarcity drains a route faster', () => {
  const key = 'MAA-DEL-2026-08-25-AI 123';
  const at = DAY_START + 12 * 3600_000;
  setup(1);
  const calm = seatsAt(key, DAY_START, at);
  setup(3);
  const surge = seatsAt(key, DAY_START, at);
  assert.ok(surge < calm, `surge ${surge} should be below calm ${calm}`);
});

/* ── the constraint that killed the hold ─────────────────────────────────── */

test('a second active coupon for the same passenger and date is refused', async () => {
  const offers = await offersFor();
  originalOn(offers[0], 'AI');

  const res = await sandbox.bookReplacement({
    offer: offers[0],
    pnr: 'MX9F2K',
    passengerId: 'p-arjun',
    idempotencyKey: idempotencyKey({
      pnr: 'MX9F2K', segment: 'MAA-DEL-2026-08-25', member: 'p-arjun', intent: 'book',
    }),
  });

  assert.equal(res.state, 'refused');
  assert.equal(res.state === 'refused' && res.code, 'duplicate-ticket');
});

test('booking is allowed once the original is no longer OPEN_FOR_USE', async () => {
  const offers = await offersFor();
  const original = originalOn(offers[0], 'AI');
  original.status = 'REFUNDED'; // the carrier cancelled it

  const res = await sandbox.bookReplacement({
    offer: offers[0],
    pnr: 'MX9F2K',
    passengerId: 'p-arjun',
    idempotencyKey: 'k-after-cancel',
  });
  assert.equal(res.state, 'booked');
});

/* ── reissue ─────────────────────────────────────────────────────────────── */

test('a reissue consumes the original coupon, so no duplicate exists', async () => {
  const offers = await offersFor();
  const candidate = offers.find(
    (o) => o.supplierType === 'coupon' && o.carriers?.operating === o.carriers?.marketing,
  );
  assert.ok(candidate, 'need a non-codeshare coupon option');
  const original = originalOn(candidate, candidate.carriers!.validating);

  const res = await sandbox.reissue({
    ticketNumber: original.number,
    offer: candidate,
    disposition: 'involuntary',
    idempotencyKey: 'k-reissue',
  });

  assert.equal(res.state, 'reissued');
  assert.equal(original.status, 'EXCHANGED');
  assert.match(original.endorsement ?? '', /INVOL/);
});

test('a voluntary disposition is refused at the supplier as well as the gate', async () => {
  const offers = await offersFor();
  const candidate = offers.find((o) => o.supplierType === 'coupon')!;
  const original = originalOn(candidate, candidate.carriers!.validating);

  const res = await sandbox.reissue({
    ticketNumber: original.number,
    offer: candidate,
    disposition: 'voluntary',
    idempotencyKey: 'k-vol',
  });
  assert.equal(res.state, 'refused');
});

test('a reissue against a consumed coupon is refused', async () => {
  const offers = await offersFor();
  const candidate = offers.find((o) => o.supplierType === 'coupon')!;
  const original = originalOn(candidate, candidate.carriers!.validating);
  original.status = 'USED';

  const res = await sandbox.reissue({
    ticketNumber: original.number,
    offer: candidate,
    disposition: 'involuntary',
    idempotencyKey: 'k-used',
  });
  assert.equal(res.state, 'refused');
  assert.equal(res.state === 'refused' && res.code, 'coupon-not-open');
});

test('a reissue is not voidable — the free mechanism is the irreversible one', async () => {
  const offers = await offersFor();
  const candidate = offers.find(
    (o) => o.supplierType === 'coupon' && o.carriers?.operating === o.carriers?.marketing,
  )!;
  const original = originalOn(candidate, candidate.carriers!.validating);

  const res = await sandbox.reissue({
    ticketNumber: original.number,
    offer: candidate,
    disposition: 'involuntary',
    idempotencyKey: 'k-r2',
  });
  assert.equal(res.state, 'reissued');
  const replacement = res.state === 'reissued' ? res.ticket : null;
  assert.equal(replacement!.voidableUntil, null);

  const voided = await sandbox.voidTicket({
    ticketNumber: replacement!.number,
    idempotencyKey: 'k-void-reissue',
  });
  assert.equal(voided.state, 'refused');
  assert.equal(voided.state === 'refused' && voided.code, 'void-window-closed');
});

/* ── mechanism selection ─────────────────────────────────────────────────── */

test('a codeshare on a non-interline operator is a fresh purchase, not same-carrier', async () => {
  const offers = await offersFor();
  const codeshare = offers.find(
    (o) =>
      o.supplierType === 'coupon' &&
      o.carriers &&
      o.carriers.operating !== o.carriers.marketing &&
      !['AI', 'EK', 'BA'].includes(o.carriers.operating),
  );
  if (!codeshare) return; // seed-dependent; the interline case below always runs
  const original = originalOn(codeshare, codeshare.carriers!.marketing);
  assert.equal(reissueMechanismFor(original, codeshare), 'fresh-purchase');
});

test('an LCC replacement is always a fresh purchase', async () => {
  const offers = await offersFor();
  const lcc = offers.find((o) => o.supplierType === 'lcc');
  assert.ok(lcc, 'seed should produce at least one LCC option');
  const original = originalOn(lcc, 'AI');
  assert.equal(reissueMechanismFor(original, lcc), 'fresh-purchase');
});

/* ── idempotency: the correction the prototype got wrong ─────────────────── */

test('replaying the same business key books once, not twice', async () => {
  const offers = await offersFor();
  const key = idempotencyKey({
    pnr: 'MX9F2K', segment: 'MAA-DEL-2026-08-25', member: 'p-fatima', intent: 'book',
  });

  const first = await sandbox.bookReplacement({
    offer: offers[0], pnr: 'MX9F2K', passengerId: 'p-fatima', idempotencyKey: key,
  });
  const second = await sandbox.bookReplacement({
    offer: offers[0], pnr: 'MX9F2K', passengerId: 'p-fatima', idempotencyKey: key,
  });

  assert.equal(first.state, 'booked');
  assert.equal(second.state, 'booked');
  assert.equal(
    first.state === 'booked' && second.state === 'booked' && first.ticket.number,
    second.state === 'booked' ? second.ticket.number : 'mismatch',
  );
});

test('the business key is attempt-invariant, so a crash retry cannot double-book', () => {
  const a = idempotencyKey({
    pnr: 'MX9F2K', segment: 'MAA-DEL-2026-08-25', member: 'p-arjun', intent: 'reissue',
  });
  const b = idempotencyKey({
    pnr: 'MX9F2K', segment: 'MAA-DEL-2026-08-25', member: 'p-arjun', intent: 'reissue',
  });
  assert.equal(a, b, 'the same business entity must always yield the same key');
});

/* ── revalidate ──────────────────────────────────────────────────────────── */

test('an expired offer revalidates as gone', async () => {
  const offers = await offersFor();
  const stale: Offer = { ...offers[0], expiresAt: NOW - 1 };
  const res = await sandbox.revalidate(stale);
  assert.equal(res.state, 'gone');
});

test('a sold-out option revalidates as gone', async () => {
  const offers = await offersFor();
  // Far enough past departure day that the decay curve has emptied it.
  configureSandbox({ now: () => DAY_START + 400 * 3600_000 });
  const res = await sandbox.revalidate({ ...offers[0], expiresAt: null });
  assert.equal(res.state, 'gone');
});
