const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  const outputDir = path.resolve(__dirname, '../../assets/media/ui-recordings');
  fs.mkdirSync(outputDir, { recursive: true });

  console.log('Launching browser for ZKD Concierge UI recording...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: {
      dir: outputDir,
      size: { width: 1440, height: 900 }
    }
  });

  const page = await context.newPage();

  try {
    console.log('1. Navigating to login...');
    await page.goto('http://localhost:5176/login', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);

    const emailInput = await page.$('input[type=email]');
    if (emailInput) {
      await emailInput.fill('priya@zkd.demo');
      await page.fill('input[type=password]', 'priya-2026');
      await page.click('button[type=submit]');
      await page.waitForURL('**/flights', { timeout: 15000 });
      console.log('Logged in successfully as Priya.');
      await page.waitForTimeout(2000);
    }

    console.log('2. Viewing flights dashboard...');
    await page.goto('http://localhost:5176/flights', { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    console.log('3. Clicking into flight detail...');
    const flightRow = await page.$('.uprow, a[href*="/flights/"]');
    if (flightRow) {
      await flightRow.click();
      await page.waitForTimeout(4000);
    } else {
      await page.goto('http://localhost:5176/flights/fl-bom-del-1', { waitUntil: 'networkidle' });
      await page.waitForTimeout(4000);
    }

    console.log('4. Visiting Operator Console (/ops)...');
    await page.goto('http://localhost:5176/ops', { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    console.log('5. Visiting recovery / how it works...');
    await page.goto('http://localhost:5176/how-it-works', { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    console.log('Recording completed successfully.');
  } catch (err) {
    console.error('Error during recording:', err);
  } finally {
    await browser.close();
    console.log(`Video recordings saved to: ${outputDir}`);
  }
})();
