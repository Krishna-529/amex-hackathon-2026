import { describe, expect, it, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * A REAL call to OAG. Skipped unless `OAG_LIVE=1`, because every run spends one
 * of a hard-capped 100 trial calls per 14-day window — a test that quietly
 * drains the allowance during CI is worse than no test.
 *
 *   OAG_LIVE=1 npx vitest run server/oag.live.test.ts
 *
 * What it proves that no mock can: that the URL this module builds is one OAG
 * actually accepts. The query shape was wrong for months precisely because it
 * was only ever checked against our own assumptions.
 */
const LIVE = process.env.OAG_LIVE === '1';

describe.skipIf(!LIVE)('OAG flight-instances (live)', () => {
  beforeAll(() => {
    // vitest does not load .env.local the way Next does.
    try {
      const raw = readFileSync(join(process.cwd(), '.env.local'), 'utf-8');
      for (const line of raw.split('\n')) {
        const m = line.match(/^([A-Z_0-9]+)=(.*)$/);
        if (m && m[2].trim() && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
      }
    } catch {
      // Falls through to the assertion below, which reports it clearly.
    }
  });

  it('returns real instances for a dense route', async () => {
    const { flightInstancesByRoute, trialBudget } = await import('./oag');

    expect(
      process.env.OAG_FLIGHT_INFO_TRIAL_PRIMARY_KEY || process.env.OAG_FLIGHT_INFO_PRIMARY_KEY,
    ).toBeTruthy();

    const before = trialBudget().remaining;

    // A week out on a dense trunk route: an empty result here means the query
    // is wrong, not that the route is thin.
    const date = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
    const rows = await flightInstancesByRoute('BOM', 'DEL', date);

    expect(rows.length).toBeGreaterThan(0);
    const f = rows[0];
    expect(f.carrierIata).toMatch(/^[A-Z0-9]{2}$/);
    expect(f.origin).toBe('BOM');
    expect(f.destination).toBe('DEL');
    expect(f.flightNumber).toBeTruthy();

    // The budget must actually have moved — proving the trial key was used and
    // counted, which is the guard that stops the allowance vanishing silently.
    expect(trialBudget().remaining).toBeLessThan(before);
  }, 30_000);
});
