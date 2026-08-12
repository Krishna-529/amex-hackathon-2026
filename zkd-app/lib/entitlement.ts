/**
 * Duty of care, as data.
 *
 * The deck's claim is that the market changes the bundle and never the engine —
 * so what a traveller is owed lives in a table keyed by jurisdiction, and the
 * code that decides what to claim does not know which country it is in.
 *
 * Two bundles ship: India's DGCA CAR Section 3 Series M Part IV, and EU261.
 * Everywhere else falls back to the card product's own benefit terms, which is
 * what actually applies across most of the 130+ countries Amex operates in.
 *
 * Thresholds carry evidence tier 'deck' — they are transcribed from the
 * submission's own sourcing, not re-retrieved from the primary regulation, and
 * must be reconciled before anything real is claimed against them.
 */

import type { Jurisdiction } from '@/server/airportDirectory';

export type CareItem = 'meals' | 'hotel' | 'transfer' | 'alt-flight-or-refund' | 'cash-compensation';

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
};

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
  },
  EU261: {
    id: 'EU261',
    name: 'EU261 / UK261 passenger rights',
    citation: 'Regulation (EC) No 261/2004',
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
  },
};

export type CareInput = {
  jurisdiction: Jurisdiction;
  delayHours: number;
  overnight: boolean;
  forceMajeure: boolean;
};

export function owed(input: CareInput): CareItem[] {
  const bundle = BUNDLES[input.jurisdiction];
  const out: CareItem[] = [];

  for (const [item, hours] of Object.entries(bundle.owedAfterHours) as [CareItem, number][]) {
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
