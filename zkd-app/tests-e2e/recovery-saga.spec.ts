import { test, expect } from '@playwright/test';

/**
 * Click-through proof of the whole pipeline described in
 * documentation/architecture/execution-plane.md: trigger a real disruption,
 * let the planning graph classify it and pick a candidate, let autopilot
 * consent resolve it without a window, and watch the REAL Temporal saga
 * (running in the docker-compose zkd-execute container, gated by the real
 * OPA sidecar) confirm the booking. Needs the full stack up
 * (`docker compose up`), not just `npm run dev` — the saga has nowhere to
 * run without a live Temporal + OPA + zkd-execute worker.
 *
 * Priya (seeded 'autopilot' consent) + flight u4 (6E 6155, BOM→GOI — seeded
 * specifically as "the one that shows the action", see server/domain/seed.ts)
 * is the fastest deterministic path through this: autopilot skips the
 * consent window entirely and acts the moment the disruption is detected.
 */
test('trigger a real disruption → real saga → confirmed booking', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/login');
  await page.getByPlaceholder('Email').fill('priya@zkd.demo');
  await page.getByPlaceholder('Password').fill('priya-2026');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/flights/);

  // Real candidates need a real supplier search, normally gated on the real
  // ML risk model crossing a threshold (server/engine/forecast.ts) — this
  // environment has no live scorer, so /ops's "Warm candidates" runs that
  // same real search on demand instead of waiting for a scorer this test
  // environment doesn't have (app/api/flights/[id]/warm/route.ts).
  await page.goto('/ops');
  const warmRow = page.locator('tr', { has: page.getByText('6E 6155') });
  await expect(warmRow).toBeVisible();
  await warmRow.getByRole('button', { name: /Warm candidates/ }).click();
  await expect(warmRow.getByRole('button', { name: /Warm candidates/ })).toBeVisible({ timeout: 20_000 });

  await expect
    .poll(
      async () => {
        const res = await page.request.get('/api/flights/u4');
        const json = await res.json();
        return json.candidates?.alts?.length ?? 0;
      },
      { timeout: 20_000, message: 'waiting for u4 alt candidates to warm' },
    )
    .toBeGreaterThan(0);

  await warmRow.getByRole('button', { name: /Trigger disruption/ }).click();
  await expect(warmRow.getByRole('button', { name: /Triggered/ })).toBeVisible({ timeout: 15_000 });

  await page.goto('/recovery/u4');

  // The real saga round-trips through zkd-execute → Temporal → OPA → the
  // (mocked-fallback) suppliers and back — genuinely slower than the old
  // fixed-timer narration, hence the generous timeout. Asserting on the
  // saga's own note (server/engine/simulation.ts's runRecoverySaga) rather
  // than the "Your trip now" panel — that panel additionally needs a hotel
  // AND a cab candidate warmed too (groundCache.ts), which "Warm candidates"
  // above doesn't guarantee finished within the poll window; the note text
  // is the direct, unambiguous proof the saga itself reached CONFIRMED.
  await expect(page.getByText(/Booked, for real — the saga confirmed every step/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Seat booked/).first()).toBeVisible();
  await expect(page.getByText(/Original ticket disposed/).first()).toBeVisible();
});

/**
 * The rollback path: an INJECT-FAIL- marked candidate makes the real saga
 * fail deliberately (zkd-execute/src/failureInjection.ts), forcing a genuine
 * LIFO compensation through the real Temporal workflow — this is what proves
 * ROLLED_BACK is a reachable, correctly-wired outcome in the running app, not
 * just something recoverySaga.test.ts exercises in isolation.
 *
 * This scenario needs a seeded candidate whose supplierOfferId is prefixed
 * INJECT-FAIL- to exist in the demo data; if the seed set doesn't include
 * one, this test is a template for wiring one in rather than a claim that
 * it passes today — see server/domain/seed.ts.
 */
test.skip('a booking step marked to fail rolls back cleanly through the real saga', async ({ page }) => {
  // Intentionally skipped until an INJECT-FAIL- seeded candidate exists —
  // see the file-level comment. Wiring one in is a small seed.ts addition
  // (one candidate's supplierOfferId), not a app-logic change.
});
