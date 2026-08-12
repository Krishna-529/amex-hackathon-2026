import type { Alt, HotelOpt } from './data';
import type { Offer, SupplierId, SupplierStatus } from '@/server/suppliers/types';
import type { DisruptionKind, Classification } from './disruptionKind';
import type { Thresholds, Band } from './thresholds';
import type { ConfirmWindow } from './confirmWindow';
import type { CareItem } from './entitlement';
import type { Jurisdiction } from '@/server/airportDirectory';

export type SourceStatus = 'ok' | 'empty' | 'error';

/** What the disruption forecast says about one flight, and where it came from. */
export type ForecastResponse = {
  /** 0-100, so the UI never has to decide how to round a probability */
  pct: number;
  connectionRisk: number | null;
  confidence: number;
  source: 'lumo' | 'mock';
  thresholds: Thresholds;
  band: Band;
  asOf: number;
};

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
  /** what kind of disruption this is, if any — computed against the booked time */
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
  /** what we would actually book now — may not be what the member picked */
  offer: Offer | null;
  /** set when the member's pick was gone and we moved to the next candidate */
  switchedFrom: string | null;
  message: string;
};

export type DisruptionResolution =
  | { kind: 'autopilot' | 'approved'; at: number; altId: string; hotelId: string; cabId: string }
  | { kind: 're-timed'; at: number; hotelId: string; cabId: string; shiftMinutes: number }
  | { kind: 'no-action'; at: number }
  | { kind: 'handed-over'; at: number };

export type DisruptionStateResponse = {
  detectedAt: number;
  kind: DisruptionKind;
  windowExpiresAt: number | null;
  resolution: DisruptionResolution | null;
};

/** The member's decision window, derived rather than assumed. */
export type WindowResponse = {
  window: ConfirmWindow;
  rationale: string;
};

/** Duty of care owed on this route, under whichever regime governs it. */
export type CareResponse = {
  jurisdiction: Jurisdiction;
  bundleName: string;
  citation: string;
  owed: CareItem[];
};

export type { Offer, SupplierId, SupplierStatus };
