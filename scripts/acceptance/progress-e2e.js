/**
 * Phase 8 learning progress against the real application (node server.js), real MongoDB and
 * headless Microsoft Edge: two tabs of one browser (one session) and a second browser (a second
 * device, its own session), on desktop and phone widths. Same safety rules as
 * scripts/acceptance/run.js (guard.js): local or opted-in test server, a database ending in
 * "_acceptance", synthetic accounts only. Uses <ACCEPTANCE_DB_NAME without "_acceptance">_progress_acceptance.
 *
 *   node scripts/acceptance/progress-e2e.js
 *
 * The server runs WITHOUT a Paystack key; the paying student's entitlement is seeded.
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
  results.push(Boolean(ok));
  console.log(`${ok ? 'PASS' : 'FAIL'} [${area}] ${check}${detail ? ` (${detail})` : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

/** A headless Edge with its own profile (a "device"), driven over DevTools. */
async function launchBrowser(port, label) {
  const WebSocket = require('ws');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), `fo-progress-edge-${label}-`));
  const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  let list = [];
  for (let i = 0; i < 60 && !list.length; i += 1) {
    try { list = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).filter((t) => t.type === 'page'); } catch { await sleep(500); }
  }
  const attach = async (target) => {
    const ws = new WebSocket(target.webSocketDebuggerUrl, { perMessageDeflate: false });
    await new Promise((resolve) => ws.once('open', resolve));
    let seq = 0;
    const pending = new Map();
    const listeners = new Map();
    ws.on('message', (m) => {
      const msg = JSON.parse(m);
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result || { error: msg.error }); pending.delete(msg.id); return; }
      for (const fn of listeners.get(msg.method) || []) fn(msg.params);
    });
    // Every DevTools call answers within 30 s, so a stuck page fails a check instead of hanging.
    const send = (method, params = {}) => new Promise((resolve) => {
      seq += 1;
      const id = seq;
      const timer = setTimeout(() => { pending.delete(id); console.log(`WARN [${label}] ${method} timed out`); resolve({ error: { message: 'timeout' } }); }, 30000);
      pending.set(id, (value) => { clearTimeout(timer); resolve(value); });
      ws.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async (expression) => ((await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result || {}).value;
    const waitFor = async (expression, timeout = 20000) => {
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        try { if (await evaluate(expression)) return true; } catch { /* navigating */ }
        await sleep(250);
      }
      return false;
    };
    const requests = [];
    listeners.set('Network.requestWillBeSent', [(p) => requests.push({ url: p.request.url, method: p.request.method })]);
    await send('Network.enable');
    await send('Page.enable');
    // Headless Edge throttles or freezes background tabs: bring a tab forward before driving it.
    const front = () => send('Page.bringToFront');
    return { ws, send, evaluate, waitFor, requests, front, close: () => ws.close() };
  };
  const first = await attach(list[0]);
  const newTab = async () => {
    const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
    return attach(target);
  };
  const quit = async () => {
    try {
      const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
      const socket = new WebSocket(webSocketDebuggerUrl, { perMessageDeflate: false });
      await new Promise((resolve) => { socket.once('open', resolve); socket.once('error', resolve); setTimeout(resolve, 5000); });
      if (socket.readyState === 1) socket.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
      await new Promise((resolve) => { socket.once('close', resolve); setTimeout(resolve, 5000); });
    } catch { /* gone */ }
    proc.kill();
  };
  return { first, newTab, quit };
}

(async () => {
  const envFile = path.join(ROOT, '.env.acceptance');
  const fileEnv = fs.existsSync(envFile) ? require('dotenv').parse(fs.readFileSync(envFile)) : {};
  const merged = { ...process.env, ...fileEnv };
  const base = checkAcceptanceConfig(merged);
  if (!base.ok) { console.error(`Refused: ${base.reason}`); process.exit(2); }
  const dbName = `${base.dbName.replace(/_(acceptance|test)$/, '')}_progress_acceptance`;
  const config = checkAcceptanceConfig({ ...merged, ACCEPTANCE_DB_NAME: dbName });
  if (!config.ok) { console.error(`Refused: ${config.reason}`); process.exit(2); }
  console.log(`Database: ${dbName} (${config.hosts}). The URI is not printed.`);
  if (!fs.existsSync(EDGE)) { console.error('Microsoft Edge not found'); process.exit(2); }

  const { MongoClient, ObjectId } = require('mongodb');
  const bcrypt = require('bcryptjs');
  const { ensureEnrollmentIndexes } = require('../../lib/enrollment-indexes');
  const { COURSE_PAYMENT_INDEXES } = require('../../lib/course-payment-indexes');
  const { run: runLearningIndexes } = require('../learning-indexes');
  const client = new MongoClient(config.uri, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db(dbName);
  const disposable = await checkDisposable(db);
  if (!disposable.ok) { console.error(`Refused: ${disposable.reason}`); process.exit(2); }
  for (const { name } of await db.listCollections({}, { nameOnly: true }).toArray()) {
    if (name !== MARKER_COLLECTION && !name.startsWith('system.')) await db.collection(name).deleteMany({});
  }
  await db.collection(MARKER_COLLECTION).updateOne({ _id: MARKER._id }, { $set: { kind: MARKER.kind, seededAt: new Date() } }, { upsert: true });
  for (const index of COURSE_PAYMENT_INDEXES) await db.collection(index.collection).createIndex(index.key, index.options);
  record('setup', 'enrollment index E1 built', (await ensureEnrollmentIndexes(db, { apply: true })).ok);
  record('setup', 'learning indexes (incl. Phase 8 L8, L9) built', (await runLearningIndexes(db, { mode: 'apply', log: () => {} })).ok);

  const accounts = {};
  for (const key of ['payer', 'other']) {
    const password = `Acc-${crypto.randomBytes(12).toString('base64url')}-9a!`;
    const email = `${key}@progress.acceptance.invalid`;
    const { insertedId } = await db.collection('users').insertOne({ name: `Progress ${key}`, email, password: await bcrypt.hash(password, 10), role: 'student', status: 'approved', learningLevel: 'beginner', onboardingCompleted: true, createdAt: new Date(), updatedAt: new Date() });
    accounts[key] = { id: String(insertedId), email, password };
  }
  const now = new Date();
  const P = new ObjectId();
  await db.collection('courses').insertOne({ _id: P, title: 'Acceptance Swing Trading', status: 'published', difficulty: 'beginner', category: 'forex', freePreviewExplicit: true, createdAt: now });
  const lesson = async (order, title, flags = {}) => String((await db.collection('lessons').insertOne({ courseId: String(P), order, title, type: 'text', content: `<p>${title} body</p>`, createdAt: now, ...flags })).insertedId);
  const L = { l1: await lesson(1, 'Lesson one', { isFreePreview: true }), l2: await lesson(2, 'Lesson two'), l3: await lesson(3, 'Lesson three'), l4: await lesson(4, 'Lesson four', { isDemo: true }) };
  for (const key of ['payer', 'other']) await db.collection('progress').insertOne({ userId: accounts[key].id, courseId: String(P), progress: 0, completedLessons: [], active: true, createdAt: now });
  await db.collection('userCourseAccess').insertOne({ userId: accounts.payer.id, courseId: String(P), paid: true, entitlementType: 'paid_course', paystackReference: 'fo_c_prog_1_abcdef12', unlockedAt: now, createdAt: now });
  const rowOf = (key) => db.collection('progress').findOne({ userId: accounts[key].id, courseId: String(P) });

  const port = 3342;
  const origin = `http://localhost:${port}`;
  const logFile = path.join(os.tmpdir(), `fo-progress-e2e-${Date.now()}.log`);
  const env = {
    PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP,
    APPDATA: process.env.APPDATA, LOCALAPPDATA: process.env.LOCALAPPDATA, USERPROFILE: process.env.USERPROFILE,
    NODE_ENV: 'development', PORT: String(port), MONGO_URI: config.uri, MONGODB_DB_NAME: dbName,
    JWT_SECRET: crypto.randomBytes(48).toString('hex'), NEXT_TELEMETRY_DISABLED: '1', NEXT_PUBLIC_ADS_ENABLED: 'false',
    PAYMENT_RECONCILE_INTERVAL_MINUTES: '0',
  };
  const out = fs.openSync(logFile, 'w');
  const server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: ['ignore', out, out] });
  const browsers = [];
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
    const json = async (res) => { try { return await res.json(); } catch { return null; } };
    const login = async (key) => sessionOf(await call('POST', '/auth/login', { body: { email: accounts[key].email, password: accounts[key].password } }));
    const T = { payer: await login('payer'), other: await login('other') };
    record('setup', 'accounts signed in', Boolean(T.payer && T.other));

    // ---- API on the live server
    let r = await call('POST', '/progress/activity', { token: T.payer, body: { lessonId: L.l2, event: 'view', userId: accounts.other.id } });
    record('api', 'activity: a view is accepted for the session account only', r.status === 200 && (await rowOf('payer')).lastLessonId === L.l2 && !(await rowOf('other')).lastLessonId);
    r = await call('POST', '/progress/activity', { token: T.other, body: { lessonId: L.l2, event: 'view' } });
    record('api', 'activity: a locked lesson is refused', r.status === 403 && (await json(r)).code === 'lesson_locked');
    r = await call('POST', '/progress/activity', { body: { lessonId: L.l1, event: 'view' } });
    record('api', 'activity: no session, refused', r.status === 401);
    const burst = await Promise.all(Array.from({ length: 10 }, () => call('POST', '/progress/activity', { token: T.payer, body: { lessonId: L.l2, event: 'heartbeat' } })));
    const minutes = await db.collection('learningMinutes').countDocuments({ userId: accounts.payer.id });
    record('api', '10 simultaneous signals count at most the current minute(s), not 10', burst.every((x) => x.status === 200) && minutes >= 1 && minutes <= 2, `${minutes} minute(s)`);
    r = await call('GET', '/progress/summary', { token: T.payer });
    let s = await json(r);
    record('api', 'summary: private, continue = last viewed lesson', /no-store/.test(r.headers.get('cache-control') || '') && s.continue && s.continue.lessonId === L.l2 && s.continue.reason === 'last_viewed');
    r = await call('GET', `/progress/summary?userId=${accounts.payer.id}`, { token: T.other });
    s = await json(r);
    record('api', 'summary: another student sees only their own data', s.totals.completedLessons === 0 && !s.continue?.lessonId?.includes(L.l2) && !JSON.stringify(s).includes(accounts.payer.id));
    await Promise.all([1, 2, 3].map(() => call('POST', '/progress', { token: T.payer, body: { courseId: String(P), lessonId: L.l1 } })));
    const afterTriple = await rowOf('payer');
    record('api', 'three simultaneous completions of one lesson record it once', afterTriple.completedLessons.length === 1 && afterTriple.progress === 25);

    // ---- Device A: two tabs, one session
    const A = await launchBrowser(9381, 'a');
    browsers.push(A);
    const signIn = async (tab, key) => {
      await tab.send('Network.clearBrowserCookies');
      await tab.send('Page.navigate', { url: `${origin}/login` });
      await tab.waitFor('document.readyState === "complete"', 60000);
      return tab.evaluate(`fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-FO-CSRF': '1' }, body: JSON.stringify(${JSON.stringify({ email: accounts[key].email, password: accounts[key].password })}) }).then((r) => r.status)`);
    };
    const tab1 = A.first;
    record('ui', 'device A signs in', (await signIn(tab1, 'payer')) === 200);
    const tab2 = await A.newTab();
    const statText = (tab, id) => tab.evaluate(`(document.querySelector('[data-testid="${id}"] p') || {}).innerText || ''`);
    await tab2.front();
    await tab2.send('Page.navigate', { url: `${origin}/dashboard` });
    record('ui', 'tab 2: dashboard shows Continue learning at the last viewed lesson', await tab2.waitFor(`(() => { const a = document.querySelector('[data-testid="continue-learning"] a[href*="/lessons/"]'); return a && a.getAttribute('href').endsWith(${JSON.stringify(L.l2)}); })()`, 90000));
    record('ui', 'tab 2: lessons completed = 1 (from the server)', (await statText(tab2, 'stat-lessons')) === '1');
    // Tab 2 stays in the background from here: its updates must arrive by socket, not by focus.
    await tab1.front();
    await tab1.send('Page.navigate', { url: `${origin}/courses/${P}/lessons/${L.l2}` });
    await tab1.waitFor(`(document.querySelector('main h1') || {}).innerText === 'Lesson two'`, 90000);
    // Activity: interact for ~35 s so at least one heartbeat is due.
    const minutesBefore = await db.collection('learningMinutes').countDocuments({ userId: accounts.payer.id });
    for (let i = 0; i < 8; i += 1) { await tab1.evaluate(`window.dispatchEvent(new Event('pointerdown')); true`); await sleep(5000); }
    const heartbeats = tab1.requests.filter((q) => q.url.endsWith('/api/progress/activity') && q.method === 'POST').length;
    const minutesAfter = await db.collection('learningMinutes').countDocuments({ userId: accounts.payer.id });
    record('activity', 'an open, used lesson sends a view and heartbeats; time is recorded', heartbeats >= 2 && minutesAfter >= minutesBefore, `${heartbeats} signals, minutes ${minutesBefore}->${minutesAfter}`);
    // Complete in tab 1; tab 2's dashboard updates without a reload (socket, user room).
    const marker = await tab2.evaluate('window.__noReload = 1; 1');
    await tab1.evaluate(`[...document.querySelectorAll('[data-testid="lesson-completion"] button')].find((b) => /Mark lesson complete/.test(b.textContent)).click()`);
    await tab1.waitFor(`/Lesson completed/.test(document.querySelector('[data-testid="lesson-completion"]').innerText)`);
    const synced = await tab2.waitFor(`(document.querySelector('[data-testid="stat-lessons"] p') || {}).innerText === '2'`, 15000);
    record('sync', 'tab 2 shows the completion made in tab 1 without reloading', synced && marker === 1 && (await tab2.evaluate('window.__noReload')) === 1);

    // ---- Device B: another browser, its own session (a phone)
    const B = await launchBrowser(9382, 'b');
    browsers.push(B);
    const phone = B.first;
    await phone.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 860, deviceScaleFactor: 3, mobile: true });
    record('ui', 'device B (phone) signs in with its own session', (await signIn(phone, 'payer')) === 200);
    await phone.send('Page.navigate', { url: `${origin}/courses/${P}` });
    const phoneCourse = await phone.waitFor(`[...document.querySelectorAll('[data-testid="course-lesson-open"]')].filter((a) => /Completed/.test(a.innerText)).length === 2`, 90000);
    record('sync', 'device B shows both completions from device A', phoneCourse);
    await phone.send('Page.navigate', { url: `${origin}/courses/${P}/lessons/${L.l3}` });
    await phone.waitFor(`(document.querySelector('main h1') || {}).innerText === 'Lesson three'`, 90000);
    await phone.evaluate(`[...document.querySelectorAll('[data-testid="lesson-completion"] button')].find((b) => /Mark lesson complete/.test(b.textContent)).click()`);
    await phone.waitFor(`/Lesson completed/.test(document.querySelector('[data-testid="lesson-completion"]').innerText)`);
    const outlineSynced = await tab1.waitFor(`[...document.querySelectorAll('#lesson-outline-list li')][2] && [...document.querySelectorAll('#lesson-outline-list li')][2].innerText.includes('✓')`, 15000);
    record('sync', 'device A (lesson page) marks lesson 3 done when the phone completes it', outlineSynced);
    record('sync', 'device A tab 2 dashboard follows too (3 lessons)', await tab2.waitFor(`(document.querySelector('[data-testid="stat-lessons"] p') || {}).innerText === '3'`, 15000));

    // ---- Continue learning and resume across devices
    s = await json(await call('GET', '/progress/summary', { token: T.payer }));
    record('resume', 'continue moves on after the last viewed lesson (3, done) to lesson 4', s.continue && s.continue.lessonId === L.l4 && s.continue.reason === 'next_after_last_viewed', s.continue && `${s.continue.reason}`);
    await phone.send('Page.navigate', { url: `${origin}/dashboard` });
    const phoneContinue = await phone.waitFor(`(() => { const a = document.querySelector('[data-testid="continue-learning"] a[href*="/lessons/"]'); return a && a.getAttribute('href').endsWith(${JSON.stringify(L.l4)}); })()`, 90000);
    record('resume', 'the phone dashboard offers the same Continue lesson', phoneContinue);
    await phone.evaluate(`document.querySelector('[data-testid="continue-learning"] a[href*="/lessons/"]').click()`);
    record('resume', 'Continue learning opens lesson 4 in the right course', await phone.waitFor(`location.pathname === ${JSON.stringify(`/courses/${P}/lessons/${L.l4}`)} && (document.querySelector('main h1') || {}).innerText === 'Lesson four'`, 60000));
    await phone.send('Page.navigate', { url: `${origin}/dashboard` });
    await phone.waitFor(`Boolean(document.querySelector('[data-testid="stat-streak"]'))`, 60000);
    const phonePage = await phone.evaluate(`({ sw: document.documentElement.scrollWidth, w: innerWidth, streak: document.querySelector('[data-testid="stat-streak"] p').innerText, time: document.querySelector('[data-testid="stat-time"] p').innerText, inProgress: document.querySelector('[data-testid="in-progress-courses"]').innerText })`);
    record('ui', 'phone dashboard: streak 1 day, learning time shown, course in progress, no overflow', phonePage.streak === '1 day' && /min|h/.test(phonePage.time) && /Acceptance Swing Trading/.test(phonePage.inProgress) && phonePage.sw <= phonePage.w + 1, JSON.stringify({ ...phonePage, inProgress: undefined }));

    // ---- Refresh, logout/login
    await tab2.front();
    await tab2.send('Page.reload');
    record('persist', 'after a refresh the dashboard shows the same totals', await tab2.waitFor(`(document.querySelector('[data-testid="stat-lessons"] p') || {}).innerText === '3'`, 60000));
    await phone.evaluate(`fetch('/api/auth/logout', { method: 'POST', headers: { 'X-FO-CSRF': '1' } }).then((r) => r.status)`);
    record('persist', 'device B signs out and in again', (await signIn(phone, 'payer')) === 200);
    await phone.send('Page.navigate', { url: `${origin}/dashboard` });
    record('persist', 'after logout and login the same progress is shown', await phone.waitFor(`(document.querySelector('[data-testid="stat-lessons"] p') || {}).innerText === '3'`, 60000));

    // ---- Network interruption on device A: a failed completion is retried once, no duplicate
    await tab1.front();
    await tab1.send('Page.navigate', { url: `${origin}/courses/${P}/lessons/${L.l4}` });
    await tab1.waitFor(`(document.querySelector('main h1') || {}).innerText === 'Lesson four'`, 60000);
    await tab1.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await tab1.evaluate(`[...document.querySelectorAll('[data-testid="lesson-completion"] button')].find((b) => /Mark lesson complete/.test(b.textContent)).click()`);
    const offlineMsg = await tab1.waitFor(`/offline|Could not reach/i.test(document.querySelector('[data-testid="lesson-completion"]').innerText)`, 15000);
    await tab1.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await tab1.evaluate(`[...document.querySelectorAll('[data-testid="lesson-completion"] button')].find((b) => /Mark lesson complete/.test(b.textContent)).click()`);
    const recovered = await tab1.waitFor(`/Lesson completed/.test(document.querySelector('[data-testid="lesson-completion"]').innerText)`, 15000);
    const final = await rowOf('payer');
    record('recovery', 'offline completion fails visibly, succeeds after reconnecting, recorded once', offlineMsg && recovered && final.completedLessons.length === 4 && final.progress === 100 && final.completedAt instanceof Date);
    record('lists', 'completed course moves to Completed on the dashboard (tab 2, live)', await tab2.waitFor(`/Acceptance Swing Trading/.test((document.querySelector('[data-testid="completed-courses"]') || {}).innerText || '') && !/Acceptance Swing Trading/.test((document.querySelector('[data-testid="in-progress-courses"]') || {}).innerText || '')`, 15000));
    const days = await db.collection('learningDays').find({ userId: accounts.payer.id }).toArray();
    record('activity', 'one learning-day row for today, minutes counted once per minute', days.length === 1 && days[0].minutes >= 1 && days[0].minutes <= 6, `${days.length} day(s), ${days[0] && days[0].minutes} minute(s)`);
  } catch (error) {
    record('setup', 'run completed', false, String(error && error.stack || error).replace(/mongodb(\+srv)?:\/\/\S+/g, '<uri>').slice(0, 400));
  } finally {
    for (const b of browsers) await b.quit();
    server.kill();
  }
  const log = fs.readFileSync(logFile, 'utf8');
  record('leakage', 'no fixture email in the server log', Object.values(accounts).every((a) => !log.includes(a.email)));
  await client.close().catch(() => {});
  console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed. Server log: ${logFile}`);
  process.exit(results.every(Boolean) ? 0 : 1);
})();
