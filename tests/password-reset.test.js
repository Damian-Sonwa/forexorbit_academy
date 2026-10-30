/**
 * Password reset by email (lib/password-reset.js, lib/password-reset-token.js, the two routes).
 *
 * The service runs against an in-memory database. Every operation yields to the event loop first
 * and then applies atomically, as MongoDB does for one document, so simultaneous requests
 * interleave between operations the way real requests can. The unique indexes T1 and T2 are
 * enforced on insert unless a test turns them off. This is a mocked store: it shows the logic is
 * safe under that interleaving; it does not run MongoDB itself. Email is a recording stub; the
 * route tests use the real lib/email.ts with the Resend SDK replaced. Nothing is sent anywhere.
 */

const test = require('node:test');
const { mock } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const realBcrypt = require('bcryptjs');
const { ObjectId } = require('mongodb');

const { RATE_LIMIT_COLLECTION } = require('../lib/shared-rate-limit');
const { decideSessionBinding, sessionBinding } = require('../lib/token-core');
const { checkNewPassword, PASSWORD_MAX_BYTES } = require('../lib/password-policy');
const tokens = require('../lib/password-reset-token');
const reset = require('../lib/password-reset');
const { loadModule, mockResponse } = require('./helpers/ts-loader');

const T0 = Date.UTC(2026, 9, 30, 12, 0, 0);
const SECRET = 'test-only-reset-secret';
const ENV = { JWT_SECRET: SECRET, SHARED_RATE_LIMIT: 'mongodb' };
const GENERIC = { message: reset.RESET_REQUESTED };
const TOKENS = tokens.RESET_TOKENS_COLLECTION;
const LOGS = reset.SECURITY_LOG_COLLECTION;

// ---------------------------------------------------------------------------
// In-memory MongoDB stand-in
// ---------------------------------------------------------------------------

const tick = () => new Promise((resolve) => setImmediate(resolve));
const cmp = (v) => (v instanceof Date ? v.getTime() : v);
const same = (a, b) => (a instanceof ObjectId || b instanceof ObjectId ? String(a) === String(b) : cmp(a) === cmp(b));
const isOperatorObject = (cond) =>
  cond && typeof cond === 'object' && !(cond instanceof Date) && !(cond instanceof ObjectId) && Object.keys(cond).some((k) => k.startsWith('$'));

function matches(doc, filter) {
  return Object.entries(filter).every(([key, cond]) => {
    const value = doc[key];
    if (isOperatorObject(cond)) {
      return Object.entries(cond).every(([op, arg]) => {
        if (op === '$gt') return value != null && cmp(value) > cmp(arg);
        if (op === '$lte') return value != null && cmp(value) <= cmp(arg);
        if (op === '$ne') return !same(value, arg);
        throw new Error(`unsupported operator ${op}`);
      });
    }
    // As in MongoDB, null matches a missing field too.
    if (cond === null) return value === null || value === undefined;
    return same(value, cond);
  });
}

function applyUpdate(doc, update) {
  Object.assign(doc, update.$set || {});
  for (const [k, n] of Object.entries(update.$inc || {})) doc[k] = (doc[k] || 0) + n;
}

function duplicateKey() {
  return Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
}

function memoryDb({ fail = {}, uniqueIndexes = true } = {}) {
  const data = { users: [], [TOKENS]: [], [LOGS]: [], [RATE_LIMIT_COLLECTION]: [] };
  const counts = {};
  const db = {
    data,
    counts,
    collection(name) {
      data[name] = data[name] || [];
      const rows = data[name];
      const check = async (op) => {
        await tick();
        counts[`${name}.${op}`] = (counts[`${name}.${op}`] || 0) + 1;
        if (fail[`${name}.${op}`]) throw new Error(`${name}.${op} failed`);
      };
      const pick = (filter) => rows.find((row) => matches(row, filter));
      return {
        find(filter) {
          let limit = Infinity;
          const cursor = {
            limit(n) { limit = n; return cursor; },
            async toArray() {
              await check('find');
              return rows.filter((row) => matches(row, filter)).slice(0, limit).map((row) => ({ ...row }));
            },
          };
          return cursor;
        },
        async findOne(filter) {
          await check('findOne');
          const doc = pick(filter);
          return doc ? { ...doc } : null;
        },
        async insertOne(doc) {
          await check('insertOne');
          if (name === TOKENS && uniqueIndexes) {
            if (rows.some((row) => row.tokenHash === doc.tokenHash)) throw duplicateKey();
            if (doc.status === 'active' && rows.some((row) => row.status === 'active' && same(row.userId, doc.userId))) throw duplicateKey();
          }
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
        async updateMany(filter, update) {
          await check('updateMany');
          const found = rows.filter((row) => matches(row, filter));
          found.forEach((doc) => applyUpdate(doc, update));
          return { matchedCount: found.length, modifiedCount: found.length };
        },
        async findOneAndUpdate(filter, update) {
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
          const doc = pick(filter);
          if (!doc) return null;
          applyUpdate(doc, update);
          return { ...doc };
        },
        async deleteOne(filter) {
          await check('deleteOne');
          const index = rows.findIndex((row) => matches(row, filter));
          if (index >= 0) rows.splice(index, 1);
          return { deletedCount: index >= 0 ? 1 : 0 };
        },
      };
    },
  };
  return db;
}

// ---------------------------------------------------------------------------
// Service harness: recording mailer, recorded (not real) waiting, fast bcrypt
// ---------------------------------------------------------------------------

function harness({ fail, uniqueIndexes, ready = { ok: true }, resetResult = { ok: true }, changedResult = { ok: true }, env = {} } = {}) {
  const db = memoryDb({ fail, uniqueIndexes });
  const mail = { reset: [], changed: [], readyChecks: 0 };
  const mailer = {
    passwordResetEmailReady: () => {
      mail.readyChecks += 1;
      return ready;
    },
    sendPasswordResetEmail: async (input) => {
      await tick();
      mail.reset.push(input);
      return typeof resetResult === 'function' ? resetResult(input) : resetResult;
    },
    sendPasswordChangedEmail: async (input) => {
      await tick();
      mail.changed.push(input);
      return changedResult;
    },
  };
  const sleeps = [];
  let elapsed = 0;
  const service = reset.createPasswordResetService({
    getDb: async () => db,
    mailer,
    env: { ...ENV, ...env },
    sleep: async (ms) => { sleeps.push(ms); },
    clock: () => elapsed,
    hashPassword: (password) => realBcrypt.hash(password, 4),
  });
  return {
    db,
    mail,
    sleeps,
    service,
    takeTime: (ms) => { elapsed += ms; },
    tokensFor: (user) => db.data[TOKENS].filter((row) => same(row.userId, user._id)),
    logs: () => db.data[LOGS],
  };
}

const request = (h, email, ip = '203.0.113.10') => h.service.requestReset({ body: { email }, ip });
const complete = (h, token, password = 'new-password-123', ip = '203.0.113.10') => h.service.completeReset({ body: { token, password }, ip });

async function addUser(h, extra = {}) {
  const user = {
    _id: new ObjectId(),
    email: `user${h.db.data.users.length + 1}@example.com`,
    password: await realBcrypt.hash('old-password-1', 4),
    name: 'Reset User',
    role: 'student',
    status: 'approved',
    sessionGeneration: 4,
    phoneE164: '+2348031234567',
    ...extra,
  };
  h.db.data.users.push(user);
  return user;
}

/** Requests a link and returns its raw token from the recording mailer (null if none was sent). */
async function linkFor(h, email, ip) {
  const before = h.mail.reset.length;
  const res = await request(h, email, ip);
  assert.deepEqual(res, { status: 200, body: GENERIC });
  return h.mail.reset.length > before ? h.mail.reset[h.mail.reset.length - 1].token : null;
}

/** Runs with Date following a test clock (timers stay real). */
async function withClock(fn) {
  let now = T0;
  mock.timers.enable({ apis: ['Date'], now });
  try {
    return await fn({ advance: (ms) => { now += ms; mock.timers.setTime(now); } });
  } finally {
    mock.timers.reset();
  }
}

const userRow = (h, user) => h.db.data.users.find((row) => same(row._id, user._id));
const passwordIs = (h, user, password) => realBcrypt.compare(password, userRow(h, user).password);

// ---------------------------------------------------------------------------
// Requesting a link
// ---------------------------------------------------------------------------

test('registered, unregistered and ineligible addresses get the same response and the same wait', async () => {
  const h = harness();
  const active = await addUser(h);
  const others = [
    await addUser(h, { status: 'pending', role: 'instructor' }),
    await addUser(h, { status: 'rejected' }),
    await addUser(h, { status: 'suspended' }),
    await addUser(h, { status: 'deactivated' }),
    await addUser(h, { role: 'not-a-role' }),
  ];
  const addresses = [active.email, 'nobody@example.com', ...others.map((u) => u.email)];
  for (const [i, email] of addresses.entries()) {
    const res = await request(h, email, `203.0.113.${20 + i}`);
    assert.deepEqual(res, { status: 200, body: GENERIC }, email);
  }
  assert.deepEqual(h.sleeps, addresses.map(() => reset.MIN_RESPONSE_MS), 'every answer waits out the same minimum time');
  assert.deepEqual(h.mail.reset.map((m) => m.to), [active.email], 'only the active account gets an email');
  for (const user of others) assert.equal(h.tokensFor(user).length, 0, `no link for ${user.status}`);
  const refused = h.logs().filter((row) => row.detail === 'account_not_active');
  assert.equal(refused.length, others.length);
});

test('the minimum wait covers only what is left, and a slow email is not delayed further', async () => {
  const h = harness();
  const quick = await addUser(h);
  const slow = await addUser(h);
  let elapsed = 0;
  const sleeps = [];
  const service = (sendMs) => reset.createPasswordResetService({
    getDb: async () => h.db,
    mailer: {
      passwordResetEmailReady: () => ({ ok: true }),
      sendPasswordResetEmail: async () => { elapsed += sendMs; return { ok: true }; },
      sendPasswordChangedEmail: async () => ({ ok: true }),
    },
    env: ENV,
    sleep: async (ms) => { sleeps.push(ms); },
    clock: () => elapsed,
  });
  // The email took 900 ms of the 1200 ms minimum: 300 ms are left.
  await service(900).requestReset({ body: { email: quick.email }, ip: '203.0.113.30' });
  assert.deepEqual(sleeps, [300]);
  // The email took 5 s: no further wait. An unknown address waits the full minimum.
  sleeps.length = 0;
  const fiveSeconds = service(5000);
  await fiveSeconds.requestReset({ body: { email: slow.email }, ip: '203.0.113.31' });
  await fiveSeconds.requestReset({ body: { email: 'nobody@example.com' }, ip: '203.0.113.31' });
  assert.deepEqual(sleeps, [1200]);
});

test('malformed addresses get 400 without a lookup, a count or an email', async () => {
  const h = harness();
  for (const email of [undefined, null, '', '   ', 'no-at-sign', 'a@b', 'two@@example.com', 'sp ace@example.com', 'x@exam\u0000ple.com', 'x@exa\nmple.com', `${'a'.repeat(250)}@example.com`, 42, ['a@example.com'], { $ne: null }]) {
    const res = await h.service.requestReset({ body: { email }, ip: '203.0.113.10' });
    assert.deepEqual(res, { status: 400, body: { error: reset.INVALID_EMAIL, code: 'invalid_email' } }, JSON.stringify(email));
  }
  assert.deepEqual(await h.service.requestReset({ body: undefined, ip: '203.0.113.10' }), { status: 400, body: { error: reset.INVALID_EMAIL, code: 'invalid_email' } });
  assert.equal(h.db.counts['users.find'], undefined);
  assert.equal(h.db.data[RATE_LIMIT_COLLECTION].length, 0);
  assert.equal(h.mail.reset.length, 0);
  // Case and surrounding spaces do not matter, as at login.
  const user = await addUser(h, { email: 'mixed@example.com' });
  assert.ok(await linkFor(h, '  MiXeD@Example.COM '));
  assert.equal(h.mail.reset[0].to, user.email);
});

test('a link is a 256-bit random token; only its SHA-256 hash is stored, with a 30-minute expiry', async () => {
  await withClock(async () => {
    const h = harness();
    const user = await addUser(h);
    const token = await linkFor(h, user.email);
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(Buffer.from(token, 'base64url').length, 32);

    const rows = h.tokensFor(user);
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.equal(row.tokenHash, crypto.createHash('sha256').update(token).digest('hex'));
    assert.deepEqual(
      { status: row.status, sessionGeneration: row.sessionGeneration, createdAt: row.createdAt.getTime(), expiresAt: row.expiresAt.getTime() },
      { status: 'active', sessionGeneration: 4, createdAt: T0, expiresAt: T0 + 30 * 60 * 1000 }
    );
    assert.equal(tokens.RESET_TOKEN_TTL_MS, 30 * 60 * 1000);
    assert.equal(h.mail.reset[0].expiresAt.getTime(), T0 + 30 * 60 * 1000);
    assert.equal(h.mail.reset[0].idempotencyKey, `password-reset/${row._id}`);

    // The raw token, the address and the hash's source appear nowhere in the database.
    const everything = JSON.stringify(h.db.data);
    assert.equal(everything.includes(token), false, 'raw token not stored');
    for (const name of [LOGS, RATE_LIMIT_COLLECTION]) {
      const text = JSON.stringify(h.db.data[name]);
      assert.equal(text.includes(user.email), false, `${name} holds no email address`);
      assert.equal(text.includes(row.tokenHash), false, `${name} holds no token hash`);
    }

    // Different requests never produce the same token.
    const seen = new Set([token]);
    for (let i = 0; i < 20; i += 1) {
      const other = await addUser(h);
      const t = await linkFor(h, other.email, `198.51.100.${i}`);
      assert.equal(seen.has(t), false);
      seen.add(t);
    }
  });
});

test('per-address, per-email and service-wide limits refuse with 429 before any lookup', async () => {
  const h = harness();
  const user = await addUser(h);
  // Per client address: 10 per window.
  for (let i = 0; i < 10; i += 1) assert.equal((await request(h, `p${i}@example.com`, '203.0.113.50')).status, 200);
  const ipLimited = await request(h, user.email, '203.0.113.50');
  assert.equal(ipLimited.refusal.status, 429);
  assert.ok(ipLimited.refusal.retryAfterSec > 0);
  assert.equal(h.mail.reset.length, 0, 'the 11th request did not reach the account');

  // Per email from many addresses: 5 per window. The refused request above already counted once
  // for this address (every rule counts each attempt). The minute gate lets only one email out.
  for (let i = 0; i < 4; i += 1) assert.equal((await request(h, user.email, `198.51.100.${i}`)).status, 200);
  assert.equal((await request(h, user.email, '198.51.100.99')).refusal.status, 429);
  assert.equal(h.mail.reset.length, 1);

  // Service-wide: 300 per window across all addresses.
  const wide = harness();
  for (let i = 0; i < 300; i += 1) {
    assert.equal((await request(wide, `w${i}@example.com`, `10.${Math.floor(i / 250)}.${i % 250}.1`)).status, 200);
  }
  assert.equal((await request(wide, 'one-more@example.com', '10.9.9.9')).refusal.status, 429);
});

test('simultaneous requests for one address send one email and leave one live link', async () => {
  const h = harness();
  const user = await addUser(h);
  // Five: the per-email limit for one window.
  const results = await Promise.all(Array.from({ length: 5 }, (_, i) => request(h, user.email, `203.0.113.${60 + i}`)));
  results.forEach((res) => assert.deepEqual(res, { status: 200, body: GENERIC }));
  assert.equal(h.mail.reset.length, 1);
  assert.equal(h.tokensFor(user).filter((row) => row.status === 'active').length, 1);
});

test('a second request after the minute replaces the first link', async () => {
  await withClock(async ({ advance }) => {
    const h = harness();
    const user = await addUser(h);
    const first = await linkFor(h, user.email);
    advance(61 * 1000);
    const second = await linkFor(h, user.email);
    assert.notEqual(first, second);
    assert.deepEqual(h.tokensFor(user).map((row) => row.status), ['superseded', 'active']);
    assert.deepEqual((await complete(h, first)).body.code, 'superseded_token');
    assert.equal((await complete(h, second)).status, 200);
  });
});

test('if the email cannot be sent, the link is removed and the answer is unchanged', async () => {
  for (const reason of ['send_failed', 'timeout']) {
    const h = harness({ resetResult: { ok: false, reason } });
    const user = await addUser(h);
    const res = await request(h, user.email);
    assert.deepEqual(res, { status: 200, body: GENERIC });
    assert.equal(h.mail.reset.length, 1, 'a send was attempted');
    assert.equal(h.tokensFor(user).length, 0, 'no usable link was left behind');
    assert.equal((await complete(h, h.mail.reset[0].token)).body.code, 'invalid_token');
    const entry = h.logs().find((row) => row.event === 'reset_email_not_sent');
    assert.deepEqual([entry.detail, String(entry.userId)], [reason, String(user._id)]);
  }
});

test('when email is not configured, no link is created and nothing is sent', async () => {
  for (const reason of ['missing_api_key', 'missing_sender', 'test_sender_in_production', 'missing_app_base_url', 'invalid_app_base_url']) {
    const h = harness({ ready: { ok: false, reason } });
    const user = await addUser(h);
    assert.deepEqual(await request(h, user.email), { status: 200, body: GENERIC });
    assert.equal(h.mail.reset.length, 0);
    assert.equal(h.db.data[TOKENS].length, 0);
    assert.equal(h.logs().find((row) => row.event === 'reset_email_not_sent').detail, reason);
  }
});

test('an address shared by two accounts sends nothing rather than guess', async () => {
  const h = harness();
  await addUser(h, { email: 'shared@example.com' });
  await addUser(h, { email: 'shared@example.com' });
  assert.deepEqual(await request(h, 'shared@example.com'), { status: 200, body: GENERIC });
  assert.equal(h.mail.reset.length, 0);
  assert.equal(h.db.data[TOKENS].length, 0);
  assert.equal(h.logs().find((row) => row.event === 'reset_refused').detail, 'ambiguous_email');
});

// ---------------------------------------------------------------------------
// Using a link
// ---------------------------------------------------------------------------

test('a link sets the password, raises sessionGeneration once and signs out existing sessions', async () => {
  const h = harness();
  const user = await addUser(h);
  // The binding carried by every token issued before the reset (generation 4).
  const oldBinding = sessionBinding(String(user._id), 4, SECRET);
  const token = await linkFor(h, user.email);

  assert.deepEqual(await complete(h, token, 'brand-new-pass'), { status: 200, body: { message: reset.RESET_COMPLETE } });
  assert.equal(await passwordIs(h, user, 'brand-new-pass'), true);
  assert.equal(await passwordIs(h, user, 'old-password-1'), false);
  assert.equal(userRow(h, user).sessionGeneration, 5);
  assert.equal(
    decideSessionBinding({ userId: String(user._id), binding: oldBinding, generation: userRow(h, user).sessionGeneration, key: SECRET }).status,
    401,
    'a token issued before the reset is refused'
  );
  assert.equal(h.tokensFor(user)[0].status, 'used');
  assert.equal(userRow(h, user).phoneE164, '+2348031234567', 'phone fields are left alone');

  // The password changed notice goes to the account, once, keyed to this link.
  assert.deepEqual(h.mail.changed.map((m) => [m.to, m.idempotencyKey]), [[user.email, `password-changed/${h.tokensFor(user)[0]._id}`]]);
  assert.ok(h.logs().some((row) => row.event === 'password_reset_complete' && same(row.userId, user._id)));
});

test('a link works once: replay, expiry, unknown and malformed tokens are refused with their reason', async () => {
  await withClock(async ({ advance }) => {
    const h = harness();
    const user = await addUser(h);
    const token = await linkFor(h, user.email);
    assert.equal((await complete(h, token)).status, 200);
    const replay = await complete(h, token, 'another-password');
    assert.deepEqual(replay, { status: 400, body: { error: tokens.LINK_REFUSALS.used_token, code: 'used_token' } });
    assert.equal(await passwordIs(h, user, 'new-password-123'), true, 'the replay changed nothing');
    assert.equal(userRow(h, user).sessionGeneration, 5);

    const other = await addUser(h);
    const late = await linkFor(h, other.email);
    advance(30 * 60 * 1000);
    assert.equal((await complete(h, late)).body.code, 'expired_token', 'expired at exactly 30 minutes');
    assert.equal(await passwordIs(h, other, 'old-password-1'), true);
    assert.equal(userRow(h, other).sessionGeneration, 4);

    const unknown = crypto.randomBytes(32).toString('base64url');
    assert.equal((await complete(h, unknown)).body.code, 'invalid_token');
    const before = h.db.data[RATE_LIMIT_COLLECTION].length;
    for (const bad of [undefined, null, '', 'short', `${unknown}x`, unknown.slice(1), `${unknown.slice(0, 42)}=`, `${unknown.slice(0, 42)}+`, 42, { $ne: null }]) {
      assert.deepEqual(await h.service.completeReset({ body: { token: bad, password: 'new-password-123' }, ip: '203.0.113.10' }), {
        status: 400,
        body: { error: tokens.LINK_REFUSALS.invalid_token, code: 'invalid_token' },
      });
    }
    assert.equal(h.db.data[RATE_LIMIT_COLLECTION].length, before, 'malformed tokens are refused before any count or lookup');
  });
});

test('simultaneous uses of one link: exactly one sets the password', async () => {
  const h = harness();
  const user = await addUser(h);
  const token = await linkFor(h, user.email);
  // Five: the per-link limit for one window, so every request reaches the claim.
  const passwords = Array.from({ length: 5 }, (_, i) => `concurrent-pass-${i}`);
  const results = await Promise.all(passwords.map((p, i) => complete(h, token, p, `198.51.100.${i}`)));
  assert.equal(results.filter((r) => r.status === 200).length, 1);
  assert.ok(results.filter((r) => r.status !== 200).every((r) => r.body.code === 'used_token'));
  assert.equal(userRow(h, user).sessionGeneration, 5, 'raised exactly once');
  const matching = [];
  for (const p of passwords) if (await passwordIs(h, user, p)) matching.push(p);
  assert.equal(matching.length, 1);
  assert.equal(h.mail.changed.length, 1);
  // Beyond the limit, extra simultaneous requests are refused before the claim.
  const more = await Promise.all(Array.from({ length: 3 }, (_, i) => complete(h, token, 'late-pass-123', `198.51.100.${40 + i}`)));
  assert.ok(more.every((r) => r.refusal && r.refusal.status === 429));
});

test('20 simultaneous claims of one token in the store: exactly one succeeds', async () => {
  const db = memoryDb();
  const userId = new ObjectId();
  const { token } = await tokens.issueResetToken(db, { userId, sessionGeneration: 0 });
  const claims = await Promise.all(Array.from({ length: 20 }, () => tokens.claimResetToken(db, { token })));
  assert.equal(claims.filter((c) => c.ok).length, 1);
  assert.deepEqual([...new Set(claims.filter((c) => !c.ok).map((c) => c.code))], ['used_token']);
  assert.equal(db.data[TOKENS][0].status, 'used');
});

test('the password rule is checked before the link is used: 8 characters to 72 bytes', async () => {
  const h = harness();
  const user = await addUser(h);
  const token = await linkFor(h, user.email);
  const cases = [
    ['seven77', false],
    ['        ', false],
    [12345678, false],
    [undefined, false],
    ['a'.repeat(73), false],
    ['é'.repeat(37), false], // 74 bytes
    ['eight888', true],
    ['a'.repeat(72), true],
    ['é'.repeat(36), true], // 72 bytes
    ['😀'.repeat(8), true], // 8 characters, 32 bytes
  ];
  for (const [password, ok] of cases) assert.equal(checkNewPassword(password).ok, ok, JSON.stringify(password));
  assert.equal(PASSWORD_MAX_BYTES, 72);

  for (const [password] of cases.filter(([, ok]) => !ok)) {
    const res = await h.service.completeReset({ body: { token, password }, ip: '203.0.113.10' });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'weak_password');
  }
  assert.equal(h.tokensFor(user)[0].status, 'active', 'rejected passwords did not spend the link');
  assert.equal((await complete(h, token, 'é'.repeat(36))).status, 200);
  assert.equal(await passwordIs(h, user, 'é'.repeat(36)), true);
});

test('only active accounts can finish a reset; status or session changes after the email void the link', async () => {
  for (const status of ['suspended', 'pending', 'rejected', 'deactivated']) {
    const h = harness();
    const user = await addUser(h);
    const token = await linkFor(h, user.email);
    userRow(h, user).status = status;
    const res = await complete(h, token);
    assert.deepEqual(res.body.code, 'invalid_token', status);
    assert.equal(await passwordIs(h, user, 'old-password-1'), true);
    assert.equal(userRow(h, user).sessionGeneration, 4);
    assert.equal(h.mail.changed.length, 0);
    assert.equal(h.tokensFor(user)[0].status, 'used', 'the link cannot be retried after reactivation');
  }

  const deleted = harness();
  const gone = await addUser(deleted);
  const goneToken = await linkFor(deleted, gone.email);
  deleted.db.data.users.length = 0;
  assert.equal((await complete(deleted, goneToken)).body.code, 'invalid_token');

  // Signed out by another reset (or any other session reset) after the email was sent.
  const h = harness();
  const user = await addUser(h);
  const token = await linkFor(h, user.email);
  userRow(h, user).sessionGeneration = 9;
  assert.equal((await complete(h, token)).body.code, 'invalid_token');
  assert.equal(await passwordIs(h, user, 'old-password-1'), true);
  assert.equal(userRow(h, user).sessionGeneration, 9);
});

test('an account suspended between the check and the write keeps its password', async () => {
  const h = harness();
  const user = await addUser(h);
  const token = await linkFor(h, user.email);
  // Suspend the account right after the service reads it.
  const base = h.db.collection.bind(h.db);
  h.db.collection = (name) => {
    const col = base(name);
    if (name === 'users') {
      const findOne = col.findOne;
      col.findOne = async (...args) => {
        const doc = await findOne(...args);
        userRow(h, user).status = 'suspended';
        return doc;
      };
    }
    return col;
  };
  assert.equal((await complete(h, token)).body.code, 'invalid_token');
  assert.equal(await passwordIs(h, user, 'old-password-1'), true);
  assert.equal(userRow(h, user).sessionGeneration, 4);
});

test('a legacy account with no status or session counter can reset', async () => {
  const h = harness();
  const user = await addUser(h, { status: undefined, sessionGeneration: undefined });
  delete userRow(h, user).status;
  delete userRow(h, user).sessionGeneration;
  const token = await linkFor(h, user.email);
  assert.equal(h.tokensFor(user)[0].sessionGeneration, 0);
  assert.equal((await complete(h, token)).status, 200);
  assert.equal(userRow(h, user).sessionGeneration, 1);
});

test('a successful reset replaces any other live link for the account', async () => {
  const h = harness({ uniqueIndexes: false });
  const user = await addUser(h);
  const token = await linkFor(h, user.email);
  // A second live link that slipped in without the T2 index.
  const extra = await tokens.issueResetToken(h.db, { userId: user._id, sessionGeneration: 4 });
  h.tokensFor(user).forEach((row) => { row.status = 'active'; });
  assert.equal((await complete(h, token)).status, 200);
  assert.equal((await complete(h, extra.token)).body.code, 'superseded_token');
});

test('issuing links at the same moment leaves one live link (with or without index T2)', async () => {
  for (const uniqueIndexes of [true, false]) {
    const db = memoryDb({ uniqueIndexes });
    const userId = new ObjectId();
    const issued = await Promise.all([1, 2, 3].map(() => tokens.issueResetToken(db, { userId, sessionGeneration: 0 })));
    assert.equal(issued.length, 3);
    const active = db.data[TOKENS].filter((row) => row.status === 'active');
    if (uniqueIndexes) assert.equal(active.length, 1, 'T2 turns a simultaneous insert into a replacement');
    else assert.ok(active.length >= 1);
  }
});

test('a failed password write after the claim returns an error and the link cannot be replayed', async () => {
  const h = harness();
  const user = await addUser(h);
  const token = await linkFor(h, user.email);
  const failing = harness({ fail: { 'users.updateOne': true } });
  failing.db.data.users.push(...h.db.data.users);
  failing.db.data[TOKENS].push(...h.db.data[TOKENS]);
  await assert.rejects(complete(failing, token), /users.updateOne failed/);
  assert.equal(await passwordIs(failing, user, 'old-password-1'), true);
  assert.equal((await complete(failing, token)).body.code, 'used_token');
});

test('a failed password changed notice is logged and does not undo the reset', async () => {
  const h = harness({ changedResult: { ok: false, reason: 'send_failed' } });
  const user = await addUser(h);
  const token = await linkFor(h, user.email);
  assert.equal((await complete(h, token)).status, 200);
  assert.equal(await passwordIs(h, user, 'new-password-123'), true);
  assert.equal(h.logs().find((row) => row.event === 'password_changed_email_not_sent').detail, 'send_failed');
});

test('per-address and per-link limits on completing a reset', async () => {
  const h = harness();
  const user = await addUser(h);
  const token = await linkFor(h, user.email);
  assert.equal((await complete(h, token)).status, 200);
  // The same link again from many addresses: 5 attempts per link per window.
  for (let i = 0; i < 4; i += 1) assert.equal((await complete(h, token, 'whatever-pass', `198.51.100.${i}`)).body.code, 'used_token');
  assert.equal((await complete(h, token, 'whatever-pass', '198.51.100.50')).refusal.status, 429);
  // Many links from one address: 10 per window.
  const busy = harness();
  for (let i = 0; i < 10; i += 1) assert.equal((await complete(busy, crypto.randomBytes(32).toString('base64url'), 'whatever-pass', '203.0.113.77')).status, 400);
  assert.equal((await complete(busy, crypto.randomBytes(32).toString('base64url'), 'whatever-pass', '203.0.113.77')).refusal.status, 429);
});

test('shared store unavailable: both steps refuse with 503 and do nothing else', async () => {
  const h = harness({ fail: { [`${RATE_LIMIT_COLLECTION}.findOneAndUpdate`]: true } });
  const user = await addUser(h);
  const res = await request(h, user.email);
  assert.deepEqual(res.refusal, { allowed: false, status: 503 });
  assert.equal(h.db.counts['users.find'], undefined);
  assert.equal(h.mail.reset.length, 0);
  assert.equal(h.db.data[TOKENS].length, 0);
  const done = await complete(h, crypto.randomBytes(32).toString('base64url'));
  assert.deepEqual(done.refusal, { allowed: false, status: 503 });
  assert.equal(h.db.counts[`${TOKENS}.findOneAndUpdate`], undefined);
});

test('rate-limit keys and security logs hold no email addresses, tokens or passwords', async () => {
  const h = harness();
  const user = await addUser(h);
  const token = await linkFor(h, user.email);
  await complete(h, token, 'secret-new-pass');
  await request(h, 'nobody@example.com');
  const stored = JSON.stringify([h.db.data[RATE_LIMIT_COLLECTION], h.db.data[LOGS]]);
  for (const value of [user.email, 'nobody@example.com', token, tokens.hashResetToken(token), 'secret-new-pass']) {
    assert.equal(stored.includes(value), false, value);
  }
  assert.ok(h.logs().every((row) => !('email' in row) && !('token' in row)));
});

// ---------------------------------------------------------------------------
// Through the real routes, with the real lib/email.ts and the Resend SDK replaced
// ---------------------------------------------------------------------------

const PROD_ENV = {
  NODE_ENV: 'production',
  JWT_SECRET: SECRET,
  SHARED_RATE_LIMIT: 'mongodb',
  APP_BASE_URL: 'https://app.example.test',
  RESEND_API_KEY: 're_test_only_not_a_real_key',
  RESEND_FROM: 'ForexOrbit Academy <no-reply@mail.example.test>',
  TRUSTED_PROXY_HOPS: undefined,
};

async function withProcessEnv(env, fn) {
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

function routes(db, resend) {
  const stubs = {
    'lib/mongodb': { getDb: async () => db },
    'lib/socket-server': { getSocketServer: () => null },
    resend: { Resend: resend },
    bcryptjs: { ...realBcrypt, hash: (value, rounds) => realBcrypt.hash(value, Math.min(rounds, 4)) },
  };
  return {
    forgot: loadModule('pages/api/auth/forgot-password.ts', stubs).default,
    reset: loadModule('pages/api/auth/reset-password.ts', stubs).default,
    login: loadModule('pages/api/auth/login.ts', stubs).default,
    me: loadModule('pages/api/auth/me.ts', stubs).default,
  };
}

function fakeResend(outcome = () => ({ data: { id: 'email_1' }, error: null })) {
  const calls = { keys: [], sends: [] };
  class Resend {
    constructor(key) {
      calls.keys.push(key);
      this.emails = {
        send: async (payload, options) => {
          calls.sends.push({ payload, options });
          return outcome(payload);
        },
      };
    }
  }
  return { Resend, calls };
}

async function callRoute(handler, { method = 'POST', body, token, ip = '203.0.113.10' } = {}) {
  const res = mockResponse();
  const headers = { 'x-forwarded-for': ip };
  if (token) headers.authorization = `Bearer ${token}`;
  await handler({ method, headers, body, query: {}, socket: { remoteAddress: '10.0.0.2' } }, res);
  return res;
}

function captureConsole() {
  const lines = [];
  const saved = {};
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    saved[level] = console[level];
    console[level] = (...args) => lines.push(args.map(String).join(' '));
  }
  return { lines, restore: () => Object.assign(console, saved) };
}

test('through the routes: email link, new password, old session refused, new sign-in works, nothing secret logged', async () => {
  await withProcessEnv(PROD_ENV, async () => {
    const h = harness();
    const user = await addUser(h, { email: 'route.user@example.com', name: '<b>Ada</b>' });
    const resend = fakeResend();
    const r = routes(h.db, resend.Resend);
    const output = captureConsole();
    let token;
    try {
      const signedIn = await callRoute(r.login, { body: { email: user.email, password: 'old-password-1' } });
      assert.equal(signedIn.statusCode, 200);
      const oldSession = signedIn.body.token;

      const unknown = await callRoute(r.forgot, { body: { email: 'nobody@example.com' } });
      const known = await callRoute(r.forgot, { body: { email: user.email } });
      assert.deepEqual([unknown.statusCode, unknown.body], [200, GENERIC]);
      assert.deepEqual([known.statusCode, known.body], [200, GENERIC]);
      assert.equal(known.headers['cache-control'], 'no-store');

      assert.equal(resend.calls.sends.length, 1);
      const { payload, options } = resend.calls.sends[0];
      assert.equal(payload.from, PROD_ENV.RESEND_FROM);
      assert.deepEqual(payload.to, [user.email]);
      assert.equal(payload.subject, 'Reset your ForexOrbit Academy password');
      const link = payload.text.match(/https:\/\/app\.example\.test\/reset-password#token=([A-Za-z0-9_-]{43})/);
      assert.ok(link, 'the link uses APP_BASE_URL and carries the token in the fragment');
      token = link[1];
      assert.ok(payload.html.includes(`https://app.example.test/reset-password#token=${token}`));
      assert.ok(payload.html.includes('&lt;b&gt;Ada&lt;/b&gt;'), 'the name is escaped');
      assert.equal(payload.html.includes('<b>Ada</b>'), false);
      assert.match(payload.text, /expires in 30 minutes/);
      assert.equal(options.idempotencyKey, `password-reset/${h.tokensFor(user)[0]._id}`);

      const done = await callRoute(r.reset, { body: { token, password: 'route-new-pass' } });
      assert.deepEqual([done.statusCode, done.body], [200, { message: reset.RESET_COMPLETE }]);
      assert.equal(resend.calls.sends[1].payload.subject, 'Your ForexOrbit Academy password was changed');
      assert.ok(resend.calls.sends[1].payload.text.includes('https://app.example.test/forgot-password'));

      assert.equal((await callRoute(r.me, { method: 'GET', token: oldSession })).statusCode, 401, 'the old session is signed out');
      assert.equal((await callRoute(r.login, { body: { email: user.email, password: 'old-password-1' } })).statusCode, 401);
      const fresh = await callRoute(r.login, { body: { email: user.email, password: 'route-new-pass' } });
      assert.equal(fresh.statusCode, 200);
      assert.equal((await callRoute(r.me, { method: 'GET', token: fresh.body.token })).statusCode, 200);

      const replay = await callRoute(r.reset, { body: { token, password: 'route-new-pass-2' } });
      assert.deepEqual([replay.statusCode, replay.body.code], [400, 'used_token']);
    } finally {
      output.restore();
    }
    const logged = output.lines.join('\n');
    for (const secret of [token, user.email, 'nobody@example.com', PROD_ENV.RESEND_API_KEY, 'reset-password#', 'route-new-pass']) {
      assert.equal(logged.includes(secret), false, `console output must not contain ${secret}`);
    }
  });
});

test('through the routes: production without a verified sender or https base URL sends nothing and creates no link', async () => {
  const broken = [
    { RESEND_FROM: undefined },
    { RESEND_FROM: 'onboarding@resend.dev' },
    { RESEND_FROM: 'ForexOrbit <onboarding@resend.dev>' },
    { APP_BASE_URL: undefined },
    { APP_BASE_URL: 'http://app.example.test' },
    { APP_BASE_URL: 'https://app.example.test/some/path' },
    { RESEND_API_KEY: undefined },
  ];
  for (const change of broken) {
    await withProcessEnv({ ...PROD_ENV, ...change }, async () => {
      const h = harness();
      const user = await addUser(h);
      const resend = fakeResend();
      const r = routes(h.db, resend.Resend);
      const output = captureConsole();
      let res;
      try {
        res = await callRoute(r.forgot, { body: { email: user.email } });
      } finally {
        output.restore();
      }
      assert.deepEqual([res.statusCode, res.body], [200, GENERIC], JSON.stringify(change));
      assert.equal(resend.calls.keys.length, 0, 'the Resend client was never created');
      assert.equal(h.db.data[TOKENS].length, 0, 'no link exists');
      assert.equal(output.lines.join('\n').includes(user.email), false);
    });
  }
});

test('through the routes: a Resend error leaves no usable link and is not shown to the caller', async () => {
  await withProcessEnv(PROD_ENV, async () => {
    const h = harness();
    const user = await addUser(h);
    const resend = fakeResend(() => ({ data: null, error: { name: 'validation_error', message: `bad recipient ${user.email}` } }));
    const r = routes(h.db, resend.Resend);
    const output = captureConsole();
    let res;
    try {
      res = await callRoute(r.forgot, { body: { email: user.email } });
    } finally {
      output.restore();
    }
    assert.deepEqual([res.statusCode, res.body], [200, GENERIC]);
    assert.equal(h.db.data[TOKENS].length, 0);
    assert.equal(output.lines.join('\n').includes(user.email), false, 'the provider message is not logged');
    assert.ok(output.lines.some((line) => line.includes('"reason":"send_failed"')));
  });
});

test('the phone reset endpoints are retired with 410 Gone', async () => {
  for (const route of ['pages/api/auth/verify-password-otp.ts', 'pages/api/auth/update-phone.ts', 'pages/api/auth/check-email-config.ts']) {
    const handler = loadModule(route).default;
    for (const method of ['GET', 'POST', 'PATCH']) {
      const res = await callRoute(handler, { method, body: { phone: '+2348031234567', otp: '123456' } });
      assert.equal(res.statusCode, 410, `${route} ${method}`);
      assert.equal(res.body.code, 'phone_reset_retired');
      assert.equal(res.headers['cache-control'], 'no-store');
    }
  }
  // The old request shape is now a malformed email, not a phone lookup.
  const h = harness();
  assert.equal((await h.service.requestReset({ body: { phone: '+2348031234567' }, ip: '203.0.113.10' })).status, 400);
});

test('policies', () => {
  const auth = require('../lib/auth-rate-limit');
  assert.deepEqual(auth.RESET_REQUEST_RULES.map((r) => [r.id, r.max, r.parts]), [
    ['reset-request-ip', 10, ['ip']],
    ['reset-request-email', 5, ['email']],
    ['reset-request-global', 300, []],
  ]);
  assert.deepEqual(auth.RESET_COOLDOWN_RULES.map((r) => [r.id, r.max, r.parts]), [['reset-request-cooldown', 1, ['email']]]);
  assert.equal(auth.RESET_COOLDOWN_WINDOW_MS, 60 * 1000);
  assert.deepEqual(auth.RESET_COMPLETE_RULES.map((r) => [r.id, r.max, r.parts]), [
    ['reset-complete-ip', 10, ['ip']],
    ['reset-complete-ticket', 5, ['ticket']],
  ]);
  assert.equal('RESET_VERIFY_RULES' in auth, false);
  assert.equal(reset.MIN_RESPONSE_MS, 1200);
  assert.equal(tokens.RESET_TOKEN_RETENTION_SECONDS, 24 * 60 * 60);
  assert.ok(require('../lib/app-database-role').READ_WRITE_COLLECTIONS.includes(TOKENS));
});
