/**
 * When a change in risk band is worth interrupting a member.
 *
 * Pure and separate from server/engine/forecast.ts on purpose: this is the rule
 * that decides whether a human's phone buzzes, it is the part most likely to be
 * argued about and retuned, and it should be checkable without a database, a
 * model server or a forecast.
 */
import type { Band } from '@/lib/thresholds';

/** watch < prepare < hold-gate < pre-authorise. */
export const BAND_RANK: Record<Band, number> = {
  watch: 0,
  prepare: 1,
  'hold-gate': 2,
  'pre-authorise': 3,
};

/**
 * Nothing below this is worth a notification.
 *
 * `prepare` is the same band that already gates the alternative pre-fetch
 * (config/risk-thresholds.json's altCache), which makes the promise coherent:
 * the member is only ever told "we are lining up alternatives" at the moment we
 * genuinely start doing it.
 */
export const ALERT_AT: Band = 'prepare';

/**
 * True when `next` is both alert-worthy and strictly worse than the worst the
 * member has already been told about.
 *
 * Strictly worse, because the batch re-scorer (server/engine/batchScorer.ts)
 * re-evaluates every flight on an interval. Without the "strictly", a flight
 * sitting steadily in `hold-gate` would re-send the same warning every cycle.
 * And because it compares against the last NOTIFIED band rather than the last
 * observed one, a score that dips to `prepare` and climbs back to `hold-gate`
 * stays silent — the member already knows it is in hold-gate, and telling them
 * again teaches them to ignore the next one.
 *
 * The deliberate cost: a genuine de-escalation followed by a re-escalation is
 * never re-announced. Recovery from a bad forecast is not urgent news, and
 * silence is the safer error here.
 */
export function crossedUpward(previous: Band | undefined, next: Band): boolean {
  if (BAND_RANK[next] < BAND_RANK[ALERT_AT]) return false;
  return BAND_RANK[next] > BAND_RANK[previous ?? 'watch'];
}
