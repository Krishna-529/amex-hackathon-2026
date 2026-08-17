import type { PolicyDecision, SagaStepRecord } from './types';

/** Every threshold evaluation, with its inputs — 03-action-policy.md §2: "An
 *  adaptive threshold that cannot be reconstructed after the fact is not
 *  auditable." */
export type ThresholdEvaluationLedgerEntry = {
  flightId: string;
  inputs: {
    seatsAvailable: number;
    minutesToDeparture: number;
    hasHardConstraint: boolean;
    confidence: number;
    /** absent when the caller evaluated thresholds without a party-size
     *  context (lib/thresholds.ts's ThresholdInputs) */
    partySize?: number;
  };
  thresholds: { prepare: number; holdGate: number; preAuthorise: number; configVersion: number };
  pct: number;
  band: string;
  loggedAt: number;
};

export type PolicyDecisionLedgerEntry = {
  idempotencyKey: string;
  /** which saga step this decision gated */
  step: string;
  decision: PolicyDecision;
  loggedAt: number;
};

export type SagaStepLedgerEntry = SagaStepRecord & {
  idempotencyKey: string;
  loggedAt: number;
};
