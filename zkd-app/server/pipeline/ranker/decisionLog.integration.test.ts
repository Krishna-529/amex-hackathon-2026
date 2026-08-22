/**
 * Proves the ranker decision log actually reaches a real Postgres database
 * and reads back what it wrote — same convention as
 * server/decisionLedger.integration.test.ts. Requires DATABASE_URL; skips
 * itself entirely otherwise.
 *
 * decisionLog.ts had zero test coverage before this file, despite being the
 * only source of training data for train.ts.
 */
import { describe, test, expect } from 'vitest';

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)('decisionLog.ts against real Postgres', () => {
  test('logShownSet reaches a real row, and loadShownSetsFromDb reads it back', async () => {
    const { logShownSet, loadShownSetsFromDb } = await import('./decisionLog.ts');

    const decisionId = `test-shown-${Date.now()}`;
    const flightId = `test-flight-${Date.now()}`;
    logShownSet({
      decisionId,
      flightId,
      memberId: 'member-test',
      strategy: 'earliest_arrival',
      weightsVersion: 1,
      weights: {} as never,
      candidates: [
        {
          altId: 'alt-1',
          code: 'AA100',
          features: {} as never,
          bookability: 0.9,
          utility: 1.2,
          rank: 0,
          propensity: 0.5,
        },
      ],
    });

    await new Promise((r) => setTimeout(r, 200));

    const shown = await loadShownSetsFromDb();
    const match = shown.find((s) => s.decisionId === decisionId);
    expect(match).toBeDefined();
    expect(match?.flightId).toBe(flightId);
    expect(match?.candidates).toHaveLength(1);
    expect(match?.candidates[0].altId).toBe('alt-1');
  });

  test('logChoice reaches a real row, and loadChoicesFromDb reads it back', async () => {
    const { logChoice, loadChoicesFromDb } = await import('./decisionLog.ts');

    const decisionId = `test-choice-${Date.now()}`;
    const flightId = `test-flight-${Date.now()}`;
    logChoice({
      decisionId,
      flightId,
      memberId: 'member-test',
      chosenAltId: 'alt-1',
      by: 'approve',
      bookedOk: true,
    });

    await new Promise((r) => setTimeout(r, 200));

    const choices = await loadChoicesFromDb();
    const match = choices.find((c) => c.decisionId === decisionId);
    expect(match).toBeDefined();
    expect(match?.chosenAltId).toBe('alt-1');
    expect(match?.bookedOk).toBe(true);
  });

  test('a log write failure never throws back into the caller (fire-and-forget contract)', async () => {
    const { logShownSet } = await import('./decisionLog.ts');
    expect(() =>
      logShownSet({
        decisionId: '',
        flightId: '',
        memberId: '',
        strategy: '',
        weightsVersion: NaN,
        weights: {} as never,
        candidates: [],
      }),
    ).not.toThrow();
  });
});
