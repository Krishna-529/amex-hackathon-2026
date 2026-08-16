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
import { applyScore } from './forecast';
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
  const flights = flightsInTier(await store.listFlights(), tier, cfg, Date.now());
  if (flights.length === 0) return;

  const scores = await scoreFlightsBatch(flights);
  await Promise.allSettled(
    flights.filter((f) => scores.has(f.id)).map((f) => applyScore(f, scores.get(f.id)!)),
  );
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
  for (const tier of TIERS) scheduleNext(tier);
}
