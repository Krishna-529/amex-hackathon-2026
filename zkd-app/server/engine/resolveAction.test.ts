/**
 * The consent endpoint approves spend, and its body used to arrive as a cast:
 * `(await req.json()) as { action: ResolveAction }`. A cast checks nothing at
 * runtime, so `{action:{kind:'choose'}}` with no altId reached resolveTask as a
 * well-typed lie, and an unknown `kind` fell through its switch doing nothing
 * while the endpoint still answered 200.
 */
import { describe, test, expect } from 'vitest';
import { isResolveAction } from './simulation';

describe('isResolveAction', () => {
  test('accepts every payload-free variant', () => {
    for (const kind of ['approve', 'hand-over', 'browse', 'back']) {
      expect(isResolveAction({ kind })).toBe(true);
    }
  });

  test('accepts the variants that carry an id', () => {
    expect(isResolveAction({ kind: 'choose', altId: 'a1' })).toBe(true);
    expect(isResolveAction({ kind: 'swap-hotel', hotelId: 'h1' })).toBe(true);
    expect(isResolveAction({ kind: 'swap-cab', cabId: 'c1' })).toBe(true);
  });

  test('rejects an id-carrying variant whose id is missing or empty', () => {
    expect(isResolveAction({ kind: 'choose' })).toBe(false);
    expect(isResolveAction({ kind: 'choose', altId: '' })).toBe(false);
    expect(isResolveAction({ kind: 'swap-hotel', hotelId: 42 })).toBe(false);
    expect(isResolveAction({ kind: 'swap-cab', cabId: null })).toBe(false);
  });

  test('rejects an unknown or absent kind', () => {
    expect(isResolveAction({ kind: 'refund-me' })).toBe(false);
    expect(isResolveAction({})).toBe(false);
    expect(isResolveAction({ kind: 42 })).toBe(false);
  });

  test('rejects non-objects', () => {
    for (const v of [null, undefined, 'approve', 7, [], true]) {
      expect(isResolveAction(v)).toBe(false);
    }
  });
});
