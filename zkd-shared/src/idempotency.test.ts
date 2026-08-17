import { describe, expect, it } from 'vitest';
import { deriveIdempotencyKey } from './idempotency';

describe('deriveIdempotencyKey', () => {
  const base = { pnr: 'ABC123', segment: 'flt-9021', memberId: 'mem-1', intent: 'recover-cancellation' };

  it('is deterministic — same business entity, same key, called any number of times', () => {
    const keys = Array.from({ length: 5 }, () => deriveIdempotencyKey(base));
    expect(new Set(keys).size).toBe(1);
  });

  it('is stable across process runs (no time/random component) — the whole point of not deriving from a workflow run', () => {
    // A key computed "now" must equal a key computed from the same inputs
    // regardless of when it's computed — this is what lets a retry after
    // escalation resolve to the SAME Temporal workflowId instead of minting
    // a second real booking (03-action-policy.md §6).
    expect(deriveIdempotencyKey(base)).toBe(deriveIdempotencyKey({ ...base }));
  });

  it('differs when the PNR differs', () => {
    expect(deriveIdempotencyKey(base)).not.toBe(deriveIdempotencyKey({ ...base, pnr: 'XYZ999' }));
  });

  it('differs when the segment differs — a party with two legs must not share one key', () => {
    expect(deriveIdempotencyKey(base)).not.toBe(deriveIdempotencyKey({ ...base, segment: 'flt-9022' }));
  });

  it('differs when the member differs', () => {
    expect(deriveIdempotencyKey(base)).not.toBe(deriveIdempotencyKey({ ...base, memberId: 'mem-2' }));
  });

  it('differs when the intent differs — bumping intent is the sanctioned way to mint a genuinely new attempt', () => {
    expect(deriveIdempotencyKey(base)).not.toBe(deriveIdempotencyKey({ ...base, intent: 'recover-cancellation-v2' }));
  });

  it('is prefixed and fixed-length, safe to use directly as a Temporal workflowId', () => {
    const key = deriveIdempotencyKey(base);
    expect(key).toMatch(/^recovery-[0-9a-f]{32}$/);
  });
});
