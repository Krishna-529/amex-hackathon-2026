/**
 * The one place this app talks to a network. Mirrors zkd-app's
 * server/domain/types.ts + lib/apiTypes.ts contract — the phone is a plain
 * poller of the same server-authoritative engine every web tab polls, never
 * a participant in deciding anything. See zkd-app/server/engine/simulation.ts
 * for where the real decisions happen.
 */
import { API_BASE_URL } from './config';

export type Consent = 'autopilot' | 'ask';
/** UI tone. The forecast's own band is finer-grained; this is what colours things. */
export type Band = 'low' | 'mid' | 'high';

/**
 * The disruption forecast, exactly as the server sends it. There are no local
 * "signals" any more — the probability is bought from a vendor, and the phone is
 * a viewer of that number rather than a second place it gets computed.
 */
export type FlightForecast = {
  pct: number;
  band: 'watch' | 'prepare' | 'hold-gate' | 'pre-authorise';
  tone: Band;
  connectionRisk: number | null;
  confidence: number;
  source: 'lumo' | 'mock';
  thresholds: {
    prepare: number; holdGate: number; preAuthorise: number;
    inputs: { seatsAvailable: number; minutesToDeparture: number; hasHardConstraint: boolean; confidence: number };
  };
  asOf: number;
};

export type Alt = {
  id: string; code: string; dep: string; arr: string; cabin: string;
  seats: number; fare: number; currency: string; expiresAt: number | null;
  /** 'carrier-protected' is owed to the whole party under DGCA/EU261; 'market'
   *  is bought and constrained by how many can actually fit */
  kind?: 'carrier-protected' | 'market';
  /** whether this seats the whole party — undefined on older cached responses */
  fitsParty?: boolean;
  /** total for the whole party; falls back to `fare` when a single traveller */
  partyFare?: number;
  ok: boolean; why: string;
};
export type HotelOpt = {
  id: string; name: string; area: string; checkin: string;
  rate: number; extra: number; currency: string; ok: boolean; why: string; walk: string;
};
export type CabOpt = { id: string; kind: string; seats: number; extra: number; currency: string; ok: boolean; why: string };
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
  /** undefined until the server's first forecast refresh lands */
  forecast?: FlightForecast;
  /** tickets, not PNRs — a single booking can cover a party */
  passengerCount: number;
  disruptionPhase: 'none' | 'DECIDING' | 'READY';
  booking?: {
    id: string; seat: string; pnr: string; cabin: string;
    partySize?: number;
    travellers?: { id: string; displayName: string; type: string; seat: string }[];
  };
};

export type FlightDetail = FlightSummary & {
  candidates: { alts: Alt[]; hotels: HotelOpt[]; cabs: CabOpt[]; cabLegs: CabLeg[] };
  bookings: { id: string; passengerId: string; passengerName: string; seat: string; pnr: string; partySize?: number }[];
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
  /** total window length, so a progress bar has a denominator */
  windowSeconds: number;
  /** what bounded it — the supplier's offer expiry, check-in, or the ceiling */
  windowBoundBy: 'offer-expiry' | 'check-in' | 'ceiling' | 'floor';
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

// `credentials: 'include'` is explicit rather than assumed: React Native's
// fetch runs over the platform's native HTTP stack (OkHttp on Android,
// NSURLSession on iOS), which does keep a cookie jar by default, but the web
// fetch spec's default is 'same-origin' — being explicit here means this
// keeps working even if that default assumption ever changes upstream.
async function getJSON<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API_BASE_URL}${path}`, { credentials: 'include' });
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
      credentials: 'include',
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Hand this device's Expo push token to the server so it can reach the phone
 * when the app is closed.
 *
 * Session-bound on the server (app/api/devices/route.ts binds the token to the
 * SESSION's passenger, never a body-supplied id), so this must run AFTER
 * sign-in — before it, there is no session to attach to and the call 401s.
 */
export async function registerDevice(token: string): Promise<boolean> {
  return (await postJSON<{ ok: boolean }>('/api/devices', { token })) !== null;
}

export type MeResponse = { id: string; displayName: string; consent: Consent };

/** Empty on failure — same "not signed in" shape whether the network failed
 *  or the credentials were wrong, so the login screen shows one honest error. */
export async function login(email: string, password: string): Promise<MeResponse | { error: string }> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) return { error: json?.error ?? 'Something went wrong signing you in.' };
    return json as MeResponse;
  } catch {
    return { error: 'Could not reach the server. Check your connection and try again.' };
  }
}

export async function logout(): Promise<void> {
  try {
    await fetch(`${API_BASE_URL}/api/auth/logout`, { method: 'POST', credentials: 'include' });
  } catch {
    // best-effort — the app clears local state regardless
  }
}

export const fetchMe = () => getJSON<MeResponse>('/api/auth/me');

// None of these carry a passenger id any more — the session cookie set by
// login() IS the passenger, on every one of these requests, exactly as the
// web app's server/auth/guard.ts enforces it.

export const fetchSchedule = (passengerId: string) =>
  getJSON<PassengerScheduleResponse>(`/api/passengers/${passengerId}/schedule`);

export const fetchFlightDetail = (flightId: string) =>
  getJSON<FlightDetail>(`/api/flights/${flightId}`);

export const fetchPassenger = (passengerId: string) =>
  getJSON<Passenger>(`/api/passengers/${passengerId}`);

export const fetchPreAuth = (flightId: string) =>
  getJSON<PreAuthResponse>(`/api/flights/${flightId}/preauth`);

export const fetchRecovery = (flightId: string) =>
  getJSON<RecoveryView>(`/api/disruptions/${flightId}`);

export async function setConsentRemote(passengerId: string, consent: Consent): Promise<void> {
  try {
    await fetch(`${API_BASE_URL}/api/passengers/${passengerId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ consent }),
    });
  } catch {
    // best-effort — the next schedule poll will show whatever actually took
  }
}

export const resolveTask = (flightId: string, action: ResolveAction) =>
  postJSON<RecoveryView>(`/api/disruptions/${flightId}/consent`, { action });
