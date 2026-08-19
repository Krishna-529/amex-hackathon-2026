/**
 * Duffel — `order.airline_initiated_change_detected`.
 *
 * ── What this covers, and the limit that matters ───────────────────────────
 *
 * Duffel raises this event when an airline changes or cancels a flight on an
 * order. It is exactly the signal this product wants, it costs nothing extra,
 * and `DUFFEL_ACCESS_TOKEN` is already configured for supplier search.
 *
 * **It only fires for orders booked THROUGH Duffel.** Every PNR in this
 * codebase is seeded, standing in for a booking made elsewhere, and booking
 * origination is not built — so as things stand today this adapter will never
 * receive a live event about a real member's ticket.
 *
 * That is not a reason to leave it out. It is the architecturally correct lane
 * the moment the system books anything itself, it is free, and it is the only
 * provider whose *signature* scheme we can exercise for real right now. What it
 * is not is a substitute for AeroDataBox, which watches flight numbers we did
 * not book. Both are wired for that reason.
 *
 * ── Resolving to one of our flights ────────────────────────────────────────
 *
 * A Duffel order carries slices and segments, and the operating flight number
 * lives on a segment. We read the first segment of the first slice — for the
 * single-leg domestic bookings this app models, that is the flight. A
 * multi-slice order would need the changed slice identified, which Duffel gives
 * in the change object; that is left to the point where multi-leg orders
 * actually exist rather than guessed at now.
 */

import { verifyDuffel } from './verify';
import type { Adapter, NormalisedFlightEvent } from './types';

type DuffelEvent = {
  id?: string;
  type?: string;
  idempotency_key?: string;
  created_at?: string;
  live_mode?: boolean;
  data?: {
    object?: {
      id?: string;
      order_id?: string;
      /** the changed itinerary, as the airline now has it */
      slices?: {
        segments?: {
          operating_carrier_flight_number?: string;
          marketing_carrier_flight_number?: string;
          operating_carrier?: { iata_code?: string };
          marketing_carrier?: { iata_code?: string };
          departing_at?: string;
          origin?: { iata_code?: string };
        }[];
      }[];
      /** present when the airline cancelled outright rather than re-timed */
      available_actions?: string[];
    };
  };
};

/**
 * Which Duffel event types are worth acting on.
 *
 * Deliberately a list rather than a prefix match: Duffel emits order events for
 * things that are not disruptions at all, and treating an unrecognised type as
 * a cancellation is exactly the failure that spends money on a flight that is
 * still going to operate.
 */
const ACTIONABLE = new Set(['order.airline_initiated_change_detected']);

export const duffelAdapter: Adapter = {
  provider: 'duffel',

  verify(rawBody, headers) {
    return verifyDuffel(rawBody, headers.get('x-duffel-signature'), process.env.DUFFEL_WEBHOOK_SECRET);
  },

  /**
   * Duffel's own words: "As our system will retry failed events, there can be
   * cases when we will send you duplicate events, in those cases you should use
   * the `idempotency_key` to check for uniqueness." Preferred over `id` for
   * exactly that reason.
   */
  deliveryId(payload) {
    const e = payload as DuffelEvent;
    return e.idempotency_key ?? e.id ?? null;
  },

  normalise(payload) {
    const e = payload as DuffelEvent;
    if (!e.type || !ACTIONABLE.has(e.type)) return [];

    const object = e.data?.object;
    const segment = object?.slices?.[0]?.segments?.[0];
    if (!segment) return [];

    const carrier =
      segment.operating_carrier?.iata_code ?? segment.marketing_carrier?.iata_code ?? '';
    const number =
      segment.operating_carrier_flight_number ?? segment.marketing_carrier_flight_number ?? '';
    if (!carrier || !number) return [];

    const departing = segment.departing_at ? Date.parse(segment.departing_at) : NaN;

    const event: NormalisedFlightEvent = {
      flightCode: `${carrier} ${number}`,
      // Duffel tells us the airline changed the order, not what the departure
      // board says. `classify()` reads the SHIFT between what was booked and
      // what is now scheduled, which is the honest signal here — asserting
      // "cancelled" from an event that also covers a 10-minute re-time would
      // start a recovery on a flight that is still operating.
      status: 'airline_initiated_change',
      scheduledDepartureAt: Number.isNaN(departing) ? null : departing,
      delayMinutes: null,
      supplierOrderId: object?.order_id ?? object?.id,
      departureDate: Number.isNaN(departing)
        ? undefined
        : new Date(departing).toISOString().slice(0, 10),
    };
    return [event];
  },
};
