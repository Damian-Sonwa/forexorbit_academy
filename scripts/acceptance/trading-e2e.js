/**
 * The practice simulator end to end: the real application (node server.js), real MongoDB, the real
 * evaluator job and headless Microsoft Edge. Same safety rules as scripts/acceptance/run.js (guard.js):
 * local or opted-in test server, a database ending in "_acceptance", synthetic accounts only. Uses
 * <ACCEPTANCE_DB_NAME without "_acceptance">_trading_acceptance.
 *
 *   node scripts/acceptance/trading-e2e.js
 *
 * Quotes are TEST-ONLY fixtures written by hand so each result can be checked by hand; they prove the
 * mechanics, not any market source. The server has no broker configuration.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..', '..');
const { checkAcceptanceConfig, checkDisposable, MARKER, MARKER_COLLECTION } = require('./guard');
const { START, anchorFor, fixtureDataset, quoteDoc } = require('../../tests/helpers/trading-fixture');
const { reconcileAccount } = require('../../lib/trading/engine');
const { ensureTradingIndexes } = require('../../lib/trading/indexes');

const results = [];
function record(area, check, ok, detail = '') {
  results.push(Boolean(ok));
  console.log(`${ok ? 'PASS' : 'FAIL'} [${area}] ${check}${detail ? ` (${detail})` : ''}`);
}
const { EDGE, launchBrowser, sleep } = require('./browser');

(async () => {
  const envFile = path.join(ROOT, '.env.acceptance');
  const fileEnv = fs.existsSync(envFile) ? require('dotenv').parse(fs.readFileSync(envFile)) : {};
  const merged = { ...process.env, ...fileEnv };
  const base = checkAcceptanceConfig(merged);
  if (!base.ok) { console.error(`Refused: ${base.reason}`); process.exit(2); }
  const dbName = `${base.dbName.replace(/_(acceptance|test)$/, '')}_trading_acceptance`;
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
  const alice = await person('Trading student A', 'student-a@trading.acceptance.invalid', 'student');
  const bola = await person('Trading student B', 'student-b@trading.acceptance.invalid', 'student');
  const teacher = await person('Trading instructor', 'instructor@trading.acceptance.invalid', 'instructor');

  const port = 3351;
  const origin = `http://localhost:${port}`;
  const logFile = path.join(os.tmpdir(), `fo-trading-e2e-${Date.now()}.log`);
  // No OANDA_* variable is passed, so no broker can be constructed. NODE_ENV=development is what lets
  // the TEST-ONLY quote fixture load: production refuses it.
  const env = {
    PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP,
    APPDATA: process.env.APPDATA, LOCALAPPDATA: process.env.LOCALAPPDATA, USERPROFILE: process.env.USERPROFILE,
    NODE_ENV: 'development', PORT: String(port), MONGO_URI: config.uri, MONGODB_DB_NAME: dbName,
    JWT_SECRET: crypto.randomBytes(48).toString('hex'), NEXT_TELEMETRY_DISABLED: '1', NEXT_PUBLIC_ADS_ENABLED: 'false',
    PAYMENT_RECONCILE_INTERVAL_MINUTES: '0', TRADING_EVALUATOR_INTERVAL_SECONDS: '5',
  };
  const out = fs.openSync(logFile, 'w');
  const server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: ['ignore', out, out] });
  const browsers = [];

  // ---- Test fixture control: the replay clock and hand-written quotes
  const datasets = db.collection('marketDataSets');
  const setSim = async (time) => {
    const row = await datasets.findOne({ _id: 'test-fixture' });
    await datasets.updateOne({ _id: 'test-fixture' }, { $set: { replayAnchorAt: anchorFor(row, new Date(time), new Date()) } });
  };
  const simNow = async () => {
    const row = await datasets.findOne({ _id: 'test-fixture' });
    return new Date(new Date(row.startAt).getTime() + Date.now() - new Date(row.replayAnchorAt).getTime());
  };
  const tick = async (bid, ask, instrument = 'EUR_USD') => db.collection('marketQuotes').insertOne(quoteDoc('test-fixture', instrument, await simNow(), bid, ask));
  const until = async (work, timeout = 25000) => {
    const end = Date.now() + timeout;
    for (;;) {
      const value = await work();
      if (value || Date.now() > end) return value;
      await sleep(500);
    }
  };

  // ---- HTTP as a signed-in person
  const sessionOf = (res) => { let v = null; for (const c of res.headers.getSetCookie()) { const m = /^__Host-fo_session=([^;]*)/.exec(c); if (m) v = m[1] || null; } return v; };
  const signIn = async ({ email }) => {
    const res = await fetch(`${origin}/api/auth/login`, { method: 'POST', headers: { Origin: origin, 'X-FO-CSRF': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    return `__Host-fo_session=${sessionOf(res)}`;
  };
  const call = async (cookie, method, url, body, headers = { Origin: origin, 'X-FO-CSRF': '1' }) => {
    const res = await fetch(`${origin}/api${url}`, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, body: json, text, headers: res.headers };
  };
  let keys = 0;
  const orderBody = (extra = {}) => ({ clientOrderId: `e2e-order-${(keys += 1)}-${crypto.randomUUID()}`, type: 'market', instrument: 'EUR_USD', side: 'buy', units: '10000', stopLoss: '1.09000', ...extra });

  try {
    for (let i = 0; ; i += 1) {
      if (i > 240) throw new Error(`server did not start; see ${logFile}`);
      if (/Server is ready/.test(fs.readFileSync(logFile, 'utf8'))) {
        try { if ((await fetch(`${origin}/api/courses`)).status < 500) break; } catch { /* not yet */ }
      }
      await sleep(1000);
    }
    const A = await signIn(alice);
    const B = await signIn(bola);
    const T = await signIn(teacher);
    record('setup', 'two students and an instructor signed in', ![A, B, T].some((c) => c.endsWith('=null')));

    // ---- No approved data: the state production is in today
    let r = await call(A, 'GET', '/trading/account');
    record('no data', 'with no approved dataset the market is suspended and no price exists', r.status === 200 && r.body.market.open === false && r.body.market.reason === 'no_verified_data' && r.body.market.instruments.every((i) => i.bid === null && i.ask === null), `status ${r.status}`);
    record('no data', 'no account exists until the student asks', r.body.account === null);

    const browser = await launchBrowser(9395, 'student');
    browsers.push(browser);
    const tab = browser.first;
    const pageErrors = [];
    tab.on('Runtime.exceptionThrown', (p) => pageErrors.push(String(p.exceptionDetails && p.exceptionDetails.text)));
    await tab.send('Runtime.enable');
    await tab.send('Network.clearBrowserCookies');
    await tab.send('Page.navigate', { url: `${origin}/login` });
    await tab.waitFor('document.readyState === "complete"', 90000);
    await tab.evaluate(`fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-FO-CSRF': '1' }, body: JSON.stringify(${JSON.stringify({ email: alice.email, password })}) }).then((r) => r.status)`);
    const openDesk = async (t) => {
      await t.send('Page.navigate', { url: `${origin}/demo-trading` });
      await t.waitFor(`[...document.querySelectorAll('button')].some((b) => /Practice account/.test(b.textContent))`, 90000);
      await t.evaluate(`[...document.querySelectorAll('button')].find((b) => /Practice account/.test(b.textContent)).click(); true`);
      return t.waitFor(`Boolean(document.querySelector('[data-testid="practice-desk"]'))`, 30000);
    };
    const q = (id) => `(document.querySelector('[data-testid="${id}"]') || {})`;
    const text = (id) => tab.evaluate(`${q(id)}.innerText || ''`);
    const figure = async (id) => (await text(id)).split('\n').pop().trim();
    const clickIn = (id, label) => tab.evaluate(`(() => { const b = [...document.querySelectorAll('[data-testid="${id}"] button')].find((x) => x.textContent.trim() === ${JSON.stringify(label)}); if (!b) return false; b.click(); return true; })()`);
    const noticeIs = (pattern, role) => tab.waitFor(`(() => { const n = document.querySelector('[data-testid="desk-notice"]'); return Boolean(n) && n.getAttribute('role') === '${role}' && ${pattern}.test(n.innerText); })()`, 20000);
    // Sets a field the way typing does, so React sees it, and finds it by its visible label.
    const fill = (fields) => tab.evaluate(`(() => {
      const form = document.querySelector('[data-testid="order-form"]');
      const missing = [];
      for (const [label, value] of Object.entries(${JSON.stringify(fields)})) {
        const host = [...form.querySelectorAll('label')].find((l) => l.textContent.trim().startsWith(label));
        const el = host && host.querySelector('input, select');
        if (!el) { missing.push(label); continue; }
        const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
        el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
      }
      return missing.join(',');
    })()`);
    const submit = () => tab.evaluate(`document.querySelector('[data-testid="order-form"] button[type="submit"]').click(); true`);
    // One field per step: each change re-renders the form, and the next must see that state.
    const fillEach = async (fields) => {
      for (const [label, value] of Object.entries(fields)) {
        const missing = await fill({ [label]: value });
        if (missing) throw new Error(`no field: ${missing}`);
        await sleep(60);
      }
    };
    const placeInUi = async (fields) => {
      await tab.waitFor(`!document.querySelector('[data-testid="order-form"] button[type="submit"]').disabled`, 15000);
      await fillEach({ Type: 'market', Side: 'buy', Pair: 'EUR_USD', ...fields });
      await submit();
    };

    record('no data', 'the page opens and says trading is paused', await openDesk(tab) && await tab.waitFor(`/no verified market data/.test(${q('market-closed')}.innerText || '')`, 20000));
    record('disclosure', 'the page discloses virtual funds, no broker, spread-only cost and the model limits', /Virtual funds only/.test(await text('simulator-disclosure')) && /no commission, no overnight swap and no added slippage/.test(await text('simulator-disclosure')) && /results here do not predict real results/.test(await text('simulator-disclosure')));
    await tab.evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Create practice account').click(); true`);
    record('account', 'a student creates an account in the page', await noticeIs('/practice account is ready/', 'status'));
    await tab.waitFor(`/10000\\.00 USD/.test(${q('fig-balance')}.innerText || '')`, 15000);
    record('account', 'it opens with USD 10,000.00, labelled virtual', /Virtual balance/.test(await text('fig-balance')) && (await figure('fig-balance')) === '10000.00 USD');
    record('no data', 'the order button is disabled while suspended', await tab.evaluate(`document.querySelector('[data-testid="order-form"] button[type="submit"]').disabled`) === true);
    r = await call(A, 'POST', '/trading/orders', orderBody());
    record('no data', 'an order sent anyway is refused and fills nothing', r.status >= 400 && r.status < 500 && await db.collection('tradingPositions').countDocuments({}) === 0, `status ${r.status}`);
    const accountDoc = await db.collection('tradingAccounts').findOne({ userId: alice.id, status: 'active' });
    const parallel = await Promise.all(Array.from({ length: 12 }, () => call(B, 'POST', '/trading/account', {})));
    record('account', '12 simultaneous creates over HTTP make one account', parallel.every((x) => x.status < 300) && await db.collection('tradingAccounts').countDocuments({ userId: bola.id }) === 1);

    // ---- Approved fixture (TEST-ONLY quotes) goes live
    const dataset = fixtureDataset({ maxQuoteAgeSeconds: 3600 });
    dataset.replayAnchorAt = anchorFor(dataset, START, new Date());
    await datasets.insertOne(dataset);
    await db.collection('marketQuotes').insertMany(dataset.instruments.map((instrument) => (instrument === 'USD_JPY' ? quoteDoc('test-fixture', instrument, START, '150.000', '150.020') : quoteDoc('test-fixture', instrument, START, '1.10000', '1.10020'))));
    await openDesk(tab);
    record('quotes', 'recorded bid and ask are shown, and the dataset is named as a test fixture', await tab.waitFor(`/bid 1\\.10000 · ask 1\\.10020/.test(${q('quotes')}.innerText || '')`, 20000) && /TEST FIXTURE/.test(await text('market-status')));

    // ---- Market order through the page, checked against hand-worked figures
    await placeInUi({ Units: '10000', 'Stop-loss': '1.09000' });
    record('order', 'a market buy fills at the ask', await noticeIs('/Filled at 1\\.10020/', 'status'));
    await tab.waitFor(`/366\\.73 USD/.test(${q('fig-used')}.innerText || '')`, 15000);
    record('figures', 'margin 366.73 (10,000 x 1.10020 / 30, rounded half-even)', (await figure('fig-used')) === '366.73 USD');
    record('figures', 'equity 9998.00: the spread is the open loss', (await figure('fig-equity')) === '9998.00 USD' && (await figure('fig-open-pl')) === '-2.00 USD', await figure('fig-equity'));
    record('figures', 'free margin 9631.27 and margin level 2726.26%', (await figure('fig-free')) === '9631.27 USD' && (await figure('fig-level')) === '2726.26%', `${await figure('fig-free')} ${await figure('fig-level')}`);
    record('figures', 'the balance is unchanged until the trade closes', (await figure('fig-balance')) === '10000.00 USD');

    // ---- Refusals, shown accessibly
    await placeInUi({ Units: '500000', 'Stop-loss': '1.09990' });
    record('rejection', 'too little margin: refused with an alert', await noticeIs('/margin/i', 'alert'), await text('desk-notice'));
    await placeInUi({ Units: '10000', 'Stop-loss': '1.07000' });
    record('rejection', 'more than 2% planned risk: refused with an alert', await noticeIs('/2%/', 'alert'), await text('desk-notice'));
    await placeInUi({ Units: '10000', 'Stop-loss': '1.20000' });
    record('rejection', 'a stop on the wrong side: refused with an alert', await noticeIs('/stop/i', 'alert'), await text('desk-notice'));
    await placeInUi({ Units: '999', 'Stop-loss': '1.09000' });
    record('rejection', 'below 1,000 units: refused with an alert', await noticeIs('/1,?000/', 'alert'), await text('desk-notice'));
    record('rejection', 'none of those opened a position', await db.collection('tradingPositions').countDocuments({ userId: alice.id }) === 1);

    // ---- Pending orders: placed, cancelled, filled, expired
    await tab.waitFor(`!document.querySelector('[data-testid="order-form"] button[type="submit"]').disabled`, 15000);
    await fillEach({ Type: 'limit' });
    await sleep(200);
    await fillEach({ Side: 'buy', Units: '10000', 'Order price': '1.09900', 'Stop-loss': '1.09500', 'Expires after': '24' });
    await submit();
    record('pending', 'a limit order rests', await noticeIs('/Pending order placed/', 'status') && await tab.waitFor(`/at 1\\.09900/.test(${q('pending-orders')}.innerText || '')`, 10000));
    await tab.waitFor(`[...document.querySelectorAll('[data-testid="pending-orders"] button')].some((b) => !b.disabled)`, 10000);
    await clickIn('pending-orders', 'Cancel');
    record('pending', 'cancelling it in the page works', await noticeIs('/Order cancelled/', 'status') && await tab.waitFor(`/No pending orders/.test(${q('pending-orders')}.innerText || '')`, 10000));
    r = await call(A, 'POST', '/trading/orders', orderBody({ type: 'limit', price: '1.09900', stopLoss: '1.09500', expiryHours: 24 }));
    record('pending', 'over HTTP a pending order answers 201', r.status === 201 && r.body.order.status === 'pending', `status ${r.status}`);
    await tick('1.09880', '1.09900');
    const pendingFilled = await until(async () => (await call(A, 'GET', '/trading/account')).body.positions.find((p) => p.entry === '1.09900'));
    record('pending', 'when the ask reaches the limit the order fills at the recorded ask', Boolean(pendingFilled));

    // ---- Stop-loss and take-profit against the correct side of the quote
    await tick('1.09490', '1.09510');
    const stopped = await until(async () => db.collection('tradingPositions').findOne({ userId: alice.id, status: 'closed', closeReason: 'stop_loss' }));
    record('stop-loss', 'a long stop is hit by the bid and fills at the recorded bid, past the stop', Boolean(stopped) && String(stopped.exit) === '1.09490' && String(stopped.realizedPl) === '-41.00', stopped ? `${stopped.exit} ${stopped.realizedPl}` : 'not closed');
    const first = (await call(A, 'GET', '/trading/account')).body.positions[0];
    r = await call(A, 'PATCH', `/trading/positions/${first.id}`, { stopLoss: '1.09000', takeProfit: '1.10500' });
    record('take-profit', 'a take-profit can be set on an open position', r.status === 200 && (await call(A, 'GET', '/trading/account')).body.positions[0].takeProfit === '1.10500', `status ${r.status}`);
    await tick('1.10510', '1.10530');
    const target = await until(async () => db.collection('tradingPositions').findOne({ userId: alice.id, status: 'closed', closeReason: 'take_profit' }));
    record('take-profit', 'a long target fills at the recorded bid', Boolean(target) && String(target.exit) === '1.10510' && String(target.realizedPl) === '49.00', target ? `${target.exit} ${target.realizedPl}` : 'not closed');

    // ---- The evaluator alone: nobody is viewing this account
    r = await call(B, 'POST', '/trading/orders', orderBody({ units: '1000', stopLoss: '1.10400' }));
    record('evaluator', 'a second student opens a position', r.status === 201, `status ${r.status}`);
    await tick('1.10390', '1.10410');
    const swept = await until(async () => db.collection('tradingPositions').findOne({ userId: bola.id, status: 'closed' }));
    record('evaluator', 'the server job closes a stopped position with no request from the student', Boolean(swept) && swept.closeReason === 'stop_loss' && String(swept.realizedPl) === '-1.40', swept ? `${swept.closeReason} ${swept.realizedPl}` : 'not closed');
    await tick('1.10510', '1.10530');

    // ---- Manual close through the page
    await openDesk(tab);
    await placeInUi({ Units: '10000', 'Stop-loss': '1.09000' });
    await noticeIs('/Filled at 1\\.10530/', 'status');
    await tab.waitFor(`[...document.querySelectorAll('[data-testid="open-positions"] button')].some((b) => b.textContent.trim() === 'Close' && !b.disabled)`, 15000);
    await clickIn('open-positions', 'Close');
    record('close', 'closing in the page works', await noticeIs('/Position closed/', 'status'));
    await tab.waitFor(`/10006\\.00 USD/.test(${q('fig-balance')}.innerText || '')`, 15000);
    record('close', 'the balance is 10006.00: -41.00 + 49.00 - 2.00 spread', (await figure('fig-balance')) === '10006.00 USD', await figure('fig-balance'));

    // ---- A repeated request, then a response lost after the server acted
    const same = orderBody();
    const once = await call(A, 'POST', '/trading/orders', same);
    const twice = await call(A, 'POST', '/trading/orders', same);
    record('idempotency', 'a repeated order key answers 200 with the same order', once.status === 201 && twice.status === 200 && twice.body.repeated === true && once.body.order.id === twice.body.order.id, `${once.status} ${twice.status}`);
    const open = (await call(A, 'GET', '/trading/account')).body.positions;
    record('idempotency', 'it opened one position', open.length === 1);
    r = await call(A, 'POST', `/trading/positions/${open[0].id}/close`, {});
    const again = await call(A, 'POST', `/trading/positions/${open[0].id}/close`, {});
    const balanceAfterClose = (await call(A, 'GET', '/trading/account')).body.account.balance;
    record('idempotency', 'closing twice settles once', r.status === 200 && again.status < 500 && balanceAfterClose === '10004.00', `${r.status} ${again.status} ${balanceAfterClose}`);

    let dropped = 0;
    await tab.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/trading/orders', requestStage: 'Response' }] });
    tab.on('Fetch.requestPaused', (p) => {
      if (p.request.method === 'POST' && dropped === 0) {
        dropped += 1;
        void tab.send('Fetch.failRequest', { requestId: p.requestId, errorReason: 'ConnectionReset' });
      } else void tab.send('Fetch.continueRequest', { requestId: p.requestId });
    });
    await placeInUi({ Units: '10000', 'Stop-loss': '1.09000' });
    record('lost response', 'the page says nothing is confirmed and to check before retrying', await noticeIs('/Could not reach the server/', 'alert'));
    record('lost response', 'the server had acted: the position exists', await until(async () => (await db.collection('tradingPositions').countDocuments({ userId: alice.id, status: 'open' })) === 1, 5000));
    await tab.waitFor(`!document.querySelector('[data-testid="order-form"] button[type="submit"]').disabled`, 15000);
    await submit();
    await noticeIs('/Filled at 1\\.10530/', 'status');
    await tab.send('Fetch.disable');
    record('lost response', 'retrying the same order in the page does not trade twice', dropped === 1 && await db.collection('tradingPositions').countDocuments({ userId: alice.id, status: 'open' }) === 1);

    // ---- Students are separated; instructors do not trade
    const held = (await call(A, 'GET', '/trading/account')).body.positions[0];
    const restingOrder = (await call(A, 'POST', '/trading/orders', orderBody({ type: 'limit', units: '1000', price: '1.09000', stopLoss: '1.08900', expiryHours: 1 }))).body.order;
    r = await call(B, 'POST', `/trading/positions/${held.id}/close`, {});
    record('isolation', "another student cannot close a student's position", r.status === 404, `status ${r.status}`);
    r = await call(B, 'PATCH', `/trading/positions/${held.id}`, { stopLoss: '1.10000' });
    record('isolation', "another student cannot change a student's stop", r.status === 404, `status ${r.status}`);
    r = await call(B, 'POST', `/trading/orders/${restingOrder.id}/cancel`, {});
    record('isolation', "another student cannot cancel a student's order", r.status === 404, `status ${r.status}`);
    r = await call(B, 'GET', `/trading/history?kind=ledger&accountId=${accountDoc._id}`);
    record('isolation', "another student cannot read a student's ledger by account id", r.status === 404 || (r.status === 200 && r.body.rows.length === 0), `status ${r.status}`);
    r = await call(T, 'GET', '/trading/account');
    record('roles', 'an instructor has no trading account access', r.status === 403, `status ${r.status}`);
    r = await call(T, 'POST', '/trading/orders', orderBody());
    record('roles', 'an instructor cannot place an order', r.status === 403, `status ${r.status}`);

    // ---- Request protections on the live server
    const closeUrl = `/trading/positions/${held.id}/close`;
    r = await call(null, 'POST', closeUrl, {});
    record('security', 'no session is refused', r.status === 401 || r.status === 403, `status ${r.status}`);
    r = await call(A, 'POST', closeUrl, {}, { Origin: origin });
    record('security', 'no CSRF header is refused', r.status === 403, `status ${r.status}`);
    r = await call(A, 'POST', closeUrl, {}, { Origin: 'https://evil.example', 'X-FO-CSRF': '1' });
    record('security', 'a foreign Origin is refused', r.status === 403, `status ${r.status}`);
    r = await call(A, 'GET', closeUrl);
    record('security', 'a GET cannot close a position: 405, Allow: POST', r.status === 405 && r.headers.get('allow') === 'POST', `status ${r.status}`);
    r = await call(A, 'POST', '/trading/orders', orderBody({ units: { $gt: 0 } }));
    record('security', 'an injected object as units is refused', r.status === 400 || r.status === 422, `status ${r.status}`);
    r = await call(A, 'POST', '/trading/orders', orderBody({ units: 10000 }));
    record('security', 'a JSON number as units is refused: amounts are strings', r.status === 400 || r.status === 422, `status ${r.status}`);
    r = await call(A, 'GET', '/trading/account');
    record('security', 'trading responses are private', /no-store/.test(r.headers.get('cache-control') || ''), r.headers.get('cache-control'));
    record('security', 'held position survived every refused request', (await call(A, 'GET', '/trading/account')).body.positions.length === 1);
    r = await call(A, 'POST', '/demo-trading/trades', {});
    const legacy = await call(A, 'POST', '/demo-trading/positions/EUR_USD/close', {});
    record('retired', 'the broker order and close routes answer 410', r.status === 410 && legacy.status === 410, `${r.status} ${legacy.status}`);
    r = await call(A, 'GET', '/demo-trading/performance');
    record('retired', 'the old performance route returns no figures', r.status === 503 && !/winRate|netProfit/.test(r.text), `status ${r.status}`);

    // ---- Phone width, with a position and a pending order on screen
    const phone = await launchBrowser(9396, 'phone');
    browsers.push(phone);
    const small = phone.first;
    await small.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
    await small.send('Network.clearBrowserCookies');
    await small.send('Page.navigate', { url: `${origin}/login` });
    await small.waitFor('document.readyState === "complete"', 60000);
    await small.evaluate(`fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-FO-CSRF': '1' }, body: JSON.stringify(${JSON.stringify({ email: alice.email, password })}) }).then((r) => r.status)`);
    await openDesk(small);
    await small.waitFor(`/1\\.09000/.test((document.querySelector('[data-testid="pending-orders"]') || {}).innerText || '')`, 20000);
    const fit = await small.evaluate(`(() => {
      const w = window.innerWidth;
      const wide = [...document.querySelectorAll('[data-testid="practice-desk"] *')].filter((el) => !el.closest('.overflow-x-auto, .overflow-auto') && el.getBoundingClientRect().right > w + 1).length;
      const short = [...document.querySelectorAll('[data-testid="practice-desk"] button')].filter((b) => b.getBoundingClientRect().height < 44).map((b) => b.textContent.trim());
      const unlabelled = [...document.querySelectorAll('[data-testid="practice-desk"] input, [data-testid="practice-desk"] select')].filter((el) => !el.closest('label')).length;
      return { w, sw: document.documentElement.scrollWidth, wide, short, unlabelled };
    })()`);
    record('mobile', 'the desk fits 390 px with nothing past the edge', fit.w === 390 && fit.sw <= 390 && fit.wide === 0, JSON.stringify(fit));
    record('mobile', 'every button is at least 44 px tall', fit.short.length === 0, fit.short.join(', '));
    record('a11y', 'every field has a label', fit.unlabelled === 0);

    // ---- Time passes: expiry, weekend, stale data, holiday. No fallback price at any point.
    await setSim('2026-03-05T14:00:00.000Z');
    await tick('1.10510', '1.10530');
    const expired = await until(async () => (await db.collection('tradingOrders').findOne({ userId: alice.id, status: 'expired' })));
    record('pending', 'an unfilled order expires by recorded time', Boolean(expired));
    await setSim('2026-03-07T12:00:00.000Z');
    await tab.front();
    await openDesk(tab);
    record('calendar', 'the weekend closes the market', await tab.waitFor(`/closed for the weekend/.test(${q('market-closed')}.innerText || '')`, 20000));
    record('calendar', 'orders are paused in the page', await tab.evaluate(`document.querySelector('[data-testid="order-form"] button[type="submit"]').disabled`) === true);
    r = await call(A, 'POST', '/trading/orders', orderBody());
    record('calendar', 'an order sent anyway fills nothing', r.status >= 400 && r.status < 500 && await db.collection('tradingPositions').countDocuments({ userId: alice.id, status: 'open' }) === 1, `status ${r.status}`);
    r = await call(A, 'POST', `/trading/positions/${held.id}/close`, {});
    record('calendar', 'a position cannot be closed at an invented weekend price', r.status >= 400 && r.status < 500 && await db.collection('tradingPositions').countDocuments({ userId: alice.id, status: 'open' }) === 1, `status ${r.status}`);
    await setSim('2026-03-11T12:00:00.000Z');
    r = await call(A, 'GET', '/trading/account');
    const eur = r.body.market.instruments.find((i) => i.id === 'EUR_USD');
    record('stale data', 'an open market with stale data shows no price, and equity is unavailable', r.body.market.open === true && eur.bid === null && r.body.account.equity === null, JSON.stringify({ open: r.body.market.open, bid: eur.bid, equity: r.body.account.equity }));
    r = await call(A, 'POST', '/trading/orders', orderBody());
    record('stale data', 'an order against stale data is refused', r.status >= 400 && r.status < 500, `status ${r.status}`);
    await db.collection('marketQuotes').insertOne(quoteDoc('test-fixture', 'EUR_USD', await simNow(), '1.10530', '1.10510'));
    r = await call(A, 'POST', '/trading/orders', orderBody());
    record('corrupt data', 'a crossed quote is refused, not used', r.status >= 400 && r.status < 500 && await db.collection('tradingPositions').countDocuments({ userId: alice.id, status: 'open' }) === 1, `status ${r.status}`);
    await setSim('2026-12-25T12:00:00.000Z');
    await openDesk(tab);
    record('calendar', 'Christmas Day closes the market', await tab.waitFor(`/closed for a holiday/.test(${q('market-closed')}.innerText || '')`, 20000));
    await setSim('2026-12-28T12:00:00.000Z');
    await tick('1.10510', '1.10530');
    r = await call(A, 'POST', closeUrl, {});
    record('calendar', 'the market reopens and the position closes at the recorded bid', r.status === 200, `status ${r.status}`);

    // ---- Results, history, leaderboard
    await openDesk(tab);
    await tab.waitFor(`/10002\\.00 USD/.test(${q('fig-balance')}.innerText || '')`, 15000);
    record('results', 'the final balance is 10002.00', (await figure('fig-balance')) === '10002.00 USD', await figure('fig-balance'));
    record('results', 'results show 5 closed trades and the net result', await tab.waitFor(`/2\\.00 USD/.test(${q('fig-net')}.innerText || '')`, 15000) && /Closed trades\s*5/.test(await text('performance')), (await text('performance')).replace(/\s+/g, ' '));
    await tab.evaluate(`[...document.querySelectorAll('[data-testid="history"] [role="tab"]')].find((b) => b.textContent.trim() === 'Ledger').click(); true`);
    record('history', 'the ledger lists the opening funds and each result', await tab.waitFor(`/Opening virtual funds/.test(${q('history')}.innerText || '')`, 15000) && ((await text('history')).match(/Trade result/g) || []).length === 5);
    await tab.evaluate(`document.querySelector('[data-testid="trading-leaderboard"] input[type="checkbox"]').click(); true`);
    record('leaderboard', 'a student opts in from the page', await noticeIs('/joined the leaderboard/', 'status'));
    r = await call(B, 'GET', '/trading/leaderboard');
    const row = r.body.rows[0];
    record('leaderboard', 'another student sees a pseudonym, return, drawdown and trade count', r.body.rows.length === 1 && /^Trader-/.test(row.alias) && row.returnPercent === '0.02' && row.you === false, JSON.stringify(row));
    record('leaderboard', 'and no name, email, id or journal', !r.text.includes(alice.name) && !r.text.includes(alice.email) && !r.text.includes(alice.id) && !/journal|balance/i.test(r.text));
    await tab.waitFor(`!document.querySelector('[data-testid="trading-leaderboard"] input[type="checkbox"]').disabled`, 10000);
    await tab.evaluate(`document.querySelector('[data-testid="trading-leaderboard"] input[type="checkbox"]').click(); true`);
    await noticeIs('/left the leaderboard/', 'status');
    r = await call(B, 'GET', '/trading/leaderboard');
    record('leaderboard', 'opting out removes the row', r.body.rows.length === 0);

    // ---- Reset
    const dialogs = [];
    tab.on('Page.javascriptDialogOpening', (p) => { dialogs.push(p.message); void tab.send('Page.handleJavaScriptDialog', { accept: true }); });
    await tab.waitFor(`[...document.querySelectorAll('[data-testid="reset-account"] button')].some((b) => !b.disabled)`, 10000);
    void clickIn('reset-account', 'Reset account');
    record('reset', 'a reset asks first, then starts a new USD 10,000.00 account', await noticeIs('/account was reset/', 'status') && dialogs.length === 1 && await tab.waitFor(`/10000\\.00 USD/.test(${q('fig-balance')}.innerText || '')`, 15000));
    const accounts = await db.collection('tradingAccounts').find({ userId: alice.id }).toArray();
    record('reset', 'the old account is kept, archived, with its ledger', accounts.length === 2 && accounts.filter((a) => a.status === 'active').length === 1 && await db.collection('tradingLedger').countDocuments({ accountId: accountDoc._id }) === 6);
    await tab.waitFor(`[...document.querySelectorAll('[data-testid="reset-account"] button')].some((b) => !b.disabled)`, 10000);
    void clickIn('reset-account', 'Reset account');
    record('reset', 'a second reset inside 30 days is refused, with an alert', await noticeIs('/once every 30 days/', 'alert'), await text('desk-notice'));
    r = await call(A, 'GET', '/trading/performance');
    record('reset', 'a reset cannot flatter results: the old trades still count', r.body.closedTrades === 5 && r.body.netResult === '2.00', JSON.stringify(r.body));

    // ---- Instructor tasks stay per student (G8)
    r = await call(T, 'POST', '/demo-trading/tasks', { title: 'Acceptance task', description: 'Place one practice trade', assignedTo: null });
    const taskId = r.body && (r.body._id || (r.body.task && r.body.task._id));
    record('tasks', 'an instructor creates a task for everyone', r.status < 300 && Boolean(taskId), `status ${r.status}`);
    r = await call(A, 'POST', `/demo-trading/tasks/${taskId}/complete`, {});
    const seenByA = (await call(A, 'GET', '/demo-trading/tasks')).body.find((t) => t._id === String(taskId));
    const seenByB = (await call(B, 'GET', '/demo-trading/tasks')).body.find((t) => t._id === String(taskId));
    record('tasks', "one student's completion is not another's", r.status === 200 && seenByA.completed === true && seenByB.completed === false, `status ${r.status}`);
    r = await call(A, 'GET', `/demo-trading/tasks/${taskId}/complete`);
    record('tasks', 'a GET cannot complete a task', r.status === 405, `status ${r.status}`);

    // ---- The books, then the rate limit last because it locks the student out
    const every = await db.collection('tradingAccounts').find({}).toArray();
    const checks = await Promise.all(every.map((a) => reconcileAccount(db, a._id)));
    record('reconcile', `all ${every.length} accounts, active and archived, reconcile to their ledgers`, every.length === 3 && checks.every((c) => c.ok), JSON.stringify(checks.flatMap((c) => c.problems)));
    let limited = null;
    for (let i = 0; i < 320 && !limited; i += 1) {
      const res = await call(B, 'PUT', '/trading/leaderboard', { optIn: false });
      if (res.status === 429) limited = i + 1;
    }
    record('security', 'writes are rate limited: 429 after 300', limited !== null && limited <= 301, `after ${limited} requests`);
    limited = null;
    for (let i = 0; i < 1220 && !limited; i += 1) {
      const res = await call(B, 'GET', '/trading/performance');
      if (res.status === 429) limited = i + 1;
    }
    record('security', 'reads are rate limited: 429 after 1,200', limited !== null && limited <= 1201, `after ${limited} requests`);
    record('browser', 'no uncaught script error in the page', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
    const offsite = [...tab.requests, ...small.requests].filter((x) => /oanda|fxpractice|fxtrade/i.test(x.url));
    record('browser', 'the page never called a broker', offsite.length === 0);
  } catch (error) {
    record('setup', 'run completed', false, String(error && error.stack || error).replace(/mongodb(\+srv)?:\/\/\S+/g, '<uri>').slice(0, 500));
  } finally {
    for (const b of browsers) await b.quit();
    server.kill();
  }
  const log = fs.readFileSync(logFile, 'utf8');
  record('leakage', 'no fixture email in the server log', ![alice, bola, teacher].some((p) => log.includes(p.email)));
  record('broker', 'no OANDA address in the server log (the server has no broker key)', !/fxpractice|fxtrade/i.test(log));
  await client.close().catch(() => {});
  console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed. Server log: ${logFile}`);
  process.exit(results.every(Boolean) ? 0 : 1);
})();
