/**
 * `altsForParty` had zero test coverage before this file, despite being the
 * one function EVERY live consumer of alternate flights passes through —
 * display (views.ts) and decision-making (pipeline/index.ts, simulation.ts,
 * the intent route) alike. These cover the 2026-08-21 hardening: malformed
 * supplier data (NaN/negative fare or seats) can no longer masquerade as a
 * legitimate option, and a stale fabricated row surviving in Postgres from
 * before the 2026-08-19 fix is now caught on every path, not only the
 * member-facing read path `dropFabricatedAlts` already guarded.
 */
import { describe, it, expect } from 'vitest';
import { altsForParty } from './altsForParty';
import type { Alt } from './types';

function baseAlt(over: Partial<Alt> = {}): Alt {
  return {
    id: 'a1',
    code: 'AI 101',
    dep: '10:00',
    arr: '13:00',
    departsAt: 0,
    arrivesAt: 0,
    cabin: 'Economy',
    seats: 9,
    fare: 8000,
    currency: 'INR',
    expiresAt: null,
    supplier: 'duffel',
    supplierOfferId: 'off_1',
    kind: 'market',
    ok: true,
    why: 'From live supplier inventory',
    ...over,
  } as Alt;
}

describe('altsForParty: seat sanitization', () => {
  it('fits a party exactly at the seat count', () => {
    const [pa] = altsForParty([baseAlt({ seats: 4 })], 4);
    expect(pa.fitsParty).toBe(true);
  });

  it('does not fit a party one over the seat count', () => {
    const [pa] = altsForParty([baseAlt({ seats: 3 })], 4);
    expect(pa.fitsParty).toBe(false);
    expect(pa.ok).toBe(false);
    expect(pa.why).toContain('3 seats');
  });

  it('coerces a negative seat count to 0 (fails safe, never treated as "plenty of room")', () => {
    const [pa] = altsForParty([baseAlt({ seats: -5 })], 1);
    expect(pa.seats).toBe(0);
    expect(pa.fitsParty).toBe(false);
  });

  it('coerces a NaN seat count to 0', () => {
    const [pa] = altsForParty([baseAlt({ seats: NaN })], 1);
    expect(pa.seats).toBe(0);
    expect(pa.fitsParty).toBe(false);
  });

  it('floors a fractional seat count', () => {
    const [pa] = altsForParty([baseAlt({ seats: 4.9 })], 4);
    expect(pa.seats).toBe(4);
  });
});

describe('altsForParty: invalid fare is disqualified, never coerced to a free option', () => {
  it('rejects a NaN fare outright rather than pricing it at zero', () => {
    const [pa] = altsForParty([baseAlt({ fare: NaN })], 1);
    expect(pa.ok).toBe(false);
    expect(pa.why).toContain('invalid');
    expect(pa.partyFare).toBe(0); // recorded honestly as zero-because-unknown, not as a real price
  });

  it('rejects a negative fare outright', () => {
    const [pa] = altsForParty([baseAlt({ fare: -100 })], 1);
    expect(pa.ok).toBe(false);
  });

  it('accepts a genuine zero fare as long as it is not the fabricated signature (seats < 99)', () => {
    const [pa] = altsForParty([baseAlt({ fare: 0, seats: 4 })], 1);
    expect(pa.ok).toBe(true);
    expect(pa.partyFare).toBe(0);
  });

  it('keeps a normal positive fare unaffected', () => {
    const [pa] = altsForParty([baseAlt({ fare: 6500 })], 2);
    expect(pa.partyFare).toBe(13000);
    expect(pa.ok).toBe(true);
  });
});

describe('altsForParty: a stale fabricated row is disqualified on every path, not just display', () => {
  it('disqualifies the exact fare:0/seats:99 signature the deleted carrierProtectedAlt() used to write', () => {
    const [pa] = altsForParty([baseAlt({ fare: 0, seats: 99 })], 1);
    expect(pa.ok).toBe(false);
    expect(pa.why).toContain('fabricated');
  });

  it('disqualifies any kind other than "market" (the type system no longer allows one, but a pre-2026-08-19 DB row still can be)', () => {
    const stale = baseAlt({ kind: 'carrier-protected' as Alt['kind'], fare: 0, seats: 99 });
    const [pa] = altsForParty([stale], 1);
    expect(pa.ok).toBe(false);
  });

  it('does NOT disqualify a real free-ish option with a normal seat count', () => {
    // fare:0 alone is legitimate (a real statutory reissue); it's the fare:0
    // AND seats>=99 combination that's the fabrication's fingerprint.
    const [pa] = altsForParty([baseAlt({ fare: 0, seats: 6 })], 1);
    expect(pa.ok).toBe(true);
  });

  it('does NOT disqualify a real high-capacity flight just for having many seats', () => {
    // seats:99 alone (with a real fare) is legitimate — a genuinely large
    // aircraft. Only the fare:0 + seats>=99 COMBINATION is fabricated.
    const [pa] = altsForParty([baseAlt({ fare: 8000, seats: 150 })], 1);
    expect(pa.ok).toBe(true);
  });
});

describe('altsForParty: passes through a healthy alt unchanged', () => {
  it('keeps ok/why from the source when everything validates', () => {
    const [pa] = altsForParty([baseAlt({ ok: true, why: 'From live supplier inventory' })], 1);
    expect(pa.ok).toBe(true);
    expect(pa.why).toBe('From live supplier inventory');
  });

  it('preserves an already-false ok/why (e.g. cabin entitlement) rather than overriding it', () => {
    const [pa] = altsForParty([baseAlt({ ok: false, why: 'Business is above your entitlement' })], 1);
    expect(pa.ok).toBe(false);
    expect(pa.why).toBe('Business is above your entitlement');
  });
});
