/**
 * Phase 5 payment screens and APIs against the real application (node server.js) and headless
 * Microsoft Edge. Same safety rules as scripts/acceptance/run.js (guard.js): local or opted-in test
 * server, a database ending in "_acceptance", synthetic accounts only. Uses its own database,
 * <ACCEPTANCE_DB_NAME without "_acceptance">_payments_acceptance, marked as the harness's.
 *
 *   node scripts/acceptance/payments-e2e.js
 *
 * The server runs WITHOUT a Paystack key, so payments are disabled: no request can reach Paystack.
 * Payment, refund and checkout rows are seeded directly as synthetic data to exercise the history
 * page, the admin refund panel and the authorization of every new route.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..', '..');
const { checkAcceptanceConfig, checkDisposable, MARKER, MARKER_COLLECTION } = require('./guard');

const results = [];
function record(area, check, ok, detail = '') {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} [${area}] ${check}${detail ? ` (${detail})` : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const envFile = path.join(ROOT, '.env.acceptance');
  const fileEnv = fs.existsSync(envFile) ? require('dotenv').parse(fs.readFileSync(envFile)) : {};
  const merged = { ...process.env, ...fileEnv };
  const base = checkAcceptanceConfig(merged);
  if (!base.ok) { console.error(`Refused: ${base.reason}`); process.exit(2); }
  const dbName = `${base.dbName.replace(/_(acceptance|test)$/, '')}_payments_acceptance`;
  const config = checkAcceptanceConfig({ ...merged, ACCEPTANCE_DB_NAME: dbName });
  if (!config.ok) { console.error(`Refused: ${config.reason}`); process.exit(2); }
  console.log(`Database: ${dbName} (${config.hosts}). The URI is not printed.`);

  const { MongoClient, ObjectId } = require('mongodb');
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

  const accounts = {};
  for (const [key, role] of [['student', 'student'], ['other', 'student'], ['admin', 'admin'], ['superadmin', 'superadmin']]) {
    const password = `Acc-${crypto.randomBytes(12).toString('base64url')}-9a!`;
    const email = `${key}@payments.acceptance.invalid`;
    const { insertedId } = await db.collection('users').insertOne({ name: `Payments ${key}`, email, password: await bcrypt.hash(password, 10), role, status: 'approved', learningLevel: 'beginner', onboardingCompleted: true, createdAt: new Date(), updatedAt: new Date() });
    accounts[key] = { id: String(insertedId), email, password };
  }
  const now = new Date();
  const courseA = new ObjectId();
  const courseB = new ObjectId();
  await db.collection('courses').insertMany([
    { _id: courseA, title: 'Acceptance Price Action', status: 'published', difficulty: 'beginner', createdAt: now },
    { _id: courseB, title: 'Acceptance Risk Management', status: 'published', difficulty: 'beginner', createdAt: now },
  ]);
  const refA = `fo_c_acc_${Date.now()}_aaaa1111`;
  const refB = `fo_c_acc_${Date.now()}_bbbb2222`;
  const refOther = `fo_c_acc_${Date.now()}_cccc3333`;
  const pay = (ref, userId, courseId) => ({ reference: ref, userId, courseId: String(courseId), kind: 'course', status: 'success', amountKobo: 1000000, currency: 'NGN', source: 'checkout', paidAt: now, entitlementApplied: true, createdAt: now });
  await db.collection('paystackPayments').insertMany([pay(refA, accounts.student.id, courseA), pay(refB, accounts.student.id, courseB), pay(refOther, accounts.other.id, courseA)]);
  for (const [ref, userId, courseId] of [[refA, accounts.student.id, courseA], [refB, accounts.student.id, courseB], [refOther, accounts.other.id, courseA]]) {
    await db.collection('userCourseAccess').insertOne({ userId, courseId: String(courseId), paid: true, entitlementType: 'paid_course', paystackReference: ref, unlockedAt: now, createdAt: now });
    await db.collection('coursePurchases').insertOne({ userId, courseId: String(courseId), status: 'paid', paymentReference: ref, amountKobo: 1000000, currency: 'NGN', createdAt: now });
  }
  await db.collection('paystackRefunds').insertOne({ requestId: 'req-acceptance-0001', paymentReference: refB, userId: accounts.student.id, courseId: String(courseB), amountKobo: 250000, currency: 'NGN', full: false, revokeAccess: false, reason: 'Acceptance partial refund', initiatedBy: 'admin', status: 'pending', open: true, providerRefundId: 'rf_acc_1', requestedAt: now, updatedAt: now, history: [] });

  const port = 3330;
  const origin = `http://localhost:${port}`;
  const logFile = path.join(os.tmpdir(), `fo-payments-e2e-${Date.now()}.log`);
  const env = {
    PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP,
    APPDATA: process.env.APPDATA, LOCALAPPDATA: process.env.LOCALAPPDATA, USERPROFILE: process.env.USERPROFILE,
    NODE_ENV: 'development', PORT: String(port), MONGO_URI: config.uri, MONGODB_DB_NAME: dbName,
    JWT_SECRET: crypto.randomBytes(48).toString('hex'), NEXT_TELEMETRY_DISABLED: '1', NEXT_PUBLIC_ADS_ENABLED: 'false',
  };
  const out = fs.openSync(logFile, 'w');
  const server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: ['ignore', out, out] });
  let browser = null;
  try {
    for (let i = 0; ; i += 1) {
      if (i > 240) throw new Error(`server did not start; see ${logFile}`);
      if (/Server is ready/.test(fs.readFileSync(logFile, 'utf8'))) {
        try { if ((await fetch(`${origin}/api/courses`)).status < 500) break; } catch { /* not yet */ }
      }
      await sleep(1000);
    }
    const sessionOf = (res) => { let v = null; for (const c of res.headers.getSetCookie()) { const m = /^__Host-fo_session=([^;]*)/.exec(c); if (m) v = m[1] || null; } return v; };
    const call = (method, url, { token, body } = {}) => fetch(`${origin}/api${url}`, { method, headers: { Origin: origin, 'X-FO-CSRF': '1', ...(token ? { Cookie: `__Host-fo_session=${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const login = async (key) => sessionOf(await call('POST', '/auth/login', { body: { email: accounts[key].email, password: accounts[key].password } }));
    const T = {};
    for (const key of Object.keys(accounts)) T[key] = await login(key);
    record('setup', 'all accounts signed in', Object.values(T).every(Boolean));

    // ---- APIs
    let r = await call('GET', '/payments/history');
    record('api', 'payment history requires a session', r.status === 401);
    r = await call('GET', '/payments/history', { token: T.student });
    const hist = await r.json();
    const byRef = Object.fromEntries((hist.items || []).map((i) => [i.reference, i]));
    record('api', 'student sees exactly their own two payments', r.status === 200 && hist.items.length === 2 && byRef[refA] && byRef[refB] && !byRef[refOther]);
    record('api', 'statuses come from the server records', byRef[refA] && byRef[refA].status === 'paid' && byRef[refB] && byRef[refB].status === 'refund_pending' && byRef[refB].refundPendingKobo === 250000);
    record('api', 'history exposes no personal or provider data', !/@|email|metadata|customer|reason/.test(JSON.stringify(hist)));
    r = await call('GET', '/payments/history', { token: T.other });
    record('api', 'another student sees only their own payment', (await r.json()).items.map((i) => i.reference).join() === refOther);
    for (const who of ['student', 'admin']) {
      r = await call('GET', `/admin/refunds?reference=${refB}`, { token: T[who] });
      record('api', `${who} refused on the refund list`, r.status === 403);
      r = await call('POST', '/admin/refunds', { token: T[who], body: { reference: refA, revokeAccess: false, reason: 'not allowed', requestId: 'req-acc-forbidden-1' } });
      record('api', `${who} refused on refund creation`, r.status === 403);
      r = await call('POST', '/admin/payments/reconcile', { token: T[who], body: {} });
      record('api', `${who} refused on reconciliation`, r.status === 403);
    }
    r = await call('GET', `/admin/refunds?reference=${refB}`, { token: T.superadmin });
    const list = await r.json();
    record('api', 'Super Admin lists refunds with the summary', r.status === 200 && list.refunds.length === 1 && list.summary.state === 'refund_pending');
    r = await call('POST', '/admin/refunds', { token: T.superadmin, body: { reference: refA, revokeAccess: false, reason: 'Acceptance', requestId: 'req-acc-0002' } });
    record('api', 'without a Paystack key, refund creation is refused (503) and nothing is recorded', r.status === 503 && (await db.collection('paystackRefunds').countDocuments({})) === 1);
    r = await fetch(`${origin}/api/admin/refunds`, { method: 'POST', headers: { Origin: origin, Cookie: `__Host-fo_session=${T.superadmin}`, 'Content-Type': 'application/json' }, body: '{}' });
    record('api', 'refund creation without the CSRF header is refused', r.status === 403);
    r = await fetch(`${origin}/api/paystack/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    record('api', 'webhook answers 503 when payments are not configured (no key)', r.status === 503);

    // ---- Browser
    const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
    if (!fs.existsSync(edge)) {
      record('ui', 'browser available', false, 'Microsoft Edge not found');
    } else {
      const WebSocket = require('ws');
      const debugPort = 9361;
      const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fo-payments-edge-'));
      browser = spawn(edge, ['--headless=new', '--disable-gpu', '--no-first-run', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
      let pages = [];
      for (let i = 0; i < 60 && !pages.length; i += 1) {
        try { pages = (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).filter((t) => t.type === 'page'); } catch { await sleep(500); }
      }
      const ws = new WebSocket(pages[0].webSocketDebuggerUrl, { perMessageDeflate: false });
      await new Promise((resolve) => ws.once('open', resolve));
      let n = 0; const pending = new Map();
      ws.on('message', (m) => { const msg = JSON.parse(m); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result || {}); pending.delete(msg.id); } });
      const send = (method, params = {}) => new Promise((resolve) => { n += 1; pending.set(n, resolve); ws.send(JSON.stringify({ id: n, method, params })); });
      const evaluate = async (expression) => ((await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result || {}).value;
      const signInAs = async (key) => {
        await send('Network.clearBrowserCookies');
        await send('Page.navigate', { url: `${origin}/login` });
        await sleep(4000);
        return evaluate(`fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-FO-CSRF': '1' }, body: JSON.stringify(${JSON.stringify({ email: accounts[key].email, password: accounts[key].password })}) }).then((r) => r.status)`);
      };
      await send('Network.enable');
      record('ui', 'student signs in from the page', (await signInAs('student')) === 200);
      for (const [label, width, mobile] of [['desktop', 1366, false], ['phone', 390, true]]) {
        await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: mobile ? 3 : 1, mobile });
        await send('Page.navigate', { url: `${origin}/payments` });
        await sleep(9000);
        const page = await evaluate(`({ text: document.body.innerText, sw: document.documentElement.scrollWidth, w: innerWidth })`);
        record('ui', `${label}: Payments page lists both courses with their statuses`, /Acceptance Price Action/.test(page.text) && /Acceptance Risk Management/.test(page.text) && /Paid/.test(page.text) && /Refund in progress/.test(page.text));
        record('ui', `${label}: no horizontal overflow`, page.sw <= page.w + 1, `${page.sw}/${page.w}`);
        record('ui', `${label}: another student's payment is not shown`, !page.text.includes(refOther));
      }
      await send('Emulation.clearDeviceMetricsOverride');
      await send('Page.navigate', { url: `${origin}/dashboard` });
      await sleep(8000);
      record('ui', 'student menu has the Payments link', await evaluate(`[...document.querySelectorAll('a')].some((a) => a.getAttribute('href') === '/payments')`));

      record('ui', 'Super Admin signs in from the page', (await signInAs('superadmin')) === 200);
      await send('Page.navigate', { url: `${origin}/admin/purchases` });
      await sleep(10000);
      record('ui', 'purchases page shows the reconciliation panel', /Reconcile with Paystack/.test(await evaluate('document.body.innerText')));
      const opened = await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => /details|view|open/i.test(el.textContent || '')); if (!b) return false; b.click(); return true; })()`);
      await sleep(5000);
      const detail = await evaluate('document.body.innerText');
      record('ui', 'purchase detail shows the Refunds section with an explicit access choice', opened && /Refunds/.test(detail) && /Keep access/.test(detail) && /Remove access \(full refunds only\)/.test(detail), opened ? '' : 'no detail button found');
      ws.close();
    }
  } catch (error) {
    record('setup', 'run completed', false, String(error && error.message).replace(/mongodb(\+srv)?:\/\/\S+/g, '<uri>'));
  } finally {
    if (browser) browser.kill();
    server.kill();
  }
  const log = fs.readFileSync(logFile, 'utf8');
  record('leakage', 'no fixture email in the server log', Object.values(accounts).every((a) => !log.includes(a.email)));
  await client.close().catch(() => {});
  console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed. Server log: ${logFile}`);
  process.exit(results.every(Boolean) ? 0 : 1);
})();
