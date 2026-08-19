/**
 * AeroDataBox Flight Alert PUSH.
 *
 * The lane that actually covers this product's real case: a member's ticket
 * bought somewhere else, watched by flight number. Duffel can only tell us
 * about orders we booked ourselves, and this app books none — so without this
 * adapter the webhook path would be architecturally complete and practically
 * inert.
 *
 * Subscription is per flight number:
 *   POST /subscriptions/webhook/FlightByNumber/{number}?useCredits=true
 * with the webhook URL in the body. Notifications cost 1 credit per flight item
 * and are charged when SENT, not when delivered — so an endpoint that is down
 * still burns credits, which is a second reason the staleness watchdog in
 * index.ts matters.
 *
 * ── The payload is a diff, not a status ────────────────────────────────────
 *
 * AeroDataBox pushes `changed` — the list of fields that moved — alongside the
 * current flight object. That shape is why this adapter cannot simply forward a
 * status: most deliveries are gate and belt changes, and treating every
 * delivery as disruption-shaped would start recoveries on flights that are
 * merely boarding from a different stand. Only a change touching status or the
 * departure schedule is passed on; everything else normalises to [] , which the
 * registry correctly records as a handled, unmatched delivery rather than an
 * error.
 */

import { verifySharedSecret } from './verify';
import type { Adapter, NormalisedFlightEvent } from './types';

type AeroFlight = {
  number?: string;
  status?: string;
  departure?: {
    scheduledTime?: { utc?: string; local?: string };
    revisedTime?: { utc?: string; local?: string };
    airport?: { iata?: string };
  };
  arrival?: { scheduledTime?: { utc?: string } };
};

type AeroDelivery = {
  listener_id?: string;
  listenerId?: string;
  id?: string;
  changed?: string[];
  flight?: AeroFlight;
  flights?: AeroFlight[];
};

/**
 * Field changes worth waking the pipeline for.
 *
 * `status` covers the cancellation itself. The schedule fields cover the case
 * that matters almost as much and is easy to miss: a carrier that *moves* a
 * flight reports zero delay against its own new schedule, so the only way to
 * see a reschedule is the shift against what the member booked — which is
 * precisely what `lib/disruptionKind.ts` computes, and why the scheduled time
 * is forwarded rather than the delay alone.
 */
const ACTIONABLE_FIELDS = [/status/i, /departure\.(scheduled|revised)/i, /delay/i];

function isActionable(changed: string[] | undefined): boolean {
  // No `changed` array means we cannot tell what moved. Pass it through rather
  // than drop it: `classify()` is the thing qualified to decide, and a missing
  // diff is not evidence that nothing happened.
  if (!changed || changed.length === 0) return true;
  return changed.some((f) => ACTIONABLE_FIELDS.some((re) => re.test(f)));
}

const epoch = (iso: string | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
};

export const aerodataboxAdapter: Adapter = {
  provider: 'aerodatabox',

  /**
   * No request signing is offered, so the secret lives in the registered URL
   * and is checked from the query string. See verify.ts for an honest account
   * of what that does and does not buy.
   */
  verify(_rawBody, headers) {
    return verifySharedSecret(headers.get('x-zkd-webhook-token'), process.env.WEBHOOK_SHARED_SECRET);
  },

  deliveryId(payload) {
    const d = payload as AeroDelivery;
    const listener = d.listener_id ?? d.listenerId ?? '';
    const flight = d.flight?.number ?? d.flights?.[0]?.number ?? '';
    const revised =
      d.flight?.departure?.revisedTime?.utc ?? d.flight?.departure?.scheduledTime?.utc ?? '';
    // AeroDataBox supplies no delivery id of its own, so one is composed from
    // what identifies this state of this flight. Two genuinely different
    // changes differ in at least one component; a retry of the same change does
    // not. `id` is preferred whenever a payload happens to carry one.
    const composed = `${listener}:${flight}:${d.changed?.join(',') ?? ''}:${revised}`;
    return d.id ?? (composed === ':::' ? null : composed);
  },

  normalise(payload) {
    const d = payload as AeroDelivery;
    if (!isActionable(d.changed)) return [];

    const flights = d.flights ?? (d.flight ? [d.flight] : []);
    const out: NormalisedFlightEvent[] = [];

    for (const f of flights) {
      if (!f.number) continue;
      const scheduled = epoch(f.departure?.scheduledTime?.utc);
      const revised = epoch(f.departure?.revisedTime?.utc);

      out.push({
        flightCode: f.number,
        status: f.status ?? null,
        // The carrier's CURRENT published departure — revised when it has moved,
        // scheduled otherwise. classify() diffs this against what the member
        // booked, which is the only way a reschedule is visible at all.
        scheduledDepartureAt: revised ?? scheduled,
        delayMinutes:
          revised !== null && scheduled !== null ? Math.round((revised - scheduled) / 60_000) : null,
        departureDate: scheduled ? new Date(scheduled).toISOString().slice(0, 10) : undefined,
      });
    }

    return out;
  },
};
