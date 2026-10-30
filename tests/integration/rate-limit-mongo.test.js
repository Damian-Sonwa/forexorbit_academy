/**
 * R1 against a real MongoDB server (npm run test:mongo).
 *
 * Every test here talks to a real mongod through the official driver: index creation and
 * inspection, atomic counter updates, TTL deletion by MongoDB's own TTL monitor, connection
 * failures, the real login route, and separate Node processes sharing one count. Nothing is
 * mocked except where a test says so.
 *
 * Requires MONGODB_URI_TEST (an isolated server, never production) and uses the database named by
 * MONGODB_DB_NAME_TEST (default Forex_elearning_r1_test), which each test drops and rebuilds.
 * Skipped when MONGODB_URI_TEST is unset.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const ts = require('typescript');
const { spawn, spawnSync } = require('child_process');
const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');

const { openTestDatabase, testDatabaseConfig } = require('../helpers/mongo-test-db');
const { RATE_LIMIT_COLLECTION, RATE_LIMIT_TTL_INDEX, consumeSharedLimit } = require('../../lib/shared-rate-limit');
const { LOGIN_RULES, createAuthLimiter } = require('../../lib/auth-rate-limit');
const indexTool = require('../../scripts/rate-limit-index');

const ROOT = path.join(__dirname, '..', '..');
const config = testDatabaseConfig();
const skip = config.ok ? false : config.reason;
const WINDOW = 10 * 60 * 1000;
const quiet = () => {};

/** Fresh, empty test database for each test. */
async function fresh() {
  const conn = await openTestDatabase();
  await conn.reset();
  return conn;
}

async function allIndexes(db) {
  const out = {};
  for (const { name } of await db.listCollections({}, { nameOnly: true }).toArray()) {
    out[name] = (await db.collection(name).indexes()).map((ix) => JSON.stringify(ix)).sort();
  }
  return out;
}

// ---------------------------------------------------------------------------
// R1 index tool on real MongoDB
// ---------------------------------------------------------------------------

test('index tool: inspection is read-only, --apply creates exactly R1, repeating is a no-op', { skip }, async () => {
  const conn = await fresh();
  try {
    const inspected = await indexTool.run(conn.db, { mode: 'inspect', log: quiet });
    assert.deepEqual([inspected.ok, inspected.state, inspected.created], [true, 'missing', false]);
    assert.deepEqual(await conn.db.listCollections({}, { nameOnly: true }).toArray(), [], 'inspection created nothing');

    const applied = await indexTool.run(conn.db, { mode: 'apply', log: quiet });
    assert.deepEqual([applied.ok, applied.state, applied.created], [true, 'present', true]);
    const indexes = await conn.db.collection(RATE_LIMIT_COLLECTION).indexes();
    const ttl = indexes.find((ix) => ix.name === 'ttl_rate_limit_window');
    assert.deepEqual(ttl.key, { expiresAt: 1 });
    assert.equal(ttl.expireAfterSeconds, 0);
    assert.equal(ttl.unique, undefined);
    assert.deepEqual(indexes.map((ix) => ix.name).sort(), ['_id_', 'ttl_rate_limit_window']);

    const again = await indexTool.run(conn.db, { mode: 'apply', log: quiet });
    assert.deepEqual([again.ok, again.state, again.created], [true, 'present', false]);
    assert.equal((await conn.db.collection(RATE_LIMIT_COLLECTION).indexes()).length, 2, 'no duplicate index');
  } finally {
    await conn.reset();
    await conn.close();
  }
});

test('index tool: conflicting indexes are reported and left exactly as they are', { skip }, async () => {
  const conn = await fresh();
  try {
    const col = conn.db.collection(RATE_LIMIT_COLLECTION);
    // Same name, different TTL.
    await col.createIndex({ expiresAt: 1 }, { name: 'ttl_rate_limit_window', expireAfterSeconds: 60 });
    const before = await allIndexes(conn.db);
    const byName = await indexTool.run(conn.db, { mode: 'apply', log: quiet });
    assert.deepEqual([byName.ok, byName.state], [false, 'conflict']);
    assert.deepEqual(await allIndexes(conn.db), before, 'nothing changed or dropped');

    // Same key under another name, without TTL.
    await conn.reset();
    await conn.db.collection(RATE_LIMIT_COLLECTION).createIndex({ expiresAt: 1 }, { name: 'expires_lookup' });
    const before2 = await allIndexes(conn.db);
    const byKey = await indexTool.run(conn.db, { mode: 'apply', log: quiet });
    assert.deepEqual([byKey.ok, byKey.state], [false, 'conflict']);
    assert.deepEqual(await allIndexes(conn.db), before2);
  } finally {
    await conn.reset();
    await conn.close();
  }
});

test('index tool: payment, course and user indexes are never created or changed', { skip }, async () => {
  const conn = await fresh();
  try {
    // Synthetic collections standing in for the application's, with their own indexes.
    await conn.db.collection('paystackPayments').createIndex({ reference: 1 }, { name: 'existing_reference' });
    await conn.db.collection('courses').createIndex({ title: 1 }, { name: 'existing_title' });
    await conn.db.collection('users').createIndex({ email: 1 }, { name: 'existing_email', unique: true });
    await conn.db.collection('rateLimits').createIndex({ scope: 1 }, { name: 'existing_scope' });
    const before = await allIndexes(conn.db);

    assert.equal((await indexTool.run(conn.db, { mode: 'apply', log: quiet })).ok, true);
    const after = await allIndexes(conn.db);
    for (const name of ['paystackPayments', 'courses', 'users']) assert.deepEqual(after[name], before[name], name);
    assert.deepEqual(after.rateLimits.filter((ix) => !ix.includes('ttl_rate_limit_window')), before.rateLimits, 'other rateLimits indexes untouched');
    assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort(), 'no new collections (no payment indexes built)');
    for (const name of ['paystackPaymentIntents', 'coursePurchases', 'userCourseAccess', 'paymentExceptions']) {
      assert.equal(after[name], undefined, `${name} not created`);
    }
  } finally {
    await conn.reset();
    await conn.close();
  }
});

test('index tool CLI: inspect then apply against the test database, with no connection string printed', { skip }, async () => {
  const conn = await fresh();
  try {
    const env = { PATH: process.env.PATH, MONGO_URI: config.uri };
    const cli = (...extra) =>
      spawnSync(process.execPath, ['scripts/rate-limit-index.js', '--database', config.dbName, ...extra], { cwd: ROOT, env, encoding: 'utf8', timeout: 30000 });
    const inspect = cli();
    assert.equal(inspect.status, 0, inspect.stderr);
    assert.match(inspect.stdout, new RegExp(`database: ${config.dbName} \\| signed in as: .* \\| mode: inspect`));
    assert.match(inspect.stdout, /required: R1 ttl_rate_limit_window \{"expiresAt":1\} \{"name":"ttl_rate_limit_window","expireAfterSeconds":0\}/);
    assert.match(inspect.stdout, /state: missing/);
    assert.match(inspect.stdout, /Would create on rateLimits: ttl_rate_limit_window/);
    assert.equal((await conn.db.listCollections().toArray()).length, 0);

    const apply = cli('--apply');
    assert.equal(apply.status, 0, apply.stderr);
    assert.match(apply.stdout, /created and verified rateLimits\.ttl_rate_limit_window/);
    const repeat = cli('--apply');
    assert.match(repeat.stdout, /R1 is present with the expected definition\. Nothing to do\./);
    for (const out of [inspect, apply, repeat]) assert.equal(`${out.stdout}${out.stderr}`.includes(config.uri), false);
  } finally {
    await conn.reset();
    await conn.close();
  }
});

// ---------------------------------------------------------------------------
// Shared limiter on real MongoDB
// ---------------------------------------------------------------------------

test('limiter: 50 simultaneous updates on one window allow exactly the limit', { skip }, async () => {
  const conn = await fresh();
  try {
    const now = Date.now();
    const results = await Promise.all(
      Array.from({ length: 50 }, () => consumeSharedLimit(conn.db, { scope: 'r1-test', key: 'k1', windowMs: WINDOW, max: 10, now }))
    );
    assert.equal(results.filter((r) => r.allowed).length, 10);
    const docs = await conn.db.collection(RATE_LIMIT_COLLECTION).find().toArray();
    assert.equal(docs.length, 1, 'one document per window');
    assert.equal(docs[0].count, 50, 'every request was counted atomically');
    const windowStart = Math.floor(now / WINDOW) * WINDOW;
    assert.equal(docs[0]._id, `r1-test:k1:${windowStart}`);
    assert.equal(docs[0].expiresAt.getTime(), windowStart + WINDOW);
  } finally {
    await conn.reset();
    await conn.close();
  }
});

test('limiter: keys and windows are separate, and an old window stops counting before it is deleted', { skip }, async () => {
  const conn = await fresh();
  try {
    // No TTL index here, so old windows stay on disk: they must still not count.
    const t0 = Math.floor(Date.now() / WINDOW) * WINDOW - 3 * WINDOW;
    for (let i = 0; i < 3; i += 1) await consumeSharedLimit(conn.db, { scope: 's', key: 'a', windowMs: WINDOW, max: 3, now: t0 + i });
    assert.equal((await consumeSharedLimit(conn.db, { scope: 's', key: 'a', windowMs: WINDOW, max: 3, now: t0 + 10 })).allowed, false);
    assert.equal((await consumeSharedLimit(conn.db, { scope: 's', key: 'b', windowMs: WINDOW, max: 3, now: t0 + 10 })).allowed, true, 'other key');
    assert.equal((await consumeSharedLimit(conn.db, { scope: 'other', key: 'a', windowMs: WINDOW, max: 3, now: t0 + 10 })).allowed, true, 'other scope');
    assert.equal((await consumeSharedLimit(conn.db, { scope: 's', key: 'a', windowMs: WINDOW, max: 3, now: t0 + WINDOW })).allowed, true, 'next window');
    const old = await conn.db.collection(RATE_LIMIT_COLLECTION).findOne({ _id: `s:a:${t0}` });
    assert.ok(old, 'the expired window is still stored');
    assert.ok(old.expiresAt.getTime() < Date.now());
  } finally {
    await conn.reset();
    await conn.close();
  }
});

test('limiter: MongoDB\'s TTL monitor deletes finished windows once R1 exists', { skip, timeout: 120000 }, async () => {
  const conn = await fresh();
  try {
    assert.equal((await indexTool.run(conn.db, { mode: 'apply', log: quiet })).ok, true);
    const past = Date.now() - 3 * WINDOW;
    await consumeSharedLimit(conn.db, { scope: 'ttl', key: 'gone', windowMs: WINDOW, max: 5, now: past });
    await consumeSharedLimit(conn.db, { scope: 'ttl', key: 'kept', windowMs: WINDOW, max: 5, now: Date.now() });
    const col = conn.db.collection(RATE_LIMIT_COLLECTION);
    assert.equal(await col.countDocuments(), 2);
    // The TTL monitor runs every 60 s by default (every second on the local test server).
    const deadline = Date.now() + 100000;
    while ((await col.countDocuments({ scope: 'ttl', expiresAt: { $lte: new Date() } })) > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    assert.equal(await col.countDocuments({ _id: { $regex: '^ttl:gone:' } }), 0, 'expired window deleted by MongoDB');
    assert.equal(await col.countDocuments({ _id: { $regex: '^ttl:kept:' } }), 1, 'current window kept');
  } finally {
    await conn.reset();
    await conn.close();
  }
});

test('limiter: an unreachable MongoDB refuses (503) instead of falling back to memory', { skip }, async () => {
  const client = new MongoClient('mongodb://127.0.0.1:1', { serverSelectionTimeoutMS: 400 });
  const deadDb = client.db('unreachable_test');
  try {
    await assert.rejects(consumeSharedLimit(deadDb, { scope: 's', key: 'k', windowMs: WINDOW, max: 5 }));
    const limiter = createAuthLimiter(LOGIN_RULES);
    const decision = await limiter.consume({
      ip: '203.0.113.5',
      email: 'someone@example.com',
      getDb: async () => deadDb,
      env: { SHARED_RATE_LIMIT: 'mongodb', JWT_SECRET: 'test-only-r1-secret' },
    });
    assert.deepEqual(decision, { allowed: false, status: 503 });
  } finally {
    await client.close();
  }
});

test('limiter: with SHARED_RATE_LIMIT=mongodb every rule is written to MongoDB; with it off nothing is', { skip }, async () => {
  const conn = await fresh();
  try {
    const getDb = async () => conn.db;
    const on = createAuthLimiter(LOGIN_RULES);
    await on.consume({ ip: '203.0.113.6', email: 'a@example.com', getDb, env: { SHARED_RATE_LIMIT: 'mongodb', JWT_SECRET: 's' } });
    const scopes = (await conn.db.collection(RATE_LIMIT_COLLECTION).find().toArray()).map((d) => d.scope).sort();
    assert.deepEqual(scopes, ['login-email', 'login-email-ip', 'login-ip']);
    await conn.reset();
    const off = createAuthLimiter(LOGIN_RULES);
    await off.consume({ ip: '203.0.113.6', email: 'a@example.com', getDb, env: { JWT_SECRET: 's' } });
    assert.equal((await conn.db.listCollections({ name: RATE_LIMIT_COLLECTION }).toArray()).length, 0);
  } finally {
    await conn.reset();
    await conn.close();
  }
});

// ---------------------------------------------------------------------------
// Real login route on real MongoDB
// ---------------------------------------------------------------------------

function loadRoute(route, db) {
  const stub = { getDb: async () => db };
  const cache = new Map();
  const load = (filename) => {
    if (cache.has(filename)) return cache.get(filename).exports;
    const source = fs.readFileSync(filename, 'utf8');
    const code = /\.tsx?$/.test(filename)
      ? ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText
      : source;
    const mod = new Module(filename);
    mod.filename = filename;
    mod.paths = Module._nodeModulePaths(path.dirname(filename));
    cache.set(filename, mod);
    mod.require = (id) => {
      const base = id.startsWith('@/') ? path.join(ROOT, id.slice(2)) : id.startsWith('.') ? path.join(path.dirname(filename), id) : null;
      if (!base) return require(id);
      const bare = base.replace(/\.(ts|js)$/, '');
      if (bare === path.join(ROOT, 'lib/mongodb')) return stub;
      for (const ext of ['.ts', '.tsx', '.js']) if (fs.existsSync(bare + ext)) return load(bare + ext);
      return require(base);
    };
    mod._compile(code, filename);
    return mod.exports;
  };
  return load(path.join(ROOT, route)).default;
}

async function post(handler, body, ip) {
  const res = {
    statusCode: 200,
    headers: {},
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    getHeader(k) { return this.headers[k.toLowerCase()]; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  await handler({ method: 'POST', headers: { 'x-forwarded-for': ip }, body, query: {}, socket: { remoteAddress: '10.0.0.2' } }, res);
  return res;
}

test('login route on real MongoDB: the 11th attempt is refused and the counts live in rateLimits', { skip }, async () => {
  const conn = await fresh();
  const saved = { JWT_SECRET: process.env.JWT_SECRET, SHARED_RATE_LIMIT: process.env.SHARED_RATE_LIMIT };
  process.env.JWT_SECRET = 'test-only-r1-secret';
  process.env.SHARED_RATE_LIMIT = 'mongodb';
  try {
    await indexTool.run(conn.db, { mode: 'apply', log: quiet });
    await conn.db.collection('users').insertOne({
      _id: new ObjectId(),
      email: 'synthetic.learner@example.com',
      password: await bcrypt.hash('correct-password', 4),
      name: 'Synthetic Learner',
      role: 'student',
      status: 'approved',
    });
    // Two route instances (separate module copies) on one database.
    const [a, b] = [loadRoute('pages/api/auth/login.ts', conn.db), loadRoute('pages/api/auth/login.ts', conn.db)];
    const statuses = [];
    for (let i = 0; i < 11; i += 1) statuses.push((await post(i % 2 ? b : a, { email: 'synthetic.learner@example.com', password: 'wrong' }, '203.0.113.40')).statusCode);
    assert.deepEqual(statuses, [...Array(10).fill(401), 429]);
    const docs = await conn.db.collection(RATE_LIMIT_COLLECTION).find().toArray();
    assert.ok(docs.some((d) => d.scope === 'login-email-ip' && d.count === 11));
    assert.equal(JSON.stringify(docs).includes('synthetic.learner'), false, 'no raw email stored');
    const ok = await post(a, { email: 'synthetic.learner@example.com', password: 'correct-password' }, '198.51.100.40');
    assert.equal(ok.statusCode, 200, 'another address can still sign in');
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await conn.reset();
    await conn.close();
  }
});

// ---------------------------------------------------------------------------
// Separate processes sharing one count
// ---------------------------------------------------------------------------

function runWorker(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, 'workers', 'limiter-worker.js')], {
      cwd: ROOT,
      env: { PATH: process.env.PATH, MONGODB_URI_TEST: config.uri, MONGODB_DB_NAME_TEST: config.dbName, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { err += chunk; });
    child.on('error', reject);
    child.on('exit', (code) => {
      try {
        const result = JSON.parse(out.trim().split('\n').pop());
        if (code !== 0 || result.error) reject(new Error(result.error || err || `exit ${code}`));
        else resolve(result);
      } catch {
        reject(new Error(err || `no output, exit ${code}`));
      }
    });
  });
}

test('separate processes: four instances at once allow exactly 10 attempts for one account and address', { skip, timeout: 60000 }, async () => {
  const conn = await fresh();
  try {
    const now = String(Date.now());
    const shared = { WORKER_EMAIL: 'shared.account@example.com', WORKER_IP: '203.0.113.77', WORKER_NOW: now, WORKER_ATTEMPTS: '8' };
    const results = await Promise.all([runWorker(shared), runWorker(shared), runWorker(shared), runWorker(shared)]);
    assert.equal(new Set(results.map((r) => r.pid)).size, 4, 'four different processes');
    assert.equal(results.reduce((n, r) => n + r.allowed, 0), 10, 'login-email-ip limit holds across processes');
    assert.ok(results.every((r) => r.allowed <= 8), 'no process was allowed more than it asked for');
    const doc = await conn.db.collection(RATE_LIMIT_COLLECTION).findOne({ scope: 'login-email-ip' });
    assert.equal(doc.count, 32, 'every process counted in the same document');
  } finally {
    await conn.reset();
    await conn.close();
  }
});

test('separate processes: a restarted instance continues the shared count', { skip, timeout: 60000 }, async () => {
  const conn = await fresh();
  try {
    const now = String(Date.now());
    const base = { WORKER_EMAIL: 'restart.check@example.com', WORKER_IP: '203.0.113.88', WORKER_NOW: now };
    const first = await runWorker({ ...base, WORKER_ATTEMPTS: '6' });
    assert.equal(first.allowed, 6);
    // The first process has exited; a new one starts with empty in-process counts.
    const second = await runWorker({ ...base, WORKER_ATTEMPTS: '10' });
    assert.notEqual(second.pid, first.pid);
    assert.equal(second.allowed, 4, 'only the remainder of the shared limit');
    assert.deepEqual(second.statuses.filter((s) => s !== 200), Array(6).fill(429));
  } finally {
    await conn.reset();
    await conn.close();
  }
});
