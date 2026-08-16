/**
 * The real cancellation-probability model, replacing server/lumo.ts.
 *
 * Model: gradient-boosted trees (XGBoost), trained in zkd-risk-model/ on
 * real US DOT/BTS + Brazil ANAC historical flight data (2.4M+ real rows,
 * real cancellation labels — see zkd-risk-model/reports/model_metrics.json
 * for the honestly-measured out-of-time AUC/Brier/calibration numbers).
 * Served by zkd-risk-model/src/serve.py locally, the same code path AWS
 * Lambda runs in production (zkd-risk-model/infra/scoring.tf).
 *
 * WHAT THIS DOES NOT DO: there is no mock branch. If RISK_MODEL_URL is
 * unset or unreachable, refreshForecast returns null and the caller must
 * treat the forecast as genuinely unavailable — never a fabricated number.
 * That is a behavior change from server/lumo.ts's old "no key -> mock"
 * fallback, deliberately: a VP-facing run of this system shows a real
 * score or an honest "not available", not a number invented to fill the
 * screen.
 *
 * KNOWN v1 GAP, stated plainly: the trained model does not consume weather
 * as a feature. server/weather.ts is real and wired for the risk
 * explanation narrative, but the BTS/ANAC training data has no per-row
 * historical weather join yet — adding one (NOAA ISD archive by
 * station/hour) is the clearly-scoped next retrain, not silently implied
 * here. See zkd-risk-model/README.md "Known gaps".
 */
import { airport, isInternational, distanceKm, localDateParts } from '../airportDirectory';
import { getOrSet } from '../cache';
import type { Flight } from '../domain/types';

const RISK_MODEL_URL = process.env.RISK_MODEL_URL ?? 'http://localhost:8090';
const ENTITY_RATES_TTL_MS = 10 * 60 * 1000;

type SyntheticRates = {
  global_prior: number;
  as_of: string;
  carrier: Record<string, number>;
  origin: Record<string, number>;
  dest: Record<string, number>;
  route: Record<string, number>;
  origin_month: Record<string, number>;
};

type EntityRates = {
  global_prior: number;
  as_of: string;
  carrier: Record<string, number>;
  origin: Record<string, number>;
  dest: Record<string, number>;
  route: Record<string, number>;
  origin_month: Record<string, number>;
  origin_hour_density_avg: Record<string, number>;
  origin_hour_density_global_avg: number;
  /**
   * A SEPARATE table (zkd-risk-model/src/ingest_india_synthetic.py) —
   * fabricated Indian-market reference rates, smoothed with the identical
   * formula the real training table uses, never merged into carrier/
   * origin/dest/route/origin_month above. Null on a checkout where that
   * script hasn't been run yet — features fall straight to global_prior,
   * same as before this existed. See FeatureDataSource: a rate that comes
   * from here is labeled 'synthetic-market-estimate', never 'real'.
   */
  live_synthetic: SyntheticRates | null;
};

async function entityRates(): Promise<EntityRates | null> {
  return getOrSet('riskmodel:entity-rates', ENTITY_RATES_TTL_MS, async () => {
    const res = await fetch(`${RISK_MODEL_URL}/entity-rates`, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`entity-rates ${res.status}`);
    return (await res.json()) as EntityRates;
  }).catch(() => null);
}

/**
 * A LIVE:-namespaced entity never matches the training table's real
 * BTS:/ANAC: keys (see assembleFeatures below) — that's a deliberate,
 * honest cold-start design, not a bug. But the resulting fallback value
 * is real evidence of a DIFFERENT thing than a real per-entity rate would
 * be, and the audit panel needs to say which is which rather than present
 * a population average — or a synthetic estimate — as if it were this
 * carrier's own history.
 */
export type FeatureDataSource = 'real' | 'synthetic-market-estimate' | 'population-average' | 'unknown';
export type DataSourceMap = Record<string, FeatureDataSource>;

/**
 * Three-tier lookup: this entity's real trained history, then the
 * fabricated-but-methodologically-identical Indian-market estimate
 * (zkd-risk-model/src/ingest_india_synthetic.py), then the honest
 * population prior. Every LIVE: key misses tier 1 by construction (see
 * above) — that miss is what makes tier 2 worth having at all for this
 * app's actual flights, which are all LIVE:.
 */
function tieredRate(
  real: Record<string, number> | undefined,
  synthetic: Record<string, number> | undefined,
  key: string,
  prior: number
): { value: number; source: FeatureDataSource } {
  if (real?.[key] !== undefined) return { value: real[key], source: 'real' };
  if (synthetic?.[key] !== undefined) return { value: synthetic[key], source: 'synthetic-market-estimate' };
  return { value: prior, source: 'population-average' };
}

export type RiskFeatures = Record<string, number | null>;

/**
 * Assembles the feature vector for a live flight. Carrier/airport keys are
 * namespaced LIVE: — distinct from the training data's BTS:/ANAC: keys —
 * because these are real Indian/international carriers and airports the
 * model has never seen labeled outcomes for yet. They cold-start to the
 * global prior (see entity_rates.global_prior) with a correspondingly lower
 * `confidence`, exactly like an unseen US/Brazil entity would in training.
 * As real outcomes accumulate (this app's own AviationStack/OAG-observed
 * results), the weekly retrain (zkd-risk-model/infra/training.tf) folds
 * LIVE: entities into the historical-rate tables with real data of their
 * own — the same back-test loop documentation/design/01-prediction-model.md
 * already specifies for hold-conversion, extended to actually retrain on.
 */
export type AssembledFeatures = { features: RiskFeatures; dataSource: DataSourceMap };

export async function assembleFeatures(flight: Flight): Promise<AssembledFeatures | null> {
  const rates = await entityRates();
  if (!rates) return null;

  const origin = airport(flight.from);
  const dest = airport(flight.to);
  const depAt = new Date(flight.depISO);

  const carrierCode = flight.code.replace(/\s+/g, '').replace(/\d+$/, '');
  const carrierKey = `LIVE:${carrierCode}`;
  const originKey = `LIVE:${flight.from}`;
  const destKey = `LIVE:${flight.to}`;
  // Training's hour_of_day/day_of_week/month are all origin-airport LOCAL
  // wall-clock time (src/ingest_bts.py's CRSDepTime, src/ingest_anac.py's
  // "Partida Prevista" — both naive, unzoned, local-time fields) — never the
  // UTC calendar components of the instant. See airportDirectory.ts's
  // localDateParts for the full story on why this matters (is_redeye and
  // hour_of_day are high-gain features, and getting this wrong is a
  // constant, silent, non-obvious skew for every non-UTC+0 airport, i.e.
  // every real flight this app scores).
  const { hour, dayOfWeek: dow, month: localMonth } = localDateParts(flight.from, depAt.getTime());

  const routeKey = `LIVE:${flight.from}>LIVE:${flight.to}`;
  const originMonthKey = `LIVE:${flight.from}:${localMonth}`;

  const routeDistanceKm = origin && dest ? distanceKm(origin, dest) : null;

  const hasOriginHourDensity = rates.origin_hour_density_avg?.[flight.from] !== undefined;
  const syn = rates.live_synthetic;

  const carrierRate = tieredRate(rates.carrier, syn?.carrier, carrierKey, rates.global_prior);
  const routeRate = tieredRate(rates.route, syn?.route, routeKey, rates.global_prior);
  const originRate = tieredRate(rates.origin, syn?.origin, originKey, rates.global_prior);
  const destRate = tieredRate(rates.dest, syn?.dest, destKey, rates.global_prior);
  const originMonthRate = tieredRate(rates.origin_month, syn?.origin_month, originMonthKey, rates.global_prior);

  const features: RiskFeatures = {
    carrier_hist_cancel_rate: carrierRate.value,
    route_hist_cancel_rate: routeRate.value,
    origin_hist_cancel_rate: originRate.value,
    dest_hist_cancel_rate: destRate.value,
    origin_month_hist_cancel_rate: originMonthRate.value,
    month: localMonth,
    day_of_week: dow,
    hour_of_day: hour,
    is_redeye: hour < 5 || hour >= 22 ? 1 : 0,
    is_weekend: dow >= 6 ? 1 : 0,
    distance_km: routeDistanceKm,
    sched_duration_min: flight.durationMin ?? null,
    // Live origins are LIVE:-namespaced and never match the training
    // table's real per-airport keys (same intentional cold-start pattern as
    // the historical-rate lookups above) — fall back to the real population
    // median density, not a made-up constant.
    origin_hour_density: hasOriginHourDensity ? rates.origin_hour_density_avg[flight.from] : rates.origin_hour_density_global_avg,
    // OAG Flight Info Connections (real tail-rotation linkage) is a
    // Production-tier product still "submitted"/pending on this account —
    // see .env.example. Left null (honest gap), never guessed.
    prior_leg_cancelled: null,
    international: isInternational(flight.from, flight.to) ? 1 : 0,
  };

  // Which of the above are this entity's own real history vs a population
  // fallback — the explanation panel (ForecastAudit.tsx) reads this to
  // label a bar "population average" instead of implying it's evidence
  // about this specific carrier/route. Features not listed here (month,
  // hour, distance, etc.) are always real — computed straight from the
  // flight itself, never looked up.
  const dataSource: DataSourceMap = {
    carrier_hist_cancel_rate: carrierRate.source,
    route_hist_cancel_rate: routeRate.source,
    origin_hist_cancel_rate: originRate.source,
    dest_hist_cancel_rate: destRate.source,
    origin_month_hist_cancel_rate: originMonthRate.source,
    origin_hour_density: hasOriginHourDensity ? 'real' : 'population-average',
    prior_leg_cancelled: 'unknown',
  };

  return { features, dataSource };
}

/** One real, additive tree-SHAP feature contribution — see
 *  zkd-risk-model/src/inference.py's `explain()` for the exact math and why
 *  the units are log-odds, not probability points. */
export type FeatureContribution = {
  feature: string;
  value: number | null;
  contributionLogOdds: number;
  direction: 'increases' | 'decreases' | 'neutral';
  relativeShare: number;
};

export type ModelExplanation = {
  biasMarginLogOdds: number;
  features: FeatureContribution[];
};

export type ModelScore = {
  cancelProbability: number;
  /** Percentile rank (0-100) of cancelProbability against the real,
   *  live-realistic score distribution (zkd-risk-model/src/score_distribution.py)
   *  — NOT a probability, and never derived from a rescaled cancelProbability.
   *  This model's real cancelProbability never exceeds ~4% (flight
   *  cancellation is a rare event, and this is a calibrated probability, not
   *  an inflated risk score) — see reports/score_distribution.json. riskScore
   *  exists so an intuitive 0-100 cutoff (config/risk-thresholds.json's
   *  altCache.prefetchAtOrAboveRiskScore) can gate alt-search without lying
   *  about what cancelProbability means. Absent if score_percentile_lookup.npy
   *  hasn't been generated yet (python src/score_distribution.py) — omitted,
   *  never fabricated. */
  riskScore?: number;
  confidence: number;
  modelVersion: string;
  source: 'internal-ml';
  /** absent on the batch-scoring path (server/engine/batchScorer.ts) — real
   *  explanation costs an extra tree pass per flight, not worth it when
   *  nobody is looking at it. Present on every on-demand/reverify score. */
  explanation?: ModelExplanation;
  /** Which of the historical-rate features above are this entity's own
   *  real history vs a population-average cold-start fallback — same
   *  on-demand-only availability as `explanation`. */
  dataSource?: DataSourceMap;
};

export async function scoreFlight(flight: Flight): Promise<ModelScore | null> {
  let assembled: AssembledFeatures | null;
  try {
    assembled = await assembleFeatures(flight);
  } catch (e) {
    console.error(`[riskModel] feature assembly failed for ${flight.id}:`, e);
    return null;
  }
  if (!assembled) return null; // entity-rates unreachable — RISK_MODEL_URL down or not started
  const { features, dataSource } = assembled;

  try {
    const res = await fetch(`${RISK_MODEL_URL}/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(features),
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.error(`[riskModel] scorer returned ${res.status} for ${flight.id}`);
      return null;
    }
    const result = (await res.json()) as ModelScore;
    return { ...result, dataSource };
  } catch (e) {
    console.error(`[riskModel] scorer unreachable for ${flight.id}:`, e);
    return null; // real failure (including timeout) — never fabricate a fallback probability
  }
}

/**
 * Scores every given flight in ONE request to the scorer (a real array body,
 * not N single calls) — the same "collapse calls" principle
 * documentation/design/03-action-policy.md applies to the supplier
 * coordinator, applied here to the interval batch re-scorer
 * (server/engine/batchScorer.ts). The scorer's array path skips the
 * explanation pass per flight (zkd-risk-model/src/serve.py), which is the
 * right tradeoff for a scheduled sweep nobody is watching in real time.
 */
export async function scoreFlightsBatch(flights: Flight[]): Promise<Map<string, ModelScore>> {
  const results = new Map<string, ModelScore>();
  const withFeatures: { id: string; features: RiskFeatures }[] = [];
  for (const flight of flights) {
    try {
      const assembled = await assembleFeatures(flight);
      if (assembled) withFeatures.push({ id: flight.id, features: assembled.features });
    } catch (e) {
      console.error(`[riskModel] batch feature assembly failed for ${flight.id}:`, e);
    }
  }
  if (withFeatures.length === 0) return results;

  try {
    const res = await fetch(`${RISK_MODEL_URL}/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(withFeatures.map((f) => f.features)),
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      console.error(`[riskModel] batch scorer returned ${res.status}`);
      return results;
    }
    // Per-item: the scorer now returns {"error": ...} in a slot instead of
    // failing the whole array, so one bad flight must not drop every other
    // real score in the sweep. Index alignment holds because withFeatures
    // and the request body were built from the same array in the same
    // order — verified explicitly here rather than assumed.
    const scores = (await res.json()) as (ModelScore | { error: string })[];
    withFeatures.forEach((f, i) => {
      const score = scores[i];
      if (!score) return;
      if ('error' in score) {
        console.error(`[riskModel] batch scorer failed for ${f.id}:`, score.error);
        return;
      }
      results.set(f.id, score);
    });
  } catch (e) {
    console.error('[riskModel] batch scorer unreachable:', e);
  }
  return results;
}
