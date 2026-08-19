import { NextResponse } from 'next/server';
import { snapshot } from '@/server/governor';
import { refreshRationale } from '@/lib/refreshInterval';
import { altsRefreshPlan } from '@/server/engine/altsCache';
import { pollerStatus } from '@/server/engine/statusPoller';
import { laneStatus } from '@/server/webhooks';
import { subscriptionCount } from '@/server/webhooks/subscriptions';
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
  await ensureSeeded();

  const flights = await store.listFlights();
  const watched = flights.filter((f) => f.altsAsOf !== undefined).length;

  const cadence = await Promise.all(flights.map(async (f) => {
    const plan = await altsRefreshPlan(f);
    const disruption = await store.getDisruptionEvent(f.id);
    return {
      flightId: f.id,
      code: f.code,
      disrupted: disruption !== undefined,
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
  }));

  // ── Which detection lane is actually live ────────────────────────────────
  //
  // The single most important thing this endpoint reports, and the reason it
  // now reports it: a webhook feed that has stopped delivering is
  // indistinguishable from a week with no cancellations. Both look like
  // silence. So the lane state has to be readable rather than inferred, or the
  // first sign of a dead subscription is a stranded member.
  const webhooks = laneStatus();
  const poller = pollerStatus();

  return NextResponse.json({
    watchers: Math.max(1, watched),
    budgets: snapshot(Math.max(1, watched)),
    cadence,
    detection: {
      // 'webhook' | 'poller' | 'manual' — what would actually catch a
      // cancellation right now, in order of what is currently trusted.
      primaryLane: webhooks.primary ? 'webhook' : poller.running && poller.budgetRemaining ? 'poller' : 'manual',
      webhooks: {
        ...webhooks,
        subscriptions: subscriptionCount(),
      },
      poller,
      // Always available, needs no key and no budget, and is the only lane that
      // works when both feeds are wrong. See server/engine/memberReports.ts.
      memberReports: { available: true },
    },
    generatedAt: Date.now(),
  });
}
