/**
 * The sandbox carrier — the only adapter with a write plane.
 *
 * We touch no real inventory, so this models the parts of ticketing the recovery
 * flow actually depends on: coupon lifecycle, the three reissue mechanisms,
 * interline agreements, duplicate rejection, and inventory that drains over time.
 *
 * Two properties are worth stating because they are what make it worth building
 * rather than stubbing:
 *
 *   Inventory is **stateless by construction**. Availability at time T is derived
 *   from `hash(seed, route, date)` and a decay curve, never accumulated in a
 *   mutable counter. A hot reload, a redeploy, or two test files running in
 *   parallel therefore cannot make the numbers drift, because there is no state
 *   to drift. Only our *own* consumption is tracked, and that is the domain's own
 *   record rather than a simulation variable.
 *
 *   A second active coupon for the same passenger and date is **refused**. That
 *   turns "a passenger cannot hold two tickets" from a design assertion into a
 *   regression test, so the speculative-hold path cannot quietly come back.
 */

import type {
  BookResult,
  Carriers,
  CreditClaimResult,
  Disposition,
  FareRules,
  Offer,
  ReissueMechanism,
  ReissueResult,
  RevalidationResult,
  SearchParams,
  SupplierStatus,
  SupplierType,
  Ticket,
  VoidResult,
  WriteCapableSupplier,
  WriteRefusalCode,
} from './types';

/* ── carriers and their agreements ───────────────────────────────────────── */

type CarrierSpec = { code: string; name: string; type: SupplierType };

const CARRIERS: CarrierSpec[] = [
  { code: 'AI', name: 'Air India', type: 'coupon' },
  { code: 'EK', name: 'Emirates', type: 'coupon' },
  { code: 'BA', name: 'British Airways', type: 'coupon' },
  { code: '6E', name: 'IndiGo', type: 'lcc' },
  { code: 'SG', name: 'SpiceJet', type: 'lcc' },
  { code: 'QP', name: 'Akasa Air', type: 'lcc' },
];

/**
 * Who will accept whose ticket. Indian low-cost carriers interline with nobody,
 * which is the whole reason `fresh-purchase` is the common case here rather than
 * an edge case.
 */
const INTERLINE: Record<string, readonly string[]> = {
  AI: ['EK', 'BA'],
  EK: ['AI', 'BA'],
  BA: ['AI', 'EK'],
  '6E': [],
  SG: [],
  QP: [],
};

export function interlines(validating: string, operating: string): boolean {
  if (validating === operating) return true;
  return (INTERLINE[validating] ?? []).includes(operating);
}

/* ── deterministic configuration ─────────────────────────────────────────── */

export type SandboxConfig = {
  seed: string;
  /** Logical clock, so a demo replays identically and a proof run is reproducible. */
  now: () => number;
  /**
   * Multiplies the decay rate. Above 1 the route drains faster, which is what a
   * hub-wide event looks like from the inside.
   */
  scarcity: number;
};

let config: SandboxConfig = { seed: 'zkd-default', now: () => Date.now(), scarcity: 1 };

/** Tickets we have issued. Necessarily stateful — it is the record, not the simulation. */
const tickets = new Map<string, Ticket>();
/** Replay cache so a retry under the same business key returns the same result. */
const writes = new Map<string, ReissueResult | BookResult | VoidResult | CreditClaimResult>();
let ticketSeq = 0;

export function configureSandbox(patch: Partial<SandboxConfig>): void {
  config = { ...config, ...patch };
}

/** Clears issued tickets and the replay cache. Inventory needs no reset — it is derived. */
export function resetSandbox(seed?: string): void {
  tickets.clear();
  writes.clear();
  ticketSeq = 0;
  if (seed) config = { ...config, seed };
}

export function allTickets(): Ticket[] {
  return [...tickets.values()];
}

/** Seeds an original ticket so a recovery has something to reissue. */
export function issueOriginal(args: {
  pnr: string;
  passengerId: string;
  carrier: string;
  segment: Ticket['segment'];
}): Ticket {
  const spec = CARRIERS.find((c) => c.code === args.carrier) ?? CARRIERS[0];
  const t: Ticket = {
    number: `${spec.code}-${(++ticketSeq).toString().padStart(6, '0')}`,
    pnr: args.pnr,
    passengerId: args.passengerId,
    segment: args.segment,
    carriers: { marketing: spec.code, operating: spec.code, validating: spec.code },
    supplierType: spec.type,
    status: 'OPEN_FOR_USE',
    endorsement: null,
    voidableUntil: null,
    issuedAt: config.now(),
  };
  tickets.set(t.number, t);
  return t;
}

/* ── inventory: derived, never accumulated ───────────────────────────────── */

/** FNV-1a, the same primitive `travelport.ts` uses for its synthetic book. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const DAY_MS = 86_400_000;

/**
 * Seats still sellable on one option at time `at`.
 *
 * Two terms, deliberately separate. The market term is a pure function of the
 * seed, the option and elapsed time — an exponential drain, so it is monotonic
 * and cannot un-sell a seat. Our own consumption is subtracted on top, which is
 * how a party of six correctly removes six seats where a solo traveller removes
 * one.
 */
export function seatsAt(offerKey: string, dayStart: number, at: number): number {
  const h = hash(`${config.seed}|${offerKey}`);
  const initial = 4 + (h % 22); // 4..25
  const halfLifeHours = 6 + ((h >>> 8) % 30); // 6..35h
  const elapsedHours = Math.max(0, (at - dayStart) / 3_600_000);
  const lambda = (Math.LN2 / halfLifeHours) * Math.max(0.1, config.scarcity);
  const market = initial * Math.exp(-lambda * elapsedHours);
  const consumed = [...tickets.values()].filter(
    (t) => t.status === 'OPEN_FOR_USE' && offerKeyOf(t) === offerKey,
  ).length;
  return Math.max(0, Math.round(market) - consumed);
}

function offerKeyOf(t: Ticket): string {
  const date = new Date(t.segment.departsAt).toISOString().slice(0, 10);
  return `${t.segment.from}-${t.segment.to}-${date}-${t.segment.flightCode}`;
}

/* ── search ──────────────────────────────────────────────────────────────── */

function fareRulesFor(spec: CarrierSpec, h: number): FareRules {
  const lcc = spec.type === 'lcc';
  return {
    fareBasis: lcc ? 'SAVER' : ['YFLEX', 'MSPCL', 'QSAVER'][h % 3],
    changeable: !lcc || h % 3 !== 0,
    refundable: !lcc && h % 2 === 0,
    // Under an involuntary disposition most restrictions are waived, but the
    // ladder still needs to know what is permissible at each rung.
    reissuePermitted: !lcc,
    interlinePermitted: !lcc && h % 5 !== 0,
    voidWindowMinutes: lcc ? null : 24 * 60,
  };
}

function buildOffers(params: SearchParams): Offer[] {
  const dayStart = Date.parse(`${params.departureDate}T00:00:00Z`);
  if (Number.isNaN(dayStart)) return [];
  const at = config.now();

  const route = `${params.origin}-${params.destination}-${params.departureDate}`;
  const rootHash = hash(`${config.seed}|${route}`);
  const count = 4 + (rootHash % 4); // 4..7 options

  const offers: Offer[] = [];
  for (let i = 0; i < count; i++) {
    const h = hash(`${config.seed}|${route}|${i}`);
    const marketing = CARRIERS[h % CARRIERS.length];
    // Every fourth option is a codeshare: sold by one carrier, flown by another.
    // This is what breaks a naive `carrier === original_carrier` check.
    const isCodeshare = h % 4 === 0;
    const operating = isCodeshare ? CARRIERS[(h >>> 4) % CARRIERS.length] : marketing;
    const carriers: Carriers = {
      marketing: marketing.code,
      operating: operating.code,
      validating: marketing.code,
    };

    const flightCode = `${marketing.code} ${100 + (h % 899)}`;
    const offerKey = `${params.origin}-${params.destination}-${params.departureDate}-${flightCode}`;
    const departsAt = dayStart + (6 + (h % 16)) * 3_600_000;
    const durationMs = (75 + (h % 180)) * 60_000;
    const seats = seatsAt(offerKey, dayStart, at);

    offers.push({
      id: `sandbox-${offerKey}`,
      supplier: 'sandbox',
      supplierOfferId: offerKey,
      flightCode,
      from: params.origin,
      to: params.destination,
      departsAt,
      arrivesAt: departsAt + durationMs,
      cabin: params.cabin ?? (h % 9 === 0 ? 'business' : 'economy'),
      seatsRemaining: seats,
      price: { amount: 3200 + (h % 17) * 850, currency: 'INR' },
      // Short, like a real fare offer. This is what drives the refresh cadence.
      expiresAt: at + (4 + (h % 9)) * 60_000,
      live: false,
      supplierType: marketing.type,
      carriers,
      fareRules: fareRulesFor(marketing, h),
    });
  }
  return offers.filter((o) => o.seatsRemaining > 0);
}

/* ── which mechanism is available ────────────────────────────────────────── */

/**
 * Decided over four carriers, not two. A codeshare marketed by the original
 * carrier but operated by a partner it does not interline with is a fresh
 * purchase, however familiar the flight number looks.
 */
export function reissueMechanismFor(original: Ticket, candidate: Offer): ReissueMechanism {
  const c = candidate.carriers;
  const rules = candidate.fareRules;
  if (!c || !rules) return 'fresh-purchase';
  if (original.supplierType === 'lcc' || candidate.supplierType === 'lcc') return 'fresh-purchase';
  if (!rules.reissuePermitted) return 'fresh-purchase';

  const sameCarrier =
    c.validating === original.carriers.validating && c.operating === original.carriers.operating;
  if (sameCarrier) return 'same-carrier';

  if (rules.interlinePermitted && interlines(original.carriers.validating, c.operating)) {
    return 'interline';
  }
  return 'fresh-purchase';
}

/* ── the supplier ────────────────────────────────────────────────────────── */

function refuse(code: WriteRefusalCode, reason: string) {
  return { state: 'refused' as const, reason, code };
}

/** An active coupon overlapping the same travel date is a duplicate booking. */
function hasActiveCouponOn(passengerId: string, dayIso: string): boolean {
  return [...tickets.values()].some(
    (t) =>
      t.passengerId === passengerId &&
      t.status === 'OPEN_FOR_USE' &&
      new Date(t.segment.departsAt).toISOString().slice(0, 10) === dayIso,
  );
}

function segmentOf(offer: Offer) {
  return {
    from: offer.from,
    to: offer.to,
    departsAt: offer.departsAt,
    arrivesAt: offer.arrivesAt,
    flightCode: offer.flightCode,
  };
}

function mint(offer: Offer, pnr: string, passengerId: string, endorsement: string | null): Ticket {
  const spec = CARRIERS.find((c) => c.code === offer.carriers?.marketing) ?? CARRIERS[0];
  const now = config.now();
  const voidMinutes = offer.fareRules?.voidWindowMinutes ?? null;
  const t: Ticket = {
    number: `${spec.code}-${(++ticketSeq).toString().padStart(6, '0')}`,
    pnr,
    passengerId,
    segment: segmentOf(offer),
    carriers: offer.carriers ?? {
      marketing: spec.code,
      operating: spec.code,
      validating: spec.code,
    },
    supplierType: offer.supplierType ?? spec.type,
    status: 'OPEN_FOR_USE',
    endorsement,
    voidableUntil: voidMinutes === null ? null : now + voidMinutes * 60_000,
    issuedAt: now,
  };
  tickets.set(t.number, t);
  return t;
}

export const sandbox: WriteCapableSupplier = {
  id: 'sandbox',

  async search(params) {
    return { offers: buildOffers(params), status: 'ok' as SupplierStatus };
  },

  async revalidate(offer): Promise<RevalidationResult> {
    const at = config.now();
    if (offer.expiresAt !== null && offer.expiresAt <= at) return { state: 'gone' };

    const date = new Date(offer.departsAt).toISOString().slice(0, 10);
    const dayStart = Date.parse(`${date}T00:00:00Z`);
    const seats = seatsAt(offer.supplierOfferId, dayStart, at);
    if (seats <= 0) return { state: 'gone' };

    const fresh: Offer = { ...offer, seatsRemaining: seats };
    // Prices drift upward as a route drains; the member must be told before we spend.
    const h = hash(`${config.seed}|price|${offer.supplierOfferId}|${Math.floor(at / 600_000)}`);
    if (h % 5 === 0) {
      const bumped = {
        ...fresh,
        price: { ...fresh.price, amount: fresh.price.amount + 300 + (h % 900) },
      };
      return { state: 'price-changed', offer: bumped, previous: offer.price };
    }
    return { state: 'available', offer: fresh };
  },

  async reissue({ ticketNumber, offer, disposition, idempotencyKey }) {
    const cached = writes.get(idempotencyKey) as ReissueResult | undefined;
    if (cached) return cached;

    const original = tickets.get(ticketNumber);
    let result: ReissueResult;

    if (!original) {
      result = refuse('not-found', `no ticket ${ticketNumber}`);
    } else if (original.status !== 'OPEN_FOR_USE') {
      result = refuse(
        'coupon-not-open',
        `coupon is ${original.status}; only OPEN_FOR_USE can be exchanged`,
      );
    } else if ((disposition as Disposition) !== 'involuntary') {
      result = refuse('not-endorsable', 'a voluntary change is not an involuntary reissue');
    } else {
      const mechanism = reissueMechanismFor(original, offer);
      if (mechanism === 'fresh-purchase') {
        result = refuse(
          'not-endorsable',
          'no interline agreement or the fare forbids endorsement — use bookReplacement',
        );
      } else {
        // The exchange consumes the original, so no duplicate can exist.
        original.status = 'EXCHANGED';
        original.endorsement = `INVOL ${mechanism.toUpperCase()} ${original.number}`;
        const replacement = mint(
          offer,
          original.pnr,
          original.passengerId,
          `INVOL REISSUE FROM ${original.number}`,
        );
        // A reissue has no inverse: you cannot re-reissue onto a cancelled flight.
        replacement.voidableUntil = null;
        result = { state: 'reissued', ticket: replacement };
      }
    }

    writes.set(idempotencyKey, result);
    return result;
  },

  async bookReplacement({ offer, pnr, passengerId, idempotencyKey }) {
    const cached = writes.get(idempotencyKey) as BookResult | undefined;
    if (cached) return cached;

    const dayIso = new Date(offer.departsAt).toISOString().slice(0, 10);
    let result: BookResult;

    if (hasActiveCouponOn(passengerId, dayIso)) {
      // The rule that killed the speculative hold, enforced rather than assumed.
      result = refuse(
        'duplicate-ticket',
        `passenger already holds an active coupon on ${dayIso}`,
      );
    } else {
      result = { state: 'booked', ticket: mint(offer, pnr, passengerId, null) };
    }

    writes.set(idempotencyKey, result);
    return result;
  },

  async voidTicket({ ticketNumber, idempotencyKey }) {
    const cached = writes.get(idempotencyKey) as VoidResult | undefined;
    if (cached) return cached;

    const t = tickets.get(ticketNumber);
    let result: VoidResult;
    if (!t) {
      result = refuse('not-found', `no ticket ${ticketNumber}`);
    } else if (t.voidableUntil === null || config.now() > t.voidableUntil) {
      result = refuse('void-window-closed', 'outside the void window; this is not compensable');
    } else {
      t.status = 'VOID';
      result = { state: 'voided', ticket: t };
    }

    writes.set(idempotencyKey, result);
    return result;
  },

  async claimCreditOnCancelled({ ticketNumber, idempotencyKey }) {
    const cached = writes.get(idempotencyKey) as CreditClaimResult | undefined;
    if (cached) return cached;

    const t = tickets.get(ticketNumber);
    let result: CreditClaimResult;
    if (!t) {
      result = refuse('not-found', `no ticket ${ticketNumber}`);
    } else {
      // Filed, not settled. Canon's initiated-is-not-completed rule lives here:
      // the caller must not record this as recovered.
      t.status = 'REFUNDED';
      result = {
        state: 'filed',
        claimRef: `CLM-${t.number}`,
        expected: { amount: 0, currency: 'INR' },
      };
    }

    writes.set(idempotencyKey, result);
    return result;
  },
};
