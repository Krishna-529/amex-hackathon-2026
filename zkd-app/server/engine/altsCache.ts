/**
 * Keeps each flight's alternative-flight candidates fresh from real supplier
 * inventory, the same way server/engine/forecast.ts keeps the disruption
 * forecast fresh — same in-flight-request pattern, same "read paths kick a
 * non-blocking refresh" contract.
 *
 * Before this, `Flight.candidates.alts` was a hardcoded literal written once in
 * server/domain/seed.ts. Every member saw the same three seeded rows no matter
 * what the suppliers actually had. That was replaced with a live search on a
 * flat ten-minute TTL; this replaces the flat TTL with a computed one.
 *
 * ── Why the interval is computed ───────────────────────────────────────────
 *
 * Ten minutes cannot be right twice. It is wasteful two days before departure
 * and negligent eleven minutes before it, when a cancelled widebody is emptying
 * every alternative on the route. lib/refreshInterval.ts derives the interval
 * from time-to-departure, disruption severity, seat scarcity and whether a
 * member is currently staring at a countdown — then server/governor.ts floors
 * it at whatever the provider's free tier can actually sustain.
 *
 * The floor is the important half. An adaptive interval with nothing underneath
 * it is just a faster way to exhaust a key.
 *
 * ── Why the merge is not a replace (this was a live bug) ───────────────────
 *
 * `compute()` used to do `flight.candidates.alts = [protectedAlt, ...market]` —
 * a wholesale replace. Any unresolved RecoveryTask holds `chosenAltId` pointing
 * into the *old* array, so after a refresh:
 *
 *   - `costFor()` (server/domain/pricing.ts) finds no matching alt, returns
 *     fare 0, `owedNow` silently drops to zero and the spend cap passes on a
 *     recovery that actually costs money;
 *   - app/recovery/[id]/page.tsx gates its plan panel on
 *     `phase==='waiting' && alt && hotel && cab`, so the member watches the
 *     countdown keep running above an empty box with no buttons.
 *
 * The flat ten-minute TTL made that rare enough to go unnoticed. An adaptive
 * interval that can fire every twenty seconds during a disruption would have
 * made it routine — which is why the fix ships in the same commit as the
 * interval, not after it.
 *
 * So: anything an unresolved task still references is **pinned**. If it has
 * genuinely vanished from live inventory it is kept and marked `ok: false` with
 * a reason, so the member sees an option become unavailable rather than seeing
 * their plan evaporate.
 */
import { searchInventory } from '../suppliers';
import { fetchProfile } from '../myca';
import { offersToAlts } from '../domain/altsFromOffers';
import { maxPartyOnFlight } from './forecast';
import { refreshIntervalFor, type RefreshInterval } from '@/lib/refreshInterval';
import { sustainableIntervalMs, type Lane } from '../governor';
import * as store from '../domain/store';
import type { Alt, Flight } from '../domain/types';

const inFlight = new Map<string, Promise<void>>();

/**
 * How many flights are competing for the same provider allowance right now.
 *
 * Counted rather than assumed: sizing the cadence for one watcher while five
 * are polling is how a daily quota disappears by lunchtime. Only flights that
 * have actually been looked at (`altsAsOf` set) count — a seeded flight nobody
 * has opened is not consuming anything.
 */
async function watcherCount(): Promise<number> {
  const flights = await store.listFlights();
  const seen = flights.filter((f) => f.altsAsOf !== undefined).length;
  return Math.max(1, seen);
}

/**
 * The cadence for this flight, with its own inputs and factors attached so the
 * decision can be replayed. Exposed because /api/pipeline/health renders it —
 * "why is this seat count four minutes old" has to be answerable after the
 * fact, the same standard lib/thresholds.ts holds itself to.
 */
export async function altsRefreshPlan(flight: Flight): Promise<RefreshInterval> {
  const watchers = await watcherCount();

  // The fastest sustainable source sets the pace, not the slowest. Taking the
  // max would let Skyscanner's small daily budget throttle Duffel's large one —
  // for a source that is live:false and can never win a booking anyway. Each
  // supplier independently declines a tick it cannot afford (withBudget returns
  // `rate-limited`), so a fast cadence costs nothing on the sources that are
  // out of budget.
  const rateLimitFloorMs = Math.min(
    sustainableIntervalMs('duffel', watchers, 1),
    sustainableIntervalMs('kiwi', watchers, 1),
    sustainableIntervalMs('skyscanner', watchers, 1),
  );

  const disrupted = (await store.getDisruptionEvent(flight.id)) !== undefined;

  // Only bookable alts count as inventory. A seat we are not allowed to sell is
  // not one the member can be moved into, and counting it would make the
  // scarcity factor read a thin route as a comfortable one.
  const seatsAvailable = flight.candidates.alts
    .filter((a) => a.ok)
    .reduce((n, a) => n + a.seats, 0);

  const soonestExpiry = flight.candidates.alts
    .map((a) => a.expiresAt)
    .filter((e): e is number => e !== null && e > Date.now())
    .sort((a, b) => a - b)[0];

  const recoveryTasks = await store.getRecoveryTasksForFlight(flight.id);

  return refreshIntervalFor({
    minutesToDeparture: Math.max(0, (new Date(flight.depISO).getTime() - Date.now()) / 60_000),
    severity: disrupted ? 'disrupted' : (flight.forecast?.band ?? 'watch'),
    seatsAvailable,
    watchers,
    rateLimitFloorMs,
    offerExpiresInMs: soonestExpiry ? soonestExpiry - Date.now() : null,
    hasOpenConsentWindow: recoveryTasks.some((t) => !t.resolution && t.phase === 'waiting'),
  });
}

export async function isAltsStale(flight: Flight): Promise<boolean> {
  if (!flight.altsAsOf) return true;
  const plan = await altsRefreshPlan(flight);
  return Date.now() - flight.altsAsOf > plan.ms;
}

/**
 * Fetches and caches. Concurrent callers for the same flight share one request —
 * five devices polling the same flight must not become five supplier searches.
 */
export function refreshAlts(flightId: string, lane: Lane = 'refresh'): Promise<void> {
  const existing = inFlight.get(flightId);
  if (existing) return existing;

  const p = compute(flightId, lane).finally(() => inFlight.delete(flightId));
  inFlight.set(flightId, p);
  return p;
}

/**
 * Marks the cache stale without fetching. Used when we know the world moved but
 * do not want to pay for a search on this code path — the next read triggers it.
 */
export async function invalidateAlts(flightId: string, reason: string): Promise<void> {
  const flight = await store.getFlight(flightId);
  if (!flight) return;
  flight.altsAsOf = undefined;
  await store.createFlight(flight);
  if (process.env.NODE_ENV !== 'production') {
    console.info(`[altsCache] invalidated ${flightId}: ${reason}`);
  }
}

/**
 * Force a refresh on the confirm lane, bypassing both the interval and the
 * refresh-lane reserve.
 *
 * For the moments where staleness is not acceptable at any price: a carrier has
 * filed, a revalidation came back `gone`, or a member just granted pre-auth and
 * `isPlanIntact` is about to be evaluated against whatever we hold. Those are
 * the calls the reserve exists to protect.
 */
export async function refreshAltsNow(flightId: string, reason: string): Promise<void> {
  await invalidateAlts(flightId, reason);
  // Drop any in-flight refresh-lane search so this one is not deduped into it —
  // that search may already have been declined for budget.
  inFlight.delete(flightId);
  return refreshAlts(flightId, 'confirm');
}

async function compute(flightId: string, lane: Lane): Promise<void> {
  const flight = await store.getFlight(flightId);
  if (!flight) return;

  const date = flight.depISO.slice(0, 10);
  const partySize = await maxPartyOnFlight(flightId);

  const [{ offers }, profile] = await Promise.all([
    searchInventory({
      origin: flight.from,
      destination: flight.to,
      departureDate: date,
      // Search for the largest party on this flight. Pricing and availability
      // for one seat tell us nothing about whether six can travel together.
      passengers: partySize,
      lane,
    }),
    fetchProfile('demo'),
  ]);

  // Every row is now real supplier inventory. The synthesised
  // "the airline owes you this seat" option that used to be prepended here was
  // removed on 2026-08-19 — see server/domain/types.ts's AltKind for why a
  // fabricated free row was actively harmful. What the carrier owes is money,
  // and it is computed in server/domain/refund.ts instead.
  const fresh = await offersToAlts(
    offers,
    flight.from,
    flight.to,
    profile.preferences.cabinEntitlement,
    profile.payment.billingCurrency,
  );

  // A search that came back with nothing is not evidence the route is empty —
  // it is far more often every supplier being keyless or throttled at once.
  // Replacing a good candidate list with [] on that basis would strand a member
  // mid-decision, so leave what we hold and let the next tick try again.
  if (fresh.length === 0 && flight.candidates.alts.length > 0) {
    return;
  }

  flight.candidates.alts = await mergePinned(flightId, flight.candidates.alts, fresh);
  flight.altsAsOf = Date.now();
  // Persist — see forecast.ts's applyScore for why createFlight() (an
  // upsert-on-id) is the write-back call here rather than a mutation on a
  // shared in-memory reference.
  await store.createFlight(flight);
}

/**
 * Keeps anything an unresolved recovery still points at. See the module header
 * for what breaks without this.
 */
async function mergePinned(flightId: string, current: Alt[], fresh: Alt[]): Promise<Alt[]> {
  const pinned = new Set<string>();
  const recoveryTasks = await store.getRecoveryTasksForFlight(flightId);
  for (const t of recoveryTasks) {
    // A finished recovery holds no claim on inventory — its booking is made.
    if (t.resolution && t.phase === 'booked') continue;
    if (t.chosenAltId) pinned.add(t.chosenAltId);
    // Rejected ids are pinned too: resolveTask permanently excludes them, and
    // an id it can no longer resolve is an exclusion that silently lapses.
    t.rejectedAltIds.forEach((id) => pinned.add(id));
  }
  // A pre-authorised plan is a promise about specific ids — isPlanIntact checks
  // exactly those, and reads a missing alt as a broken plan.
  //
  // Fixed 2026-08-21: this used to load `listPassengers()` — the ENTIRE
  // passenger table, system-wide — then issue one `getPreAuth` call per
  // passenger just to find this ONE flight's pre-auths, a true N+1 on a hot
  // path (this function can run every 20s during a real disruption, per the
  // module header). `getPreAuthsForFlight` is one indexed query.
  const preAuths = await store.getPreAuthsForFlight(flightId);
  for (const pre of preAuths) {
    if (pre.altId) pinned.add(pre.altId);
  }

  if (pinned.size === 0) return fresh;

  const freshIds = new Set(fresh.map((a) => a.id));
  const survivors = current
    .filter((a) => pinned.has(a.id) && !freshIds.has(a.id))
    .map((a) => (
      a.ok
        // It was bookable last time we looked and is no longer offered. Say so
        // rather than dropping it — the member is mid-decision on this row.
        ? { ...a, ok: false, why: 'No longer offered by any supplier — re-checked just now' }
        : a
    ));

  return [...fresh, ...survivors];
}

/**
 * Non-blocking refresh for read paths. A page asking for a flight should render
 * whatever alternatives we already hold rather than waiting on several supplier
 * round trips; the next poll picks up the fresh set.
 */
export function refreshAltsIfStale(flight: Flight): void {
  void (async () => {
    if (!(await isAltsStale(flight))) return;
    try {
      await refreshAlts(flight.id);
    } catch (err) {
      // Swallowed for the caller — a page render must never fail because a
      // supplier did — but not swallowed silently. A refresh that throws every
      // time looks exactly like a refresh that is merely slow: candidates stay
      // empty, `altsAsOf` never advances, and nothing anywhere says why.
      if (process.env.NODE_ENV !== 'production') {
        console.error(`[altsCache] refresh failed for ${flight.id}:`, err);
      }
    }
  })();
}
