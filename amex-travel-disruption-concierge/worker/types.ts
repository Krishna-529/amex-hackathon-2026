/** Shared types across workflow, activities and the API. Workflow-safe (no I/O). */

export type ActivityId = 'reserveVAN' | 'bookFlight' | 'bookHotel' | 'bookGround';
export type CompensationId = 'releaseVAN' | 'voidFlight' | 'cancelHotel' | 'cancelGround';

export interface OfferDecision {
  offerId: string;
  label: string;
  carrier: string;
  carrierName: string;
  flight: string;
  departIso: string;
  arriveIso: string;
  cabin: string;
  fareDeltaInr: number;
  offerTtlS: number;
  allowed: boolean;
  reasons: string[];
  rulePath: string;
  decisionId: number;
}

export interface RankedOption extends OfferDecision {
  score: number;
  arrivalDelayHours: number;
  connectionBufferHours: number;
  rank: number;
}

export interface DutyOfCarePacket {
  decisionId: number;
  rulePath: string;
  owed: string[];
  cashDue: boolean;
  slabInr: number;
  compensationInr: number;
  delayHours: number;
  regulation: string;
  currency: string;
  input: Record<string, unknown>;
}

export interface BookingResult {
  activityId: ActivityId;
  bookingRef: string | null;
  chargedInr: number;
  status: string;
  detail: Record<string, unknown>;
  decisionId: number;
  rulePath: string;
}

export interface CompensationResult {
  compensation: CompensationId;
  activityId: ActivityId;
  idempotencyKey: string;
  applied: boolean;
  bookingRef: string | null;
  status: string;
  order: number;
}

export interface RecoveryResult {
  mode: 'success' | 'rollback';
  status: 'RECOVERED' | 'ROLLED_BACK';
  runId: string;
  workflowId: string;
  pnr: string;
  offersConsidered: OfferDecision[];
  ranked: RankedOption[];
  chosen: RankedOption | null;
  dutyOfCare: DutyOfCarePacket;
  bookings: BookingResult[];
  compensations: CompensationResult[];
  failure: { activityId: string; type: string; message: string } | null;
  totalChargedInr: number;
}
