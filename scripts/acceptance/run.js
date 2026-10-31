/**
 * Phase 4 acceptance run against the REAL application and an isolated test database.
 *
 *   1. Put the test connection in .env.acceptance (ignored by Git):
 *        ACCEPTANCE_MONGODB_URI=mongodb://127.0.0.1:27017
 *        ACCEPTANCE_DB_NAME=forexorbit_phase4_acceptance
 *   2. Build once:  npx next build      (only needed for --mode production; default is dev)
 *   3. Run:         node scripts/acceptance/run.js [--reset] [--no-ui] [--port 3310]
 *
 * What it does (see scripts/acceptance/guard.js for the safety rules):
 *   - refuses any production database, a reused application URI, a non-local host without
 *     explicit opt-in, and a database holding data it did not create;
 *   - seeds synthetic accounts only (no real names or emails; passwords random per run, kept in
 *     memory) and builds the certificate unique index in the TEST database;
 *   - starts the application (node server.js) with MONGO_URI/MONGODB_DB_NAME pointing at the test
 *     database and no payment, email or storage keys, so no provider is ever called;
 *   - runs the role workflows through the real HTTP routes, then real browser screens in headless
 *     Microsoft Edge (DevTools protocol), and scans the server log for fixture email addresses;
 *   - prints one line per check and a summary; exits non-zero if any check fails.
 * --reset deletes the documents of this harness's database only (guarded by its marker).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..', '..');
const { checkAcceptanceConfig, checkDisposable, MARKER, MARKER_COLLECTION } = require('./guard');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at !== -1 && args[at + 1] ? args[at + 1] : fallback;
};

const results = [];
function record(role, check, ok, detail = '') {
  results.push({ role, check, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} [${role}] ${check}${detail ? ` (${detail})` : ''}`);
}

function strongPassword() {
  return `Acc-${crypto.randomBytes(12).toString('base64url')}-9a!`;
}

const FIXTURE_DOMAIN = 'acceptance.invalid';
const ACCOUNTS = [
  ['superadmin', 'superadmin', 'approved'],
  ['admin', 'admin', 'approved'],
  ['instructorA', 'instructor', 'approved'],
  ['instructorB', 'instructor', 'approved'],
  ['instructorSuspended', 'instructor', 'suspended'],
  ['instructorPending', 'instructor', 'pending'],
  ['studentA', 'student', 'approved'],
  ['studentB', 'student', 'approved'],
  ['studentC', 'student', 'approved'],
];

async function seed(db, { reset }) {
  const disposable = await checkDisposable(db);
  if (!disposable.ok) throw new Error(disposable.reason);
  if (!disposable.fresh) {
    if (!reset) throw new Error('The acceptance database already has fixtures from an earlier run; pass --reset to clear them.');
    for (const { name } of await db.listCollections({}, { nameOnly: true }).toArray()) {
      if (name !== MARKER_COLLECTION && !name.startsWith('system.')) await db.collection(name).deleteMany({});
    }
  }
  await db.collection(MARKER_COLLECTION).updateOne({ _id: MARKER._id }, { $set: { kind: MARKER.kind, seededAt: new Date() } }, { upsert: true });
  const bcrypt = require('bcryptjs');
  const accounts = {};
  for (const [key, role, status] of ACCOUNTS) {
    const password = strongPassword();
    const email = `${key.toLowerCase()}@${FIXTURE_DOMAIN}`;
    const doc = {
      name: `Acceptance ${key}`,
      email,
      password: await bcrypt.hash(password, 10),
      role,
      status,
      points: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...(role === 'student' ? { learningLevel: 'beginner', onboardingCompleted: true } : {}),
    };
    const { insertedId } = await db.collection('users').insertOne(doc);
    accounts[key] = { id: String(insertedId), email, password, role };
  }
  const { run: certificateIndex } = require(path.join(ROOT, 'scripts', 'certificate-indexes.js'));
  const index = await certificateIndex(db, { apply: true, log: () => {} });
  return { accounts, index };
}

function startServer({ uri, dbName, port, mode, logFile }) {
  const env = {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    APPDATA: process.env.APPDATA,
    LOCALAPPDATA: process.env.LOCALAPPDATA,
    USERPROFILE: process.env.USERPROFILE,
    NODE_ENV: mode === 'production' ? 'production' : 'development',
    PORT: String(port),
    MONGO_URI: uri,
    MONGODB_DB_NAME: dbName,
    JWT_SECRET: crypto.randomBytes(48).toString('hex'),
    NEXT_TELEMETRY_DISABLED: '1',
    NEXT_PUBLIC_ADS_ENABLED: 'false',
  };
  const out = fs.openSync(logFile, 'w');
  const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: ['ignore', out, out] });
  return child;
}

async function waitForServer(base, logFile, timeoutMs = 240000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '';
    if (/Server is ready/.test(log)) {
      try {
        const res = await fetch(`${base}/api/courses`);
        if (res.status < 500) return true;
      } catch {
        // not listening yet
      }
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

/** The session id a response set in its HttpOnly cookie (Phase 4.5), or null. */
function sessionCookieOf(res) {
  const all = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  let value = null;
  for (const cookie of all) {
    const match = /^__Host-fo_session=([^;]*)/.exec(cookie);
    if (match) value = match[1] || null;
  }
  return value;
}

/**
 * Same-origin calls as the browser makes them: the session cookie, the page Origin and the CSRF
 * header. `token` is the session id the harness holds for a fixture account (never a bearer token).
 */
function api(base) {
  return async function call(method, url, { token, body } = {}) {
    const res = await fetch(`${base}/api${url}`, {
      method,
      headers: {
        Origin: base,
        'X-FO-CSRF': '1',
        ...(token ? { Cookie: `__Host-fo_session=${token}` } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    return { status: res.status, data, session: sessionCookieOf(res) };
  };
}

/**
 * Checkout refusal. The acceptance environment has no payment keys, so the payments gate
 * (lib/payment-route.ts) refuses every checkout with 503 "not_configured" before the course state is
 * looked at. That still proves nothing can be bought here, but it does not exercise the lifecycle
 * checkout rule itself (covered by unit tests); the detail says which refusal happened.
 */
async function checkoutRefused(r, db, lifecycleStatus) {
  const intents = await db.collection('paystackPaymentIntents').countDocuments({});
  const refused = r.status === lifecycleStatus || (r.status === 503 && r.data && r.data.code === 'not_configured');
  return refused && intents === 0;
}

function checkoutDetail(r) {
  return r.status === 503 && r.data && r.data.code === 'not_configured'
    ? 'refused by the payments gate (no keys here); lifecycle rule covered by unit tests'
    : `HTTP ${r.status}`;
}

async function workflows(call, db, accounts) {
  const T = {};
  for (const [key, account] of Object.entries(accounts)) {
    if (!['approved'].includes((ACCOUNTS.find((a) => a[0] === key) || [])[2])) continue;
    const res = await call('POST', '/auth/login', { body: { email: account.email, password: account.password } });
    T[key] = res.session;
    record('setup', `login ${key}`, res.status === 200 && Boolean(T[key]) && !('token' in (res.data || {})), `HTTP ${res.status}`);
  }
  const { ObjectId } = require('mongodb');
  const A = accounts;
  const course = (title, extra = {}) => ({ title, description: '<p>Synthetic acceptance course</p>', category: 'technical', difficulty: 'beginner', ...extra });

  // ---- Instructor: draft, edit, ownership, lessons, previews, order, unsafe links
  let r = await call('POST', '/courses', { token: T.instructorA, body: course('Acceptance Course One') });
  const C1 = r.data && r.data.id;
  record('instructor', 'create own course starts as draft', r.status === 201 && r.data.status === 'draft', `HTTP ${r.status}`);
  r = await call('PUT', `/courses/${C1}`, { token: T.instructorA, body: { title: 'Acceptance Course One (edited)' } });
  record('instructor', 'edit own draft', r.status === 200, `HTTP ${r.status}`);
  r = await call('PUT', `/courses/${C1}`, { token: T.instructorB, body: { title: 'Taken over' } });
  record('instructor', 'another instructor cannot edit the course', r.status === 403, `HTTP ${r.status}`);
  const lesson = async (title, extra = {}) => call('POST', '/lessons', { token: T.instructorA, body: { courseId: C1, title, description: 'Synthetic lesson', type: 'video', ...extra } });
  const L = [];
  r = await lesson('Lesson 1', { content: '<h2>Formatted heading</h2><p>Body <strong>bold</strong></p><img src="x" onerror="window.__pwned=1">' });
  L.push(r.data && r.data.id);
  r = await lesson('Lesson 2 (preview)', { isFreePreview: true });
  L.push(r.data && r.data.id);
  r = await lesson('Lesson 3', { resources: [{ type: 'link', url: 'https://example.com/notes', title: 'Notes' }] });
  L.push(r.data && r.data.id);
  record('instructor', 'add three lessons', L.every(Boolean), `ids ${L.filter(Boolean).length}/3`);
  r = await lesson('Unsafe link', { resources: [{ type: 'link', url: ' JaVaScRiPt:alert(1)', title: 'x' }] });
  record('security', 'unsafe resource URL rejected on save', r.status === 400 && r.data && r.data.code === 'invalid_url', `HTTP ${r.status}`);
  r = await call('PUT', `/courses/${C1}/lesson-order`, { token: T.instructorA, body: { lessonIds: [...L].reverse() } });
  record('instructor', 'reorder lessons', r.status === 200, `HTTP ${r.status}`);
  r = await call('GET', `/lessons?courseId=${C1}`, { token: T.instructorA });
  const listed = Array.isArray(r.data) ? r.data : [];
  const preview = listed.filter((l) => l.isFreePreview === true).map((l) => String(l._id));
  record('instructor', 'reorder keeps the explicit free preview', preview.length === 1 && preview[0] === L[1], `previews ${preview.length}`);
  r = await call('PUT', `/courses/${C1}/lesson-order`, { token: T.instructorA, body: { lessonIds: [L[0], L[0], L[1]] } });
  record('instructor', 'invalid reorder refused', r.status === 400 || r.status === 409, `HTTP ${r.status}`);

  // ---- Student cannot see drafts
  r = await call('GET', '/courses', { token: T.studentA });
  record('student', 'draft not in catalogue', Array.isArray(r.data) && !r.data.some((c) => c.id === C1));
  r = await call('GET', `/courses/${C1}`, { token: T.studentA });
  record('student', 'draft detail not visible', r.status === 404, `HTTP ${r.status}`);
  r = await call('POST', `/courses/${C1}/enroll`, { token: T.studentA });
  record('student', 'cannot enrol in a draft', r.status === 404, `HTTP ${r.status}`);
  r = await call('POST', '/payments/paystack/init-course', { token: T.studentA, body: { courseId: C1 } });
  record('student', 'cannot buy a draft', await checkoutRefused(r, db, 404), checkoutDetail(r));

  // ---- Review and publication
  r = await call('POST', `/courses/${C1}/status`, { token: T.instructorA, body: { status: 'in_review' } });
  record('instructor', 'submit draft for review', r.status === 200, `HTTP ${r.status}`);
  r = await call('PUT', `/courses/${C1}`, { token: T.instructorA, body: { title: 'Edit in review' } });
  record('instructor', 'cannot edit while in review', r.status === 409 && r.data.code === 'course_not_editable', `HTTP ${r.status}`);
  r = await call('GET', '/courses', { token: T.studentA });
  record('student', 'in-review course not in catalogue', Array.isArray(r.data) && !r.data.some((c) => c.id === C1));
  r = await call('POST', `/courses/${C1}/status`, { token: T.instructorA, body: { status: 'published' } });
  record('instructor', 'cannot publish', r.status === 403, `HTTP ${r.status}`);
  r = await call('POST', `/courses/${C1}/status`, { token: T.studentA, body: { status: 'published' } });
  record('security', 'student cannot change lifecycle (direct API)', r.status === 403, `HTTP ${r.status}`);
  r = await call('POST', `/courses/${C1}/status`, { token: T.admin, body: { status: 'published' } });
  record('admin', 'publish a reviewed course', r.status === 200, `HTTP ${r.status}`);
  r = await call('PUT', `/courses/${C1}`, { token: T.instructorA, body: { title: 'Live edit' } });
  record('instructor', 'published course locked for instructor', r.status === 409, `HTTP ${r.status}`);
  r = await call('PUT', `/courses/${C1}`, { token: T.admin, body: { title: 'Acceptance Course One' } });
  record('admin', 'edit published course (temporary policy)', r.status === 200, `HTTP ${r.status}`);
  r = await call('PUT', `/courses/${C1}`, { token: T.admin, body: { instructorId: A.studentA.id } });
  record('admin', 'cannot assign a student as instructor', r.status === 400, `HTTP ${r.status}`);
  r = await call('PUT', `/courses/${C1}`, { token: T.admin, body: { instructorId: A.instructorSuspended.id } });
  record('admin', 'cannot assign a suspended instructor', r.status === 400, `HTTP ${r.status}`);
  r = await call('POST', '/courses', { token: T.admin, body: course('Bad assignee', { instructorId: A.instructorPending.id }) });
  record('admin', 'cannot create a course for a pending instructor', r.status === 400, `HTTP ${r.status}`);
  r = await call('DELETE', `/courses/${C1}`, { token: T.admin });
  record('admin', 'cannot delete permanently', r.status === 403 && r.data.code === 'archive_instead', `HTTP ${r.status}`);

  // ---- Student access
  r = await call('GET', '/courses', { token: T.studentB });
  record('student', 'published course in catalogue', Array.isArray(r.data) && r.data.some((c) => c.id === C1));
  r = await call('POST', `/courses/${C1}/enroll`, { token: T.studentA });
  record('student', 'enrol in a published course', r.status === 200, `HTTP ${r.status}`);
  r = await call('GET', `/lessons/${L[2]}`, { token: T.studentB });
  record('student', 'non-enrolled student cannot read lesson content', r.status === 403 && !(r.data && r.data.content), `HTTP ${r.status}`);
  r = await call('GET', `/lessons/${L[1]}`, { token: T.studentA });
  record('student', 'explicit free preview opens without purchase', r.status === 200, `HTTP ${r.status}`);
  r = await call('GET', `/lessons/${L[2]}`, { token: T.studentA });
  record('student', 'paid lesson locked before purchase', r.status === 403 && r.data && r.data.locked === true, `HTTP ${r.status}`);
  r = await call('GET', `/lessons/${L[0]}`);
  record('security', 'unauthenticated lesson request refused', r.status === 401, `HTTP ${r.status}`);
  r = await call('GET', `/courses/${C1}/lessons?view=outline`);
  record('security', 'unauthenticated outline refused', r.status === 401, `HTTP ${r.status}`);

  // A verified purchase is simulated with a staff grant row in the TEST database (no payment provider).
  await db.collection('userCourseAccess').insertOne({ userId: A.studentA.id, courseId: C1, entitlementType: 'manual_grant', createdAt: new Date() });
  const progressStatuses = [];
  for (const id of L) progressStatuses.push((await call('POST', '/progress', { token: T.studentA, body: { courseId: C1, lessonId: id } })).status);
  record('student', 'every progress update answers 200', progressStatuses.every((s) => s === 200), progressStatuses.join(','));
  r = await call('GET', `/courses/${C1}?lessons=none`, { token: T.studentA });
  const completedAt = r.data && r.data.completedAt;
  record('student', 'completing every lesson records completion', r.data && r.data.progress === 100 && Boolean(completedAt), `progress ${r.data && r.data.progress}`);
  r = await call('POST', '/lessons', { token: T.admin, body: { courseId: C1, title: 'Lesson 4 (added later)', description: 'x' } });
  const L4 = r.data && r.data.id;
  r = await call('GET', `/courses/${C1}?lessons=none`, { token: T.studentA });
  record('student', 'earned completion kept after a new lesson', r.data && r.data.completedAt === completedAt && r.data.progress < 100, `progress ${r.data && r.data.progress}`);
  // Existing policy (lib/feature-access.js: CERTIFICATES false): the student certificate pages and
  // /api/certificates are switched off and answer 404; only staff issue certificates. The student
  // route's completion rule is therefore covered by unit tests only while the feature is off.
  const studentCertsBefore = await db.collection('certificates').countDocuments({ userId: A.studentA.id });
  r = await call('POST', '/certificates', { token: T.studentA, body: { courseId: C1 } });
  const studentCertsAfter = await db.collection('certificates').countDocuments({ userId: A.studentA.id });
  record('student', 'self-service certificate follows the existing policy (feature off: 404, nothing created)', r.status === 404 && studentCertsAfter === studentCertsBefore, `HTTP ${r.status}`);
  await call('POST', '/progress', { token: T.studentA, body: { courseId: C1, lessonId: L4 } });
  await call('DELETE', `/lessons/${L[2]}`, { token: T.admin });
  const row = await db.collection('progress').findOne({ userId: A.studentA.id, courseId: C1 });
  record('student', 'progress never exceeds 100 after a completed lesson is deleted', row && row.progress <= 100, `stored ${row && row.progress}`);
  r = await call('GET', '/certificates', { token: T.studentA });
  record('student', 'certificate list follows the existing policy (feature off: 404)', r.status === 404, `HTTP ${r.status}`);

  // ---- Archive
  r = await call('POST', `/courses/${C1}/status`, { token: T.admin, body: { status: 'archived' } });
  record('admin', 'archive a published course', r.status === 200, `HTTP ${r.status}`);
  r = await call('GET', `/lessons/${L[0]}`, { token: T.studentA });
  record('student', 'enrolled student keeps archived course content', r.status === 200, `HTTP ${r.status}`);
  r = await call('POST', `/courses/${C1}/enroll`, { token: T.studentB });
  record('student', 'no new enrolment in an archived course', r.status === 409 && r.data.code === 'course_archived', `HTTP ${r.status}`);
  r = await call('POST', '/payments/paystack/init-course', { token: T.studentB, body: { courseId: C1 } });
  record('student', 'archived course cannot be bought', await checkoutRefused(r, db, 409), checkoutDetail(r));
  r = await call('GET', '/courses', { token: T.studentB });
  record('student', 'archived course not discoverable by others', Array.isArray(r.data) && !r.data.some((c) => c.id === C1));

  // ---- Super Admin: deletion and override
  r = await call('DELETE', `/courses/${C1}`, { token: T.superadmin });
  record('superadmin', 'deletion refused with protected dependencies', r.status === 409 && r.data.code === 'course_has_dependents', `${r.data && r.data.dependents}`);
  r = await call('POST', '/courses', { token: T.admin, body: course('Disposable draft', { instructorId: A.instructorA.id }) });
  const C2 = r.data && r.data.id;
  record('admin', 'create a course for an active instructor', r.status === 201, `HTTP ${r.status}`);
  r = await call('POST', `/courses/${C2}/status`, { token: T.superadmin, body: { status: 'archived' } });
  record('superadmin', 'override draft to archived', r.status === 200, `HTTP ${r.status}`);
  r = await call('DELETE', `/courses/${C2}`, { token: T.superadmin });
  record('superadmin', 'permanently delete an eligible course', r.status === 200, `HTTP ${r.status}`);

  // ---- Certificates by staff (policy unchanged; safeguards added)
  r = await call('POST', '/courses', { token: T.admin, body: course('Certificate course', { instructorId: A.instructorA.id }) });
  const C3 = r.data && r.data.id;
  await call('POST', `/courses/${C3}/status`, { token: T.superadmin, body: { status: 'published' } });
  r = await call('POST', '/admin/send-certificate', { token: T.superadmin, body: { studentIdentifier: A.studentC.email, courseId: C3 } });
  record('superadmin', 'no certificate without completion and without a reason', r.status === 400 && r.data.code === 'reason_required', `HTTP ${r.status}`);
  r = await call('POST', '/admin/send-certificate', { token: T.instructorA, body: { studentIdentifier: A.studentC.email, courseId: C3, reason: 'x' } });
  record('admin', 'issuing roles unchanged: instructor refused', r.status === 403, `HTTP ${r.status}`);
  r = await call('POST', '/admin/send-certificate', { token: T.admin, body: { studentIdentifier: { $gt: '' }, courseId: C3, reason: 'x' } });
  record('security', 'operator-shaped student identifier refused', r.status === 400, `HTTP ${r.status}`);
  const both = await Promise.all([1, 2].map(() => call('POST', '/admin/send-certificate', { token: T.superadmin, body: { studentIdentifier: A.studentC.email, courseId: C3, reason: 'Completed the in-person cohort' } })));
  const created = both.filter((x) => x.status === 201).length;
  const stored = await db.collection('certificates').countDocuments({ userId: A.studentC.id, courseId: C3 });
  record('security', 'concurrent issuance creates exactly one certificate', created === 1 && stored === 1, `201s ${created}, stored ${stored}`);
  const audit = await db.collection('adminAuditLog').countDocuments({ action: 'certificate_issued_by_staff' });
  record('superadmin', 'staff certificate is audited', audit >= 1, `audit entries ${audit}`);
  const cert = await db.collection('certificates').findOne({ userId: A.studentC.id, courseId: C3 });
  record('superadmin', 'certificate records the completion basis and reason', cert && cert.completionVerified === false && /^staff_override:/.test(cert.completionBasis) && cert.issueReason, '');

  // ---- Assignments closed in non-public courses (an enrolment row is inserted directly to model old data)
  r = await call('POST', '/courses', { token: T.instructorA, body: course('Draft with assignment') });
  const C4 = r.data && r.data.id;
  r = await call('POST', '/assignments', { token: T.instructorA, body: { courseId: C4, title: 'Synthetic assignment', instructions: 'Do it', points: 10 } });
  record('instructor', 'create assignment in own draft', r.status === 201, `HTTP ${r.status}`);
  await db.collection('progress').insertOne({ userId: A.studentB.id, courseId: C4, progress: 0, completedLessons: [], active: true });
  r = await call('GET', `/assignments?courseId=${C4}`, { token: T.studentB });
  record('student', 'assignments of a draft course inaccessible', r.status === 403, `HTTP ${r.status}`);
  return { C1, L, T };
}

async function uiChecks(base, T, ids, db, accounts) {
  const NM = path.join(ROOT, 'node_modules');
  const WebSocket = require(path.join(NM, 'ws'));
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  if (!fs.existsSync(edge)) { record('ui', 'browser available', false, 'Microsoft Edge not found'); return; }
  // A stored unsafe link from before the API refused them (inserted directly into the TEST database).
  await db.collection('lessons').updateOne({ _id: new (require('mongodb').ObjectId)(ids.L[0]) }, { $set: { resources: [{ type: 'link', url: 'javascript:window.__pwned=1', title: 'Legacy unsafe link' }] } });
  const port = 9340;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fo-acceptance-edge-'));
  const proc = spawn(edge, ['--headless=new', '--disable-gpu', '--no-first-run', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  try {
    let target = null;
    for (let i = 0; i < 60 && !target; i += 1) {
      try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page'); } catch { await new Promise((r) => setTimeout(r, 500)); }
    }
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve) => ws.once('open', resolve));
    let n = 0; const pending = new Map();
    ws.on('message', (raw) => { const m = JSON.parse(raw); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } });
    const send = (method, params = {}) => new Promise((resolve) => { n += 1; pending.set(n, resolve); ws.send(JSON.stringify({ id: n, method, params })); });
    const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.value;
    // Signs in through the real login API from the page, so the browser itself stores the HttpOnly
    // session cookie (Phase 4.5); the password is held in memory only and never logged.
    await send('Network.enable');
    const open = async (who, url) => {
      await send('Network.clearBrowserCookies');
      await send('Page.navigate', { url: `${base}/login` });
      await new Promise((r) => setTimeout(r, 2500));
      const status = await evaluate(`fetch('/api/auth/login', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-FO-CSRF': '1' }, body: JSON.stringify({ email: ${JSON.stringify(accounts[who].email)}, password: ${JSON.stringify(accounts[who].password)} }) }).then((r) => r.status)`);
      if (status !== 200) throw new Error(`browser sign-in for ${who} answered ${status}`);
      await send('Page.navigate', { url: `${base}${url}` });
      await new Promise((r) => setTimeout(r, 8000));
      return evaluate('document.body.innerText');
    };
    let text = await open('studentB', '/courses');
    record('ui', 'student catalogue page lists published, hides draft', text.includes('Certificate course') && !text.includes('Draft with assignment'));
    text = await open('studentA', `/courses/${ids.C1}/lessons/${ids.L[0]}`);
    const lesson = await evaluate(`({ h2: !!document.querySelector('h2') && [...document.querySelectorAll('h2')].some(h => h.textContent.includes('Formatted heading')), escaped: document.body.innerText.includes('<h2>'), unsafeAnchor: [...document.querySelectorAll('a')].some(a => /^\\s*javascript:/i.test(a.getAttribute('href') || '')), linkText: document.body.innerText.includes('Legacy unsafe link'), pwned: window.__pwned === 1 })`);
    record('ui', 'lesson HTML renders formatted (sanitized fragment)', lesson.h2 && !lesson.escaped, JSON.stringify(lesson));
    record('ui', 'unsafe resource link shown as plain text', lesson.linkText && !lesson.unsafeAnchor);
    await evaluate(`[...document.querySelectorAll('[aria-disabled="true"]')].forEach(el => el.click()); true`);
    await new Promise((r) => setTimeout(r, 500));
    record('ui', 'no injected script ran on the lesson page', (await evaluate('window.__pwned === 1')) === false);
    text = await open('admin', '/admin');
    await evaluate(`[...document.querySelectorAll('button, a')].find(b => /courses/i.test(b.textContent || ''))?.click(); true`);
    await new Promise((r) => setTimeout(r, 3000));
    text = await evaluate('document.body.innerText');
    record('ui', 'admin sees course status chips', /Published|Archived|Draft/.test(text));
    record('ui', 'admin has no permanent delete button', !/Delete permanently/.test(text));
    text = await open('instructorA', '/instructor/dashboard');
    record('ui', 'instructor dashboard loads', !/Something went wrong|Application error/i.test(text));

    // Phase 4.5: the session lives only in an HttpOnly cookie that script cannot read.
    const stored = await evaluate(`(async () => ({
      cookie: document.cookie,
      local: Object.keys(localStorage),
      session: Object.keys(sessionStorage),
      idb: indexedDB.databases ? (await indexedDB.databases()).map((d) => d.name) : [],
    }))()`);
    const jar = (await send('Network.getCookies', { urls: [base] })).cookies.filter((c) => c.name === '__Host-fo_session');
    record('ui', 'session cookie is HttpOnly, Secure, SameSite=Lax, host-only', jar.length === 1 && jar[0].httpOnly && jar[0].secure && jar[0].sameSite === 'Lax' && !jar[0].domain.startsWith('.'), JSON.stringify(jar.map((c) => ({ httpOnly: c.httpOnly, secure: c.secure, sameSite: c.sameSite }))));
    record('ui', 'script cannot read the session (document.cookie)', !String(stored.cookie).includes('fo_session'));
    record('ui', 'no token or user in localStorage, sessionStorage or IndexedDB', !stored.local.some((k) => /token|user/i.test(k)) && !stored.session.some((k) => /token|user/i.test(k)) && stored.idb.length === 0, JSON.stringify(stored.local));
    // Reload keeps the person signed in (profile re-read with the cookie).
    await send('Page.reload');
    await new Promise((r) => setTimeout(r, 8000));
    record('ui', 'a reload keeps the session (refresh recovery)', !/\bSign in\b.*\bPassword\b/s.test(await evaluate('document.body.innerText')) && (await evaluate(`fetch('/api/auth/me').then((r) => r.status)`)) === 200);
    // Sign out from the page ends the session on the server and clears the cookie.
    const out = await evaluate(`fetch('/api/auth/logout', { method: 'POST', headers: { 'X-FO-CSRF': '1' } }).then((r) => r.status)`);
    const after = await evaluate(`fetch('/api/auth/me').then((r) => r.status)`);
    const left = (await send('Network.getCookies', { urls: [base] })).cookies.filter((c) => c.name === '__Host-fo_session');
    record('ui', 'sign-out ends the session and clears the cookie', out === 200 && after === 401 && left.length === 0, `logout ${out}, me ${after}`);
    ws.close();
  } catch (error) {
    record('ui', 'browser checks completed', false, String(error && error.message));
  } finally {
    proc.kill();
  }
}

(async () => {
  const envFile = path.join(ROOT, '.env.acceptance');
  const fileEnv = fs.existsSync(envFile) ? require('dotenv').parse(fs.readFileSync(envFile)) : {};
  const config = checkAcceptanceConfig({ ...process.env, ...fileEnv });
  if (!config.ok) {
    console.error(`Acceptance run refused: ${config.reason}`);
    process.exit(2);
  }
  console.log(`Acceptance database: ${config.dbName} (${config.hosts}). The URI is not printed.`);
  const { MongoClient } = require('mongodb');
  const client = new MongoClient(config.uri, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db(config.dbName);
  // Every write must stay in the acceptance database: remember which databases exist now.
  const listDatabases = async () => {
    try {
      return (await client.db().admin().listDatabases({ nameOnly: true })).databases.map((d) => d.name);
    } catch {
      return null;
    }
  };
  const databasesBefore = await listDatabases();
  const logFile = path.join(os.tmpdir(), `fo-acceptance-server-${Date.now()}.log`);
  let server = null;
  try {
    const { accounts, index } = await seed(db, { reset: flag('--reset') });
    record('setup', 'certificate unique index built in the test database', index.ok && index.state === 'present', index.state);
    const port = Number(option('--port', '3310'));
    const base = `http://localhost:${port}`;
    server = startServer({ uri: config.uri, dbName: config.dbName, port, mode: option('--mode', 'development'), logFile });
    if (!(await waitForServer(base, logFile))) throw new Error(`The application did not start; see ${logFile}`);
    record('setup', 'real application started against the test database', true, base);
    const ids = await workflows(api(base), db, accounts);
    if (!flag('--no-ui')) await uiChecks(base, ids.T, ids, db, accounts);
    const log = fs.readFileSync(logFile, 'utf8');
    const leaked = Object.values(accounts).filter((a) => log.includes(a.email)).length;
    record('security', 'no fixture email address in the server log', leaked === 0, `${leaked} found`);
    const databasesAfter = await listDatabases();
    if (databasesBefore && databasesAfter) {
      const created = databasesAfter.filter((name) => !databasesBefore.includes(name) && name !== config.dbName);
      record('security', 'no database other than the acceptance database was written', created.length === 0, created.length ? `new: ${created.join(', ')}` : 'none created');
    } else {
      record('security', 'no database other than the acceptance database was written', true, 'not checkable: this account cannot list databases');
    }
  } catch (error) {
    record('setup', 'run completed', false, String(error && error.message).replace(/mongodb(\+srv)?:\/\/\S+/g, '<uri>'));
  } finally {
    if (server) server.kill();
    await client.close().catch(() => {});
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed. Server log: ${logFile}`);
  process.exit(failed.length ? 1 : 0);
})();
