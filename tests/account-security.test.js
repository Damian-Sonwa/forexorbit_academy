/**
 * Phase 1–3 remediation, workstreams 1 and 2: signup validation, login timing, the admin user
 * list, onboarding and learning level, password change, sign-out everywhere, profile photos and
 * cross-tab sign-out. Real route handlers run against an in-memory database; email and Cloudinary
 * are recording stubs. Nothing leaves the process.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const realBcrypt = require('bcryptjs');
const { ObjectId } = require('mongodb');

const { loadModule, mockResponse } = require('./helpers/ts-loader');
const { checkSignupFields, NAME_MAX_CHARS } = require('../lib/signup-input');
const { isValidEmail, normalizeEmail } = require('../lib/email-address');
const { checkOnboardingInput } = require('../lib/onboarding-input');
const { ADMIN_USER_LIST_PROJECTION, toAdminUserRow } = require('../lib/admin-user-view');
const security = require('../lib/account-security');
const photos = require('../lib/profile-photo');
const { decideSessionBinding, sessionBinding } = require('../lib/token-core');
const authLimit = require('../lib/auth-rate-limit');

const ROOT = path.join(__dirname, '..');
const SECRET = 'test-only-phase13-secret';
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

// ---------------------------------------------------------------------------
// In-memory database
// ---------------------------------------------------------------------------

const tick = () => new Promise((resolve) => setImmediate(resolve));
const same = (a, b) => (a instanceof ObjectId || b instanceof ObjectId ? String(a) === String(b) : a === b);

function matches(doc, filter) {
  return Object.entries(filter).every(([key, cond]) => {
    const value = doc[key];
    if (cond === null) return value === null || value === undefined;
    if (cond && typeof cond === 'object' && !(cond instanceof ObjectId) && !(cond instanceof Date)) {
      if ('$ne' in cond) return !same(value, cond.$ne);
      throw new Error(`unsupported filter on ${key}`);
    }
    return same(value, cond);
  });
}

function memoryDb({ uniqueEmail = false } = {}) {
  const data = { users: [], passwordResetSecurityLogs: [], rateLimits: [] };
  const calls = { find: [], updateOne: 0, failUpdate: false };
  return {
    data,
    calls,
    collection(name) {
      data[name] = data[name] || [];
      const rows = data[name];
      return {
        find(filter, options = {}) {
          calls.find.push({ name, filter, options });
          let sorted = rows.filter((row) => matches(row, filter));
          const cursor = {
            sort() { sorted = [...sorted].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)); return cursor; },
            limit(n) { sorted = sorted.slice(0, n); return cursor; },
            async toArray() {
              await tick();
              const keep = options.projection ? Object.keys(options.projection) : null;
              return sorted.map((row) => {
                if (!keep) return { ...row };
                const out = { _id: row._id };
                for (const key of keep) if (key in row) out[key] = row[key];
                return out;
              });
            },
          };
          return cursor;
        },
        async findOne(filter) {
          await tick();
          const doc = rows.find((row) => matches(row, filter));
          return doc ? { ...doc } : null;
        },
        async insertOne(doc) {
          await tick();
          if (name === 'users' && uniqueEmail && rows.some((row) => row.email === doc.email)) {
            throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
          }
          const row = { _id: doc._id || new ObjectId(), ...doc };
          rows.push(row);
          return { insertedId: row._id };
        },
        async updateOne(filter, update) {
          await tick();
          calls.updateOne += 1;
          if (name === 'users' && calls.failUpdate) throw new Error('users.updateOne failed');
          const doc = rows.find((row) => matches(row, filter));
          if (!doc) return { matchedCount: 0, modifiedCount: 0 };
          Object.assign(doc, update.$set || {});
          for (const [k, n] of Object.entries(update.$inc || {})) doc[k] = (doc[k] || 0) + n;
          for (const k of Object.keys(update.$unset || {})) delete doc[k];
          return { matchedCount: 1, modifiedCount: 1 };
        },
        async findOneAndUpdate(filter, update) {
          await tick();
          let doc = rows.find((row) => row._id === filter._id);
          if (!doc) {
            doc = { _id: filter._id, count: 0, ...update.$setOnInsert };
            rows.push(doc);
          }
          doc.count += update.$inc.count;
          return { ...doc };
        },
      };
    },
  };
}

async function addUser(db, extra = {}) {
  const user = {
    _id: new ObjectId(),
    email: `person${db.data.users.length + 1}@example.com`,
    password: await realBcrypt.hash('current-pass-1', 4),
    name: 'Person',
    role: 'student',
    status: 'approved',
    sessionGeneration: 3,
    createdAt: new Date(Date.UTC(2026, 0, db.data.users.length + 1)),
    ...extra,
  };
  db.data.users.push(user);
  return user;
}

const row = (db, user) => db.data.users.find((r) => same(r._id, user._id));

function bcryptSpy() {
  const calls = { hash: 0, compare: 0, hashSync: 0 };
  return {
    calls,
    module: {
      ...realBcrypt,
      hash: (value) => { calls.hash += 1; return realBcrypt.hash(value, 4); },
      hashSync: (value) => { calls.hashSync += 1; return realBcrypt.hashSync(value, 4); },
      compare: (...args) => { calls.compare += 1; return realBcrypt.compare(...args); },
    },
  };
}

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

const ENV = { JWT_SECRET: SECRET, SHARED_RATE_LIMIT: undefined, TRUSTED_PROXY_HOPS: undefined, RESEND_API_KEY: undefined, NODE_ENV: 'test' };

function loadRoute(route, db, extra = {}) {
  return loadModule(route, {
    'lib/mongodb': { getDb: async () => db },
    'lib/socket-server': { getSocketServer: () => null },
    ...extra,
  }).default;
}

async function call(handler, { method = 'POST', body, token, ip = '203.0.113.10', query = {} } = {}) {
  const res = mockResponse();
  const headers = { 'x-forwarded-for': ip };
  if (token) headers.authorization = `Bearer ${token}`;
  await handler({ method, headers, body, query, socket: { remoteAddress: '10.0.0.2' } }, res);
  return res;
}

function tokenFor(user, generation = user.sessionGeneration) {
  const { issueAuthToken } = require('../lib/token-core');
  return issueAuthToken({ userId: String(user._id), email: user.email, role: user.role, generation, key: SECRET });
}

function captureConsole() {
  const lines = [];
  const saved = {};
  for (const level of ['log', 'info', 'warn', 'error']) {
    saved[level] = console[level];
    console[level] = (...args) => lines.push(args.map(String).join(' '));
  }
  return { lines, restore: () => Object.assign(console, saved) };
}

// ---------------------------------------------------------------------------
// Signup
// ---------------------------------------------------------------------------

test('signup fields: email format and length, name, and the shared password rule', () => {
  assert.deepEqual(checkSignupFields({ email: '  New.Person@Example.COM ', password: 'long-enough-1', name: '  Ada   Lovelace ' }), {
    ok: true,
    email: 'new.person@example.com',
    name: 'Ada Lovelace',
  });
  const refused = (input) => checkSignupFields({ email: 'a@example.com', password: 'long-enough-1', name: 'Ada', ...input });
  for (const email of ['no-at', 'a@b', 'two@@x.com', 'sp ace@x.com', `${'a'.repeat(250)}@x.com`, 'a@exa\u0000mple.com']) {
    assert.equal(refused({ email }).code, 'invalid_email', email);
  }
  for (const name of ['   ', 'x'.repeat(NAME_MAX_CHARS + 1), '<script>', 'bell\u0007char', 'null\u0000char']) {
    assert.equal(refused({ name }).code, 'invalid_name', JSON.stringify(name));
  }
  // Runs of whitespace, line breaks included, become one space.
  assert.equal(checkSignupFields({ email: 'a@example.com', password: 'long-enough-1', name: 'line\n  break' }).name, 'line break');
  assert.equal(refused({ name: 'x'.repeat(NAME_MAX_CHARS) }).ok, true);
  for (const password of ['seven77', '        ', 'a'.repeat(73)]) assert.equal(refused({ password }).code, 'weak_password');
  for (const bad of [{ email: ['a@example.com'] }, { name: { $ne: '' } }, { password: 12345678 }]) {
    assert.equal(refused(bad).code, 'missing_fields', JSON.stringify(bad));
  }
  assert.equal(isValidEmail(normalizeEmail(' A@B.CO ')), true);
});

test('signup route: weak passwords and malformed input create nothing; valid signups are normalized', async () => {
  await withEnv(ENV, async () => {
    const db = memoryDb();
    const signup = loadRoute('pages/api/auth/signup.ts', db, { bcryptjs: bcryptSpy().module });
    const body = (extra) => ({ email: 'new@example.com', password: 'a-good-password', name: 'New Person', role: 'student', ...extra });
    for (const [extra, code] of [
      [{ password: 'short1' }, 'weak_password'],
      [{ email: 'not-an-email' }, 'invalid_email'],
      [{ name: '<b>x</b>' }, 'invalid_name'],
      [{ password: 'é'.repeat(37) }, 'weak_password'],
    ]) {
      const res = await call(signup, { body: body(extra) });
      assert.deepEqual([res.statusCode, res.body.code], [400, code], JSON.stringify(extra));
    }
    assert.equal((await call(signup, { body: body({ role: 'admin' }) })).body.error, 'Invalid role');
    assert.equal((await call(signup, { body: undefined })).statusCode, 400);
    assert.equal(db.data.users.length, 0);
    assert.equal(db.data.rateLimits.length, 0, 'refused before the rate limits count');

    const ok = await call(signup, { body: body({ email: ' New@Example.com ', name: '  New   Person ' }) });
    assert.equal(ok.statusCode, 201);
    assert.deepEqual([db.data.users[0].email, db.data.users[0].name], ['new@example.com', 'New Person']);
    assert.ok(await realBcrypt.compare('a-good-password', db.data.users[0].password));
  });
});

test('signup route: two simultaneous signups for one address create one account when the unique index exists', async () => {
  await withEnv(ENV, async () => {
    const db = memoryDb({ uniqueEmail: true });
    const signup = loadRoute('pages/api/auth/signup.ts', db, { bcryptjs: bcryptSpy().module });
    const results = await Promise.all([1, 2].map((i) => call(signup, {
      body: { email: 'race@example.com', password: 'a-good-password', name: 'Racer', role: 'student' },
      ip: `203.0.113.${i}`,
    })));
    assert.deepEqual(results.map((r) => r.statusCode).sort(), [201, 400]);
    assert.equal(db.data.users.length, 1);
  });
});

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

test('login: unknown addresses, missing passwords and wrong passwords each cost one bcrypt comparison and look the same', async () => {
  await withEnv(ENV, async () => {
    const db = memoryDb();
    const user = await addUser(db);
    await addUser(db, { email: 'nopass@example.com', password: undefined });
    const spy = bcryptSpy();
    const login = loadRoute('pages/api/auth/login.ts', db, { bcryptjs: spy.module });
    const output = captureConsole();
    const results = [];
    try {
      for (const [email, password] of [['nobody@example.com', 'whatever-1'], ['nopass@example.com', 'whatever-1'], [user.email, 'wrong-pass-1']]) {
        const before = spy.calls.compare;
        const res = await call(login, { body: { email, password }, ip: `198.51.100.${results.length}` });
        assert.equal(spy.calls.compare - before, 1, `${email}: exactly one comparison`);
        results.push([res.statusCode, res.body]);
      }
    } finally {
      output.restore();
    }
    assert.deepEqual(results[0], results[1]);
    assert.deepEqual(results[0], results[2]);
    assert.equal(results[0][0], 401);
    assert.equal(spy.calls.hashSync, 1, 'the placeholder hash is made once, on first use');
    assert.equal(output.lines.join('\n').includes('@example.com'), false, 'no address in the log');
    assert.ok(output.lines.every((line) => /"event":"login_failed"/.test(line)));

    const ok = await call(login, { body: { email: user.email, password: 'current-pass-1' } });
    assert.equal(ok.statusCode, 200);
  });
});

test('login: an oversized password is refused before any lookup or hashing', async () => {
  await withEnv(ENV, async () => {
    const db = memoryDb();
    const user = await addUser(db);
    const spy = bcryptSpy();
    const login = loadRoute('pages/api/auth/login.ts', db, { bcryptjs: spy.module });
    const output = captureConsole();
    let res;
    try {
      res = await call(login, { body: { email: user.email, password: 'x'.repeat(1025) } });
    } finally {
      output.restore();
    }
    assert.equal(res.statusCode, 401);
    assert.equal(spy.calls.compare + spy.calls.hashSync, 0);
    assert.equal(db.data.rateLimits.length, 0, 'local limits only in this test; nothing shared');
  });
});

// ---------------------------------------------------------------------------
// Admin user list
// ---------------------------------------------------------------------------

test('admin user list: only the fields the admin pages use, for admins and Super Admins alike', async () => {
  await withEnv(ENV, async () => {
    const db = memoryDb();
    const admin = await addUser(db, { role: 'admin', email: 'admin@example.com' });
    const superadmin = await addUser(db, { role: 'superadmin', email: 'super@example.com' });
    const student = await addUser(db, {
      phoneE164: '+2348031234567',
      phone: '08031234567',
      profilePhotoPublicId: 'profiles/abc',
      profilePhoto: 'https://res.cloudinary.com/x/abc.jpg',
      studentDetails: { dateOfBirth: '2000-01-01', contactNumber: '+2348031234567' },
      learningLevel: 'beginner',
      isExpert: true,
    });
    await addUser(db, { role: 'admin', email: 'legacy@example.com', status: undefined });
    const list = loadRoute('pages/api/admin/users.ts', db);

    for (const caller of [admin, superadmin]) {
      const res = await call(list, { method: 'GET', token: tokenFor(caller) });
      assert.equal(res.statusCode, 200);
      assert.equal(res.headers['cache-control'], 'no-store');
      for (const item of res.body) {
        assert.deepEqual(Object.keys(item).sort(), ['_id', 'createdAt', 'email', 'id', 'isExpert', 'name', 'role', 'status']);
      }
      const mine = res.body.find((item) => item.id === String(student._id));
      assert.deepEqual(mine, {
        _id: String(student._id), id: String(student._id), name: 'Person', email: student.email,
        role: 'student', status: 'approved', isExpert: true, createdAt: student.createdAt.toISOString(),
      });
      assert.equal(res.body.find((item) => item.email === 'legacy@example.com').status, 'approved');
      const text = JSON.stringify(res.body);
      for (const secret of ['+2348031234567', '08031234567', 'profiles/abc', '2000-01-01', 'password', 'sessionGeneration', 'cloudinary']) {
        assert.equal(text.includes(secret), false, secret);
      }
    }
    assert.deepEqual(db.calls.find.filter((c) => c.name === 'users').map((c) => c.options.projection), [ADMIN_USER_LIST_PROJECTION, ADMIN_USER_LIST_PROJECTION]);
    assert.equal((await call(list, { method: 'GET', token: tokenFor(student) })).statusCode, 403);
    assert.equal((await call(list, { method: 'GET' })).statusCode, 401);
    assert.equal(toAdminUserRow({ _id: 'x', name: 5, email: null, isExpert: 'yes' }).isExpert, false);
  });
});

// ---------------------------------------------------------------------------
// Onboarding and learning level
// ---------------------------------------------------------------------------

const onboardingBody = (extra = {}) => ({
  fullName: 'Ada Learner',
  dateOfBirth: '2000-01-01',
  gender: 'female',
  contactNumber: '+2348031234567',
  educationLevel: 'bachelor',
  certifications: '',
  tradingLevel: 'beginner',
  yearsOfExperience: '0',
  preferredTopics: ['forex basics', 'risk'],
  notificationPreferences: { email: true, sms: false, push: true },
  ...extra,
});

test('onboarding input: types and lengths are checked; nothing but the expected fields is stored', () => {
  const ok = checkOnboardingInput(onboardingBody({ yearsOfExperience: 2, notificationPreferences: { email: false, sms: 'yes', extra: 1 } }));
  assert.equal(ok.ok, true);
  assert.deepEqual(Object.keys(ok.details).sort(), ['certifications', 'contactNumber', 'dateOfBirth', 'educationLevel', 'fullName', 'gender', 'notificationPreferences', 'preferredTopics', 'tradingLevel', 'yearsOfExperience']);
  assert.deepEqual(ok.details.notificationPreferences, { email: false, sms: false, push: true });
  assert.equal(ok.details.yearsOfExperience, '2');
  assert.equal(ok.details.certifications, null);

  for (const [extra, message] of [
    [{ fullName: '' }, /Missing required fields/],
    [{ tradingLevel: 'expert' }, /trading level/],
    [{ fullName: { $set: { role: 'admin' } } }, /fullName/],
    [{ contactNumber: 'x'.repeat(201) }, /contactNumber/],
    [{ preferredTopics: [] }, /at least one/],
    [{ preferredTopics: [{ a: 1 }] }, /topics/],
    [{ preferredTopics: Array.from({ length: 21 }, (_, i) => `t${i}`) }, /topics/],
    [{ notificationPreferences: 'all' }, /notification/],
  ]) {
    const res = checkOnboardingInput(onboardingBody(extra));
    assert.equal(res.ok, false, JSON.stringify(extra));
    assert.match(res.error, message);
  }
});

test('onboarding route: the first answer places the student; later edits cannot raise the level', async () => {
  await withEnv(ENV, async () => {
    const db = memoryDb();
    const student = await addUser(db);
    const onboarding = loadRoute('pages/api/student/onboarding.ts', db);
    const token = tokenFor(student);

    assert.equal((await call(onboarding, { token, body: onboardingBody({ tradingLevel: 'beginner' }) })).statusCode, 200);
    assert.equal(row(db, student).learningLevel, 'beginner');
    assert.equal(row(db, student).name, 'Ada Learner');

    const edit = await call(onboarding, { token, body: onboardingBody({ tradingLevel: 'advanced', fullName: 'Ada L.' }) });
    assert.equal(edit.statusCode, 200);
    assert.equal(row(db, student).learningLevel, 'beginner', 'the level is unchanged');
    assert.equal(row(db, student).studentDetails.tradingLevel, 'advanced', 'the self-description is still saved');
    assert.equal(row(db, student).name, 'Ada L.');

    // A level earned through course progress is kept, whatever the profile says.
    row(db, student).learningLevel = 'intermediate';
    await call(onboarding, { token, body: onboardingBody({ tradingLevel: 'beginner' }) });
    assert.equal(row(db, student).learningLevel, 'intermediate');

    // Rejected input changes nothing; other roles cannot use the route.
    const before = JSON.stringify(row(db, student));
    assert.equal((await call(onboarding, { token, body: onboardingBody({ fullName: ['x'] }) })).statusCode, 400);
    assert.equal(JSON.stringify(row(db, student)), before);
    const instructor = await addUser(db, { role: 'instructor' });
    assert.equal((await call(onboarding, { token: tokenFor(instructor), body: onboardingBody() })).statusCode, 403);
  });
});

test('the Advanced community room still follows learningLevel, which onboarding can no longer raise', () => {
  const { decideCommunityRoomJoin } = require('../lib/account-access');
  const advanced = { _id: new ObjectId(), name: 'Advanced' };
  const decide = (learningLevel, tradingLevel) => decideCommunityRoomJoin({
    user: { role: 'student', status: 'approved', learningLevel, tradingLevel },
    roomId: String(advanced._id),
    room: advanced,
  });
  assert.equal(decide('beginner', 'advanced').ok, false, 'the profile answer does not override the placed level');
  assert.equal(decide('advanced', 'beginner').ok, true);
});

// ---------------------------------------------------------------------------
// Password change and sign-out everywhere
// ---------------------------------------------------------------------------

const changeDeps = { compare: (p, h) => realBcrypt.compare(p, h), hash: (p) => realBcrypt.hash(p, 4) };

test('password change: current password required, rule applied, sessions ended, event logged', async () => {
  const db = memoryDb();
  const user = await addUser(db);
  const change = (currentPassword, newPassword) => security.changePassword(db, { userId: String(user._id), currentPassword, newPassword, ...changeDeps });

  assert.deepEqual(await change('', 'new-password-1'), { ok: false, status: 400, error: 'Enter your current password.', code: 'current_password_required' });
  assert.equal((await change('current-pass-1', 'short')).code, 'weak_password');
  assert.equal((await change('wrong-pass-1', 'new-password-1')).code, 'wrong_password');
  assert.equal((await change('wrong-pass-1', 'new-password-1')).status, 400, 'never 401, which would sign the caller out');
  assert.equal((await change('current-pass-1', 'current-pass-1')).code, 'same_password');
  assert.equal(row(db, user).sessionGeneration, 3, 'nothing changed yet');
  assert.ok(db.data.passwordResetSecurityLogs.some((e) => e.event === 'password_change_refused' && e.detail === 'wrong_password'));

  const done = await change('current-pass-1', 'new-password-1');
  assert.deepEqual([done.ok, done.generation, done.user.email], [true, 4, user.email]);
  assert.ok(await realBcrypt.compare('new-password-1', row(db, user).password));
  assert.equal(row(db, user).sessionGeneration, 4);
  const oldBinding = sessionBinding(String(user._id), 3, SECRET);
  assert.equal(decideSessionBinding({ userId: String(user._id), binding: oldBinding, generation: 4, key: SECRET }).ok, false);
  assert.ok(db.data.passwordResetSecurityLogs.some((e) => e.event === 'password_changed' && same(e.userId, user._id)));
  assert.equal(JSON.stringify(db.data.passwordResetSecurityLogs).includes('new-password-1'), false);
});

test('password change: an inactive account is refused, and two simultaneous changes apply one', async () => {
  const db = memoryDb();
  const suspended = await addUser(db, { status: 'suspended' });
  const refused = await security.changePassword(db, { userId: String(suspended._id), currentPassword: 'current-pass-1', newPassword: 'new-password-1', ...changeDeps });
  assert.deepEqual([refused.status, refused.code], [403, 'account_not_active']);

  const user = await addUser(db);
  const results = await Promise.all(['first-new-pass', 'second-new-pass'].map((p) =>
    security.changePassword(db, { userId: String(user._id), currentPassword: 'current-pass-1', newPassword: p, ...changeDeps })));
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  assert.equal(row(db, user).sessionGeneration, 4, 'raised once');
});

test('password change route: new token for this device, old tokens refused, notice sent, rate limited', async () => {
  await withEnv(ENV, async () => {
    const db = memoryDb();
    const user = await addUser(db);
    const notices = [];
    const emailStub = { sendPasswordChangedEmail: async (input) => { notices.push(input); return { ok: true }; } };
    const route = loadRoute('pages/api/auth/change-password.ts', db, { 'lib/email': emailStub, bcryptjs: bcryptSpy().module });
    const me = loadRoute('pages/api/auth/me.ts', db);
    const oldToken = tokenFor(user);

    const wrong = await call(route, { token: oldToken, body: { currentPassword: 'nope-nope-1', newPassword: 'new-password-1' } });
    assert.deepEqual([wrong.statusCode, wrong.body.code], [400, 'wrong_password']);
    assert.equal(notices.length, 0);

    const ok = await call(route, { token: oldToken, body: { currentPassword: 'current-pass-1', newPassword: 'new-password-1' } });
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.headers['cache-control'], 'no-store');
    assert.equal((await call(me, { method: 'GET', token: oldToken })).statusCode, 401, 'old sessions are ended');
    assert.equal((await call(me, { method: 'GET', token: ok.body.token })).statusCode, 200, 'this device stays signed in');
    assert.deepEqual(notices.map((n) => [n.to, n.method]), [[user.email, 'settings']]);
    assert.equal(notices[0].idempotencyKey, `password-changed/settings/${user._id}/4`);

    // Five attempts per account per window; the sixth is refused before the password is checked.
    for (let i = 0; i < 3; i += 1) {
      await call(route, { token: ok.body.token, body: { currentPassword: 'nope-nope-1', newPassword: 'x-new-pass-1' }, ip: `198.51.100.${i}` });
    }
    const limited = await call(route, { token: ok.body.token, body: { currentPassword: 'nope-nope-1', newPassword: 'x-new-pass-1' } });
    assert.equal(limited.statusCode, 429);
    assert.equal((await call(route, { method: 'GET', token: ok.body.token })).statusCode, 405);
    assert.equal((await call(route, { body: {} })).statusCode, 401);
  });
});

test('sign out everywhere: every token, including the caller\'s, stops working', async () => {
  await withEnv(ENV, async () => {
    const db = memoryDb();
    const user = await addUser(db);
    const route = loadRoute('pages/api/auth/logout-all.ts', db);
    const me = loadRoute('pages/api/auth/me.ts', db);
    const tabA = tokenFor(user);
    const tabB = tokenFor(user);
    const res = await call(route, { token: tabA });
    assert.equal(res.statusCode, 200);
    assert.equal(row(db, user).sessionGeneration, 4);
    for (const token of [tabA, tabB]) assert.equal((await call(me, { method: 'GET', token })).statusCode, 401);
    assert.ok(db.data.passwordResetSecurityLogs.some((e) => e.event === 'signed_out_everywhere'));
    assert.equal((await call(route, { token: tabA })).statusCode, 401, 'cannot be repeated with an ended session');
    assert.equal((await call(route, { method: 'GET', token: tokenFor(row(db, user)) })).statusCode, 405);
  });
});

test('password change and the reset share one password rule and one rate-limit module', () => {
  assert.deepEqual(authLimit.PASSWORD_CHANGE_RULES.map((r) => [r.id, r.max, r.parts]), [
    ['password-change-ip', 20, ['ip']],
    ['password-change-account', 5, ['email']],
  ]);
  for (const file of ['lib/account-security.js', 'lib/signup-input.js', 'lib/password-reset.js']) {
    assert.match(read(file), /checkNewPassword/, file);
  }
});

// ---------------------------------------------------------------------------
// Profile photo
// ---------------------------------------------------------------------------

function storage({ failFor = [] } = {}) {
  const deleted = [];
  return {
    deleted,
    deleteImage: async (publicId) => {
      await tick();
      if (failFor.includes(publicId)) throw new Error(`cloudinary said no about ${publicId}`);
      deleted.push(publicId);
    },
  };
}

test('replacing a photo records the new one first, then deletes the old one', async () => {
  const db = memoryDb();
  const user = await addUser(db, { profilePhoto: 'https://img/old.jpg', profilePhotoPublicId: 'profiles/old' });
  const store = storage();
  const previous = await photos.currentPhotoId(db, String(user._id));
  assert.equal(previous, 'profiles/old');
  const res = await photos.replaceProfilePhoto(db, { userId: String(user._id), previousPublicId: previous, upload: { secureUrl: 'https://img/new.jpg', publicId: 'profiles/new' }, deleteImage: store.deleteImage });
  assert.deepEqual(res, { ok: true });
  assert.deepEqual([row(db, user).profilePhoto, row(db, user).profilePhotoPublicId], ['https://img/new.jpg', 'profiles/new']);
  assert.deepEqual(store.deleted, ['profiles/old']);
  assert.equal(await photos.currentPhotoId(db, String(new ObjectId())), null);
});

test('a failed or overtaken update deletes the new upload and keeps the photo in use', async () => {
  const db = memoryDb();
  const user = await addUser(db, { profilePhoto: 'https://img/old.jpg', profilePhotoPublicId: 'profiles/old' });
  const store = storage();
  db.calls.failUpdate = true;
  await assert.rejects(photos.replaceProfilePhoto(db, { userId: String(user._id), previousPublicId: 'profiles/old', upload: { secureUrl: 'u', publicId: 'profiles/new1' }, deleteImage: store.deleteImage }), /users.updateOne failed/);
  assert.deepEqual(store.deleted, ['profiles/new1']);
  assert.equal(row(db, user).profilePhotoPublicId, 'profiles/old', 'the photo in use is untouched');
  db.calls.failUpdate = false;

  // Two uploads at once: the second finds the record already changed.
  const [a, b] = await Promise.all(['profiles/a', 'profiles/b'].map((publicId) =>
    photos.replaceProfilePhoto(db, { userId: String(user._id), previousPublicId: 'profiles/old', upload: { secureUrl: publicId, publicId }, deleteImage: store.deleteImage })));
  assert.deepEqual([a.ok, b.ok].sort(), [false, true]);
  const winner = a.ok ? 'profiles/a' : 'profiles/b';
  const loser = a.ok ? 'profiles/b' : 'profiles/a';
  assert.equal(row(db, user).profilePhotoPublicId, winner);
  assert.ok(store.deleted.includes(loser), 'the overtaken upload is deleted');
  assert.ok(store.deleted.includes('profiles/old'));
  assert.equal(store.deleted.includes(winner), false);
});

test('a storage failure is logged by account id and does not undo the change', async () => {
  const db = memoryDb();
  const user = await addUser(db, { profilePhoto: 'x', profilePhotoPublicId: 'profiles/old' });
  const store = storage({ failFor: ['profiles/old'] });
  const output = captureConsole();
  let res;
  try {
    res = await photos.replaceProfilePhoto(db, { userId: String(user._id), previousPublicId: 'profiles/old', upload: { secureUrl: 'y', publicId: 'profiles/new' }, deleteImage: store.deleteImage });
  } finally {
    output.restore();
  }
  assert.equal(res.ok, true);
  assert.equal(row(db, user).profilePhotoPublicId, 'profiles/new');
  assert.deepEqual(output.lines.map((l) => JSON.parse(l)), [{ event: 'profile_photo_cleanup_failed', stage: 'replaced_photo', userId: String(user._id) }]);
});

test('removing a photo clears the record, then deletes the file; nothing to remove is not an error', async () => {
  const db = memoryDb();
  const user = await addUser(db, { profilePhoto: 'https://img/p.jpg', profilePhotoPublicId: 'profiles/p' });
  const store = storage();
  assert.deepEqual(await photos.removeProfilePhoto(db, { userId: String(user._id), deleteImage: store.deleteImage }), { ok: true, removed: true });
  assert.equal('profilePhoto' in row(db, user), false);
  assert.equal('profilePhotoPublicId' in row(db, user), false);
  assert.deepEqual(store.deleted, ['profiles/p']);
  assert.deepEqual(await photos.removeProfilePhoto(db, { userId: String(user._id), deleteImage: store.deleteImage }), { ok: true, removed: false });

  const legacy = await addUser(db, { profilePhoto: 'https://img/legacy.jpg' });
  assert.deepEqual(await photos.removeProfilePhoto(db, { userId: String(legacy._id), deleteImage: store.deleteImage }), { ok: true, removed: true });
  assert.deepEqual(store.deleted, ['profiles/p'], 'no file id, so no storage call');
  assert.equal((await photos.removeProfilePhoto(db, { userId: String(new ObjectId()), deleteImage: store.deleteImage })).status, 404);
});

test('the photo route accepts POST and DELETE for the signed-in account only', async () => {
  await withEnv(ENV, async () => {
    const db = memoryDb();
    const user = await addUser(db, { profilePhoto: 'https://img/p.jpg', profilePhotoPublicId: 'profiles/p' });
    const other = await addUser(db, { profilePhoto: 'https://img/o.jpg', profilePhotoPublicId: 'profiles/o' });
    const store = storage();
    const route = loadRoute('pages/api/upload/profile.ts', db, {
      'lib/cloudinary': { deleteImage: store.deleteImage, uploadImageFromPath: async () => { throw new Error('not used'); }, validateImageFile: () => ({ valid: true }), isCloudinaryConfigured: () => true },
    });
    const res = await call(route, { method: 'DELETE', token: tokenFor(user), query: { userId: String(other._id) }, body: { userId: String(other._id) } });
    assert.deepEqual([res.statusCode, res.body], [200, { success: true, removed: true }]);
    assert.equal('profilePhoto' in row(db, user), false);
    assert.equal(row(db, other).profilePhotoPublicId, 'profiles/o', 'ids in the request are ignored');
    assert.equal((await call(route, { method: 'PUT', token: tokenFor(user) })).statusCode, 405);
    assert.equal((await call(route, { method: 'DELETE' })).statusCode, 401);
  });
});

// ---------------------------------------------------------------------------
// Email template and cross-tab sign-out
// ---------------------------------------------------------------------------

test('the password changed notice describes how the password was changed', () => {
  const { passwordChangedEmail } = loadModule('lib/email-templates.ts');
  const settings = passwordChangedEmail({ name: 'Ada', forgotPasswordUrl: 'https://app.example.test/forgot-password', method: 'settings' });
  assert.match(settings.text, /changed in your account settings/);
  assert.match(settings.text, /every other device has been signed out/);
  const viaLink = passwordChangedEmail({ name: 'Ada', forgotPasswordUrl: 'https://app.example.test/forgot-password' });
  assert.match(viaLink.text, /using a reset link/);
});

test('signing out in one tab signs out the others', () => {
  const source = read('hooks/useAuth.tsx');
  assert.match(source, /window\.addEventListener\('storage', onStorage\)/);
  assert.match(source, /if \(!localStorage\.getItem\('token'\)\) setUser\(null\);/);
  assert.match(source, /window\.removeEventListener\('storage', onStorage\)/);
});

// ---------------------------------------------------------------------------
// Frontend and backend together: the profile-page controls drive the real routes in the order
// and with the bodies the components send (checked against the component source below).
// In-memory database; no browser, no real MongoDB.
// ---------------------------------------------------------------------------

test('profile controls send what the routes expect', () => {
  const security = read('components/AccountSecurity.tsx');
  assert.match(security, /apiClient\.post<\{ message: string; token: string \}>\('\/auth\/change-password', \{ currentPassword, newPassword \}\)/);
  assert.match(security, /localStorage\.setItem\('token', res\.token\)/, 'this tab keeps working with the new token');
  assert.match(security, /checkNewPassword\(newPassword\)/, 'same rule as the server before sending');
  assert.match(security, /await apiClient\.post\('\/auth\/logout-all'\);\s*logout\(\);\s*router\.push\('\/login'\);/);
  const profile = read('pages/profile.tsx');
  assert.match(profile, /<AccountSecurity \/>/);
  assert.match(profile, /await apiClient\.delete\('\/upload\/profile'\);/);
  assert.match(profile, /\{formData\.profilePhoto && !selectedPhoto && isEditing && \(/);
});

test('sign in, change password, sign out everywhere, sign in again, remove photo: the full journey', async () => {
  await withEnv(ENV, async () => {
    const db = memoryDb();
    const user = await addUser(db, { profilePhoto: 'https://img/p.jpg', profilePhotoPublicId: 'profiles/p' });
    const store = storage();
    const bcrypt = bcryptSpy().module;
    const login = loadRoute('pages/api/auth/login.ts', db, { bcryptjs: bcrypt });
    const me = loadRoute('pages/api/auth/me.ts', db);
    const change = loadRoute('pages/api/auth/change-password.ts', db, { bcryptjs: bcrypt, 'lib/email': { sendPasswordChangedEmail: async () => ({ ok: true }) } });
    const logoutAll = loadRoute('pages/api/auth/logout-all.ts', db);
    const photo = loadRoute('pages/api/upload/profile.ts', db, {
      'lib/cloudinary': { deleteImage: store.deleteImage, uploadImageFromPath: async () => { throw new Error('not used'); }, validateImageFile: () => ({ valid: true }), isCloudinaryConfigured: () => true },
    });

    // Two devices signed in.
    const phone = (await call(login, { body: { email: user.email, password: 'current-pass-1' } })).body.token;
    const laptop = (await call(login, { body: { email: user.email, password: 'current-pass-1' }, ip: '198.51.100.7' })).body.token;

    // Laptop changes the password: laptop keeps working with the returned token, phone is signed out.
    const changed = await call(change, { token: laptop, body: { currentPassword: 'current-pass-1', newPassword: 'brand-new-pass' } });
    assert.equal(changed.statusCode, 200);
    let laptopToken = changed.body.token;
    assert.equal((await call(me, { method: 'GET', token: laptopToken })).statusCode, 200);
    assert.equal((await call(me, { method: 'GET', token: phone })).statusCode, 401);
    assert.equal((await call(login, { body: { email: user.email, password: 'current-pass-1' } })).statusCode, 401);

    // Remove the photo from the laptop.
    assert.equal((await call(photo, { method: 'DELETE', token: laptopToken })).statusCode, 200);
    assert.equal((await call(me, { method: 'GET', token: laptopToken })).body.profilePhoto, null);
    assert.deepEqual(store.deleted, ['profiles/p']);

    // Sign out everywhere ends the laptop's session too; signing in again works with the new password.
    assert.equal((await call(logoutAll, { token: laptopToken })).statusCode, 200);
    assert.equal((await call(me, { method: 'GET', token: laptopToken })).statusCode, 401);
    const again = await call(login, { body: { email: user.email, password: 'brand-new-pass' } });
    assert.equal(again.statusCode, 200);
    laptopToken = again.body.token;
    assert.equal((await call(me, { method: 'GET', token: laptopToken })).statusCode, 200);
    assert.equal(row(db, user).sessionGeneration, 5, 'raised by the change and by sign-out everywhere');
  });
});

// ---------------------------------------------------------------------------
// Suspension and reactivation (Super Admin only)
// ---------------------------------------------------------------------------

const approval = require('../lib/account-approval');
const { AUDIT_COLLECTION } = require('../lib/course-payment');
const NOW = new Date('2026-10-31T09:00:00Z');

async function statusSetup() {
  const db = memoryDb();
  const superadmin = await addUser(db, { role: 'superadmin', email: 'super@example.com' });
  const admin = await addUser(db, { role: 'admin', email: 'admin@example.com' });
  const student = await addUser(db, { email: 'student@example.com' });
  return { db, superadmin, admin, student };
}
const actorOf = (u) => ({ userId: String(u._id), email: u.email, role: u.role });
const setStatus = (db, actor, target, action, reason = 'Reported abuse in community chat') =>
  approval.changeAccountStatus(db, { actor: actorOf(actor), userId: String(target._id), action, reason, now: NOW });

test('suspension: only the Super Admin, never itself or a Super Admin, with a reason', async () => {
  const { db, superadmin, admin, student } = await statusSetup();
  for (const caller of [admin, student, await addUser(db, { role: 'instructor' })]) {
    const res = await setStatus(db, caller, student, 'suspend');
    assert.deepEqual([res.status, res.code], [403, 'superadmin_required']);
  }
  assert.equal((await setStatus(db, superadmin, superadmin, 'suspend')).code, 'self_status_change');
  const other = await addUser(db, { role: 'superadmin' });
  assert.equal((await setStatus(db, superadmin, other, 'suspend')).code, 'superadmin_protected');
  for (const reason of [undefined, null, '', '  a ', 'x'.repeat(501), 'bad\u0000char', ['why']]) {
    const res = await approval.changeAccountStatus(db, { actor: actorOf(superadmin), userId: String(student._id), action: 'suspend', reason, now: NOW });
    assert.equal(res.code, 'invalid_reason', JSON.stringify(reason));
  }
  for (const action of ['ban', 'delete', '', undefined, ['suspend']]) {
    assert.equal((await setStatus(db, superadmin, student, action)).code, 'invalid_action');
  }
  assert.equal((await approval.changeAccountStatus(db, { actor: actorOf(superadmin), userId: 'nope', action: 'suspend', reason: 'valid reason' })).code, 'invalid_user_id');
  assert.equal((await approval.changeAccountStatus(db, { actor: actorOf(superadmin), userId: String(new ObjectId()), action: 'suspend', reason: 'valid reason' })).status, 404);
  assert.equal(row(db, student).status, 'approved');
  assert.equal((db.data[AUDIT_COLLECTION] || []).length, 0, 'refusals are not audited');
});

test('suspending ends every session; reactivating restores access without reviving old sessions', async () => {
  const { db, superadmin, student } = await statusSetup();
  const suspended = await setStatus(db, superadmin, student, 'suspend');
  assert.deepEqual(suspended, { ok: true, status: 200, user: { id: String(student._id), role: 'student', status: 'suspended' } });
  assert.equal(row(db, student).status, 'suspended');
  assert.equal(row(db, student).sessionGeneration, 4, 'every session ends');
  assert.equal(row(db, student).suspendedById, String(superadmin._id));
  const { _id: auditId, ...entry } = db.data[AUDIT_COLLECTION][0];
  assert.ok(auditId);
  assert.deepEqual(entry, {
    entityType: 'account',
    entityId: String(student._id),
    reference: null,
    action: 'account_suspended',
    reason: 'Reported abuse in community chat',
    before: { status: 'approved', role: 'student' },
    after: { status: 'suspended', role: 'student' },
    actor: { userId: String(superadmin._id), email: 'super@example.com' },
    createdAt: NOW,
  });
  assert.equal((await setStatus(db, superadmin, student, 'suspend')).code, 'invalid_transition', 'already suspended');

  const back = await setStatus(db, superadmin, student, 'reactivate', 'Reinstated by the owner');
  assert.equal(back.user.status, 'approved');
  assert.equal(row(db, student).status, 'approved');
  assert.equal(row(db, student).sessionGeneration, 4, 'old sessions stay ended');
  assert.equal('suspendedAt' in row(db, student), false);
  assert.equal(db.data[AUDIT_COLLECTION][1].action, 'account_reactivated');
  assert.equal(db.data[AUDIT_COLLECTION][1].reason, 'Reinstated by the owner');
  assert.equal((await setStatus(db, superadmin, student, 'reactivate')).code, 'invalid_transition', 'not suspended');
});

test('suspension does not touch the approval flow, and works on records without a status', async () => {
  const { db, superadmin } = await statusSetup();
  for (const status of ['pending', 'rejected']) {
    const target = await addUser(db, { status, role: 'instructor' });
    assert.equal((await setStatus(db, superadmin, target, 'suspend')).code, 'invalid_transition', status);
    assert.equal((await setStatus(db, superadmin, target, 'reactivate')).code, 'invalid_transition', status);
    assert.equal(row(db, target).status, status);
  }
  const legacy = await addUser(db, { role: 'admin' });
  delete row(db, legacy).status;
  assert.equal((await setStatus(db, superadmin, legacy, 'suspend')).user.status, 'suspended');
  assert.deepEqual(db.data[AUDIT_COLLECTION].at(-1).before, { status: 'approved', role: 'admin' });
});

test('two simultaneous suspensions apply one; an audit failure is reported, never silent', async () => {
  const { db, superadmin, student } = await statusSetup();
  const results = await Promise.all([1, 2].map(() => setStatus(db, superadmin, student, 'suspend')));
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  assert.equal(row(db, student).sessionGeneration, 4, 'raised once');
  assert.equal(db.data[AUDIT_COLLECTION].length, 1);

  const other = await addUser(db);
  const base = db.collection.bind(db);
  db.collection = (name) => {
    const col = base(name);
    if (name === AUDIT_COLLECTION) col.insertOne = async () => { throw new Error('audit store unavailable'); };
    return col;
  };
  const res = await setStatus(db, superadmin, other, 'suspend');
  assert.deepEqual([res.status, res.code, res.decisionSaved], [500, 'audit_write_failed', true]);
  assert.equal(row(db, other).status, 'suspended', 'the suspension stands');
});

test('through the routes: a suspended account is signed out, cannot sign in or get a reset link, and comes back when reactivated', async () => {
  await withEnv(ENV, async () => {
    const { db, superadmin, admin, student } = await statusSetup();
    const route = loadRoute('pages/api/admin/users/[id].ts', db);
    const me = loadRoute('pages/api/auth/me.ts', db);
    const login = loadRoute('pages/api/auth/login.ts', db, { bcryptjs: bcryptSpy().module });
    const patch = (caller, body) => call(route, { method: 'PATCH', token: tokenFor(row(db, caller)), query: { id: String(student._id) }, body });
    const studentToken = (await call(login, { body: { email: student.email, password: 'current-pass-1' } })).body.token;
    assert.equal((await call(me, { method: 'GET', token: studentToken })).statusCode, 200);

    assert.equal((await patch(admin, { action: 'suspend', reason: 'admin tries' })).statusCode, 403);
    assert.equal((await patch(student, { action: 'reactivate', reason: 'self help' })).statusCode, 403);
    const res = await patch(superadmin, { action: 'suspend', reason: 'Owner instruction' });
    assert.deepEqual([res.statusCode, res.body.user.status], [200, 'suspended']);

    // While suspended, the middleware refuses on status first (403); the session is refused either way.
    assert.equal((await call(me, { method: 'GET', token: studentToken })).statusCode, 403, 'existing session refused');
    const refused = await call(login, { body: { email: student.email, password: 'current-pass-1' } });
    assert.deepEqual([refused.statusCode, refused.body.error], [403, 'Account is not active']);

    // Password reset cannot be used to get back in.
    const mails = [];
    const resetService = require('../lib/password-reset').createPasswordResetService({
      getDb: async () => db,
      mailer: {
        passwordResetEmailReady: () => ({ ok: true }),
        sendPasswordResetEmail: async (m) => { mails.push(m); return { ok: true }; },
        sendPasswordChangedEmail: async () => ({ ok: true }),
      },
      env: { JWT_SECRET: SECRET },
      sleep: async () => {},
    });
    assert.equal((await resetService.requestReset({ body: { email: student.email }, ip: '203.0.113.99' })).status, 200);
    assert.equal(mails.length, 0, 'no reset link for a suspended account');

    assert.equal((await patch(superadmin, { action: 'reactivate', reason: 'Owner instruction' })).statusCode, 200);
    assert.equal((await call(me, { method: 'GET', token: studentToken })).statusCode, 401, 'the old session stays ended');
    assert.equal((await call(login, { body: { email: student.email, password: 'current-pass-1' } })).statusCode, 200);
    assert.deepEqual(db.data[AUDIT_COLLECTION].map((e) => e.action), ['account_suspended', 'account_reactivated']);
  });
});

test('the admin page offers Suspend and Reactivate to the Super Admin only, with a reason', () => {
  const page = read('pages/admin/index.tsx');
  assert.match(page, /\{isSuperAdmin && userItem\.role !== 'superadmin' && user\?\.id !== \(userItem\._id \|\| userItem\.id\) &&/);
  assert.match(page, /apiClient\.patch<ApiResponse>\(`\/admin\/users\/\$\{userId\}`, \{ action, reason \}\)/);
  assert.match(page, /const reason = prompt\(/);
  // The H3 delete control is unchanged.
  assert.match(page, /\{isSuperAdmin && \(\s*<button\s*onClick=\{\(\) => handleDeleteUser\(userItem\._id \|\| userItem\.id\)\}/);
});

// ---------------------------------------------------------------------------
// Forum posts show authors by name, not email
// ---------------------------------------------------------------------------

test('forum posts and replies name their authors without exposing email addresses', async () => {
  await withEnv(ENV, async () => {
    const db = memoryDb();
    const author = await addUser(db, { name: 'Poster', email: 'poster.private@example.com' });
    const replier = await addUser(db, { name: 'Replier', email: 'replier.private@example.com' });
    const reader = await addUser(db, { email: 'reader@example.com' });
    const postId = new ObjectId();
    db.data.forumPosts = [
      { _id: postId, userId: String(author._id), content: 'Question', createdAt: new Date(2) },
      { _id: new ObjectId(), userId: String(replier._id), parentPostId: String(postId), content: 'Answer', createdAt: new Date(3) },
    ];
    const forums = loadRoute('pages/api/forums/index.ts', db);
    const res = await call(forums, { method: 'GET', token: tokenFor(reader) });
    assert.equal(res.statusCode, 200);
    const text = JSON.stringify(res.body);
    assert.equal(text.includes('poster.private@example.com'), false);
    assert.equal(text.includes('replier.private@example.com'), false);
    assert.ok(text.includes('"name":"Poster"'));
    assert.ok(text.includes('"name":"Replier"'));
  });
});
