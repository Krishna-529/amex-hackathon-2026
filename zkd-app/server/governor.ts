/**
 * The outbound request governor.
 *
 * AGENTS.md states the binding constraint on this system plainly: "supplier API
 * rate limits are the binding constraint, not compute." Until now nothing in
 * this repo enforced that. The only quota awareness that existed was
 * `noteAviationstackCall` in server/cache.ts — a console.warn counter that
 * throttled nothing — and this module supersedes it.
 *
 * That mattered little while `Flight.candidates.alts` refreshed on a flat
 * ten-minute timer. It matters a great deal now: server/engine/altsCache.ts is
 * moving to an adaptive interval that can ask for a refresh every twenty
 * seconds during a disruption, across every watched flight at once. Without a
 * floor underneath it, adaptive refresh is simply a faster way to exhaust a
 * free tier — and an exhausted key on demo day is not a degraded demo, it is no
 * demo.
 *
 * ── Two limits, because they fail differently ──────────────────────────────
 *
 *   burst — requests per second. Exceeding it returns 429s that resolve on
 *           their own. Enforced with a token bucket.
 *   quota — requests per day/month on the free tier. Exceeding it bricks the
 *           key until the window rolls. Enforced with a ledger.
 *
 * ── Lanes, and why the reserve is the important half ───────────────────────
 *
 * Polling is speculative: it exists so the portfolio is warm. Re-validating an
 * offer at the moment of spend is not speculative — it is the last check before
 * the member's money moves, and it must never be the call that gets refused
 * because a background poller drank the quota an hour earlier.
 *
 * So every provider's quota is split. `refresh` may spend up to
 * `quota * (1 - reserveFraction)`; only `confirm` may spend past that. The
 * denial reason is `'reserved'` rather than `'monthly'` precisely so the ops
 * panel can say "refresh throttled to protect the confirm reserve" instead of
 * the much more alarming and less true "out of quota".
 *
 * ── Shared ledgers ─────────────────────────────────────────────────────────
 *
 * Duffel Air and Duffel Stays are one account behind one `duffel_test_` token,
 * so they share one ledger (see LEDGER_OF). Giving them a bucket each would
 * silently double the call rate we think we are making against a single
 * account's limit — the exact class of mistake this module exists to prevent.
 *
 * ── Scope ──────────────────────────────────────────────────────────────────
 *
 * Process-lifetime, module-level state — the same tradeoff already documented
 * in server/cache.ts and server/domain/store.ts. Two dev workers, or a
 * serverless deployment, would each keep their own ledger and collectively
 * overshoot. Not solved here; a shared counter (Redis) is the production shape.
 * Stated rather than papered over.
 */

/**
 * Kept as a standalone union rather than importing SupplierId: this module is
 * imported *by* server/suppliers/*, and reaching back into them would make the
 * cycle real.
 */
export type ProviderId =
  // flights
  | 'duffel'
  | 'kiwi'
  | 'skyscanner'
  | 'sabre'
  | 'travelport'
  | 'travelfusion'
  // hotels
  | 'liteapi'
  | 'duffel-stays'
  | 'makcorps'
  // ground
  | 'uber'
  | 'privatecar'
  // non-booking data sources
  | 'aviationstack'
  | 'lumo'
  | 'gemini';

/** Which ledger a provider actually spends from. Anything absent spends from itself. */
const LEDGER_OF: Partial<Record<ProviderId, ProviderId>> = {
  // One account, one token, one rate limit.
  'duffel-stays': 'duffel',
};

export type Lane = 'refresh' | 'confirm';

export type Budget = {
  /** sustained requests per second */
  tps: number;
  /** token-bucket capacity — how much burst is tolerated after an idle spell */
  burst: number;
  /** free-tier ceiling per UTC day; null when unmetered */
  daily: number | null;
  /** free-tier ceiling per UTC month; null when unmetered */
  monthly: number | null;
  /** share of each quota only `confirm` may spend */
  reserveFraction: number;
  /** politeness floor — never call faster than this regardless of tps */
  minIntervalMs: number;
  /** provenance for the numbers above; quoted on /api/pipeline/health */
  basis: string;
};

/**
 * Published/observed limits at build time.
 *
 * Under this repo's evidence rules these are `assumed` tier unless a key has
 * actually been exercised — they come from vendor documentation, not from
 * measurement. Every one is set at or below the documented figure. Being wrong
 * conservatively costs latency; being wrong the other way costs the key.
 */
export const BUDGETS: Record<ProviderId, Budget> = {
  duffel: {
    tps: 5, burst: 10, daily: 500, monthly: null, reserveFraction: 0.25, minIntervalMs: 1000,
    basis: 'Duffel test mode — shared ledger for Air + Stays (one duffel_test_ token)',
  },
  kiwi: {
    tps: 2, burst: 5, daily: 100, monthly: 1000, reserveFraction: 0.30, minIntervalMs: 2000,
    basis: 'Kiwi/Tequila partner sandbox — conservative pending an approved affiliate key',
  },
  skyscanner: {
    // The tightest flight budget we hold, and search-only — it can never book,
    // so it has no confirm-time path worth reserving for. The whole 500 is
    // pollable, which is also why it will be the first source the refresh
    // manager reports as 'rate-limited'.
    tps: 1, burst: 3, daily: 20, monthly: 500, reserveFraction: 0.20, minIntervalMs: 5000,
    basis: 'RapidAPI Basic (Skyscanner mirror) — 500 calls/month, hard-stopped by RapidAPI',
  },
  sabre: {
    tps: 1, burst: 3, daily: 200, monthly: null, reserveFraction: 0.25, minIntervalMs: 2000,
    basis: 'Sabre CERT — conservative default, no published free cap',
  },
  travelport: {
    tps: 100, burst: 100, daily: null, monthly: null, reserveFraction: 0, minIntervalMs: 0,
    basis: 'Synthetic/local — no network call, so no limit to respect',
  },
  travelfusion: {
    tps: 1, burst: 2, daily: null, monthly: null, reserveFraction: 0.25, minIntervalMs: 2000,
    basis: 'Seam only — never called. Budget exists so wiring it later needs no governor change',
  },
  liteapi: {
    tps: 2, burst: 5, daily: 250, monthly: null, reserveFraction: 0.30, minIntervalMs: 2000,
    basis: 'LiteAPI sandbox — mirrors production; conservative default',
  },
  'duffel-stays': {
    tps: 5, burst: 10, daily: 500, monthly: null, reserveFraction: 0.25, minIntervalMs: 1000,
    basis: 'Duffel Stays — spends from the shared `duffel` ledger, see LEDGER_OF',
  },
  makcorps: {
    // 30/month is 1/day, not 5 — a daily cap that outruns the monthly one by 5x
    // would pace as if there were 150 calls a month and exhaust the real budget
    // in the first week.
    tps: 0.2, burst: 2, daily: 1, monthly: 30, reserveFraction: 0, minIntervalMs: 15_000,
    basis: 'Makcorps free tier — 30/month ≈ 1/day. Market-context guard only, never polled',
  },
  uber: {
    tps: 1, burst: 3, daily: 100, monthly: 2000, reserveFraction: 0.20, minIntervalMs: 3000,
    basis: 'Uber sandbox — no published free cap; set conservatively',
  },
  privatecar: {
    tps: 100, burst: 100, daily: null, monthly: null, reserveFraction: 0, minIntervalMs: 0,
    basis: 'Mocked aggregator — no network call',
  },
  aviationstack: {
    // 100/month is 3/day, not 4 — at 4 the daily pace implies 120/month and the
    // key dies before the month does. The 40% reserve leaves ~1/day for
    // background polling and the rest for confirming a status on the critical
    // path, which is the right way round: this is the tightest budget we hold.
    tps: 0.1, burst: 1, daily: 3, monthly: 100, reserveFraction: 0.40, minIntervalMs: 30_000,
    basis: 'AviationStack free tier — 100/month ≈ 3/day. Replaces the soft ceiling in server/cache.ts',
  },
  lumo: {
    tps: 2, burst: 5, daily: null, monthly: null, reserveFraction: 0.25, minIntervalMs: 1000,
    basis: 'Lumo — no commercial key held; calls fall back to a labelled mock',
  },
  gemini: {
    tps: 1, burst: 3, daily: 1500, monthly: null, reserveFraction: 0.20, minIntervalMs: 1000,
    basis: 'Gemini free tier — generous daily cap, low sustained rate',
  },
};

/**
 * Fraction of a provider's raw throughput that background refreshing may plan
 * against. Refresh is not the only caller — searches, revalidations and the
 * saga all share the same tap — so sizing the refresh cadence at 100% of TPS
 * would leave nothing for the work that actually matters.
 */
const REFRESH_DUTY_CYCLE = 0.05;

/** Returned when the quota is spent: stop refreshing rather than hammer a dead key. */
export const MAX_REFRESH_MS = 60 * 60 * 1000;

type Ledger = {
  tokens: number;
  lastRefillAt: number;
  lastCallAt: number;
  dayKey: string;
  dayUsed: number;
  monthKey: string;
  monthUsed: number;
  consecutiveFailures: number;
  cooldownUntil: number;
};

const ledgers = new Map<ProviderId, Ledger>();

const dayKeyOf = (t: number) => new Date(t).toISOString().slice(0, 10);
const monthKeyOf = (t: number) => new Date(t).toISOString().slice(0, 7);

/** Which ledger this provider spends from — itself unless LEDGER_OF redirects it. */
function ledgerIdOf(p: ProviderId): ProviderId {
  return LEDGER_OF[p] ?? p;
}

/**
 * Windows roll by key mismatch rather than by timer. A process that stays up
 * for a week crosses seven day boundaries and one month boundary with no
 * scheduler involved, and a process that restarts hourly still gets the
 * arithmetic right for whatever window it wakes up in.
 */
function ledgerFor(p: ProviderId, now: number): Ledger {
  const id = ledgerIdOf(p);
  const budget = BUDGETS[id];
  let l = ledgers.get(id);
  if (!l) {
    l = {
      tokens: budget.burst,
      lastRefillAt: now,
      lastCallAt: 0,
      dayKey: dayKeyOf(now),
      dayUsed: 0,
      monthKey: monthKeyOf(now),
      monthUsed: 0,
      consecutiveFailures: 0,
      cooldownUntil: 0,
    };
    ledgers.set(id, l);
  }

  const day = dayKeyOf(now);
  if (l.dayKey !== day) { l.dayKey = day; l.dayUsed = 0; }
  const month = monthKeyOf(now);
  if (l.monthKey !== month) { l.monthKey = month; l.monthUsed = 0; }

  const elapsedSec = (now - l.lastRefillAt) / 1000;
  l.tokens = Math.min(budget.burst, l.tokens + elapsedSec * budget.tps);
  l.lastRefillAt = now;

  return l;
}

export type Grant = { ok: true; provider: ProviderId; lane: Lane; calls: number; at: number };
export type DenialReason = 'tps' | 'daily' | 'monthly' | 'reserved' | 'cooldown' | 'min-interval';
export type Denial = { ok: false; provider: ProviderId; reason: DenialReason; retryAfterMs: number };

/**
 * The quota a given lane is allowed to see.
 *
 * `refresh` cannot see the reserve at all, which is what makes the reserve
 * real: it is not a warning threshold, it is invisible headroom.
 */
function ceilingFor(budget: Budget, lane: Lane, raw: number | null): number | null {
  if (raw === null) return null;
  return lane === 'confirm' ? raw : Math.floor(raw * (1 - budget.reserveFraction));
}

export function tryAcquire(provider: ProviderId, lane: Lane, calls = 1): Grant | Denial {
  const now = Date.now();
  const id = ledgerIdOf(provider);
  const budget = BUDGETS[id];
  const l = ledgerFor(provider, now);

  if (now < l.cooldownUntil) {
    return { ok: false, provider, reason: 'cooldown', retryAfterMs: l.cooldownUntil - now };
  }

  const dayCeil = ceilingFor(budget, lane, budget.daily);
  if (dayCeil !== null && l.dayUsed + calls > dayCeil) {
    // Distinguishing 'reserved' from 'daily' is the difference between "we are
    // protecting the booking path" and "this key is finished". Both stop the
    // caller; only one is bad news.
    const reason: DenialReason = lane === 'refresh' && budget.daily !== null && l.dayUsed + calls <= budget.daily
      ? 'reserved'
      : 'daily';
    return { ok: false, provider, reason, retryAfterMs: msUntilNextDay(now) };
  }

  const monthCeil = ceilingFor(budget, lane, budget.monthly);
  if (monthCeil !== null && l.monthUsed + calls > monthCeil) {
    const reason: DenialReason = lane === 'refresh' && budget.monthly !== null && l.monthUsed + calls <= budget.monthly
      ? 'reserved'
      : 'monthly';
    return { ok: false, provider, reason, retryAfterMs: msUntilNextMonth(now) };
  }

  if (budget.minIntervalMs > 0 && l.lastCallAt > 0 && now - l.lastCallAt < budget.minIntervalMs) {
    return { ok: false, provider, reason: 'min-interval', retryAfterMs: budget.minIntervalMs - (now - l.lastCallAt) };
  }

  if (l.tokens < calls) {
    return {
      ok: false, provider, reason: 'tps',
      retryAfterMs: Math.ceil(((calls - l.tokens) / budget.tps) * 1000),
    };
  }

  l.tokens -= calls;
  l.dayUsed += calls;
  l.monthUsed += calls;
  l.lastCallAt = now;
  return { ok: true, provider, lane, calls, at: now };
}

/**
 * Wraps a provider call in a permit.
 *
 * `onDenied` rather than a throw, because every caller here is a supplier whose
 * contract is to degrade rather than fail — server/suppliers/index.ts treats a
 * rejected promise as a dead source, and a rate-limited source is not dead, it
 * is busy. Suppliers return `{ offers: [], status: 'rate-limited' }` and the
 * per-source status is surfaced to the UI unchanged.
 */
export async function withBudget<T>(
  provider: ProviderId,
  lane: Lane,
  calls: number,
  fn: () => Promise<T>,
  onDenied: (d: Denial) => T,
): Promise<T> {
  const permit = tryAcquire(provider, lane, calls);
  if (!permit.ok) return onDenied(permit);

  try {
    const out = await fn();
    noteOutcome(provider, { ok: true });
    return out;
  } catch (err) {
    noteOutcome(provider, { ok: false });
    throw err;
  }
}

/**
 * Feed the outcome back so repeated failure backs off.
 *
 * Exponential with jitter, capped at a minute, and a server-sent `Retry-After`
 * always wins over our guess — it is the only party that actually knows.
 */
export function noteOutcome(
  provider: ProviderId,
  res: { ok: boolean; status?: number; retryAfterMs?: number },
): void {
  const now = Date.now();
  const l = ledgerFor(provider, now);

  if (res.ok) {
    l.consecutiveFailures = 0;
    l.cooldownUntil = 0;
    return;
  }

  const rateLimited = res.status === 429;
  const serverError = res.status !== undefined && res.status >= 500;
  // A 400 is our bug, not their capacity. Backing off would hide it.
  if (res.status !== undefined && !rateLimited && !serverError) return;

  l.consecutiveFailures += 1;
  const base = Math.min(60_000, 1000 * 2 ** l.consecutiveFailures);
  const jittered = base * (0.75 + Math.random() * 0.5);
  l.cooldownUntil = now + (res.retryAfterMs ?? jittered);
}

/**
 * The fastest this provider can be polled without eventually breaching a limit.
 *
 * This is the hard floor under every interval lib/refreshInterval.ts proposes —
 * applied *after* its own clamps, never before, so adaptive refresh can never
 * become a way to increase call volume.
 *
 * ── Daily paces; monthly hard-stops ───────────────────────────────────────
 *
 * Only the **daily** allowance sets the rhythm. Pacing off the monthly one as
 * well sounds more careful and is actually pathological: on the 1st of a month
 * a 500-call budget spread evenly over 30 days permits 0.01 calls/minute, so
 * every source reports "effectively unpollable" and the adaptive interval does
 * nothing but sit at its ceiling — which is exactly the failure this smoke-test
 * surfaced. Worse, it is conservative in a way that never converges: the
 * interval stays enormous all month because usage never catches up to it.
 *
 * The monthly cap still binds, just at a different layer — `tryAcquire` refuses
 * calls past it. So monthly is a wall, daily is a metronome, and a provider
 * whose month is genuinely spent returns MAX_REFRESH_MS here, which means
 * "stop polling this" rather than "poll slowly".
 *
 * Two constraints then, whichever binds harder:
 *
 *   burst — a duty-cycled share of raw throughput, since refresh is not the
 *           only caller on this tap.
 *   daily — the refresh-visible remainder spread across the time left in the
 *           UTC day. This is what makes a small quota produce an honest answer:
 *           AviationStack at ~3/day yields intervals measured in hours, which
 *           correctly means "this is not something you poll."
 *
 * `watchers` divides the allowance, so ten concurrent recoveries slow all ten
 * down rather than the first one starving the rest.
 */
export function sustainableIntervalMs(
  provider: ProviderId,
  watchers: number,
  callsPerRefresh = 1,
): number {
  const now = Date.now();
  const id = ledgerIdOf(provider);
  const budget = BUDGETS[id];
  const l = ledgerFor(provider, now);

  const w = Math.max(1, watchers);
  const c = Math.max(1, callsPerRefresh);

  // A spent month is a wall, not a slow lane — stop rather than trickle.
  if (budget.monthly !== null) {
    const monthCeil = ceilingFor(budget, 'refresh', budget.monthly) ?? 0;
    if (l.monthUsed >= monthCeil) return MAX_REFRESH_MS;
  }

  const callsPerMin: number[] = [budget.tps * 60 * REFRESH_DUTY_CYCLE];

  if (budget.daily !== null) {
    const ceil = ceilingFor(budget, 'refresh', budget.daily) ?? 0;
    const remaining = Math.max(0, ceil - l.dayUsed);
    if (remaining === 0) return MAX_REFRESH_MS;
    callsPerMin.push(remaining / Math.max(1, msUntilNextDay(now) / 60_000));
  }

  const refreshesPerMin = Math.min(...callsPerMin) / c;
  if (!Number.isFinite(refreshesPerMin) || refreshesPerMin <= 0) return MAX_REFRESH_MS;

  return Math.max(budget.minIntervalMs, Math.ceil((60_000 * w) / refreshesPerMin));
}

export type LedgerSnapshot = {
  provider: ProviderId;
  /** the ledger actually spent from — differs for Duffel Stays */
  ledger: ProviderId;
  tokens: number;
  dayUsed: number; dailyLimit: number | null; dailyRefreshCeiling: number | null;
  monthUsed: number; monthlyLimit: number | null; monthlyRefreshCeiling: number | null;
  cooldownMsRemaining: number;
  sustainableMs: number;
  basis: string;
};

/** What /api/pipeline/health renders. Provider counters only — no member data. */
export function snapshot(watchers = 1): LedgerSnapshot[] {
  const now = Date.now();
  return (Object.keys(BUDGETS) as ProviderId[]).map((p) => {
    const id = ledgerIdOf(p);
    const budget = BUDGETS[id];
    const l = ledgerFor(p, now);
    return {
      provider: p,
      ledger: id,
      tokens: Math.floor(l.tokens * 10) / 10,
      dayUsed: l.dayUsed,
      dailyLimit: budget.daily,
      dailyRefreshCeiling: ceilingFor(budget, 'refresh', budget.daily),
      monthUsed: l.monthUsed,
      monthlyLimit: budget.monthly,
      monthlyRefreshCeiling: ceilingFor(budget, 'refresh', budget.monthly),
      cooldownMsRemaining: Math.max(0, l.cooldownUntil - now),
      sustainableMs: sustainableIntervalMs(p, watchers, 1),
      basis: budget.basis,
    };
  });
}

function msUntilNextDay(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - now;
}

function msUntilNextMonth(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) - now;
}

/** Test seam — process-lifetime state, so anything exercising it must be able to zero it. */
export function __resetGovernor(): void {
  ledgers.clear();
}
