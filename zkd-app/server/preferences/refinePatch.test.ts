import { describe, expect, it } from 'vitest';
import { PreferencePatchSchema } from './refinePatch';

describe('PreferencePatchSchema', () => {
  it('accepts a minimal valid patch (rationale only)', () => {
    const result = PreferencePatchSchema.safeParse({ rationale: 'wants to get there sooner' });
    expect(result.success).toBe(true);
  });

  it('accepts every optional field populated correctly', () => {
    const result = PreferencePatchSchema.safeParse({
      rationale: 'avoid layovers, arrive early, skip SpiceJet',
      optimization_strategy: 'minimize_layovers',
      avoid_airlines_add: ['SG', 'G8'],
      arrival_before_local: '18:00',
      max_layovers: 0,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a missing rationale — the one required field', () => {
    expect(PreferencePatchSchema.safeParse({}).success).toBe(false);
  });

  it('rejects an unknown field — .strict() is the entire attack surface boundary', () => {
    const result = PreferencePatchSchema.safeParse({ rationale: 'ok', cabin_entitlement: 'First' });
    expect(result.success).toBe(false);
  });

  it('rejects an unrecognized optimization_strategy', () => {
    const result = PreferencePatchSchema.safeParse({ rationale: 'ok', optimization_strategy: 'business_only' });
    expect(result.success).toBe(false);
  });

  it('rejects a malformed arrival_before_local (not HH:mm 24h)', () => {
    expect(PreferencePatchSchema.safeParse({ rationale: 'ok', arrival_before_local: '6pm' }).success).toBe(false);
    expect(PreferencePatchSchema.safeParse({ rationale: 'ok', arrival_before_local: '25:00' }).success).toBe(false);
    expect(PreferencePatchSchema.safeParse({ rationale: 'ok', arrival_before_local: '18:00' }).success).toBe(true);
  });

  it('rejects more than 5 avoid_airlines_add entries', () => {
    const result = PreferencePatchSchema.safeParse({ rationale: 'ok', avoid_airlines_add: ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'] });
    expect(result.success).toBe(false);
  });

  it('rejects max_layovers outside 0-3', () => {
    expect(PreferencePatchSchema.safeParse({ rationale: 'ok', max_layovers: -1 }).success).toBe(false);
    expect(PreferencePatchSchema.safeParse({ rationale: 'ok', max_layovers: 4 }).success).toBe(false);
    expect(PreferencePatchSchema.safeParse({ rationale: 'ok', max_layovers: 2 }).success).toBe(true);
  });

  it('rejects a rationale over 200 characters', () => {
    const result = PreferencePatchSchema.safeParse({ rationale: 'x'.repeat(201) });
    expect(result.success).toBe(false);
  });
});
