/**
 * H2: password reset (forgot-password, verify-password-otp, reset-password).
 *
 * The real route handlers run against an in-memory database. Every database operation yields to
 * the event loop first and then applies atomically, as MongoDB does for one document, so
 * simultaneous requests interleave between operations the way real requests can. This is a
 * mocked store: it shows the routes' logic is safe under that interleaving; it does not run
 * MongoDB itself (see docs/audits/password-reset-h2.md). SMS is a recording stub.
 */

const test = require('node:test');
const { mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const ts = require('typescript');
const realBcrypt = require('bcryptjs');
const { ObjectId } = require('mongodb');

const { RATE_LIMIT_COLLECTION } = require('../lib/shared-rate-limit');
const authLimit = require('../lib/auth-rate-limit');

const ROOT = path.join(__dirname, '..');
const T0 = Date.UTC(2026, 9, 30, 12, 0, 0);
const MAX_ATTEMPTS = 3;
const PHONE_A = '+2348031234567';
const PHONE_B = '+2348051234567';
const UNKNOWN_PHONE = '+2348091234567';

// ---------------------------------------------------------------------------
// In-memory MongoDB stand-in
// ---------------------------------------------------------------------------

const tick = () => new Promise((resolve) => setImmediate(resolve));
const cmp = (v) => (v instanceof Date ? v.getTime() : v);
const same = (a, b) => (a instanceof ObjectId || b instanceof ObjectId ? String(a) === String(b) : cmp(a) === cmp(b));

function matches(doc, filter) {
  return Object.entries(filter).every(([key, cond]) => {
    if (key === '$or') return cond.some((sub) => matches(doc, sub));
    const value = doc[key];
    if (cond && typeof cond === 'object' && !(cond instanceof Date) && !(cond instanceof ObjectId) && Object.keys(cond).some((k) => k.startsWith('$'))) {
      return Object.entries(cond).every(([op, arg]) => {
        if (op === '$type') return arg === 'string' ? typeof value === 'string' : false;
        if (op === '$gt') return value != null && cmp(value) > cmp(arg);
        if (op === '$gte') return value != null && cmp(value) >= cmp(arg);
        if (op === '$lt') return value != null && cmp(value) < cmp(arg);
        if (op === '$lte') return value != null && cmp(value) <= cmp(arg);
        if (op === '$ne') return !same(value, arg);
        throw new Error(`unsupported operator ${op}`);
      });
    }
    return same(value, cond);
  });
}

function applyUpdate(doc, update) {
  Object.assign(doc, update.$set || {});
  for (const [k, n] of Object.entries(update.$inc || {})) doc[k] = (doc[k] || 0) + n;
}

function memoryDb(options = {}) {
  const data = { users: [], passwordPhoneResets: [], passwordResetSecurityLogs: [], [RATE_LIMIT_COLLECTION]: [] };
  const fail = options.fail || {};
  const db = {
    data,
    collection(name) {
      data[name] = data[name] || [];
      const rows = data[name];
      const check = async (op) => {
        await tick();
        if (fail[`${name}.${op}`]) throw new Error(`${name}.${op} failed`);
      };
      const pick = (filter, sort) => {
        let found = rows.filter((row) => matches(row, filter));
        if (sort && sort.createdAt === -1) found = found.sort((a, b) => cmp(b.createdAt) - cmp(a.createdAt));
        return found[0];
      };
      return {
        async findOne(filter, opts = {}) {
          await check('findOne');
          const doc = pick(filter, opts.sort);
          return doc ? { ...doc } : null;
        },
        async insertOne(doc) {
          await check('insertOne');
          const row = { _id: new ObjectId(), ...doc };
          rows.push(row);
          return { insertedId: row._id };
        },
        async updateOne(filter, update) {
          await check('updateOne');
          const doc = pick(filter);
          if (!doc) return { matchedCount: 0, modifiedCount: 0 };
          applyUpdate(doc, update);
          return { matchedCount: 1, modifiedCount: 1 };
        },
        async findOneAndUpdate(filter, update, opts = {}) {
          await check('findOneAndUpdate');
          if (name === RATE_LIMIT_COLLECTION) {
            let doc = rows.find((row) => row._id === filter._id);
            if (!doc) {
              doc = { _id: filter._id, count: 0, ...update.$setOnInsert };
              rows.push(doc);
            }
            doc.count += update.$inc.count;
            return { ...doc };
          }
          const doc = pick(filter, opts.sort);
          if (!doc) return null;
          applyUpdate(doc, update);
          return { ...doc };
        },
        async findOneAndDelete(filter) {
          await check('findOneAndDelete');
          const index = rows.findIndex((row) => matches(row, filter));
          if (index < 0) return null;
          return { ...rows.splice(index, 1)[0] };
        },
        async deleteOne(filter) {
          await check('deleteOne');
          const index = rows.findIndex((row) => matches(row, filter));
          if (index >= 0) rows.splice(index, 1);
          return { deletedCount: index >= 0 ? 1 : 0 };
        },
        async deleteMany(filter) {
          await check('deleteMany');
          const keep = rows.filter((row) => !matches(row, filter));
          const deletedCount = rows.length - keep.length;
          rows.splice(0, rows.length, ...keep);
          return { deletedCount };
        },
        async countDocuments(filter) {
          await check('countDocuments');
          return rows.filter((row) => matches(row, filter)).length;
        },
      };
    },
  };
  return db;
}

// ---------------------------------------------------------------------------
// Routes, SMS and bcrypt
// ---------------------------------------------------------------------------

function harness({ fail, smsConfigured = true, smsFails = false } = {}) {
  const db = memoryDb({ fail });
  const sms = { sent: [] };
  const otpHashes = new Set();
  const calls = { otpCompares: 0, compares: 0, hashes: 0 };
  const bcrypt = {
    ...realBcrypt,
    hashSync: (value, rounds) => realBcrypt.hashSync(value, Math.min(rounds, 4)),
    hash: async (value, rounds) => {
      calls.hashes += 1;
      const hash = await realBcrypt.hash(value, Math.min(rounds, 4));
      if (/^\d{6}$/.test(value)) otpHashes.add(hash);
      return hash;
    },
    compare: async (value, hash) => {
      calls.compares += 1;
      if (otpHashes.has(hash)) calls.otpCompares += 1;
      await tick();
      return realBcrypt.compare(value, hash);
    },
  };
  const stubs = {
    [path.join(ROOT, 'lib/mongodb')]: { getDb: async () => db },
    [path.join(ROOT, 'lib/sms')]: {
      isSmsConfigured: () => smsConfigured,
      sendPasswordResetOtpSms: async (to, otp) => {
        if (smsFails) throw new Error('provider said no to +2348031234567');
        sms.sent.push({ to, otp });
      },
    },
  };
  const load = (route) => {
    const cache = new Map();
    const loadFile = (filename) => {
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
        if (id === 'bcryptjs') return bcrypt;
        const base = id.startsWith('@/') ? path.join(ROOT, id.slice(2)) : id.startsWith('.') ? path.join(path.dirname(filename), id) : null;
        if (!base) return require(id);
        const bare = base.replace(/\.(ts|js)$/, '');
        if (stubs[bare]) return stubs[bare];
        for (const ext of ['.ts', '.tsx', '.js']) if (fs.existsSync(bare + ext)) return loadFile(bare + ext);
        return require(base);
      };
      mod._compile(code, filename);
      return mod.exports;
    };
    return loadFile(path.join(ROOT, route)).default;
  };
  return {
    db,
    sms,
    calls,
    forgot: load('pages/api/auth/forgot-password.ts'),
    verify: load('pages/api/auth/verify-password-otp.ts'),
    reset: load('pages/api/auth/reset-password.ts'),
    resetsFor: (userId) => db.data.passwordPhoneResets.filter((r) => String(r.userId) === String(userId)),
  };
}

async function call(handler, body, { ip = '203.0.113.10', headers = {} } = {}) {
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
  if (ip && !('x-forwarded-for' in reqHeaders)) reqHeaders['x-forwarded-for'] = ip;
  await handler({ method: 'POST', headers: reqHeaders, body, query: {}, socket: { remoteAddress: '10.0.0.2' } }, res);
  return res;
}

const ENV = { JWT_SECRET: 'test-only-h2-secret', SHARED_RATE_LIMIT: 'mongodb', TRUSTED_PROXY_HOPS: undefined };

async function withEnv(fn, env = ENV) {
  const saved = {};
  for (const key of Object.keys(env)) {
    saved[key] = process.env[key];
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
  // Both Date.now() and new Date() follow the test clock; timers are left real.
  let now = T0;
  mock.timers.enable({ apis: ['Date'], now });
  try {
    return await fn({ advance: (ms) => { now += ms; mock.timers.setTime(now); } });
  } finally {
    mock.timers.reset();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function addUser(h, phoneE164, extra = {}) {
  const user = {
    _id: new ObjectId(),
    email: `${phoneE164.slice(-4)}@example.com`,
    password: await realBcrypt.hash('old-password', 4),
    name: 'Reset User',
    role: 'student',
    status: 'approved',
    phoneE164,
    sessionGeneration: 4,
    ...extra,
  };
  h.db.data.users.push(user);
  return user;
}

/** Requests a code through the real route and returns it from the SMS stub. */
async function requestCode(h, phone, opts) {
  const before = h.sms.sent.length;
  const res = await call(h.forgot, { phone }, opts);
  assert.equal(res.statusCode, 200);
  return h.sms.sent.length > before ? h.sms.sent[h.sms.sent.length - 1].otp : null;
}

const wrongCode = (otp) => String((Number(otp) + 1) % 1000000).padStart(6, '0');
const GENERIC_FORGOT = { message: 'If an account exists for that number, a verification code was sent.' };
const INVALID_CODE = { error: 'Invalid or expired code. Check the SMS or request a new code.' };

// ---------------------------------------------------------------------------
// OTP attempts under concurrency
// ---------------------------------------------------------------------------

test('30 simultaneous wrong codes: exactly 3 reach the code comparison, then the code is dead', async () => {
  await withEnv(async ({ advance }) => {
    const h = harness();
    const user = await addUser(h, PHONE_A);
    const otp = await requestCode(h, PHONE_A);
    const results = await Promise.all(
      Array.from({ length: 30 }, (_, i) => call(h.verify, { phone: PHONE_A, otp: wrongCode(otp) }, { ip: `198.51.100.${i + 1}` }))
    );
    assert.equal(h.calls.otpCompares, MAX_ATTEMPTS, 'comparisons against the real code');
    assert.ok(results.every((r) => r.statusCode === 400 || r.statusCode === 429));
    for (const r of results.filter((x) => x.statusCode === 400)) assert.deepEqual(r.body, INVALID_CODE);
    const [record] = h.resetsFor(user._id);
    assert.equal(record.otpAttempts, MAX_ATTEMPTS, 'every attempt is used up');
    assert.equal(typeof record.otpHash, 'string', 'left in place but can no longer be reserved');
    advance(authLimit.WINDOW_MS);
    const late = await call(h.verify, { phone: PHONE_A, otp }, { ip: '198.51.100.200' });
    assert.deepEqual([late.statusCode, late.body], [400, INVALID_CODE], 'the right code no longer works');
  });
});

test('10 simultaneous correct codes: exactly one ticket is issued and it works', async () => {
  await withEnv(async () => {
    const h = harness();
    const user = await addUser(h, PHONE_A);
    const otp = await requestCode(h, PHONE_A);
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => call(h.verify, { phone: PHONE_A, otp }, { ip: `192.0.2.${i + 1}` })));
    const winners = results.filter((r) => r.statusCode === 200);
    for (const r of results.filter((x) => x.statusCode !== 200)) assert.deepEqual(r.body, INVALID_CODE);
    assert.equal(winners.length, 1);
    assert.ok(h.calls.otpCompares <= MAX_ATTEMPTS);
    const done = await call(h.reset, { resetTicket: winners[0].body.resetTicket, resetSecret: winners[0].body.resetSecret, password: 'new-password-1' });
    assert.equal(done.statusCode, 200);
    assert.equal(h.resetsFor(user._id).length, 0);
  });
});

test('a correct attempt still in progress is not cancelled by simultaneous wrong guesses', async () => {
  await withEnv(async () => {
    const h = harness();
    await addUser(h, PHONE_A);
    const otp = await requestCode(h, PHONE_A);
    // The owner's correct attempt starts first; an attacker's guesses arrive while it is running.
    const results = await Promise.all([
      call(h.verify, { phone: PHONE_A, otp }, { ip: '192.0.2.1' }),
      ...Array.from({ length: 8 }, (_, i) => call(h.verify, { phone: PHONE_A, otp: wrongCode(otp) }, { ip: `198.51.100.${i + 1}` })),
    ]);
    assert.equal(results[0].statusCode, 200);
    assert.equal(h.calls.otpCompares, MAX_ATTEMPTS);
  });
});

test('the attempt boundary: the third attempt can still succeed, a fourth never runs', async () => {
  await withEnv(async () => {
    const h = harness();
    await addUser(h, PHONE_A);
    const otp = await requestCode(h, PHONE_A);
    for (let i = 0; i < 2; i += 1) assert.equal((await call(h.verify, { phone: PHONE_A, otp: wrongCode(otp) })).statusCode, 400);
    assert.equal((await call(h.verify, { phone: PHONE_A, otp })).statusCode, 200);

    const h2 = harness();
    await addUser(h2, PHONE_A);
    const otp2 = await requestCode(h2, PHONE_A);
    for (let i = 0; i < 3; i += 1) await call(h2.verify, { phone: PHONE_A, otp: wrongCode(otp2) });
    const compares = h2.calls.otpCompares;
    assert.deepEqual((await call(h2.verify, { phone: PHONE_A, otp: otp2 })).body, INVALID_CODE);
    assert.equal(h2.calls.otpCompares, compares, 'no comparison after the maximum');
  });
});

test('a verified code cannot be used again', async () => {
  await withEnv(async () => {
    const h = harness();
    await addUser(h, PHONE_A);
    const otp = await requestCode(h, PHONE_A);
    assert.equal((await call(h.verify, { phone: PHONE_A, otp })).statusCode, 200);
    assert.deepEqual((await call(h.verify, { phone: PHONE_A, otp })).body, INVALID_CODE);
  });
});

test('an expired code is never compared or accepted, and failures do not extend it', async () => {
  await withEnv(async () => {
    const h = harness();
    const user = await addUser(h, PHONE_A);
    const otp = await requestCode(h, PHONE_A);
    const [record] = h.resetsFor(user._id);
    const expiry = record.otpExpiresAt;
    await call(h.verify, { phone: PHONE_A, otp: wrongCode(otp) });
    assert.equal(h.resetsFor(user._id)[0].otpExpiresAt, expiry, 'a failed attempt does not move the expiry');
    record.otpExpiresAt = new Date(Date.UTC(2020, 0, 1));
    const before = h.calls.otpCompares;
    assert.deepEqual((await call(h.verify, { phone: PHONE_A, otp })).body, INVALID_CODE);
    assert.equal(h.calls.otpCompares, before);
    assert.equal(h.resetsFor(user._id).length, 0, 'the expired code is removed');
  });
});

test('a new code replaces the old one, and two accounts keep separate attempt counts', async () => {
  await withEnv(async ({ advance }) => {
    const h = harness();
    const a = await addUser(h, PHONE_A);
    const b = await addUser(h, PHONE_B);
    const first = await requestCode(h, PHONE_A);
    advance(61 * 1000);
    const second = await requestCode(h, PHONE_A, { ip: '198.51.100.9' });
    assert.notEqual(first, second);
    assert.equal(h.resetsFor(a._id).length, 1, 'one live code per account');
    if (first !== second) assert.deepEqual((await call(h.verify, { phone: PHONE_A, otp: first })).body, INVALID_CODE, 'the old code is dead');

    const otpB = await requestCode(h, PHONE_B, { ip: '198.51.100.11' });
    await Promise.all(Array.from({ length: 10 }, (_, i) => call(h.verify, { phone: PHONE_A, otp: wrongCode(second) }, { ip: `192.0.2.${50 + i}` })));
    assert.equal((await call(h.verify, { phone: PHONE_B, otp: otpB }, { ip: '192.0.2.99' })).statusCode, 200, 'B is unaffected by guesses on A');
    assert.equal(h.resetsFor(b._id).length, 1);
  });
});

test('simultaneous verification against two different codes is independent', async () => {
  await withEnv(async () => {
    const h = harness();
    await addUser(h, PHONE_A);
    await addUser(h, PHONE_B);
    const otpA = await requestCode(h, PHONE_A, { ip: '198.51.100.1' });
    const otpB = await requestCode(h, PHONE_B, { ip: '198.51.100.2' });
    const [ra, rb] = await Promise.all([
      call(h.verify, { phone: PHONE_A, otp: otpA }, { ip: '192.0.2.1' }),
      call(h.verify, { phone: PHONE_B, otp: otpB }, { ip: '192.0.2.2' }),
    ]);
    assert.equal(ra.statusCode, 200);
    assert.equal(rb.statusCode, 200);
    assert.notEqual(ra.body.resetTicket, rb.body.resetTicket);
  });
});

// ---------------------------------------------------------------------------
// Forgot password
// ---------------------------------------------------------------------------

test('forgot: known and unknown numbers get the same response; only a known one gets an SMS', async () => {
  await withEnv(async () => {
    const h = harness();
    await addUser(h, PHONE_A);
    const known = await call(h.forgot, { phone: PHONE_A });
    const unknown = await call(h.forgot, { phone: UNKNOWN_PHONE }, { ip: '198.51.100.3' });
    assert.deepEqual([known.statusCode, known.body], [200, GENERIC_FORGOT]);
    assert.deepEqual([unknown.statusCode, unknown.body], [200, GENERIC_FORGOT]);
    assert.equal(h.sms.sent.length, 1);
    assert.equal(h.sms.sent[0].to, PHONE_A);
  });
});

test('forgot: the per-address limit refuses the 11th request without a lookup or SMS', async () => {
  await withEnv(async () => {
    const h = harness();
    await addUser(h, PHONE_A);
    for (let i = 0; i < 10; i += 1) await call(h.forgot, { phone: `+23480312345${String(10 + i)}` });
    const sent = h.sms.sent.length;
    const refused = await call(h.forgot, { phone: PHONE_A });
    assert.equal(refused.statusCode, 429);
    assert.equal(refused.body.code, 'rate_limited');
    assert.ok(Number(refused.headers['retry-after']) > 0);
    assert.equal(h.sms.sent.length, sent, 'no SMS when limited');
  });
});

test('forgot: one number is limited to 5 requests per window from any address', async () => {
  await withEnv(async ({ advance }) => {
    const h = harness();
    await addUser(h, PHONE_A);
    for (let i = 0; i < 5; i += 1) {
      assert.equal((await call(h.forgot, { phone: PHONE_A }, { ip: `192.0.2.${i + 1}` })).statusCode, 200);
      advance(61 * 1000);
    }
    assert.equal(h.sms.sent.length, 5);
    const refused = await call(h.forgot, { phone: PHONE_A }, { ip: '192.0.2.77' });
    assert.equal(refused.statusCode, 429);
    // The same refusal for a number with no account.
    const h2 = harness();
    for (let i = 0; i < 5; i += 1) {
      await call(h2.forgot, { phone: UNKNOWN_PHONE }, { ip: `192.0.2.${i + 1}` });
      advance(61 * 1000);
    }
    const refusedUnknown = await call(h2.forgot, { phone: UNKNOWN_PHONE }, { ip: '192.0.2.77' });
    assert.deepEqual([refusedUnknown.statusCode, refusedUnknown.body.code], [429, 'rate_limited']);
  });
});

test('forgot: simultaneous requests for one number send one SMS and leave one live code', async () => {
  await withEnv(async () => {
    const h = harness();
    const user = await addUser(h, PHONE_A);
    const results = await Promise.all(Array.from({ length: 5 }, (_, i) => call(h.forgot, { phone: PHONE_A }, { ip: `192.0.2.${i + 1}` })));
    assert.ok(results.every((r) => r.statusCode === 200 && r.body.message === GENERIC_FORGOT.message));
    assert.equal(h.sms.sent.length, 1);
    assert.equal(h.resetsFor(user._id).length, 1);
  });
});

test('forgot: the existing hourly cap and minute cooldown still apply', async () => {
  await withEnv(async ({ advance }) => {
    const h = harness();
    await addUser(h, PHONE_A);
    for (let i = 0; i < 5; i += 1) {
      await call(h.forgot, { phone: PHONE_A }, { ip: `192.0.2.${i + 1}` });
      advance(3 * 60 * 1000);
    }
    assert.equal(h.sms.sent.length, 5);
    advance(5 * 60 * 1000);
    const sixth = await call(h.forgot, { phone: PHONE_A }, { ip: '192.0.2.50' });
    assert.deepEqual([sixth.statusCode, sixth.body], [200, GENERIC_FORGOT]);
    assert.equal(h.sms.sent.length, 5, 'hourly cap: no sixth SMS within the hour');

    const h2 = harness();
    await addUser(h2, PHONE_A);
    await call(h2.forgot, { phone: PHONE_A });
    advance(30 * 1000);
    const soon = await call(h2.forgot, { phone: PHONE_A }, { ip: '192.0.2.60' });
    assert.deepEqual([soon.statusCode, soon.body], [200, GENERIC_FORGOT]);
    assert.equal(h2.sms.sent.length, 1, 'cooldown: no second SMS within a minute');
    const source = fs.readFileSync(path.join(ROOT, 'pages/api/auth/forgot-password.ts'), 'utf8');
    assert.match(source, /sentLastHour >= MAX_SMS_REQUESTS_PER_HOUR/);
    assert.match(source, /Date\.now\(\) - lastSent\.createdAt\.getTime\(\) < SMS_COOLDOWN_MS/);
  });
});

test('forgot: the service-wide cap bounds SMS requests across many numbers', async () => {
  await withEnv(async () => {
    const h = harness();
    const cap = authLimit.RESET_REQUEST_RULES.find((r) => r.id === 'reset-request-global').max;
    let ok = 0;
    for (let i = 0; i < cap; i += 1) {
      const res = await call(h.forgot, { phone: `+23480${String(30000000 + i)}` }, { ip: `10.${Math.floor(i / 250)}.${i % 250}.1` });
      if (res.statusCode === 200) ok += 1;
    }
    assert.equal(ok, cap);
    const refused = await call(h.forgot, { phone: '+2348099999999' }, { ip: '172.16.0.1' });
    assert.equal(refused.statusCode, 429);
  });
});

test('forgot: SMS failures and missing SMS setup give the generic response and store no code', async () => {
  await withEnv(async () => {
    for (const options of [{ smsFails: true }, { smsConfigured: false }]) {
      const h = harness(options);
      const user = await addUser(h, PHONE_A);
      const res = await call(h.forgot, { phone: PHONE_A });
      assert.deepEqual([res.statusCode, res.body], [200, GENERIC_FORGOT]);
      assert.equal(h.resetsFor(user._id).length, 0);
      assert.equal(JSON.stringify(h.db.data.passwordResetSecurityLogs).includes('8031234567'), false, 'no raw number in logs');
    }
  });
});

// ---------------------------------------------------------------------------
// Verify
// ---------------------------------------------------------------------------

test('verify: unknown number, no code, wrong code and expired code all look the same', async () => {
  await withEnv(async () => {
    const h = harness();
    const user = await addUser(h, PHONE_A);
    await addUser(h, PHONE_B);
    const otp = await requestCode(h, PHONE_A);
    const unknown = await call(h.verify, { phone: UNKNOWN_PHONE, otp: '123456' }, { ip: '192.0.2.1' });
    const noCode = await call(h.verify, { phone: PHONE_B, otp: '123456' }, { ip: '192.0.2.2' });
    const wrong = await call(h.verify, { phone: PHONE_A, otp: wrongCode(otp) }, { ip: '192.0.2.3' });
    h.resetsFor(user._id)[0].otpExpiresAt = new Date(Date.UTC(2020, 0, 1));
    const expired = await call(h.verify, { phone: PHONE_A, otp }, { ip: '192.0.2.4' });
    for (const r of [unknown, noCode, wrong, expired]) assert.deepEqual([r.statusCode, r.body], [400, INVALID_CODE]);
    assert.ok(h.calls.compares >= 4, 'every failure path runs one comparison');
  });
});

test('verify: per-address and per-number limits return 429 with Retry-After', async () => {
  await withEnv(async ({ advance }) => {
    const h = harness();
    for (let i = 0; i < 20; i += 1) await call(h.verify, { phone: `+23480312345${String(10 + i)}`, otp: '123456' });
    advance(4 * 60 * 1000);
    const byIp = await call(h.verify, { phone: PHONE_A, otp: '123456' });
    assert.equal(byIp.statusCode, 429);
    assert.equal(byIp.headers['retry-after'], String(6 * 60));

    for (let i = 0; i < 10; i += 1) await call(h.verify, { phone: PHONE_B, otp: '123456' }, { ip: `198.51.100.${i + 1}` });
    const byPhone = await call(h.verify, { phone: PHONE_B, otp: '123456' }, { ip: '198.51.100.99' });
    assert.equal(byPhone.statusCode, 429);
    assert.equal(byPhone.body.resetTicket, undefined);
  });
});

test('verify: a failed write when consuming the code returns 500 with no ticket', async () => {
  await withEnv(async () => {
    const h = harness({ fail: { 'passwordPhoneResets.updateOne': true } });
    await addUser(h, PHONE_A);
    // insertOne is not failed, so the code is stored.
    const otp = await requestCode(h, PHONE_A);
    const res = await call(h.verify, { phone: PHONE_A, otp });
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.resetTicket, undefined);
    assert.equal(res.body.resetSecret, undefined);
  });
});

// ---------------------------------------------------------------------------
// Reset password
// ---------------------------------------------------------------------------

async function verifiedTicket(h, phone, ip) {
  const otp = await requestCode(h, phone, { ip });
  const res = await call(h.verify, { phone, otp }, { ip });
  assert.equal(res.statusCode, 200);
  return res.body;
}

test('reset: sets the password, raises session generation and invalidates old tokens', async () => {
  await withEnv(async () => {
    const h = harness();
    const user = await addUser(h, PHONE_A);
    const { issueAuthToken, verifyToken, decideSessionBinding } = require('../lib/token-core');
    const oldToken = issueAuthToken({ userId: String(user._id), email: user.email, role: 'student', generation: 4 });
    const { resetTicket, resetSecret } = await verifiedTicket(h, PHONE_A);
    const res = await call(h.reset, { resetTicket, resetSecret, password: 'brand-new-password' });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(Object.keys(res.body), ['message']);
    const row = h.db.data.users.find((u) => String(u._id) === String(user._id));
    assert.equal(await realBcrypt.compare('brand-new-password', row.password), true);
    assert.equal(row.sessionGeneration, 5);
    const payload = verifyToken(oldToken);
    assert.equal(decideSessionBinding({ userId: payload.userId, binding: payload.sv, generation: row.sessionGeneration, key: process.env.JWT_SECRET }).ok, false);
    assert.equal(h.resetsFor(user._id).length, 0);
  });
});

test('reset: a ticket works once, even when submitted simultaneously', async () => {
  await withEnv(async () => {
    const h = harness();
    const user = await addUser(h, PHONE_A);
    const creds = await verifiedTicket(h, PHONE_A);
    const results = await Promise.all(
      ['pw-one-111', 'pw-two-222', 'pw-three-333', 'pw-four-444'].map((password, i) => call(h.reset, { ...creds, password }, { ip: `192.0.2.${i + 1}` }))
    );
    assert.equal(results.filter((r) => r.statusCode === 200).length, 1);
    const row = h.db.data.users.find((u) => String(u._id) === String(user._id));
    assert.equal(row.sessionGeneration, 5, 'raised once');
    const again = await call(h.reset, { ...creds, password: 'pw-again-555' }, { ip: '192.0.2.9' });
    assert.equal(again.statusCode, 400);
  });
});

test('reset: expired, unknown, malformed and wrong-secret tickets are refused; a wrong secret does not burn the ticket', async () => {
  await withEnv(async () => {
    const h = harness();
    const user = await addUser(h, PHONE_A);
    const creds = await verifiedTicket(h, PHONE_A);
    const wrongSecret = await call(h.reset, { ...creds, resetSecret: 'f'.repeat(64), password: 'whatever-1' });
    assert.equal(wrongSecret.statusCode, 400);
    assert.equal(h.resetsFor(user._id).length, 1, 'still usable by its owner');
    assert.equal((await call(h.reset, { resetTicket: 'a'.repeat(48), resetSecret: 'b'.repeat(64), password: 'whatever-1' })).statusCode, 400);
    for (const bad of [{ resetTicket: 'short' }, { resetTicket: { $ne: null } }, { resetSecret: 'x' }]) {
      assert.equal((await call(h.reset, { ...creds, ...bad, password: 'whatever-1' })).statusCode, 400);
    }
    h.resetsFor(user._id)[0].passwordStepExpiresAt = new Date(Date.UTC(2020, 0, 1));
    const expired = await call(h.reset, { ...creds, password: 'whatever-1' });
    assert.equal(expired.statusCode, 400);
    assert.equal(h.resetsFor(user._id).length, 0);
    assert.equal(h.db.data.users.find((u) => String(u._id) === String(user._id)).sessionGeneration, 4, 'nothing changed');
  });
});

test('reset: a ticket only ever changes its own account', async () => {
  await withEnv(async () => {
    const h = harness();
    const a = await addUser(h, PHONE_A);
    const b = await addUser(h, PHONE_B);
    const creds = await verifiedTicket(h, PHONE_A, '198.51.100.1');
    assert.equal((await call(h.reset, { ...creds, password: 'only-for-a-1' })).statusCode, 200);
    const rowA = h.db.data.users.find((u) => String(u._id) === String(a._id));
    const rowB = h.db.data.users.find((u) => String(u._id) === String(b._id));
    assert.equal(await realBcrypt.compare('only-for-a-1', rowA.password), true);
    assert.equal(await realBcrypt.compare('old-password', rowB.password), true);
    assert.equal(rowB.sessionGeneration, 4);
  });
});

test('reset: per-address and per-ticket limits', async () => {
  await withEnv(async () => {
    const h = harness();
    for (let i = 0; i < 10; i += 1) await call(h.reset, { resetTicket: 'a'.repeat(47) + i, resetSecret: 'b'.repeat(64), password: 'whatever-1' });
    const byIp = await call(h.reset, { resetTicket: 'c'.repeat(48), resetSecret: 'b'.repeat(64), password: 'whatever-1' });
    assert.equal(byIp.statusCode, 429);
    const ticket = 'd'.repeat(48);
    for (let i = 0; i < 5; i += 1) await call(h.reset, { resetTicket: ticket, resetSecret: 'b'.repeat(64), password: 'whatever-1' }, { ip: `198.51.100.${i + 1}` });
    const byTicket = await call(h.reset, { resetTicket: ticket, resetSecret: 'b'.repeat(64), password: 'whatever-1' }, { ip: '198.51.100.50' });
    assert.equal(byTicket.statusCode, 429);
  });
});

test('reset: a failed password write after the claim returns 500 and the ticket cannot be replayed', async () => {
  await withEnv(async () => {
    const h = harness();
    await addUser(h, PHONE_A);
    const creds = await verifiedTicket(h, PHONE_A);
    const usersCollection = h.db.collection.bind(h.db);
    h.db.collection = (name) => {
      const col = usersCollection(name);
      if (name === 'users') col.updateOne = async () => { throw new Error('write failed'); };
      return col;
    };
    const res = await call(h.reset, { ...creds, password: 'new-password-x' });
    assert.equal(res.statusCode, 500);
    h.db.collection = usersCollection;
    assert.equal((await call(h.reset, { ...creds, password: 'new-password-y' })).statusCode, 400, 'start again from Forgot password');
  });
});

// ---------------------------------------------------------------------------
// Client address, shared store failures, keys and logs
// ---------------------------------------------------------------------------

test('spoofed left-most X-Forwarded-For values cannot get around the limits', async () => {
  await withEnv(async () => {
    const h = harness();
    const results = [];
    for (let i = 0; i < 12; i += 1) {
      const spoofed = `1.2.3.${i}, 9.9.9.${i}, 203.0.113.10`;
      results.push((await call(h.forgot, { phone: `+23480312345${String(10 + i)}` }, { headers: { 'x-forwarded-for': spoofed } })).statusCode);
    }
    assert.deepEqual(results.slice(0, 10), Array(10).fill(200));
    assert.deepEqual(results.slice(10), [429, 429], 'counted under the proxy-appended address');
  });
  await withEnv(async () => {
    const h = harness();
    // Two trusted proxies: the client address is second from the right.
    for (let i = 0; i < 20; i += 1) {
      await call(h.verify, { phone: PHONE_A, otp: '123456' }, { headers: { 'x-forwarded-for': `6.6.6.${i}, 203.0.113.20, 10.9.9.9` } });
    }
    const refused = await call(h.verify, { phone: PHONE_B, otp: '123456' }, { headers: { 'x-forwarded-for': '7.7.7.7, 203.0.113.20, 10.9.9.9' } });
    assert.equal(refused.statusCode, 429);
    const other = await call(h.verify, { phone: PHONE_B, otp: '123456' }, { headers: { 'x-forwarded-for': '203.0.113.21, 10.9.9.9' } });
    assert.equal(other.statusCode, 400);
  }, { ...ENV, TRUSTED_PROXY_HOPS: '2' });
  for (const file of ['forgot-password', 'verify-password-otp', 'reset-password']) {
    const source = fs.readFileSync(path.join(ROOT, `pages/api/auth/${file}.ts`), 'utf8');
    assert.match(source, /const ip = clientAddress\(req\) \?\? undefined;/, file);
    assert.doesNotMatch(source, /split\(','\)\[0\]|getClientIp/, file);
  }
});

test('shared store unavailable: all three steps refuse with 503 and do nothing else', async () => {
  await withEnv(async () => {
    const h = harness({ fail: { [`${RATE_LIMIT_COLLECTION}.findOneAndUpdate`]: true } });
    await addUser(h, PHONE_A);
    const responses = [
      await call(h.forgot, { phone: PHONE_A }),
      await call(h.verify, { phone: PHONE_A, otp: '123456' }),
      await call(h.reset, { resetTicket: 'a'.repeat(48), resetSecret: 'b'.repeat(64), password: 'whatever-1' }),
    ];
    for (const res of responses) assert.deepEqual([res.statusCode, res.body.code], [503, 'rate_limit_unavailable']);
    assert.equal(h.sms.sent.length, 0);
    assert.equal(h.calls.compares, 0);
  });
});

test('forgot: a store failure on the one-minute gate is refused with 503, not answered as sent', async () => {
  await withEnv(async () => {
    const h = harness();
    await addUser(h, PHONE_A);
    const limits = h.db.collection.bind(h.db);
    h.db.collection = (name) => {
      const col = limits(name);
      if (name === RATE_LIMIT_COLLECTION) {
        const upsert = col.findOneAndUpdate;
        col.findOneAndUpdate = async (filter, ...rest) => {
          if (String(filter._id).startsWith('reset-request-cooldown:')) throw new Error('store failed');
          return upsert(filter, ...rest);
        };
      }
      return col;
    };
    const res = await call(h.forgot, { phone: PHONE_A });
    assert.deepEqual([res.statusCode, res.body.code], [503, 'rate_limit_unavailable']);
    assert.equal(h.sms.sent.length, 0);
  });
});

test('stored rate-limit keys and security logs hold no phone numbers, codes, tickets or secrets', async () => {
  await withEnv(async () => {
    const h = harness();
    await addUser(h, PHONE_A);
    const otp = await requestCode(h, PHONE_A);
    await call(h.verify, { phone: PHONE_A, otp: wrongCode(otp) });
    const creds = (await call(h.verify, { phone: PHONE_A, otp })).body;
    await call(h.reset, { ...creds, password: 'logged-nowhere-1' });
    const stored = JSON.stringify([h.db.data[RATE_LIMIT_COLLECTION], h.db.data.passwordResetSecurityLogs]);
    for (const secret of ['8031234567', '2348031234567', otp, creds.resetTicket, creds.resetSecret, 'logged-nowhere-1']) {
      assert.equal(stored.includes(secret), false, `leaked ${secret.slice(0, 4)}…`);
    }
    for (const row of h.db.data[RATE_LIMIT_COLLECTION]) assert.match(row._id, /^reset-[a-z-]+:[a-f0-9]{40}:\d+$/);
  });
});

test('policies', () => {
  const rules = (list) => list.map((r) => [r.id, r.max, [...r.parts]]);
  assert.deepEqual(rules(authLimit.RESET_REQUEST_RULES), [
    ['reset-request-ip', 10, ['ip']],
    ['reset-request-phone', 5, ['phone']],
    ['reset-request-global', 300, []],
  ]);
  assert.deepEqual(rules(authLimit.RESET_COOLDOWN_RULES), [['reset-request-cooldown', 1, ['phone']]]);
  assert.equal(authLimit.RESET_COOLDOWN_WINDOW_MS, 60 * 1000);
  assert.deepEqual(rules(authLimit.RESET_VERIFY_RULES), [
    ['reset-verify-ip', 20, ['ip']],
    ['reset-verify-phone', 10, ['phone']],
  ]);
  assert.deepEqual(rules(authLimit.RESET_COMPLETE_RULES), [
    ['reset-complete-ip', 10, ['ip']],
    ['reset-complete-ticket', 5, ['ticket']],
  ]);
  // H1 policies are unchanged.
  assert.deepEqual(rules(authLimit.LOGIN_RULES).map((r) => r[1]), [30, 10, 50]);
  assert.deepEqual(rules(authLimit.SIGNUP_RULES).map((r) => r[1]), [10, 5]);
});
