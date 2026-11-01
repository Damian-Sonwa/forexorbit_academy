/**
 * Phase 7 learning experience against the real application (node server.js), real MongoDB and
 * headless Microsoft Edge, on a desktop and a phone viewport. Same safety rules as
 * scripts/acceptance/run.js (guard.js): local or opted-in test server, a database ending in
 * "_acceptance", synthetic accounts only. Uses its own database,
 * <ACCEPTANCE_DB_NAME without "_acceptance">_learning_acceptance, marked as the harness's.
 *
 *   node scripts/acceptance/learning-e2e.js
 *
 * The server runs WITHOUT a Paystack key, so no request can reach Paystack; the paying student's
 * entitlement is seeded. Lesson media (a short WebM made with Playwright's ffmpeg from a frame
 * Edge renders, and a small PDF) are served by a local file server on another port, like an
 * external media host.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..', '..');
const { checkAcceptanceConfig, checkDisposable, MARKER, MARKER_COLLECTION } = require('./guard');

const results = [];
function record(area, check, ok, detail = '') {
  results.push(Boolean(ok));
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
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const FFMPEG = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright', 'ffmpeg-1011', 'ffmpeg-win64.exe');

/** A local "media host": Range requests (video seeking) and a PDF. */
function startMediaServer(port, files) {
  const server = http.createServer((req, res) => {
    const file = files[req.url.split('?')[0]];
    if (!file) { res.writeHead(404); res.end(); return; }
    const size = file.body.length;
    const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
    const headers = { 'Content-Type': file.type, 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*' };
    if (range) {
      const start = range[1] ? Number(range[1]) : 0;
      const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
      res.end(file.body.subarray(start, end + 1));
      return;
    }
    res.writeHead(200, { ...headers, 'Content-Length': size });
    res.end(file.body);
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

const TINY_PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/MediaBox[0 0 200 200]/Parent 2 0 R>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');

(async () => {
  const envFile = path.join(ROOT, '.env.acceptance');
  const fileEnv = fs.existsSync(envFile) ? require('dotenv').parse(fs.readFileSync(envFile)) : {};
  const merged = { ...process.env, ...fileEnv };
  const base = checkAcceptanceConfig(merged);
  if (!base.ok) { console.error(`Refused: ${base.reason}`); process.exit(2); }
  const dbName = `${base.dbName.replace(/_(acceptance|test)$/, '')}_learning_acceptance`;
  const config = checkAcceptanceConfig({ ...merged, ACCEPTANCE_DB_NAME: dbName });
  if (!config.ok) { console.error(`Refused: ${config.reason}`); process.exit(2); }
  console.log(`Database: ${dbName} (${config.hosts}). The URI is not printed.`);
  if (!fs.existsSync(EDGE)) { console.error('Microsoft Edge not found'); process.exit(2); }

  const { MongoClient, ObjectId } = require('mongodb');
  const bcrypt = require('bcryptjs');
  const WebSocket = require('ws');
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

  // ---- Browser first: it renders the frame the test video is made from.
  const debugPort = 9371;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fo-learning-edge-'));
  const browser = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--autoplay-policy=no-user-gesture-required', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  let targets = [];
  for (let i = 0; i < 60 && !targets.length; i += 1) {
    try { targets = (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).filter((t) => t.type === 'page'); } catch { await sleep(500); }
  }
  const ws = new WebSocket(targets[0].webSocketDebuggerUrl, { perMessageDeflate: false });
  await new Promise((resolve) => ws.once('open', resolve));
  let seq = 0;
  const pending = new Map();
  const listeners = new Map();
  ws.on('message', (m) => {
    const msg = JSON.parse(m);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result || { error: msg.error }); pending.delete(msg.id); return; }
    for (const fn of listeners.get(msg.method) || []) fn(msg.params);
  });
  const on = (method, fn) => listeners.set(method, [...(listeners.get(method) || []), fn]);
  // Every DevTools call answers within 30 s, so a stuck page fails a check instead of hanging the run.
  const send = (method, params = {}) => new Promise((resolve) => {
    seq += 1;
    const id = seq;
    const timer = setTimeout(() => { pending.delete(id); resolve({ error: { message: `${method} timed out` } }); }, 30000);
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

  // 20 s VP8 WebM from one JPEG frame (10 fps), so seeking and resume can be checked.
  await send('Page.navigate', { url: 'data:text/html,<body style="margin:0;background:%23123">' });
  await sleep(800);
  await send('Emulation.setDeviceMetricsOverride', { width: 320, height: 180, deviceScaleFactor: 1, mobile: false });
  const frame = Buffer.from((await send('Page.captureScreenshot', { format: 'jpeg', quality: 60 })).data, 'base64');
  await send('Emulation.clearDeviceMetricsOverride');
  const videoFile = path.join(os.tmpdir(), `fo-learning-${Date.now()}.webm`);
  // This ffmpeg build has no pipe: protocol; the frames go through a file.
  const framesFile = path.join(os.tmpdir(), `fo-learning-${Date.now()}.mjpeg`);
  fs.writeFileSync(framesFile, Buffer.concat(Array.from({ length: 200 }, () => frame)));
  const encoded = spawnSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', '10', '-i', framesFile, '-c:v', 'libvpx', '-b:v', '100k', '-auto-alt-ref', '0', videoFile]);
  const video = fs.existsSync(videoFile) ? fs.readFileSync(videoFile) : null;
  record('setup', 'test video (20 s WebM) encoded', Boolean(video && video.length > 1000), encoded.stderr ? String(encoded.stderr).slice(0, 120) : '');
  const mediaPort = 3352;
  const media = await startMediaServer(mediaPort, {
    '/lesson.webm': { type: 'video/webm', body: video || Buffer.alloc(0) },
    '/notes.pdf': { type: 'application/pdf', body: TINY_PDF },
  });
  const MEDIA = `http://127.0.0.1:${mediaPort}`;

  // ---- Fixtures
  const accounts = {};
  for (const key of ['payer', 'student', 'stranger']) {
    const password = `Acc-${crypto.randomBytes(12).toString('base64url')}-9a!`;
    const email = `${key}@learning.acceptance.invalid`;
    const { insertedId } = await db.collection('users').insertOne({ name: `Learning ${key}`, email, password: await bcrypt.hash(password, 10), role: 'student', status: 'approved', learningLevel: 'beginner', onboardingCompleted: true, createdAt: new Date(), updatedAt: new Date() });
    accounts[key] = { id: String(insertedId), email, password };
  }
  const now = new Date();
  const P = new ObjectId();
  const Q = new ObjectId();
  await db.collection('courses').insertMany([
    { _id: P, title: 'Acceptance Price Action', status: 'published', difficulty: 'beginner', category: 'forex', freePreviewExplicit: true, createdAt: now },
    { _id: Q, title: 'Acceptance Other Course', status: 'published', difficulty: 'beginner', category: 'forex', freePreviewExplicit: true, createdAt: now },
  ]);
  const lesson = async (courseId, order, title, flags = {}) => String((await db.collection('lessons').insertOne({ courseId: String(courseId), order, title, type: 'text', content: `<p>${title} body SECRET-${title.replace(/\W/g, '')}</p>`, createdAt: now, ...flags })).insertedId);
  const L = {
    intro: await lesson(P, 1, 'Intro lesson'),
    preview: await lesson(P, 2, 'Preview lesson', { isFreePreview: true, type: 'video', videoUrl: `${MEDIA}/lesson.webm`, pdfUrl: `${MEDIA}/notes.pdf`, resources: [{ type: 'pdf', title: 'Cheat sheet', url: `${MEDIA}/notes.pdf` }] }),
    paid: await lesson(P, 3, 'Paid lesson', { type: 'video', videoUrl: `${MEDIA}/lesson.webm`, pdfUrl: `${MEDIA}/notes.pdf` }),
    demo: await lesson(P, 4, 'Demo lesson', { isDemo: true }),
    other: await lesson(Q, 1, 'Other lesson', { isFreePreview: true }),
  };
  await db.collection('progress').insertMany([
    { userId: accounts.payer.id, courseId: String(P), progress: 0, completedLessons: [], active: true, createdAt: now },
    { userId: accounts.student.id, courseId: String(P), progress: 0, completedLessons: [], active: true, createdAt: now },
  ]);
  await db.collection('userCourseAccess').insertOne({ userId: accounts.payer.id, courseId: String(P), paid: true, entitlementType: 'paid_course', paystackReference: 'fo_c_learn_1_abcdef12', unlockedAt: now, createdAt: now });
  const completedOf = async (key) => ((await db.collection('progress').findOne({ userId: accounts[key].id, courseId: String(P) })) || {}).completedLessons || [];

  const port = 3341;
  const origin = `http://localhost:${port}`;
  const logFile = path.join(os.tmpdir(), `fo-learning-e2e-${Date.now()}.log`);
  const env = {
    PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP,
    APPDATA: process.env.APPDATA, LOCALAPPDATA: process.env.LOCALAPPDATA, USERPROFILE: process.env.USERPROFILE,
    NODE_ENV: 'development', PORT: String(port), MONGO_URI: config.uri, MONGODB_DB_NAME: dbName,
    JWT_SECRET: crypto.randomBytes(48).toString('hex'), NEXT_TELEMETRY_DISABLED: '1', NEXT_PUBLIC_ADS_ENABLED: 'false',
    PAYMENT_RECONCILE_INTERVAL_MINUTES: '0',
  };
  const out = fs.openSync(logFile, 'w');
  const server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: ['ignore', out, out] });
  try {
    for (let i = 0; ; i += 1) {
      if (i > 240) throw new Error(`server did not start; see ${logFile}`);
      if (/Server is ready/.test(fs.readFileSync(logFile, 'utf8'))) {
        try { if ((await fetch(`${origin}/api/courses`)).status < 500) break; } catch { /* not yet */ }
      }
      await sleep(1000);
    }
    const sessionOf = (res) => { let v = null; for (const c of res.headers.getSetCookie()) { const m = /^__Host-fo_session=([^;]*)/.exec(c); if (m) v = m[1] || null; } return v; };
    const call = (method, url, { token, body, redirect } = {}) => fetch(`${origin}/api${url}`, { method, redirect: redirect || 'follow', headers: { Origin: origin, 'X-FO-CSRF': '1', ...(token ? { Cookie: `__Host-fo_session=${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const text = async (res) => { try { return await res.text(); } catch { return ''; } };
    const T = {};
    for (const key of Object.keys(accounts)) T[key] = sessionOf(await call('POST', '/auth/login', { body: { email: accounts[key].email, password: accounts[key].password } }));
    record('setup', 'all accounts signed in', Object.values(T).every(Boolean));

    // ---- API: access, documents, caching (scenarios 1-5, 12, 13, 15)
    let r = await call('GET', `/lessons/${L.paid}`, { token: T.payer });
    let body = await text(r);
    record('api', '1. entitled student opens the paid lesson with its content', r.status === 200 && body.includes('SECRET-Paidlesson'));
    record('api', '15. lesson response is private and not stored', /no-store/.test(r.headers.get('cache-control') || '') && /private/.test(r.headers.get('cache-control') || ''), r.headers.get('cache-control'));
    record('api', '12. student lesson JSON has the gated PDF path, not the media host URL', body.includes(`/api/lessons/${L.paid}/document?item=pdf`) && !body.includes(`${MEDIA}/notes.pdf`));
    r = await call('GET', `/lessons/${L.paid}`, { token: T.student });
    body = await text(r);
    record('api', '3/locked. enrolled student without payment: paid lesson locked, no content', r.status === 403 && !body.includes('SECRET-') && !body.includes(MEDIA));
    r = await call('GET', `/lessons/${L.preview}`, { token: T.student });
    record('api', '3. enrolled student opens the explicit free preview (position 2)', r.status === 200 && (await text(r)).includes('SECRET-Previewlesson'));
    r = await call('GET', `/lessons/${L.preview}`, { token: T.stranger });
    body = await text(r);
    record('api', '2. unenrolled student refused even the preview, no content', r.status === 403 && !body.includes('SECRET-'));
    r = await call('GET', `/lessons/${L.other}`, { token: T.payer });
    record('api', '5. a guessed lesson of another course is refused', r.status === 403);
    r = await call('GET', `/lessons/${new ObjectId()}`, { token: T.payer });
    record('api', '5. an unknown lesson id is not found', r.status === 404);
    r = await call('GET', `/lessons/${L.paid}/document?item=pdf`, { token: T.payer, redirect: 'manual' });
    record('api', '12. entitled document request redirects to the stored document, uncached, no referrer', r.status === 302 && r.headers.get('location') === `${MEDIA}/notes.pdf` && /no-store/.test(r.headers.get('cache-control') || '') && r.headers.get('referrer-policy') === 'no-referrer', `${r.status} ${r.headers.get('location')}`);
    for (const [label, token] of [['enrolled, not paid', T.student], ['not enrolled', T.stranger], ['signed out', null]]) {
      r = await call('GET', `/lessons/${L.paid}/document?item=pdf`, { token, redirect: 'manual' });
      record('api', `13. document refused (${label}), no redirect`, (r.status === 403 || r.status === 401) && !r.headers.get('location'), String(r.status));
    }
    r = await call('GET', `/lessons/${L.paid}/document?item=r7`, { token: T.payer, redirect: 'manual' });
    record('api', '13. a document that does not exist is not found', r.status === 404);
    r = await call('GET', `/courses/${P}/lessons?view=outline`, { token: T.payer });
    body = await text(r);
    record('api', '9. the outline carries no lesson body or media URL', r.status === 200 && !body.includes('SECRET-') && !body.includes(MEDIA) && /private/.test(r.headers.get('cache-control') || ''));
    r = await fetch(`${origin}/api/courses`);
    body = await text(r);
    record('api', '15. public course list: no lesson content or media', r.status === 200 && !body.includes('SECRET-') && !body.includes(MEDIA));
    r = await fetch(`${origin}/api/lessons/${L.preview}.json`);
    record('api', '15. an /api path with a file extension still gets no-store', /no-store/.test(r.headers.get('cache-control') || ''), r.headers.get('cache-control'));

    // ---- Socket completion gate (Phase 7 audit fix)
    const { io } = require('socket.io-client');
    const sock = io(origin, { path: '/api/socket', transports: ['websocket'], extraHeaders: { Cookie: `__Host-fo_session=${T.student}`, Origin: origin }, reconnection: false });
    const connected = await new Promise((resolve) => { sock.once('connect', () => resolve(true)); sock.once('connect_error', () => resolve(false)); setTimeout(() => resolve(false), 10000); });
    record('socket', 'student socket connects with the session cookie', connected);
    if (connected) {
      sock.emit('progressUpdate', { courseId: String(P), lessonId: L.paid });
      await sleep(2500);
      record('socket', 'progressUpdate on a locked lesson records nothing', !(await completedOf('student')).includes(L.paid));
      sock.emit('progressUpdate', { courseId: String(P), lessonId: L.demo });
      await sleep(2500);
      record('socket', 'progressUpdate on an open lesson still records (gate is specific)', (await completedOf('student')).includes(L.demo));
    }
    sock.close();

    // ---- Browser
    const requests = [];
    on('Network.requestWillBeSent', (p) => requests.push({ url: p.request.url, method: p.request.method }));
    await send('Network.enable');
    await send('Page.enable');
    const signInAs = async (key) => {
      await send('Network.clearBrowserCookies');
      await send('Page.navigate', { url: `${origin}/login` });
      await waitFor('document.readyState === "complete"');
      return evaluate(`fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-FO-CSRF': '1' }, body: JSON.stringify(${JSON.stringify({ email: accounts[key].email, password: accounts[key].password })}) }).then((r) => r.status)`);
    };
    const page = () => evaluate('({ text: document.body.innerText, path: location.pathname, sw: document.documentElement.scrollWidth, w: innerWidth, html: document.documentElement.outerHTML })');
    const titleIs = (title) => `(document.querySelector('main h1') || {}).innerText === ${JSON.stringify(title)}`;
    const clickTestId = (id) => evaluate(`(() => { const el = document.querySelector('[data-testid="${id}"]'); if (!el) return false; el.click(); return true; })()`);
    const apiCalls = (since, pattern) => requests.slice(since).filter((q) => q.url.includes('/api/') && pattern.test(q.url));

    record('ui', 'paying student signs in from the page', (await signInAs('payer')) === 200);
    for (const [label, width, mobile] of [['desktop', 1366, false], ['phone', 390, true]]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 860, deviceScaleFactor: mobile ? 3 : 1, mobile });
      await send('Page.navigate', { url: `${origin}/courses/${P}/lessons/${L.preview}` });
      const loaded = await waitFor(titleIs('Preview lesson'), 60000);
      let p = await page();
      record('ui', `${label}: lesson loads with its position in the course`, loaded && /Lesson 2 of 4/i.test(p.text));
      record('ui', `${label}: no horizontal overflow on the lesson page`, p.sw <= p.w + 1, `${p.sw}/${p.w}`);
      const outlineVisible = await evaluate(`(() => { const list = document.getElementById('lesson-outline-list'); return Boolean(list) && getComputedStyle(list).display !== 'none'; })()`);
      if (mobile) {
        record('ui', 'phone: the outline starts collapsed', outlineVisible === false);
        await evaluate(`document.querySelector('[aria-controls="lesson-outline-list"]').click()`);
        record('ui', 'phone: the outline opens from its toggle', await waitFor(`getComputedStyle(document.getElementById('lesson-outline-list')).display !== 'none'`, 3000));
      } else {
        record('ui', 'desktop: the course outline is shown beside the lesson', outlineVisible === true);
      }
      record('ui', `${label}: documents are listed with gated links only`, await evaluate(`(() => { const links = [...document.querySelectorAll('[data-testid="lesson-documents"] a')]; return links.length === 2 && links.every((a) => a.getAttribute('href').startsWith('/api/lessons/') && a.target === '_blank'); })()`) && !p.html.includes(`${MEDIA}/notes.pdf`));

      // Next / previous and browser back/forward (scenarios 8, 9, 14).
      let mark = requests.length;
      await clickTestId('lesson-next');
      const atNext = await waitFor(titleIs('Paid lesson'));
      p = await page();
      record('ui', `${label}: Next opens lesson 3 under the same course`, atNext && p.path === `/courses/${P}/lessons/${L.paid}`);
      await sleep(500);
      const navCalls = apiCalls(mark, /\/api\/(lessons|courses)\//);
      record('ui', `${label}: navigating fetched only the next lesson (no outline or list refetch)`, navCalls.length >= 1 && navCalls.every((q) => q.url.includes(`/api/lessons/${L.paid}`)), navCalls.map((q) => q.url.replace(origin, '')).join(', '));
      mark = requests.length;
      await clickTestId('lesson-prev');
      record('ui', `${label}: Previous returns to lesson 2`, await waitFor(titleIs('Preview lesson')));
      await evaluate('history.back()');
      record('ui', `${label}: browser Back shows lesson 3 again`, await waitFor(`${titleIs('Paid lesson')} && location.pathname.endsWith(${JSON.stringify(L.paid)})`));
      await evaluate('history.forward()');
      record('ui', `${label}: browser Forward shows lesson 2 again`, await waitFor(`${titleIs('Preview lesson')} && location.pathname.endsWith(${JSON.stringify(L.preview)})`));
      p = await page();
      record('ui', `${label}: no stale lesson body after back/forward`, !p.text.includes('SECRET-Paidlesson') && p.text.includes('SECRET-Previewlesson'));
    }
    await send('Emulation.clearDeviceMetricsOverride');

    // Video: resume position, and playback never completes the lesson (scenarios 10, 11).
    await send('Page.navigate', { url: `${origin}/courses/${P}/lessons/${L.paid}` });
    const hasVideo = await waitFor(`Boolean(document.querySelector('[data-testid="lesson-video"] video')) && document.querySelector('[data-testid="lesson-video"] video').readyState >= 1`, 60000);
    record('video', 'the lesson video loads in the player', hasVideo);
    const key = `fo-playback:v1:${accounts.payer.id}:${L.paid}`;
    if (hasVideo) {
      await evaluate(`(async () => { const v = document.querySelector('[data-testid="lesson-video"] video'); v.muted = true; await v.play(); return true; })()`);
      await sleep(7500);
      await evaluate(`document.querySelector('[data-testid="lesson-video"] video').pause()`);
      await sleep(500);
      const saved = await evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(key)}) || 'null')`);
      record('video', 'the playback position is saved while watching', saved && saved.t >= 5, JSON.stringify(saved));
      record('video', 'watching recorded no completion', !(await completedOf('payer')).includes(L.paid));
      await send('Page.reload');
      await waitFor(`Boolean(document.querySelector('[data-testid="video-resumed"]'))`, 60000);
      const resumedAt = await evaluate(`document.querySelector('[data-testid="lesson-video"] video') ? document.querySelector('[data-testid="lesson-video"] video').currentTime : -1`);
      record('video', '10. after a reload the video resumes at the saved position', saved && Math.abs(resumedAt - saved.t) < 2 && /Resumed at/.test(await evaluate('document.body.innerText')), `${resumedAt} vs ${saved && saved.t}`);
      const mark = requests.length;
      await evaluate(`(async () => { const v = document.querySelector('[data-testid="lesson-video"] video'); v.muted = true; v.currentTime = v.duration - 1; await v.play(); return true; })()`);
      const ended = await waitFor(`/The video has ended/.test(document.body.innerText)`, 15000);
      await sleep(1500);
      record('video', '11. the video reaching its end prompts the student but does not complete the lesson', ended && !(await completedOf('payer')).includes(L.paid) && apiCalls(mark, /\/api\/progress/).length === 0);
      record('video', 'a finished video clears its resume position', (await evaluate(`localStorage.getItem(${JSON.stringify(key)})`)) === null);
    }

    // Completion: explicit, one request on a double click, outline updated (D).
    let mark = requests.length;
    await evaluate(`(() => { const b = [...document.querySelectorAll('[data-testid="lesson-completion"] button')].find((x) => /Mark lesson complete/.test(x.textContent)); if (!b) return false; b.click(); b.click(); return true; })()`);
    const done = await waitFor(`/Lesson completed/.test(document.querySelector('[data-testid="lesson-completion"]').innerText)`);
    const posts = apiCalls(mark, /\/api\/progress/).filter((q) => q.method === 'POST');
    record('complete', 'Mark lesson complete: one request for a double click, completion shown', done && posts.length === 1, `${posts.length} POST`);
    record('complete', 'the completion is recorded once in the database', (await completedOf('payer')).filter((id) => id === L.paid).length === 1);
    record('complete', 'the outline marks the lesson done without reloading it', await evaluate(`[...document.querySelectorAll('#lesson-outline-list li')][2].innerText.includes('✓')`));

    // Failed request and retry (scenarios 6, 7).
    // The lesson request fails at the network level (no HTTP answer), like a dropped connection.
    const blocked = await send('Network.setBlockedURLs', { urls: [`*/api/lessons/${L.demo}*`] });
    record('recovery', 'failure injection is active', !blocked.error, blocked.error ? blocked.error.message : '');
    await evaluate(`(() => { const a = [...document.querySelectorAll('#lesson-outline-list a')].find((x) => x.getAttribute('href').endsWith(${JSON.stringify(L.demo)})); a.click(); return true; })()`);
    const errorShown = await waitFor(`/could not be loaded/.test(document.body.innerText) && [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Try again')`);
    record('recovery', '6. a failed lesson request shows a recoverable error with Try again', errorShown);
    await send('Network.setBlockedURLs', { urls: [] });
    const retried = await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Try again'); if (!b) return false; b.click(); return true; })()`);
    record('recovery', '7. Try again loads the lesson', retried === true && await waitFor(titleIs('Demo lesson')));

    // Offline and automatic recovery (F).
    await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await evaluate(`(() => { const a = [...document.querySelectorAll('#lesson-outline-list a')].find((x) => x.getAttribute('href').endsWith(${JSON.stringify(L.preview)})); a.click(); return true; })()`);
    const offlineShown = await waitFor(`Boolean(document.querySelector('[data-testid="offline-banner"]')) && /You are offline/.test(document.body.innerText)`);
    record('recovery', 'offline: the page says so instead of loading forever', offlineShown);
    await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    record('recovery', 'back online: the lesson loads by itself', await waitFor(titleIs('Preview lesson')));

    // Canonical course URL and not-found (14, E).
    await send('Page.navigate', { url: `${origin}/courses/${Q}/lessons/${L.preview}` });
    record('ui', '14. a lesson URL under the wrong course is corrected to its own course', await waitFor(`location.pathname === ${JSON.stringify(`/courses/${P}/lessons/${L.preview}`)} && ${titleIs('Preview lesson')}`, 60000));
    await send('Page.navigate', { url: `${origin}/courses/${P}/lessons/${new ObjectId()}` });
    record('ui', 'an unknown lesson shows "Lesson not found" with a way back', await waitFor(`/Lesson not found/.test(document.body.innerText) && /Back to course/.test(document.body.innerText)`, 60000));

    // Unpaid student: course page lock presentation, locked lesson URL, continue.
    record('ui', 'enrolled unpaid student signs in', (await signInAs('student')) === 200);
    for (const [label, width, mobile] of [['desktop', 1366, false], ['phone', 390, true]]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 860, deviceScaleFactor: mobile ? 3 : 1, mobile });
      await send('Page.navigate', { url: `${origin}/courses/${P}` });
      await waitFor(`document.querySelectorAll('[data-testid="course-lesson-open"], [data-testid="course-lesson-locked"]').length === 4`, 60000);
      const p = await page();
      const counts = await evaluate(`[document.querySelectorAll('[data-testid="course-lesson-open"]').length, document.querySelectorAll('[data-testid="course-lesson-locked"]').length]`);
      record('course', `${label}: all four lessons listed; the free preview and the demo open, two locked`, JSON.stringify(counts) === '[2,2]' && /Free preview/.test(p.text) && /2 locked lessons in this course/.test(p.text), JSON.stringify(counts));
      record('course', `${label}: no lesson body on the course page`, !/SECRET-/.test(p.text));
      record('course', `${label}: Continue leads to the first open unfinished lesson (the preview)`, await evaluate(`(document.querySelector('[data-testid="continue-lesson"]') || {}).getAttribute && document.querySelector('[data-testid="continue-lesson"]').getAttribute('href').endsWith(${JSON.stringify(L.preview)})`));
      record('course', `${label}: no horizontal overflow on the course page`, p.sw <= p.w + 1, `${p.sw}/${p.w}`);
    }
    await send('Emulation.clearDeviceMetricsOverride');
    await send('Page.navigate', { url: `${origin}/courses/${P}/lessons/${L.paid}` });
    const leftLocked = await waitFor(`location.pathname === ${JSON.stringify(`/courses/${P}`)}`, 60000);
    record('ui', 'a locked lesson URL (no checkout configured) leads to the course page without its content', leftLocked && !/SECRET-Paidlesson/.test(await evaluate('document.body.innerText')));

    record('ui', 'unenrolled student signs in', (await signInAs('stranger')) === 200);
    await send('Page.navigate', { url: `${origin}/courses/${P}/lessons/${L.preview}` });
    record('ui', 'unenrolled: the lesson page explains and links to the course instead of an error', await waitFor(`/not open to you yet/.test(document.body.innerText) && /Go to the course/.test(document.body.innerText) && !/SECRET-/.test(document.body.innerText)`, 60000));
  } catch (error) {
    record('setup', 'run completed', false, String(error && error.stack || error).replace(/mongodb(\+srv)?:\/\/\S+/g, '<uri>').slice(0, 400));
  } finally {
    try { ws.close(); } catch { /* closed */ }
    // Edge's launcher hands off to another process, so killing the spawned PID alone leaves Edge running.
    await closeBrowser(debugPort);
    browser.kill();
    server.kill();
    media.close();
  }
  const log = fs.readFileSync(logFile, 'utf8');
  record('leakage', 'no fixture email in the server log', Object.values(accounts).every((a) => !log.includes(a.email)));
  await client.close().catch(() => {});
  console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed. Server log: ${logFile}`);
  process.exit(results.every(Boolean) ? 0 : 1);
})();
