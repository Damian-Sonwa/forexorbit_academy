/**
 * Phase 4.5 session checks against the real application (node server.js), a real Socket.IO client
 * and headless Microsoft Edge. Same safety rules as scripts/acceptance/run.js (guard.js): local or
 * opted-in test server only, a database ending in "_acceptance", synthetic accounts only. It uses
 * its own database, <ACCEPTANCE_DB_NAME without "_acceptance">_sessions_acceptance, marked as the
 * harness's, and clears only that database.
 *
 *   node scripts/acceptance/sessions-e2e.js
 *
 * Covers what in-process tests cannot: the Edge middleware CSRF/Origin gate, CORS preflights,
 * socket handshakes (cookie, Origin), socket disconnection on sign-out, revocation, suspension and
 * idle expiry, rotation and reuse through real HTTP, two browser tabs, the closed legacy window and
 * the production start-up refusal without APP_ORIGIN. Database state is moved in time by editing
 * the synthetic session rows directly; nothing waits 15 or 30 minutes.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..', '..');
const { checkAcceptanceConfig, checkDisposable, MARKER, MARKER_COLLECTION } = require('./guard');

const results = [];
function record(area, check, ok, detail = '') {
  results.push({ area, check, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'} [${area}] ${check}${detail ? ` (${detail})` : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hash = (token) => crypto.createHash('sha256').update(token).digest('hex');

function sessionOf(res) {
  let value = null;
  for (const cookie of res.headers.getSetCookie()) {
    const match = /^__Host-fo_session=([^;]*)/.exec(cookie);
    if (match) value = match[1] || null;
  }
  return value;
}

(async () => {
  const envFile = path.join(ROOT, '.env.acceptance');
  const fileEnv = fs.existsSync(envFile) ? require('dotenv').parse(fs.readFileSync(envFile)) : {};
  const merged = { ...process.env, ...fileEnv };
  const base = checkAcceptanceConfig(merged);
  if (!base.ok) { console.error(`Refused: ${base.reason}`); process.exit(2); }
  const dbName = `${base.dbName.replace(/_(acceptance|test)$/, '')}_sessions_acceptance`;
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
  for (const [key, role] of [['student', 'student'], ['other', 'student'], ['superadmin', 'superadmin']]) {
    const password = `Acc-${crypto.randomBytes(12).toString('base64url')}-9a!`;
    const email = `${key}@sessions.acceptance.invalid`;
    const { insertedId } = await db.collection('users').insertOne({ name: `Sessions ${key}`, email, password: await bcrypt.hash(password, 10), role, status: 'approved', learningLevel: 'beginner', onboardingCompleted: true, createdAt: new Date(), updatedAt: new Date() });
    accounts[key] = { id: String(insertedId), email, password };
  }

  const port = 3320;
  const origin = `http://localhost:${port}`;
  const logFile = path.join(os.tmpdir(), `fo-sessions-e2e-${Date.now()}.log`);
  const env = {
    PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP,
    APPDATA: process.env.APPDATA, LOCALAPPDATA: process.env.LOCALAPPDATA, USERPROFILE: process.env.USERPROFILE,
    NODE_ENV: 'development', PORT: String(port), MONGO_URI: config.uri, MONGODB_DB_NAME: dbName,
    JWT_SECRET: crypto.randomBytes(48).toString('hex'), NEXT_TELEMETRY_DISABLED: '1', NEXT_PUBLIC_ADS_ENABLED: 'false',
  };
  const out = fs.openSync(logFile, 'w');
  const server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: ['ignore', out, out] });
  const sockets = [];
  let browser = null;
  try {
    for (let i = 0; ; i += 1) {
      if (i > 240) throw new Error(`server did not start; see ${logFile}`);
      if (/Server is ready/.test(fs.readFileSync(logFile, 'utf8'))) {
        try { if ((await fetch(`${origin}/api/courses`)).status < 500) break; } catch { /* not yet */ }
      }
      await sleep(1000);
    }
    const call = (method, url, { token, body, headers = {} } = {}) => fetch(`${origin}/api${url}`, {
      method,
      headers: { Origin: origin, 'X-FO-CSRF': '1', ...(token ? { Cookie: `__Host-fo_session=${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const login = async (key) => sessionOf(await call('POST', '/auth/login', { body: { email: accounts[key].email, password: accounts[key].password } }));
    const status = async (token) => (await call('GET', '/auth/me', { token })).status;

    // ---- Middleware CSRF / Origin (real Edge middleware)
    const creds = { email: accounts.student.email, password: accounts.student.password };
    const raw = (headers) => fetch(`${origin}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(creds) });
    let r = await raw({ Origin: origin });
    record('csrf', 'login without the CSRF header refused by middleware', r.status === 403 && (await r.json()).code === 'csrf_header_missing', `HTTP ${r.status}`);
    r = await raw({ Origin: 'https://evil.example', 'X-FO-CSRF': '1' });
    record('csrf', 'login from a foreign Origin refused', r.status === 403, `HTTP ${r.status}`);
    r = await raw({ 'X-FO-CSRF': '1' });
    record('csrf', 'login with no Origin or Referer refused', r.status === 403, `HTTP ${r.status}`);
    r = await raw({ Origin: origin, 'X-FO-CSRF': '1' });
    const t1 = sessionOf(r);
    record('csrf', 'same-origin login with the header succeeds and sets the cookie', r.status === 200 && Boolean(t1) && !('token' in (await r.json())));
    r = await fetch(`${origin}/api/progress`, { method: 'POST', headers: { Cookie: `__Host-fo_session=${t1}`, Origin: 'https://evil.example', 'X-FO-CSRF': '1', 'Content-Type': 'application/json' }, body: '{}' });
    record('csrf', 'a signed-in state change from a foreign Origin is refused', r.status === 403, `HTTP ${r.status}`);
    r = await fetch(`${origin}/api/auth/logout`, { method: 'POST', headers: { Cookie: `__Host-fo_session=${t1}` } });
    record('csrf', 'cross-site sign-out (no Origin, no header) refused', r.status === 403 && (await status(t1)) === 200);
    r = await fetch(`${origin}/api/paystack/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    record('csrf', 'the signed Paystack webhook is not blocked by the CSRF gate', r.status !== 403 || !(await r.text()).includes('Request refused'), `HTTP ${r.status}`);

    // ---- CORS
    r = await fetch(`${origin}/api/auth/me`, { method: 'OPTIONS', headers: { Origin: 'https://forexorbit-academy.vercel.app', 'Access-Control-Request-Method': 'GET' } });
    record('cors', 'preflight from a platform origin gets no CORS grant', r.headers.get('access-control-allow-origin') === null, `ACAO ${r.headers.get('access-control-allow-origin')}`);
    r = await fetch(`${origin}/api/auth/me`, { headers: { Origin: 'https://evil.example', Cookie: `__Host-fo_session=${t1}` } });
    record('cors', 'a foreign origin is never echoed with credentials', r.headers.get('access-control-allow-origin') === null);
    r = await fetch(`${origin}/api/auth/me`, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' } });
    record('cors', 'the trusted origin gets an exact grant with the CSRF header allowed', r.headers.get('access-control-allow-origin') === origin && /x-fo-csrf/i.test(r.headers.get('access-control-allow-headers') || ''));

    // ---- Sockets
    const { io } = require('socket.io-client');
    const connect = (token, headers = {}) => new Promise((resolve) => {
      const socket = io(origin, { path: '/api/socket', transports: ['websocket'], reconnection: false, timeout: 8000, extraHeaders: { ...(token ? { Cookie: `__Host-fo_session=${token}` } : {}), ...headers } });
      sockets.push(socket);
      socket.ended = false;
      socket.on('session_ended', () => { socket.ended = true; });
      socket.on('connect', () => resolve({ ok: true, socket }));
      socket.on('connect_error', (e) => resolve({ ok: false, socket, error: e.message }));
    });
    let s = await connect(t1, { Origin: origin });
    record('socket', 'handshake with the session cookie and the trusted Origin connects', s.ok, s.error);
    const socketA = s.socket;
    s = await connect(t1, { Origin: 'https://evil.example' });
    record('socket', 'foreign Origin refused (cross-site WebSocket hijacking)', !s.ok, s.error);
    s = await connect(t1, {});
    record('socket', 'no Origin and no same-origin fetch metadata refused', !s.ok, s.error);
    s = await connect(null, { Origin: origin });
    record('socket', 'no session cookie refused', !s.ok, s.error);
    s = await connect('x'.repeat(43), { Origin: origin });
    record('socket', 'unknown session refused', !s.ok, s.error);
    // Legacy handshake (auth.token) is not accepted.
    const legacy = await new Promise((resolve) => {
      const socket = io(origin, { path: '/api/socket', transports: ['websocket'], reconnection: false, auth: { token: 'eyJhbGciOiJIUzI1NiJ9.e30.x' }, extraHeaders: { Origin: origin } });
      sockets.push(socket);
      socket.on('connect', () => resolve(true));
      socket.on('connect_error', () => resolve(false));
    });
    record('socket', 'a bearer token in the handshake is not accepted', legacy === false);

    // Sign-out disconnects this sign-in's sockets only.
    const t2 = await login('student');
    const socketB = (await connect(t2, { Origin: origin })).socket;
    await call('POST', '/auth/logout', { token: t1 });
    await sleep(800);
    record('socket', 'sign-out disconnects that session\'s socket with session_ended', socketA.disconnected && socketA.ended);
    record('socket', 'another sign-in\'s socket stays connected', socketB.connected && (await status(t2)) === 200 && (await status(t1)) === 401);

    // Sign out everywhere disconnects every socket of the account.
    const t3 = await login('student');
    const socketC = (await connect(t3, { Origin: origin })).socket;
    await call('POST', '/auth/logout-all', { token: t2 });
    await sleep(800);
    record('socket', 'sign out everywhere disconnects every socket of the account', socketB.disconnected && socketC.disconnected && (await status(t3)) === 401);

    // Suspension by the Super Admin ends the student's session and socket.
    const sa = await login('superadmin');
    const t4 = await login('student');
    const socketD = (await connect(t4, { Origin: origin })).socket;
    r = await call('PATCH', `/admin/users/${accounts.student.id}`, { token: sa, body: { action: 'suspend', reason: 'Acceptance check' } });
    await sleep(800);
    record('revocation', 'suspension ends the session and its socket at once', r.status === 200 && socketD.disconnected && (await status(t4)) !== 200, `HTTP ${r.status}`);
    r = await call('POST', '/auth/login', { body: { email: accounts.student.email, password: accounts.student.password } });
    record('revocation', 'a suspended account cannot sign in', r.status === 403 && !sessionOf(r));
    await call('PATCH', `/admin/users/${accounts.student.id}`, { token: sa, body: { action: 'reactivate', reason: 'Acceptance check' } });
    record('revocation', 'after reactivation the old session stays ended', (await status(t4)) === 401);

    // Idle expiry reaches a connected socket via the periodic sweep (no event needed).
    const t5 = await login('other');
    const socketE = (await connect(t5, { Origin: origin })).socket;
    await db.collection('sessions').updateOne({ _id: hash(t5) }, { $set: { lastSeenAt: new Date(Date.now() - 31 * 60 * 1000) } });
    for (let i = 0; i < 45 && socketE.connected; i += 1) await sleep(1000);
    record('expiry', 'an idle-expired session\'s socket is disconnected by the sweep', socketE.disconnected);
    record('expiry', 'the idle-expired session is refused over HTTP', (await status(t5)) === 401);
    const t6 = await login('other');
    await db.collection('sessions').updateOne({ _id: hash(t6) }, { $set: { absoluteExpiresAt: new Date(Date.now() - 1000) } });
    record('expiry', 'a session past its absolute expiry is refused', (await status(t6)) === 401);

    // ---- Rotation and reuse through real HTTP
    const t7 = await login('other');
    const fifteen = new Date(Date.now() - 16 * 60 * 1000);
    await db.collection('sessions').updateOne({ _id: hash(t7) }, { $set: { createdAt: fifteen, familyCreatedAt: fifteen, absoluteExpiresAt: new Date(fifteen.getTime() + 12 * 3600 * 1000) } });
    const parallel = await Promise.all([1, 2, 3].map(() => call('GET', '/auth/me', { token: t7 })));
    const issued = parallel.map(sessionOf).filter(Boolean);
    record('rotation', 'after 15 minutes one of several parallel requests rotates; all succeed', parallel.every((x) => x.status === 200) && issued.length === 1, `statuses ${parallel.map((x) => x.status)}, new ids ${issued.length}`);
    const t8 = issued[0];
    record('rotation', 'old id still works inside the 30-second grace (other tabs)', (await status(t7)) === 200);
    record('rotation', 'new id works', (await status(t8)) === 200);
    await db.collection('sessions').updateOne({ _id: hash(t7) }, { $set: { rotatedAt: new Date(Date.now() - 31 * 1000) } });
    record('rotation', 'old id after the grace window is refused as reuse', (await status(t7)) === 401);
    record('rotation', 'reuse revokes the whole sign-in, including the new id', (await status(t8)) === 401);
    const log = await db.collection('passwordResetSecurityLogs').countDocuments({ event: 'session_reuse_detected' });
    record('rotation', 'reuse is recorded in the security log', log === 1);

    // ---- Legacy window closed by default
    r = await call('POST', '/auth/session/upgrade', { headers: { Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.e30.x' } });
    record('legacy', 'the legacy upgrade is closed unless AUTH_LEGACY_BEARER_UNTIL opens it', r.status === 410);

    // ---- Stored data: only hashes
    const rows = await db.collection('sessions').find({}).toArray();
    const text = JSON.stringify(rows);
    record('storage', 'no raw session id is stored', [t1, t2, t3, t4, t5, t6, t7, t8].every((t) => !text.includes(t)));

    // ---- Two browser tabs: signing out in one signs out the other
    const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
    if (fs.existsSync(edge)) {
      const WebSocket = require('ws');
      const debugPort = 9341;
      const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fo-sessions-edge-'));
      browser = spawn(edge, ['--headless=new', '--disable-gpu', '--no-first-run', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
      let pages = [];
      for (let i = 0; i < 60 && !pages.length; i += 1) {
        try { pages = (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).filter((t) => t.type === 'page'); } catch { await sleep(500); }
      }
      const attach = async (target) => {
        const ws = new WebSocket(target.webSocketDebuggerUrl);
        await new Promise((resolve) => ws.once('open', resolve));
        let n = 0; const pending = new Map();
        ws.on('message', (m) => { const msg = JSON.parse(m); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result); pending.delete(msg.id); } });
        const send = (method, params = {}) => new Promise((resolve) => { n += 1; pending.set(n, resolve); ws.send(JSON.stringify({ id: n, method, params })); });
        const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.value;
        return { ws, send, evaluate };
      };
      const tabA = await attach(pages[0]);
      await tabA.send('Page.navigate', { url: `${origin}/login` });
      await sleep(3000);
      const signedIn = await tabA.evaluate(`fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-FO-CSRF': '1' }, body: JSON.stringify(${JSON.stringify({ email: accounts.other.email, password: accounts.other.password })}) }).then((r) => r.status)`);
      await tabA.send('Page.navigate', { url: `${origin}/dashboard` });
      const created = await (await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(`${origin}/dashboard`)}`, { method: 'PUT' })).json();
      await sleep(9000);
      const tabB = await attach(created);
      const before = await tabB.evaluate('location.pathname');
      // Sign out through the app's own button in tab A.
      // Tab A was put in the background when tab B opened; bring it back and wait for the app shell.
      await tabA.send('Page.bringToFront');
      for (let i = 0; i < 30; i += 1) {
        if (await tabA.evaluate(`[...document.querySelectorAll('button, a')].some((el) => /sign out|log ?out/i.test((el.textContent || '') + ' ' + (el.getAttribute('aria-label') || '')))`)) break;
        await sleep(1000);
      }
      const clicked = await tabA.evaluate(`(() => { const b = [...document.querySelectorAll('button, a')].find((el) => /sign out|log ?out/i.test((el.textContent || '') + ' ' + (el.getAttribute('aria-label') || ''))); if (!b) return [...document.querySelectorAll('button')].map((el) => (el.textContent || el.getAttribute('aria-label') || '').trim()).slice(0, 20).join(' | '); b.click(); return 'clicked'; })()`);
      await sleep(5000);
      const meA = await tabA.evaluate(`fetch('/api/auth/me').then((r) => r.status)`);
      console.log(`  tab A sign-out: ${clicked}; tab A /me ${meA}`);
      const afterB = await tabB.evaluate('location.pathname');
      const meB = await tabB.evaluate(`fetch('/api/auth/me').then((r) => r.status)`);
      record('tabs', 'signing out in one tab signs out the other open tab', signedIn === 200 && before === '/dashboard' && afterB === '/login' && meB === 401, `${before} -> ${afterB}, me ${meB}`);
      tabA.ws.close();
      tabB.ws.close();
    } else {
      record('tabs', 'browser available', false, 'Microsoft Edge not found');
    }
  } catch (error) {
    record('setup', 'run completed', false, String(error && error.message).replace(/mongodb(\+srv)?:\/\/\S+/g, '<uri>'));
  } finally {
    for (const socket of sockets) socket.close();
    if (browser) browser.kill();
    server.kill();
  }

  // ---- Production start-up refuses without APP_ORIGIN (exits before connecting anywhere)
  const prod = spawnSync(process.execPath, ['-e', "process.env.NODE_ENV='production';require('./server.js')"], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, MONGO_URI: 'mongodb://127.0.0.1:1/never_used_test', JWT_SECRET: 'x'.repeat(48) },
    encoding: 'utf8',
    timeout: 60000,
  });
  record('config', 'production start-up without APP_ORIGIN exits with an error', prod.status === 1 && /APP_ORIGIN is not set/.test(prod.stderr), `exit ${prod.status}`);

  const serverLog = fs.readFileSync(logFile, 'utf8');
  record('leakage', 'no fixture email address in the server log', Object.values(accounts).every((a) => !serverLog.includes(a.email)));
  await client.close().catch(() => {});
  const failed = results.filter((x) => !x.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed. Server log: ${logFile}`);
  process.exit(failed.length ? 1 : 0);
})();
