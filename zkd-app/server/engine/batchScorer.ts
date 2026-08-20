/**
 * The interval re-scorer — the local equivalent of
 * zkd-risk-model/infra/scoring.tf's scheduled Lambda batch_scorer, and what
 * actually produces the "certain intervals of time" points on the forecast
 * history graph. Runs independently of anyone viewing a flight: without
 * this, `flight.forecastHistory` would only grow when a page happened to be
 * open and its TTL happened to expire, which is not a real interval series.
 *
 * Three independent tiers, not one flat interval — see rescoreTiming.ts's
 * tierFor(). A flight 45 minutes from departure and a flight 3 days out do
 * not carry the same cost of staleness, so they are not rescored on the same
 * clock: 'critical' flights (near departure, or already at hold-gate/
 * pre-authorise) get a tight cadence; 'dormant' flights (far out, still at
 * watch) get a loose one; everything else keeps the original default. Each
 * tier still does exactly ONE real HTTP batch call per tick regardless of
 * how many flights are in it (riskModel.ts's scoreFlightsBatch), so tightening
 * the critical tier's cadence does not multiply supplier or model cost — it
 * is a Lambda-invocation-count change, not a per-flight one.
 */
import { scoreFlightsBatch } from './riskModel';
import { applyScore, isDemoPinned } from './forecast';
import { getThresholdConfig, type ThresholdConfig } from '@/lib/thresholdConfig';
import { tierFor, type RescoreTier } from './rescoreTiming';
import * as store from '../domain/store';
import type { Flight } from '../domain/types';

const TIERS = ['critical', 'standard', 'dormant'] as const;

const g = globalThis as typeof globalThis & {
  __zkdBatchScorerStarted?: boolean;
  __zkdBatchScorerTimers?: Partial<Record<RescoreTier, NodeJS.Timeout>>;
};

function intervalMsFor(tier: RescoreTier, cfg: ThresholdConfig): number {
  switch (tier) {
    case 'critical':
      return cfg.forecast.criticalRescoreIntervalMs;
    case 'dormant':
      return cfg.forecast.dormantRescoreIntervalMs;
    case 'standard':
      return cfg.forecast.batchRescoreIntervalMs;
  }
}

/** Exported for tests: which flights a given tick would actually score. */
export function flightsInTier(flights: Flight[], tier: RescoreTier, cfg: ThresholdConfig, now: number): Flight[] {
  return flights.filter((f) => tierFor(f, cfg, now) === tier);
}

async function tick(tier: RescoreTier): Promise<void> {
  const cfg = getThresholdConfig();
  // Skip demo-pinned flights: a /ops "Ramp risk" override must not be re-scored
  // away by a scheduled tick (a ramped flight sits at hold-gate → the critical
  // tier's 90s cadence, which is exactly what used to reset it). See isDemoPinned.
  const flights = flightsInTier(await store.listFlights(), tier, cfg, Date.now())
    .filter((f) => !isDemoPinned(f));
  if (flights.length === 0) return;

  const scores = await scoreFlightsBatch(flights);
  await Promise.allSettled(
    flights.filter((f) => scores.has(f.id)).map((f) => applyScore(f, scores.get(f.id)!)),
  );
}

const WARM_RETRY_MS = 20_000;
const WARM_MAX_ATTEMPTS = 5;

/**
 * Score every flight once, immediately, on startup — so a freshly booted
 * server shows real risk scores within seconds instead of waiting up to a full
 * tier interval for the first scheduled tick (dormant flights are 30 min out
 * otherwise, which is why /ops and /flights showed "—" right after boot). One
 * batch call for all flights, same cost shape as a single tier tick. Returns
 * how many forecasts it actually applied, so the caller can tell whether the
 * model service answered.
 */
async function warmAll(): Promise<number> {
  // Same demo-pin exclusion as tick(): never overwrite a presenter's ramped
  // score during the startup warm pass.
  const flights = (await store.listFlights()).filter((f) => !isDemoPinned(f));
  if (flights.length === 0) return 0;
  const scores = await scoreFlightsBatch(flights);
  const scored = flights.filter((f) => scores.has(f.id));
  await Promise.allSettled(scored.map((f) => applyScore(f, scores.get(f.id)!)));
  return scored.length;
}

/**
 * The warm pass can land before the risk model service (RISK_MODEL_URL) is up —
 * scoreFlightsBatch then returns nothing and every forecast stays null. Rather
 * than leave the demo on "—" until the first scheduled tier tick, retry a few
 * times a short interval apart, then stop and let the normal cadence take over.
 * Bounded, and only ever called from startBatchScorer (single-shot via the
 * globalThis guard), so it can't stack up.
 */
function warmUntilScored(attempt = 1): void {
  const retry = () => {
    if (attempt < WARM_MAX_ATTEMPTS) setTimeout(() => warmUntilScored(attempt + 1), WARM_RETRY_MS);
  };
  void warmAll()
    .then((n) => {
      if (n === 0) retry();
    })
    .catch((e) => {
      console.error('[batchScorer] startup warm failed:', e);
      retry();
    });
}

function scheduleNext(tier: RescoreTier): void {
  const intervalMs = intervalMsFor(tier, getThresholdConfig());
  const timers = (g.__zkdBatchScorerTimers ??= {});
  timers[tier] = setTimeout(async () => {
    try {
      await tick(tier);
    } catch (e) {
      console.error(`[batchScorer:${tier}] tick failed:`, e);
    } finally {
      scheduleNext(tier); // re-read the interval each time so a config edit takes effect on the next tick, not just at startup
    }
  }, intervalMs);
}

/**
 * Idempotent — safe to call from instrumentation.ts's register(), which
 * Next.js dev-mode HMR can re-invoke. The globalThis guard is what makes a
 * second call a no-op instead of three more competing timers.
 */
export function startBatchScorer(): void {
  if (g.__zkdBatchScorerStarted) return;
  g.__zkdBatchScorerStarted = true;
  const cfg = getThresholdConfig();
  console.log(
    `[batchScorer] starting — critical=${cfg.forecast.criticalRescoreIntervalMs}ms ` +
      `(<=${cfg.forecast.criticalWindowMinutes}min or hold-gate+) ` +
      `standard=${cfg.forecast.batchRescoreIntervalMs}ms ` +
      `dormant=${cfg.forecast.dormantRescoreIntervalMs}ms (>${cfg.forecast.dormantWindowMinutes}min and watch)`,
  );
  warmUntilScored();
  for (const tier of TIERS) scheduleNext(tier);
}
