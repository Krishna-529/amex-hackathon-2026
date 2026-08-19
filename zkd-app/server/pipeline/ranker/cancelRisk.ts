/**
 * A cheap, synchronous cancellation-risk estimate for an ALTERNATE flight.
 *
 * The pipeline already runs the trained XGBoost cancellation model over the
 * member's BOOKED flights at the top of the pipeline (server/engine/riskModel.ts
 * → zkd-risk-model/serve.py). This brings that same signal into the alternate
 * search: an option we could move the member onto is worse if it is itself
 * likely to be cancelled. Recovering someone onto a flight that is about to die
 * is the failure this feature exists to avoid.
 *
 * Why a prior rather than a live model call per alternate: scoring every
 * candidate through serve.py would put N model round-trips on the recovery's
 * critical path — the exact latency/quota cost the ranker is designed to keep
 * off it. Instead we reuse the model's OWN committed historical-rate tables
 * (zkd-risk-model/models/entity_rates.json and the Indian-market
 * entity_rates_synthetic.json), which are the very features the trees split on,
 * with the identical real → synthetic → global_prior tiering riskModel.ts uses.
 * This is a genuine use of the ML component's learned rates, at zero network
 * cost, and it degrades honestly: if the tables are not on disk (a checkout
 * where the model has not been built) every alternate gets the same base rate,
 * the `stability` feature becomes a constant, and ranking is unchanged.
 *
 * It is a PRIOR, not the full model output, and it is labelled as such. A future
 * version can swap in a single batched serve.py call over the whole candidate
 * set behind this same interface without touching the ranker.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

type RateTable = {
  global_prior: number;
  carrier: Record<string, number>;
  route: Record<string, number>;
};

const REAL_PATH = join(process.cwd(), '..', 'zkd-risk-model', 'models', 'entity_rates.json');
const SYN_PATH = join(process.cwd(), '..', 'zkd-risk-model', 'models', 'entity_rates_synthetic.json');

/** A sane base cancellation rate used only when no model tables are present at
 *  all — roughly the global prior the trained tables carry, so behaviour with
 *  and without the files is comparable rather than wildly different. */
export const BASE_CANCEL_RATE = 0.02;

let cache: { real?: RateTable; syn?: RateTable; loaded: boolean } = { loaded: false };

function load(): void {
  if (cache.loaded) return;
  cache = { loaded: true };
  try {
    if (existsSync(REAL_PATH)) cache.real = JSON.parse(readFileSync(REAL_PATH, 'utf8')) as RateTable;
  } catch {
    /* absent or unreadable → fall through to synthetic/base */
  }
  try {
    if (existsSync(SYN_PATH)) cache.syn = JSON.parse(readFileSync(SYN_PATH, 'utf8')) as RateTable;
  } catch {
    /* absent → base */
  }
}

/** For tests: force explicit tables, or (both undefined) reset to on-disk load. */
export function __setTablesForTest(real?: RateTable, syn?: RateTable): void {
  if (real === undefined && syn === undefined) {
    cache = { loaded: false }; // next call reloads from disk
    return;
  }
  cache = { real, syn, loaded: true };
}

/**
 * real → synthetic → global_prior, matching riskModel.ts's `tieredRate`. Real
 * training data (US/Brazil) rarely covers an Indian carrier or route, so the
 * synthetic Indian table is what actually discriminates for a domestic demo;
 * the real table still wins where it has the entity.
 */
function tiered(realT: Record<string, number> | undefined, synT: Record<string, number> | undefined, key: string, fallback: number): number | null {
  const r = realT?.[key];
  if (typeof r === 'number') return r;
  const s = synT?.[key];
  if (typeof s === 'number') return s;
  return fallback === Infinity ? null : fallback;
}

/**
 * Estimated P(this alternate is itself cancelled), from the carrier's and the
 * route's historical rates. Blended by taking the max of the two available
 * signals rather than the mean: a reliable carrier on a weather-exposed route,
 * or a shaky carrier on a calm route, is still a risk, and a recovery should be
 * conservative about re-disruption. Falls back cleanly at every level.
 */
export function cancelRiskOf(carrierCode: string, from: string, to: string): number {
  load();
  const real = cache.real;
  const syn = cache.syn;
  if (!real && !syn) return BASE_CANCEL_RATE;

  const globalPrior = real?.global_prior ?? syn?.global_prior ?? BASE_CANCEL_RATE;
  const carrier = carrierCode.toUpperCase();

  // Keys are namespaced LIVE:<code> in the synthetic table (and the live-serving
  // convention); the real table uses source-prefixed keys we will not match for
  // Indian carriers, which is exactly why the synthetic tier exists.
  const carrierRate = tiered(real?.carrier, syn?.carrier, `LIVE:${carrier}`, globalPrior) ?? globalPrior;
  const routeRate = tiered(real?.route, syn?.route, `LIVE:${from}>LIVE:${to}`, globalPrior) ?? globalPrior;

  return clampRate(Math.max(carrierRate, routeRate));
}

function clampRate(p: number): number {
  return Math.max(0, Math.min(1, p));
}
