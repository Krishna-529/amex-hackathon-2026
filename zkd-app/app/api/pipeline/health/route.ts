import { NextResponse } from 'next/server';
import { snapshot } from '@/server/governor';
import { refreshRationale } from '@/lib/refreshInterval';
import { altsRefreshPlan } from '@/server/engine/altsCache';
import * as store from '@/server/domain/store';
import { ensureSeeded } from '@/server/domain/seed';

/**
 * Outbound-budget and refresh-cadence visibility.
 *
 * Unguarded, matching the other endpoints /ops already polls — and safe to be
 * so because it returns **provider counters only**. No passenger, no booking,
 * no itinerary, no money. The one member-adjacent thing here is a flight id and
 * how often we re-check it, which is already public on /api/flights.
 *
 * This exists because the two components it reports on are otherwise invisible
 * until they bite. "Why is this seat count four minutes old" is answered by the
 * rate limiter far more often than by anything else, and an ops view that
 * cannot show that is guessing. It is also the fastest way to notice a free
 * tier draining before demo day rather than after.
 *
 * The cadence numbers come from `altsRefreshPlan` — the same function the cache
 * actually schedules against, not a reimplementation of it. A health endpoint
 * that computes its own answer is a health endpoint that can disagree with the
 * system it reports on.
 */

export const dynamic = 'force-dynamic';

export async function GET() {
  ensureSeeded();

  const flights = store.listFlights();
  const watched = flights.filter((f) => f.altsAsOf !== undefined).length;

  const cadence = flights.map((f) => {
    const plan = altsRefreshPlan(f);
    return {
      flightId: f.id,
      code: f.code,
      disrupted: store.getDisruptionEvent(f.id) !== undefined,
      altsAsOf: f.altsAsOf ?? null,
      ageMs: f.altsAsOf ? Date.now() - f.altsAsOf : null,
      /** true when the cached candidates are past their own computed interval */
      stale: f.altsAsOf ? Date.now() - f.altsAsOf > plan.ms : true,
      altsHeld: f.candidates.alts.length,
      altsBookable: f.candidates.alts.filter((a) => a.ok).length,
      intervalMs: plan.ms,
      targetMs: plan.targetMs,
      boundBy: plan.boundBy,
      factors: plan.factors,
      why: refreshRationale(plan),
    };
  });

  return NextResponse.json({
    watchers: Math.max(1, watched),
    budgets: snapshot(Math.max(1, watched)),
    cadence,
    generatedAt: Date.now(),
  });
}
