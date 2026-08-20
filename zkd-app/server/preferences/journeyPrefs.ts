/**
 * Pure logic for the member's temporary, per-flight journey window and consent
 * choice. Kept dependency-free (no store, no request) so it can be exercised
 * directly and so both the capture route and the recovery engine resolve these
 * values through exactly one implementation.
 *
 * Two questions live here:
 *
 *  1. `resolveConsent` — which consent actually governs THIS flight. A member
 *     has a standing profile consent (autopilot or ask); they may also set a
 *     per-flight override before the flight. The override wins when present, and
 *     `null` means "no override, use my standing choice". This is the whole
 *     human-in-the-loop-vs-autonomous decision, reduced to one function so the
 *     engine never has to know where the answer came from.
 *
 *  2. `validateJourneyWindow` — turning two member-supplied instants into a
 *     defensible window. The same discipline server/preferences/intent.ts
 *     applies to an LLM-parsed deadline applies here to a member-typed one:
 *     an unparseable value is dropped with a stated reason rather than silently
 *     coerced, and a contradictory window (arrive-by before depart-after) is
 *     refused rather than used to remove every option.
 */

import type { Consent } from '../domain/types';

/** The consent that governs one flight: the per-flight override if the member
 *  set one, otherwise their standing profile consent. */
export function resolveConsent(profileConsent: Consent, override: Consent | null | undefined): Consent {
  return override ?? profileConsent;
}

export type JourneyWindowInput = {
  earliestDepartISO?: string | null;
  latestArriveISO?: string | null;
};

export type ValidatedJourneyWindow = {
  earliestDepartISO: string | null;
  latestArriveISO: string | null;
  /** member-facing notes for anything we dropped or could not read */
  notes: string[];
};

/**
 * Validate and normalise the two window bounds. Never throws — a bad value
 * becomes `null` plus a note, so a mistyped date narrows nothing rather than
 * emptying the member's whole option list.
 */
export function validateJourneyWindow(input: JourneyWindowInput): ValidatedJourneyWindow {
  const notes: string[] = [];

  const earliest = parseInstant(input.earliestDepartISO);
  const latest = parseInstant(input.latestArriveISO);

  let earliestDepartISO: string | null = null;
  let latestArriveISO: string | null = null;

  // A note is owed only when the member actually typed something we could not
  // read — an empty or absent value is simply "not stated", not an error.
  if (isStated(input.earliestDepartISO) && earliest === null) {
    notes.push('We could not read your earliest departure time, so we left it open.');
  } else if (earliest !== null) {
    earliestDepartISO = new Date(earliest).toISOString();
  }

  if (isStated(input.latestArriveISO) && latest === null) {
    notes.push('We could not read your arrive-by time, so we left it open.');
  } else if (latest !== null) {
    latestArriveISO = new Date(latest).toISOString();
  }

  // A window that ends before it starts is contradictory — keep the start
  // (a real "not before" constraint) and drop the impossible end, rather than
  // filtering every option out.
  if (earliestDepartISO !== null && latestArriveISO !== null && latest! <= earliest!) {
    notes.push('Your arrive-by time was before your earliest departure, so we ignored the arrive-by time.');
    latestArriveISO = null;
  }

  return { earliestDepartISO, latestArriveISO, notes };
}

/** A value the member actually typed — a non-empty string. */
function isStated(v: string | null | undefined): v is string {
  return typeof v === 'string' && v.trim() !== '';
}

function parseInstant(v: string | null | undefined): number | null {
  if (!isStated(v)) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}
