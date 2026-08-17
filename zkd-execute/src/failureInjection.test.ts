import { describe, expect, it } from 'vitest';
import { ApplicationFailure } from '@temporalio/common';
import { checkInjectedFailure } from './failureInjection';
import type { RecoveryIntent } from 'zkd-shared';

function intentWith(overrides: Partial<Pick<RecoveryIntent, 'flight' | 'hotel' | 'ground'>>): RecoveryIntent {
  const now = Date.now();
  return {
    idempotencyKey: 'key-1',
    pnr: 'ABC123',
    originalBookingId: 'orig-1',
    memberId: 'mem-1',
    partySize: 1,
    travellerIds: ['trav-1'],
    passenger: { givenName: 'A', familyName: 'B', dob: '1990-01-01', gender: 'f', email: 'a@b.com', phoneNumber: '+911234567890' },
    consent: 'ask',
    disposition: 'involuntary',
    flight: {
      supplier: 'sabre', supplierOfferId: 'off-1', flightCode: 'AI101', from: 'MAA', to: 'DEL',
      departsAtMs: now, cabin: 'Economy', price: { amount: 100, currency: 'INR' }, expiresAtMs: null,
    },
    hotel: null,
    ground: null,
    perTransactionCap: { amount: 25000, currency: 'INR' },
    policyInput: {
      consent: 'ask', originalFlightOperated: false, offerId: 'off-1', rejectedOfferIds: [],
      cabinRank: 0, cabinEntitlementRank: 0, fareDelta: 0, fareDeltaCap: 25000,
      departureAtMs: now, travelWindowStartMs: now, travelWindowEndMs: now, seatsAvailable: 1, partySize: 1,
    },
    callbackUrl: null,
    requestedAt: now,
    ...overrides,
  };
}

describe('checkInjectedFailure', () => {
  it('does nothing for a clean offer id', () => {
    const intent = intentWith({});
    expect(() => checkInjectedFailure('bookFlight', intent)).not.toThrow();
  });

  it('throws a non-retryable ApplicationFailure when the flight offer is marked', () => {
    const intent = intentWith({ flight: { ...intentWith({}).flight, supplierOfferId: 'INJECT-FAIL-x' } });
    try {
      checkInjectedFailure('bookFlight', intent);
      expect.unreachable('expected a throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ApplicationFailure);
      expect((e as ApplicationFailure).nonRetryable).toBe(true);
    }
  });

  it('only fires for the step whose own offer is marked, not every step', () => {
    const intent = intentWith({
      hotel: { supplierOfferId: 'INJECT-FAIL-hotel', name: 'H', checkin: '2026-01-01', rooms: 1, rate: { amount: 1, currency: 'INR' } },
    });
    expect(() => checkInjectedFailure('bookFlight', intent)).not.toThrow();
    expect(() => checkInjectedFailure('bookHotel', intent)).toThrow();
  });

  it('is a no-op for a step with no matching snapshot (e.g. bookGround with no ground leg)', () => {
    const intent = intentWith({});
    expect(() => checkInjectedFailure('bookGround', intent)).not.toThrow();
  });
});
