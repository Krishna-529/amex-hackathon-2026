import { describe, expect, it } from 'vitest';
import { BUNDLES, compensationFor, owed } from './entitlement';
import { jurisdictionFor, distanceKm } from '@/server/airportDirectory';
import { airport } from '@/server/airportDirectory';

/**
 * Real routes, real coordinates — distances come from the repo's own
 * distanceKm() rather than being written down here, so a change to the airport
 * data or the formula surfaces as a failure instead of silently drifting away
 * from the band boundaries these assertions depend on.
 */
function km(from: string, to: string): number {
  const a = airport(from);
  const b = airport(to);
  if (!a || !b) throw new Error(`missing airport in test data: ${from} or ${to}`);
  return distanceKm(a, b);
}

describe('jurisdictionFor', () => {
  it('routes each departure to its own regime', () => {
    expect(jurisdictionFor('LHR', 'CDG')).toBe('UK261');
    expect(jurisdictionFor('CDG', 'MAD')).toBe('EU261');
    expect(jurisdictionFor('JFK', 'LAX')).toBe('US-DOT');
    expect(jurisdictionFor('DEL', 'BOM')).toBe('IN-DGCA');
  });

  it('falls back to card terms where no statutory regime applies', () => {
    expect(jurisdictionFor('DXB', 'SIN')).toBe('CARD-TERMS');
  });

  it('lets the departure rule win over the arrival', () => {
    // DEL->LHR is an Indian departure. DGCA governs it; UK261 does not attach
    // to a departure from outside the UK.
    expect(jurisdictionFor('DEL', 'LHR')).toBe('IN-DGCA');
  });

  it('keeps the UK on sterling rather than folding it into the euro bundle', () => {
    // The whole reason UK261 is a separate regime: same structure, different
    // money. A UK departure paying EUR would be wrong by ~15%.
    expect(BUNDLES[jurisdictionFor('LHR', 'JFK')].currency).toBe('GBP');
  });

  it('covers the French outermost regions, which the dataset files separately', () => {
    // These carry their own country names in server/airports.json, so without
    // an explicit entry they would silently fall through to CARD-TERMS.
    expect(jurisdictionFor('PTP', 'CDG')).toBe('EU261'); // Guadeloupe
    expect(jurisdictionFor('RUN', 'CDG')).toBe('EU261'); // Reunion
  });
});

describe('compensationFor — distance banding', () => {
  it('picks the right band on real EU and UK routes', () => {
    expect(compensationFor('UK261', km('LHR', 'CDG'))).toEqual({ amount: 220, currency: 'GBP' });
    expect(compensationFor('UK261', km('LHR', 'ATH'))).toEqual({ amount: 350, currency: 'GBP' });
    expect(compensationFor('UK261', km('LHR', 'JFK'))).toEqual({ amount: 520, currency: 'GBP' });

    expect(compensationFor('EU261', km('CDG', 'MAD'))).toEqual({ amount: 250, currency: 'EUR' });
    expect(compensationFor('EU261', km('CDG', 'CAI'))).toEqual({ amount: 400, currency: 'EUR' });
    expect(compensationFor('EU261', km('FRA', 'JFK'))).toEqual({ amount: 600, currency: 'EUR' });
  });

  it('treats band edges as inclusive, at exactly 1500 and exactly 3500', () => {
    // The boundaries are the only place an off-by-one changes a real payout,
    // so they get asserted directly rather than via a route that happens to
    // land near them.
    expect(compensationFor('EU261', 1500)?.amount).toBe(250);
    expect(compensationFor('EU261', 1500.01)?.amount).toBe(400);
    expect(compensationFor('EU261', 3500)?.amount).toBe(400);
    expect(compensationFor('EU261', 3500.01)?.amount).toBe(600);
  });

  it('never converts currency', () => {
    // Sterling and euro figures coexist and stay in their own money. This
    // codebase refuses invented FX by design.
    expect(compensationFor('UK261', 1000)?.currency).toBe('GBP');
    expect(compensationFor('EU261', 1000)?.currency).toBe('EUR');
  });

  it('returns null where no banded figure is encoded — not zero', () => {
    // null and 0 mean different things. US-DOT has no statutory cash
    // compensation at all; DGCA has compensation but bands it by block time
    // and fare, which this distance field cannot express.
    expect(compensationFor('US-DOT', 5000)).toBeNull();
    expect(compensationFor('IN-DGCA', 5000)).toBeNull();
    expect(compensationFor('CARD-TERMS', 5000)).toBeNull();
  });
});

describe('owed', () => {
  const base = { delayHours: 8, overnight: true, forceMajeure: false };

  it('gives US DOT a refund and nothing else', () => {
    // The failure this guards: pattern-matching US-DOT to EU261 and promising
    // meals, a hotel and cash that no US regulation requires.
    const items = owed({ ...base, jurisdiction: 'US-DOT' });
    expect(items).toEqual(['alt-flight-or-refund']);
    expect(items).not.toContain('cash-compensation');
    expect(items).not.toContain('hotel');
    expect(items).not.toContain('meals');
  });

  it('applies US DOT\'s longer international threshold', () => {
    // 3h domestic, 6h international — the only regime here that distinguishes.
    const at4h = { jurisdiction: 'US-DOT' as const, delayHours: 4, overnight: false, forceMajeure: false };
    expect(owed({ ...at4h })).toContain('alt-flight-or-refund');
    expect(owed({ ...at4h, international: true })).not.toContain('alt-flight-or-refund');
  });

  it('gives UK261 the same items as EU261', () => {
    expect(owed({ ...base, jurisdiction: 'UK261' }).sort()).toEqual(
      owed({ ...base, jurisdiction: 'EU261' }).sort(),
    );
  });

  it('still removes cash under force majeure, but keeps the duty of care', () => {
    const fm = owed({ ...base, jurisdiction: 'UK261', forceMajeure: true });
    expect(fm).not.toContain('cash-compensation');
    expect(fm).toContain('meals');
    expect(fm).toContain('hotel');
  });

  it('withholds a hotel when the delay does not run across a night', () => {
    expect(owed({ ...base, jurisdiction: 'EU261', overnight: false })).not.toContain('hotel');
  });
});

describe('bundle integrity', () => {
  it('is exhaustive over Jurisdiction and self-consistent', () => {
    for (const [key, bundle] of Object.entries(BUNDLES)) {
      expect(bundle.id).toBe(key); // a copy-paste id mismatch would misattribute a claim
      expect(bundle.citation.length).toBeGreaterThan(0);
      expect(['verified', 'assumed', 'deck']).toContain(bundle.evidenceTier);
    }
  });

  it('keeps compensation bands ascending, with an unbounded top band', () => {
    for (const bundle of Object.values(BUNDLES)) {
      if (!bundle.compensation) continue;
      const maxes = bundle.compensation.map((b) => b.maxKm);
      expect(maxes[maxes.length - 1]).toBeNull(); // or a long-haul route matches nothing
      const bounded = maxes.slice(0, -1) as number[];
      expect([...bounded].sort((a, b) => a - b)).toEqual(bounded);
    }
  });

  it('claims nothing as verified — no primary text was re-retrieved', () => {
    // Guards against someone quietly upgrading a tier without doing the work.
    expect(Object.values(BUNDLES).every((b) => b.evidenceTier !== 'verified')).toBe(true);
  });
});
