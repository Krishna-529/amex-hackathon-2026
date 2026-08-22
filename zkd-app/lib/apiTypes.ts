import type {
  Alt, HotelOpt, CabOpt, CabLeg, Consent, PastFlight, DisruptionResolution, RecoveryTaskPhase,
  FlightForecast, FlightForecastSnapshot, TravellerType, Stay,
} from '@/server/domain/types';
import type { PartyAlt } from '@/server/domain/altsForParty';
import type { PartyCost } from '@/server/domain/pricing';
import type { RefundEstimate } from '@/server/domain/refund';
export type { RefundEstimate };
import type { ReverifyResult } from '@/server/engine/forecast';
export type { ReverifyResult };
import type { RecoveryView } from '@/server/engine/simulation';
export type { RecoveryView };
import type { Classification } from './disruptionKind';
import type { CareItem } from './entitlement';
import type { Jurisdiction } from '@/server/airportDirectory';
import type { Offer, SupplierId, SupplierStatus } from '@/server/suppliers/types';

export type SourceStatus = 'ok' | 'empty' | 'error';

export type FlightStatusResponse = {
  status: SourceStatus;
  match: null | {
    flightStatus: string;
    depDelayMin: number | null;
    arrDelayMin: number | null;
    depScheduledAt: number | null;
    depEstimatedAt: number | null;
    arrScheduledAt: number | null;
  };
  /** what kind of disruption this is, measured against what the member booked */
  classification: Classification | null;
};

export type AltsResponse = {
  alts: Alt[];
  offers: Offer[];
  seatsAvailable: number;
  sources: Record<SupplierId, SupplierStatus>;
};

export type HotelsResponse = {
  hotels: HotelOpt[];
  source: SourceStatus;
};

export type ExplainRequest =
  | { kind: 'risk'; flightCode: string; from: string; to: string; pct: number; topFactor: string }
  | { kind: 'alt'; flightCode: string; altCode: string; fare: number; cabin: string };

export type ExplainResponse = { text: string | null };

/** Re-checking a chosen offer at the moment of spend, before anything is ticketed. */
export type RevalidateRequest = { offerId: string; candidates: Offer[] };

export type RevalidateResponse = {
  state: 'available' | 'price-changed' | 'switched' | 'gone' | 'unknown';
  offer: Offer | null;
  switchedFrom: string | null;
  message: string;
};

/** Duty of care owed on this route, under whichever regime governs it. */
export type CareResponse = {
  jurisdiction: Jurisdiction;
  bundleName: string;
  citation: string;
  owed: CareItem[];
  /** banded cash compensation in the regime's OWN currency, never converted;
   *  null where the regime encodes no banded figure (not the same as zero) */
  compensation: { amount: number; currency: string } | null;
  /** how far to trust the numbers above — none are 'verified' today */
  evidenceTier: 'verified' | 'assumed' | 'deck';
};

// --- Domain API (server-authoritative multi-flight/multi-passenger model) ---
export type {
  DisruptionResolution, FlightForecast, FlightForecastSnapshot, Offer, SupplierId, SupplierStatus,
  PartyAlt, PartyCost,
};

export type FlightSummary = {
  id: string; code: string; from: string; to: string; depISO: string; durationMin: number;
  aircraft?: string; terminal?: string;
  /** undefined until the first forecast refresh lands */
  forecast?: FlightForecast;
  /** tickets, not PNRs — a single booking can cover a party */
  passengerCount: number;
  disruptionPhase: 'none' | 'DECIDING' | 'READY';
  /** present only for the signed-in viewer's own booking on this flight */
  booking?: {
    id: string; seat: string; pnr: string; cabin: string; partySize: number;
    /** names and seats only — companion passports are never sent to the client */
    travellers: { id: string; displayName: string; type: TravellerType; seat: string }[];
  };
};

export type FlightDetail = FlightSummary & {
  /** alts are projected through altsForParty for the VIEWER's own party size —
   *  no party-fit logic reaches the client at all */
  candidates: { alts: PartyAlt[]; hotels: HotelOpt[]; cabs: CabOpt[]; cabLegs: CabLeg[] };
  /**
   * What the member gets back if this flight cancels — the other half of the
   * price. Null when the viewer has no booking on this flight; `known: false`
   * inside it when we have no record of the fare they paid, which the UI must
   * show as "unknown" and never as zero. See server/domain/refund.ts.
   */
  refund: RefundEstimate | null;
  connectionSlackMinutes: number | null;
  hasHardConstraint: boolean;
  /** the instant the member said they must have arrived by, if they gave one —
   *  shown back to them so a commitment they typed at booking is visibly
   *  recorded, and enforced as a hard rule in rebooking */
  hardDeadlineISO?: string | null;
  rescheduledToISO?: string;
  /** every real score this flight has received, oldest first — what the
   *  audit graph plots. Empty until the first refresh/reverify/batch tick. */
  forecastHistory: FlightForecastSnapshot[];
  /** the viewer's own row only, never a co-passenger's */
  bookings: { id: string; passengerId: string; passengerName: string; seat: string; pnr: string; partySize: number }[];
};

export type PassengerScheduleResponse = {
  passenger: { id: string; displayName: string; consent: Consent };
  upcoming: FlightSummary[];
  past: PastFlight[];
  /** Hotels the member booked themselves. Carried on the schedule rather than
   *  a separate endpoint so "my trips" is one request — and because a stay the
   *  member cannot see is a booking they have no reason to believe happened. */
  stays: Stay[];
};

/** passengerId comes from the session, never the body — see server/auth/guard.ts.
 *  Only the alternative is required: hotel/cab are optional add-ons and are null
 *  when the member pre-authorises from a screen with no hotel/cab picker. */
export type PreAuthRequest = { altId: string; hotelId: string | null; cabId: string | null };
export type PreAuthResponse = {
  flightId: string; passengerId: string; altId: string; hotelId: string | null; cabId: string | null; owed: number; grantedAt: number;
} | null;

/** The member's temporary, per-flight journey window + consent choice. Every
 *  field optional: a member may set only a deadline, only a consent mode, etc.
 *  `consent: null` means "use my standing profile consent". */
export type JourneyPrefsRequest = {
  earliestDepartISO?: string | null;
  latestArriveISO?: string | null;
  consent?: 'autopilot' | 'ask' | null;
};
export type JourneyPrefsResponse = {
  flightId: string;
  passengerId: string;
  earliestDepartISO: string | null;
  latestArriveISO: string | null;
  consent: 'autopilot' | 'ask' | null;
  setAt: number;
  /** anything we could not read or had to drop, in the member's words */
  notes: string[];
} | null;

/** One turn of the "tell us what matters" chat, as the client remembers and
 *  replays it — the server (server/preferences/intent.ts) stays stateless, so
 *  this history lives only in the browser tab for the length of one flight's
 *  conversation. `assistant` text is whatever the member actually saw said
 *  back to them (a restated instruction, a clarifying question, or the
 *  "could not read that" fallback), not raw model output — see
 *  components/IntentChat.tsx. */
export type IntentHistoryTurn = { role: 'member' | 'assistant'; text: string };

export type IntentRequest = { text: string; history: IntentHistoryTurn[] };

/** What POST /api/flights/[id]/intent hands back. The route applies nothing —
 *  this is a preview the member confirms or discards; nothing here is
 *  written anywhere until /api/flights/[id]/preauth. */
export type IntentResponse = {
  understood: boolean;
  message?: string;
  restated?: string | null;
  confidence?: 'high' | 'medium' | 'low';
  diff?: {
    changes: string[];
    clamped: string[];
    unsupported: { asked: string; why: string }[];
    clarifyingQuestion: string | null;
  };
  removed?: { id: string; code: string; rule: string }[];
  options?: {
    id: string; code: string; dep: string; arr: string; partyFare: number; ok: boolean; why: string;
  }[];
};

export type DisruptionOpsTask = {
  passengerId: string; passengerName: string; phase: RecoveryTaskPhase; secondsLeft: number;
  partySize: number; chosenAltCode: string | null; owedNow: number;
  resolution: DisruptionResolution | null;
};
export type DisruptionOpsView = {
  flightId: string; flightCode: string; detectedAt: number; phase: 'DECIDING' | 'READY';
  tasks: DisruptionOpsTask[];
};
