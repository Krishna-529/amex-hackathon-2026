/**
 * Virtual clock. "Now" is frozen at 2026-08-25T06:12:00+05:30 and advances
 * only when the concierge does simulated work.
 *
 * It always advances by the FULL simulated latency, never the --fast latency,
 * so the timestamps written to the decision ledger are byte-identical whether
 * the demo runs in real time or in fast mode.
 */

import { FROZEN_NOW_MS } from './scenario';

let offsetMs = 0;

export function reset(): void {
  offsetMs = 0;
}

export function advance(ms: number): void {
  offsetMs += ms;
}

export function nowMs(): number {
  return FROZEN_NOW_MS + offsetMs;
}

export function nowIso(): string {
  // Rendered in IST — the Card Member's local time for this trip.
  return toIstIso(nowMs());
}

export function toIstIso(ms: number): string {
  const ist = new Date(ms + 5.5 * 3600 * 1000);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    `${ist.getUTCFullYear()}-${p(ist.getUTCMonth() + 1)}-${p(ist.getUTCDate())}` +
    `T${p(ist.getUTCHours())}:${p(ist.getUTCMinutes())}:${p(ist.getUTCSeconds())}+05:30`
  );
}
