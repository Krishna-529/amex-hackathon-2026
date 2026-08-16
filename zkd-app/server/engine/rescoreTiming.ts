/**
 * Shared time-to-departure math for the adaptive interval strategy.
 *
 * Two independent problems both key off "how close is this flight to
 * departing": how urgently it needs re-scoring (batchScorer.ts's tier) and
 * how fast its cached alternatives go stale (altsCache.ts's/groundCache.ts's
 * TTL). Before this, both were flat constants shared by every flight
 * regardless of departure — a flight 3 days out and a flight 45 minutes out
 * were rescored and re-searched on the exact same clock, which is neither
 * cheap for the far-out case nor safe for the near-in one. See
 * documentation/design/01-prediction-model.md §4: the adaptive-threshold
 * bands already scale with urgency for the same reason; this applies the
 * same idea to *when we look*, not just *what we do once we look*.
 */
import type { ThresholdConfig } from '@/lib/thresholdConfig';
import type { Flight } from '../domain/types';

export function minutesToDeparture(flight: Flight, now: number = Date.now()): number {
  return (new Date(flight.depISO).getTime() - now) / 60_000;
}

export type RescoreTier = 'critical' | 'standard' | 'dormant';

/**
 * Which cadence a flight belongs to right now — re-evaluated fresh on every
 * tick of every tier's loop (batchScorer.ts), so a flight migrates tiers
 * automatically as departure approaches or its last-known band changes.
 * There is no separate promotion/demotion state to keep in sync; the
 * function is pure and stateless.
 *
 * 'critical': already at hold-gate/pre-authorise (the bands where the
 * member may be asked to pre-authorise, or we're already holding backup
 * options) OR inside criticalWindowMinutes of departure — these are the
 * flights where a probability swing has the least runway left to be caught
 * and acted on before the carrier actually files.
 *
 * 'dormant': more than dormantWindowMinutes out AND still at watch (or never
 * scored at all) — no risk signal has appeared yet and there's no urgency,
 * so there is no reason to spend a Lambda invocation on it every 10 minutes.
 * Deliberately does NOT cover a never-scored flight close to departure: a
 * brand-new booking should get its first real score promptly, not wait out
 * a dormant-tier cadence for a band that was never actually measured.
 *
 * Everything else stays on the standard cadence — today's unchanged default.
 */
export function tierFor(flight: Flight, cfg: ThresholdConfig, now: number = Date.now()): RescoreTier {
  const ttd = minutesToDeparture(flight, now);
  const band = flight.forecast?.band;
  if (band === 'hold-gate' || band === 'pre-authorise' || ttd <= cfg.forecast.criticalWindowMinutes) {
    return 'critical';
  }
  if ((band === undefined || band === 'watch') && ttd > cfg.forecast.dormantWindowMinutes) {
    return 'dormant';
  }
  return 'standard';
}

/**
 * Scales altCache.ttlMs down as departure approaches: inventory (seat
 * counts, fares) genuinely churns faster close in, so the same absolute
 * staleness is a bigger real gap 45 minutes before departure than it is 2
 * days out. Same multiplicative-factor pattern lib/thresholds.ts already
 * uses for scarcity/urgency/criticality, applied here to cache freshness
 * instead of action bands, rather than inventing a second design language.
 * Floored at altCache.ttlFloorMs so a very-close-in flight can't be driven
 * to an effectively-zero TTL that would defeat the in-flight-request dedup's
 * purpose (every scoring tick re-triggering a real supplier search).
 */
export function effectiveAltTtlMs(flight: Flight, cfg: ThresholdConfig, now: number = Date.now()): number {
  const ttd = minutesToDeparture(flight, now);
  const factor =
    ttd <= cfg.altCache.urgentWindowMinutes
      ? cfg.altCache.urgentTtlFactor
      : ttd <= cfg.altCache.nearWindowMinutes
        ? cfg.altCache.nearTtlFactor
        : ttd <= cfg.altCache.approachingWindowMinutes
          ? cfg.altCache.approachingTtlFactor
          : 1;
  return Math.max(cfg.altCache.ttlFloorMs, Math.round(cfg.altCache.ttlMs * factor));
}
