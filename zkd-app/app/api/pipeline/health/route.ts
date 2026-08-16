import { NextResponse } from 'next/server';
import { snapshot } from '@/server/governor';
import { refreshIntervalFor, refreshRationale } from '@/lib/refreshInterval';
import { sustainableIntervalMs } from '@/server/governor';
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
 * This endpoint exists because the two components it reports on are otherwise
 * invisible until they bite. "Why is this seat count four minutes old" is
 * answered by the rate limiter far more often than by anything else, and an ops
 * view that cannot show that is guessing. It is also the fastest way to see a
 * free tier draining before demo day rather than after.
 */

export const dynamic = 'force-dynamic';

export async function GET() {
  ensureSeeded();

  const flights = store.listFlights();
  // Every flight being kept warm divides the same provider allowance. Sizing
  // the cadence against one watcher when there are five is how a free tier
  // quietly runs out.
  const watchers = Math.max(1, flights.length);

  const cadence = flights.map((f) => {
    const disrupted = store.getDisruptionEvent(f.id) !== undefined;
    // Alts, not Offers, so this is a plain sum rather than seatsAcross(). Only
    // bookable ones count — a seat we are not allowed to sell is not inventory.
    const seats = f.candidates.alts
      .filter((a) => a.ok)
      .reduce((n, a) => n + a.seats, 0);

    // Whichever registered flight source is slowest to sustain sets the floor —
    // a portfolio is only as fresh as its laggard.
    const floor = Math.max(
      sustainableIntervalMs('duffel', watchers, 1),
      sustainableIntervalMs('kiwi', watchers, 1),
      sustainableIntervalMs('skyscanner', watchers, 1),
    );

    const soonestExpiry = f.candidates.alts
      .map((a) => a.expiresAt)
      .filter((e): e is number => e !== null && e > Date.now())
      .sort((a, b) => a - b)[0];

    const plan = refreshIntervalFor({
      minutesToDeparture: Math.max(0, (new Date(f.depISO).getTime() - Date.now()) / 60_000),
      severity: disrupted ? 'disrupted' : (f.forecast?.band ?? 'watch'),
      seatsAvailable: seats,
      watchers,
      rateLimitFloorMs: floor,
      offerExpiresInMs: soonestExpiry ? soonestExpiry - Date.now() : null,
      // A real open window lives on a RecoveryTask; treat any unresolved task
      // in `waiting` as a member currently looking at this plan.
      hasOpenConsentWindow: store
        .getRecoveryTasksForFlight(f.id)
        .some((t) => !t.resolution && t.phase === 'waiting'),
    });

    return {
      flightId: f.id,
      code: f.code,
      disrupted,
      altsAsOf: f.altsAsOf ?? null,
      ageMs: f.altsAsOf ? Date.now() - f.altsAsOf : null,
      intervalMs: plan.ms,
      targetMs: plan.targetMs,
      boundBy: plan.boundBy,
      factors: plan.factors,
      why: refreshRationale(plan),
    };
  });

  return NextResponse.json({
    watchers,
    budgets: snapshot(watchers),
    cadence,
    generatedAt: Date.now(),
  });
}
