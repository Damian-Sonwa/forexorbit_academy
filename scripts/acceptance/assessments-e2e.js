/**
 * Phase 9 assessments against the real application (node server.js), real MongoDB and headless
 * Microsoft Edge: the student quiz lifecycle, autosave, refresh, timer expiry, results, review
 * policy, assignments and grading, the instructor editor and results, authorization boundaries,
 * and phone widths. Same safety rules as scripts/acceptance/run.js (guard.js): local or opted-in
 * test server, a database ending in "_acceptance", synthetic accounts only. Uses
 * <ACCEPTANCE_DB_NAME without "_acceptance">_assessments_acceptance.
 *
 *   node scripts/acceptance/assessments-e2e.js
 *
 * The server runs WITHOUT a Paystack key; the students' entitlements are seeded.
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
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), `fo-assessments-edge-${label}-`));
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


/** Sets a React-controlled field the way typing does. */
const FILL = `window.__fill = (el, value) => {
  const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
}; window.__alerts = []; window.alert = (m) => window.__alerts.push(String(m)); true`;
const clickText = (selector, pattern) => `(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((b) => ${pattern}.test(b.textContent)); if (el) el.click(); return Boolean(el); })()`;

(async () => {
  const envFile = path.join(ROOT, '.env.acceptance');
  const fileEnv = fs.existsSync(envFile) ? require('dotenv').parse(fs.readFileSync(envFile)) : {};
  const merged = { ...process.env, ...fileEnv };
  const base = checkAcceptanceConfig(merged);
  if (!base.ok) { console.error(`Refused: ${base.reason}`); process.exit(2); }
  const dbName = `${base.dbName.replace(/_(acceptance|test)$/, '')}_assessments_acceptance`;
  const config = checkAcceptanceConfig({ ...merged, ACCEPTANCE_DB_NAME: dbName });
  if (!config.ok) { console.error(`Refused: ${config.reason}`); process.exit(2); }
  console.log(`Database: ${dbName} (${config.hosts}). The URI is not printed.`);
  if (!fs.existsSync(EDGE)) { console.error('Microsoft Edge not found'); process.exit(2); }

  const { MongoClient, ObjectId } = require('mongodb');
  const bcrypt = require('bcryptjs');
  const { ensureEnrollmentIndexes } = require('../../lib/enrollment-indexes');
  const { COURSE_PAYMENT_INDEXES } = require('../../lib/course-payment-indexes');
  const { ensureAssessmentIndexes } = require('../../lib/assessment-indexes');
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
  for (const name of ['quizAttempts', 'quizScores', 'quizzes', 'assignmentSubmissions']) await db.createCollection(name).catch(() => {});
  record('setup', 'assessment indexes A1-A6 built', (await ensureAssessmentIndexes(db, { apply: true })).ok);

  const accounts = {};
  for (const [key, role] of [['student', 'student'], ['second', 'student'], ['third', 'student'], ['phone', 'student'], ['instructor', 'instructor'], ['rival', 'instructor'], ['admin', 'admin']]) {
    const password = `Acc-${crypto.randomBytes(12).toString('base64url')}-9a!`;
    const email = `${key}@assessments.acceptance.invalid`;
    const { insertedId } = await db.collection('users').insertOne({ name: `Assess ${key}`, email, password: await bcrypt.hash(password, 10), role, status: 'approved', sessionGeneration: 0, points: 0, createdAt: new Date() });
    accounts[key] = { id: String(insertedId), email, password };
  }
  const now = new Date();
  const P = new ObjectId();
  const D = new ObjectId();
  const R = new ObjectId();
  const course = (_id, title, status, instructorId) => db.collection('courses').insertOne({ _id, title, status, difficulty: 'beginner', category: 'forex', description: title, instructorId, freePreviewExplicit: true, createdAt: now, updatedAt: now });
  await course(P, 'Acceptance Assessments', 'published', accounts.instructor.id);
  await course(D, 'Acceptance Draft Course', 'draft', accounts.instructor.id);
  await course(R, 'Rival Course', 'published', accounts.rival.id);
  const lesson = async (courseId, order, title, flags = {}) => String((await db.collection('lessons').insertOne({ courseId: String(courseId), order, title, type: 'text', content: `<p>${title} body</p>`, description: title, createdAt: now, ...flags })).insertedId);
  const L = {
    main: await lesson(P, 1, 'Quiz lesson', { isFreePreview: true }),
    timed: await lesson(P, 2, 'Timed lesson'),
    never: await lesson(P, 3, 'Sealed lesson'),
    draft: await lesson(P, 4, 'Draft quiz lesson'),
    abandoned: await lesson(P, 5, 'Abandoned lesson'),
    plain: await lesson(P, 6, 'No pass mark lesson'),
    authored: await lesson(D, 1, 'Authoring lesson'),
  };
  const QS = [
    { id: 'aaaaaaaaaaaa', question: 'What is a pip?', options: ['A fruit', 'A price step'], correctAnswer: 1, points: 1, explanation: 'SECRET-WHY-PIP' },
    { id: 'bbbbbbbbbbbb', question: 'What is the spread?', options: ['Bid-ask gap', 'A sandwich', 'A chart'], correctAnswer: 0, points: 1, explanation: '' },
    { id: 'cccccccccccc', question: 'What does long mean?', options: ['Sell', 'Hold', 'Buy'], correctAnswer: 2, points: 2, explanation: '' },
  ];
  const SETTINGS = { status: 'published', maxAttempts: null, timeLimitMinutes: null, passingPercent: null, reviewPolicy: 'after_submission', shuffleQuestions: false, shuffleOptions: false, availableFrom: null, availableUntil: null };
  const quiz = (lessonId, settings) => db.collection('quizzes').insertOne({ lessonId, courseId: String(P), questions: QS, settings: { ...SETTINGS, ...settings }, version: 1, createdAt: now });
  await quiz(L.main, { maxAttempts: 2, passingPercent: 60, shuffleQuestions: true, shuffleOptions: true });
  await quiz(L.timed, { timeLimitMinutes: 1 });
  await quiz(L.never, { reviewPolicy: 'never' });
  await quiz(L.draft, { status: 'draft' });
  await quiz(L.abandoned, { timeLimitMinutes: 5 });
  await quiz(L.plain, {});
  for (const key of ['student', 'second', 'third', 'phone']) {
    await db.collection('progress').insertOne({ userId: accounts[key].id, courseId: String(P), progress: 0, completedLessons: [], active: true, createdAt: now });
    await db.collection('userCourseAccess').insertOne({ userId: accounts[key].id, courseId: String(P), paid: true, entitlementType: 'paid_course', paystackReference: `fo_c_assess_${key}`, unlockedAt: now, createdAt: now });
  }
  const assignment = String((await db.collection('assignments').insertOne({ courseId: String(P), lessonId: L.main, title: 'Trade journal', description: '', instructions: 'Write one entry.', points: 40, dueDate: new Date(Date.now() - 86400000).toISOString(), type: 'assignment', createdAt: now })).insertedId);
  const attemptsOf = (key, lessonId) => db.collection('quizAttempts').find({ userId: accounts[key].id, lessonId }).sort({ number: 1 }).toArray();
  const progressOf = (key) => db.collection('progress').findOne({ userId: accounts[key].id, courseId: String(P) });

  const port = 3349;
  const origin = `http://localhost:${port}`;
  const logFile = path.join(os.tmpdir(), `fo-assessments-e2e-${Date.now()}.log`);
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
    const call = (method, url, { token, body, headers } = {}) => fetch(`${origin}/api${url}`, { method, headers: { Origin: origin, 'X-FO-CSRF': '1', ...(token ? { Cookie: `__Host-fo_session=${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    const json = async (res) => { try { return await res.json(); } catch { return null; } };
    const login = async (key) => sessionOf(await call('POST', '/auth/login', { body: { email: accounts[key].email, password: accounts[key].password } }));
    const T = {};
    for (const key of Object.keys(accounts)) T[key] = await login(key);
    record('setup', 'all accounts signed in', Object.values(T).every(Boolean));

    // ---- Direct API on the live server (what a hand-made request can reach)
    let r = await call('GET', `/quizzes/${L.main}`);
    record('api', 'no session: refused', r.status === 401);
    r = await call('GET', `/quizzes/${L.main}`, { token: T.student });
    let body = await r.text();
    record('api', 'student quiz read: no questions, no key, not cacheable', r.status === 200 && !/correctAnswer|SECRET-WHY|What is a pip/.test(body) && /no-store/.test(r.headers.get('cache-control') || ''));
    r = await call('GET', `/lessons/${L.main}`, { token: T.student });
    body = await r.text();
    record('api', 'lesson payload: a quiz summary only', r.status === 200 && !/correctAnswer|SECRET-WHY|What is a pip/.test(body) && /questionCount/.test(body));
    r = await call('POST', `/quizzes/${L.draft}/attempts`, { token: T.student });
    record('api', 'a draft quiz does not exist for a student', r.status === 404);
    r = await call('POST', `/quizzes/${L.main}/attempts`, { token: T.student, headers: { Origin: 'https://evil.example' } });
    record('api', 'a foreign Origin is refused', r.status === 403);
    r = await fetch(`${origin}/api/quizzes/${L.main}/attempts`, { method: 'POST', headers: { Origin: origin, Cookie: `__Host-fo_session=${T.student}` } });
    record('api', 'no CSRF header: refused', r.status === 403);
    r = await call('GET', `/quizzes/${L.main}/attempts`, { token: T.rival });
    record('api', 'another instructor cannot read this course\'s results', r.status === 403);
    r = await call('PUT', `/quizzes/${L.main}`, { token: T.student, body: { questions: QS, settings: { maxAttempts: 20 } } });
    record('api', 'a student cannot change a quiz', r.status === 403);
    const burst = await Promise.all(Array.from({ length: 20 }, () => call('POST', `/quizzes/${L.abandoned}/attempts`, { token: T.third })));
    const burstCodes = [...new Set(burst.map((x) => x.status))].sort();
    const thirdRows = await attemptsOf('third', L.abandoned);
    record('api', '20 simultaneous starts over HTTP: one attempt, no server error', thirdRows.length === 1 && burstCodes.every((c) => c < 500), `statuses ${burstCodes.join(',')}`);
    const attemptId = String(thirdRows[0]._id);
    r = await call('GET', `/quizzes/${L.abandoned}/attempts/${attemptId}`, { token: T.second });
    record('api', 'another student\'s attempt id: not found', r.status === 404);
    r = await call('PUT', `/quizzes/${L.abandoned}/attempts/${attemptId}`, { token: T.third, body: { questionId: 'aaaaaaaaaaaa', answer: 1 } });
    record('api', 'autosave accepted for the owner', r.status === 200);
    const submits = await Promise.all(Array.from({ length: 12 }, () => call('POST', `/quizzes/${L.abandoned}/attempts/${attemptId}`, { token: T.third, body: { answers: { aaaaaaaaaaaa: 1 }, score: 100, passed: true } })));
    const scoreRows = await db.collection('quizScores').countDocuments({ attemptId });
    const stored = (await attemptsOf('third', L.abandoned))[0];
    record('api', '12 simultaneous submits: one score row; the browser score is ignored', scoreRows === 1 && submits.every((x) => x.status === 200) && stored.result.percent === 25 && !stored.effectsPending);

    // ---- Student on desktop
    const A = await launchBrowser(9391, 'student');
    browsers.push(A);
    const tab = A.first;
    const signIn = async (t, key) => {
      await t.send('Network.clearBrowserCookies');
      await t.send('Page.navigate', { url: `${origin}/login` });
      await t.waitFor('document.readyState === "complete"', 60000);
      return t.evaluate(`fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-FO-CSRF': '1' }, body: JSON.stringify(${JSON.stringify({ email: accounts[key].email, password: accounts[key].password })}) }).then((r) => r.status)`);
    };
    await tab.send('Page.navigate', { url: `${origin}/instructor/quizzes` });
    record('access', 'signed out: an instructor page sends you to sign in', await tab.waitFor(`location.pathname === '/login'`, 90000));
    record('access', 'the student signs in', (await signIn(tab, 'student')) === 200);
    await tab.send('Page.navigate', { url: `${origin}/instructor/quizzes` });
    record('access', 'a student on an instructor page is sent away', await tab.waitFor(`location.pathname === '/dashboard'`, 90000));

    const openQuiz = async (t, lessonId) => {
      await t.send('Page.navigate', { url: `${origin}/courses/${P}/lessons/${lessonId}` });
      await t.waitFor(`[...document.querySelectorAll('button')].some((b) => /Take Quiz/.test(b.textContent))`, 90000);
      await t.evaluate(clickText('button', '/Take Quiz/'));
    };
    await openQuiz(tab, L.main);
    record('student', 'instructions show questions, points, attempts, pass mark', await tab.waitFor(`(() => { const t = (document.querySelector('[data-testid="quiz-instructions"]') || {}).innerText || ''; return /3 questions/.test(t) && /4 points/.test(t) && /2 of 2 attempts left/.test(t) && /pass mark 60/.test(t); })()`, 30000));
    await tab.evaluate(clickText('[data-testid="quiz-overview"] button', '/Start quiz/'));
    record('student', 'starting opens the attempt', await tab.waitFor(`Boolean(document.querySelector('[data-testid="quiz-attempt"]'))`, 20000));
    const order = (await attemptsOf('student', L.main))[0].questions.map((q) => q.id);
    record('student', 'the attempt on the page has no answer key', !/SECRET-WHY/.test(await tab.evaluate('document.documentElement.innerHTML')));
    const pick = (t, text) => t.evaluate(`(() => { const label = [...document.querySelectorAll('[data-testid="quiz-attempt"] fieldset label')].find((l) => l.innerText.trim() === ${JSON.stringify(text)}); if (!label) return false; label.querySelector('input').click(); return true; })()`);
    const legend = (t) => t.evaluate(`(document.querySelector('[data-testid="quiz-attempt"] legend') || {}).innerText || ''`);
    const goTo = (t, n) => t.evaluate(`document.querySelectorAll('[data-testid="quiz-navigator"] button')[${n}].click(); true`);
    const correctFor = { 'What is a pip?': 'A price step', 'What is the spread?': 'Bid-ask gap', 'What does long mean?': 'Buy' };
    const pickRight = async (t) => { const l = await legend(t); const q = Object.keys(correctFor).find((k) => l.includes(k)); return pick(t, correctFor[q]); };
    record('autosave', 'choosing an answer saves it on the server', (await pickRight(tab)) && await tab.waitFor(`/1 answer saved/.test(document.querySelector('[data-testid="quiz-save-state"]').innerText)`, 10000) && Object.keys((await attemptsOf('student', L.main))[0].answers).length === 1);
    await goTo(tab, 1);
    record('nav', 'the navigator moves between questions and marks the answered one', await tab.waitFor(`/Question 2 of 3/.test(document.querySelector('[data-testid="quiz-attempt"]').innerText) && /, answered/.test(document.querySelectorAll('[data-testid="quiz-navigator"] button')[0].getAttribute('aria-label'))`, 5000));
    await tab.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await pickRight(tab);
    record('autosave', 'offline: the page says the answer is not saved yet', await tab.waitFor(`/not saved yet/.test(document.querySelector('[data-testid="quiz-save-state"]').innerText)`, 10000));
    await tab.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await tab.evaluate(`window.dispatchEvent(new Event('online')); true`);
    record('autosave', 'back online: it is sent and confirmed', await tab.waitFor(`/2 answers saved/.test(document.querySelector('[data-testid="quiz-save-state"]').innerText)`, 15000) && Object.keys((await attemptsOf('student', L.main))[0].answers).length === 2);

    await tab.send('Page.reload');
    await tab.waitFor(`[...document.querySelectorAll('button')].some((b) => /Take Quiz/.test(b.textContent))`, 60000);
    await tab.evaluate(clickText('button', '/Take Quiz/'));
    record('resume', 'a refresh resumes the same attempt with its answers', await tab.waitFor(`/2 answers saved/.test((document.querySelector('[data-testid="quiz-save-state"]') || {}).innerText || '')`, 20000));
    const afterRefresh = await attemptsOf('student', L.main);
    record('resume', 'no second attempt; the order is unchanged', afterRefresh.length === 1 && JSON.stringify(afterRefresh[0].questions.map((q) => q.id)) === JSON.stringify(order));
    await tab.evaluate(clickText('[data-testid="quiz-attempt"] button', '/^Submit quiz$/'));
    record('submit', 'submitting asks first and counts what is unanswered', await tab.waitFor(`/1 question is not answered/.test((document.querySelector('[data-testid="quiz-confirm"]') || {}).innerText || '')`, 5000));
    await tab.evaluate(clickText('[data-testid="quiz-confirm"] button', '/Keep working/'));
    record('submit', 'keep working returns to the attempt, nothing submitted', (await attemptsOf('student', L.main))[0].status === 'in_progress');
    await goTo(tab, 2);
    await pickRight(tab);
    await tab.evaluate(clickText('[data-testid="quiz-attempt"] button', '/^Submit quiz$/'));
    await tab.waitFor(`Boolean(document.querySelector('[data-testid="quiz-confirm"]'))`, 5000);
    await tab.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await tab.evaluate(clickText('[data-testid="quiz-confirm"] button', '/Yes, submit/'));
    record('submit', 'a submit that cannot reach the server says so; no result is shown', await tab.waitFor(`/Not submitted yet/.test((document.querySelector('[data-testid="quiz-error"]') || {}).innerText || '')`, 15000) && !(await tab.evaluate(`Boolean(document.querySelector('[data-testid="quiz-result"]'))`)));
    await tab.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await tab.evaluate(clickText('[data-testid="quiz-confirm"] button', '/Yes, submit/'));
    record('result', 'after a retry the passed result and the review appear', await tab.waitFor(`(() => { const t = (document.querySelector('[data-testid="quiz-result"]') || {}).innerText || ''; return /100%/.test(t) && /Passed/i.test(t) && Boolean(document.querySelector('[data-testid="quiz-review"]')); })()`, 15000));
    const row = await progressOf('student');
    record('result', 'the lesson is complete and there is one score row', row.completedLessons.includes(L.main) && (await db.collection('quizScores').countDocuments({ userId: accounts.student.id, lessonId: L.main })) === 1);
    await tab.evaluate(clickText('[data-testid="quiz-overview"] button', '/Start another attempt/'));
    await tab.waitFor(`Boolean(document.querySelector('[data-testid="quiz-attempt"]'))`, 10000);
    await tab.evaluate(clickText('[data-testid="quiz-attempt"] button', '/^Submit quiz$/'));
    await tab.waitFor(`/3 questions are not answered/.test((document.querySelector('[data-testid="quiz-confirm"]') || {}).innerText || '')`, 5000);
    await tab.evaluate(clickText('[data-testid="quiz-confirm"] button', '/Yes, submit/'));
    record('result', 'the failed attempt shows not passed', await tab.waitFor(`/Not passed/i.test((document.querySelector('[data-testid="quiz-result"]') || {}).innerText || '')`, 15000));
    record('result', 'attempts used up: no start button, the page says so', await tab.waitFor(`Boolean(document.querySelector('[data-testid="quiz-no-attempts"]')) && ![...document.querySelectorAll('[data-testid="quiz-overview"] button')].some((b) => /Start/.test(b.textContent))`, 10000));
    record('result', 'history lists both attempts', await tab.waitFor(`document.querySelectorAll('[data-testid="quiz-history"] li').length === 2`, 5000));

    // Review policy: never
    await openQuiz(tab, L.never);
    await tab.waitFor(`/Correct answers are not shown/.test(document.body.innerText)`, 20000);
    await tab.evaluate(clickText('[data-testid="quiz-overview"] button', '/Start quiz/'));
    await tab.waitFor(`Boolean(document.querySelector('[data-testid="quiz-attempt"]'))`, 10000);
    await pickRight(tab);
    await tab.evaluate(clickText('[data-testid="quiz-attempt"] button', '/^Submit quiz$/'));
    await tab.waitFor(`Boolean(document.querySelector('[data-testid="quiz-confirm"]'))`, 5000);
    await tab.evaluate(clickText('[data-testid="quiz-confirm"] button', '/Yes, submit/'));
    await tab.waitFor(`Boolean(document.querySelector('[data-testid="quiz-result"]'))`, 15000);
    record('review', 'with policy "never" the result has no review and no answers', !(await tab.evaluate(`Boolean(document.querySelector('[data-testid="quiz-review"]'))`)) && !/Correct answer:/.test(await tab.evaluate('document.body.innerText')));

    // Timer: real expiry of a one-minute attempt, on a device whose clock is an hour behind.
    const skew = await tab.send('Page.addScriptToEvaluateOnNewDocument', { source: 'const realNow = Date.now.bind(Date); Date.now = () => realNow() - 3600000;' });
    await openQuiz(tab, L.timed);
    await tab.waitFor(`/1 minute/.test((document.querySelector('[data-testid="quiz-instructions"]') || {}).innerText || '')`, 20000);
    await tab.evaluate(clickText('[data-testid="quiz-overview"] button', '/Start quiz/'));
    await tab.waitFor(`Boolean(document.querySelector('[data-testid="quiz-timer"]'))`, 10000);
    const clock = await tab.evaluate(`document.querySelector('[data-testid="quiz-timer"]').innerText`);
    record('timer', 'with the device clock an hour behind the countdown still shows the true time left', /Time left (0:5\d|1:0\d)$/.test(clock), clock); // An hour's skew would read 61:00 or 0:00.
    await pickRight(tab);
    await tab.waitFor(`/1 answer saved/.test(document.querySelector('[data-testid="quiz-save-state"]').innerText)`, 10000);
    await tab.send('Page.reload');
    await tab.waitFor(`[...document.querySelectorAll('button')].some((b) => /Take Quiz/.test(b.textContent))`, 60000);
    await tab.evaluate(clickText('button', '/Take Quiz/'));
    await tab.waitFor(`Boolean(document.querySelector('[data-testid="quiz-timer"]'))`, 20000);
    const resumedClock = await tab.evaluate(`document.querySelector('[data-testid="quiz-timer"]').innerText`);
    record('timer', 'a refresh keeps the same deadline, it does not restart the clock', /Time left 0:[0-5]\d/.test(resumedClock) && !/Time left 1:00/.test(resumedClock), resumedClock);
    record('timer', 'when time is up the page submits by itself and shows the result', await tab.waitFor(`Boolean(document.querySelector('[data-testid="quiz-result"]'))`, 80000));
    await tab.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: skew.identifier });
    const timedRow = (await attemptsOf('student', L.timed))[0];
    record('timer', 'the server finished it once; the saved answer counts', ['submitted', 'expired'].includes(timedRow.status) && Object.keys(timedRow.answers).length === 1 && (await db.collection('quizScores').countDocuments({ attemptId: String(timedRow._id) })) === 1, timedRow.status);

    // A timed attempt abandoned with no answers: time ran out with the browser closed.
    const started = await json(await call('POST', `/quizzes/${L.timed}/attempts`, { token: T.second }));
    await db.collection('quizAttempts').updateOne({ _id: new ObjectId(started.attempt.id) }, { $set: { deadlineAt: new Date(Date.now() - 60000) } });
    r = await call('GET', `/quizzes/${L.timed}/attempts/${started.attempt.id}`, { token: T.second });
    const expired = await json(r);
    record('timer', 'an abandoned attempt expires on the next request and does not complete the lesson', expired.attempt.status === 'expired' && !(await progressOf('second')).completedLessons.includes(L.timed));

    // An attempt with no answers: no pass mark, and still no completion.
    await openQuiz(tab, L.plain);
    await tab.waitFor(`/counts toward your quiz average/.test((document.querySelector('[data-testid="quiz-leaderboard-note"]') || {}).innerText || '')`, 20000);
    await tab.evaluate(clickText('[data-testid="quiz-overview"] button', '/Start quiz/'));
    await tab.waitFor(`Boolean(document.querySelector('[data-testid="quiz-attempt"]'))`, 10000);
    await tab.evaluate(clickText('[data-testid="quiz-attempt"] button', '/^Submit quiz$/'));
    record('empty', 'submitting nothing warns that the lesson will not complete', await tab.waitFor(`/no answers does not complete this lesson/.test((document.querySelector('[data-testid="quiz-confirm"]') || {}).innerText || '')`, 5000));
    await tab.evaluate(clickText('[data-testid="quiz-confirm"] button', '/Yes, submit/'));
    record('empty', 'the result says why the lesson is not complete', await tab.waitFor(`Boolean(document.querySelector('[data-testid="quiz-no-answers"]'))`, 15000));
    record('empty', 'the server recorded the result and did not complete the lesson', !(await progressOf('student')).completedLessons.includes(L.plain) && (await db.collection('quizScores').countDocuments({ userId: accounts.student.id, lessonId: L.plain })) === 1);
    await tab.evaluate(clickText('[data-testid="quiz-overview"] button', '/Start another attempt/'));
    await tab.waitFor(`Boolean(document.querySelector('[data-testid="quiz-attempt"]'))`, 10000);
    await pick(tab, 'A fruit');
    await tab.waitFor(`/1 answer saved/.test(document.querySelector('[data-testid="quiz-save-state"]').innerText)`, 10000);
    await tab.evaluate(clickText('[data-testid="quiz-attempt"] button', '/^Submit quiz$/'));
    await tab.waitFor(`Boolean(document.querySelector('[data-testid="quiz-confirm"]'))`, 5000);
    await tab.evaluate(clickText('[data-testid="quiz-confirm"] button', '/Yes, submit/'));
    await tab.waitFor(`Boolean(document.querySelector('[data-testid="quiz-result"]')) && !document.querySelector('[data-testid="quiz-no-answers"]')`, 15000);
    record('empty', 'a retake with one wrong answer completes it (no pass mark)', (await progressOf('student')).completedLessons.includes(L.plain));

    // Assignment: submit, late flag
    await tab.send('Page.navigate', { url: `${origin}/courses/${P}/lessons/${L.main}` });
    await tab.waitFor(`Boolean(document.querySelector('[data-testid="lesson-assignments"]'))`, 60000);
    await tab.evaluate(FILL);
    await tab.evaluate(`window.__fill(document.querySelector('[data-testid="assignment-card"] textarea'), 'My trade journal entry'); true`);
    await tab.waitFor(`![...document.querySelectorAll('[data-testid="assignment-card"] button')][0].disabled`, 3000);
    await tab.evaluate(`document.querySelector('[data-testid="assignment-card"] button').click(); true`);
    record('assignment', 'the student submits; past the due date it is accepted and flagged', await tab.waitFor(`/submitted late/.test((document.querySelector('[data-testid="assignment-status"]') || {}).innerText || '')`, 15000));

    await tab.send('Page.navigate', { url: `${origin}/progress` });
    record('history', '/progress lists results across quizzes', await tab.waitFor(`document.querySelectorAll('[data-testid="assessment-history"] li').length >= 3`, 60000));
    record('history', 'and shows correct answers out of questions, not a percentage', !/\(100\/3\)|\(75\/3\)/.test(await tab.evaluate('document.body.innerText')));

    // Leaderboard: the rule is stated, and the number is the average of every finished attempt.
    const own = await db.collection('quizScores').find({ userId: accounts.student.id }).toArray();
    const average = Math.round(own.reduce((sum, row) => sum + row.score, 0) / own.length);
    await tab.send('Page.navigate', { url: `${origin}/leaderboard` });
    await tab.waitFor(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Quizzes')`, 90000);
    await tab.evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Quizzes').click(); true`);
    record('leaderboard', 'the page says every finished attempt counts, retakes and timeouts included', await tab.waitFor(`/every quiz attempt you have finished/.test((document.querySelector('[data-testid="leaderboard-quiz-rule"]') || {}).innerText || '') && /Retakes count/.test(document.querySelector('[data-testid="leaderboard-quiz-rule"]').innerText) && /ran out of time count once they are scored/.test(document.querySelector('[data-testid="leaderboard-quiz-rule"]').innerText) && /still in progress do not count/.test(document.querySelector('[data-testid="leaderboard-quiz-rule"]').innerText)`, 15000));
    record('leaderboard', 'the student row shows that average over all their attempts', own.length >= 5 && await tab.waitFor(`[...document.querySelectorAll('tbody tr')].some((tr) => /Assess student/.test(tr.innerText) && tr.innerText.includes(${JSON.stringify(`${average}%`)}) && new RegExp('\\\\b' + ${own.length} + '\\\\b').test(tr.innerText))`, 15000), `${average}% over ${own.length} attempts`);

    await db.collection('certificates').insertOne({ userId: accounts.phone.id, courseId: String(P), certificateId: 'CERT-ASSESS-1', issuedAt: new Date(), createdAt: new Date() });
    await tab.evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Completions').click(); true`);
    record('leaderboard', 'the Completions tab names the student, not Unknown', await tab.waitFor(`[...document.querySelectorAll('tbody tr')].some((tr) => /Assess phone/.test(tr.innerText)) && ![...document.querySelectorAll('tbody tr')].some((tr) => /Unknown/.test(tr.innerText))`, 15000));

    // ---- Instructor
    const I = await launchBrowser(9392, 'instructor');
    browsers.push(I);
    const staff = I.first;
    record('instructor', 'the instructor signs in', (await signIn(staff, 'instructor')) === 200);
    const openEditor = async (t, courseTitle, lessonIndex) => {
      await t.send('Page.navigate', { url: `${origin}/instructor/quizzes` });
      await t.waitFor(`[...document.querySelectorAll('button')].some((b) => ${JSON.stringify(courseTitle)} === b.innerText.split('\\n')[0].trim() || b.innerText.includes(${JSON.stringify(courseTitle)}))`, 90000);
      await t.evaluate(FILL);
      await t.evaluate(`[...document.querySelectorAll('button')].find((b) => b.innerText.includes(${JSON.stringify(courseTitle)})).click(); true`);
      await t.waitFor(`[...document.querySelectorAll('button')].filter((b) => /Edit Quiz|Editing/.test(b.textContent)).length > ${lessonIndex}`, 30000);
      await t.evaluate(`[...document.querySelectorAll('button')].filter((b) => /Edit Quiz|Editing/.test(b.textContent))[${lessonIndex}].click(); true`);
      return t.waitFor(`Boolean(document.querySelector('[data-testid="quiz-settings"]'))`, 20000);
    };
    record('instructor', 'the quiz editor opens on a draft course', await openEditor(staff, 'Acceptance Draft Course', 0));
    await staff.evaluate(clickText('button', '/\\+ Add Question/'));
    await staff.waitFor(`Boolean(document.querySelector('input[placeholder="Question text"]'))`, 5000);
    await staff.evaluate(`window.__fill(document.querySelector('input[placeholder="Question text"]'), 'Authored question'); window.__fill(document.querySelector('input[placeholder="Option 1"]'), 'Right'); true`);
    await sleep(200);
    await staff.evaluate(`window.__fill(document.querySelector('input[placeholder="Option 2"]'), 'Wrong'); true`);
    await sleep(200);
    await staff.evaluate(clickText('button[type="submit"]', '/Save Quiz/'));
    record('instructor', 'blank options are refused by the server, with the reason', await staff.waitFor(`window.__alerts.some((m) => /empty or too long option/.test(m))`, 15000));
    await staff.evaluate(`window.__fill(document.querySelector('input[placeholder="Option 3"]'), 'Maybe'); true`);
    await sleep(200);
    await staff.evaluate(`window.__fill(document.querySelector('input[placeholder="Option 4"]'), 'Never'); true`);
    await sleep(200);
    await staff.evaluate(`window.__fill(document.querySelector('[data-testid="quiz-settings"] select'), 'draft'); true`);
    await sleep(200);
    const settingNumber = (label, value) => `(() => { const l = [...document.querySelectorAll('[data-testid="quiz-settings"] label')].find((x) => x.textContent.startsWith(${JSON.stringify(label)})); window.__fill(l.querySelector('input'), ${JSON.stringify(value)}); return true; })()`;
    await staff.evaluate(settingNumber('Attempts allowed', '3'));
    await sleep(200);
    await staff.evaluate(settingNumber('Time limit', '15'));
    await sleep(200);
    await staff.evaluate(settingNumber('Pass mark', '70'));
    await sleep(200);
    await staff.evaluate(clickText('button[type="submit"]', '/Save Quiz/'));
    await staff.waitFor(`window.__alerts.some((m) => /saved successfully/.test(m))`, 15000);
    let authored = await db.collection('quizzes').findOne({ lessonId: L.authored });
    record('instructor', 'the quiz is stored as a draft with its settings and a question id', authored && authored.settings.status === 'draft' && authored.settings.maxAttempts === 3 && authored.settings.timeLimitMinutes === 15 && authored.settings.passingPercent === 70 && /^[a-f0-9]{12}$/.test(authored.questions[0].id));
    const firstId = authored.questions[0].id;
    await openEditor(staff, 'Acceptance Draft Course', 0);
    await staff.waitFor(`document.querySelector('input[placeholder="Question text"]') && document.querySelector('input[placeholder="Question text"]').value === 'Authored question'`, 15000);
    await staff.evaluate(`window.__fill(document.querySelector('[data-testid="quiz-settings"] select'), 'published'); true`);
    await sleep(200);
    await staff.evaluate(clickText('button[type="submit"]', '/Save Quiz/'));
    await staff.waitFor(`window.__alerts.some((m) => /saved successfully/.test(m))`, 15000);
    authored = await db.collection('quizzes').findOne({ lessonId: L.authored });
    record('instructor', 'publishing keeps the settings and the question id, and adds a version', authored.settings.status === 'published' && authored.settings.maxAttempts === 3 && authored.questions[0].id === firstId && authored.version === 2);

    // Results: more than one page, review of an attempt
    const extra = Array.from({ length: 45 }, (_, i) => ({ _id: new ObjectId(), userId: accounts.second.id, lessonId: L.main, courseId: String(P), number: 100 + i, status: 'submitted', submittedAt: new Date(Date.now() - (i + 1) * 3600000), questions: [], answers: {}, result: { percent: 50, passed: false, perQuestion: [] }, startedAt: now, createdAt: now }));
    await db.collection('quizAttempts').insertMany(extra);
    record('results', 'results load in the editor', await openEditor(staff, 'Acceptance Assessments', 0) && await staff.waitFor(`/47 finished attempts/.test((document.querySelector('[data-testid="quiz-results-summary"]') || {}).innerText || '')`, 20000));
    record('results', 'one page at a time', await staff.waitFor(`/Page 1 of 3/.test((document.querySelector('[data-testid="quiz-results-pager"]') || {}).innerText || '')`, 5000) && (await staff.evaluate(`document.querySelectorAll('[data-testid="quiz-results"] tbody tr').length`)) === 20);
    await staff.evaluate(clickText('[data-testid="quiz-results-pager"] button', '/Older/'));
    record('results', 'the next page loads', await staff.waitFor(`/Page 2 of 3/.test(document.querySelector('[data-testid="quiz-results-pager"]').innerText)`, 10000));
    await staff.evaluate(clickText('[data-testid="quiz-results-pager"] button', '/Newer/'));
    await staff.waitFor(`/Page 1 of 3/.test(document.querySelector('[data-testid="quiz-results-pager"]').innerText)`, 10000);
    await staff.evaluate(`[...document.querySelectorAll('[data-testid="quiz-results"] tbody tr')].find((tr) => /Assess student/.test(tr.innerText)).querySelector('button').click(); true`);
    record('results', 'an attempt opens for review with answers and the key', await staff.waitFor(`/Answer:/.test((document.querySelector('[data-testid="quiz-attempt-review"]') || {}).innerText || '')`, 10000));
    await staff.evaluate(clickText('button[type="submit"]', '/Save Quiz/'));
    record('instructor', 'on a published course the instructor is told it cannot be edited (Phase 4 rule)', await staff.waitFor(`window.__alerts.length > 0`, 15000));

    // Manual grading
    record('grading', 'the lesson\'s assignments and the grading link are in the editor', await staff.waitFor(`[...document.querySelectorAll('[data-testid="lesson-assignments-admin"] a')].some((a) => a.getAttribute('href').includes(${JSON.stringify(assignment)}))`, 10000));
    await staff.send('Page.navigate', { url: `${origin}/instructor/assignments/analytics/${assignment}` });
    await staff.waitFor(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Grade')`, 90000);
    await staff.evaluate(FILL);
    await staff.evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Grade').click(); true`);
    record('grading', 'the work and the late flag are shown to the grader', await staff.waitFor(`/My trade journal entry/.test((document.querySelector('[data-testid="grade-form"]') || {}).innerText || '') && /after the due date/.test(document.querySelector('[data-testid="grade-form"]').innerText)`, 10000));
    await staff.evaluate(`const f = document.querySelector('[data-testid="grade-form"]'); window.__fill(f.querySelector('input[type="number"]'), '75'); window.__fill(f.querySelector('textarea'), 'Well reasoned'); true`);
    await sleep(300);
    await staff.evaluate(clickText('[data-testid="grade-form"] button', '/Save grade/'));
    await staff.waitFor(`/75%/.test(document.body.innerText)`, 15000);
    const graded = await db.collection('assignmentSubmissions').findOne({ userId: accounts.student.id });
    const studentRow = await db.collection('users').findOne({ _id: new ObjectId(accounts.student.id) });
    record('grading', 'the grade, history and exact points are stored', graded.grade === 75 && graded.gradeHistory.length === 1 && graded.gradedBy === accounts.instructor.id && studentRow.points === 40 + 30 && !graded.pointsPending, `points ${studentRow.points}`);
    record('grading', 'the student is notified', (await db.collection('notifications').countDocuments({ userId: accounts.student.id, type: 'task_feedback' })) === 1);
    await tab.send('Page.navigate', { url: `${origin}/courses/${P}/lessons/${L.main}` });
    record('grading', 'the student sees the grade and feedback', await tab.waitFor(`/Graded: 75%/.test((document.querySelector('[data-testid="assignment-status"]') || {}).innerText || '') && /Well reasoned/.test(document.querySelector('[data-testid="assignment-feedback"]').innerText)`, 60000));
    await tab.evaluate(FILL);
    await tab.evaluate(`window.__fill(document.querySelector('[data-testid="assignment-card"] textarea'), 'Rewritten entry'); true`);
    await sleep(300);
    await tab.evaluate(`document.querySelector('[data-testid="assignment-card"] button').click(); true`);
    await tab.waitFor(`/waiting for grading/.test((document.querySelector('[data-testid="assignment-status"]') || {}).innerText || '')`, 15000);
    const resubmitted = await db.collection('assignmentSubmissions').findOne({ userId: accounts.student.id });
    record('grading', 'a resubmission keeps the old grade on record and pays nothing new', resubmitted.grade === null && resubmitted.previousVersions[0].grade === 75 && resubmitted.gradeHistory.length === 1 && (await db.collection('users').findOne({ _id: new ObjectId(accounts.student.id) })).points === 70);

    // ---- Rival instructor, in a browser
    const X = await launchBrowser(9393, 'rival');
    browsers.push(X);
    const rival = X.first;
    await signIn(rival, 'rival');
    await rival.send('Page.navigate', { url: `${origin}/instructor/assignments/analytics/${assignment}` });
    record('access', 'another instructor gets no submissions on the grading page', await rival.waitFor(`document.readyState === 'complete' && !/Rewritten entry|Trade journal/.test(document.body.innerText) && /not authorized|failed|error|unable/i.test(document.body.innerText)`, 60000));

    // ---- Phone, 390 px
    const B = await launchBrowser(9394, 'phone');
    browsers.push(B);
    const phone = B.first;
    await phone.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
    record('mobile', 'the phone signs in', (await signIn(phone, 'phone')) === 200);
    const overflow = (t) => t.evaluate(`({ sw: document.documentElement.scrollWidth, w: window.innerWidth, wide: [...document.querySelectorAll('main *')].filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1 && !e.closest('.overflow-x-auto, .overflow-auto')).slice(0, 3).map((e) => e.tagName + '.' + String(e.className).slice(0, 40)) })`);
    // innerWidth must still be 390: a mobile viewport grows to fit content that is too wide.
    const fits = (o) => o && o.w === 390 && o.sw <= o.w && o.wide.length === 0;
    await openQuiz(phone, L.main);
    await phone.waitFor(`Boolean(document.querySelector('[data-testid="quiz-instructions"]'))`, 30000);
    let o = await overflow(phone);
    record('mobile', 'quiz instructions fit 390 px', fits(o), JSON.stringify(o));
    await phone.evaluate(clickText('[data-testid="quiz-overview"] button', '/Start quiz/'));
    await phone.waitFor(`Boolean(document.querySelector('[data-testid="quiz-attempt"]'))`, 15000);
    o = await overflow(phone);
    record('mobile', 'an attempt fits 390 px', fits(o), JSON.stringify(o));
    const touch = await phone.evaluate(`[...document.querySelectorAll('[data-testid="quiz-attempt"] button, [data-testid="quiz-attempt"] fieldset label')].map((e) => Math.round(e.getBoundingClientRect().height))`);
    record('mobile', 'controls are at least 44 px tall', touch.length > 0 && touch.every((h) => h >= 44), `min ${Math.min(...touch)}`);
    for (let i = 0; i < 3; i += 1) { await goTo(phone, i); await sleep(150); await pickRight(phone); await sleep(300); }
    await phone.evaluate(clickText('[data-testid="quiz-attempt"] button', '/^Submit quiz$/'));
    await phone.waitFor(`Boolean(document.querySelector('[data-testid="quiz-confirm"]'))`, 5000);
    o = await overflow(phone);
    record('mobile', 'the confirmation fits 390 px', fits(o), JSON.stringify(o));
    await phone.evaluate(clickText('[data-testid="quiz-confirm"] button', '/Yes, submit/'));
    await phone.waitFor(`Boolean(document.querySelector('[data-testid="quiz-review"]'))`, 15000);
    o = await overflow(phone);
    record('mobile', 'the result and review fit 390 px', fits(o), JSON.stringify(o));
    await phone.send('Page.navigate', { url: `${origin}/leaderboard` });
    await phone.waitFor(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Quizzes')`, 60000);
    await phone.evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Quizzes').click(); true`);
    await phone.waitFor(`Boolean(document.querySelector('[data-testid="leaderboard-quiz-rule"]'))`, 15000);
    o = await overflow(phone);
    record('mobile', 'the leaderboard with its rule fits 390 px', fits(o), JSON.stringify(o));
    await phone.send('Page.navigate', { url: `${origin}/progress` });
    await phone.waitFor(`Boolean(document.querySelector('[data-testid="assessment-history"]'))`, 60000);
    o = await overflow(phone);
    record('mobile', '/progress with quiz results fits 390 px', fits(o), JSON.stringify(o));
    await staff.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
    await openEditor(staff, 'Acceptance Assessments', 0);
    await staff.waitFor(`Boolean(document.querySelector('[data-testid="quiz-results-summary"]'))`, 20000);
    o = await overflow(staff);
    record('mobile', 'the instructor editor with results fits 390 px', fits(o), JSON.stringify(o));
    await staff.send('Page.navigate', { url: `${origin}/instructor/assignments/analytics/${assignment}` });
    await staff.waitFor(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Grade')`, 60000);
    await staff.evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Grade').click(); true`);
    await staff.waitFor(`Boolean(document.querySelector('[data-testid="grade-form"]'))`, 5000);
    o = await overflow(staff);
    record('mobile', 'the grading page fits 390 px', fits(o), JSON.stringify(o));
  } catch (error) {
    record('setup', 'run completed', false, String(error && error.stack || error).replace(/mongodb(\+srv)?:\/\/\S+/g, '<uri>').slice(0, 400));
  } finally {
    for (const b of browsers) await b.quit();
    server.kill();
  }
  const log = fs.readFileSync(logFile, 'utf8');
  record('leakage', 'no fixture email in the server log', Object.values(accounts).every((a) => !log.includes(a.email)));
  record('leakage', 'no answer key text in the server log', !/SECRET-WHY/.test(log));
  await client.close().catch(() => {});
  console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed. Server log: ${logFile}`);
  process.exit(results.every(Boolean) ? 0 : 1);
})();
