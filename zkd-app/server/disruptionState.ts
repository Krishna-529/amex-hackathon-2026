/**
 * The one piece of real, shared server state in this app. Everything else here
 * is either per-client mock data or a stateless proxy to a supplier API — this
 * is the actual "what really happened, and when" record for a disruption, so
 * the 90-second consent window and its outcome are the same for every viewer
 * (laptop, phone browser, a second tab) regardless of when each one loads the
 * page, instead of each client running its own independent 90s timer from the
 * moment IT happened to open the recovery screen.
 *
 * Process-lifetime in-memory store — resets on dev-server restart, same
 * tradeoff as lib/server/cache.ts. Good enough for a demo; a real deployment
 * would back this with a shared store (Redis/KV) so it survives restarts and
 * works across multiple server instances.
 */

export type DisruptionResolution =
  | { kind: 'autopilot' | 'approved'; at: number; altId: string; hotelId: string; cabId: string }
  | { kind: 'handed-over'; at: number };

export type DisruptionState = {
  detectedAt: number;
  resolution: DisruptionResolution | null;
};

const store = new Map<string, DisruptionState>();

/** First caller for a given flight claims `detectedAt = now`; everyone after gets that same value. */
export function getState(flightId: string): DisruptionState {
  let s = store.get(flightId);
  if (!s) {
    s = { detectedAt: Date.now(), resolution: null };
    store.set(flightId, s);
  }
  return s;
}

/** First resolution for a flight wins — later callers get back the one that already happened, not their own. */
export function resolve(flightId: string, resolution: DisruptionResolution): DisruptionState {
  const s = getState(flightId);
  if (!s.resolution) s.resolution = resolution;
  return s;
}
