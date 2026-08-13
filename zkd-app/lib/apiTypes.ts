import type {
  Alt, HotelOpt, CabOpt, CabLeg, Consent, PastFlight, DisruptionResolution, RecoveryTaskPhase,
  FlightForecast,
} from '@/server/domain/types';
import type { RecoveryView } from '@/server/engine/simulation';
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
};

// --- Domain API (server-authoritative multi-flight/multi-passenger model) ---
export type { DisruptionResolution, RecoveryView, FlightForecast, Offer, SupplierId, SupplierStatus };

export type FlightSummary = {
  id: string; code: string; from: string; to: string; depISO: string; durationMin: number;
  aircraft?: string; terminal?: string;
  /** undefined until the first forecast refresh lands */
  forecast?: FlightForecast;
  passengerCount: number;
  disruptionPhase: 'none' | 'DECIDING' | 'READY';
  /** present only when the list was filtered by ?passengerId= */
  booking?: { id: string; seat: string; pnr: string; cabin: string };
};

export type FlightDetail = FlightSummary & {
  candidates: { alts: Alt[]; hotels: HotelOpt[]; cabs: CabOpt[]; cabLegs: CabLeg[] };
  connectionSlackMinutes: number | null;
  hasHardConstraint: boolean;
  rescheduledToISO?: string;
  bookings: { id: string; passengerId: string; passengerName: string; seat: string; pnr: string }[];
};

export type PassengerScheduleResponse = {
  passenger: { id: string; displayName: string; consent: Consent };
  upcoming: FlightSummary[];
  past: PastFlight[];
};

export type PreAuthRequest = { passengerId: string; altId: string; hotelId: string; cabId: string };
export type PreAuthResponse = {
  flightId: string; passengerId: string; altId: string; hotelId: string; cabId: string; owed: number; grantedAt: number;
} | null;

export type DisruptionOpsTask = {
  passengerId: string; passengerName: string; phase: RecoveryTaskPhase; secondsLeft: number;
  resolution: DisruptionResolution | null;
};
export type DisruptionOpsView = {
  flightId: string; flightCode: string; detectedAt: number; phase: 'DECIDING' | 'READY';
  tasks: DisruptionOpsTask[];
};
