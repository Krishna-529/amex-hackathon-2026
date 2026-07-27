/**
 * The frozen scenario. Everything downstream — mocks, policy inputs, the
 * dashboard, the push notification — derives from this file. Nothing here
 * depends on the wall clock, so every run produces identical output.
 *
 * Priya, an Amex Card Member, flies MAA -> DEL -> LHR for a board meeting in
 * London. At 06:12 the Chennai-Delhi leg is cancelled.
 */

export const CURRENCY = 'INR';
export const REGULATOR = 'DGCA (India)';

/** "Now" is frozen. 06:12 IST on the day of travel. */
export const FROZEN_NOW_ISO = '2026-08-25T06:12:00+05:30';
export const FROZEN_NOW_MS = Date.parse(FROZEN_NOW_ISO);

export const CARD_MEMBER = {
  name: 'Priya Raghunathan',
  firstName: 'Priya',
  membership: 'Amex Card Member',
  cardLast4: '2007',
  pnr: '6JQ8XZ',
  purpose: 'Board meeting — London, 26 Aug 14:00 BST',
};

export interface Leg {
  id: string;
  carrier: string;
  flight: string;
  from: string;
  to: string;
  departIso: string;
  arriveIso: string;
  cabin: string;
}

/** What Priya booked before the disruption. */
export const ORIGINAL_ITINERARY = {
  pnr: CARD_MEMBER.pnr,
  legs: [
    {
      id: 'LEG-1',
      carrier: 'AI',
      flight: 'AI2803',
      from: 'MAA',
      to: 'DEL',
      departIso: '2026-08-25T08:15:00+05:30',
      arriveIso: '2026-08-25T10:55:00+05:30',
      cabin: 'ECONOMY',
    },
    {
      id: 'LEG-2',
      carrier: 'AI',
      flight: 'AI111',
      from: 'DEL',
      to: 'LHR',
      departIso: '2026-08-26T03:30:00+05:30',
      arriveIso: '2026-08-26T07:35:00+01:00',
      cabin: 'ECONOMY',
    },
  ] as Leg[],
  hotel: {
    id: 'HTL-1',
    name: 'Andaz Delhi Aerocity',
    checkInIso: '2026-08-25T12:30:00+05:30',
    nights: 1,
    amountInr: 12800,
  },
  ground: {
    id: 'GRD-1',
    provider: 'Delhi Airport Express — chauffeur',
    pickupIso: '2026-08-25T11:30:00+05:30',
    from: 'DEL T3',
    to: 'Andaz Delhi Aerocity',
    amountInr: 1450,
  },
  /** Fare actually paid for the cancelled sector — caps the DGCA slab. */
  sectorFareInr: 18400,
};

/** The disruption signal, as it arrives from the carrier feed. */
export const DISRUPTION = {
  eventId: 'DSR-2026-0825-MAA-0612',
  detectedAtIso: FROZEN_NOW_ISO,
  type: 'FLIGHT_CANCELLED',
  flight: 'AI2803',
  sector: 'MAA-DEL',
  scheduledDepartIso: '2026-08-25T08:15:00+05:30',
  reason: 'AIRCRAFT_UNSERVICEABLE',
  /** Operational, not weather/ATC — so the DGCA cash slab is payable. */
  forceMajeure: false,
  blockTimeHours: 2.67,
  invalidates: ['LEG-1', 'HTL-1', 'GRD-1'],
  atRisk: ['LEG-2'],
};

/** Recovery constants derived from the chosen re-accommodation. */
export const RECOVERY = {
  /** Arrival delay vs the original 10:55 arrival: 18:05 - 10:55 = 7h10m. */
  delayHours: 7.17,
  /** New DEL arrival is 18:05; DEL->LHR departs 03:30 next day. */
  overnightWindow: true,
};

/** Deterministic mock latencies (ms). --fast collapses all of these. */
export const LATENCY_MS = {
  signal: 2_000,
  context: 3_000,
  supplierFanout: 15_000,
  opa: 50,
  rank: 4_000,
  book: 1_200,
  compensate: 800,
};

export const FAST_LATENCY_MS: typeof LATENCY_MS = {
  signal: 20,
  context: 30,
  supplierFanout: 60,
  opa: 5,
  rank: 20,
  book: 10,
  compensate: 10,
};

export const TASK_QUEUE = 'concierge-recovery';
export const OPA_URL = process.env.OPA_URL ?? 'http://127.0.0.1:8181';
export const API_PORT = Number(process.env.API_PORT ?? 8787);
export const WEB_PORT = Number(process.env.WEB_PORT ?? 5273);
export const TEMPORAL_ADDRESS = process.env.TEMPORAL_ADDRESS ?? '127.0.0.1:7233';
export const TEMPORAL_UI = process.env.TEMPORAL_UI ?? 'http://localhost:8233';

export function inr(amount: number): string {
  const sign = amount < 0 ? '-' : '';
  return `${sign}₹${Math.abs(amount).toLocaleString('en-IN')}`;
}

/** HH:mm in the given IANA zone, from an ISO string. Pure, no wall clock. */
export function hhmm(iso: string, timeZone = 'Asia/Kolkata'): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  }).format(new Date(iso));
}
