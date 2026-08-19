/**
 * The failure this design is most worried about, pinned.
 *
 * A webhook feed that has stopped delivering produces exactly the same
 * observable as a week with no cancellations: nothing arrives. If `laneStatus`
 * ever reports such a feed as healthy, the poller stands down, and the first
 * sign of a dead subscription is a stranded member calling to ask why nobody
 * rebooked them.
 *
 * So the property under test is deliberately pessimistic: **a lane must EARN
 * primary by having actually delivered something recently.** Configured is not
 * healthy. Registered is not healthy. Only recent evidence of life is.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleDelivery, laneStatus, _resetWebhookState, HEARTBEAT_STALE_MS } from './index';
import { hmacHex } from './verify';

const SECRET = 'whsec_lane_test';

function duffelHeaders(body: string, now: number): Headers {
  const t = Math.floor(now / 1000);
  return new Headers({ 'x-duffel-signature': `t=${t},v1=${hmacHex(SECRET, `${t}.${body}`)}` });
}

const CHANGE = JSON.stringify({
  id: 'evt_lane',
  idempotency_key: 'idem_lane',
  type: 'order.airline_initiated_change_detected',
  data: {
    object: {
      order_id: 'ord_lane',
      slices: [{ segments: [{ operating_carrier: { iata_code: 'ZZ' }, operating_carrier_flight_number: '9999', departing_at: '2026-08-24T16:30:00Z' }] }],
    },
  },
});

describe('lane health', () => {
  beforeEach(() => {
    _resetWebhookState();
    vi.stubEnv('DUFFEL_WEBHOOK_SECRET', SECRET);
    vi.stubEnv('WEBHOOK_PUBLIC_URL', 'https://example.test');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('is not primary before anything has ever been delivered', () => {
    // "Registered but never heard from" is exactly the state a misconfigured
    // subscription sits in, and it must not read as healthy.
    const s = laneStatus();
    expect(s.registered).toBe(true);
    expect(s.primary).toBe(false);
    expect(s.providers.find((p) => p.provider === 'duffel')?.stale).toBe(true);
  });

  it('is not registered at all when WEBHOOK_PUBLIC_URL is unset, and says why', () => {
    vi.stubEnv('WEBHOOK_PUBLIC_URL', '');
    const s = laneStatus();
    expect(s.registered).toBe(false);
    expect(s.primary).toBe(false);
    expect(s.reason).toContain('WEBHOOK_PUBLIC_URL');
  });

  it('becomes primary after a real delivery', async () => {
    const now = Date.now();
    await handleDelivery('duffel', CHANGE, duffelHeaders(CHANGE, now));
    expect(laneStatus().primary).toBe(true);
  });

  it('goes stale — and stops being primary — once deliveries dry up', async () => {
    const now = Date.now();
    await handleDelivery('duffel', CHANGE, duffelHeaders(CHANGE, now));
    expect(laneStatus(now).primary).toBe(true);

    const later = now + HEARTBEAT_STALE_MS + 60_000;
    const s = laneStatus(later);
    expect(s.providers.find((p) => p.provider === 'duffel')?.stale).toBe(true);
    expect(s.primary).toBe(false);
  });

  it('never counts the unsubscribed OAG stub towards health', async () => {
    const now = Date.now();
    await handleDelivery('duffel', CHANGE, duffelHeaders(CHANGE, now));
    expect(laneStatus(now).providers.find((p) => p.provider === 'oag')?.configured).toBe(false);
  });
});

describe('delivery handling', () => {
  beforeEach(() => {
    _resetWebhookState();
    vi.stubEnv('DUFFEL_WEBHOOK_SECRET', SECRET);
    vi.stubEnv('WEBHOOK_PUBLIC_URL', 'https://example.test');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('treats a repeat of the same delivery as a duplicate, not a second event', async () => {
    const now = Date.now();
    const first = await handleDelivery('duffel', CHANGE, duffelHeaders(CHANGE, now));
    const second = await handleDelivery('duffel', CHANGE, duffelHeaders(CHANGE, now));
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.ok).toBe(true);
  });

  it('counts a duplicate as a heartbeat — a retry still proves the feed is alive', async () => {
    const now = Date.now();
    await handleDelivery('duffel', CHANGE, duffelHeaders(CHANGE, now));
    await handleDelivery('duffel', CHANGE, duffelHeaders(CHANGE, now));
    expect(laneStatus().providers.find((p) => p.provider === 'duffel')?.deliveries).toBe(2);
  });

  it('succeeds on a flight nobody here has booked', async () => {
    // Flight numbers are reused across routes and subscriptions are per number,
    // so this is expected traffic. Failing it would make a provider retry
    // forever and make a healthy feed look broken.
    const r = await handleDelivery('duffel', CHANGE, duffelHeaders(CHANGE, Date.now()));
    expect(r.ok).toBe(true);
    expect(r.matched).toBe(false);
    expect(r.detail).toContain('no tracked flight');
  });

  it('rejects an unknown provider without throwing', async () => {
    const r = await handleDelivery('nope', '{}', new Headers());
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('unknown provider');
  });

  it('rejects a body that is not JSON without throwing', async () => {
    const r = await handleDelivery('duffel', 'not json at all', new Headers());
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('not JSON');
  });

  it('records an unrecognised event type as handled, not failed', async () => {
    const body = JSON.stringify({ id: 'e2', type: 'order.created' });
    const r = await handleDelivery('duffel', body, duffelHeaders(body, Date.now()));
    expect(r.ok).toBe(true);
    expect(r.matched).toBe(false);
  });
});
