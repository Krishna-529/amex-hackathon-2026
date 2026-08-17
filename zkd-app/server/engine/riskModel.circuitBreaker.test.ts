import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Flight } from '../domain/types';

/**
 * Regression coverage for the circuit breaker + last-known-good fallback
 * added to riskModel.ts's scoreFlight/scoreFlightsBatch: before this, every
 * scorer failure returned null/empty unconditionally, with no distinction
 * between "never scored" and "was fine 40 seconds ago." Each test imports
 * the module fresh (vi.resetModules()) so the breaker's and the
 * last-known-good cache's module-level state never leaks between cases —
 * same pattern server/engine/forecastEventRescore.test.ts already uses for
 * the same reason.
 */
const entityRatesResponse = {
  global_prior: 0.02,
  as_of: '2026-01-01T00:00:00Z',
  carrier: {}, origin: {}, dest: {}, route: {}, origin_month: {},
  origin_hour_density_avg: {}, origin_hour_density_global_avg: 5,
  live_synthetic: null,
};

function realFlight(id = 'flt-test'): Flight {
  return {
    id, code: 'AI 2803', from: 'DEL', to: 'BOM',
    depISO: '2026-06-15T15:30:00Z', durationMin: 130,
    connectionSlackMinutes: null, hasHardConstraint: false,
    candidates: { alts: [], hotels: [], cabs: [], cabLegs: [] },
  };
}

function stubFetch(scoreHandler: (body: unknown) => Response) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/entity-rates')) {
        return new Response(JSON.stringify(entityRatesResponse), { status: 200 });
      }
      if (url.includes('/score')) {
        const body = init?.body ? JSON.parse(String(init.body)) : null;
        return scoreHandler(body);
      }
      throw new Error(`unexpected fetch to ${url}`);
    }),
  );
}

describe('scoreFlight — circuit breaker + last-known-good fallback', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it('returns null on a scorer failure with no prior successful score to fall back to', async () => {
    stubFetch(() => new Response('boom', { status: 500 }));
    const { scoreFlight } = await import('./riskModel');
    const result = await scoreFlight(realFlight());
    expect(result).toBeNull();
  });

  it('remembers a successful score and serves it (labeled stale) once the scorer starts failing', async () => {
    const { scoreFlight } = await import('./riskModel');
    const goodScore = { cancelProbability: 0.02, confidence: 0.8, modelVersion: 'v1', source: 'internal-ml' as const };

    stubFetch(() => new Response(JSON.stringify(goodScore), { status: 200 }));
    const first = await scoreFlight(realFlight());
    expect(first).toMatchObject({ cancelProbability: 0.02 });
    expect(first?.stale).toBeUndefined();

    stubFetch(() => new Response('boom', { status: 500 }));
    const second = await scoreFlight(realFlight());
    expect(second).toMatchObject({ cancelProbability: 0.02, stale: true });
  });

  it('opens the breaker after repeated failures and fast-fails without calling fetch for /score again', async () => {
    const { scoreFlight } = await import('./riskModel');
    let scoreCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/entity-rates')) return new Response(JSON.stringify(entityRatesResponse), { status: 200 });
        scoreCalls += 1;
        return new Response('boom', { status: 500 });
      }),
    );

    // failureThreshold is 5 — five real failed calls open the breaker.
    for (let i = 0; i < 5; i++) {
      await scoreFlight(realFlight());
    }
    expect(scoreCalls).toBe(5);

    // The breaker is now open: this call must fast-fail before hitting fetch again.
    await scoreFlight(realFlight());
    expect(scoreCalls).toBe(5);
  });
});
