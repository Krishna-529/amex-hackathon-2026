const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  const outputDir = path.join(__dirname, 'screenshots');
  fs.mkdirSync(outputDir, { recursive: true });

  console.log('Launching browser...');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  try {
    console.log('Navigating to http://localhost:5176/login...');
    await page.goto('http://localhost:5176/login', { timeout: 10000 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(outputDir, 'login.png') });

    console.log('Logging in...');
    await page.fill('input[type=email]', 'priya@zkd.demo');
    await page.fill('input[type=password]', 'priya-2026');
    await page.click('button[type=submit]');
    await page.waitForURL('**/flights', { timeout: 10000 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(outputDir, 'flights.png') });

    console.log('Navigating to /ops...');
    await page.goto('http://localhost:5176/ops', { timeout: 10000 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(outputDir, 'ops.png') });

    console.log('Screenshots captured successfully in zkd-app/screenshots/');
  } catch (err) {
    console.error('Capture error:', err);
  } finally {
    await browser.close();
  }
})();
