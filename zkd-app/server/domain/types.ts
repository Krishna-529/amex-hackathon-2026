/**
 * The whole domain, server-side. Nothing here is client-computed any more —
 * a device polling this app's API is a pure viewer of whatever state these
 * types describe, never a participant in deciding it. See
 * server/engine/simulation.ts for the process that actually mutates this
 * data, and server/domain/store.ts for where it lives.
 */

export type Consent = 'autopilot' | 'ask';

/**
 * A card member's login. Kept separate from `Passenger` rather than as a field
 * on it: `GET /api/passengers/[id]` returns the whole Passenger object over the
 * wire, so a passwordHash field there is one un-audited response away from
 * leaking. Keyed by email (lowercased) in the store, since a Passenger's
 * `contact.email` is masked display data and the wrong thing to authenticate
 * against.
 */
export type Credential = { passengerId: string; email: string; passwordHash: string };

/** UI tone, kept to three so the existing colour classes still apply. */
export type Band = 'low' | 'mid' | 'high';

/**
 * The disruption forecast for a flight, from the real gradient-boosted
 * model in zkd-risk-model/ (server/engine/riskModel.ts), not a vendor call
 * or a mock. `thresholds` travels with the probability because a
 * probability without the bar it is judged against cannot be turned into a
 * decision, and that bar moves per flight (see lib/thresholds.ts).
 *
 * There is no 'mock' source any more: when the model is unreachable or a
 * flight cannot be scored, refreshForecast returns null and the caller
 * shows "not available" — never a fabricated number labeled as real.
 */
export type FlightForecast = {
  pct: number;
  band: import('@/lib/thresholds').Band;
  tone: Band;
  connectionRisk: number | null;
  confidence: number;
  /** 'neighbor-smoothed' means this number was interpolated from nearby
   *  flights between real model calls, not freshly scored — see
   *  server/engine/neighborSmoothing.ts. Always shown distinctly in the UI
   *  (ForecastAudit.tsx), never presented as equivalent to a real score. */
  source: 'internal-ml' | 'neighbor-smoothed';
  modelVersion: string;
  /** Percentile rank (0-100) of pct against the real live-realistic score
   *  distribution — see server/engine/riskModel.ts's ModelScore.riskScore
   *  for why this is a rank, not a probability, and never a rescaled pct.
   *  Drives alt-search pre-caching (config/risk-thresholds.json's
   *  altCache.prefetchAtOrAboveRiskScore); pct/band/thresholds still drive
   *  every member-facing banner, unchanged. */
  riskScore?: number;
  /** Real per-feature tree-SHAP contributions from this exact prediction —
   *  see server/engine/riskModel.ts's ModelExplanation. Only ever produced
   *  by an on-demand/reverify score (no explanation pass on the batch/
   *  smoothing paths); applyScore() carries the last real explanation
   *  forward onto every forecast that doesn't have its own, so most of a
   *  flight's lifecycle still has real SHAP material behind `topReason`
   *  below, not just the moment right after a reverify. */
  explanation?: import('../engine/riskModel').ModelExplanation;
  /** Which of `explanation`'s historical-rate features are this entity's
   *  own real history vs a population-average cold-start fallback — see
   *  server/engine/riskModel.ts's DataSourceMap. Carried forward the same
   *  way as `explanation` above. */
  dataSource?: import('../engine/riskModel').DataSourceMap;
  thresholds: import('@/lib/thresholds').Thresholds;
  asOf: number;
  /** Always present — a plain-language top reason for this prediction, for
   *  every forecast (real or smoothed), computed synchronously and
   *  deterministically (server/engine/topReason.ts) so a member never sees
   *  a blank "why," regardless of whether the optional Gemini re-phrasing
   *  (app/api/explain) is reachable. */
  topReason: TopReason;
};

export type TopReasonKind = 'model-shap' | 'neighbor-context' | 'generic';

/** See server/engine/topReason.ts's deriveTopReason(). */
export type TopReason = {
  kind: TopReasonKind;
  /** Always non-empty. Never depends on an external LLM call succeeding. */
  text: string;
  /** Raw SHAP feature name, present only when kind === 'model-shap' — lets
   *  the client optionally ask /api/explain to re-phrase this exact factor. */
  featureKey?: string;
};

/**
 * A lightweight point in a flight's prediction history — enough to draw the
 * time-series graph without carrying a full explanation payload on every
 * point (server/engine/forecast.ts appends one on every real or smoothed
 * compute()).
 */
export type FlightForecastSnapshot = {
  pct: number;
  /** 0-100 percentile rank, see FlightForecast.riskScore — what the
   *  "Prediction history" chart plots. Absent on points recorded before
   *  this field existed; the chart skips those as a gap, same as any other
   *  missing model run. */
  riskScore?: number;
  band: import('@/lib/thresholds').Band;
  confidence: number;
  modelVersion: string;
  /** 'internal-ml' | 'neighbor-smoothed' — absent on points recorded before
   *  this field existed; the chart treats a missing value as 'internal-ml',
   *  same lazy-migration pattern `riskScore` above already uses. Drives the
   *  real-vs-estimated marker distinction in ForecastAudit.tsx. */
  source?: 'internal-ml' | 'neighbor-smoothed';
  asOf: number;
};

export type Passenger = {
  id: string;
  displayName: string;
  legalName: string;
  dob: string;
  gender: string;
  nationality: string;
  passport: { number: string; expiry: string; issued: string };
  contact: { email: string; phone: string };
  consent: Consent;
  loyalty: { airline: string; number: string; tier: string }[];
  prefs: { k: string; v: string }[];
  payment: { card: string; method: string };
};

/**
 * 'carrier-protected' is the involuntary re-accommodation the operating
 * carrier owes under DGCA CAR Section 3 Series M Part IV and EU261 Art. 8.
 * Both attach PER TICKET, so it covers every traveller on the PNR whatever
 * the open market has left — it is owed, not bought, and never expires the
 * way a fare quote does. 'market' is inventory we actually buy, which is why
 * it is the only kind seat-constrained by what a party can fit into.
 */
export type AltKind = 'carrier-protected' | 'market';

export type Alt = {
  id: string;
  code: string;
  dep: string;
  arr: string;
  /** The same two instants as epoch ms. `dep`/`arr` are rendered in the
   *  airport's own zone and cannot be compared or sorted — "18:40" in Delhi
   *  and "18:40" in London are not the same moment, and a scorer ranking on
   *  arrival needs the moment, not the clock face (server/pipeline/score.ts).
   *  Optional because seeded fixtures predate these fields — anything
   *  scoring on time must treat a missing value as unknown, never as 0
   *  (0 would rank as "arrives at the epoch," i.e. best possible). */
  departsAt?: number;
  arrivesAt?: number;
  cabin: string;
  seats: number;
  fare: number;
  /** never assume one country's money */
  currency: string;
  /** epoch ms the supplier stops honouring this price; null when unknown.
   *  This is what the member's decision window is derived from. */
  expiresAt: number | null;
  /** which inventory source it came from, so it can be re-checked before spend */
  supplier?: string;
  supplierOfferId?: string;
  kind: AltKind;
  /** POLICY only — cabin entitlement, per-transaction cap. Party-independent.
   *  See server/domain/altsForParty.ts for the party-aware `ok` shown to a member. */
  ok: boolean;
  why: string;
};

export type HotelOpt = {
  id: string; name: string; area: string; checkin: string;
  rate: number; extra: number; currency: string; ok: boolean; why: string; walk: string;
};

export type CabOpt = {
  id: string; kind: string; seats: number; extra: number; currency: string; ok: boolean; why: string;
};

export type CabLeg = { id: string; from: string; to: string; pickup: string; note: string };

export type Flight = {
  id: string;
  code: string;
  from: string;
  to: string;
  depISO: string;         // absolute instant — the server owns the clock now, not "now + minutes"
  durationMin: number;
  aircraft?: string;
  terminal?: string;
  /** true once the carrier moves the flight — the booked time above stays put so
   *  a reschedule stays visible as the diff between the two */
  rescheduledToISO?: string;
  /** minutes of slack before the onward leg is missed; null when there is none */
  connectionSlackMinutes: number | null;
  /** a late arrival breaks something that matters — an onward leg, a commitment */
  hasHardConstraint: boolean;
  /** fetched from the forecaster, cached here; undefined until the first refresh */
  forecast?: FlightForecast;
  /** every real forecast this flight has ever received, oldest first, capped
   *  at FORECAST_HISTORY_CAP (server/engine/forecast.ts) — what the audit
   *  graph plots. Undefined until the first compute(), same lazy-init
   *  pattern as `forecast` above. Populated by both on-demand refreshes and
   *  the interval batch re-scorer (server/engine/batchScorer.ts), so points
   *  appear even if nobody views the flight. */
  forecastHistory?: FlightForecastSnapshot[];
  /** epoch ms `candidates.alts` was last refreshed from real supplier inventory;
   *  undefined until the first fetch (server/engine/altsCache.ts) */
  altsAsOf?: number;
  /** epoch ms `candidates.hotels`/`cabs`/`cabLegs` were last refreshed;
   *  undefined until the first fetch (server/engine/groundCache.ts) */
  groundAsOf?: number;
  candidates: {
    alts: Alt[];
    hotels: HotelOpt[];
    cabs: CabOpt[];
    cabLegs: CabLeg[];
  };
};

export type TravellerType = 'adult' | 'child' | 'infant';

/**
 * A person on a ticket. The card member is also a Traveller; only the card
 * member additionally has a Credential and the authority to consent to spend.
 * Companions get a full record because an airline will not reissue a ticket
 * without one — not because they have an account.
 *
 * Entities referenced by id, not inlined on Booking: the same person (e.g. the
 * card member) can appear on more than one Booking within one itinerary, and a
 * Booking is polled every 4-5s — an inline array would duplicate full passport
 * records on every poll and let the copies drift the first time either is edited.
 */
export type Traveller = {
  id: string;
  /** set only when this traveller is also a card member with a login */
  passengerId: string | null;
  displayName: string;
  legalName: string;
  dob: string;
  gender: string;
  nationality: string;
  passport: { number: string; expiry: string; issued: string };
  contact: { email: string; phone: string };
  type: TravellerType;
  loyalty: { airline: string; number: string; tier: string }[];
};

export type SeatAssignment = { travellerId: string; seat: string };

export type Booking = {
  id: string;
  flightId: string;
  /** the CARD MEMBER who owns this PNR — who is asked, who consents, who pays.
   *  Meaning unchanged from before parties existed; it is no longer "the only
   *  person flying". */
  passengerId: string;
  /** the card member's own seat, kept because every member-facing surface
   *  shows exactly this; the party's seats live in `seats`. */
  seat: string;
  pnr: string;
  cabin: string;
  /** cardholder first. Party size is `travellerIds.length` — never stored
   *  separately, so it can never drift from the list itself. */
  travellerIds: string[];
  seats: SeatAssignment[];
  itineraryId?: string;
  legIndex?: number;       // position within that itinerary, 0-based
};

/** A passenger's connected trip, e.g. MAA→DEL→LHR — two Bookings, one Itinerary. */
export type Itinerary = {
  id: string;
  passengerId: string;
  bookingIds: string[];    // ordered by legIndex
};

export type PreAuthRecord = {
  flightId: string;
  passengerId: string;
  altId: string;
  hotelId: string;
  cabId: string;
  owed: number;
  grantedAt: number;
};

export type PastFlight = {
  id: string; code: string; from: string; to: string;
  dep: string; arr: string; dur: string; date: string;
  outcome: 'ontime' | 'delayed' | 'cancelled';
  detail: string; exact: string; recovered?: string;
};

export type Step = { n: string; d: number; s: string; live?: 'seat' | 'onward' | 'hotel' | 'cab' | 'van' };

export type DisruptionEvent = {
  id: string;
  flightId: string;
  detectedAt: number;       // the one canonical clock every viewer reads
  phase: 'DECIDING' | 'READY';
  decidedAt?: number;
};

export type DisruptionResolution =
  | { kind: 'autopilot' | 'approved'; at: number; altId: string; hotelId: string; cabId: string }
  /** the flight moved but still works: no new ticket, only downstream bookings re-timed */
  | { kind: 're-timed'; at: number; hotelId: string; cabId: string; shiftMinutes: number }
  | { kind: 'handed-over'; at: number };

/**
 * The MEMBER-FACING phase — a deliberately simplified projection of the real
 * 8-phase / 4-terminal-state model in zkd-shared (WATCH..CLAIM, CONFIRMED/
 * RELEASED/ESCALATED/ROLLED_BACK — see 03-action-policy.md §1/§7). A
 * member's screen doesn't need to distinguish RE-CHECK from ACT; it needs
 * "waiting on you", "working on it", "done", or "handed to a human". The
 * authoritative 4-way outcome lives in `RecoveryTask.terminal` below, set
 * from the real Temporal saga's result — this field is presentation, not
 * the source of truth.
 *
 * No 'released' value here even though zkd-shared's TerminalState has
 * RELEASED (03-action-policy.md §7 condition 5, "forecast decays below the
 * hold gate"): nothing in this build monitors an active hold's forecast
 * over time to trigger it — that's a genuine, documented gap (see
 * documentation/architecture/execution-plane.md), not a state worth typing
 * here with no producer.
 */
export type RecoveryTaskPhase = 'waiting' | 'choosing' | 'acting' | 'booked' | 'handed';

export type RecoveryTask = {
  id: string;
  disruptionEventId: string;
  flightId: string;
  bookingId: string;
  passengerId: string;
  phase: RecoveryTaskPhase;
  /** null while still in flight; set once the recovery reaches one of the
   *  four terminal states (zkd-shared's TerminalState) — the real,
   *  audit-grade outcome, independent of how `phase` renders it. */
  terminal: import('zkd-shared').TerminalState | null;
  /** from the planning graph's classification (03-action-policy.md §2.1) —
   *  a reschedule the connection survives needs no new seat, only a hotel/
   *  ground re-time, so this decides which DisruptionResolution kind gets
   *  built once consent (or silence) resolves the task. */
  needsRebooking: boolean;
  /** how many travellers this PNR covers — derived once at task creation from
   *  the Booking, since the Booking itself is the source of truth throughout. */
  partySize: number;
  /** derived from the chosen offer's expiry, not a fixed constant. 0 when there
   *  was too little time to ask at all and consent tier decided alone. */
  windowExpiresAt: number;
  /** what bounded the window, so the UI can say why it is that long */
  windowBoundBy: 'offer-expiry' | 'check-in' | 'ceiling' | 'floor';
  chosenAltId: string;
  chosenHotelId: string;
  chosenCabId: string;
  rejectedAltIds: string[];
  shown: Step[];
  note: string | null;
  resolution: DisruptionResolution | null;
};
