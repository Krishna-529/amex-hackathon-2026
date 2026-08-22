/**
 * Proves the decision ledger actually reaches a real Postgres database, not
 * just that it typechecks — same convention as
 * server/domain/store.integration.test.ts. Requires DATABASE_URL; skips
 * itself entirely otherwise.
 *
 * decisionLedger.ts had zero test coverage before this file, despite this
 * session's own audit describing it as making the single strongest claim
 * in the product ("we warned you in advance") falsifiable if broken.
 */
import { describe, test, expect } from 'vitest';

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)('decisionLedger.ts against real Postgres', () => {
  test('logPrediction reaches a real row in decision_ledger, fire-and-forget', async () => {
    const { logPrediction } = await import('./decisionLedger');
    const { sql, ensureReady } = await import('./domain/db');
    await ensureReady();

    const flightId = `test-ledger-pred-${Date.now()}`;
    logPrediction(flightId, {
      cancelProbability: 0.042,
      confidence: 0.8,
      modelVersion: 'test-model-v1',
      source: 'internal-ml',
    } as never);

    // Fire-and-forget — give the write a real tick to land before querying
    // the table it wrote to, rather than racing it.
    await new Promise((r) => setTimeout(r, 200));

    const rows = await sql<{ kind: string; flight_id: string; data: unknown }[]>`
      select kind, flight_id, data from decision_ledger where flight_id = ${flightId}
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('prediction');
    expect((rows[0].data as { cancelProbability: number }).cancelProbability).toBe(0.042);
  });

  test('logNotification and logMemberReport both reach real, independently-queryable rows', async () => {
    const { logNotification, logMemberReport } = await import('./decisionLedger');
    const { sql, ensureReady } = await import('./domain/db');
    await ensureReady();

    const flightId = `test-ledger-multi-${Date.now()}`;
    logNotification({ flightId, kind: 'cancelled', passengerId: 'p-test', delivered: true, channels: [] });
    logMemberReport({ flightId, passengerId: 'p-test', source: 'member', confirmed: false, reports: 1, evidence: ['test'] });

    await new Promise((r) => setTimeout(r, 200));

    const rows = await sql<{ kind: string }[]>`
      select kind from decision_ledger where flight_id = ${flightId} order by kind
    `;
    expect(rows.map((r) => r.kind)).toEqual(['member-report', 'notification']);
  });

  test('a ledger write failure never throws back into the caller (fire-and-forget contract)', async () => {
    const { logPrediction } = await import('./decisionLedger');
    // No await, no try/catch needed at the call site — this must not throw
    // synchronously even for a nonsense flightId, matching the "observability,
    // not the critical path" contract the module header states.
    expect(() =>
      logPrediction('', { cancelProbability: NaN, confidence: NaN, modelVersion: '', source: 'internal-ml' } as never),
    ).not.toThrow();
  });
});
