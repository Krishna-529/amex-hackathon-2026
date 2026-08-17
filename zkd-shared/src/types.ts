/**
 * The contract crossing the PLAN/EXECUTE trust boundary — and nothing else.
 * zkd-app (PLAN) keeps its own domain model, search clients and store;
 * zkd-execute (EXECUTE) keeps its own booking-write clients and payment
 * secrets. Neither imports the other's internals. What they exchange is
 * exactly the shapes below, passed as a Temporal workflow's input/output —
 * the same discipline the "no route from planning layer to a mutating
 * supplier API" architectural claim rests on, extended to the type system:
 * EXECUTE's write-capable code cannot even be imported from a PLAN build.
 */

export type RecoveryPhase =
  | 'WATCH' | 'CLASSIFY' | 'WARM' | 'ASK' | 'WAIT' | 'RE_CHECK'
  | 'ACT' | 'VERIFY' | 'CLAIM';

/** Every recovery resolves to exactly one of these. No state hangs, and no
 *  state expires in silence (03-action-policy.md §7). */
export type TerminalState = 'CONFIRMED' | 'RELEASED' | 'ESCALATED' | 'ROLLED_BACK';

/** Nothing irreversible happens left of ACT — that is the load-bearing
 *  safety claim. Phases before ACT are always reversible; ACT is not. */
export function isReversible(phase: RecoveryPhase): boolean {
  return phase !== 'ACT' && phase !== 'VERIFY' && phase !== 'CLAIM';
}

export type SupplierId = 'duffel' | 'sabre' | 'travelport' | 'liteapi' | 'mock-cabs';

export type Money = { amount: number; currency: string };

/** The exact offer PLAN priced and the member (or autopilot) consented to.
 *  EXECUTE re-validates this against the live supplier immediately before
 *  booking (03-action-policy.md §3.2) rather than trusting it blindly — this
 *  snapshot is what makes that re-check possible. */
export type OfferSnapshot = {
  supplier: SupplierId;
  supplierOfferId: string;
  flightCode: string;
  from: string;
  to: string;
  departsAtMs: number;
  cabin: string;
  price: Money;
  expiresAtMs: number | null;
};

export type HotelSnapshot = {
  supplierOfferId: string;
  name: string;
  checkin: string;
  rooms: number;
  rate: Money;
};

export type GroundSnapshot = {
  supplierOfferId: string;
  kind: string;
  vehicles: number;
  legs: { from: string; to: string; pickupISO: string }[];
  extra: Money;
};

export type PolicyDenyReason =
  | 'voluntary_under_autopilot'
  | 'member_rejected_offer'
  | 'fare_class_ceiling'
  | 'fare_delta_cap'
  | 'travel_window'
  | 'seat_exists'
  /** input was missing a field the policy needs — "not enough to evaluate"
   *  is itself a denial, never a silent allow (policy/execute.rego). */
  | 'malformed_input';

/** Everything the default-deny gate needs to evaluate one candidate — see
 *  03-action-policy.md §5. Computed by PLAN (it has the member/entitlement
 *  context) and re-evaluated for real by EXECUTE's OPA sidecar immediately
 *  before every mutating call — PLAN's own OPA check is a cheap early filter,
 *  never the enforcement point. */
export type PolicyInput = {
  consent: 'autopilot' | 'ask';
  /** true = the original flight operated and the member chose to move
   *  (voluntary); false = the carrier cancelled or delayed past threshold
   *  (involuntary). Derived from whether the original operated — never from
   *  whether the member was inconvenienced (03-action-policy.md §5). */
  originalFlightOperated: boolean;
  offerId: string;
  rejectedOfferIds: string[];
  /** 0=Economy .. 3=First */
  cabinRank: number;
  cabinEntitlementRank: number;
  /** cost to the member in the transaction currency; 0 when the carrier owes it */
  fareDelta: number;
  fareDeltaCap: number;
  departureAtMs: number;
  travelWindowStartMs: number;
  travelWindowEndMs: number;
  seatsAvailable: number;
  partySize: number;
};

export type PolicyDecision = {
  allow: boolean;
  deny: PolicyDenyReason[];
  evaluatedAt: number;
  /** true when OPA could not be reached and this is the fail-closed default —
   *  never treated as a real allow, matching "default deny". */
  failClosed: boolean;
  note?: string;
};

/** What PLAN hands EXECUTE to start (or resume, via Temporal's own dedupe)
 *  the booking saga. `idempotencyKey` becomes the Temporal workflowId. */
/** The minimal PII a supplier's order API needs at book time — never a
 *  passport/payment record, just what the flight-write API requires. */
export type PassengerSnapshot = {
  givenName: string;
  familyName: string;
  dob: string;
  gender: 'm' | 'f';
  email: string;
  phoneNumber: string;
};

export type RecoveryIntent = {
  idempotencyKey: string;
  pnr: string;
  originalBookingId: string;
  memberId: string;
  partySize: number;
  travellerIds: string[];
  passenger: PassengerSnapshot;
  consent: 'autopilot' | 'ask';
  disposition: 'involuntary' | 'voluntary';
  flight: OfferSnapshot;
  hotel: HotelSnapshot | null;
  ground: GroundSnapshot | null;
  perTransactionCap: Money;
  policyInput: PolicyInput;
  /** callback PLAN polls or receives a webhook on when the saga settles */
  callbackUrl: string | null;
  requestedAt: number;
};

export type SagaStepName = 'reserveVAN' | 'bookFlight' | 'bookHotel' | 'bookGround' | 'disposeOriginal';
export type CompensationStepName = 'releaseVAN' | 'voidFlight' | 'cancelHotel' | 'cancelGround';

export type SagaStepRecord = {
  step: SagaStepName | CompensationStepName;
  kind: 'forward' | 'compensation';
  startedAt: number;
  finishedAt: number | null;
  outcome: 'ok' | 'failed' | 'skipped';
  detail?: string;
};

export type SagaResult = {
  idempotencyKey: string;
  terminal: 'CONFIRMED' | 'ROLLED_BACK';
  steps: SagaStepRecord[];
  bookingRefs?: { pnr: string; confirmationNumbers: Partial<Record<SagaStepName, string>> };
  failureReason?: string;
  settledAt: number;
};
