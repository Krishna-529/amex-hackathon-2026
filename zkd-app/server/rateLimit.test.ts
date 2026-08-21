import { describe, expect, it, beforeEach, vi } from 'vitest';
import { consumeToken, __resetRateLimitsForTests } from './rateLimit';

describe('consumeToken (token-bucket rate limiter)', () => {
  beforeEach(() => {
    __resetRateLimitsForTests();
    vi.useRealTimers();
  });

  it('allows up to capacity requests, then rejects', () => {
    const key = 'test-a';
    const opts = { capacity: 3, refillPerMinute: 60 };
    expect(consumeToken(key, opts)).toEqual({ allowed: true });
    expect(consumeToken(key, opts)).toEqual({ allowed: true });
    expect(consumeToken(key, opts)).toEqual({ allowed: true });
    const fourth = consumeToken(key, opts);
    expect(fourth.allowed).toBe(false);
    if (!fourth.allowed) expect(fourth.retryAfterMs).toBeGreaterThan(0);
  });

  it('refills over time', () => {
    vi.useFakeTimers();
    const key = 'test-b';
    // 60/min = 1 token per second.
    const opts = { capacity: 1, refillPerMinute: 60 };
    expect(consumeToken(key, opts)).toEqual({ allowed: true });
    expect(consumeToken(key, opts).allowed).toBe(false);
    vi.advanceTimersByTime(1_000);
    expect(consumeToken(key, opts)).toEqual({ allowed: true });
  });

  it('tracks independent keys separately', () => {
    const opts = { capacity: 1, refillPerMinute: 60 };
    expect(consumeToken('key-1', opts)).toEqual({ allowed: true });
    expect(consumeToken('key-2', opts)).toEqual({ allowed: true });
    expect(consumeToken('key-1', opts).allowed).toBe(false);
  });

  it('never exceeds capacity when refilling', () => {
    vi.useFakeTimers();
    const key = 'test-c';
    const opts = { capacity: 2, refillPerMinute: 60 };
    consumeToken(key, opts);
    consumeToken(key, opts);
    vi.advanceTimersByTime(60_000); // way more than enough to refill fully
    expect(consumeToken(key, opts)).toEqual({ allowed: true });
    expect(consumeToken(key, opts)).toEqual({ allowed: true });
    expect(consumeToken(key, opts).allowed).toBe(false);
  });
});
