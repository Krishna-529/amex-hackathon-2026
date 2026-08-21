import { describe, expect, it } from 'vitest';
import { estimateRefund } from './refund';
describe('refund scales with the party', () => {
  // farePaid is per traveller, and alternatives are priced with partyFare
  // (fare x party). If the refund did not scale too, a party of six would be
  // comparing a six-person replacement against a one-person refund.
  const flight = { id: 'f-multi', code: 'AI 415', from: 'DEL', to: 'BLR' } as never;

  const booking = (travellers: number) => ({
    id: 'bk5', flightId: 'f-multi', passengerId: 'p-arjun', seat: '12A', pnr: 'MX9F2K',
    cabin: 'Economy', travellerIds: Array.from({ length: travellers }, (_, i) => `tr${i}`),
    seats: [], farePaid: { amount: 6450, currency: 'INR' },
    fareBasis: 'partially-refundable' as const,
  }) as never;

  it('refunds every ticket on the PNR when the carrier cancels', () => {
    const r = estimateRefund({ flight, booking: booking(6), cancelledBy: 'carrier', delayHours: 24 });
    expect(r.known).toBe(true);
    expect(r.total).toBe(6450 * 6);
  });

  it('is unchanged for a single traveller', () => {
    const r = estimateRefund({ flight, booking: booking(1), cancelledBy: 'carrier', delayHours: 24 });
    expect(r.total).toBe(6450);
  });

  it('scales the voluntary cancellation charge too', () => {
    const r = estimateRefund({ flight, booking: booking(4), cancelledBy: 'member', delayHours: 0 });
    // 25% of the whole PNR, not 25% of one ticket.
    expect(r.total).toBe(6450 * 4 - Math.round(6450 * 4 * 0.25));
  });
});
