/**
 * Between real model calls, nudges a standard/dormant-tier flight's
 * cancellation estimate using OTHER flights currently departing the same
 * origin airport around a similar time — ambient conditions (weather, ATC,
 * crew/ops at one airport) are ambient to everyone flying out of it right
 * now, not just to whichever flight last got a real XGBoost call. This is
 * what lets batchScorer.ts's standard/dormant intervals be widened
 * (config/risk-thresholds.json) without the displayed number going stale in
 * between — see this file's neighborSmoothing config block for every tunable.
 *
 * A fourth, independent scheduling loop alongside batchScorer.ts's three
 * tiers (same recursive-setTimeout + globalThis-idempotency-guard shape, for
 * the same dev-mode-HMR-safety reason) — never the critical tier (see
 * eligibleForSmoothing), and never chains a smoothed value into another
 * smoothed value: every input this module reads (a flight's own last score,
 * and every neighbor's) comes from server/domain/store.ts's
 * getLastRealSnapshot()/getNeighborRealSnapshots(), both of which filter to
 * source = 'internal-ml' at the SQL layer. That is what makes "never smooth
 * from smoothed" structurally true rather than a runtime check that could be
 * forgotten at a future call site.
 */
import { scoreFlight, type ModelScore } from './riskModel';
import { applyScore } from './forecast';
import { getThresholdConfig, type ThresholdConfig } from '@/lib/thresholdConfig';
import { tierFor } from './rescoreTiming';
import * as store from '../domain/store';
import type { NeighborSnapshotRow } from '../domain/store';
import type { Flight } from '../domain/types';

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/**
 * Pure blend math — a Laplace/pseudo-count formula mirroring
 * zkd-risk-model/src/features.py's `_expanding_rate()` (SMOOTH_N), but with
 * a much smaller pseudo-count: the "prior" here is one flight's own real
 * model score, not a population average over millions of training rows.
 * Each neighbor is weighted by how close its departure is to `depEpochMs`
 * (triangular kernel over `windowMinutes`) and how fresh its own real score
 * still is (exponential decay over `recencyHalfLifeMs`). With zero
 * qualifying neighbors this reduces exactly to `real` unchanged — no drift
 * with no evidence. The result is always clamped to at most
 * `maxCancelProbabilityDeltaPerPass`/`maxRiskScoreDeltaPerPass` away from
 * `real`, so a single pass can only ever nudge, never jump a full band.
 */
export function blendNeighborScore(
  real: { cancelProbability: number; riskScore?: number },
  neighbors: NeighborSnapshotRow[],
  depEpochMs: number,
  cfg: ThresholdConfig['neighborSmoothing'],
  now: number,
): { cancelProbability: number; riskScore?: number } {
  const windowMs = cfg.windowMinutes * 60_000;

  let weightTotal = 0;
  let probWeighted = 0;
  let riskWeightTotal = 0;
  let riskWeighted = 0;

  for (const n of neighbors) {
    const proximity = Math.max(0, 1 - Math.abs(n.depEpochMs - depEpochMs) / windowMs);
    if (proximity <= 0) continue;
    const recency = Math.pow(0.5, Math.max(0, now - n.asOfMs) / cfg.recencyHalfLifeMs);
    const w = proximity * recency;
    if (w <= 0) continue;

    weightTotal += w;
    probWeighted += w * n.cancelProbability;

    if (n.riskScore !== null) {
      riskWeightTotal += w;
      riskWeighted += w * n.riskScore;
    }
  }

  const blendedProbability =
    weightTotal > 0
      ? (real.cancelProbability * cfg.ownScorePseudoCount + probWeighted) / (cfg.ownScorePseudoCount + weightTotal)
      : real.cancelProbability;
  const cancelProbability = clamp(
    clamp(blendedProbability, real.cancelProbability - cfg.maxCancelProbabilityDeltaPerPass, real.cancelProbability + cfg.maxCancelProbabilityDeltaPerPass),
    0,
    1,
  );

  // Never fabricated: if the real score has no riskScore (percentile rank
  // not available yet — see riskModel.ts), the blend doesn't invent one.
  let riskScore: number | undefined = real.riskScore;
  if (real.riskScore !== undefined && riskWeightTotal > 0) {
    const blendedRiskScore = (real.riskScore * cfg.ownScorePseudoCount + riskWeighted) / (cfg.ownScorePseudoCount + riskWeightTotal);
    riskScore = clamp(
      clamp(blendedRiskScore, real.riskScore - cfg.maxRiskScoreDeltaPerPass, real.riskScore + cfg.maxRiskScoreDeltaPerPass),
      0,
      100,
    );
  }

  return { cancelProbability, riskScore };
}

/** Exported for tests: which flights a tick would actually consider.
 *  Critical-tier flights are never smoothed — they already get real
 *  90s-cadence calls, so smoothing them would only add latency/noise
 *  exactly where accuracy matters most, for zero benefit. */
export function eligibleForSmoothing(flights: Flight[], cfg: ThresholdConfig, now: number): Flight[] {
  if (!cfg.neighborSmoothing.enabled) return [];
  return flights.filter((f) => {
    const tier = tierFor(f, cfg, now);
    return tier === 'standard' || tier === 'dormant';
  });
}

async function tickOne(flight: Flight, cfg: ThresholdConfig, now: number): Promise<void> {
  const ownReal = await store.getLastRealSnapshot(flight.id);
  // Never real-scored yet — smoothing has nothing honest to blend against.
  // Picked up only by the ordinary critical/standard/dormant real tiers
  // (batchScorer.ts) instead, exactly as before this feature existed.
  if (!ownReal) return;

  if (now - ownReal.asOfMs > cfg.neighborSmoothing.maxSmoothedAgeMs) {
    // Wall-clock backstop, not a consecutive-passes counter: composes
    // correctly regardless of this tick's own interval. Forces a real
    // single-flight call (with a real SHAP explanation) instead of another
    // smoothed pass once this flight's own grounding has gotten old enough.
    const score = await scoreFlight(flight);
    if (score) await applyScore(flight, score);
    return;
  }

  // A flight only reaches here after having had at least one real score, so
  // its last known seat count is always available to reuse (see
  // forecast.ts's applyScore()'s seatsAvailableOverride for why this
  // avoids re-running a real supplier search on every smoothing tick).
  const seatsAvailableOverride = flight.forecast?.thresholds.inputs.seatsAvailable;
  if (seatsAvailableOverride === undefined) return;

  const depEpochMs = new Date(flight.depISO).getTime();
  const windowMs = cfg.neighborSmoothing.windowMinutes * 60_000;
  const minAsOfMs = now - cfg.neighborSmoothing.maxNeighborScoreAgeMs;
  const neighbors = await store.getNeighborRealSnapshots(flight.from, depEpochMs, windowMs, flight.id, minAsOfMs);

  const blended = blendNeighborScore(
    { cancelProbability: ownReal.cancelProbability, riskScore: ownReal.riskScore },
    neighbors,
    depEpochMs,
    cfg.neighborSmoothing,
    now,
  );

  const smoothedScore: ModelScore = {
    cancelProbability: blended.cancelProbability,
    riskScore: blended.riskScore,
    // Discounted, never inflated: an interpolated estimate is never more
    // certain than the real score it's derived from.
    confidence: ownReal.confidence * cfg.neighborSmoothing.confidenceDiscount,
    modelVersion: ownReal.modelVersion,
    source: 'neighbor-smoothed',
  };

  await applyScore(flight, smoothedScore, { seatsAvailableOverride });
}

export async function tick(): Promise<void> {
  const cfg = getThresholdConfig();
  if (!cfg.neighborSmoothing.enabled) return;
  const now = Date.now();
  const flights = eligibleForSmoothing(await store.listFlights(), cfg, now);
  if (flights.length === 0) return;
  await Promise.allSettled(flights.map((f) => tickOne(f, cfg, now)));
}

const g = globalThis as typeof globalThis & {
  __zkdNeighborSmoothingStarted?: boolean;
  __zkdNeighborSmoothingTimer?: NodeJS.Timeout;
};

function scheduleNext(): void {
  const intervalMs = getThresholdConfig().neighborSmoothing.tickIntervalMs;
  g.__zkdNeighborSmoothingTimer = setTimeout(async () => {
    try {
      await tick();
    } catch (e) {
      console.error('[neighborSmoothing] tick failed:', e);
    } finally {
      scheduleNext(); // re-read the interval each time so a config edit takes effect on the next tick, not just at startup
    }
  }, intervalMs);
}

/** Idempotent — safe to call from instrumentation.ts's register(), which
 *  Next.js dev-mode HMR can re-invoke. Always schedules (even if disabled at
 *  startup) so a later hot-reload enabling the feature takes effect on the
 *  next tick, same as every other config value here — tick() itself is the
 *  enabled/disabled check. */
export function startNeighborSmoothing(): void {
  if (g.__zkdNeighborSmoothingStarted) return;
  g.__zkdNeighborSmoothingStarted = true;
  const cfg = getThresholdConfig();
  console.log(
    `[neighborSmoothing] starting — enabled=${cfg.neighborSmoothing.enabled} ` +
      `tick=${cfg.neighborSmoothing.tickIntervalMs}ms window=${cfg.neighborSmoothing.windowMinutes}min ` +
      `maxSmoothedAgeMs=${cfg.neighborSmoothing.maxSmoothedAgeMs}`,
  );
  scheduleNext();
}
