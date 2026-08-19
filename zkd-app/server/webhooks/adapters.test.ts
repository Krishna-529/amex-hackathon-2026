/**
 * Adapters decide what counts as disruption-shaped, and that decision spends
 * money: a delivery normalised into an event reaches `classify()`, and a
 * cancellation reaching `classify()` starts a recovery that ends in a charge.
 *
 * The two failure directions are not symmetric, and both are tested:
 *
 *   - **Too eager** — treating a gate change or a 10-minute re-time as a
 *     cancellation books a replacement for a flight that is still going to
 *     operate. This is the expensive one.
 *   - **Too shy** — dropping a real cancellation leaves someone stranded while
 *     the system believes all is well.
 */
import { describe, expect, it } from 'vitest';
import { duffelAdapter } from './duffel';
import { aerodataboxAdapter } from './aerodatabox';
import { oagAdapter } from './oag';

describe('duffel adapter', () => {
  const event = (over: Record<string, unknown> = {}) => ({
    id: 'evt_1',
    idempotency_key: 'idem_1',
    type: 'order.airline_initiated_change_detected',
    data: {
      object: {
        order_id: 'ord_1',
        slices: [
          {
            segments: [
              {
                operating_carrier: { iata_code: '6E' },
                operating_carrier_flight_number: '5231',
                departing_at: '2026-08-24T16:30:00Z',
              },
            ],
          },
        ],
      },
    },
    ...over,
  });

  it('normalises an airline-initiated change into one event', () => {
    const [e] = duffelAdapter.normalise(event());
    expect(e.flightCode).toBe('6E 5231');
    expect(e.supplierOrderId).toBe('ord_1');
    expect(e.scheduledDepartureAt).toBe(Date.parse('2026-08-24T16:30:00Z'));
    expect(e.departureDate).toBe('2026-08-24');
  });

  it('does NOT assert a cancellation — it reports the change and lets classify decide', () => {
    // The same event type covers a 10-minute re-time and an outright
    // cancellation. Hard-coding "cancelled" here would book a replacement for
    // a flight that is still operating.
    const [e] = duffelAdapter.normalise(event());
    expect(e.status).toBe('airline_initiated_change');
  });

  it('ignores order events that are not disruptions', () => {
    expect(duffelAdapter.normalise(event({ type: 'order.created' }))).toEqual([]);
    expect(duffelAdapter.normalise(event({ type: undefined }))).toEqual([]);
  });

  it('prefers idempotency_key for dedupe, as Duffel instructs', () => {
    expect(duffelAdapter.deliveryId(event())).toBe('idem_1');
    expect(duffelAdapter.deliveryId(event({ idempotency_key: undefined }))).toBe('evt_1');
  });

  it('falls back to the marketing carrier when there is no operating one', () => {
    const payload = event();
    const seg = (payload.data.object.slices[0].segments[0] as Record<string, unknown>);
    delete seg.operating_carrier;
    delete seg.operating_carrier_flight_number;
    seg.marketing_carrier = { iata_code: 'AI' };
    seg.marketing_carrier_flight_number = '2971';
    expect(duffelAdapter.normalise(payload)[0].flightCode).toBe('AI 2971');
  });

  it('drops a payload with no resolvable flight rather than guessing', () => {
    expect(duffelAdapter.normalise(event({ data: { object: {} } }))).toEqual([]);
    expect(duffelAdapter.normalise({})).toEqual([]);
  });
});

describe('aerodatabox adapter', () => {
  const delivery = (over: Record<string, unknown> = {}) => ({
    listener_id: 'lis_1',
    changed: ['status'],
    flight: {
      number: '6E 5231',
      status: 'Cancelled',
      departure: {
        scheduledTime: { utc: '2026-08-24T16:30:00Z' },
      },
    },
    ...over,
  });

  it('passes a status change through with the carrier’s own status string', () => {
    const [e] = aerodataboxAdapter.normalise(delivery());
    expect(e.flightCode).toBe('6E 5231');
    expect(e.status).toBe('Cancelled');
    expect(e.scheduledDepartureAt).toBe(Date.parse('2026-08-24T16:30:00Z'));
  });

  it('ignores a gate change — most deliveries are these', () => {
    // The expensive failure direction. A belt or stand change must not reach
    // classify() looking like a disruption.
    expect(aerodataboxAdapter.normalise(delivery({ changed: ['departure.gate'] }))).toEqual([]);
    expect(aerodataboxAdapter.normalise(delivery({ changed: ['arrival.baggageBelt'] }))).toEqual([]);
  });

  it('forwards a schedule move, which is invisible as a delay', () => {
    // A carrier that moves a flight reports zero delay against its own new
    // schedule. The shift against what the member BOOKED is the only signal,
    // so the revised time has to travel.
    const [e] = aerodataboxAdapter.normalise(
      delivery({
        changed: ['departure.revisedTime'],
        flight: {
          number: '6E 5231',
          status: 'Expected',
          departure: {
            scheduledTime: { utc: '2026-08-24T16:30:00Z' },
            revisedTime: { utc: '2026-08-24T19:30:00Z' },
          },
        },
      }),
    );
    expect(e.scheduledDepartureAt).toBe(Date.parse('2026-08-24T19:30:00Z'));
    expect(e.delayMinutes).toBe(180);
  });

  it('passes through when the provider sent no changed list', () => {
    // Absence of a diff is not evidence that nothing happened; classify() is
    // the thing qualified to decide.
    const d = delivery({ changed: undefined });
    expect(aerodataboxAdapter.normalise(d)).toHaveLength(1);
  });

  it('handles a multi-flight delivery', () => {
    const out = aerodataboxAdapter.normalise({
      changed: ['status'],
      flights: [
        { number: '6E 1', status: 'Cancelled', departure: { scheduledTime: { utc: '2026-08-24T10:00:00Z' } } },
        { number: '6E 2', status: 'Cancelled', departure: { scheduledTime: { utc: '2026-08-24T12:00:00Z' } } },
      ],
    });
    expect(out.map((e) => e.flightCode)).toEqual(['6E 1', '6E 2']);
  });

  it('builds a stable delivery id from what identifies this change', () => {
    const a = aerodataboxAdapter.deliveryId(delivery());
    const b = aerodataboxAdapter.deliveryId(delivery());
    expect(a).toBe(b);
    // A different change on the same flight must not collide with it.
    expect(aerodataboxAdapter.deliveryId(delivery({ changed: ['departure.revisedTime'] }))).not.toBe(a);
  });

  it('returns null when there is nothing at all to key on', () => {
    expect(aerodataboxAdapter.deliveryId({})).toBeNull();
  });
});

describe('oag adapter', () => {
  it('is honestly inert — it can never appear to work', () => {
    // A stub that quietly verified or normalised would be worse than no stub:
    // it would report a healthy lane that receives nothing.
    const v = oagAdapter.verify('{}', new Headers());
    expect(v.ok).toBe(false);
    expect(oagAdapter.normalise({})).toEqual([]);
    expect(oagAdapter.deliveryId({})).toBeNull();
  });
});
