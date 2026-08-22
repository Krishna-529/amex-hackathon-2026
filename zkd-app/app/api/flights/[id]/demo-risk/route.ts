import { NextRequest, NextResponse } from 'next/server';
import * as store from '@/server/domain/store';
import { requireOperator } from '@/server/auth/guard';
import { thresholdsFor } from '@/server/engine/thresholds';
import { bandFor, BAND_TONE } from '@/lib/thresholds';
import { refreshAltsNow } from '@/server/engine/altsCache';
import { isSameOriginRequest } from '@/server/auth/csrf';
import { checkRateLimit } from '@/server/rateLimit';
import type { FlightForecast } from '@/server/domain/types';

/**
 * DEMO ONLY — force a flight's forecast to a high band on cue.
 *
 * This is NOT the model's own prediction: it is a walkthrough control so a
 * presenter can show the risk score crossing the threshold and the system
 * reacting, without waiting on the real scorer or faking a number inside it.
 * `modelVersion: 'demo-override'` marks every forecast it writes so it can never
 * be mistaken for a real score. The /ops "Ramp risk" button calls this; the
 * "Reset demo" button clears it.
 *
 * `requireOperator`, not `requireSession` — fixed 2026-08-21. This is a
 * presenter control with no per-member concept of ownership (it overrides a
 * FLIGHT's forecast, not a member's own view of one), so the fix is an
 * operator check, not a booking-ownership check. Previously any signed-in
 * member could rewrite any flight's forecast and force a real (budget-
 * consuming) alt-search refresh on it.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireOperator(req);
  if ('response' in g) return g.response;
  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ error: 'cross-site request rejected' }, { status: 403 });
  }
  const limited = checkRateLimit(req, 'ops-demo-risk', { capacity: 30, refillPerMinute: 30 });
  if (!limited.allowed) {
    return NextResponse.json({ error: 'too many requests, try again shortly' }, { status: 429 });
  }

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { riskScore?: unknown };
  const riskScore = Math.min(100, Math.max(0, Math.round(typeof body.riskScore === 'number' ? body.riskScore : 82)));

  const flight = await store.getFlight(id);
  if (!flight) return NextResponse.json({ error: 'flight not found' }, { status: 404 });

  const departsAt = new Date(flight.depISO).getTime();
  const thresholds = thresholdsFor({
    seatsAvailable: flight.candidates.alts.filter((a) => a.ok).reduce((n, a) => n + a.seats, 0) || 12,
    partySize: 1,
    minutesToDeparture: Math.max(0, Math.round((departsAt - Date.now()) / 60_000)),
    hasHardConstraint: flight.hasHardConstraint,
    confidence: 0.8,
  });
  const pct = 8; // representative cancel probability for the high-risk band
  const band = bandFor(pct, thresholds);

  const forecast: FlightForecast = {
    pct,
    band,
    tone: BAND_TONE[band],
    connectionRisk: null,
    confidence: 0.8,
    source: 'internal-ml',
    modelVersion: 'demo-override',
    riskScore,
    thresholds,
    asOf: Date.now(),
  };
  flight.forecast = forecast;
  await store.createFlight(flight);

  // Fire the same prefetch a real threshold crossing triggers: search and cache
  // alternatives now that this flight is (demo-)high-risk. This is why "Ramp
  // risk" makes the alternatives appear — they are gated on the crossing, never
  // shown before it.
  await refreshAltsNow(id, 'demo threshold crossed').catch(() => {});

  return NextResponse.json({ forecast });
}
