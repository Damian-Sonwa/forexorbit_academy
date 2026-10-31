/**
 * H1: rate limits on POST /api/auth/login and POST /api/auth/signup.
 *
 * The real route handlers run against an in-memory database. Each route is loaded twice to act
 * as two server instances with separate in-process limiters and one shared store. The store
 * applies each upsert atomically, as MongoDB does for a single document; it does not prove
 * MongoDB's behaviour across real processes or its TTL monitor (see the H1 report).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const ts = require('typescript');
const realBcrypt = require('bcryptjs');
const { ObjectId } = require('mongodb');

const { RATE_LIMIT_COLLECTION, RATE_LIMIT_TTL_INDEX } = require('../lib/shared-rate-limit');
const authLimit = require('../lib/auth-rate-limit');
const clientIp = require('../lib/client-ip');
const { createRateLimiter } = require('../lib/rate-limit');
const { hashToken } = require('../lib/session-core');
const { sessionFromResponse, setCookies } = require('./helpers/session-cookie');

const ROOT = path.join(__dirname, '..');
const WINDOW = authLimit.WINDOW_MS;
const T0 = Date.UTC(2026, 9, 30, 12, 0, 0);
const PASSWORD = 'correct-horse-battery';
const STUDENT_EMAIL = 'learner@example.com';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/** users + rateLimits + sessions; findOneAndUpdate is applied atomically per document. */
function memoryDb({ failRateLimits = false } = {}) {
  const users = [];
  const limits = new Map();
  const sessions = [];
  const ops = { userFinds: 0, userInserts: 0, limitUpserts: 0 };
  const db = {
    users,
    limits,
    sessions,
    ops,
    collection(name) {
      if (name === 'sessions') {
        return {
          insertOne: async (doc) => {
            sessions.push({ ...doc });
            return { insertedId: doc._id };
          },
          findOne: async (filter) => {
            const row = sessions.find((s) => s._id === filter._id);
            return row ? { ...row } : null;
          },
        };
      }
      if (name === 'users') {
        return {
          findOne: async (filter) => {
            ops.userFinds += 1;
            const row = users.find((u) => Object.entries(filter).every(([k, v]) => String(u[k]) === String(v)));
            return row ? { ...row } : null;
          },
          insertOne: async (doc) => {
            ops.userInserts += 1;
            const _id = new ObjectId();
            users.push({ ...doc, _id });
            return { insertedId: _id };
          },
        };
      }
      if (name === RATE_LIMIT_COLLECTION) {
        return {
          findOneAndUpdate: async (filter, update, options) => {
            ops.limitUpserts += 1;
            if (failRateLimits) throw new Error('rate limit store unreachable');
            assert.equal(options.upsert, true);
            const doc = limits.get(filter._id) || { _id: filter._id, count: 0, ...update.$setOnInsert };
            doc.count += update.$inc.count;
            limits.set(filter._id, doc);
            return { ...doc };
          },
        };
      }
      throw new Error(`unexpected collection ${name}`);
    },
  };
  return db;
}

/** Counts every bcrypt call made by the routes. */
function bcryptSpy() {
  const calls = { hash: 0, compare: 0 };
  return {
    calls,
    module: {
      ...realBcrypt,
      hash: (...args) => { calls.hash += 1; return realBcrypt.hash(args[0], 4); },
      compare: (...args) => { calls.compare += 1; return realBcrypt.compare(...args); },
    },
  };
}

/** Loads a route as one server instance: its own module copies, the given db and bcrypt. */
function loadRoute(route, db, bcrypt) {
  const stubs = { [path.join(ROOT, 'lib/mongodb')]: { getDb: async () => db } };
  const cache = new Map();
  const load = (filename) => {
    if (cache.has(filename)) return cache.get(filename).exports;
    const isTs = /\.tsx?$/.test(filename);
    const source = fs.readFileSync(filename, 'utf8');
    const code = isTs
      ? ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText
      : source;
    const mod = new Module(filename);
    mod.filename = filename;
    mod.paths = Module._nodeModulePaths(path.dirname(filename));
    cache.set(filename, mod);
    mod.require = (id) => {
      if (id === 'bcryptjs') return bcrypt;
      const base = id.startsWith('@/') ? path.join(ROOT, id.slice(2)) : id.startsWith('.') ? path.join(path.dirname(filename), id) : null;
      if (!base) return require(id);
      const bare = base.replace(/\.(ts|js)$/, '');
      if (stubs[bare]) return stubs[bare];
      // Limiter modules are loaded per instance so each instance has its own in-process counts.
      for (const ext of ['.ts', '.tsx', '.js']) if (fs.existsSync(bare + ext)) return load(bare + ext);
      return require(base);
    };
    mod._compile(code, filename);
    return mod.exports;
  };
  return load(path.join(ROOT, route)).default;
}

async function post(handler, { ip = '203.0.113.10', body, headers = {}, socketIp = '10.0.0.2' }) {
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    getHeader(k) { return this.headers[k.toLowerCase()]; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  const reqHeaders = { ...headers };
  if (ip) reqHeaders['x-forwarded-for'] = ip;
  await handler({ method: 'POST', headers: reqHeaders, body, query: {}, socket: { remoteAddress: socketIp } }, res);
  return res;
}

/** Runs fn with a fixed clock and the given environment, restoring both afterwards. */
async function withEnv(env, fn) {
  const saved = {};
  for (const key of Object.keys(env)) {
    saved[key] = process.env[key];
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
  const realNow = Date.now;
  let now = T0;
  Date.now = () => now;
  try {
    return await fn({ setNow: (t) => { now = t; } });
  } finally {
    Date.now = realNow;
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const ENV = { JWT_SECRET: 'test-only-h1-secret', SHARED_RATE_LIMIT: 'mongodb', TRUSTED_PROXY_HOPS: undefined };

async function setup({ shared = true, failRateLimits = false } = {}) {
  const db = memoryDb({ failRateLimits });
  db.users.push({
    _id: new ObjectId(),
    email: STUDENT_EMAIL,
    password: await realBcrypt.hash(PASSWORD, 4),
    name: 'Learner',
    role: 'student',
    status: 'approved',
    sessionGeneration: 2,
  });
  const spy = bcryptSpy();
  const env = { ...ENV, SHARED_RATE_LIMIT: shared ? 'mongodb' : undefined };
  return {
    db,
    spy,
    env,
    login: [loadRoute('pages/api/auth/login.ts', db, spy.module), loadRoute('pages/api/auth/login.ts', db, spy.module)],
    signup: [loadRoute('pages/api/auth/signup.ts', db, spy.module), loadRoute('pages/api/auth/signup.ts', db, spy.module)],
  };
}

const loginBody = (email, password = 'wrong-password') => ({ email, password });
const RATE_BODY_KEYS = ['code', 'error', 'retryAfterSec'];

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

test('login: requests under the per-address limit are handled normally; the next one gets 429', async () => {
  const h = await setup();
  await withEnv(h.env, async () => {
    for (let i = 0; i < 30; i += 1) {
      const res = await post(h.login[i % 2], { body: loginBody(`user${i}@example.com`) });
      assert.equal(res.statusCode, 401, `attempt ${i + 1}`);
    }
    const compares = h.spy.calls.compare;
    const finds = h.db.ops.userFinds;
    const refused = await post(h.login[0], { body: loginBody('another@example.com') });
    assert.equal(refused.statusCode, 429);
    assert.deepEqual(Object.keys(refused.body).sort(), RATE_BODY_KEYS);
    assert.equal(refused.body.code, 'rate_limited');
    assert.equal(h.spy.calls.compare, compares, 'no password check once limited');
    assert.equal(h.db.ops.userFinds, finds, 'no user lookup once limited');
    // Another address is unaffected.
    assert.equal((await post(h.login[1], { ip: '198.51.100.7', body: loginBody('another@example.com') })).statusCode, 401);
  });
});

test('login: one address on one account is limited to 10 per window; other addresses and accounts are independent', async () => {
  const h = await setup();
  await withEnv(h.env, async () => {
    for (let i = 0; i < 10; i += 1) assert.equal((await post(h.login[i % 2], { body: loginBody(STUDENT_EMAIL) })).statusCode, 401);
    assert.equal((await post(h.login[0], { body: loginBody(STUDENT_EMAIL) })).statusCode, 429);
    assert.equal((await post(h.login[0], { ip: '198.51.100.20', body: loginBody(STUDENT_EMAIL) })).statusCode, 401, 'same account, other address');
    assert.equal((await post(h.login[0], { body: loginBody('someone-else@example.com') })).statusCode, 401, 'same address, other account');
  });
});

test('login: many addresses on one account are capped at 50 per window', async () => {
  const h = await setup();
  await withEnv(h.env, async () => {
    for (let i = 0; i < 50; i += 1) {
      assert.equal((await post(h.login[i % 2], { ip: `192.0.2.${i + 1}`, body: loginBody(STUDENT_EMAIL) })).statusCode, 401);
    }
    assert.equal((await post(h.login[0], { ip: '192.0.2.200', body: loginBody(STUDENT_EMAIL) })).statusCode, 429);
    assert.equal((await post(h.login[0], { ip: '192.0.2.200', body: loginBody('other@example.com') })).statusCode, 401);
  });
});

test('login: email case and whitespace are normalized for the limit exactly as for sign-in', async () => {
  const h = await setup();
  await withEnv(h.env, async () => {
    const variants = [STUDENT_EMAIL, ' LEARNER@example.com', 'Learner@Example.COM ', '\tlearner@EXAMPLE.com'];
    for (let i = 0; i < 10; i += 1) assert.equal((await post(h.login[0], { body: loginBody(variants[i % 4]) })).statusCode, 401);
    assert.equal((await post(h.login[1], { body: loginBody('  learner@example.com  ') })).statusCode, 429);
    assert.equal(authLimit.normalizeEmail('  A@B.Co '), 'a@b.co');
  });
});

test('login: a successful sign-in returns the profile only and sets an HttpOnly session cookie bound to the generation', async () => {
  const h = await setup();
  await withEnv(h.env, async () => {
    for (let i = 0; i < 9; i += 1) await post(h.login[0], { body: loginBody(STUDENT_EMAIL) });
    const ok = await post(h.login[1], { body: loginBody(' Learner@example.com', PASSWORD) });
    assert.equal(ok.statusCode, 200);
    assert.deepEqual(Object.keys(ok.body).sort(), ['user'], 'no credential in the body');
    assert.deepEqual(Object.keys(ok.body.user).sort(), ['email', 'id', 'name', 'role', 'status']);
    assert.equal(ok.body.user.email, STUDENT_EMAIL);
    const [cookie] = setCookies(ok);
    assert.match(cookie, /^__Host-fo_session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200$/);
    const id = sessionFromResponse(ok);
    assert.equal(h.db.sessions.length, 1);
    const stored = h.db.sessions[0];
    assert.equal(stored._id, hashToken(id), 'only the hash is stored');
    assert.equal(stored.generation, 2, 'bound to the account\'s sessionGeneration');
    assert.equal(stored.userId, String(h.db.users[0]._id));
    assert.ok(!JSON.stringify(stored).includes(id), 'the raw id is not stored');
  });
});

test('login: wrong passwords and unknown emails, and their rate-limit refusals, look identical', async () => {
  const h = await setup();
  await withEnv(h.env, async () => {
    const known = await post(h.login[0], { body: loginBody(STUDENT_EMAIL) });
    const unknown = await post(h.login[0], { ip: '198.51.100.30', body: loginBody('nobody@example.com') });
    assert.equal(known.statusCode, 401);
    assert.deepEqual(known.body, unknown.body);

    for (let i = 0; i < 10; i += 1) {
      await post(h.login[0], { ip: '198.51.100.40', body: loginBody(STUDENT_EMAIL) });
      await post(h.login[0], { ip: '198.51.100.41', body: loginBody('nobody@example.com') });
    }
    const a = await post(h.login[0], { ip: '198.51.100.40', body: loginBody(STUDENT_EMAIL) });
    const b = await post(h.login[0], { ip: '198.51.100.41', body: loginBody('nobody@example.com') });
    assert.equal(a.statusCode, 429);
    assert.deepEqual([a.statusCode, a.body, a.headers], [b.statusCode, b.body, b.headers]);
  });
});

test('login: Retry-After is the time left in the current window', async () => {
  const h = await setup();
  await withEnv(h.env, async ({ setNow }) => {
    for (let i = 0; i < 10; i += 1) await post(h.login[0], { body: loginBody(STUDENT_EMAIL) });
    setNow(T0 + 4 * 60 * 1000);
    const refused = await post(h.login[1], { body: loginBody(STUDENT_EMAIL) });
    assert.equal(refused.statusCode, 429);
    assert.equal(refused.headers['retry-after'], String(6 * 60));
    assert.equal(refused.body.retryAfterSec, 6 * 60);
    assert.equal(refused.headers['cache-control'], 'no-store');
    // After the window the same attempt is checked again: throttling is temporary, nothing is locked.
    setNow(T0 + WINDOW);
    const later = await post(h.login[0], { body: loginBody(STUDENT_EMAIL, PASSWORD) });
    assert.equal(later.statusCode, 200);
  });
});

test('login: simultaneous requests across two instances cannot exceed the limit', async () => {
  const h = await setup();
  await withEnv(h.env, async () => {
    const results = await Promise.all(
      Array.from({ length: 40 }, (_, i) => post(h.login[i % 2], { body: loginBody(STUDENT_EMAIL) }))
    );
    const passed = results.filter((r) => r.statusCode !== 429).length;
    assert.equal(passed, 10, 'exactly the per-address-and-account limit got through');
    assert.equal(h.spy.calls.compare, 10, 'only those reached the password check');
  });
});

// ---------------------------------------------------------------------------
// Signup
// ---------------------------------------------------------------------------

const signupBody = (email, role = 'student') => ({ email, password: 'a-good-password', name: 'New Person', role });

test('signup: students and instructors still sign up as before', async () => {
  const h = await setup();
  await withEnv(h.env, async () => {
    const student = await post(h.signup[0], { body: signupBody('s1@example.com') });
    assert.equal(student.statusCode, 201);
    assert.equal(student.body.signedIn, true);
    assert.equal(student.body.token, undefined, 'no credential in the body');
    assert.ok(sessionFromResponse(student), 'an approved student is signed in by cookie');
    assert.equal(student.body.user.status, 'approved');
    const instructor = await post(h.signup[1], { body: signupBody('i1@example.com', 'instructor') });
    assert.equal(instructor.statusCode, 201);
    assert.equal(instructor.body.signedIn, false);
    assert.equal(setCookies(instructor).length, 0, 'a pending instructor gets no session');
    assert.equal(instructor.body.user.status, 'pending');
    assert.equal(h.db.sessions.length, 1);
  });
});

test('signup: Admin and Super Admin stay refused (H3) and are never created', async () => {
  const h = await setup();
  await withEnv(h.env, async () => {
    for (const role of ['admin', 'superadmin']) {
      const res = await post(h.signup[0], { body: signupBody(`${role}@example.com`, role) });
      assert.equal(res.statusCode, 400);
    }
    assert.equal(h.db.ops.userInserts, 0);
  });
});

test('signup: the per-address limit stops automated account creation before any hash or write', async () => {
  const h = await setup();
  await withEnv(h.env, async () => {
    for (let i = 0; i < 10; i += 1) {
      assert.equal((await post(h.signup[i % 2], { body: signupBody(`bulk${i}@example.com`) })).statusCode, 201);
    }
    const hashes = h.spy.calls.hash;
    const inserts = h.db.ops.userInserts;
    const finds = h.db.ops.userFinds;
    const refused = await post(h.signup[0], { body: signupBody('bulk-extra@example.com') });
    assert.equal(refused.statusCode, 429);
    assert.deepEqual(Object.keys(refused.body).sort(), RATE_BODY_KEYS);
    assert.equal(h.spy.calls.hash, hashes, 'no bcrypt hash');
    assert.equal(h.db.ops.userInserts, inserts, 'no insert');
    assert.equal(h.db.ops.userFinds, finds, 'no duplicate lookup');
    assert.equal((await post(h.signup[0], { ip: '198.51.100.50', body: signupBody('elsewhere@example.com') })).statusCode, 201);
  });
});

test('signup: repeated attempts on one email are limited across addresses, with the same refusal as login', async () => {
  const h = await setup();
  await withEnv(h.env, async () => {
    for (let i = 0; i < 5; i += 1) await post(h.signup[i % 2], { ip: `192.0.2.${i + 1}`, body: signupBody(' Taken@Example.com') });
    const refused = await post(h.signup[0], { ip: '192.0.2.99', body: signupBody('taken@example.com') });
    assert.equal(refused.statusCode, 429);
    for (let i = 0; i < 10; i += 1) await post(h.login[0], { ip: '192.0.2.150', body: loginBody(STUDENT_EMAIL) });
    const loginRefused = await post(h.login[0], { ip: '192.0.2.150', body: loginBody(STUDENT_EMAIL) });
    assert.equal(refused.body.error, loginRefused.body.error);
    assert.equal(refused.body.code, loginRefused.body.code);
  });
});

// ---------------------------------------------------------------------------
// Shared store, failure policy, keys
// ---------------------------------------------------------------------------

test('shared store: two instances share one count; with the store off each instance counts alone', async () => {
  const shared = await setup();
  await withEnv(shared.env, async () => {
    const outcomes = [];
    for (let i = 0; i < 12; i += 1) outcomes.push((await post(shared.login[i % 2], { body: loginBody(STUDENT_EMAIL) })).statusCode);
    assert.deepEqual(outcomes.filter((s) => s === 429).length, 2, '10 allowed in total across both instances');
    assert.ok(shared.db.limits.size > 0);
  });

  const local = await setup({ shared: false });
  await withEnv(local.env, async () => {
    const outcomes = [];
    for (let i = 0; i < 22; i += 1) outcomes.push((await post(local.login[i % 2], { body: loginBody(STUDENT_EMAIL) })).statusCode);
    assert.equal(outcomes.filter((s) => s !== 429).length, 20, 'per-process only: 10 per instance');
    assert.equal(local.db.limits.size, 0, 'nothing is written to the store when it is off');
    assert.equal(local.db.ops.limitUpserts, 0);
  });
});

test('shared store: windows expire and reset; expiry documents match the TTL index', async () => {
  const h = await setup();
  await withEnv(h.env, async ({ setNow }) => {
    for (let i = 0; i < 10; i += 1) await post(h.login[0], { body: loginBody(STUDENT_EMAIL) });
    assert.equal((await post(h.login[1], { body: loginBody(STUDENT_EMAIL) })).statusCode, 429);
    for (const doc of h.db.limits.values()) {
      assert.equal(doc.expiresAt.getTime(), T0 + WINDOW, 'each window expires at its end');
      assert.ok(['login-ip', 'login-email-ip', 'login-email'].includes(doc.scope));
    }
    // The TTL monitor deletes expired windows; the next window starts from zero either way.
    setNow(T0 + WINDOW + 1000);
    for (const [id, doc] of h.db.limits) if (doc.expiresAt.getTime() <= Date.now()) h.db.limits.delete(id);
    assert.equal(h.db.limits.size, 0);
    assert.equal((await post(h.login[1], { body: loginBody(STUDENT_EMAIL) })).statusCode, 401);
  });
  assert.deepEqual(RATE_LIMIT_TTL_INDEX.key, { expiresAt: 1 });
  assert.equal(RATE_LIMIT_TTL_INDEX.options.expireAfterSeconds, 0);
  assert.match(fs.readFileSync(path.join(ROOT, 'scripts/course-payment-indexes.js'), 'utf8'), /\[\.\.\.COURSE_PAYMENT_INDEXES, RATE_LIMIT_TTL_INDEX\]/);
});

test('shared store unavailable: login and signup refuse with 503 and touch nothing else', async () => {
  const h = await setup({ failRateLimits: true });
  await withEnv(h.env, async () => {
    const login = await post(h.login[0], { body: loginBody(STUDENT_EMAIL, PASSWORD) });
    const signup = await post(h.signup[0], { body: signupBody('new@example.com') });
    for (const res of [login, signup]) {
      assert.equal(res.statusCode, 503);
      assert.equal(res.body.code, 'rate_limit_unavailable');
      assert.equal(res.headers['retry-after'], undefined);
    }
    assert.equal(h.spy.calls.compare + h.spy.calls.hash, 0);
    assert.equal(h.db.ops.userFinds + h.db.ops.userInserts, 0);
  });
});

test('stored keys contain no email or address', async () => {
  const h = await setup();
  await withEnv(h.env, async () => {
    await post(h.login[0], { ip: '203.0.113.77', body: loginBody(STUDENT_EMAIL) });
    await post(h.signup[0], { ip: '203.0.113.77', body: signupBody('fresh.person@example.com') });
    const stored = JSON.stringify([...h.db.limits.values()]);
    for (const secret of ['learner', 'example.com', 'fresh.person', '203.0.113.77', '203.0.113']) {
      assert.equal(stored.includes(secret), false, secret);
    }
    for (const id of h.db.limits.keys()) assert.match(id, /^(login|signup)-[a-z-]+:[a-f0-9]{40}:\d+$/);
  });
});

test('an unknown client address skips the address rules instead of sharing one fallback key', async () => {
  const h = await setup();
  await withEnv({ ...h.env, TRUSTED_PROXY_HOPS: '0' }, async () => {
    // No header used and no socket address: no address at all.
    for (let i = 0; i < 40; i += 1) {
      const res = await post(h.login[0], { ip: null, socketIp: null, body: loginBody(`user${i}@example.com`) });
      assert.equal(res.statusCode, 401, 'different people are not grouped under one key');
    }
    for (let i = 0; i < 50; i += 1) await post(h.login[0], { ip: null, socketIp: null, body: loginBody(STUDENT_EMAIL) });
    assert.equal((await post(h.login[0], { ip: null, socketIp: null, body: loginBody(STUDENT_EMAIL) })).statusCode, 429, 'the account limit still applies');
  });
});

// ---------------------------------------------------------------------------
// Client address and in-process memory
// ---------------------------------------------------------------------------

test('client address: only proxy-appended X-Forwarded-For entries are trusted', () => {
  const req = (xff, remote = '10.0.0.5') => ({ headers: xff === undefined ? {} : { 'x-forwarded-for': xff }, socket: { remoteAddress: remote } });
  const one = {};
  assert.equal(clientIp.clientAddress(req('198.51.100.1'), one), '198.51.100.1');
  assert.equal(clientIp.clientAddress(req('1.2.3.4, 198.51.100.1'), one), '198.51.100.1', 'client-written entries are ignored');
  assert.equal(clientIp.clientAddress(req('1.2.3.4, 5.6.7.8, 198.51.100.1'), one), '198.51.100.1');
  assert.equal(clientIp.clientAddress(req('1.2.3.4, 198.51.100.1, 10.1.1.1'), { TRUSTED_PROXY_HOPS: '2' }), '198.51.100.1');
  assert.equal(clientIp.clientAddress(req('198.51.100.1'), { TRUSTED_PROXY_HOPS: '2' }), '10.0.0.5', 'too few entries: not trusted');
  assert.equal(clientIp.clientAddress(req('198.51.100.1'), { TRUSTED_PROXY_HOPS: '0' }), '10.0.0.5', 'header ignored');
  assert.equal(clientIp.clientAddress(req(undefined), one), '10.0.0.5');
  assert.equal(clientIp.clientAddress(req('not-an-ip'), one), '10.0.0.5', 'malformed: socket address');
  assert.equal(clientIp.clientAddress(req('not-an-ip', null), one), null);
  assert.equal(clientIp.clientAddress(req(['1.2.3.4', '198.51.100.9']), one), '198.51.100.9', 'repeated headers are joined in order');
  assert.equal(clientIp.clientAddress(req('198.51.100.1:443'), one), '198.51.100.1');
  assert.equal(clientIp.clientAddress(req(undefined, '::ffff:198.51.100.3'), one), '198.51.100.3');
  assert.equal(clientIp.clientAddress(req('[2001:db8:abcd:12::1]:8080'), one), '2001:db8:abcd:12::/64');
  assert.equal(clientIp.clientAddress(req('2001:db8:abcd:12:ffff:1:2:3'), one), '2001:db8:abcd:12::/64', 'one /64 is one client');
  assert.equal(clientIp.clientAddress(req('2001:db8::1'), one), '2001:db8:0:0::/64');
  for (const bad of ['-1', '9', 'two', '1.5']) assert.equal(clientIp.trustedHops({ TRUSTED_PROXY_HOPS: bad }), clientIp.DEFAULT_TRUSTED_HOPS);
  assert.equal(clientIp.trustedHops({}), 1);
});

test('in-process counts stay bounded however many distinct keys arrive', () => {
  const limiter = createRateLimiter({ windowMs: WINDOW, max: 3, maxKeys: 100 });
  for (let i = 0; i < 1000; i += 1) limiter.check(`key-${i}`, T0);
  assert.ok(limiter.size() <= 100, `size ${limiter.size()}`);
  assert.equal(authLimit.MAX_LOCAL_KEYS, 50000);
  // Without maxKeys the existing limiters behave as before.
  const unbounded = createRateLimiter({ windowMs: WINDOW, max: 2 });
  assert.deepEqual([1, 2, 3].map(() => unbounded.check('a', T0).allowed), [true, true, false]);
});

test('policies and route wiring', () => {
  assert.deepEqual(authLimit.LOGIN_RULES.map((r) => [r.id, r.max, [...r.parts]]), [
    ['login-ip', 30, ['ip']],
    ['login-email-ip', 10, ['email', 'ip']],
    ['login-email', 50, ['email']],
  ]);
  assert.deepEqual(authLimit.SIGNUP_RULES.map((r) => [r.id, r.max, [...r.parts]]), [
    ['signup-ip', 10, ['ip']],
    ['signup-email', 5, ['email']],
  ]);
  assert.equal(WINDOW, 10 * 60 * 1000);
  const login = fs.readFileSync(path.join(ROOT, 'pages/api/auth/login.ts'), 'utf8');
  const signup = fs.readFileSync(path.join(ROOT, 'pages/api/auth/signup.ts'), 'utf8');
  assert.ok(login.indexOf('loginLimiter.consume') < login.indexOf("users.findOne({ email: emailNorm })"));
  assert.ok(login.indexOf('loginLimiter.consume') < login.indexOf('bcrypt.compare'));
  assert.ok(signup.indexOf('signupLimiter.consume') < signup.indexOf('users.findOne({ email: emailNorm })'));
  assert.ok(signup.indexOf('signupLimiter.consume') < signup.indexOf('bcrypt.hash'));
  assert.ok(signup.indexOf('PUBLIC_SIGNUP_ROLES.includes(role)') < signup.indexOf('signupLimiter.consume'));
});
