/**
 * One tap must not be able to reschedule a planeload.
 *
 * These tests run with no AviationStack key and no seeded flight, which is the
 * least-evidence case: nothing corroborates, so nothing may be confirmed. That
 * is the state a hostile or bored tap arrives in, and it is the one worth
 * pinning — a regression that made an uncorroborated report `confirmed` would
 * start spending on strangers' cards.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { report, hasReported, reportersFor, _reset, INDEPENDENT_REPORTS_NEEDED } from './memberReports';

describe('a single member report', () => {
  beforeEach(() => _reset());

  it('is recorded but not confirmed on its own', async () => {
    const v = await report('f-1', 'p-priya');
    expect(v.reports).toBe(1);
    expect(v.confirmed).toBe(false);
  });

  it('says what evidence it weighed, so the decision can be explained back', async () => {
    const v = await report('f-1', 'p-priya');
    expect(v.evidence.join(' ')).toContain(`of ${INDEPENDENT_REPORTS_NEEDED} independent reports`);
  });

  it('counts once however many times the same person presses it', async () => {
    await report('f-1', 'p-priya');
    await report('f-1', 'p-priya');
    const v = await report('f-1', 'p-priya');
    expect(v.reports).toBe(1);
    expect(v.confirmed).toBe(false);
  });
});

describe('independent members agreeing', () => {
  beforeEach(() => _reset());

  it('is not enough one short of the threshold', async () => {
    for (let i = 1; i < INDEPENDENT_REPORTS_NEEDED; i += 1) {
      const v = await report('f-1', `p-${i}`);
      expect(v.confirmed).toBe(false);
    }
  });

  it('confirms once enough strangers say the same thing', async () => {
    let last;
    for (let i = 1; i <= INDEPENDENT_REPORTS_NEEDED; i += 1) {
      last = await report('f-1', `p-${i}`);
    }
    expect(last!.confirmed).toBe(true);
    expect(last!.evidence.join(' ')).toContain('independently');
  });

  it('keeps flights separate — reports on one do not corroborate another', async () => {
    for (let i = 1; i <= INDEPENDENT_REPORTS_NEEDED; i += 1) await report('f-1', `p-${i}`);
    const other = await report('f-2', 'p-9');
    expect(other.confirmed).toBe(false);
    expect(other.reports).toBe(1);
  });
});

describe('an operator outranks the ladder', () => {
  beforeEach(() => _reset());

  it('confirms immediately, without spending a status call', async () => {
    const v = await report('f-1', 'p-ops', 'ops');
    expect(v.confirmed).toBe(true);
    expect(v.evidence.join(' ')).toContain('operations console');
  });
});

describe('bookkeeping', () => {
  beforeEach(() => _reset());

  it('remembers who reported what', async () => {
    await report('f-1', 'p-priya');
    expect(hasReported('f-1', 'p-priya')).toBe(true);
    expect(hasReported('f-1', 'p-arjun')).toBe(false);
    expect(reportersFor('f-1')).toEqual(['p-priya']);
  });
});
