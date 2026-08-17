import { describe, expect, it, beforeAll } from 'vitest';
import { existsSync, readFileSync, unlinkSync } from 'fs';
import { join } from 'path';

/**
 * Records real OAG route responses into server/oag-fixtures/ so the demo can
 * replay them forever afterwards, for free.
 *
 * oag.ts's replay error tells you to "record it once with OAG_REPLAY unset",
 * and until this existed there was no way to do that except hand-driving the
 * app against the live API — which is how an allowance gets spent by accident.
 * It lives next to oag.live.test.ts and is gated the same way, because it is
 * the same kind of thing: a deliberate, opt-in spend of real trial calls.
 *
 *   OAG_RECORD=1 OAG_RECORD_ROUTES=BOM-LHR-2026-08-24,DEL-JFK-2026-08-24 \
 *     npx vitest run server/oag.record.test.ts
 *
 * SPENDS ONE TRIAL CALL PER UNRECORDED ROUTE, out of 100 per 14-day window.
 * The cap itself is enforced inside oag.ts and is neither bypassed nor relaxed
 * here — this only refuses to start when the requested routes would not fit.
 *
 * Two behaviours worth knowing:
 *   - A route whose fixture already exists is skipped and costs nothing, so
 *     re-running this is safe.
 *   - A route that comes back with ZERO flights has its fixture deleted rather
 *     than left on disk. An empty fixture replays as "this route has no
 *     flights", which is precisely the silent-empty failure oag.ts throws to
 *     avoid.
 */
const RECORDING = process.env.OAG_RECORD === '1';

const FIXTURE_DIR = join(process.cwd(), 'server', 'oag-fixtures');

function parseSpec(spec: string): { from: string; to: string; date: string } {
  const m = spec.trim().toUpperCase().match(/^([A-Z]{3})-([A-Z]{3})-(\d{4}-\d{2}-\d{2})$/);
  if (!m) throw new Error(`bad route spec "${spec}" — expected e.g. BOM-LHR-2026-08-24`);
  return { from: m[1], to: m[2], date: m[3] };
}

describe.skipIf(!RECORDING)('OAG fixture recorder (spends real trial calls)', () => {
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
    // Recording against replay would just re-read what is already on disk.
    delete process.env.OAG_REPLAY;
  });

  it('records every requested route', async () => {
    const { flightInstancesByRoute, trialBudget } = await import('./oag');

    const specs = (process.env.OAG_RECORD_ROUTES ?? '').split(',').filter(Boolean);
    expect(specs.length, 'set OAG_RECORD_ROUTES=BOM-LHR-2026-08-24,...').toBeGreaterThan(0);
    const routes = specs.map(parseSpec);

    expect(
      process.env.OAG_FLIGHT_INFO_TRIAL_PRIMARY_KEY || process.env.OAG_FLIGHT_INFO_PRIMARY_KEY,
      'no OAG key in .env.local',
    ).toBeTruthy();

    const unrecorded = routes.filter(
      (r) => !existsSync(join(FIXTURE_DIR, `${r.from}-${r.to}-${r.date}.json`)),
    );
    const before = trialBudget();
    console.log(
      `[oag-record] budget before: ${before.remaining} remaining; ` +
        `${unrecorded.length} of ${routes.length} routes need a live call`,
    );
    expect(
      before.remaining >= unrecorded.length,
      `only ${before.remaining} trial calls remain but ${unrecorded.length} routes need recording`,
    ).toBe(true);

    for (const { from, to, date } of routes) {
      const fixture = join(FIXTURE_DIR, `${from}-${to}-${date}.json`);
      if (existsSync(fixture)) {
        console.log(`[oag-record] ${from}->${to} ${date}: already recorded, skipped (free)`);
        continue;
      }
      const rows = await flightInstancesByRoute(from, to, date);
      if (rows.length === 0) {
        if (existsSync(fixture)) unlinkSync(fixture);
        throw new Error(
          `${from}->${to} on ${date} returned 0 flights — fixture deleted so replay keeps failing ` +
            `loudly. Pick a denser route or a different date; the call is already spent.`,
        );
      }
      const carriers = [...new Set(rows.map((r) => r.carrierIata))].sort().join(', ');
      console.log(`[oag-record] ${from}->${to} ${date}: ${rows.length} flights (${carriers})`);
      expect(rows.every((r) => r.origin === from)).toBe(true);
      expect(rows.every((r) => r.destination === to)).toBe(true);
    }

    const after = trialBudget();
    console.log(
      `[oag-record] budget after: ${after.remaining} remaining ` +
        `(spent ${before.remaining - after.remaining})`,
    );
  }, 120_000);
});
