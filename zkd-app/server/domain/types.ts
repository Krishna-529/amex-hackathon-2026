/**
 * The whole domain, server-side. Nothing here is client-computed any more —
 * a device polling this app's API is a pure viewer of whatever state these
 * types describe, never a participant in deciding it. See
 * server/engine/simulation.ts for the process that actually mutates this
 * data, and server/domain/store.ts for where it lives.
 */

export type Consent = 'autopilot' | 'ask';

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
  candidates: {
    alts: Alt[];
    hotels: HotelOpt[];
    cabs: CabOpt[];
    cabLegs: CabLeg[];
  };
};

export type Booking = {
  id: string;
  flightId: string;
  passengerId: string;
  seat: string;
  pnr: string;
  cabin: string;
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
