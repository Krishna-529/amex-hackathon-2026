/**
 * Process-lifetime in-memory TTL cache. Resets on dev-server restart / cold start —
 * good enough to keep this demo under AviationStack's monthly cap and to cache OAuth
 * tokens (OpenSky, Sabre), not a substitute for a real cache store in production.
 */

type Entry<T> = { value: T; expiresAt: number };

const store = new Map<string, Entry<unknown>>();

export async function getOrSet<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value as T;
  const value = await fn();
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}

/**
 * Evicts a cached entry so the next `getOrSet` re-derives it.
 *
 * Exists for OAuth tokens specifically: a token cached here can be rejected by
 * the vendor before its own TTL expires (revoked, clock skew, a vendor-side
 * rotation) and the caller has no way to say "that one was bad, get me a real
 * one" without this. Additive — nothing else in the codebase calls it yet, and
 * nothing else needs to.
 */
export function invalidate(key: string): void {
  store.delete(key);
}

let aviationstackCalls = 0;
const AVIATIONSTACK_SOFT_CEILING = 60; // stay well under the 100/month free cap

export function noteAviationstackCall() {
  aviationstackCalls += 1;
  if (aviationstackCalls > AVIATIONSTACK_SOFT_CEILING) {
    console.warn(
      `[aviationstack] ${aviationstackCalls} calls this process lifetime — past the soft ceiling of ${AVIATIONSTACK_SOFT_CEILING}. Free tier caps at 100/month; slow down.`,
    );
  }
}
