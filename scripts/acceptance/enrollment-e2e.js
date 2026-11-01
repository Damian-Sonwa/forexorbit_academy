/**
 * Phase 6 enrollment and course access against the real application (node server.js) and headless
 * Microsoft Edge. Same safety rules as scripts/acceptance/run.js (guard.js): local or opted-in test
 * server, a database ending in "_acceptance", synthetic accounts only. Uses its own database,
 * <ACCEPTANCE_DB_NAME without "_acceptance">_enrollment_acceptance, marked as the harness's.
 *
 *   node scripts/acceptance/enrollment-e2e.js
 *
 * The server runs WITHOUT a Paystack key, so no request can reach Paystack. Entitlements are seeded
 * or granted through the Super Admin course-access route.
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

/** Quit headless Edge over DevTools (Browser.close on the browser endpoint). */
async function closeBrowser(port) {
  try {
    const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    const WebSocketClient = require('ws');
    const socket = new WebSocketClient(webSocketDebuggerUrl, { perMessageDeflate: false });
    await new Promise((resolve) => { socket.once('open', resolve); socket.once('error', resolve); setTimeout(resolve, 5000); });
    if (socket.readyState === 1) socket.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
    await new Promise((resolve) => { socket.once('close', resolve); setTimeout(resolve, 5000); });
  } catch {
    // Not reachable: the browser has already gone.
  }
}

(async () => {
  const envFile = path.join(ROOT, '.env.acceptance');
  const fileEnv = fs.existsSync(envFile) ? require('dotenv').parse(fs.readFileSync(envFile)) : {};
  const merged = { ...process.env, ...fileEnv };
  const base = checkAcceptanceConfig(merged);
  if (!base.ok) { console.error(`Refused: ${base.reason}`); process.exit(2); }
  const dbName = `${base.dbName.replace(/_(acceptance|test)$/, '')}_enrollment_acceptance`;
  const config = checkAcceptanceConfig({ ...merged, ACCEPTANCE_DB_NAME: dbName });
  if (!config.ok) { console.error(`Refused: ${config.reason}`); process.exit(2); }
  console.log(`Database: ${dbName} (${config.hosts}). The URI is not printed.`);

  const { MongoClient, ObjectId } = require('mongodb');
  const bcrypt = require('bcryptjs');
  const { ensureEnrollmentIndexes } = require('../../lib/enrollment-indexes');
  const { COURSE_PAYMENT_INDEXES } = require('../../lib/course-payment-indexes');
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
  record('setup', 'enrollment index E1 built in the acceptance database', (await ensureEnrollmentIndexes(db, { apply: true })).ok);

  const accounts = {};
  for (const [key, role] of [['student', 'student'], ['other', 'student'], ['admin', 'admin'], ['superadmin', 'superadmin']]) {
    const password = `Acc-${crypto.randomBytes(12).toString('base64url')}-9a!`;
    const email = `${key}@enrollment.acceptance.invalid`;
    const { insertedId } = await db.collection('users').insertOne({ name: `Enrollment ${key}`, email, password: await bcrypt.hash(password, 10), role, status: 'approved', learningLevel: 'beginner', onboardingCompleted: true, createdAt: new Date(), updatedAt: new Date() });
    accounts[key] = { id: String(insertedId), email, password };
  }
  const now = new Date();
  const P = new ObjectId();
  const X = new ObjectId();
  const Q = new ObjectId();
  await db.collection('courses').insertMany([
    { _id: P, title: 'Acceptance Market Structure', status: 'published', difficulty: 'beginner', category: 'forex', freePreviewExplicit: true, createdAt: now },
    { _id: X, title: 'Acceptance Archived Course', status: 'archived', difficulty: 'beginner', category: 'forex', freePreviewExplicit: true, createdAt: now },
    { _id: Q, title: 'Acceptance Risk Basics', status: 'published', difficulty: 'beginner', category: 'forex', freePreviewExplicit: true, createdAt: now },
  ]);
  const lesson = async (courseId, order, title, flags = {}) => String((await db.collection('lessons').insertOne({ courseId: String(courseId), order, title, type: 'text', content: `<p>${title} body SECRET-${title.replace(/\W/g, '')}</p>`, createdAt: now, ...flags })).insertedId);
  const L = {
    preview: await lesson(P, 1, 'Preview lesson', { isFreePreview: true }),
    paid: await lesson(P, 2, 'Paid lesson'),
    demo: await lesson(P, 3, 'Demo lesson', { isDemo: true }),
    xPreview: await lesson(X, 1, 'Archived preview', { isFreePreview: true }),
    xPaid: await lesson(X, 2, 'Archived paid'),
    qPreview: await lesson(Q, 1, 'Risk preview', { isFreePreview: true }),
  };
  // The student bought the archived course earlier and later left it.
  await db.collection('userCourseAccess').insertOne({ userId: accounts.student.id, courseId: String(X), paid: true, entitlementType: 'paid_course', paystackReference: 'fo_c_acc_1_abcdef12', unlockedAt: now, createdAt: now });
  await db.collection('progress').insertOne({ userId: accounts.student.id, courseId: String(X), progress: 0, completedLessons: [], active: false, withdrawnAt: now, createdAt: now });

  const port = 3340;
  const origin = `http://localhost:${port}`;
  const logFile = path.join(os.tmpdir(), `fo-enrollment-e2e-${Date.now()}.log`);
  const env = {
    PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP,
    APPDATA: process.env.APPDATA, LOCALAPPDATA: process.env.LOCALAPPDATA, USERPROFILE: process.env.USERPROFILE,
    NODE_ENV: 'development', PORT: String(port), MONGO_URI: config.uri, MONGODB_DB_NAME: dbName,
    JWT_SECRET: crypto.randomBytes(48).toString('hex'), NEXT_TELEMETRY_DISABLED: '1', NEXT_PUBLIC_ADS_ENABLED: 'false',
    PAYMENT_RECONCILE_INTERVAL_MINUTES: '0',
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
    const json = async (res) => { try { return await res.json(); } catch { return null; } };
    const login = async (key) => sessionOf(await call('POST', '/auth/login', { body: { email: accounts[key].email, password: accounts[key].password } }));
    const T = {};
    for (const key of Object.keys(accounts)) T[key] = await login(key);
    record('setup', 'all accounts signed in', Object.values(T).every(Boolean));
    const rows = (userId, courseId) => db.collection('progress').find({ userId, courseId: String(courseId) }).toArray();

    // ---- Enrollment
    const burst = await Promise.all([1, 2, 3].map(() => call('POST', `/courses/${P}/enroll`, { token: T.student })));
    const codes = burst.map((r) => r.status).sort();
    record('enroll', 'three simultaneous enroll requests: one succeeds, two answer "Already enrolled"', codes.join() === '200,400,400', codes.join());
    record('enroll', 'exactly one enrollment row exists', (await rows(accounts.student.id, P)).length === 1);
    let r = await call('POST', `/courses/${new ObjectId()}/enroll`, { token: T.student });
    record('enroll', 'unknown course refused', r.status === 404);
    r = await call('POST', `/courses/${X}/enroll`, { token: T.other });
    record('enroll', 'archived course refuses a new student', r.status >= 400 && r.status < 500, `HTTP ${r.status}`);
    r = await call('GET', `/courses/${X}?lessons=none`, { token: T.other });
    record('enroll', 'archived course hidden from a non-owner', r.status === 404);
    r = await call('GET', `/courses/${X}?lessons=none`, { token: T.student });
    const xView = await json(r);
    record('enroll', 'archived course visible to the student who bought it (owned, not enrolled)', r.status === 200 && xView.owned === true && xView.enrolled === false);
    r = await call('POST', `/courses/${X}/enroll`, { token: T.student });
    record('enroll', 'the owner returns to the archived course', r.status === 200 && (await rows(accounts.student.id, X))[0].active === true);
    r = await call('POST', `/courses/${P}/enroll`, { token: T.admin });
    record('enroll', 'a non-student cannot enroll', r.status === 403);

    // ---- Direct URL access and progress
    r = await call('GET', `/lessons/${L.paid}`, { token: T.student });
    const paidBody = await r.text();
    record('access', 'paid lesson by direct URL: 403 and no lesson body', r.status === 403 && !paidBody.includes('SECRET-Paidlesson'));
    r = await call('GET', `/lessons/${L.preview}`, { token: T.student });
    record('access', 'free preview opens', r.status === 200 && (await r.text()).includes('SECRET-Previewlesson'));
    r = await call('GET', `/lessons/${L.qPreview}`, { token: T.student });
    record('access', 'a lesson of a course the student is not enrolled in is refused', r.status === 403);
    r = await call('POST', '/progress', { token: T.student, body: { courseId: String(P), lessonId: L.paid } });
    record('progress', 'completing a locked lesson is refused (lesson_locked)', r.status === 403 && (await json(r)).code === 'lesson_locked');
    r = await call('POST', '/progress', { token: T.student, body: { courseId: String(P), lessonId: L.preview, userId: accounts.other.id } });
    record('progress', 'completing a free preview works and stays on the session user', r.status === 200 && (await rows(accounts.student.id, P))[0].completedLessons.includes(L.preview) && (await rows(accounts.other.id, P)).length === 0);
    r = await call('POST', '/certificates', { token: T.student, body: { courseId: String(P) } });
    // Certificates are switched off by their feature flag (lib/feature-access.js); the Phase 6
    // certificate rule is covered by tests/phase-6-enrollment.test.js and applies once it is on.
    record('progress', 'the certificates API is switched off by its feature flag (404)', r.status === 404);
    await db.collection('progress').updateOne({ userId: accounts.student.id, courseId: String(P) }, { $set: { completedLessons: [L.preview, L.paid, L.demo], progress: 100, completedAt: now } });

    // ---- Super Admin course access
    for (const who of ['student', 'admin']) {
      r = await call('POST', '/admin/course-access', { token: T[who], body: { action: 'grant', userId: accounts.student.id, courseId: String(P), reason: 'Not allowed here' } });
      record('admin', `${who} refused on course-access grants`, r.status === 403);
    }
    r = await call('POST', '/admin/course-access', { token: T.superadmin, body: { action: 'grant', userId: accounts.student.id, courseId: String(P), reason: 'x' } });
    record('admin', 'a grant without a real reason is refused', r.status === 400);
    r = await call('POST', '/admin/course-access', { token: T.superadmin, body: { action: 'grant', userId: accounts.student.id, courseId: String(P), reason: 'Acceptance scholarship' } });
    record('admin', 'Super Admin grants complimentary access', r.status === 200 && (await json(r)).code === 'granted');
    r = await call('GET', `/lessons/${L.paid}`, { token: T.student });
    record('admin', 'the paid lesson opens after the grant', r.status === 200);
    r = await call('POST', '/admin/course-access', { token: T.superadmin, body: { action: 'revoke', userId: accounts.student.id, courseId: String(X), reason: 'Try to revoke paid access' } });
    record('admin', 'paid access cannot be revoked from course access', r.status === 409 && (await json(r)).code === 'paid_access');
    r = await call('POST', '/admin/course-access', { token: T.superadmin, body: { action: 'revoke', userId: accounts.student.id, courseId: String(P), reason: 'Acceptance revocation' } });
    record('admin', 'Super Admin revokes the grant', r.status === 200);
    r = await call('GET', `/lessons/${L.paid}`, { token: T.student });
    record('admin', 'the paid lesson is locked again after the revocation', r.status === 403);
    const audit = await db.collection('adminAuditLog').find({ entityType: 'course_access' }).toArray();
    record('admin', 'grant and revocation are in the audit log with the Super Admin as actor', audit.length === 2 && audit.every((a) => a.actor.userId === accounts.superadmin.id && a.reason));
    r = await call('GET', `/admin/audit-log?entityType=course_access`, { token: T.superadmin });
    record('admin', 'the audit trail can be filtered to course access', r.status === 200 && ((await json(r)).items || []).length === 2);

    // ---- Browser
    const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
    if (!fs.existsSync(edge)) {
      record('ui', 'browser available', false, 'Microsoft Edge not found');
    } else {
      const WebSocket = require('ws');
      const debugPort = 9363;
      const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fo-enrollment-edge-'));
      browser = spawn(edge, ['--headless=new', '--disable-gpu', '--no-first-run', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
      let pages = [];
      for (let i = 0; i < 60 && !pages.length; i += 1) {
        try { pages = (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).filter((t) => t.type === 'page'); } catch { await sleep(500); }
      }
      const ws = new WebSocket(pages[0].webSocketDebuggerUrl, { perMessageDeflate: false });
      await new Promise((resolve) => ws.once('open', resolve));
      let n = 0; const pending = new Map();
      ws.on('message', (m) => { const msg = JSON.parse(m); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result || {}); pending.delete(msg.id); } });
      // Every DevTools call answers within 30 s, so a page that never replies fails its check instead of
      // hanging the run (the 1 November 2026 rerun stalled here with no timeout).
      const send = (method, params = {}) => new Promise((resolve) => {
        n += 1;
        const id = n;
        const timer = setTimeout(() => { pending.delete(id); console.log(`WARN DevTools ${method} timed out`); resolve({}); }, 30000);
        pending.set(id, (value) => { clearTimeout(timer); resolve(value); });
        ws.send(JSON.stringify({ id, method, params }));
      });
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
        await send('Page.navigate', { url: `${origin}/courses` });
        await sleep(9000);
        const page = await evaluate(`({ text: document.body.innerText, sw: document.documentElement.scrollWidth, w: innerWidth })`);
        record('ui', `${label}: course list shows the archived course the student owns, with its state`, /Acceptance Archived Course/.test(page.text) && /Full access/i.test(page.text) && /Archived/.test(page.text));
        record('ui', `${label}: completed course is marked`, /Completed/.test(page.text));
        record('ui', `${label}: no horizontal overflow on the course list`, page.sw <= page.w + 1, `${page.sw}/${page.w}`);
      }
      await send('Emulation.clearDeviceMetricsOverride');
      // Enroll from a card: the button disables while the request runs, and one row is written.
      await send('Page.navigate', { url: `${origin}/courses` });
      await sleep(9000);
      const clicked = await evaluate(`(() => { const card = [...document.querySelectorAll('article')].find((a) => /Acceptance Risk Basics/.test(a.innerText)); const b = card && [...card.querySelectorAll('button')].find((x) => /^Enroll$/.test(x.textContent.trim())); if (!b) return false; b.click(); b.click(); return true; })()`);
      await sleep(5000);
      const qRows = await rows(accounts.student.id, Q);
      record('ui', 'enrolling from a card (double click) creates one enrollment', clicked && qRows.length === 1 && qRows[0].active === true, clicked ? `${qRows.length} rows` : 'no Enroll button');
      await send('Page.navigate', { url: `${origin}/courses/${P}` });
      await sleep(9000);
      const pText = await evaluate('document.body.innerText');
      record('ui', 'course page after the revocation: the paid lesson locked behind the unlock offer with price, fee and total; no paid content', /1 locked lesson in this course/.test(pText) && /Unlock full course/.test(pText) && /Total payable/.test(pText) && !/SECRET-Paidlesson/.test(pText));

      record('ui', 'Super Admin signs in from the page', (await signInAs('superadmin')) === 200);
      for (const [label, width, mobile] of [['desktop', 1366, false], ['phone', 390, true]]) {
        await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: mobile ? 3 : 1, mobile });
        await send('Page.navigate', { url: `${origin}/admin/course-access` });
        await sleep(9000);
        await evaluate(`(() => { const input = document.getElementById('course-access-student'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, ${JSON.stringify(accounts.student.email)}); input.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
        await sleep(300);
        await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Look up'); b && b.click(); return Boolean(b); })()`);
        await sleep(4000);
        const page = await evaluate(`({ text: document.body.innerText, sw: document.documentElement.scrollWidth, w: innerWidth })`);
        record('ui', `${label}: course access page shows the student's courses, access and enrollment`, /Acceptance Market Structure/.test(page.text) && /Grant revoked/.test(page.text) && /Acceptance Archived Course/.test(page.text) && /Paid/.test(page.text));
        record('ui', `${label}: no horizontal overflow on the course access page`, page.sw <= page.w + 1, `${page.sw}/${page.w}`);
      }
      await send('Emulation.clearDeviceMetricsOverride');
      await send('Page.navigate', { url: `${origin}/admin` });
      await sleep(8000);
      record('ui', 'Super Admin menu has the Course Access link', await evaluate(`[...document.querySelectorAll('a')].some((a) => a.getAttribute('href') === '/admin/course-access')`));
      ws.close();
    }
  } catch (error) {
    record('setup', 'run completed', false, String(error && error.message).replace(/mongodb(\+srv)?:\/\/\S+/g, '<uri>'));
  } finally {
    // Edge's launcher hands off to another process, so killing the spawned PID alone leaves Edge running.
    if (browser) { await closeBrowser(9363); browser.kill(); }
    server.kill();
  }
  const log = fs.readFileSync(logFile, 'utf8');
  record('leakage', 'no fixture email in the server log', Object.values(accounts).every((a) => !log.includes(a.email)));
  await client.close().catch(() => {});
  console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed. Server log: ${logFile}`);
  process.exit(results.every(Boolean) ? 0 : 1);
})();
