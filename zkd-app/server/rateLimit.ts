/**
 * In-process token-bucket rate limiter. There was no rate limiting anywhere
 * in the app — login and any POST that drives a real pipeline action
 * (disruption trigger, saga-starting request) were open to unlimited
 * brute-force / cost-abuse traffic. This is deliberately simple (no Redis,
 * no external dependency) because it matches this app's existing pattern of
 * in-memory Maps for narrowly-scoped, process-local concerns (see
 * server/engine/forecast.ts's in-flight dedup) — a real multi-instance
 * deployment would move this to a shared store, but a single shared bucket
 * per instance is still a real defense, not a placeholder.
 *
 * Ported 2026-08-21 from `feature/adaptive-forecast-and-bedrock-refinement`
 * (verified byte-for-byte against the source, unmodified) — the full-
 * codebase security audit found this branch had NO rate limiting anywhere,
 * while a real, tested implementation already existed unmerged on a
 * sibling branch. Porting the proven code, not writing a second version.
 * The single-instance limitation this module's own comment names is real
 * and already tracked in context.md's scale-readiness findings — not new,
 * not hidden by porting it.
 */
import type { NextRequest } from 'next/server';

type Bucket = { tokens: number; lastRefillMs: number };

const buckets = new Map<string, Bucket>();

export type RateLimitOptions = {
  /** Max tokens the bucket can hold (i.e. max burst). */
  capacity: number;
  /** Tokens restored per minute. */
  refillPerMinute: number;
};

export type RateLimitResult = { allowed: true } | { allowed: false; retryAfterMs: number };

function clientKey(req: NextRequest): string {
  // x-forwarded-for is set by any real reverse proxy/ALB in front of this
  // app; falls back to a shared bucket in local dev where it's absent —
  // still a real defense against a single runaway client/script.
  const fwd = req.headers.get('x-forwarded-for');
  return fwd?.split(',')[0]?.trim() || 'unknown';
}

/** Pure function over an explicit key, so it's testable without a real NextRequest. */
export function consumeToken(key: string, opts: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  const refillMs = 60_000 / opts.refillPerMinute;
  const existing = buckets.get(key);

  if (!existing) {
    buckets.set(key, { tokens: opts.capacity - 1, lastRefillMs: now });
    return { allowed: true };
  }

  const elapsedMs = now - existing.lastRefillMs;
  const refilled = Math.floor(elapsedMs / refillMs);
  if (refilled > 0) {
    existing.tokens = Math.min(opts.capacity, existing.tokens + refilled);
    existing.lastRefillMs = existing.lastRefillMs + refilled * refillMs;
  }

  if (existing.tokens < 1) {
    const retryAfterMs = refillMs - (now - existing.lastRefillMs);
    return { allowed: false, retryAfterMs: Math.max(0, Math.ceil(retryAfterMs)) };
  }

  existing.tokens -= 1;
  return { allowed: true };
}

export function checkRateLimit(req: NextRequest, routeName: string, opts: RateLimitOptions): RateLimitResult {
  return consumeToken(`${routeName}:${clientKey(req)}`, opts);
}

/** Test-only: clears all buckets so tests don't leak state across cases. */
export function __resetRateLimitsForTests(): void {
  buckets.clear();
}
