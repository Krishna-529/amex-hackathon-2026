/**
 * The one place this app talks to a network. Mirrors zkd-app's
 * server/disruptionState.ts contract exactly (same JSON shape) so the phone
 * and the web app agree on the same canonical clock for a flight's 90-second
 * consent window. See zkd-app/app/api/disruption/route.ts for the server side.
 */
import { API_BASE_URL } from './config';

export type DisruptionResolution =
  | { kind: 'autopilot' | 'approved'; at: number; altId: string; hotelId: string; cabId: string }
  | { kind: 'handed-over'; at: number };

export type DisruptionState = {
  detectedAt: number;
  resolution: DisruptionResolution | null;
};

export async function getDisruptionState(flightId: string): Promise<DisruptionState | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/disruption?flightId=${encodeURIComponent(flightId)}`);
    if (!res.ok) return null;
    return (await res.json()) as DisruptionState;
  } catch {
    return null;
  }
}

export async function resolveDisruption(
  flightId: string,
  resolution: DisruptionResolution,
): Promise<DisruptionState | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/disruption`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ flightId, resolution }),
    });
    if (!res.ok) return null;
    return (await res.json()) as DisruptionState;
  } catch {
    return null;
  }
}
