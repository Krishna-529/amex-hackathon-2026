/**
 * The one offer shape every supplier normalises to.
 *
 * Two fields exist here that the old per-supplier `Alt` never carried, and both
 * are load-bearing:
 *
 *   expiresAt — how long the supplier will honour this price. lib/confirmWindow.ts
 *   derives the member's decision window from it, which is the whole reason the
 *   window is defensible rather than a guessed 90 seconds.
 *
 *   currency — money without a currency is an India-only assumption. Every fare
 *   crossing this boundary carries its own.
 */

export type SupplierId = 'duffel' | 'sabre' | 'travelport' | 'sandbox';

export type Money = { amount: number; currency: string };

/**
 * Whether the seller issues IATA e-ticket coupons, or sells its own booking
 * references against a credit shell. The distinction decides which of the three
 * mechanisms in `ReissueMechanism` is even available, so it is not cosmetic.
 */
export type SupplierType = 'coupon' | 'lcc';

/**
 * Three carriers, never one. `carrier === original_carrier` is wrong the moment
 * a codeshare appears: a flight can be sold by one airline, flown by another,
 * and ticketed on the stock of a third. Reissue eligibility follows the
 * *validating* carrier's agreements with the *operating* one, so collapsing
 * these into a single field makes the rule inexpressible.
 */
export type Carriers = {
  /** whose flight number is being sold */
  marketing: string;
  /** who actually operates the aircraft */
  operating: string;
  /** whose ticket stock it is, and therefore whose agreements govern a reissue */
  validating: string;
};

export type FareRules = {
  fareBasis: string;
  changeable: boolean;
  refundable: boolean;
  reissuePermitted: boolean;
  interlinePermitted: boolean;
  /** minutes after ticketing during which a void is free; null when undisclosed — never guess */
  voidWindowMinutes: number | null;
};

/**
 * How a replacement seat can actually be attached to the passenger.
 *
 * The free mechanisms are the irreversible ones: a reissue consumes the original
 * coupon and cannot be undone, whereas a fresh purchase costs a walk-up fare but
 * can be voided inside its window. That inversion is deliberate and load-bearing
 * — see `lib/ranking.ts`.
 */
export type ReissueMechanism = 'same-carrier' | 'interline' | 'fresh-purchase';

export type Offer = {
  id: string;
  supplier: SupplierId;
  /** the supplier's own offer id, needed to re-price and to book */
  supplierOfferId: string;
  flightCode: string;
  from: string;
  to: string;
  /** epoch ms */
  departsAt: number;
  arrivesAt: number;
  cabin: string;
  seatsRemaining: number;
  price: Money;
  /** epoch ms after which the price is no longer honoured; null when unknown */
  expiresAt: number | null;
  live: boolean;
  /**
   * The three fields below are optional because the live adapters cannot always
   * populate them, and inventing a value would be worse than admitting we do not
   * have one. Absence is not treated as permission: the policy gate denies any
   * candidate that reaches it without them, which is the canon rule that
   * incomplete policy inputs cause a default deny.
   */
  supplierType?: SupplierType;
  carriers?: Carriers;
  fareRules?: FareRules;
};

export type SearchParams = {
  origin: string;
  destination: string;
  /** ISO date */
  departureDate: string;
  cabin?: string;
};

export type SupplierStatus = 'ok' | 'empty' | 'no-key' | 'error';

export type SearchResult = {
  offers: Offer[];
  sources: Record<SupplierId, SupplierStatus>;
};

export type Supplier = {
  id: SupplierId;
  search(params: SearchParams): Promise<{ offers: Offer[]; status: SupplierStatus }>;
  /**
   * Re-check a specific offer immediately before ticketing. The member may have
   * spent minutes deciding, and inventory does not wait for them.
   */
  revalidate(offer: Offer): Promise<RevalidationResult>;
};

export type RevalidationResult =
  | { state: 'available'; offer: Offer }
  | { state: 'price-changed'; offer: Offer; previous: Money }
  | { state: 'gone' }
  | { state: 'unknown' };

/* ── the write plane ─────────────────────────────────────────────────────── */

/**
 * Coupon lifecycle. A reissue *consumes* the original by moving it to
 * `EXCHANGED`, which is exactly why no duplicate ticket ever exists — and why
 * this satisfies the constraint that killed the speculative hold.
 */
export type CouponStatus = 'OPEN_FOR_USE' | 'EXCHANGED' | 'USED' | 'VOID' | 'REFUNDED';

/**
 * Derived from whether the original operated, never from whether the member was
 * inconvenienced. Involuntary is free and preserves statutory entitlement;
 * voluntary is denied outright under autopilot.
 */
export type Disposition = 'involuntary' | 'voluntary';

export type Segment = {
  from: string;
  to: string;
  /** epoch ms */
  departsAt: number;
  arrivesAt: number;
  flightCode: string;
};

export type Ticket = {
  number: string;
  pnr: string;
  passengerId: string;
  segment: Segment;
  carriers: Carriers;
  supplierType: SupplierType;
  status: CouponStatus;
  /** why it was reissued and under what disposition; null until exchanged */
  endorsement: string | null;
  /** epoch ms up to which a free void is still possible; null when undisclosed */
  voidableUntil: number | null;
  issuedAt: number;
};

export type WriteRefusal = { state: 'refused'; reason: string; code: WriteRefusalCode };

export type WriteRefusalCode =
  /** the passenger already holds an active coupon overlapping this travel */
  | 'duplicate-ticket'
  /** the original coupon is not OPEN_FOR_USE, so there is nothing to exchange */
  | 'coupon-not-open'
  /** no interline agreement, or the fare forbids endorsement */
  | 'not-endorsable'
  /** the void window has closed */
  | 'void-window-closed'
  | 'not-found'
  | 'supplier-error';

export type ReissueResult = { state: 'reissued'; ticket: Ticket } | WriteRefusal;
export type BookResult = { state: 'booked'; ticket: Ticket } | WriteRefusal;
export type VoidResult = { state: 'voided'; ticket: Ticket } | WriteRefusal;
export type CreditClaimResult =
  | { state: 'filed'; claimRef: string; expected: Money }
  | WriteRefusal;

/**
 * Idempotency keys derive from the **business entity**, never from the workflow
 * run. A run-scoped key (`${runId}:${activityId}`) mints a fresh key on any
 * retry after a crash or an escalation, and therefore books the same leg twice.
 * This form is attempt- and run-invariant, which is what makes retry safe.
 */
export type BusinessKey = {
  pnr: string;
  /** stable identifier for the leg being replaced, e.g. "MAA-DEL-2026-08-25" */
  segment: string;
  member: string;
  intent: 'reissue' | 'book' | 'void' | 'claim-credit';
};

export function idempotencyKey(k: BusinessKey): string {
  return [k.pnr, k.segment, k.member, k.intent].join('|');
}

export type WriteVerbs = {
  /** Coupon carriers only. Consumes the original and issues the replacement. */
  reissue(args: {
    ticketNumber: string;
    offer: Offer;
    disposition: Disposition;
    idempotencyKey: string;
  }): Promise<ReissueResult>;

  /** The LCC path: a new booking, with the original settled separately and asynchronously. */
  bookReplacement(args: {
    offer: Offer;
    pnr: string;
    passengerId: string;
    idempotencyKey: string;
  }): Promise<BookResult>;

  /** Files the refund or credit claim against the cancelled original. Resolves asynchronously. */
  claimCreditOnCancelled(args: {
    ticketNumber: string;
    idempotencyKey: string;
  }): Promise<CreditClaimResult>;

  /** Compensation for `bookReplacement`. There is deliberately no inverse for `reissue`. */
  voidTicket(args: { ticketNumber: string; idempotencyKey: string }): Promise<VoidResult>;
};

export type WriteCapableSupplier = Supplier & WriteVerbs;

export function isWriteCapable(s: Supplier): s is WriteCapableSupplier {
  return typeof (s as Partial<WriteVerbs>).reissue === 'function';
}
