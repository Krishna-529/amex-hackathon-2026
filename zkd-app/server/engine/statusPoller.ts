/**
 * Asking whether the thing we predicted actually happened.
 *
 * ── The hole this fills ────────────────────────────────────────────────────
 *
 * Until now, nothing in this application ever checked. `detectDisruption` was
 * reachable from exactly one place — the ops console's "Trigger disruption"
 * button, whose own comment admits it "stands in for a real production
 * live-feed poller" — and `app/api/flight-status/route.ts`, which does the real
 * AviationStack lookup and classifies it against what the member booked, had no
 * callers at all. `batchScorer.ts` re-ran the *prediction* on three tiers of
 * timer and never once asked whether the flight had died.
 *
 * So the parts were all built and tested; nobody had put a timer behind them.
 * This is that timer.
 *
 * ── The binding constraint is the free tier, not compute ───────────────────
 *
 * AviationStack's free tier allows 100 requests per MONTH and one per minute.
 * That number governs the entire design of this file: a naive poller over a few
 * dozen flights would exhaust a month's allowance in an afternoon and leave the
 * product blind for the remaining twenty-nine days — strictly worse than not
 * polling at all, because the failure would be silent and would arrive exactly
 * when demand was highest.
 *
 * Four things keep it inside the budget:
 *
 *   1. **Only flights that matter.** `rescoreTiming.ts`'s `tierFor()` already
 *      computes exactly the right set — 'critical' means near departure or
 *      already at hold-gate/pre-authorise. Everything else is not polled at
 *      all. Reused rather than re-derived, so the poller and the re-scorer can
 *      never disagree about which flights are urgent.
 *   2. **The day cache does the real work.** `server/aviationstack.ts` caches
 *      per flight per calendar day, so the effective unit of spend is a
 *      *distinct flight-day*, not a tick. Polling one flight every ten minutes
 *      for six hours costs one call.
 *   3. **A hard monthly ceiling**, checked before every call, below the real
 *      one so the allowance is never actually hit.
 *   4. **Degrading loudly.** When the budget is gone the poller stops and says
 *      so on /ops, because "detection is manual right now" is something an
 *      operator must be able to see rather than infer from silence.
 *
 * Even inside all of that, most flights are unwatched most of the time — which
 * is not a defect to apologise for but the reason the other two lanes exist.
 *
 * ── Demoted to a safety net on 2026-08-19 ─────────────────────────────────
 *
 * `server/webhooks/` added a push lane, and push is simply the right shape for
 * this problem: nothing is spent while nothing happens, every subscribed flight
 * is watched rather than the two most urgent, and the signal arrives in seconds
 * instead of up to five minutes. AviationStack cannot compete on that because
 * it structurally cannot — it is a pull API with no webhook support at all, so
 * this poller was never an interim shortcut that could be tuned into something
 * better. It was always that vendor's ceiling.
 *
 * So this is now a FALLBACK, and it behaves like one:
 *
 *   - it skips flights that already have a live webhook subscription, since
 *     paying AviationStack to re-ask a question a provider is already pushing
 *     the answer to is pure waste;
 *   - it drops its own ceiling accordingly, freeing that allowance for the
 *     member-report corroboration ladder, which spends from the same 100;
 *   - and critically, it does NOT stand down merely because webhooks are
 *     configured. It stands down only while they are demonstrably alive
 *     (`laneStatus().primary`), because a webhook that has stopped delivering
 *     looks exactly like a quiet week — and a fallback that trusts a dead
 *     primary is not a fallback.
 */

import { lookupFlightStatus } from '../aviationstack';
import { classify } from '@/lib/disruptionKind';
import { getThresholdConfig } from '@/lib/thresholdConfig';
import { tierFor } from './rescoreTiming';
import { triggerEventRescore } from './forecast';
import { detectDisruption } from './simulation';
import { laneStatus } from '../webhooks';
import { isSubscribed } from '../webhooks/subscriptions';
import * as store from '../domain/store';
import type { Flight } from '../domain/types';

/**
 * Stay well under AviationStack's 100/month. The gap is not timidity: the
 * `/api/flight-status` route and the member-report corroboration ladder draw on
 * the same allowance, and a poller that spent all of it would silently disable
 * both.
 *
 * Lowered from 45 to 15 when webhooks took over as the primary lane. The
 * headroom went to the corroboration ladder, which is now the more valuable
 * consumer: a member reporting a cancellation is a moment where one call
 * genuinely decides something, whereas a scheduled poll usually confirms that
 * nothing has changed.
 */
const MONTHLY_CALL_CEILING = 15;

/** One tick every five minutes. The day cache means this is not the cost driver. */
const POLL_INTERVAL_MS = 5 * 60_000;

/**
 * How many distinct flights one tick may look up.
 *
 * AviationStack also rate-limits to one request per minute, so a tick that
 * fired ten lookups at once would be throttled anyway. Two per tick, five
 * minutes apart, sits comfortably inside that.
 */
const LOOKUPS_PER_TICK = 2;

const g = globalThis as typeof globalThis & {
  __zkdStatusPollerStarted?: boolean;
  __zkdStatusPollerTimer?: NodeJS.Timeout;
  __zkdStatusPollerSpend?: { month: string; calls: number };
};

function monthKey(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 7);
}

function spend(): { month: string; calls: number } {
  const month = monthKey();
  const held = g.__zkdStatusPollerSpend;
  if (!held || held.month !== month) {
    g.__zkdStatusPollerSpend = { month, calls: 0 };
  }
  return g.__zkdStatusPollerSpend!;
}

export type PollerStatus = {
  running: boolean;
  callsThisMonth: number;
  ceiling: number;
  /** false when the allowance is gone — detection has fallen back to manual */
  budgetRemaining: boolean;
  /**
   * 'primary' when this is the main detection lane; 'standby' while a healthy
   * webhook feed is carrying it. Surfaced so an operator can see WHICH lane is
   * live rather than inferring it from an absence of alerts.
   */
  role: 'primary' | 'standby';
};

/** Surfaced on /ops so a blind poller is discovered during setup, not on stage. */
export function pollerStatus(): PollerStatus {
  const s = spend();
  return {
    running: !!g.__zkdStatusPollerStarted,
    callsThisMonth: s.calls,
    ceiling: MONTHLY_CALL_CEILING,
    budgetRemaining: s.calls < MONTHLY_CALL_CEILING,
    role: laneStatus().primary ? 'standby' : 'primary',
  };
}

/**
 * Which flights this tick would look at.
 *
 * Exported for the same reason `batchScorer.flightsInTier` is: the selection
 * rule is the interesting part and it should be testable without a timer, a
 * network or a database.
 */
export function flightsToPoll(flights: Flight[], now = Date.now()): Flight[] {
  const cfg = getThresholdConfig();
  // Only stand down from a webhook feed that is actually alive. `primary` is
  // false the moment deliveries go stale, which is precisely when this lane
  // needs to pick the work back up.
  const webhooksHealthy = laneStatus(now).primary;

  return flights
    .filter((f) => {
      // A flight that has already departed cannot be cancelled, and one already
      // known to be disrupted needs no further confirming.
      const departsAt = new Date(f.depISO).getTime();
      if (departsAt < now - 60 * 60_000) return false;
      // Already covered by push. Paying for a pull to re-ask the same question
      // is the clearest waste available in this budget.
      if (webhooksHealthy && isSubscribed(f.id)) return false;
      return tierFor(f, cfg, now) === 'critical';
    })
    // Soonest departure first: the flight with the least runway left to act on
    // is the one worth spending the call on.
    .sort((a, b) => new Date(a.depISO).getTime() - new Date(b.depISO).getTime());
}

async function tick(): Promise<void> {
  const s = spend();
  if (s.calls >= MONTHLY_CALL_CEILING) return;

  const flights = flightsToPoll(await store.listFlights());
  if (flights.length === 0) return;

  for (const flight of flights.slice(0, LOOKUPS_PER_TICK)) {
    if (s.calls >= MONTHLY_CALL_CEILING) return;

    // Already disrupted: nothing left for a status check to tell us, and the
    // call is too scarce to spend confirming what we are already acting on.
    if (await store.getDisruptionEvent(flight.id)) continue;

    s.calls += 1;
    const match = await lookupFlightStatus(flight.code.replace(/\s+/g, '')).catch(() => null);
    if (!match) continue;

    const classification = classify({
      status: match.flightStatus,
      bookedDepartureAt: new Date(flight.depISO).getTime(),
      scheduledDepartureAt: match.depScheduledAt,
      delayMinutes: match.depDelayMin,
      connectionSlackMinutes: flight.connectionSlackMinutes,
    });

    if (classification.kind === 'none') continue;

    // Any disruption-shaped signal is worth a fresh score, debounced per flight
    // inside forecast.ts — the same path /api/flight-status already uses.
    triggerEventRescore(flight.id);

    // A cancellation is the one that starts a recovery. A reschedule or a
    // delay-cascade changes the forecast and may well escalate the band into an
    // alert, but it is not by itself a cancelled flight, and treating it as one
    // would start spending on a flight that is still going to operate.
    if (classification.kind === 'cancellation') {
      console.log(`[statusPoller] ${flight.code} reported cancelled by the carrier feed — starting recovery`);
      await detectDisruption(flight.id).catch((e) => {
        console.error(`[statusPoller] detectDisruption failed for ${flight.id}:`, e);
      });
    }
  }
}

/**
 * Idempotent, matching `startBatchScorer` — Next's dev-mode HMR re-invokes
 * `instrumentation.ts`'s register(), and a second poller would double the spend
 * against an allowance that has no room for it.
 */
export function startStatusPoller(): void {
  if (g.__zkdStatusPollerStarted) return;
  g.__zkdStatusPollerStarted = true;

  if (!process.env.AVIATIONSTACK_API_KEY) {
    console.warn(
      '[statusPoller] AVIATIONSTACK_API_KEY is not set — automatic cancellation detection is OFF. ' +
        'Disruptions must come from the ops console or from a member report.',
    );
    return;
  }

  const schedule = () => {
    g.__zkdStatusPollerTimer = setTimeout(async () => {
      try {
        await tick();
      } catch (e) {
        console.error('[statusPoller] tick failed:', e);
      } finally {
        schedule();
      }
    }, POLL_INTERVAL_MS);
  };
  schedule();
  console.log(
    `[statusPoller] watching near-departure and high-risk flights, ceiling ${MONTHLY_CALL_CEILING} calls/month`,
  );
}
