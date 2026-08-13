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
 * The disruption forecast for a flight.
 *
 * We buy this rather than computing it — there is no local model here to feed,
 * which is why there are no weather/rotation/congestion "signals" on a Flight
 * any more. `thresholds` travels with the probability because a probability
 * without the bar it is judged against cannot be turned into a decision, and
 * that bar moves per flight (see lib/thresholds.ts).
 */
export type FlightForecast = {
  pct: number;
  band: import('@/lib/thresholds').Band;
  tone: Band;
  connectionRisk: number | null;
  confidence: number;
  source: 'lumo' | 'mock';
  thresholds: import('@/lib/thresholds').Thresholds;
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
  /** epoch ms `candidates.alts` was last refreshed from real supplier inventory;
   *  undefined until the first fetch (server/engine/altsCache.ts) */
  altsAsOf?: number;
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

export type RecoveryTaskPhase = 'waiting' | 'choosing' | 'acting' | 'booked' | 'handed';

export type RecoveryTask = {
  id: string;
  disruptionEventId: string;
  flightId: string;
  bookingId: string;
  passengerId: string;
  phase: RecoveryTaskPhase;
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
