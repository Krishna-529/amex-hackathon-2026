/**
 * The policy gate. Default deny.
 *
 * Every proposal crosses this or it does not execute. Canon specifies OPA/Rego
 * evaluated in-process — either an `opa` sidecar on localhost or the policy
 * compiled to WASM — and never a remote PDP, because a remote PDP puts a network
 * failure on the critical path of the one component meant to be unbypassable.
 *
 * The `opa` toolchain is not available in this environment, so the rules live
 * here in TypeScript for now, one named pure function per rule so the mapping to
 * Rego stays one-to-one when `opa build -t wasm` becomes available. There is
 * deliberately **one** implementation rather than a Rego copy plus a TypeScript
 * copy that can drift apart.
 *
 * Two properties matter as much as the rules themselves:
 *
 *   Missing inputs deny. Incomplete policy inputs are not permission — a
 *   candidate that reaches the gate without its carriers or fare rules is denied,
 *   not waved through on the assumption that absence is benign.
 *
 *   Every evaluation reaches the ledger, including a cache hit. A memoised
 *   decision that skips the ledger puts holes in the audit trail, which is worse
 *   than the work it saves.
 */

import type { Bundle } from '@/lib/bundle';
import { bundleCost, coherence, singleCurrency } from '@/lib/bundle';
import type { Disposition, Money, ReissueMechanism } from '@/server/suppliers/types';

export const POLICY_VERSION = '2026-08-17.1';

export type DenyRule =
  | 'voluntary_under_autopilot'
  | 'member_rejected_offer'
  | 'fare_class_ceiling'
  | 'fare_delta_cap'
  | 'travel_window'
  | 'seat_exists'
  | 'duplicate_ticket'
  | 'entitlement_not_satisfied_by_credit'
  | 'exposure_cap_exceeded'
  | 'onward_leg_unprotected'
  | 'incoherent_bundle'
  | 'incomplete_policy_inputs';

export type Denial = { rule: DenyRule; reason: string };

export type MemberPolicy = {
  cabinEntitlement: string;
  perTransactionCap: Money;
  /** Aggregate across the whole party. Absent today in the app, which is the bug this closes. */
  aggregateCap: Money;
  /** Maximum fare increase over the original we will absorb without asking. */
  fareDeltaCap: Money;
};

export type ExposureState = {
  /** What we have already fronted for this member and not yet recovered. */
  memberOutstanding: Money;
  memberCap: Money;
  aggregateOutstanding: Money;
  aggregateCap: Money;
};

export type OnwardLeg = {
  carrier: string;
  /** Minutes between this bundle's arrival and the onward departure. */
  connectionBufferMinutes: number;
  /** Below this, a self-connection is not realistic. */
  selfConnectMinimumMinutes: number;
  /** Whether the replacement's carrier can through-check to the onward carrier. */
  interlineProtected: boolean;
};

export type PolicyInput = {
  bundle: Bundle;
  mechanism: ReissueMechanism;
  disposition: Disposition;
  consentTier: 'autopilot' | 'ask';
  partySize: number;
  rejectedOfferIds: string[];
  travelWindow: { earliest: number; latest: number };
  member: MemberPolicy;
  exposure: ExposureState;
  /** Null when this is a point-to-point trip with nothing downstream to protect. */
  onward: OnwardLeg | null;
  /** Fare of the ticket being replaced, for the delta cap. */
  originalFare: Money;
  entitlement: {
    /** True when the carrier owes an alternate flight or refund. */
    owed: boolean;
    /** How this bundle proposes to discharge it. */
    satisfiedBy: 'flight' | 'credit' | 'none';
  };
  /** Whether the passenger still holds an active coupon overlapping this travel. */
  activeCouponOverlaps: boolean;
  now: number;
};

export type Decision = {
  allow: boolean;
  denials: Denial[];
  policyVersion: string;
  evaluatedAt: number;
  /** Stable digest of the input, so the ledger entry can be replayed. */
  inputDigest: string;
  cached: boolean;
};

/* ── the rules ───────────────────────────────────────────────────────────── */

const CABIN_RANK: Record<string, number> = {
  economy: 0,
  'premium-economy': 1,
  premium_economy: 1,
  business: 2,
  first: 3,
};

type Rule = (i: PolicyInput) => Denial | null;

const voluntary_under_autopilot: Rule = (i) =>
  i.disposition === 'voluntary' && i.consentTier === 'autopilot'
    ? {
        rule: 'voluntary_under_autopilot',
        reason: 'the original operated, so this move is voluntary and the member would pay',
      }
    : null;

const member_rejected_offer: Rule = (i) =>
  i.rejectedOfferIds.includes(i.bundle.flight.supplierOfferId) ||
  i.rejectedOfferIds.includes(i.bundle.flight.id)
    ? {
        rule: 'member_rejected_offer',
        reason: 'the member rejected this option; it can never be re-proposed',
      }
    : null;

const fare_class_ceiling: Rule = (i) => {
  const want = CABIN_RANK[i.bundle.flight.cabin.toLowerCase()];
  const allowed = CABIN_RANK[i.member.cabinEntitlement.toLowerCase()];
  if (want === undefined || allowed === undefined) {
    return { rule: 'fare_class_ceiling', reason: 'cabin or entitlement not recognised' };
  }
  return want > allowed
    ? {
        rule: 'fare_class_ceiling',
        reason: `${i.bundle.flight.cabin} exceeds the ${i.member.cabinEntitlement} entitlement`,
      }
    : null;
};

const fare_delta_cap: Rule = (i) => {
  if (i.bundle.flight.price.currency !== i.originalFare.currency) {
    return { rule: 'fare_delta_cap', reason: 'cannot compare fares across currencies without FX' };
  }
  // An involuntary reissue is free by construction; there is no delta to cap.
  if (i.mechanism !== 'fresh-purchase') return null;
  const delta = i.bundle.flight.price.amount - i.originalFare.amount;
  return delta > i.member.fareDeltaCap.amount
    ? {
        rule: 'fare_delta_cap',
        reason: `fare is ${delta} above the original, over the ${i.member.fareDeltaCap.amount} cap`,
      }
    : null;
};

const travel_window: Rule = (i) => {
  const a = i.bundle.flight.arrivesAt;
  return a < i.travelWindow.earliest || a > i.travelWindow.latest
    ? { rule: 'travel_window', reason: 'arrival falls outside the declared travel window' }
    : null;
};

const seat_exists: Rule = (i) =>
  i.bundle.flight.seatsRemaining < i.partySize
    ? {
        rule: 'seat_exists',
        reason: `${i.bundle.flight.seatsRemaining} seats remain for a party of ${i.partySize}`,
      }
    : null;

/** The rule that killed the speculative hold, enforced at the gate rather than trusted to callers. */
const duplicate_ticket: Rule = (i) =>
  i.activeCouponOverlaps && i.mechanism === 'fresh-purchase'
    ? {
        rule: 'duplicate_ticket',
        reason: 'the passenger still holds an active coupon for overlapping travel',
      }
    : null;

const entitlement_not_satisfied_by_credit: Rule = (i) =>
  i.entitlement.owed && i.entitlement.satisfiedBy === 'credit'
    ? {
        rule: 'entitlement_not_satisfied_by_credit',
        reason: 'a credit voucher does not discharge an alternate-flight-or-refund obligation',
      }
    : null;

const exposure_cap_exceeded: Rule = (i) => {
  // Only a fresh purchase is fronted; a reissue carries the fare value across.
  if (i.mechanism !== 'fresh-purchase') return null;
  const add = i.bundle.flight.price.amount;
  if (i.exposure.memberOutstanding.amount + add > i.exposure.memberCap.amount) {
    return { rule: 'exposure_cap_exceeded', reason: 'fronting would exceed the per-member cap' };
  }
  if (i.exposure.aggregateOutstanding.amount + add > i.exposure.aggregateCap.amount) {
    return { rule: 'exposure_cap_exceeded', reason: 'fronting would exceed the aggregate cap' };
  }
  return null;
};

/**
 * Caught before spend rather than at VERIFY, which sits after the irreversible
 * boundary. Fires only when there is genuinely something downstream to lose.
 */
const onward_leg_unprotected: Rule = (i) => {
  if (!i.onward) return null;
  if (i.onward.interlineProtected) return null;
  return i.onward.connectionBufferMinutes < i.onward.selfConnectMinimumMinutes
    ? {
        rule: 'onward_leg_unprotected',
        reason: `no interline to ${i.onward.carrier} and only ${i.onward.connectionBufferMinutes} min to self-connect`,
      }
    : null;
};

const incoherent_bundle: Rule = (i) => {
  const problems = coherence(i.bundle, i.partySize);
  if (problems.length === 0) return null;
  return { rule: 'incoherent_bundle', reason: problems.map((p) => p.detail).join('; ') };
};

/** Absence of an input is not permission. */
const incomplete_policy_inputs: Rule = (i) => {
  const missing: string[] = [];
  if (!i.bundle.flight.carriers) missing.push('carriers');
  if (!i.bundle.flight.fareRules) missing.push('fareRules');
  if (!i.bundle.flight.supplierType) missing.push('supplierType');
  if (!singleCurrency(i.bundle)) missing.push('single currency across the bundle');
  return missing.length
    ? { rule: 'incomplete_policy_inputs', reason: `missing: ${missing.join(', ')}` }
    : null;
};

const RULES: Rule[] = [
  incomplete_policy_inputs,
  voluntary_under_autopilot,
  member_rejected_offer,
  fare_class_ceiling,
  fare_delta_cap,
  travel_window,
  seat_exists,
  duplicate_ticket,
  entitlement_not_satisfied_by_credit,
  exposure_cap_exceeded,
  onward_leg_unprotected,
  incoherent_bundle,
];

/* ── memoisation ─────────────────────────────────────────────────────────── */

/**
 * The cache stores a fixed-length digest as key and a small verdict as value —
 * never the input document. Entries are therefore near-uniform, so a count bound
 * is correct and we avoid measuring object size at runtime, which in V8 means
 * walking the object graph and stalling the event loop inside the very loop this
 * cache exists to speed up.
 */
const CACHE_LIMIT = 5_000;
const cache = new Map<string, Omit<Decision, 'cached'>>();
let dataVersion = 'seed';

export type LedgerEntry = Decision & { rulePath: string };
let ledger: (e: LedgerEntry) => void = () => {};

export function onDecision(sink: (e: LedgerEntry) => void): void {
  ledger = sink;
}

/**
 * Reloading policy data must flush the cache. The version is part of the key, so
 * a stale entry cannot be returned wrongly — but an unflushed cache keyed on the
 * old version keeps serving until it ages out, and a policy update that silently
 * fails to take effect is a correctness bug, not a housekeeping one.
 */
export function setPolicyData(version: string): void {
  dataVersion = version;
  cache.clear();
}

export function flushPolicyCache(): void {
  cache.clear();
}

export function policyCacheSize(): number {
  return cache.size;
}

export function evaluate(input: PolicyInput): Decision {
  const digest = digestOf(input);
  const hit = cache.get(digest);
  if (hit) {
    // Refresh recency, then emit the ledger entry anyway — a cache hit that
    // skips the ledger is a hole in the audit trail.
    cache.delete(digest);
    cache.set(digest, hit);
    const decision: Decision = { ...hit, cached: true };
    ledger({ ...decision, rulePath: rulePathOf(decision) });
    return decision;
  }

  const denials: Denial[] = [];
  for (const rule of RULES) {
    const d = rule(input);
    if (d) denials.push(d);
  }

  const decision: Omit<Decision, 'cached'> = {
    allow: denials.length === 0,
    denials,
    policyVersion: POLICY_VERSION,
    evaluatedAt: input.now,
    inputDigest: digest,
  };

  cache.set(digest, decision);
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }

  const out: Decision = { ...decision, cached: false };
  ledger({ ...out, rulePath: rulePathOf(out) });
  return out;
}

function rulePathOf(d: Decision): string {
  return d.allow ? 'concierge.rebook.allow' : `concierge.rebook.deny[${d.denials[0].rule}]`;
}

/* ── stable digest ───────────────────────────────────────────────────────── */

/**
 * Canonical serialisation with sorted keys, so two structurally equal inputs
 * produce the same key regardless of construction order. The byte length is
 * available free here if a size bound is ever wanted, without a second pass.
 */
function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
}

function digestOf(input: PolicyInput): string {
  const body = canonical(input);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < body.length; i++) {
    const c = body.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
  }
  return `${POLICY_VERSION}|${dataVersion}|${h1.toString(16)}${h2.toString(16)}`;
}
