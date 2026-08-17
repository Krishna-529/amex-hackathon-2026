/**
 * Keeps each flight's disruption forecast fresh from the real trained
 * model (server/engine/riskModel.ts), and — this is the load-bearing
 * change from the old design — triggers the alternative-flight pre-cache
 * (altsCache.ts) ONLY when the real score crosses the adaptive `prepare`
 * threshold, not on every page view. Searching and pricing alternatives
 * before a cancellation exists purely to move that work off the critical
 * path (documentation/design/01-prediction-model.md §1); doing it for every
 * flight regardless of risk would spend the same supplier-call budget the
 * whole per-route-coordinator design exists to protect.
 */

import { scoreFlight, type ModelScore } from './riskModel';
import { searchInventory, seatsAcross } from '../suppliers';
import { bandFor, BAND_TONE } from '@/lib/thresholds';
import { thresholdsFor } from './thresholds';
import { getThresholdConfig } from '@/lib/thresholdConfig';
import * as store from '../domain/store';
import type { Flight, FlightForecast } from '../domain/types';
import { refreshAltsIfStale } from './altsCache';
import { refreshGroundIfStale } from './groundCache';
import { logPrediction, logThresholdEvaluation } from '../decisionLedger';

/**
 * The forecast is cached once per Flight and shared by every viewer, so
 * "seats available" has to mean seats that can seat the LARGEST party on the
 * flight — the most constrained booking, not the average one. A party of 6
 * sharing a flight with solo travellers must not see the same scarcity number
 * a solo traveller would.
 */
export async function maxPartyOnFlight(flightId: string): Promise<number> {
  const bookings = await store.getBookingsForFlight(flightId);
  return bookings.reduce((max, b) => Math.max(max, store.partySize(b)), 1);
}

/** Points kept per flight — at the 10-minute default interval this is 24h
 *  of history; the graph shows what exists, however sparse. Not config-
 *  driven like the TTLs below: it bounds an in-memory array's size, a
 *  capacity concern rather than a freshness one ops would want to retune
 *  live. */
const FORECAST_HISTORY_CAP = 288;

const inFlight = new Map<string, Promise<FlightForecast | null>>();

/** How long a cached forecast is considered current —
 *  config/risk-thresholds.json's forecast.ttlMs, read live so a retune
 *  actually takes effect (a hardcoded copy here previously meant it did
 *  not, even though the config file exists precisely so ops can retune
 *  without a redeploy). */
export function isStale(f: Flight): boolean {
  const ttlMs = getThresholdConfig().forecast.ttlMs;
  return !f.forecast || Date.now() - f.forecast.asOf > ttlMs;
}

/**
 * Fetches and caches. Concurrent callers for the same flight share one request —
 * five devices polling the same flight must not become five vendor calls.
 */
export async function refreshForecast(flightId: string): Promise<FlightForecast | null> {
  const existing = inFlight.get(flightId);
  if (existing) return existing;

  const p = compute(flightId).finally(() => inFlight.delete(flightId));
  inFlight.set(flightId, p);
  return p;
}

async function compute(flightId: string): Promise<FlightForecast | null> {
  const flight = await store.getFlight(flightId);
  if (!flight) return null;

  const score = await scoreFlight(flight);
  // No mock fallback: the model was unreachable or the flight could not be
  // scored, so there genuinely is no forecast right now. The caller shows
  // "not available", never a fabricated number.
  if (!score) return null;

  return applyScore(flight, score);
}

/**
 * Turns a real ModelScore into a real FlightForecast: real seat scarcity
 * from a live supplier search, real adaptive thresholds off that scarcity,
 * the band the real probability falls into. Shared by the on-demand path
 * (compute(), above) and the interval batch path (batchScorer.ts) so there
 * is exactly one place that knows how a score becomes a forecast.
 */
export async function applyScore(flight: Flight, score: ModelScore): Promise<FlightForecast> {
  const departsAt = new Date(flight.depISO).getTime();
  const date = flight.depISO.slice(0, 10);

  const inventory = await searchInventory({ origin: flight.from, destination: flight.to, departureDate: date });

  // Seats we can actually see across every supplier, filtered to offers that
  // can seat the largest party on this flight — a 3-seat option is not
  // "available" to a party of 6. Falls back to the seeded candidates when no
  // supplier returned anything, so the threshold never treats a dead sandbox
  // as a sold-out route.
  const partySize = await maxPartyOnFlight(flight.id);
  const seatsAvailable = inventory.offers.length
    ? seatsAcross(inventory.offers.filter((o) => o.seatsRemaining >= partySize))
    : flight.candidates.alts
        .filter((a) => a.ok && (a.kind === 'carrier-protected' || a.seats >= partySize))
        .reduce((n, a) => n + a.seats, 0);

  const thresholds = thresholdsFor({
    seatsAvailable,
    minutesToDeparture: Math.max(0, Math.round((departsAt - Date.now()) / 60_000)),
    hasHardConstraint: flight.hasHardConstraint,
    confidence: score.confidence,
    partySize,
  });

  const pct = Math.round(score.cancelProbability * 100);
  const band = bandFor(pct, thresholds);

  const out: FlightForecast = {
    pct,
    band,
    tone: BAND_TONE[band],
    connectionRisk: null, // OAG Flight Info Connections (real rotation/connection linkage) is pending production approval — see riskModel.ts
    confidence: score.confidence,
    source: score.source,
    modelVersion: score.modelVersion,
    riskScore: score.riskScore,
    explanation: score.explanation,
    dataSource: score.dataSource,
    thresholds,
    asOf: Date.now(),
  };

  flight.forecast = out;
  appendHistory(flight, out);
  // Persist the mutated Flight: applyScore is called on a Flight object
  // fetched fresh from the (now Postgres-backed) store, not a live reference
  // into it, so the forecast/forecastHistory mutation above only survives if
  // it's written back. createFlight() upserts on `id`, so this is the same
  // write path a brand-new flight would use — see store.ts's header comment.
  await store.createFlight(flight);
  logPrediction(flight.id, score);
  // Every threshold evaluation, with its inputs — 03-action-policy.md §2:
  // "An adaptive threshold that cannot be reconstructed after the fact is
  // not auditable."
  logThresholdEvaluation({
    flightId: flight.id,
    inputs: thresholds.inputs,
    thresholds: { prepare: thresholds.prepare, holdGate: thresholds.holdGate, preAuthorise: thresholds.preAuthorise, configVersion: thresholds.configVersion },
    pct,
    band,
  });
  triggerAltPrefetchIfWarranted(flight, score.riskScore);
  return out;
}

/** Real history point on every real compute() — never backfilled or
 *  interpolated. A gap in the graph means no score ran in that window, and
 *  stays a gap. */
function appendHistory(flight: Flight, forecast: FlightForecast): void {
  const history = flight.forecastHistory ?? (flight.forecastHistory = []);
  history.push({
    pct: forecast.pct,
    riskScore: forecast.riskScore,
    band: forecast.band,
    confidence: forecast.confidence,
    modelVersion: forecast.modelVersion,
    asOf: forecast.asOf,
  });
  if (history.length > FORECAST_HISTORY_CAP) history.splice(0, history.length - FORECAST_HISTORY_CAP);
}

/**
 * The threshold-gated pre-cache the whole prediction exists to pay for
 * (documentation/design/01-prediction-model.md §1): alternative-flight
 * search only runs once the real score's riskScore crosses
 * config/risk-thresholds.json's altCache.prefetchAtOrAboveRiskScore, not on
 * every poll. riskScore (not pct/band) gates this deliberately — pct never
 * exceeds ~4% for any flight this model has ever scored (a calibrated
 * probability of a rare event, not an inflated risk number — see
 * riskModel.ts's ModelScore.riskScore), so an intuitive cutoff like 75 has
 * to be judged against the percentile rank, not the raw probability. The
 * member-facing prepare/hold-gate/pre-authorise bands (pct vs. `thresholds`,
 * above) are unaffected — they still drive every banner the member sees.
 * Fire-and-forget — refreshAlts/refreshGround each have their own
 * in-flight/TTL guard, so a flight that keeps re-crossing the gate inside
 * the TTL window does not re-trigger a search.
 *
 * Hotels and cabs ride the same gate as alts: the autonomous rebooking path
 * needs a seat AND a room AND a transfer ready before it can act (see
 * server/engine/simulation.ts's createTaskForBooking), so pre-caching one
 * without the others would leave the pipeline half-warm at the moment it
 * actually matters.
 *
 * Goes through the *IfStale wrappers, not refreshAlts/refreshGround
 * directly — those have no staleness check of their own, only an in-flight
 * (concurrent-caller) dedup. Calling them unconditionally here used to mean
 * a flight sitting above the risk gate across several scoring ticks (the
 * COMMON case for a genuinely at-risk flight, not a rare one — a flight can
 * sit in hold-gate for hours before the carrier actually cancels) fired a
 * brand-new real supplier search on every single tick, silently defeating
 * "search once per risk-crossing event" — the exact cost-control claim
 * ("one coordinator reshop... 300->102 calls") this whole design rests on.
 */
function triggerAltPrefetchIfWarranted(flight: Flight, riskScore: number | undefined): void {
  if (riskScore === undefined) return; // score_percentile_lookup.npy not generated yet — no gate to check, never guessed
  const cfg = getThresholdConfig();
  if (riskScore >= cfg.altCache.prefetchAtOrAboveRiskScore) {
    refreshAltsIfStale(flight);
    refreshGroundIfStale(flight);
  }
}

/**
 * Non-blocking refresh for read paths. A page asking for a flight should render
 * whatever forecast we already hold rather than waiting on a vendor round trip;
 * the next poll picks up the fresh one.
 */
export function refreshIfStale(flight: Flight): void {
  if (!isStale(flight)) return;
  void refreshForecast(flight.id).catch(() => {});
}

const lastEventRescoreAt = new Map<string, number>();

/**
 * Out-of-cycle rescore triggered by a real signal that something about this
 * flight changed right now — a live AviationStack status change classified
 * as an actual disruption kind (app/api/flight-status/route.ts), not the
 * next scheduled batchScorer.ts tick or page-view TTL expiry. This is what
 * config/risk-thresholds.json's forecast.eventRescoreDebounceMs was already
 * defined for but nothing ever called — a status feed that flaps (e.g. a
 * delay estimate ticking up a minute at a time) must not turn into a rescore
 * on every poll, so this debounces per flight, advancing the clock before
 * the refresh even resolves so concurrent callers within the window never
 * pile up requests (same fail-safe shape as thresholdConfig.ts's
 * refreshThresholdConfigIfStale).
 */
export function triggerEventRescore(flightId: string): void {
  const debounceMs = getThresholdConfig().forecast.eventRescoreDebounceMs;
  const last = lastEventRescoreAt.get(flightId) ?? 0;
  if (Date.now() - last < debounceMs) return;
  lastEventRescoreAt.set(flightId, Date.now());
  void refreshForecast(flightId).catch(() => {});
}

export type ReverifyResult = {
  previous: FlightForecast | null;
  current: FlightForecast;
  deltaPct: number;
  modelVersionChanged: boolean;
  configVersionChanged: boolean;
  /** a large probability swing with the SAME model and SAME threshold
   *  config is worth a human look — not proof of a bug, since seat scarcity
   *  and time-to-departure genuinely move between two real calls too. */
  flagged: boolean;
  note: string;
};

const REVERIFY_SWING_THRESHOLD_PCT = 15;

/**
 * Forces an immediate real re-score — bypassing the read path's staleness
 * check, never bypassing the model or fabricating a number — and reports
 * how it compares to what was shown before. This is the audit "reverify"
 * action: confirming the current number is reproducible from the same
 * model and the same real inputs, not just re-displaying a cached one.
 */
export async function reverify(flightId: string): Promise<ReverifyResult | null> {
  const flight = await store.getFlight(flightId);
  if (!flight) return null;
  const previous = flight.forecast ?? null;

  const current = await refreshForecast(flightId);
  if (!current) return null;

  const deltaPct = previous ? current.pct - previous.pct : 0;
  const modelVersionChanged = !!previous && previous.modelVersion !== current.modelVersion;
  const configVersionChanged = !!previous && previous.thresholds.configVersion !== current.thresholds.configVersion;
  const flagged = !!previous && !modelVersionChanged && !configVersionChanged && Math.abs(deltaPct) >= REVERIFY_SWING_THRESHOLD_PCT;

  const note = !previous
    ? 'No prior forecast to compare against — this is the first score.'
    : modelVersionChanged
      ? `Model was retrained between scores (${previous.modelVersion} → ${current.modelVersion}) — a shift is expected.`
      : configVersionChanged
        ? `Threshold config changed between scores (v${previous.thresholds.configVersion} → v${current.thresholds.configVersion}) — bands may differ even if the raw score didn't.`
        : flagged
          ? `${deltaPct > 0 ? '+' : ''}${deltaPct}pp swing on the same model and config — check whether seat scarcity, time-to-departure, or a real signal (e.g. an upstream delay) explains it before trusting this at face value.`
          : `Consistent with the previous score (${deltaPct > 0 ? '+' : ''}${deltaPct}pp) on the same model and config.`;

  return { previous, current, deltaPct, modelVersionChanged, configVersionChanged, flagged, note };
}
