import { describe, expect, it } from 'vitest';
import { convertAltsToBillingCurrency, dropFabricatedAlts } from './views';
import type { Alt } from './types';

describe('views currency conversion guard', () => {
  it('converts non-INR alts to INR (billing currency) and populates quoted', async () => {
    const alts: Alt[] = [
      {
        id: 'alt-1',
        code: 'AI 0603',
        dep: '10:00',
        arr: '12:00',
        cabin: 'Economy',
        seats: 9,
        fare: 42,
        currency: 'EUR',
        kind: 'market',
        ok: true,
        why: 'Test EUR offer',
        expiresAt: Date.now() + 3600000,
      },
      {
        id: 'alt-2',
        code: 'IX 9531',
        dep: '14:00',
        arr: '16:00',
        cabin: 'Economy',
        seats: 5,
        fare: 2150,
        currency: 'INR',
        kind: 'market',
        ok: true,
        why: 'Test INR offer',
        expiresAt: Date.now() + 3600000,
      },
    ];

    const converted = await convertAltsToBillingCurrency(alts);
    expect(converted).toHaveLength(2);
    expect(converted[1].currency).toBe('INR');
    expect(converted[1].fare).toBe(2150);

    expect(converted[0].currency).toBe('INR');
    expect(converted[0].fare).toBeGreaterThan(42); // 42 EUR converted to INR
    expect(converted[0].quoted).toBeDefined();
    expect(converted[0].quoted?.amount).toBe(42);
    expect(converted[0].quoted?.currency).toBe('EUR');
  });

  it('asserts all alts reaching view conversion have billing currency (INR)', async () => {
    const alts: Alt[] = [
      {
        id: 'alt-3',
        code: 'QP 232',
        dep: '08:00',
        arr: '10:00',
        cabin: 'Economy',
        seats: 8,
        fare: 5000,
        currency: 'INR',
        kind: 'market',
        ok: true,
        why: 'Already INR',
        expiresAt: Date.now() + 3600000,
      },
    ];
    const converted = await convertAltsToBillingCurrency(alts);
    for (const a of converted) {
      expect(a.currency).toBe('INR');
    }
  });
});

describe('fabricated alt guard', () => {
  const market = (over: Partial<Alt> = {}): Alt => ({
    id: 'alt-market', code: 'SG 2912', dep: '09:00', arr: '11:00', cabin: 'Economy',
    seats: 7, fare: 11330, currency: 'INR', kind: 'market', ok: true,
    why: 'A real offer', expiresAt: Date.now() + 3600000, ...over,
  });

  // The exact row that survived in Postgres on f-multi: a real offer cloned by
  // the deleted carrierProtectedAlt() and repriced to zero.
  const fabricated = {
    ...market({ id: 'cp-mock:DELBLR:2026-08-17:5', code: 'AI 415', fare: 0, seats: 99 }),
    kind: 'carrier-protected',
  } as unknown as Alt;

  it('drops a stale carrier-protected row and keeps the real offers', () => {
    const kept = dropFabricatedAlts([market(), fabricated]);
    expect(kept).toHaveLength(1);
    expect(kept[0].id).toBe('alt-market');
  });

  it('drops a free or impossibly-seated row even without the kind field', () => {
    const noKind = { ...market({ id: 'legacy', fare: 0, seats: 99 }) } as Record<string, unknown>;
    delete noKind.kind;
    expect(dropFabricatedAlts([noKind as unknown as Alt])).toHaveLength(0);
  });

  it('keeps an unusual but possible offer — cheap is not the same as fabricated', () => {
    expect(dropFabricatedAlts([market({ fare: 1, seats: 1 })])).toHaveLength(1);
  });
});
