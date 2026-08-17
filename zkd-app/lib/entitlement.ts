/**
 * Duty of care, as data.
 *
 * The deck's claim is that the market changes the bundle and never the engine —
 * so what a traveller is owed lives in a table keyed by jurisdiction, and the
 * code that decides what to claim does not know which country it is in.
 *
 * Five bundles ship: India (DGCA), EU261, UK261, US DOT, and the card product's
 * own benefit terms for everywhere else — which is what actually applies across
 * most of the 130+ countries Amex operates in.
 *
 * ── Evidence tiers are per-bundle and they are not all the same ────────────
 *
 * Every bundle carries its own `evidenceTier`, because they were sourced
 * differently and a single blanket disclaimer would flatter the weakest one.
 * None is `verified`: no primary regulatory text was re-retrieved. Anything
 * claimed for real money must be reconciled against the source first.
 */

import type { Jurisdiction } from '@/server/airportDirectory';

export type CareItem = 'meals' | 'hotel' | 'transfer' | 'alt-flight-or-refund' | 'cash-compensation';

/** How far to trust a bundle's numbers. See the header. */
export type EvidenceTier = 'verified' | 'assumed' | 'deck';

/**
 * One rung of a distance-banded compensation ladder.
 *
 * `maxKm` is INCLUSIVE and bands are matched first-to-last, so a route at
 * exactly 1500km falls in the first band, not the second. `null` means the top,
 * unbounded band.
 */
export type CompensationBand = { maxKm: number | null; amount: number };

export type Bundle = {
  id: Jurisdiction;
  name: string;
  citation: string;
  /** delay hours at which each item becomes owed */
  owedAfterHours: Partial<Record<CareItem, number>>;
  /** hotel is only owed when the delay runs across a night */
  hotelRequiresOvernight: boolean;
  /** force majeure removes cash, never the duty of care */
  cashRemovedByForceMajeure: boolean;
  currency: string;
  /**
   * Cash compensation by great-circle distance, in this bundle's `currency`.
   *
   * `null` means "no banded figure is encoded here", which is deliberately NOT
   * the same as zero. It covers two different situations, and conflating them
   * would be a lie in one direction or the other:
   *   - US-DOT: no statutory cash compensation exists at all.
   *   - IN-DGCA: compensation exists, but DGCA bands it by block time and fare,
   *     not by distance, so this field structurally cannot express it — and the
   *     rupee figures were never verified, so none are invented here.
   */
  compensation: CompensationBand[] | null;
  /** how far to trust the numbers above */
  evidenceTier: EvidenceTier;
  /**
   * US DOT's "significant change" threshold is 3h domestic / 6h international.
   * Only set where a regime genuinely distinguishes the two.
   */
  owedAfterHoursInternational?: Partial<Record<CareItem, number>>;
};

/**
 * The compensation owed at `distanceKm`, in the bundle's own currency.
 *
 * Never converts. This codebase refuses invented FX by design — see
 * `needsConversion` in server/domain/altsFromOffers.ts, which forces an option
 * to `ok:false` rather than guess a rate. A euro figure stays a euro figure.
 */
export function compensationFor(
  jurisdiction: Jurisdiction,
  distanceKm: number,
): { amount: number; currency: string } | null {
  const bundle = BUNDLES[jurisdiction];
  if (!bundle.compensation) return null;
  const band = bundle.compensation.find((b) => b.maxKm === null || distanceKm <= b.maxKm);
  return band ? { amount: band.amount, currency: bundle.currency } : null;
}

export const BUNDLES: Record<Jurisdiction, Bundle> = {
  'IN-DGCA': {
    id: 'IN-DGCA',
    name: 'DGCA duty of care (India)',
    citation: 'DGCA CAR Section 3, Series M, Part IV',
    owedAfterHours: {
      meals: 2,
      hotel: 6,
      transfer: 6,
      'alt-flight-or-refund': 6,
      'cash-compensation': 6,
    },
    hotelRequiresOvernight: true,
    cashRemovedByForceMajeure: true,
    currency: 'INR',
    // DGCA bands compensation by BLOCK TIME and FARE, not distance, so the
    // banded field above cannot represent it. AGENTS.md records that the CAR
    // text was never re-retrieved, so no rupee figures are invented here.
    compensation: null,
    evidenceTier: 'deck',
  },
  EU261: {
    id: 'EU261',
    name: 'EU261 passenger rights',
    citation: 'Regulation (EC) No 261/2004, Art. 7(1)',
    owedAfterHours: {
      meals: 2,
      hotel: 5,
      transfer: 5,
      'alt-flight-or-refund': 5,
      'cash-compensation': 3,
    },
    hotelRequiresOvernight: true,
    cashRemovedByForceMajeure: true,
    currency: 'EUR',
    // Art. 7(1) bands. General knowledge, not re-read from the Official
    // Journal this session — hence 'assumed', not 'verified'.
    compensation: [
      { maxKm: 1500, amount: 250 },
      { maxKm: 3500, amount: 400 },
      { maxKm: null, amount: 600 },
    ],
    evidenceTier: 'assumed',
  },
  UK261: {
    id: 'UK261',
    name: 'UK261 passenger rights',
    citation: 'Retained Regulation (EC) No 261/2004, as amended by SI 2019/278',
    // Structurally identical to EU261; the money is what differs.
    owedAfterHours: {
      meals: 2,
      hotel: 5,
      transfer: 5,
      'alt-flight-or-refund': 5,
      'cash-compensation': 3,
    },
    hotelRequiresOvernight: true,
    cashRemovedByForceMajeure: true,
    currency: 'GBP',
    compensation: [
      { maxKm: 1500, amount: 220 },
      { maxKm: 3500, amount: 350 },
      { maxKm: null, amount: 520 },
    ],
    evidenceTier: 'assumed',
  },
  'US-DOT': {
    id: 'US-DOT',
    name: 'US DOT refund rule',
    citation: '14 CFR Part 260 (refunds for cancelled or significantly changed flights)',
    /**
     * A REFUND, and nothing else.
     *
     * This is the entry most likely to be got wrong by pattern-matching it to
     * EU261. US DOT mandates a prompt refund when a flight is cancelled or
     * significantly changed; it does NOT mandate cash compensation, meals or a
     * hotel. Individual airlines' customer-service commitments often do, but
     * those are contract, not regulation, and they differ per carrier — so
     * promising them here would invent an entitlement the member may not have.
     */
    owedAfterHours: {
      'alt-flight-or-refund': 3,
    },
    // 3h domestic, 6h international — the only regime here that distinguishes.
    owedAfterHoursInternational: {
      'alt-flight-or-refund': 6,
    },
    hotelRequiresOvernight: true,
    cashRemovedByForceMajeure: false,
    currency: 'USD',
    compensation: null,
    evidenceTier: 'assumed',
  },
  'CARD-TERMS': {
    id: 'CARD-TERMS',
    name: 'Card benefit terms',
    citation: 'Amex card product terms — no statutory regime on this route',
    owedAfterHours: {
      meals: 3,
      hotel: 6,
      transfer: 6,
    },
    hotelRequiresOvernight: true,
    cashRemovedByForceMajeure: false,
    currency: 'USD',
    compensation: null,
    evidenceTier: 'deck',
  },
};

export type CareInput = {
  jurisdiction: Jurisdiction;
  delayHours: number;
  overnight: boolean;
  forceMajeure: boolean;
  /** only consulted where a regime sets a different international threshold */
  international?: boolean;
};

export function owed(input: CareInput): CareItem[] {
  const bundle = BUNDLES[input.jurisdiction];
  const out: CareItem[] = [];

  const thresholds =
    input.international && bundle.owedAfterHoursInternational
      ? { ...bundle.owedAfterHours, ...bundle.owedAfterHoursInternational }
      : bundle.owedAfterHours;

  for (const [item, hours] of Object.entries(thresholds) as [CareItem, number][]) {
    if (input.delayHours < hours) continue;
    if (item === 'hotel' && bundle.hotelRequiresOvernight && !input.overnight) continue;
    if (item === 'cash-compensation' && bundle.cashRemovedByForceMajeure && input.forceMajeure) continue;
    out.push(item);
  }
  return out;
}

export const CARE_LABEL: Record<CareItem, string> = {
  meals: 'Meals and refreshments',
  hotel: 'Hotel for the night',
  transfer: 'Airport transfers',
  'alt-flight-or-refund': 'A replacement flight, or your money back',
  'cash-compensation': 'Cash compensation',
};
