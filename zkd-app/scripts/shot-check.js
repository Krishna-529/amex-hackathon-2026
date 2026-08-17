const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const shots = '/tmp/zkd-shots';
  require('fs').mkdirSync(shots, { recursive: true });

  await page.goto('http://localhost:5176/', { waitUntil: 'networkidle' });
  await page.screenshot({ path: `${shots}/home-anon.png`, fullPage: false });

  await page.goto('http://localhost:5176/login', { waitUntil: 'networkidle' });
  await page.screenshot({ path: `${shots}/login.png`, fullPage: false });

  const res = await page.goto('http://localhost:5176/flights', { waitUntil: 'networkidle' });
  console.log('flights anon status', res.status(), res.url());

  await page.goto('http://localhost:5176/login', { waitUntil: 'networkidle' });
  const emails = await page.$$('input[type=email]');
  if (emails.length) {
    await emails[0].fill('priya@zkd.demo');
    await page.fill('input[type=password]', 'priya-2026');
    await page.click('button[type=submit]');
    await page.waitForURL('**/flights', { timeout: 15000 });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${shots}/flights-auth.png`, fullPage: false });
    console.log('authenticated flights OK', page.url());

    const detailLink = await page.$('.uprow');
    if (detailLink) {
      await detailLink.click();
      await page.waitForTimeout(2500);
      await page.screenshot({ path: `${shots}/flight-detail.png`, fullPage: false });
      console.log('detail URL', page.url());
    }

    await page.goto('http://localhost:5176/how-it-works', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${shots}/how-it-works.png`, fullPage: false });
    console.log('how-it-works OK');
  } else {
    console.log('login form not found — demo credentials differ');
  }

  await browser.close();
})();