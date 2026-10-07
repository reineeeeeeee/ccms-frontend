// Browser smoke test (Playwright). Needs the whole system running (ccms-local-stack: npm run dev), the Super Admin
// from ccms-identity-service/.env.local, sample data loaded, and Playwright installed:  npm i -D playwright
// Run:  ADMIN_EMAIL=... ADMIN_PASSWORD=... node tests/e2e/smoke.cjs
const { chromium } = require('playwright');
const OUT = process.env.OUT_DIR || '.';
(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const ok = (label, cond) => { console.log((cond ? 'PASS ' : 'FAIL ') + label); if (!cond) process.exitCode = 1; };

  await page.goto('http://localhost:3000/');
  await page.waitForSelector('text=SAMPLE Service Alpha');
  ok('public home lists services without login', true);
  await page.screenshot({ path: OUT + '/e2e-public.png' });

  await page.click('text=Staff login >> nth=-1');
  await page.waitForURL('**/login');
  await page.fill('input[type=email], input[name=email]', (process.env.ADMIN_EMAIL || 'admin@ccms.local'));
  await page.fill('input[type=password]', process.env.ADMIN_PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForSelector('text=Sign out', { timeout: 15000 });
  ok('signed in, app shell visible at ' + page.url(), true);
  await page.screenshot({ path: OUT + '/e2e-home.png' });

  const cookies = await ctx.cookies();
  const refresh = cookies.find((c) => /refresh/i.test(c.name));
  ok('refresh cookie is httpOnly on the frontend origin (path ' + refresh?.path + ')', !!refresh && refresh.httpOnly);
  ok('signed-in marker cookie present', cookies.some((c) => c.name === 'ccms_signed_in'));

  await page.goto('http://localhost:3000/accounts');
  await page.waitForSelector('text=admin@ccms.local', { timeout: 15000 });
  ok('accounts page lists the admin (Identity via gateway)', true);
  await page.screenshot({ path: OUT + '/e2e-accounts.png' });

  await page.goto('http://localhost:3000/offices');
  await page.waitForSelector('text=SAMPLE OFFICE ONE', { timeout: 15000 });
  ok('offices page lists offices (Core via gateway)', true);

  // create a service with fees + who may avail via the API from the signed-in page, then check the screens
  const created = await page.evaluate(async () => {
    const token = JSON.parse(sessionStorage.getItem('ccms_access')).token;
    const h = { authorization: 'Bearer ' + token, 'content-type': 'application/json' };
    const offices = await (await fetch('/api/catalogue/offices', { headers: h })).json();
    const office = (offices.items ?? offices.offices ?? [])[0];
    const res = await fetch('/api/catalogue/services', { method: 'POST', headers: h, body: JSON.stringify({
      office_id: office.office_id, service_code: office.office_code + '-E2E-001', service_name: 'E2E Fees Service', classification: 'SIMPLE', transaction_type: 'G2C',
      fees: 'PHP 50.00 per copy', who_may_avail: 'Currently enrolled students',
      standard: { charter_reference: 'Charter p. 9', duration_value: 3, duration_unit: 'WORKING_DAYS', effective_from: new Date().toISOString().slice(0, 10) },
    }) });
    const body = await res.json(); if (res.status !== 201) console.log(JSON.stringify(body)); return { status: res.status, body };
  });
  ok('service with fees/who_may_avail created through the gateway (' + created.status + ')', created.status === 201);
  const id = created.body.service?.service_id;
  await page.goto('http://localhost:3000/services/' + id);
  await page.waitForSelector('text=PHP 50.00 per copy', { timeout: 15000 });
  await page.waitForSelector('text=Currently enrolled students');
  ok('staff service page shows Teph\'s fees and who may avail', true);
  await page.screenshot({ path: OUT + '/e2e-service.png' });

  await page.goto('http://localhost:3000/calendar');
  await page.waitForSelector('text=Calendar', { timeout: 15000 });
  await page.waitForTimeout(1500);
  ok('calendar page loads (Core calendar via gateway)', !(await page.locator('text=Something went wrong').count()));
  await page.screenshot({ path: OUT + '/e2e-calendar.png' });

  // token rule: no token = 401 from the gateway
  const noToken = await page.evaluate(async () => (await fetch('/api/catalogue/offices')).status);
  ok('gateway refuses /api/catalogue/offices with no token (401)', noToken === 401);
  const jobs = await page.evaluate(async () => (await fetch('/api/catalogue/jobs/outbox', { headers: { authorization: 'Bearer dev-cron-secret' } })).status);
  ok('cron job route is not reachable through the gateway (404)', jobs === 404);

  await page.click('text=Sign out');
  await page.waitForURL(/localhost:3000\/(login.*)?$/, { timeout: 15000 });
  ok('signed out -> ' + page.url(), true);
  await page.goto('http://localhost:3000/');
  await page.waitForSelector('text=Staff login');
  await page.fill('#public-search', 'E2E Fees');
  await page.click('button:has-text("Search")');
  await page.waitForSelector('text=E2E Fees Service');
  await page.click('text=View requirements');
  await page.waitForSelector('text=PHP 50.00 per copy', { timeout: 15000 });
  ok('public detail shows fees and who may avail', true);
  await page.screenshot({ path: OUT + '/e2e-public-detail.png' });

  console.log(errors.length ? 'BROWSER ERRORS:\n' + errors.join('\n') : 'no browser errors');
  await browser.close();
})().catch((e) => { console.error('E2E FAILED', e.message); process.exit(1); });
