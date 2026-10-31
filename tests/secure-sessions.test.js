/**
 * Phase 4.5: HttpOnly cookie sessions, CSRF/Origin, CORS, socket origin rules, revocation and the
 * temporary legacy upgrade. Real modules and route handlers run against the in-memory database
 * (tests/helpers/memory-db.js); nothing here is real-MongoDB or real-browser coverage. The live
 * server and browser checks are in scripts/acceptance/sessions-e2e.js.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { ObjectId } = require('mongodb');

const { memoryDb } = require('./helpers/memory-db');
const { loadModule, mockResponse } = require('./helpers/ts-loader');
const { requestHeaders, seedSession, sessionFromResponse, setCookies, TEST_ORIGIN } = require('./helpers/session-cookie');
const core = require('../lib/session-core');
const guard = require('../lib/request-guard');
const { legacyBearerWindow, LEGACY_BEARER_HARD_STOP } = require('../lib/legacy-bearer');
const { SESSION_INDEXES, compareSessionIndex, ensureSessionIndexes } = require('../lib/session-indexes');
const sockets = require('../lib/session-sockets');
const role = require('../lib/app-database-role');

const ROOT = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const MIN = 60 * 1000;
const T0 = new Date('2026-11-02T09:00:00Z');
const at = (ms) => new Date(T0.getTime() + ms);

async function withEnv(env, fn) {
  const saved = {};
  for (const key of Object.keys(env)) {
    saved[key] = process.env[key];
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const TEST_ENV = { NODE_ENV: 'test', APP_ORIGIN: undefined, PORT: undefined, SHARED_RATE_LIMIT: undefined, TRUSTED_PROXY_HOPS: undefined, AUTH_LEGACY_BEARER_UNTIL: undefined, JWT_SECRET: 'test-only-phase45-secret' };

function account(extra = {}) {
  return { _id: new ObjectId(), email: 'person@example.com', name: 'Person', role: 'student', status: 'approved', sessionGeneration: 2, ...extra };
}

function dbWith(users) {
  return memoryDb({ users });
}

async function signIn(db, user, now = T0) {
  return core.createSession(db, { userId: String(user._id), generation: core.generationOf(user), now });
}

function loadRoute(route, db, extra = {}) {
  return loadModule(route, { 'lib/mongodb': { getDb: async () => db }, ...extra }).default;
}

async function call(handler, { method = 'GET', token, headers, body, url = '/api/test' } = {}) {
  const res = mockResponse();
  await handler({ method, url, headers: headers || requestHeaders(token), body, query: {}, socket: { remoteAddress: '10.0.0.2' } }, res);
  res.session = sessionFromResponse(res);
  return res;
}

function withAuthRoute(db, allowedRoles) {
  const { withAuth } = loadModule('lib/auth-middleware.ts', { 'lib/mongodb': { getDb: async () => db } });
  const seen = [];
  const handler = withAuth(async (req, res) => {
    seen.push(req.user);
    res.status(200).json({ ok: true, user: req.user });
  }, allowedRoles);
  return { handler, seen };
}

// ---------------------------------------------------------------------------
// Cookie attributes
// ---------------------------------------------------------------------------

test('cookie: __Host- prefix, HttpOnly, Secure, SameSite=Lax, Path=/, no Domain, Max-Age = time to absolute expiry', () => {
  const token = 'A'.repeat(43);
  const cookie = core.sessionCookie(token, 43200);
  assert.equal(cookie, `__Host-fo_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200`);
  assert.doesNotMatch(cookie, /Domain=/i, 'host-only');
  assert.equal(core.clearedSessionCookie(), '__Host-fo_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
  assert.throws(() => core.sessionCookie('short', 10), /Invalid session id/);
  assert.equal(core.cookieMaxAgeSeconds({ absoluteExpiresAt: at(12 * 60 * MIN) }, T0), 43200);
  assert.equal(core.cookieMaxAgeSeconds({ absoluteExpiresAt: at(-MIN) }, T0), 0);
});

test('cookie parsing: only one well-formed value of the session cookie is accepted', () => {
  const token = 'b'.repeat(43);
  assert.equal(core.readSessionCookie(`theme=dark; __Host-fo_session=${token}; x=1`), token);
  assert.equal(core.readSessionCookie(`__Host-fo_session=${token}; __Host-fo_session=${token}`), token, 'same value twice is fine');
  assert.equal(core.readSessionCookie(`__Host-fo_session=${token}; __Host-fo_session=${'c'.repeat(43)}`), null, 'two different values are refused');
  for (const bad of [undefined, '', 'fo_session=' + token, `__Host-fo_session=${token}!`, '__Host-fo_session=', `__Host-fo_session=${'d'.repeat(44)}`, 'token=abc']) {
    assert.equal(core.readSessionCookie(bad), null, String(bad));
  }
});

test('a new session: 256-bit random id, only its SHA-256 stored, bound to the generation, 12-hour absolute expiry', async () => {
  const user = account();
  const db = dbWith([user]);
  const { token, session } = await signIn(db, user);
  assert.match(token, core.TOKEN_PATTERN);
  assert.equal(Buffer.from(token, 'base64url').length, 32);
  const stored = db.docs('sessions')[0];
  assert.equal(stored._id, core.hashToken(token));
  assert.equal(JSON.stringify(stored).includes(token), false, 'raw id not stored');
  assert.equal(stored.generation, 2);
  assert.equal(stored.absoluteExpiresAt.getTime() - T0.getTime(), 12 * 60 * MIN);
  assert.equal(session.familyId, stored.familyId);
  const second = await signIn(db, user);
  assert.notEqual(second.token, token);
  assert.notEqual(second.session.familyId, session.familyId, 'each sign-in is its own family');
});

test('lifetimes are the owner decisions: 30-minute idle, 12-hour absolute, 15-minute rotation, 30-second grace', () => {
  assert.equal(core.IDLE_TIMEOUT_MS, 30 * MIN);
  assert.equal(core.ABSOLUTE_LIFETIME_MS, 12 * 60 * MIN);
  assert.equal(core.ROTATION_INTERVAL_MS, 15 * MIN);
  assert.equal(core.ROTATION_GRACE_MS, 30 * 1000);
});

// ---------------------------------------------------------------------------
// Expiry
// ---------------------------------------------------------------------------

test('idle expiry: a session unused for 30 minutes ends; activity keeps it alive', async () => {
  const user = account();
  const db = dbWith([user]);
  const { token } = await signIn(db, user);
  assert.equal((await core.resolveSession(db, token, { now: at(29 * MIN), rotate: false })).ok, true);
  // That request moved lastSeenAt to 29 minutes; 29 more minutes is still inside the idle window.
  assert.equal((await core.resolveSession(db, token, { now: at(58 * MIN), rotate: false })).ok, true);
  const idle = await core.resolveSession(db, token, { now: at(58 * MIN + 30 * MIN), rotate: false });
  assert.deepEqual([idle.ok, idle.status, idle.reason], [false, 401, 'expired_idle']);
  assert.equal(db.docs('sessions')[0].revokeReason, 'expired_idle');
  assert.equal((await core.resolveSession(db, token, { now: at(89 * MIN), rotate: false })).reason, 'revoked', 'stays ended');
});

test('absolute expiry: 12 hours after sign-in the session ends however active it was, and rotation never extends it', async () => {
  const user = account();
  const db = dbWith([user]);
  let { token } = await signIn(db, user);
  // Used every 10 minutes, with rotation, for 12 hours.
  for (let t = 10 * MIN; t < 12 * 60 * MIN; t += 10 * MIN) {
    const result = await core.resolveSession(db, token, { now: at(t) });
    assert.equal(result.ok, true, `at ${t / MIN} minutes`);
    if (result.token) token = result.token;
    assert.equal(result.session.absoluteExpiresAt.getTime(), at(12 * 60 * MIN).getTime());
  }
  const end = await core.resolveSession(db, token, { now: at(12 * 60 * MIN) });
  assert.deepEqual([end.ok, end.reason], [false, 'expired_absolute']);
});

// ---------------------------------------------------------------------------
// Rotation, tabs, reuse and races
// ---------------------------------------------------------------------------

test('rotation: after 15 minutes the next request gets a new id; the old one works for 30 seconds (parallel tabs)', async () => {
  const user = account();
  const db = dbWith([user]);
  const { token, session } = await signIn(db, user);
  const early = await core.resolveSession(db, token, { now: at(14 * MIN) });
  assert.equal(early.token, null, 'no rotation before 15 minutes');

  const rotated = await core.resolveSession(db, token, { now: at(15 * MIN) });
  assert.equal(rotated.ok, true);
  assert.match(rotated.token, core.TOKEN_PATTERN);
  assert.notEqual(rotated.token, token);
  assert.equal(rotated.session.familyId, session.familyId);
  const old = db.docs('sessions').find((s) => s._id === core.hashToken(token));
  assert.equal(old.rotatedTo, core.hashToken(rotated.token));

  // Another tab's request still carrying the old id, inside the grace window: accepted, no second rotation.
  const sibling = await core.resolveSession(db, token, { now: at(15 * MIN + 29 * 1000) });
  assert.deepEqual([sibling.ok, sibling.token], [true, null]);
  assert.equal(db.docs('sessions').length, 2);
  assert.equal((await core.resolveSession(db, rotated.token, { now: at(16 * MIN) })).ok, true);
});

test('reuse: a retired id presented after the grace window revokes the whole sign-in and is logged without the id', async () => {
  const user = account();
  const db = dbWith([user]);
  const other = await signIn(db, user); // another device: must survive
  const { token } = await signIn(db, user);
  const rotated = await core.resolveSession(db, token, { now: at(15 * MIN) });
  const replay = await core.resolveSession(db, token, { now: at(15 * MIN + 31 * 1000) });
  assert.deepEqual([replay.ok, replay.status, replay.reason], [false, 401, 'reuse']);
  const current = await core.resolveSession(db, rotated.token, { now: at(16 * MIN) });
  assert.deepEqual([current.ok, current.reason], [false, 'revoked'], 'the thief\'s or victim\'s newer id ends too');
  assert.equal((await core.resolveSession(db, other.token, { now: at(16 * MIN) })).ok, true, 'other devices unaffected');
  const logs = db.docs('passwordResetSecurityLogs');
  assert.deepEqual(logs.map((l) => l.event), ['session_reuse_detected']);
  const text = JSON.stringify(logs);
  assert.equal(text.includes(token) || text.includes(core.hashToken(token)), false);
});

test('race: simultaneous requests at the rotation point create exactly one successor; all succeed', async () => {
  const user = account();
  const db = dbWith([user]);
  const { token } = await signIn(db, user);
  const results = await Promise.all(Array.from({ length: 5 }, () => core.resolveSession(db, token, { now: at(15 * MIN) })));
  assert.ok(results.every((r) => r.ok));
  assert.equal(results.filter((r) => r.token).length, 1, 'one rotation');
  assert.equal(db.docs('sessions').length, 2);
});

test('race: a request racing a sign-out is refused once the sign-out is stored', async () => {
  const user = account();
  const db = dbWith([user]);
  const { token, session } = await signIn(db, user);
  await core.revokeFamily(db, session.familyId, 'logout', at(MIN));
  assert.equal((await core.resolveSession(db, token, { now: at(MIN) })).reason, 'revoked');
});

test('a failed successor insert leaves the current id working (rotation retried later)', async () => {
  const user = account();
  const db = dbWith([user]);
  const { token } = await signIn(db, user);
  const sessions = db.collection('sessions');
  const insert = sessions.insertOne;
  sessions.insertOne = async () => { throw new Error('write failed'); };
  const result = await core.resolveSession(db, token, { now: at(15 * MIN) });
  sessions.insertOne = insert;
  assert.deepEqual([result.ok, result.token], [true, null]);
  const row = db.docs('sessions')[0];
  assert.deepEqual([row.rotatedAt, row.rotatedTo], [null, null]);
  assert.equal((await core.resolveSession(db, token, { now: at(16 * MIN) })).token !== null, true, 'rotates on the next request');
});

// ---------------------------------------------------------------------------
// Accounts, roles and revocation
// ---------------------------------------------------------------------------

test('inactive accounts: pending, rejected, suspended, unknown role or deleted accounts cannot use a session', async () => {
  for (const extra of [{ status: 'pending' }, { status: 'rejected' }, { status: 'suspended' }, { role: 'guest' }]) {
    const user = account(extra);
    const db = dbWith([user]);
    const { token } = await signIn(db, user);
    const result = await core.resolveSession(db, token, { now: at(MIN) });
    assert.deepEqual([result.ok, result.reason, result.status], [false, 'account', 403], JSON.stringify(extra));
  }
  const user = account();
  const db = dbWith([user]);
  const { token } = await signIn(db, user);
  db.docs('users').splice(0, 1);
  assert.deepEqual([(await core.resolveSession(db, token, { now: at(MIN) })).status], [401], 'deleted account');
});

test('revocation by generation: raising sessionGeneration ends every session of the account', async () => {
  const user = account();
  const db = dbWith([user]);
  const a = await signIn(db, user);
  const b = await signIn(db, user);
  db.docs('users')[0].sessionGeneration = 3;
  for (const { token } of [a, b]) assert.equal((await core.resolveSession(db, token, { now: at(MIN) })).reason, 'generation');
});

test('security events: endAccountSessions revokes every stored session of the account only and disconnects its sockets', async () => {
  const user = account();
  const other = account({ email: 'other@example.com' });
  const db = dbWith([user, other]);
  await signIn(db, user);
  await signIn(db, user);
  const keep = await signIn(db, other);
  const events = [];
  const io = {
    to: (room) => ({ emit: (event) => events.push(['emit', room, event]) }),
    in: (room) => ({ disconnectSockets: (close) => events.push(['disconnect', room, close]) }),
  };
  sockets.registerSessionSocketServer(io);
  try {
    await core.endAccountSessions(db, String(user._id), 'password_changed', at(MIN));
  } finally {
    sockets.registerSessionSocketServer(null);
  }
  const rows = db.docs('sessions');
  assert.ok(rows.filter((s) => s.userId === String(user._id)).every((s) => s.revokeReason === 'password_changed'));
  assert.equal((await core.resolveSession(db, keep.token, { now: at(MIN) })).ok, true);
  assert.deepEqual(events, [['emit', `user:${user._id}`, 'session_ended'], ['disconnect', `user:${user._id}`, true]]);
});

test('role change and deletion end the account\'s sessions; suspension does too (lib/account-approval.js)', async () => {
  const approval = require('../lib/account-approval');
  const superadmin = account({ role: 'superadmin', email: 'sa@example.com' });
  const student = account({ email: 's@example.com' });
  const db = dbWith([superadmin, student]);
  db.collection('adminAuditLog');
  const actor = { userId: String(superadmin._id), role: 'superadmin', email: superadmin.email };
  const first = await signIn(db, student);
  const changed = await approval.changeAccountRole(db, { actor, userId: String(student._id), role: 'instructor' });
  assert.equal(changed.ok, true);
  assert.equal(db.docs('users')[1].sessionGeneration, 3);
  assert.equal((await core.resolveSession(db, first.token, { now: at(MIN) })).ok, false, 'signs in again under the new role');

  const second = await signIn(db, db.docs('users')[1]);
  assert.equal((await approval.changeAccountStatus(db, { actor, userId: String(student._id), action: 'suspend', reason: 'Owner instruction' })).ok, true);
  assert.equal((await core.resolveSession(db, second.token, { now: at(MIN) })).ok, false);
  assert.equal(db.docs('sessions').find((s) => s._id === core.hashToken(second.token)).revokeReason, 'account_suspended');

  const third = await signIn(db, superadmin);
  const victim = account({ email: 'v@example.com' });
  db.docs('users').push(victim);
  const victimSession = await signIn(db, victim);
  assert.equal((await approval.deleteAccount(db, { actor, userId: String(victim._id) })).ok, true);
  assert.equal(db.docs('sessions').find((s) => s._id === core.hashToken(victimSession.token)).revokeReason, 'account_deleted');
  assert.equal((await core.resolveSession(db, third.token, { now: at(MIN) })).ok, true, 'the actor stays signed in');
});

test('roles come from the live account on every request; the Super Admin rule is unchanged', async () => {
  await withEnv(TEST_ENV, async () => {
    const admin = account({ role: 'admin', email: 'a@example.com' });
    const db = dbWith([admin]);
    const { token } = await signIn(db, admin);
    const superOnly = withAuthRoute(db, ['superadmin']);
    assert.equal((await call(superOnly.handler, { token })).statusCode, 403);
    const staff = withAuthRoute(db, ['admin', 'superadmin']);
    const ok = await call(staff.handler, { token });
    assert.equal(ok.statusCode, 200);
    assert.deepEqual(staff.seen[0], { userId: String(admin._id), email: admin.email, role: 'admin' });
    // Approval decisions stay Super Admin only (lib/account-approval.js).
    const { decideApprovalRequest } = require('../lib/account-approval');
    assert.equal(decideApprovalRequest({ actor: { userId: String(admin._id), role: 'admin' }, userId: String(new ObjectId()), action: 'approve' }).status, 403);
    assert.equal(decideApprovalRequest({ actor: { userId: String(admin._id), role: 'superadmin' }, userId: String(new ObjectId()), action: 'approve' }).ok, true);
  });
});

// ---------------------------------------------------------------------------
// withAuth: cookie only, CSRF and Origin
// ---------------------------------------------------------------------------

test('withAuth: no cookie or an unknown cookie is 401; a stale cookie is cleared; the session sets req.user', async () => {
  await withEnv(TEST_ENV, async () => {
    const user = account();
    const db = dbWith([user]);
    const { handler } = withAuthRoute(db);
    assert.equal((await call(handler)).statusCode, 401);
    const unknown = await call(handler, { token: 'z'.repeat(43) });
    assert.equal(unknown.statusCode, 401);
    assert.deepEqual(setCookies(unknown), [core.clearedSessionCookie()]);
    const { token } = await signIn(db, user, new Date());
    const ok = await call(handler, { token });
    assert.deepEqual([ok.statusCode, ok.body.user.userId], [200, String(user._id)]);
  });
});

test('withAuth: a bearer token is never accepted (no localStorage fallback)', async () => {
  await withEnv(TEST_ENV, async () => {
    const user = account();
    const db = dbWith([user]);
    const { handler } = withAuthRoute(db);
    const { issueAuthToken } = require('../lib/token-core');
    const jwt = issueAuthToken({ userId: String(user._id), email: user.email, role: 'student', generation: 2, key: TEST_ENV.JWT_SECRET });
    const res = await call(handler, { headers: { authorization: `Bearer ${jwt}` } });
    assert.equal(res.statusCode, 401);
  });
});

test('withAuth: rotation sets the new cookie on the response', async () => {
  await withEnv(TEST_ENV, async () => {
    const user = account();
    const db = dbWith([user]);
    const { token } = await signIn(db, user, new Date(Date.now() - 16 * MIN));
    db.docs('sessions')[0].lastSeenAt = new Date();
    const { handler } = withAuthRoute(db);
    const res = await call(handler, { token });
    assert.equal(res.statusCode, 200);
    assert.ok(res.session && res.session !== token);
    assert.match(setCookies(res)[0], /HttpOnly; Secure; SameSite=Lax; Max-Age=\d+$/);
  });
});

test('CSRF: a state-changing request needs the trusted Origin (or Referer) and the X-FO-CSRF header', async () => {
  await withEnv(TEST_ENV, async () => {
    const user = account();
    const db = dbWith([user]);
    const { token } = await signIn(db, user, new Date());
    const { handler, seen } = withAuthRoute(db);
    const cookie = requestHeaders(token).cookie;
    const cases = [
      [{ cookie, origin: 'https://evil.example', 'x-fo-csrf': '1' }, 'origin_not_allowed'],
      [{ cookie, origin: 'https://forexorbit-academy.vercel.app', 'x-fo-csrf': '1' }, 'origin_not_allowed'],
      [{ cookie, origin: 'https://anything.vercel.app', 'x-fo-csrf': '1' }, 'origin_not_allowed'],
      [{ cookie, 'x-fo-csrf': '1' }, 'origin_missing'],
      [{ cookie, origin: 'null', 'x-fo-csrf': '1' }, 'origin_missing'],
      [{ cookie, origin: TEST_ORIGIN }, 'csrf_header_missing'],
      [{ cookie, origin: TEST_ORIGIN, 'x-fo-csrf': '0' }, 'csrf_header_missing'],
    ];
    for (const [headers, code] of cases) {
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        const res = await call(handler, { method, headers });
        assert.deepEqual([res.statusCode, res.body.code], [403, code], `${method} ${JSON.stringify(headers)}`);
      }
    }
    assert.equal(seen.length, 0, 'the handler never ran');
    assert.equal((await call(handler, { method: 'POST', headers: { cookie, referer: `${TEST_ORIGIN}/profile`, 'x-fo-csrf': '1' } })).statusCode, 200, 'Referer fallback');
    assert.equal((await call(handler, { method: 'POST', token })).statusCode, 200);
    assert.equal((await call(handler, { method: 'GET', headers: { cookie } })).statusCode, 200, 'safe methods need no header');
  });
});

test('CSRF decision: production without APP_ORIGIN refuses every state-changing request; the webhook is exempt', () => {
  const header = (h) => (name) => h[name];
  const prod = { NODE_ENV: 'production' };
  assert.equal(guard.decideRequestOrigin({ method: 'POST', pathname: '/api/auth/login', header: header({ origin: 'https://app.example.com', 'x-fo-csrf': '1' }), env: prod }).code, 'origin_not_configured');
  const env = { NODE_ENV: 'production', APP_ORIGIN: 'https://app.example.com' };
  assert.equal(guard.decideRequestOrigin({ method: 'POST', pathname: '/api/auth/login', header: header({ origin: 'https://app.example.com', 'x-fo-csrf': '1' }), env }).ok, true);
  assert.equal(guard.decideRequestOrigin({ method: 'POST', pathname: '/api/auth/login', header: header({ origin: 'http://localhost:3000', 'x-fo-csrf': '1' }), env }).code, 'origin_not_allowed', 'no localhost in production');
  assert.equal(guard.decideRequestOrigin({ method: 'POST', pathname: '/api/paystack/webhook', header: header({}), env }).ok, true);
  assert.equal(guard.decideRequestOrigin({ method: 'POST', pathname: '/api/paystack/webhook-other', header: header({}), env }).ok, false);
  assert.equal(guard.decideRequestOrigin({ method: 'HEAD', pathname: '/api/x', header: header({}), env }).ok, true);
});

test('APP_ORIGIN: an https origin without path is required in production; http only for localhost elsewhere', () => {
  assert.deepEqual(guard.appOriginConfig({ NODE_ENV: 'production', APP_ORIGIN: 'https://app.example.com/' }), { ok: true, origin: 'https://app.example.com' });
  for (const bad of ['', 'http://app.example.com', 'https://app.example.com/path', 'https://user:pw@app.example.com', 'app.example.com', 'https://app.example.com?x=1']) {
    assert.equal(guard.appOriginConfig({ NODE_ENV: 'production', APP_ORIGIN: bad }).ok, false, bad);
  }
  assert.deepEqual(guard.appOriginConfig({ NODE_ENV: 'development' }), { ok: true, origin: null });
  assert.equal(guard.appOriginConfig({ NODE_ENV: 'development', APP_ORIGIN: 'http://localhost:3000' }).ok, true);
  assert.equal(guard.appOriginConfig({ NODE_ENV: 'development', APP_ORIGIN: 'http://intranet.example' }).ok, false);
  assert.deepEqual(guard.trustedOrigins({ NODE_ENV: 'production', APP_ORIGIN: 'https://app.example.com' }), ['https://app.example.com']);
  assert.deepEqual(guard.trustedOrigins({ NODE_ENV: 'development', PORT: '4000' }), ['http://localhost:4000', 'http://127.0.0.1:4000']);
});

test('CORS: only the exact trusted origin is echoed; no platform wildcards', async () => {
  const env = { NODE_ENV: 'production', APP_ORIGIN: 'https://app.example.com' };
  assert.equal(guard.corsOrigin('https://app.example.com', env), 'https://app.example.com');
  for (const other of ['https://evil.vercel.app', 'https://forexorbit-academy.vercel.app', 'https://x.onrender.com', 'https://app.example.com.evil.com', 'http://app.example.com', null]) {
    assert.equal(guard.corsOrigin(other, env), null, String(other));
  }
  await withEnv({ ...TEST_ENV, NODE_ENV: 'production', APP_ORIGIN: 'https://app.example.com' }, async () => {
    const route = loadModule('pages/api/ai/check-config.ts', { 'lib/ai': { isAIConfigured: () => false } }).default;
    const foreign = mockResponse();
    route({ method: 'GET', headers: { origin: 'https://preview.vercel.app' } }, foreign);
    assert.equal(foreign.headers['access-control-allow-origin'], undefined);
    assert.equal(foreign.headers['access-control-allow-credentials'], undefined);
    const own = mockResponse();
    route({ method: 'GET', headers: { origin: 'https://app.example.com' } }, own);
    assert.equal(own.headers['access-control-allow-origin'], 'https://app.example.com');
    assert.equal(own.headers['access-control-allow-headers'], 'Content-Type, x-fo-csrf');
  });
  const cors = read('lib/cors-origin.ts');
  assert.doesNotMatch(cors, /vercel\.app|onrender\.com|endsWith/);
  for (const file of ['pages/api/ai/answer-question.ts', 'pages/api/ai/check-config.ts', 'pages/api/consultations/agora-token.ts', 'middleware.ts', 'server.js']) {
    assert.doesNotMatch(read(file), /includes\('vercel\.app'\)|\.vercel\.app'\)|includes\('onrender\.com'\)/, file);
  }
});

test('middleware.ts applies the CSRF/Origin decision to every /api request before routing', () => {
  const source = read('middleware.ts');
  const guardAt = source.indexOf('const guard = decideRequestOrigin({');
  assert.ok(guardAt > 0);
  assert.ok(guardAt < source.indexOf('isFeatureApiBlocked(pathname)'), 'before any route handling');
  assert.match(source, /if \(!guard\.ok\) \{\s*return NextResponse\.json\(\{ error: guard\.error, code: guard\.code \}, \{ status: guard\.status \}\);/);
  assert.match(source, /'Access-Control-Allow-Headers': `Content-Type, \$\{CSRF_HEADER\}`/);
});

// ---------------------------------------------------------------------------
// Sockets
// ---------------------------------------------------------------------------

test('socket origin: only the trusted origin, or same-origin fetch metadata without an Origin, may connect', () => {
  const env = { NODE_ENV: 'production', APP_ORIGIN: 'https://app.example.com' };
  const decide = (h) => guard.decideSocketOrigin({ header: (name) => h[name], env });
  assert.equal(decide({ origin: 'https://app.example.com' }).ok, true);
  assert.equal(decide({ origin: 'https://evil.example' }).code, 'origin_not_allowed');
  assert.equal(decide({ origin: 'https://forexorbit-academy.vercel.app' }).ok, false);
  assert.equal(decide({}).code, 'origin_missing', 'no Origin and no fetch metadata (curl, other tools)');
  assert.equal(decide({ 'sec-fetch-site': 'cross-site' }).ok, false);
  assert.equal(decide({ 'sec-fetch-site': 'same-origin' }).ok, true);
  assert.equal(guard.decideSocketOrigin({ header: (n) => ({ 'sec-fetch-site': 'same-origin' })[n], env: { NODE_ENV: 'production' } }).ok, false, 'misconfigured: refused');
});

test('socket server: cookie handshake, origin check, no rotation, per-event and periodic session re-checks', () => {
  const server = read('server.js');
  assert.match(server, /allowRequest: \(req, callback\) => \{\s*const decision = decideSocketOrigin/);
  assert.match(server, /origin: allowedOrigins,/);
  assert.doesNotMatch(server, /if \(!origin\) return callback\(null, true\)/, 'no-Origin connections are no longer waved through');
  assert.match(server, /readSessionCookie\(socket\.handshake\.headers\.cookie\)/);
  assert.match(server, /resolveSession\(await getDb\(\), socket\.data\.sessionToken, \{ rotate: false \}\)/);
  assert.match(server, /socket\.use\(\(packet, next\) => \{/);
  assert.match(server, /setInterval\(async \(\) => \{\s*for \(const socket of io\.of\('\/'\)\.sockets\.values\(\)\) \{\s*try \{/, 'every socket on every tick');
  assert.match(server, /registerSessionSocketServer\(io\);/);
  assert.match(server, /const appOrigin = appOriginConfig\(process\.env\);\s*if \(!appOrigin\.ok\) \{/);
});

test('session sockets: one sign-out disconnects only that sign-in\'s sockets', () => {
  const made = (family) => ({ data: { sessionFamilyId: family }, events: [], closed: false, emit(e) { this.events.push(e); }, disconnect() { this.closed = true; } });
  const a = made('fam-a');
  const b = made('fam-b');
  const io = { of: () => ({ sockets: new Map([['1', a], ['2', b]]) }) };
  sockets.endSocketsForFamily(io, 'fam-a');
  assert.deepEqual([a.closed, a.events, b.closed], [true, ['session_ended'], false]);
  assert.doesNotThrow(() => sockets.endSocketsForFamily(null, 'fam-a'), 'no socket server in this process');
});

// ---------------------------------------------------------------------------
// Routes: login, logout, logout-all, me
// ---------------------------------------------------------------------------

test('login and logout through the routes: cookie set, no token in the body, logout revokes and clears', async () => {
  await withEnv(TEST_ENV, async () => {
    const user = account({ password: await bcrypt.hash('current-pass-1', 4) });
    const db = dbWith([user]);
    const quickBcrypt = { ...bcrypt, hash: (v) => bcrypt.hash(v, 4) };
    const login = loadRoute('pages/api/auth/login.ts', db, { bcryptjs: quickBcrypt });
    const me = loadRoute('pages/api/auth/me.ts', db);
    const logout = loadRoute('pages/api/auth/logout.ts', db);

    const signed = await call(login, { method: 'POST', body: { email: user.email, password: 'current-pass-1' } });
    assert.equal(signed.statusCode, 200);
    assert.deepEqual(Object.keys(signed.body), ['user']);
    assert.equal(signed.headers['cache-control'], 'no-store');
    assert.ok(signed.session);
    const body = JSON.stringify(signed.body);
    assert.equal(body.includes(signed.session), false);

    // Signing in again on the same browser ends the earlier session (one browser, one session).
    const again = await call(login, { method: 'POST', token: signed.session, body: { email: user.email, password: 'current-pass-1' } });
    assert.equal(setCookies(again).length, 1, 'one Set-Cookie: the new session');
    assert.equal((await call(me, { token: signed.session })).statusCode, 401);

    const meRes = await call(me, { token: again.session });
    assert.deepEqual([meRes.statusCode, meRes.body.id, meRes.headers['cache-control']], [200, String(user._id), 'no-store']);
    assert.equal((await call(me, { method: 'POST', token: again.session })).statusCode, 405);

    const out = await call(logout, { method: 'POST', token: again.session });
    assert.equal(out.statusCode, 200);
    assert.deepEqual(setCookies(out), [core.clearedSessionCookie()]);
    assert.equal((await call(me, { token: again.session })).statusCode, 401);
    assert.equal(db.docs('sessions').every((s) => s.revokedAt), true);
    // Signing out again (or without a session) still succeeds and clears the cookie.
    assert.equal((await call(logout, { method: 'POST' })).statusCode, 200);
    // Cross-site sign-out is refused.
    assert.equal((await call(logout, { method: 'POST', headers: { origin: 'https://evil.example', 'x-fo-csrf': '1' } })).statusCode, 403);
  });
});

test('logout ends one device; logout-all ends every device', async () => {
  await withEnv(TEST_ENV, async () => {
    const user = account();
    const db = dbWith([user]);
    const me = loadRoute('pages/api/auth/me.ts', db);
    const logout = loadRoute('pages/api/auth/logout.ts', db);
    const logoutAll = loadRoute('pages/api/auth/logout-all.ts', db);
    const phone = (await signIn(db, user, new Date())).token;
    const laptop = (await signIn(db, user, new Date())).token;
    await call(logout, { method: 'POST', token: phone });
    assert.equal((await call(me, { token: phone })).statusCode, 401);
    assert.equal((await call(me, { token: laptop })).statusCode, 200, 'the other device stays signed in');
    const tablet = (await signIn(db, user, new Date())).token;
    assert.equal((await call(logoutAll, { method: 'POST', token: laptop })).statusCode, 200);
    for (const token of [laptop, tablet]) assert.equal((await call(me, { token })).statusCode, 401);
    assert.equal(db.docs('users')[0].sessionGeneration, 3);
  });
});

// ---------------------------------------------------------------------------
// Temporary legacy upgrade
// ---------------------------------------------------------------------------

test('legacy window: closed unless AUTH_LEGACY_BEARER_UNTIL is a future ISO date no later than the hard stop', () => {
  const now = new Date('2026-11-10T00:00:00Z');
  assert.equal(legacyBearerWindow({}, now).open, false);
  assert.equal(legacyBearerWindow({ AUTH_LEGACY_BEARER_UNTIL: 'next week' }, now).reason, 'invalid_setting');
  assert.equal(legacyBearerWindow({ AUTH_LEGACY_BEARER_UNTIL: '2026-11-09T00:00:00Z' }, now).reason, 'ended');
  assert.equal(legacyBearerWindow({ AUTH_LEGACY_BEARER_UNTIL: '2027-06-01T00:00:00Z' }, now).reason, 'beyond_hard_stop');
  assert.equal(legacyBearerWindow({ AUTH_LEGACY_BEARER_UNTIL: '2026-11-24T00:00:00Z' }, now).open, true);
  assert.equal(legacyBearerWindow({ AUTH_LEGACY_BEARER_UNTIL: '2026-11-24T00:00:00Z' }, new Date(LEGACY_BEARER_HARD_STOP)).open, false);
});

test('legacy upgrade route: closed by default; when open, a valid pre-4.5 token becomes a cookie session once', async () => {
  const { issueAuthToken } = require('../lib/token-core');
  const user = account();
  const db = dbWith([user]);
  const route = loadRoute('pages/api/auth/session/upgrade.ts', db);
  const jwtFor = (generation, key = TEST_ENV.JWT_SECRET) => issueAuthToken({ userId: String(user._id), email: user.email, role: 'student', generation, key });
  const upgrade = (bearer, extra = {}) => call(route, { method: 'POST', headers: { ...requestHeaders(null), authorization: `Bearer ${bearer}`, ...extra } });
  await withEnv(TEST_ENV, async () => {
    const closed = await upgrade(jwtFor(2));
    assert.deepEqual([closed.statusCode, closed.body.code], [410, 'legacy_upgrade_closed']);
    assert.equal(db.docs('sessions').length, 0);
  });
  await withEnv({ ...TEST_ENV, AUTH_LEGACY_BEARER_UNTIL: new Date(Date.now() + 7 * 24 * 60 * MIN).toISOString() }, async () => {
    assert.equal((await upgrade(jwtFor(1))).statusCode, 401, 'a token ended by a later generation');
    assert.equal((await upgrade(jwtFor(2, 'another-secret'))).statusCode, 401, 'forged signature');
    assert.equal((await upgrade(jwtFor(2), { origin: 'https://evil.example' })).statusCode, 403, 'cross-site');
    const ok = await upgrade(jwtFor(2));
    assert.deepEqual([ok.statusCode, ok.body], [200, { upgraded: true }]);
    assert.ok(ok.session);
    assert.equal(db.docs('sessions')[0].generation, 2);
    db.docs('users')[0].status = 'suspended';
    assert.equal((await upgrade(jwtFor(2))).statusCode, 401, 'inactive account');
  });
});

// ---------------------------------------------------------------------------
// Browser code: no credential in storage, no leakage, refresh recovery, tabs
// ---------------------------------------------------------------------------

function clientFiles() {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (rel.replace(/\\/g, '/') !== 'pages/api') walk(rel);
      } else if (/\.(tsx?|jsx?)$/.test(entry.name)) out.push(rel.replace(/\\/g, '/'));
    }
  };
  for (const dir of ['pages', 'components', 'hooks', 'contexts']) if (fs.existsSync(path.join(ROOT, dir))) walk(dir);
  for (const file of ['lib/api-client.ts', 'lib/ai-client.ts', 'lib/api-fetch.ts']) out.push(file);
  return out;
}

test('browser code never stores, reads or sends a credential (only the one-time legacy removal remains)', () => {
  for (const file of clientFiles()) {
    const source = read(file);
    assert.doesNotMatch(source, /(localStorage|sessionStorage)\.setItem\(['"](token|user)['"]/, file);
    assert.doesNotMatch(source, /document\.cookie/, file);
    assert.doesNotMatch(source, /indexedDB/, file);
    if (file === 'hooks/useAuth.tsx') continue;
    assert.doesNotMatch(source, /(localStorage|sessionStorage)\.getItem\(['"](token|user)['"]/, file);
    assert.doesNotMatch(source, /Authorization|Bearer/, file);
    assert.doesNotMatch(source, /auth: \{ token \}/, file);
  }
  const auth = read('hooks/useAuth.tsx');
  // The only storage access: read the old token, delete both keys, exchange once. Nothing is written.
  assert.equal((auth.match(/localStorage\./g) || []).length, 2);
  assert.match(auth, /legacyToken = window\.localStorage\.getItem\('token'\);\s*for \(const key of LEGACY_STORAGE_KEYS\) window\.localStorage\.removeItem\(key\);/);
  assert.match(auth, /TEMPORARY \(Phase 4\.5 rollout only/);
});

test('refresh recovery: after a reload the profile is re-read from /auth/me with the cookie; 401 means signed out', () => {
  const auth = read('hooks/useAuth.tsx');
  assert.match(auth, /await migrateLegacyStorage\(\);\s*if \(!cancelled\) await loadSession\(\);\s*if \(!cancelled\) setLoading\(false\);/);
  assert.match(auth, /const fresh = await apiClient\.get<User>\('\/auth\/me'\);/);
  const client = read('lib/api-client.ts');
  assert.match(client, /withCredentials: true/);
  assert.match(client, /\[CSRF_HEADER\]: CSRF_VALUE/);
  assert.match(client, /SESSION_PROBE_URLS = \['\/auth\/login', '\/auth\/me', '\/auth\/signup', '\/auth\/logout', '\/auth\/session\/upgrade'\]/);
  assert.match(read('lib/api-fetch.ts'), /credentials: 'include'/);
});

test('multiple tabs: sign-in and sign-out are broadcast as event names only; sockets react to session_ended', () => {
  const auth = read('hooks/useAuth.tsx');
  assert.match(auth, /channel\.current\?\.postMessage\(event\);/);
  assert.match(auth, /type AuthEvent = 'signed-in' \| 'signed-out';/);
  assert.match(auth, /else if \(event\.data === 'signed-in'\) void loadSession\(\);/);
  const socket = read('hooks/useSocket.ts');
  assert.match(socket, /newSocket\.on\('session_ended', \(\) => \{\s*void refreshUser\(\);/);
});

test('no leakage: session ids are never logged or put in a response body; errors redact bearer values', async () => {
  for (const file of ['lib/session-core.js', 'lib/session-auth.ts', 'pages/api/auth/login.ts', 'pages/api/auth/logout.ts', 'pages/api/auth/session/upgrade.ts', 'server.js']) {
    const source = read(file);
    assert.doesNotMatch(source, /console\.\w+\([^)]*\btoken\b/, file);
  }
  const { messageFromUnknown } = require('../lib/public-error');
  assert.doesNotMatch(String(messageFromUnknown(new Error('Bearer abc.def.ghi'))), /abc\.def\.ghi/);
});

// ---------------------------------------------------------------------------
// Database role and indexes
// ---------------------------------------------------------------------------

test('the app role gets find/insert/update/remove on sessions and no index privileges', () => {
  assert.ok(role.READ_WRITE_COLLECTIONS.includes('sessions'));
  const grant = role.rolePrivileges('Forex_elearning').find((p) => p.resource.collection === 'sessions');
  assert.deepEqual(grant.actions, ['find', 'insert', 'update', 'remove']);
  assert.doesNotMatch(read('lib/session-core.js'), /createIndex/);
});

function indexDb(existing, { listError } = {}) {
  const created = [];
  let current = [...existing];
  return {
    created,
    collection: () => ({
      indexes: async () => { if (listError) throw listError; return current; },
      createIndex: async (key, options) => { created.push(options.name); current = [...current, { key, ...options }]; },
    }),
  };
}

test('session indexes: read-only report, idempotent build of the missing ones, refusal when unknown or conflicting', async () => {
  assert.deepEqual(SESSION_INDEXES.map((d) => [d.options.name, d.key]), [
    ['session_user', { userId: 1 }],
    ['session_family', { familyId: 1 }],
    ['session_ttl', { absoluteExpiresAt: 1 }],
  ]);
  const fresh = indexDb([{ name: '_id_', key: { _id: 1 } }]);
  assert.deepEqual((await ensureSessionIndexes(fresh)).built, [], 'read-only by default');
  assert.equal(fresh.created.length, 0);
  const built = await ensureSessionIndexes(fresh, { apply: true });
  assert.deepEqual([built.ok, built.built], [true, ['session_user', 'session_family', 'session_ttl']]);
  const again = await ensureSessionIndexes(fresh, { apply: true });
  assert.deepEqual([again.ok, again.built], [true, []], 'second run is a no-op');

  const missingCollection = indexDb([], { listError: Object.assign(new Error('ns'), { code: 26 }) });
  assert.ok((await ensureSessionIndexes(missingCollection)).states.every((s) => s.state === 'missing'));
  const unauthorized = indexDb([], { listError: Object.assign(new Error('not authorized'), { code: 13 }) });
  const refusedUnknown = await ensureSessionIndexes(unauthorized, { apply: true });
  assert.deepEqual([refusedUnknown.ok, unauthorized.created], [false, []]);
  const conflicting = indexDb([{ name: 'session_ttl', key: { absoluteExpiresAt: 1 }, expireAfterSeconds: 5 }]);
  const refusedConflict = await ensureSessionIndexes(conflicting, { apply: true });
  assert.deepEqual([refusedConflict.ok, conflicting.created], [false, []]);
  assert.equal(compareSessionIndex(SESSION_INDEXES[0], [{ name: 'other', key: { userId: 1 }, unique: true }]), 'conflicting');
});

test('the session index script reuses the certificate script\'s connection and target safety rules', () => {
  const script = read('scripts/session-indexes.js');
  assert.match(script, /const \{ connectionFrom, decideTarget, parseArgs \} = require\('\.\/certificate-indexes'\);/);
  assert.match(script, /decideTarget\(\{ uri: connection\.uri, database: args\.database, envFile: args\.envFile \}\)/);
  assert.doesNotMatch(script, /console\.\w+\([^)]*connection\.uri/);
  assert.doesNotMatch(script, /dropIndex/);
});
