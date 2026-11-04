/**
 * The synthetic market end to end: the real application, the real background jobs, real MongoDB and
 * headless Microsoft Edge, on phone and desktop widths. Same safety rules as run.js (guard.js). Uses
 * <ACCEPTANCE_DB_NAME without "_acceptance">_market_acceptance.
 *
 *   node scripts/acceptance/market-e2e.js
 *
 * The clock is real, so the market may be closed when this runs. The simulated clock is pinned to a
 * Wednesday by the market's start and anchor, which keeps the run independent of the day.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..', '..');
const { checkAcceptanceConfig, checkDisposable, MARKER, MARKER_COLLECTION } = require('./guard');
const { EDGE, launchBrowser, sleep } = require('./browser');
const { newMarket } = require('../../lib/market/health');
const { ensureTradingIndexes } = require('../../lib/trading/indexes');
const { reconcileAccount } = require('../../lib/trading/engine');
const { formatPrice, parsePrice } = require('../../lib/trading/money');

const results = [];
function record(area, check, ok, detail = '') {
  results.push(Boolean(ok));
  console.log(`${ok ? 'PASS' : 'FAIL'} [${area}] ${check}${detail ? ` (${detail})` : ''}`);
}

(async () => {
  const envFile = path.join(ROOT, '.env.acceptance');
  const fileEnv = fs.existsSync(envFile) ? require('dotenv').parse(fs.readFileSync(envFile)) : {};
  const merged = { ...process.env, ...fileEnv };
  const base = checkAcceptanceConfig(merged);
  if (!base.ok) { console.error(`Refused: ${base.reason}`); process.exit(2); }
  const dbName = `${base.dbName.replace(/_(acceptance|test)$/, '')}_market_acceptance`;
  const config = checkAcceptanceConfig({ ...merged, ACCEPTANCE_DB_NAME: dbName });
  if (!config.ok) { console.error(`Refused: ${config.reason}`); process.exit(2); }
  console.log(`Database: ${dbName} (${config.hosts}). The URI is not printed.`);
  if (!fs.existsSync(EDGE)) { console.error('Microsoft Edge not found'); process.exit(2); }

  const { MongoClient } = require('mongodb');
  const bcrypt = require('bcryptjs');
  const client = new MongoClient(config.uri, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db(dbName);
  const disposable = await checkDisposable(db);
  if (!disposable.ok) { console.error(`Refused: ${disposable.reason}`); process.exit(2); }
  for (const { name } of await db.listCollections({}, { nameOnly: true }).toArray()) {
    if (name !== MARKER_COLLECTION && !name.startsWith('system.')) await db.collection(name).deleteMany({});
  }
  await db.collection(MARKER_COLLECTION).updateOne({ _id: MARKER._id }, { $set: { kind: MARKER.kind, seededAt: new Date() } }, { upsert: true });
  await ensureTradingIndexes(db, { apply: true });

  const password = `Acc-${crypto.randomBytes(12).toString('base64url')}-9a!`;
  const person = async (name, email, role) => {
    const { insertedId } = await db.collection('users').insertOne({ name, email, password: await bcrypt.hash(password, 10), role, status: 'approved', sessionGeneration: 0, createdAt: new Date() });
    return { name, email, id: String(insertedId) };
  };
  const student = await person('Market student', 'student@market.acceptance.invalid', 'student');
  const second = await person('Market student two', 'student2@market.acceptance.invalid', 'student');
  const admin = await person('Market admin', 'admin@market.acceptance.invalid', 'admin');
  const chief = await person('Market super admin', 'superadmin@market.acceptance.invalid', 'superadmin');

  // A Wednesday noon, a few days after the market's start, as of now.
  const market = { ...newMarket({ id: 'simulated-market-1', startAt: new Date('2026-03-02T00:00:00Z') }), active: true };
  market.replayAnchorAt = new Date(Date.now() - (new Date('2026-03-04T12:00:00Z').getTime() - market.startAt.getTime()));
  await db.collection('marketDataSets').insertOne(market);

  const port = 3352;
  const origin = `http://localhost:${port}`;
  const logFile = path.join(os.tmpdir(), `fo-market-e2e-${Date.now()}.log`);
  const env = {
    PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP,
    APPDATA: process.env.APPDATA, LOCALAPPDATA: process.env.LOCALAPPDATA, USERPROFILE: process.env.USERPROFILE,
    NODE_ENV: 'development', PORT: String(port), MONGO_URI: config.uri, MONGODB_DB_NAME: dbName,
    JWT_SECRET: crypto.randomBytes(48).toString('hex'), NEXT_TELEMETRY_DISABLED: '1', NEXT_PUBLIC_ADS_ENABLED: 'false',
    PAYMENT_RECONCILE_INTERVAL_MINUTES: '0', TRADING_EVALUATOR_INTERVAL_SECONDS: '5',
  };
  const startServer = () => {
    const out = fs.openSync(logFile, 'a');
    return spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: ['ignore', out, out] });
  };
  const ready = async (mark) => {
    for (let i = 0; ; i += 1) {
      if (i > 240) throw new Error(`server did not start; see ${logFile}`);
      if (fs.readFileSync(logFile, 'utf8').slice(mark).includes('Server is ready')) {
        try { if ((await fetch(`${origin}/api/courses`)).status < 500) return; } catch { /* not yet */ }
      }
      await sleep(1000);
    }
  };
  fs.writeFileSync(logFile, '');
  let server = startServer();
  const browsers = [];

  const sessionOf = (res) => { let v = null; for (const c of res.headers.getSetCookie()) { const m = /^__Host-fo_session=([^;]*)/.exec(c); if (m) v = m[1] || null; } return v; };
  const signIn = async ({ email }) => {
    const res = await fetch(`${origin}/api/auth/login`, { method: 'POST', headers: { Origin: origin, 'X-FO-CSRF': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    return `__Host-fo_session=${sessionOf(res)}`;
  };
  const call = async (cookie, method, url, body) => {
    const res = await fetch(`${origin}/api${url}`, { method, redirect: 'manual', headers: { ...(cookie ? { Cookie: cookie } : {}), 'Content-Type': 'application/json', Origin: origin, 'X-FO-CSRF': '1' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, body: json, text, headers: res.headers };
  };
  const until = async (work, timeout = 30000) => {
    const end = Date.now() + timeout;
    for (;;) {
      const value = await work();
      if (value || Date.now() > end) return value;
      await sleep(500);
    }
  };

  try {
    await ready(0);
    const A = await signIn(student);
    const B = await signIn(second);
    const AD = await signIn(admin);
    const SA = await signIn(chief);
    record('setup', 'students and administrators signed in', ![A, B, AD, SA].some((c) => c.endsWith('=null')));

    const active = await until(async () => (await call(A, 'GET', '/trading/account')).body.market.open, 60000);
    record('market', 'the background job brings the market to ACTIVE', Boolean(active));
    let r = await call(A, 'GET', '/trading/account');
    record('market', 'it is labelled SIMULATED MARKET — NOT LIVE MARKET DATA', r.body.market.label === 'SIMULATED MARKET — NOT LIVE MARKET DATA', r.body.market.label);
    record('market', 'all six pairs have bid, ask and a spread', r.body.market.instruments.length === 6 && r.body.market.instruments.every((i) => i.bid && i.ask && i.spreadPips && Number(i.ask) > Number(i.bid)));
    record('market', 'no seed reaches a student', !r.text.includes(market.seed) && !/seed/i.test(r.text));
    const other = await call(B, 'GET', '/trading/account');
    const clockOf = (x) => new Date(x.body.market.instruments[0].time).getTime();
    const same = clockOf(r) === clockOf(other) ? JSON.stringify(r.body.market.instruments) === JSON.stringify(other.body.market.instruments) : true;
    record('market', 'two students at the same step see the same quotes', same);

    // ---- The desk, in a browser
    const browser = await launchBrowser(9397, 'market');
    browsers.push(browser);
    const tab = browser.first;
    const pageErrors = [];
    tab.on('Runtime.exceptionThrown', (p) => pageErrors.push(String(p.exceptionDetails && p.exceptionDetails.text)));
    await tab.send('Runtime.enable');
    await tab.send('Network.clearBrowserCookies');
    await tab.send('Page.navigate', { url: `${origin}/login` });
    await tab.waitFor('document.readyState === "complete"', 90000);
    await tab.evaluate(`fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-FO-CSRF': '1' }, body: JSON.stringify(${JSON.stringify({ email: student.email, password })}) }).then((r) => r.status)`);
    await tab.send('Page.navigate', { url: `${origin}/demo-trading` });
    const landed = await tab.waitFor(`location.pathname === '/student-dashboard' && Boolean(document.querySelector('[data-testid="practice-desk"]'))`, 90000);
    record('page', 'the old address redirects, and the desk opens by default, inside the site', landed, await tab.evaluate('location.pathname'));
    const q = (id) => `(document.querySelector('[data-testid="${id}"]') || {})`;
    const text = (id) => tab.evaluate(`${q(id)}.innerText || ''`);
    await tab.evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Create practice account').click(); true`);
    await tab.waitFor(`Boolean(document.querySelector('[data-testid="order-form"]'))`, 20000);
    record('page', 'the label is on the page', /SIMULATED MARKET — NOT LIVE MARKET DATA/.test(await text('market-label')));
    record('page', 'simulated clock and active sessions are shown', /Simulated market open · simulated time .*2026/.test(await text('market-clock')), await text('market-clock'));
    record('page', 'quotes show bid, ask and spread', /bid \d+\.\d+ · ask \d+\.\d+ · spread \d+\.\d pips/.test(await text('quotes')));
    record('chart', 'a candlestick chart is drawn', await tab.waitFor(`document.querySelectorAll('[data-testid="candle-chart"] rect').length > 20`, 30000), String(await tab.evaluate(`document.querySelectorAll('[data-testid="candle-chart"] rect').length`)));
    record('chart', 'the chart carries the label and has an accessible name', /NOT LIVE MARKET DATA/.test(await text('chart')) && Boolean(await tab.evaluate(`document.querySelector('[data-testid="candle-chart"]').getAttribute('aria-label')`)));
    const before = await tab.evaluate(`document.querySelector('[data-testid="candle-chart"]').getAttribute('aria-label')`);
    await tab.evaluate(`[...document.querySelectorAll('[data-testid="chart"] button')].find((b) => b.textContent.trim() === 'H1').click(); true`);
    record('chart', 'changing timeframe redraws it', await tab.waitFor(`/H1/.test(document.querySelector('[data-testid="candle-chart"]').getAttribute('aria-label'))`, 15000), before.slice(0, 50));
    const candlesA = await call(A, 'GET', '/trading/candles?instrument=EUR_USD&timeframe=H1&count=20');
    const candlesB = await call(B, 'GET', '/trading/candles?instrument=EUR_USD&timeframe=H1&count=20');
    const complete = (x) => JSON.stringify(x.body.candles.filter((c) => c.complete));
    record('chart', 'two students get the same finished candles', candlesA.status === 200 && complete(candlesA) === complete(candlesB) && candlesA.body.candles.length > 5);
    r = await call(A, 'GET', '/trading/candles?instrument=XAU_USD&timeframe=H1');
    record('chart', 'an unsupported pair is refused', r.status === 400, `status ${r.status}`);

    // ---- Risk preview and an order on generated prices
    const fields = (values) => tab.evaluate(`(() => {
      const form = document.querySelector('[data-testid="order-form"]');
      for (const [label, value] of Object.entries(${JSON.stringify(values)})) {
        const el = [...form.querySelectorAll('label')].find((l) => l.textContent.trim().startsWith(label)).querySelector('input, select');
        Object.getOwnPropertyDescriptor(el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value').set.call(el, value);
        el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
      }
      return true;
    })()`);
    const eur = (await call(A, 'GET', '/trading/account')).body.market.instruments.find((i) => i.id === 'EUR_USD');
    const stop = formatPrice(parsePrice(eur.bid) - 500n);
    await fields({ Units: '10000' });
    await sleep(100);
    await fields({ 'Stop-loss': stop });
    record('preview', 'the ticket previews margin and planned risk from the server', await tab.waitFor(`/Planned risk/.test(${q('risk-preview')}.innerText || '')`, 15000), (await text('risk-preview')).replace(/\s+/g, ' '));
    record('preview', 'a preview is not an order', await db.collection('tradingOrders').countDocuments({}) === 0);
    await tab.evaluate(`document.querySelector('[data-testid="order-form"] button[type="submit"]').click(); true`);
    record('order', 'the order fills, and the confirmation says simulated', await tab.waitFor(`/Filled at \\d+\\.\\d+\\. Simulated execution, virtual funds/.test(${q('desk-notice')}.innerText || '')`, 20000), await text('desk-notice'));
    const position = await until(() => db.collection('tradingPositions').findOne({ userId: student.id }));
    const opening = await db.collection('tradingOrders').findOne({ userId: student.id });
    record('order', 'it filled at a generated quote with an identity', Boolean(position) && /^simulated-market-1:EUR_USD:\d+$/.test(String(position.quoteId)), position && position.quoteId);
    record('order', 'the order records its fill', opening.status === 'filled');

    // ---- Executions and account history
    await tab.waitFor(`[...document.querySelectorAll('[data-testid="open-positions"] button')].some((b) => b.textContent.trim() === 'Close' && !b.disabled)`, 15000);
    await tab.evaluate(`[...document.querySelectorAll('[data-testid="history"] [role="tab"]')].find((b) => b.textContent.trim() === 'Executions').click(); true`);
    record('history', 'executions are listed with price', await tab.waitFor(`/Filled buy 10000 EUR\\/USD at \\d/.test(${q('history')}.innerText || '')`, 15000));
    await tab.evaluate(`[...document.querySelectorAll('[data-testid="history"] [role="tab"]')].find((b) => b.textContent.trim() === 'Accounts').click(); true`);
    record('history', 'account generations are listed', await tab.waitFor(`/Account 1 · current/.test(${q('history')}.innerText || '')`, 15000));
    record('reset', 'reset eligibility is shown', /A reset is available/.test(await text('reset-eligibility')));

    // ---- Suspension, by the Super Admin, while a position is open
    r = await call(A, 'GET', '/admin/market');
    record('admin', 'a student cannot read market administration', r.status === 403, `status ${r.status}`);
    r = await call(AD, 'GET', '/admin/market');
    record('admin', 'an admin can read health, without the seed', r.status === 200 && r.body.status === 'ACTIVE' && !r.text.includes(market.seed), `status ${r.status}`);
    r = await call(AD, 'POST', '/admin/market', { action: 'suspend', reason: 'test' });
    record('admin', 'an admin cannot suspend: Super Admin only', r.status === 403, `status ${r.status}`);
    r = await call(SA, 'POST', '/admin/market', { action: 'suspend', reason: 'acceptance' });
    record('admin', 'the Super Admin suspends', r.status === 200 && r.body.status === 'SUSPENDED', `status ${r.status}`);
    await tab.send('Page.reload');
    record('suspended', 'the page explains the suspension', await tab.waitFor(`/simulated market is suspended/.test(${q('market-closed')}.innerText || '')`, 30000), await text('market-closed'));
    record('suspended', 'equity shows as unavailable, not a stale figure', await tab.waitFor(`/Unavailable/.test(${q('fig-equity')}.innerText || '')`, 15000));
    record('suspended', 'the order button is off', await tab.evaluate(`document.querySelector('[data-testid="order-form"] button[type="submit"]').disabled`) === true);
    r = await call(A, 'POST', '/trading/orders', { clientOrderId: `e2e-${crypto.randomUUID()}`, type: 'market', instrument: 'EUR_USD', side: 'buy', units: '1000', stopLoss: stop });
    record('suspended', 'an order sent anyway fills nothing', r.status >= 400 && await db.collection('tradingPositions').countDocuments({ userId: student.id }) === 1, `status ${r.status}`);
    r = await call(A, 'POST', `/trading/positions/${position._id}/close`, {});
    record('suspended', 'a position cannot be closed at an unverified price', r.status === 409 && await db.collection('tradingPositions').countDocuments({ userId: student.id, status: 'open' }) === 1, `status ${r.status}`);
    r = await call(SA, 'POST', '/admin/market', { action: 'resume' });
    record('admin', 'the Super Admin resumes after history verifies', r.status === 200 && r.body.status === 'ACTIVE', `status ${r.status}`);
    record('admin', 'each step is an incident on record', (await call(SA, 'GET', '/admin/market')).body.incidents.length >= 4);

    // ---- Restart: same history, same account
    const heldBefore = (await call(A, 'GET', '/trading/candles?instrument=EUR_USD&timeframe=H1&count=20')).body.candles.filter((c) => c.complete);
    const mark = fs.readFileSync(logFile, 'utf8').length;
    server.kill('SIGKILL');
    await sleep(1500);
    server = startServer();
    await ready(mark);
    const reopened = await until(async () => { const x = await call(A, 'GET', '/trading/account'); return x.status === 200 && x.body.market.open; }, 60000);
    record('restart', 'after a hard kill and restart the market is open and the session holds', Boolean(reopened));
    const heldAfter = (await call(A, 'GET', '/trading/candles?instrument=EUR_USD&timeframe=H1&count=20')).body.candles.filter((c) => c.complete);
    record('restart', 'finished candles are identical', JSON.stringify(heldAfter.slice(0, heldBefore.length)) === JSON.stringify(heldBefore));
    r = await call(A, 'GET', '/trading/account');
    record('restart', 'the open position survives', r.body.positions.length === 1);

    // ---- Close through the page, then the books
    await tab.send('Page.reload');
    await tab.waitFor(`[...document.querySelectorAll('[data-testid="open-positions"] button')].some((b) => b.textContent.trim() === 'Close' && !b.disabled)`, 45000);
    await tab.evaluate(`[...document.querySelectorAll('[data-testid="open-positions"] button')].find((b) => b.textContent.trim() === 'Close').click(); true`);
    record('close', 'a position closes in the page', await tab.waitFor(`/Position closed/.test(${q('desk-notice')}.innerText || '')`, 20000));
    const accounts = await db.collection('tradingAccounts').find({}).toArray();
    const checks = await Promise.all(accounts.map((a) => reconcileAccount(db, a._id)));
    record('reconcile', 'accounts reconcile to their ledgers', accounts.length >= 1 && checks.every((c) => c.ok), JSON.stringify(checks.flatMap((c) => c.problems)));

    // ---- Journal stays private, inside the same page
    r = await call(A, 'POST', '/demo-trading/journal', { pair: 'EUR/USD', direction: 'buy', entryPrice: 1.1, stopLoss: 1.09, takeProfit: 1.12, lotSize: 0.1, result: 'open', notes: 'private note' });
    const entry = r.body && (r.body._id || (r.body.entry && r.body.entry._id));
    record('journal', 'a student writes a journal entry', r.status < 300 && Boolean(entry), `status ${r.status}`);
    r = await call(B, 'GET', '/demo-trading/journal');
    record('journal', 'another student cannot see it', r.status === 200 && !r.text.includes('private note'));
    r = await call(A, 'GET', '/demo-trading/journal');
    record('journal', 'entries carry no grade fields', r.status === 200 && !('grade' in r.body[0]) && !('feedback' in r.body[0]));

    // ---- Phone
    const phone = await launchBrowser(9398, 'market-phone');
    browsers.push(phone);
    const small = phone.first;
    await small.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
    await small.send('Network.clearBrowserCookies');
    await small.send('Page.navigate', { url: `${origin}/login` });
    await small.waitFor('document.readyState === "complete"', 60000);
    await small.evaluate(`fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-FO-CSRF': '1' }, body: JSON.stringify(${JSON.stringify({ email: student.email, password })}) }).then((r) => r.status)`);
    await small.send('Page.navigate', { url: `${origin}/student-dashboard` });
    await small.waitFor(`document.querySelectorAll('[data-testid="candle-chart"] rect').length > 20`, 60000);
    const fit = await small.evaluate(`(() => {
      const w = window.innerWidth;
      const desk = document.querySelector('[data-testid="practice-desk"]');
      const wide = [...desk.querySelectorAll('*')].filter((el) => !el.closest('svg, .overflow-x-auto, .overflow-auto') && el.getBoundingClientRect().right > w + 1).length;
      const short = [...desk.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().height < 44).map((b) => b.textContent.trim());
      const chart = document.querySelector('[data-testid="candle-chart"]').getBoundingClientRect();
      return { w, sw: document.documentElement.scrollWidth, wide, short, chartRight: Math.round(chart.right) };
    })()`);
    record('mobile', 'the desk and chart fit 390 px', fit.w === 390 && fit.sw <= 390 && fit.wide === 0 && fit.chartRight <= 390, JSON.stringify(fit));
    record('mobile', 'every button is at least 44 px tall', fit.short.length === 0, fit.short.join(', '));

    record('browser', 'no uncaught script error in the page', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
    const offsite = [...tab.requests, ...small.requests].filter((x) => /oanda|fxpractice|fxtrade|twelvedata|alphavantage/i.test(x.url));
    record('browser', 'the page called no broker or market-data service', offsite.length === 0);
  } catch (error) {
    record('setup', 'run completed', false, String(error && error.stack || error).replace(/mongodb(\+srv)?:\/\/\S+/g, '<uri>').slice(0, 500));
  } finally {
    for (const b of browsers) await b.quit();
    server.kill();
  }
  const log = fs.readFileSync(logFile, 'utf8');
  record('leakage', 'no seed or fixture email in the server log', !log.includes(market.seed) && ![student, second, admin, chief].some((p) => log.includes(p.email)));
  await client.close().catch(() => {});
  console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed. Server log: ${logFile}`);
  process.exit(results.every(Boolean) ? 0 : 1);
})();
