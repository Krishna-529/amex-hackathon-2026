/**
 * The whole domain, server-side. Nothing here is client-computed any more —
 * a device polling this app's API is a pure viewer of whatever state these
 * types describe, never a participant in deciding it. See
 * server/engine/simulation.ts for the process that actually mutates this
 * data, and server/domain/store.ts for where it lives.
 */

export type Consent = 'autopilot' | 'ask';

export type Signals = { weather: number; rotation: number; congestion: number; record: number; slot: number };
export type Band = 'low' | 'mid' | 'high';

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
  ok: boolean;
  why: string;
};

export type HotelOpt = {
  id: string; name: string; area: string; checkin: string;
  rate: number; extra: number; ok: boolean; why: string; walk: string;
};

export type CabOpt = { id: string; kind: string; seats: number; extra: number; ok: boolean; why: string };

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
  signals: Signals;        // mock baseline; live/[id] merges real weather/OpenSky signals on top when read
  riskPct?: number;        // computed once by the engine, cached here
  riskBand?: Band;
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
  | { kind: 'handed-over'; at: number };

export type RecoveryTaskPhase = 'waiting' | 'choosing' | 'acting' | 'booked' | 'handed';

export type RecoveryTask = {
  id: string;
  disruptionEventId: string;
  flightId: string;
  bookingId: string;
  passengerId: string;
  phase: RecoveryTaskPhase;
  windowExpiresAt: number;
  chosenAltId: string;
  chosenHotelId: string;
  chosenCabId: string;
  rejectedAltIds: string[];
  shown: Step[];
  note: string | null;
  resolution: DisruptionResolution | null;
};
