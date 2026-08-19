/**
 * The one shape every provider is flattened into.
 *
 * Duffel talks about orders and airline-initiated changes; AeroDataBox talks
 * about listeners and changed fields; OAG talks about schedule and status
 * events. None of that vocabulary belongs downstream — `lib/disruptionKind.ts`
 * already knows how to turn a carrier status plus a booked departure into a
 * `DisruptionKind`, and it should keep having exactly one input shape.
 *
 * So each adapter's whole job is to produce one of these, and everything after
 * the adapter is provider-agnostic. Adding a fourth vendor is a new file in
 * this directory and a line in the registry — not a change to detection.
 */

export type WebhookProvider = 'duffel' | 'aerodatabox' | 'oag';

/** A flight-status change, as this codebase understands one. */
export type NormalisedFlightEvent = {
  /** IATA flight designator as the provider gave it, e.g. "6E 5231" or "6E5231" */
  flightCode: string;
  /** the carrier's own status string — fed verbatim to classify() */
  status: string | null;
  /** epoch ms of the carrier's currently published departure, when stated */
  scheduledDepartureAt: number | null;
  /** delay against the carrier's own schedule, minutes */
  delayMinutes: number | null;
  /**
   * Set when the provider tells us about a specific ORDER rather than a
   * flight number — Duffel does. Lets us resolve to a booking directly instead
   * of matching on a code that several bookings may share.
   */
  supplierOrderId?: string;
  /** departure date the provider is talking about, ISO yyyy-mm-dd, when stated */
  departureDate?: string;
};

/**
 * The result of handling one delivery.
 *
 * `matched` is deliberately separate from `ok`. A delivery we understood
 * perfectly but which names a flight nobody here has booked is a SUCCESS —
 * subscriptions are per flight number and a code can be reused on a route we
 * do not track. Returning an error for it would make the provider retry
 * forever and would make a healthy feed look broken.
 */
export type DeliveryResult = {
  ok: boolean;
  /** we recognised the flight and acted on it */
  matched: boolean;
  /** a duplicate delivery of something already handled */
  duplicate: boolean;
  detail: string;
};

export type Adapter = {
  provider: WebhookProvider;
  /**
   * Verifies the request came from the provider. Returns a reason on failure
   * rather than a boolean, because "no secret configured" and "signature did
   * not match" need different responses and different log lines — the first is
   * a setup problem, the second is either an attack or a rotated key.
   */
  verify(rawBody: string, headers: Headers): { ok: true } | { ok: false; reason: string };
  /**
   * The provider's own id for this delivery, used for deduplication. Null when
   * the provider does not supply one, in which case the registry falls back to
   * hashing the payload.
   */
  deliveryId(payload: unknown): string | null;
  /**
   * Flattens the payload. Returns [] for events we understand but do not care
   * about — a gate change, a baggage-belt update — which is not an error.
   */
  normalise(payload: unknown): NormalisedFlightEvent[];
};
