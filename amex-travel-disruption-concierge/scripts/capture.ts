/**
 * Produces dashboard.png and push.png headlessly at 2× pixel density.
 *
 * The dashboard is captured with a "why" chip already expanded — that chip,
 * showing the OPA rule path read out of the decision ledger, is the point of
 * the screenshot.
 *
 * temporal-trace.png is captured by hand from the Temporal Web UI; the
 * failure run prints its direct URL.
 */

import { chromium, Browser } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { WEB_PORT, API_PORT } from '../src/scenario';
import { C } from '../src/report';

const ARTIFACTS = join(__dirname, '..', 'artifacts');
const BASE = `http://127.0.0.1:${WEB_PORT}`;

/** Which timeline row is expanded in dashboard.png. */
const EXPANDED_ROW = process.env.EXPAND_ROW ?? 'MAA-DEL';

export async function capture(): Promise<void> {
  mkdirSync(ARTIFACTS, { recursive: true });

  // Fail loudly rather than screenshotting an empty dashboard.
  const probe = await fetch(`http://127.0.0.1:${API_PORT}/api/state`).then((r) => r.json() as Promise<any>);
  if (!probe.ok) throw new Error(`Ledger is empty (${probe.error}). Run \`npm run demo\` first.`);

  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true });

    // ---- dashboard.png -------------------------------------------------
    const dash = await browser.newPage({
      viewport: { width: 1440, height: 1180 },
      deviceScaleFactor: 2,
      colorScheme: 'dark',
    });
    await dash.goto(`${BASE}/?view=dashboard&capture=1&expand=${EXPANDED_ROW}`, { waitUntil: 'networkidle' });
    await dash.waitForSelector('#dashboard-root .receipt .rule-path', { timeout: 20_000 });

    const rulePath = (await dash.textContent('#dashboard-root .receipt .rule-path'))?.trim();
    const expandedChips = await dash.locator('.why-chip[aria-expanded="true"]').count();
    if (!rulePath) throw new Error('No rule path rendered — the receipt is empty.');
    if (expandedChips !== 1) throw new Error(`Expected exactly 1 expanded why chip, found ${expandedChips}.`);

    await dash.locator('#dashboard-root').screenshot({ path: join(ARTIFACTS, 'dashboard.png') });
    console.log(`  ${C.green}✓${C.reset} artifacts/dashboard.png  ${C.grey}chip expanded → ${rulePath}${C.reset}`);
    await dash.close();

    // ---- push.png (9:16) -----------------------------------------------
    const phone = await browser.newPage({
      viewport: { width: 540, height: 960 },
      deviceScaleFactor: 2,
      colorScheme: 'dark',
    });
    await phone.goto(`${BASE}/?view=push&capture=1`, { waitUntil: 'networkidle' });
    await phone.waitForSelector('#phone-stage .btn-primary', { timeout: 20_000 });

    const cta = (await phone.textContent('#phone-stage .btn-primary'))?.trim();
    const cancelled = (await phone.textContent('#phone-stage .leg-strip .route'))?.trim();
    if (!cta || !cancelled) throw new Error('Push frame is missing its cancelled leg or its control.');

    await phone.locator('#phone-stage').screenshot({ path: join(ARTIFACTS, 'push.png') });
    console.log(
      `  ${C.green}✓${C.reset} artifacts/push.png       ${C.grey}1080×1920 (9:16) · "${cancelled}" · "${cta}"${C.reset}`,
    );
    await phone.close();
  } finally {
    await browser?.close();
  }
}

if (require.main === module) {
  capture()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('capture failed:', err);
      process.exit(1);
    });
}
