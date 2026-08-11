/**
 * The one place this app talks to a network. Mirrors zkd-app's
 * server/domain/types.ts + lib/apiTypes.ts contract — the phone is a plain
 * poller of the same server-authoritative engine every web tab polls, never
 * a participant in deciding anything. See zkd-app/server/engine/simulation.ts
 * for where the real decisions happen.
 */
import { API_BASE_URL } from './config';

export type Consent = 'autopilot' | 'ask';
export type Band = 'low' | 'mid' | 'high';
export type Signals = { weather: number; rotation: number; congestion: number; record: number; slot: number };

export type Alt = {
  id: string; code: string; dep: string; arr: string; cabin: string;
  seats: number; fare: number; ok: boolean; why: string;
};
export type HotelOpt = {
  id: string; name: string; area: string; checkin: string;
  rate: number; extra: number; ok: boolean; why: string; walk: string;
};
export type CabOpt = { id: string; kind: string; seats: number; extra: number; ok: boolean; why: string };
export type CabLeg = { id: string; from: string; to: string; pickup: string; note: string };

export type PastFlight = {
  id: string; code: string; from: string; to: string;
  dep: string; arr: string; dur: string; date: string; exact: string;
  outcome: 'ontime' | 'delayed' | 'cancelled';
  detail: string; recovered?: string;
};

export type FlightSummary = {
  id: string; code: string; from: string; to: string; depISO: string; durationMin: number;
  aircraft?: string; terminal?: string;
  riskPct?: number; riskBand?: Band;
  passengerCount: number;
  disruptionPhase: 'none' | 'DECIDING' | 'READY';
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

export type Passenger = {
  id: string; displayName: string; legalName: string; dob: string; gender: string; nationality: string;
  passport: { number: string; expiry: string; issued: string };
  contact: { email: string; phone: string };
  consent: Consent;
  loyalty: { airline: string; number: string; tier: string }[];
  prefs: { k: string; v: string }[];
  payment: { card: string; method: string };
};

export type PreAuthResponse = {
  flightId: string; passengerId: string; altId: string; hotelId: string; cabId: string; owed: number; grantedAt: number;
} | null;

export type Step = { n: string; d: number; s: string; live?: 'seat' | 'onward' | 'hotel' | 'cab' | 'van' };

export type DisruptionResolution =
  | { kind: 'autopilot' | 'approved'; at: number; altId: string; hotelId: string; cabId: string }
  | { kind: 'handed-over'; at: number };

export type RecoveryView = {
  taskId: string | null;
  flightId: string;
  detectedAt: number;
  phase: 'deciding' | 'waiting' | 'choosing' | 'acting' | 'booked' | 'handed';
  shown: Step[];
  secondsLeft: number;
  chosenAltId: string;
  chosenHotelId: string;
  chosenCabId: string;
  rejectedAltIds: string[];
  owedNow: number;
  note: string | null;
  resolution: DisruptionResolution | null;
};

export type ResolveAction =
  | { kind: 'approve' }
  | { kind: 'hand-over' }
  | { kind: 'browse' }
  | { kind: 'back' }
  | { kind: 'choose'; altId: string }
  | { kind: 'swap-hotel'; hotelId: string }
  | { kind: 'swap-cab'; cabId: string };

async function getJSON<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API_BASE_URL}${path}`);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function postJSON<T>(path: string, body: unknown): Promise<T | null> {
  try {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export const fetchSchedule = (passengerId: string) =>
  getJSON<PassengerScheduleResponse>(`/api/passengers/${passengerId}/schedule`);

export const fetchFlightDetail = (flightId: string) =>
  getJSON<FlightDetail>(`/api/flights/${flightId}`);

export const fetchPassenger = (passengerId: string) =>
  getJSON<Passenger>(`/api/passengers/${passengerId}`);

export const fetchPreAuth = (flightId: string, passengerId: string) =>
  getJSON<PreAuthResponse>(`/api/flights/${flightId}/preauth?passengerId=${encodeURIComponent(passengerId)}`);

export const fetchRecovery = (flightId: string, passengerId: string) =>
  getJSON<RecoveryView>(`/api/disruptions/${flightId}?passengerId=${encodeURIComponent(passengerId)}`);

export async function setConsentRemote(passengerId: string, consent: Consent): Promise<void> {
  try {
    await fetch(`${API_BASE_URL}/api/passengers/${passengerId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ consent }),
    });
  } catch {
    // best-effort — the next schedule poll will show whatever actually took
  }
}

export const resolveTask = (flightId: string, passengerId: string, action: ResolveAction) =>
  postJSON<RecoveryView>(`/api/disruptions/${flightId}/consent`, { passengerId, action });
