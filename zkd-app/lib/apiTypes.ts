import type { Signals } from './risk';
import type {
  Alt, HotelOpt, CabOpt, CabLeg, Consent, PastFlight, DisruptionResolution, RecoveryTaskPhase,
} from '@/server/domain/types';
import type { RecoveryView } from '@/server/engine/simulation';

export type SourceStatus = 'ok' | 'empty' | 'error';

export type SignalsResponse = {
  signals: Partial<Signals>;
  sources: { weather: SourceStatus; congestion: SourceStatus; rotation: SourceStatus };
};

export type FlightStatusResponse = {
  status: SourceStatus;
  match: null | { flightStatus: string; depDelayMin: number | null; arrDelayMin: number | null };
};

export type AltsResponse = {
  alts: Alt[];
  sources: { duffel: SourceStatus; sabre: SourceStatus };
};

export type HotelsResponse = {
  hotels: HotelOpt[];
  source: SourceStatus;
};

export type ExplainRequest =
  | { kind: 'risk'; flightCode: string; from: string; to: string; pct: number; topFactor: string }
  | { kind: 'alt'; flightCode: string; altCode: string; fare: number; cabin: string };

export type ExplainResponse = { text: string | null };

// --- Domain API (server-authoritative multi-flight/multi-passenger model) ---
export type { DisruptionResolution, RecoveryView };

/** @deprecated superseded by RecoveryView — kept only until WorldProvider.tsx's cutover (see plan step 5/6) so this isn't a breaking change mid-refactor. */
export type DisruptionStateResponse = { detectedAt: number; resolution: DisruptionResolution | null };

export type FlightSummary = {
  id: string; code: string; from: string; to: string; depISO: string; durationMin: number;
  aircraft?: string; terminal?: string;
  riskPct?: number; riskBand?: 'low' | 'mid' | 'high';
  passengerCount: number;
  disruptionPhase: 'none' | 'DECIDING' | 'READY';
  /** present only when the list was filtered by ?passengerId= */
  booking?: { id: string; seat: string; pnr: string; cabin: string };
};

export type FlightDetail = FlightSummary & {
  signals: Signals;
  candidates: { alts: Alt[]; hotels: HotelOpt[]; cabs: CabOpt[]; cabLegs: CabLeg[] };
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
