import { afterEach, describe, expect, it, vi } from 'vitest';
import { evaluatePolicy } from './opaClient';
import type { PolicyInput } from './types';

const input: PolicyInput = {
  consent: 'ask',
  originalFlightOperated: false,
  offerId: 'alt-1',
  rejectedOfferIds: [],
  cabinRank: 0,
  cabinEntitlementRank: 0,
  fareDelta: 0,
  fareDeltaCap: 25000,
  departureAtMs: Date.now() + 3_600_000,
  travelWindowStartMs: Date.now(),
  travelWindowEndMs: Date.now() + 86_400_000,
  seatsAvailable: 4,
  partySize: 1,
};

describe('evaluatePolicy (OPA client — fail-closed)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns allow:true with no deny reasons when OPA allows', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ result: { allow: true, deny: [] } }), { status: 200 })),
    );
    const decision = await evaluatePolicy(input, 'http://opa.test');
    expect(decision.allow).toBe(true);
    expect(decision.deny).toEqual([]);
    expect(decision.failClosed).toBe(false);
  });

  it('returns allow:false with reasons when OPA denies', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ result: { allow: false, deny: ['fare_delta_cap'] } }), { status: 200 }),
      ),
    );
    const decision = await evaluatePolicy(input, 'http://opa.test');
    expect(decision.allow).toBe(false);
    expect(decision.deny).toEqual(['fare_delta_cap']);
  });

  it('fails closed (deny) when OPA is unreachable, never fails open', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    );
    const decision = await evaluatePolicy(input, 'http://opa.test');
    expect(decision.allow).toBe(false);
    expect(decision.failClosed).toBe(true);
  });

  it('fails closed when OPA responds with a non-2xx status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
    const decision = await evaluatePolicy(input, 'http://opa.test');
    expect(decision.allow).toBe(false);
    expect(decision.failClosed).toBe(true);
  });

  it('fails closed when the response shape is malformed (missing result.allow)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ result: {} }), { status: 200 })));
    const decision = await evaluatePolicy(input, 'http://opa.test');
    expect(decision.allow).toBe(false);
    expect(decision.failClosed).toBe(true);
  });

  it('fails closed on a timeout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, opts?: RequestInit) => {
        const signal = opts?.signal;
        return new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new Error('aborted')));
        });
      }),
    );
    const decision = await evaluatePolicy(input, 'http://opa.test');
    expect(decision.allow).toBe(false);
    expect(decision.failClosed).toBe(true);
  }, 5000);
});
