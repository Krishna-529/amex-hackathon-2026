import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { __resetRateLimitsForTests } from '@/server/rateLimit';

/**
 * Regression coverage for a real gap the neighbor-smoothing feature depends
 * on: this route previously had NO rate limiting at all — a member could
 * force unlimited real model calls, directly undercutting the whole reason
 * server/engine/neighborSmoothing.ts exists (reducing real model-call
 * volume). Asserts the limit is per-MEMBER (keyed off the session, not the
 * client IP like most other rate-limited routes) and that the 429 response
 * carries a real, positive retryAfterMs the client UI can count down.
 */
const reverifyMock = vi.fn(async (_flightId: string) => ({
  previous: null,
  current: { pct: 3 },
  deltaPct: 0,
  modelVersionChanged: false,
  configVersionChanged: false,
  flagged: false,
  note: 'ok',
}));
vi.mock('@/server/engine/forecast', () => ({ reverify: reverifyMock }));

// vi.mock factories are hoisted above other module-scope code, so vitest
// requires an outer variable referenced inside one to be prefixed `mock` —
// this lets each test pick which "signed-in member" the request belongs to.
let mockPassengerId = 'p-a';
vi.mock('@/server/auth/guard', () => ({
  requireSession: vi.fn(async () => ({ passenger: { id: mockPassengerId } })),
}));

function req(): NextRequest {
  return new NextRequest('http://localhost/api/flights/f1/reverify', { method: 'POST' });
}

function params(id = 'f1') {
  return { params: Promise.resolve({ id }) };
}

describe('POST /api/flights/[id]/reverify — per-member rate limiting', () => {
  beforeEach(() => {
    __resetRateLimitsForTests();
    reverifyMock.mockClear();
  });

  it('allows the first 5 reverify calls for a member, then 429s the 6th with a positive retryAfterMs', async () => {
    mockPassengerId = 'p-a';
    const { POST } = await import('./route');

    for (let i = 0; i < 5; i += 1) {
      const res = await POST(req(), params());
      expect(res.status).toBe(200);
    }

    const sixth = await POST(req(), params());
    expect(sixth.status).toBe(429);
    const body = (await sixth.json()) as { error?: string; retryAfterMs?: number };
    expect(body.error).toBeTruthy();
    expect(body.retryAfterMs).toBeGreaterThan(0);
    // The real reverify() must never have been called for the rejected 6th request.
    expect(reverifyMock).toHaveBeenCalledTimes(5);
  });

  it('a different member has a fully independent bucket — one member exhausting theirs never blocks another', async () => {
    const { POST } = await import('./route');

    mockPassengerId = 'p-b';
    for (let i = 0; i < 5; i += 1) {
      const res = await POST(req(), params());
      expect(res.status).toBe(200);
    }
    const sixthForB = await POST(req(), params());
    expect(sixthForB.status).toBe(429);

    mockPassengerId = 'p-c';
    const firstForC = await POST(req(), params());
    expect(firstForC.status).toBe(200);
  });
});
