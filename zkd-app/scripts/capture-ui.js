const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  const shotsDir = path.resolve(__dirname, '../../assets/media/ui-screenshots');
  fs.mkdirSync(shotsDir, { recursive: true });

  console.log('Launching browser to capture ZKD Concierge UI screenshots...');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  try {
    console.log('1. Capturing login page...');
    await page.goto('http://localhost:5176/login', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(shotsDir, '01-login.png'), fullPage: false });

    console.log('2. Logging in as Priya...');
    const emailInput = await page.$('input[type=email]');
    if (emailInput) {
      await emailInput.fill('priya@zkd.demo');
      await page.fill('input[type=password]', 'priya-2026');
      await page.click('button[type=submit]');
      await page.waitForURL('**/flights', { timeout: 15000 });
      await page.waitForTimeout(1500);
      await page.screenshot({ path: path.join(shotsDir, '02-flights-dashboard.png'), fullPage: false });
      console.log('Captured flights dashboard.');
    }

    console.log('3. Capturing operator console (/ops)...');
    await page.goto('http://localhost:5176/ops', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(shotsDir, '03-operator-console.png'), fullPage: false });

    console.log('4. Capturing how-it-works page...');
    await page.goto('http://localhost:5176/how-it-works', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(shotsDir, '04-how-it-works.png'), fullPage: false });

    console.log(`All UI screenshots saved successfully to: ${shotsDir}`);
  } catch (err) {
    console.error('Error capturing UI:', err);
  } finally {
    await browser.close();
  }
})();
