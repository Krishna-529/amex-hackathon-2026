import { NextRequest, NextResponse } from 'next/server';
import * as store from '@/server/domain/store';
import { requireSession } from '@/server/auth/guard';
import { validateJourneyWindow } from '@/server/preferences/journeyPrefs';
import type { JourneyPrefsRequest, JourneyPrefsResponse } from '@/lib/apiTypes';
import { parseJsonBody } from '@/server/jsonBody';
import type { Consent, JourneyPrefs } from '@/server/domain/types';

/**
 * Capture — and read back — a member's temporary, per-flight journey window and
 * consent choice, set before the flight is ever disrupted. Mirrors the
 * pre-authorisation route (same session guard, same per flight+passenger
 * keying) because it is the same kind of advance instruction; the difference is
 * only what it carries.
 */

function isJourneyBody(v: unknown): v is JourneyPrefsRequest {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  const okStr = (x: unknown) => x === undefined || x === null || typeof x === 'string';
  const okConsent = (x: unknown) => x === undefined || x === null || x === 'autopilot' || x === 'ask';
  return okStr(o.earliestDepartISO) && okStr(o.latestArriveISO) && okConsent(o.consent);
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireSession(req);
  if ('response' in g) return g.response;
  const { id } = await params;
  const rec = await store.getJourneyPrefs(id, g.passenger.id);
  const body: JourneyPrefsResponse = rec ? { ...rec, notes: [] } : null;
  return NextResponse.json(body);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireSession(req);
  if ('response' in g) return g.response;

  const { id } = await params;
  const parsed = await parseJsonBody(req, isJourneyBody);
  if ('response' in parsed) return parsed.response;
  const body = parsed.body;

  const flight = await store.getFlight(id);
  if (!flight) return NextResponse.json({ error: 'not found' }, { status: 404 });

  // The window is validated the same way an LLM-parsed deadline is: an
  // unreadable or contradictory value is dropped with a member-facing note,
  // never coerced into something that would silently narrow their options.
  const win = validateJourneyWindow({
    earliestDepartISO: body.earliestDepartISO,
    latestArriveISO: body.latestArriveISO,
  });

  const consent: Consent | null = body.consent ?? null;

  const rec: JourneyPrefs = {
    flightId: id,
    passengerId: g.passenger.id,
    earliestDepartISO: win.earliestDepartISO,
    latestArriveISO: win.latestArriveISO,
    consent,
    setAt: Date.now(),
  };
  await store.setJourneyPrefs(rec);

  const res: JourneyPrefsResponse = { ...rec, notes: win.notes };
  return NextResponse.json(res);
}
