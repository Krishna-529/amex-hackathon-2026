/**
 * The one piece of real, shared server state in this app. Everything else here
 * is either per-client mock data or a stateless proxy to a supplier API — this
 * is the actual "what really happened, and when" record for a disruption, so the
 * consent window and its outcome are the same for every viewer (laptop, phone
 * browser, a second tab) regardless of when each one loads the page, instead of
 * each client running its own independent timer from the moment IT happened to
 * open the recovery screen.
 *
 * The window length itself is no longer a constant — it is derived per
 * disruption from the supplier's offer expiry (lib/confirmWindow.ts) and stored
 * here, so every viewer counts down the same clock to the same instant.
 *
 * Process-lifetime in-memory store — resets on dev-server restart, same tradeoff
 * as server/cache.ts. Good enough for a demo; a real deployment would back this
 * with a shared store (Redis/KV) so it survives restarts and works across
 * multiple server instances.
 */

import type { DisruptionKind } from '@/lib/disruptionKind';

export type DisruptionResolution =
  /** a replacement was booked — by standing permission, or because the member said yes */
  | { kind: 'autopilot' | 'approved'; at: number; altId: string; hotelId: string; cabId: string }
  /** the flight moved but still works: no new ticket, only downstream bookings re-timed */
  | { kind: 're-timed'; at: number; hotelId: string; cabId: string; shiftMinutes: number }
  /** nothing needed doing */
  | { kind: 'no-action'; at: number }
  | { kind: 'handed-over'; at: number };

export type DisruptionState = {
  detectedAt: number;
  kind: DisruptionKind;
  /** epoch ms the member's window closes; null when there was no window to give */
  windowExpiresAt: number | null;
  resolution: DisruptionResolution | null;
};

const store = new Map<string, DisruptionState>();

/** First caller for a given flight claims `detectedAt = now`; everyone after gets that same value. */
export function getState(flightId: string): DisruptionState {
  let s = store.get(flightId);
  if (!s) {
    s = { detectedAt: Date.now(), kind: 'cancellation', windowExpiresAt: null, resolution: null };
    store.set(flightId, s);
  }
  return s;
}

/**
 * Records what kind of disruption this is and when the member's window closes.
 * First writer wins, for the same reason `detectedAt` does — a second viewer
 * must not restart anyone's clock.
 */
export function classifyState(
  flightId: string,
  kind: DisruptionKind,
  windowExpiresAt: number | null,
): DisruptionState {
  const s = getState(flightId);
  if (s.windowExpiresAt === null) {
    s.kind = kind;
    s.windowExpiresAt = windowExpiresAt;
  }
  return s;
}

/** First resolution for a flight wins — later callers get back the one that already happened, not their own. */
export function resolve(flightId: string, resolution: DisruptionResolution): DisruptionState {
  const s = getState(flightId);
  if (!s.resolution) s.resolution = resolution;
  return s;
}
