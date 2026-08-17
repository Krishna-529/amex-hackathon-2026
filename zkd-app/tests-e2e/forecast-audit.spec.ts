import { test, expect } from '@playwright/test';

/**
 * The real happy path this session verified by hand in a live browser:
 * sign in as a real seeded passenger, see a real flight with a real
 * forecast, open the audit panel, and force a real reverify. Every
 * assertion below checks something the real backend actually computed —
 * there is nothing here a canned fixture could fake, since RISK_MODEL_URL
 * points at the real scorer (see .github/workflows/ci.yml).
 */
test('login → real flight forecast → real audit panel → real reverify', async ({ page }) => {
  await page.goto('/login');
  await page.getByPlaceholder('Email').fill('priya@zkd.demo');
  await page.getByPlaceholder('Password').fill('priya-2026');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page).toHaveURL(/\/flights/);
  await expect(page.getByText('Your flights')).toBeVisible();

  // The seeded "u1" flight (AI 2803, MAA→DEL) always has a real upcoming
  // forecast — its row is the one real <Link> in the flight list.
  await page.getByRole('link', { name: /AI 2803/ }).click();
  await expect(page.getByText('cancel risk')).toBeVisible();

  // A real percentage, not a placeholder — the gauge only ever renders a
  // number once a real ModelScore came back (server/engine/forecast.ts).
  const gaugeValue = page.locator('.val .n');
  await expect(gaugeValue).toBeVisible();
  await expect(gaugeValue).toContainText('%');

  // The audit panel — real history chart + real explanation + reverify.
  await expect(page.getByRole('heading', { name: 'Prediction history' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Why this number/ })).toBeVisible();

  const reverifyButton = page.getByRole('button', { name: /Reverify now/ });
  await reverifyButton.click();
  // Real network round-trip to POST /api/flights/[id]/reverify — wait for
  // the real result, not a fixed sleep.
  await expect(page.getByText('Previous → current')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Model / config')).toBeVisible();
});
