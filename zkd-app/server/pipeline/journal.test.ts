/**
 * `journal.ts` had zero test coverage before this file, despite `transition()`
 * being the exact function this session's audit found a real double-booking
 * bug in. Regression coverage for that fix: a second call to
 * `transition(run, 'CONFIRMED', ...)` when the run is already CONFIRMED must
 * be REJECTED (ok:false), not silently treated as a harmless no-op — because
 * `pipeline/index.ts`'s `execute()` reads `!transition(...).ok` as its ONLY
 * guard against running the booking saga twice. Before the fix, this exact
 * scenario (reachable when a member's "Approve" click and their own consent
 * window's expiry timer fire within the same tick) let `execute()` run the
 * full saga twice for the same recovery.
 */
import { describe, it, expect } from 'vitest';
import { transition } from './journal.ts';
import type { PipelineRun, PipelineState } from './types.ts';

function runAt(state: PipelineState): PipelineRun {
  const now = Date.now();
  return {
    id: 'pr-test:test',
    flightId: 'test',
    passengerId: 'test',
    state,
    startedAt: now,
    changedAt: now,
    replans: 0,
    plan: null,
    sources: {},
    committed: [],
    orphans: [],
    mutationsEnabled: false,
    journal: [],
  };
}

describe('transition: CONFIRMED cannot be re-entered', () => {
  it('the first HOLD_PENDING -> CONFIRMED transition succeeds', () => {
    const run = runAt('HOLD_PENDING');
    const result = transition(run, 'CONFIRMED', 'consent recorded: approve');
    expect(result.ok).toBe(true);
    expect(run.state).toBe('CONFIRMED');
  });

  it('REGRESSION: a second CONFIRMED->CONFIRMED transition on an already-confirmed run is rejected, not silently ok', () => {
    const run = runAt('CONFIRMED'); // already confirmed by an earlier call
    const result = transition(run, 'CONFIRMED', 'consent recorded: approve (duplicate)');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('illegal transition');
  });

  it('a same-state transition to anything OTHER than HOLD_PENDING/CONFIRMED is still a harmless no-op', () => {
    // The short-circuit this fix narrowed, not removed — a legitimate
    // repeat entry into a state that genuinely is idempotent (e.g. a
    // terminal/fallback state re-touched by a retried caller) must still
    // succeed rather than start rejecting things that were never the bug.
    const run = runAt('FAILED_FALLBACK');
    const result = transition(run, 'FAILED_FALLBACK', 'retry after an already-terminal fallback');
    expect(result.ok).toBe(true);
  });

  it('HOLD_PENDING remains re-enterable (a re-plan is a real, meaningful transition each time)', () => {
    const run = runAt('HOLD_PENDING');
    const result = transition(run, 'HOLD_PENDING', 're-planned after a price change');
    // Not asserting true/false here — HOLD_PENDING's own re-entry semantics
    // are unchanged by this fix, which only narrowed the short-circuit to
    // also exclude CONFIRMED. This test exists so a future change to
    // HOLD_PENDING's behaviour shows up as an intentional diff, not a
    // silent regression alongside the CONFIRMED fix.
    expect(result.ok).toBe(true);
  });
});
