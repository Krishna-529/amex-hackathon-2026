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
  source: 'internal-ml';
  modelVersion: string;
  /** Percentile rank (0-100) of pct against the real live-realistic score
   *  distribution — see server/engine/riskModel.ts's ModelScore.riskScore
   *  for why this is a rank, not a probability, and never a rescaled pct.
   *  Drives alt-search pre-caching (config/risk-thresholds.json's
   *  altCache.prefetchAtOrAboveRiskScore); pct/band/thresholds still drive
   *  every member-facing banner, unchanged. */
  riskScore?: number;
  /** Real per-feature tree-SHAP contributions from this exact prediction —
   *  see server/engine/riskModel.ts's ModelExplanation. Undefined on
   *  forecasts computed by the batch/interval scorer (no explanation pass
   *  there, see riskModel.ts); present on every on-demand/reverify score,
   *  which is what the audit panel reads. */
  explanation?: import('../engine/riskModel').ModelExplanation;
  /** Which of `explanation`'s historical-rate features are this entity's
   *  own real history vs a population-average cold-start fallback — see
   *  server/engine/riskModel.ts's DataSourceMap. Same on-demand-only
   *  availability as `explanation`. */
  dataSource?: import('../engine/riskModel').DataSourceMap;
  thresholds: import('@/lib/thresholds').Thresholds;
  asOf: number;
};

/**
 * A lightweight point in a flight's prediction history — enough to draw the
 * time-series graph without carrying a full explanation payload on every
 * point (server/engine/forecast.ts appends one on every real compute()).
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
 * Every option is inventory we actually buy.
 *
 * There used to be a second kind, 'carrier-protected', standing for the
 * involuntary re-accommodation the operating carrier owes under DGCA CAR
 * Section 3 Series M Part IV and EU261 Art. 8. It was removed on 2026-08-19,
 * because we have no airline NDC access and therefore never had a real
 * carrier-issued seat to show. What the code did instead was take the cheapest
 * market offer, overwrite its fare to 0 and its seat count to 99, and present
 * the result as the airline's obligation — a fabricated option competing for a
 * member's choice, defaulting autopilot's pick, and feeding 99 imaginary seats
 * into the scarcity term that decides when we warn people.
 *
 * The entitlement itself was never the problem and has not gone away. It is a
 * MONEY CLAIM, not a seat: server/domain/refund.ts computes what the carrier
 * owes and server/ledger/reconciliation.ts tracks whether it ever arrives.
 */
export type AltKind = 'market';

export type Alt = {
  id: string;
  code: string;
  /** local clock string for display, e.g. "18:40" */
  dep: string;
  arr: string;
  /**
   * The same two instants as epoch ms.
   *
   * `dep`/`arr` are rendered in the airport's own zone and cannot be compared
   * or sorted — "06:40" in Delhi and "06:40" in London are not the same moment,
   * and a scorer ranking on arrival needs the moment, not the clock face.
   * Optional because seeded fixtures predate them; anything scoring on time
   * must treat a missing value as unknown rather than as zero.
   */
  departsAt?: number;
  arrivesAt?: number;
  cabin: string;
  seats: number;
  fare: number;
  /** never assume one country's money */
  currency: string;
  /**
   * Set only when `fare` is a CONVERSION rather than the supplier's own number.
   *
   * Carrying the original alongside the converted figure is what makes the
   * conversion honest rather than a silent rewrite: the member can see what was
   * actually quoted, and a settled charge can be reconciled against the quote
   * and the rate that produced it instead of against our arithmetic. See
   * server/fx.ts.
   */
  quoted?: {
    amount: number;
    currency: string;
    rate: number;
    rateAsOf: number;
    rateSource: 'live' | 'fallback' | 'identity';
  };
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

/**
 * A hotel booking the member made themselves.
 *
 * Distinct from `HotelOpt` above, which is a hotel we are OFFERING during a
 * recovery. This is one they have committed to — it has a confirmation, an
 * owner and a price they accepted.
 *
 * `flightId` is null for a stay booked on its own, and set when the stay was
 * arranged because a specific flight broke. That is the only difference between
 * origination and re-accommodation at the storage level.
 */
export type Stay = {
  id: string;
  passengerId: string;
  flightId: string | null;
  /** airport code the city was resolved from — how the search is keyed */
  city: string;
  cityName: string;
  name: string;
  area: string;
  checkin: string;
  checkout: string;
  rooms: number;
  /** total for the stay, in the currency the supplier quoted. Never converted. */
  total: number;
  currency: string;
  refundable: boolean;
  /** epoch ms free cancellation closes; null when the source did not say */
  cancelDeadline: number | null;
  supplier: string;
  /** locally generated — no supplier issues this, same as a flight PNR here */
  reference: string;
  bookedAt: number;
};

/** A ground transfer the member booked. Same shape of decision as a Stay. */
export type Ride = {
  id: string;
  passengerId: string;
  flightId: string | null;
  from: string;
  to: string;
  /** the vehicle class, as the supplier names it */
  kind: string;
  seats: number;
  pickupISO: string;
  total: number;
  currency: string;
  supplier: string;
  reference: string;
  bookedAt: number;
};

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
  /**
   * The instant the member must have ARRIVED by — "I have to be there for the
   * wedding on Saturday". Null when they gave us no deadline.
   *
   * `hasHardConstraint` above says only THAT a late arrival breaks something,
   * which is enough to weight the ranking toward earlier arrivals
   * (server/preferences/presets.ts boosts the arrival criterion 1.5x) but not
   * enough to rule anything out — with only a boolean, an option landing two
   * days after the thing it was supposed to reach still scores, just lower.
   * With a real instant, missing it becomes a HARD RULE
   * (server/pipeline/score.ts's applyHardRules) rather than a penalty a
   * weighted sum can outvote.
   *
   * Invariant, enforced where flights are created: a non-null deadline implies
   * `hasHardConstraint: true`. Stored rather than derived because the whole
   * Flight is JSON-serialised into one Postgres column, so there is nowhere for
   * a getter to live.
   */
  hardDeadlineISO?: string | null;
  /**
   * The symmetric lower bound: the earliest instant a REPLACEMENT flight may
   * depart. "I cannot get to the airport before 6am" / "my meeting only ends at
   * noon". Null when the member gave us no earliest-start.
   *
   * Like `hardDeadlineISO` this is a HARD RULE, not a preference weight: a
   * replacement leaving before the member can physically make it is not a worse
   * option, it is an impossible one, so `applyHardRules`
   * (server/pipeline/score.ts) removes it rather than ranking it low. Also like
   * the deadline, it is stored on the Flight view the pipeline scores against
   * rather than derived, because the whole Flight is JSON-serialised into one
   * Postgres column. Set per-passenger from their JourneyPrefs (see below), so
   * two members on the same physical flight can hold different windows.
   */
  earliestDepartISO?: string | null;
  /** fetched from the forecaster, cached here; undefined until the first refresh */
  forecast?: FlightForecast;
  /** every real forecast this flight has ever received, oldest first, capped
   *  at FORECAST_HISTORY_CAP (server/engine/forecast.ts) — what the audit
   *  graph plots. Undefined until the first compute(), same lazy-init
   *  pattern as `forecast` above. Populated by both on-demand refreshes and
   *  the interval batch re-scorer (server/engine/batchScorer.ts), so points
   *  appear even if nobody views the flight. */
  forecastHistory?: FlightForecastSnapshot[];
  /**
   * The highest risk band the member has already been alerted about.
   *
   * Dedupe for the outbound alert, and it has to be persisted rather than held
   * in memory: the batch re-scorer (server/engine/batchScorer.ts) re-evaluates
   * every flight on an interval, so a flight sitting steadily in `hold-gate`
   * would otherwise re-send the same warning every cycle, and a server restart
   * would start the spam over. Only an UPWARD move past this value notifies —
   * a score that drifts down and back up is not news.
   *
   * Undefined until the first alert, same lazy-init pattern as `forecast`.
   */
  lastNotifiedBand?: import('@/lib/thresholds').Band;
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
  /**
   * What the member actually paid for this ticket, PER TRAVELLER.
   *
   * Optional because seeded PNRs predate it and because a booking made
   * elsewhere may genuinely reach us without a price. Absence is meaningful and
   * must be handled as such: server/domain/refund.ts returns `known: false`
   * rather than a plausible number, because this figure becomes the refund,
   * the refund becomes the delta, and the delta is what the member decides on.
   */
  farePaid?: import('@/server/suppliers/types').Money;
  /**
   * The fare conditions the ticket was sold under. Only consulted when the
   * MEMBER cancels — when the carrier cancels, statutory entitlement overrides
   * fare rules entirely (see refund.ts).
   */
  fareBasis?: import('./refund').FareBasis;
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
  // Hotel and cab are optional add-ons to the pre-authorised plan — the member
  // pre-authorises a replacement SEAT; a hotel/cab only apply when the recovery
  // actually needs an overnight or a transfer. The flight detail screen has no
  // hotel/cab picker, so those arrive null from there.
  hotelId: string | null;
  cabId: string | null;
  owed: number;
  grantedAt: number;
};

/**
 * A member's temporary, per-flight instruction, set before a booked flight is
 * ever disrupted. Deliberately NOT part of the MyCa profile: it applies to this
 * one flight only and is discarded when the flight is done, which is why it is
 * keyed and stored exactly like PreAuthRecord (per flight + passenger) rather
 * than living on the durable Passenger/MyCa profile.
 *
 * Three things the member states up front:
 *  - `earliestDepartISO` — the soonest a replacement may depart (journey start)
 *  - `latestArriveISO`   — the latest it may arrive (journey end); becomes the
 *                          flight's `hardDeadlineISO` for this passenger
 *  - `consent`           — whether rebooking this flight should be fully
 *                          autonomous ('autopilot') or human-in-the-loop
 *                          ('ask'), overriding the member's profile default.
 *                          Null means "use my standing profile consent".
 *
 * Any field may be null: a member can set only a deadline, only a consent mode,
 * or all three. Null is "not stated", never a value.
 */
export type JourneyPrefs = {
  flightId: string;
  passengerId: string;
  earliestDepartISO: string | null;
  latestArriveISO: string | null;
  consent: Consent | null;
  setAt: number;
};

/* ── outcomes ────────────────────────────────────────────────────────────── */

/**
 * Every recovery ends in exactly one of these. No state hangs, and none expires
 * in silence. The older `RecoveryTaskPhase` had no failure state at all, which
 * is why a partial success had nowhere to go.
 */
export type RecoveryOutcome = 'CONFIRMED' | 'RELEASED' | 'ESCALATED' | 'ROLLED_BACK';

/**
 * Per component, not per task — because a partial success is exactly the case
 * where the trip is not one thing.
 *
 * `ROLLED_BACK` and `NOT_ATTEMPTED` must never be merged: "your cab was
 * cancelled" and "we never booked a cab" call for different actions from the
 * member.
 */
export type ComponentStatus =
  | 'CONFIRMED'
  | 'PENDING_MANUAL_RESCUE'
  | 'ROLLED_BACK'
  | 'NOT_ATTEMPTED';

export type ComponentKind = 'payment' | 'flight' | 'hotel' | 'ground';

export type ComponentReport = {
  component: ComponentKind;
  status: ComponentStatus;
  /** A reference the member actually holds. Non-null only when CONFIRMED. */
  reference: string | null;
  /** Plain language, written from the member's side of the screen. */
  detail: string;
};

/* ── money we are owed ───────────────────────────────────────────────────── */

export type RefundClaimStatus = 'pending' | 'partial' | 'settled' | 'denied';

/**
 * A receivable, not a note. When the card fronts a fresh purchase the money is
 * ours until the carrier settles, and canon's *initiated is not completed* rule
 * applies: a claim is never recorded as recovered until it actually is.
 */
export type RefundClaim = {
  id: string;
  originalTicket: string;
  carrier: string;
  memberId: string;
  amountExpected: import('@/server/suppliers/types').Money;
  amountRecovered: import('@/server/suppliers/types').Money;
  status: RefundClaimStatus;
  filedAt: number;
  settledAt: number | null;
  /**
   * Populated on denial. We already computed the entitlement, so we can hand the
   * back office a contestable case rather than a bare rejection to read from
   * scratch.
   */
  contest: { owed: import('@/server/suppliers/types').Money; basis: string } | null;
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
  | { kind: 'autopilot' | 'approved'; at: number; altId: string; hotelId: string | null; cabId: string | null }
  /** the flight moved but still works: no new ticket, only downstream bookings re-timed */
  | { kind: 're-timed'; at: number; hotelId: string | null; cabId: string | null; shiftMinutes: number }
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
   *  four terminal states — the real, audit-grade outcome, independent of
   *  how `phase` renders it. The execution plane (zkd-execute) is the real
   *  producer of this value via its own saga result; this branch doesn't
   *  include that plane, so the type is declared locally rather than
   *  imported from it. */
  terminal: ('CONFIRMED' | 'RELEASED' | 'ESCALATED' | 'ROLLED_BACK') | null;
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
  // Hotel and cab are optional parts of a recovery plan — a same-day reseat
  // needs neither. Null when the plan has no overnight/transfer leg.
  chosenHotelId: string | null;
  chosenCabId: string | null;
  rejectedAltIds: string[];
  shown: Step[];
  note: string | null;
  resolution: DisruptionResolution | null;
};
