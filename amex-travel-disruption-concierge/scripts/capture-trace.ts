/**
 * Best-effort automatic capture of temporal-trace.png from the Temporal Web UI.
 *
 * This is the most valuable artefact in the deck, so it comes from the real
 * recorded workflow history, not a mockup. It switches the Event History to
 * Compact + Ascending so the saga reads top-to-bottom: A1→A4, the
 * CarrierUnavailableError on bookGround, then C4→C3→C2→C1 unwinding.
 *
 * You can always retake it by hand — `npm run demo:fail` prints the direct URL.
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { TEMPORAL_UI } from '../src/scenario';
import { C } from '../src/report';

const ARTIFACTS = join(__dirname, '..', 'artifacts');
const WORKFLOW_ID = process.env.TRACE_WORKFLOW_ID ?? 'concierge-6JQ8XZ-rollback';

/** Compensations, in the order they must appear going down the page. */
const LIFO = ['cancelGround', 'cancelHotel', 'voidFlight', 'releaseVAN'];

export async function captureTrace(): Promise<string> {
  mkdirSync(ARTIFACTS, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1450 }, deviceScaleFactor: 2 });
    await page.goto(`${TEMPORAL_UI}/namespaces/default/workflows/${encodeURIComponent(WORKFLOW_ID)}`, {
      waitUntil: 'domcontentloaded',
    });

    // The workflow URL redirects to /<runId>/timeline; swap the tab in the URL
    // rather than clicking, which is stable across UI versions.
    await page.waitForURL(/\/(timeline|history)(\?|$)/, { timeout: 30_000 });
    await page.goto(page.url().replace(/\/timeline(\?.*)?$/, '/history'), { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    await page.getByText('Compact', { exact: true }).first().click({ timeout: 30_000 });
    await page.waitForTimeout(1500);

    // The sort control is a toggle: one click flips Descending -> Ascending.
    const sort = page.getByRole('button', { name: /Descending/i }).first();
    if (await sort.count()) {
      await sort.click();
      await page.waitForTimeout(1500);
    }

    await page.waitForFunction(
      (names) => names.every((n) => document.body.innerText.includes(n)),
      LIFO,
      { timeout: 45_000 },
    );

    // Refuse to ship a screenshot that doesn't actually show the LIFO unwind.
    const text = await page.evaluate(() => document.body.innerText);
    const positions = LIFO.map((n) => text.indexOf(n));
    const inOrder = positions.every((p, i) => i === 0 || p > positions[i - 1]);
    if (!inOrder) {
      throw new Error(`Compensations are not rendering in LIFO order: ${LIFO.join(' → ')}`);
    }
    if (!text.includes('bookGround')) throw new Error('bookGround (the failed activity) is not visible.');

    await page.waitForTimeout(800);
    const path = join(ARTIFACTS, 'temporal-trace.png');
    await page.screenshot({ path, fullPage: true });
    return path;
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  captureTrace()
    .then((p) => {
      console.log(`  ${C.green}✓${C.reset} ${p}  ${C.grey}A1→A4 · CarrierUnavailableError · C4→C3→C2→C1${C.reset}`);
      process.exit(0);
    })
    .catch((err) => {
      console.error(`  trace capture failed — capture it by hand from the printed URL. (${err.message})`);
      process.exit(1);
    });
}
