'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const bcrypt = require('bcryptjs');
const { ObjectId } = require('mongodb');

const seedDev = require('../scripts/seed-dev');

const {
  SEED_COLLECTIONS,
  GUARDED_COLLECTIONS,
  SeedRefusal,
  SeedStageError,
  validateDemoPassword,
  loadAppEnvFiles,
  resolveDevConfig,
  verifyConnectionIdentity,
  main,
} = seedDev;

const DB = 'Forex_elearning_dev';
const PASSWORD = 'test-only-demo-pass-123';
const DEV_URI = 'mongodb://forexorbit_dev:not-a-real-secret@dev.example.invalid/Forex_elearning_dev';

function emptyRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'seed-dev-test-'));
}

function devEnv(overrides = {}) {
  return { MONGO_URI: DEV_URI, MONGODB_DB_NAME: DB, DEMO_SEED_PASSWORD: PASSWORD, ...overrides };
}

function goodStatus() {
  return {
    ok: 1,
    authInfo: {
      authenticatedUsers: [{ user: 'forexorbit_dev', db: 'admin' }],
      authenticatedUserRoles: [{ role: 'readWrite', db: DB }],
      authenticatedUserPrivileges: [
        { resource: { db: DB, collection: '' }, actions: ['find', 'insert', 'update', 'remove'] },
      ],
    },
  };
}

function fakeMongo({ status = goodStatus(), commandError = null, seedDocs = {}, failInsertOn = null } = {}) {
  const store = new Map();
  for (const [name, docs] of Object.entries(seedDocs)) store.set(name, docs.slice());
  const writes = [];
  const state = { constructed: 0, connected: false, closed: false, dbNames: [], writes, store };

  const collection = (name) => ({
    async countDocuments(_filter, options = {}) {
      const size = (store.get(name) || []).length;
      return options.limit ? Math.min(size, options.limit) : size;
    },
    async insertMany(docs) {
      if (failInsertOn === name) throw Object.assign(new Error('simulated'), { codeName: 'SimulatedFailure' });
      writes.push({ collection: name, count: docs.length });
      const target = store.get(name) || [];
      const insertedIds = {};
      docs.forEach((doc, i) => {
        insertedIds[i] = new ObjectId();
        target.push({ ...doc, _id: insertedIds[i] });
      });
      store.set(name, target);
      return { insertedIds };
    },
  });

  class FakeClient {
    constructor() {
      state.constructed += 1;
    }
    async connect() {
      state.connected = true;
    }
    db(name) {
      state.dbNames.push(name);
      return {
        collection,
        async command() {
          if (commandError) throw commandError;
          return status;
        },
      };
    }
    async close() {
      state.closed = true;
    }
  }
  return { MongoClient: FakeClient, state };
}

async function refusalCode(promise) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof SeedRefusal) return error.code;
    throw error;
  }
  return null;
}

function captureLog() {
  const lines = [];
  return { lines, log: (line) => lines.push(String(line)) };
}

test('database-name guard requires exactly Forex_elearning_dev with no shared fallback', () => {
  const code = (env) => {
    try {
      resolveDevConfig(env);
      return 'ok';
    } catch (error) {
      return error.code;
    }
  };
  assert.equal(code(devEnv()), 'ok');
  assert.equal(code(devEnv({ MONGODB_DB_NAME: '  Forex_elearning_dev  ' })), 'ok');
  assert.equal(code(devEnv({ MONGODB_DB_NAME: undefined })), 'wrong_database');
  assert.equal(code(devEnv({ MONGODB_DB_NAME: '' })), 'wrong_database');
  assert.equal(code(devEnv({ MONGODB_DB_NAME: 'Forex_elearning' })), 'wrong_database');
  assert.equal(code(devEnv({ MONGODB_DB_NAME: 'forex_elearning_dev' })), 'wrong_database');
  assert.equal(
    code(devEnv({ MONGO_URI: 'mongodb://forexorbit_dev:x@dev.example.invalid/Forex_elearning' })),
    'wrong_uri_database'
  );
  assert.equal(code(devEnv({ MONGO_URI: 'mongodb://forexorbit_dev:x@dev.example.invalid/' })), 'ok');
  assert.equal(code(devEnv({ NODE_ENV: 'production' })), 'production_env');
});

test('URI is resolved like the app (MONGO_URI, then MONGODB_URI) and ambiguity is refused', () => {
  const viaFallback = resolveDevConfig(devEnv({ MONGO_URI: undefined, MONGODB_URI: DEV_URI }));
  assert.equal(viaFallback.dbName, DB);
  assert.throws(
    () => resolveDevConfig(devEnv({ MONGODB_URI: 'mongodb://forexorbit_dev:y@other.example.invalid/' })),
    (error) => error.code === 'ambiguous_uri'
  );
  assert.throws(() => resolveDevConfig(devEnv({ MONGO_URI: undefined })), (error) => error.code === 'missing_uri');
  assert.throws(() => resolveDevConfig(devEnv({ MONGO_URI: 'http://x' })), (error) => error.code === 'invalid_uri');
});

test('username guard requires exactly forexorbit_dev in the configured URI', () => {
  // The commit guard rejects literal URIs that name the production user.
  const productionUser = 'forexorbit_app';
  for (const uri of [
    `mongodb://${productionUser}:x@dev.example.invalid/Forex_elearning_dev`,
    'mongodb://Forexorbit_dev:x@dev.example.invalid/Forex_elearning_dev',
    'mongodb://dev.example.invalid/Forex_elearning_dev',
    'mongodb://localhost:27017/Forex_elearning_dev',
  ]) {
    assert.throws(() => resolveDevConfig(devEnv({ MONGO_URI: uri })), (error) => error.code === 'wrong_username');
  }
});

test('refusal messages never contain the URI or credentials', () => {
  try {
    resolveDevConfig(devEnv({ MONGODB_DB_NAME: 'other' }));
    assert.fail('expected refusal');
  } catch (error) {
    assert.ok(!error.message.includes('not-a-real-secret'));
    assert.ok(!error.message.includes('example.invalid'));
  }
});

test('missing or weak DEMO_SEED_PASSWORD is refused before any connection', async () => {
  for (const value of [undefined, '', 'short', '   eleven-ch   ', 12345678901234]) {
    assert.throws(() => validateDemoPassword(value), (error) => error.code === 'weak_password');
  }
  assert.equal(validateDemoPassword(PASSWORD), PASSWORD);

  const { MongoClient, state } = fakeMongo();
  const code = await refusalCode(main({ env: devEnv({ DEMO_SEED_PASSWORD: 'too-short' }), root: emptyRoot(), MongoClient, log: () => {} }));
  assert.equal(code, 'weak_password');
  assert.equal(state.constructed, 0);
});

test('DEMO_SEED_PASSWORD in an env file is ignored; it must come from the terminal', async () => {
  const root = emptyRoot();
  fs.writeFileSync(path.join(root, '.env'), `DEMO_SEED_PASSWORD=${PASSWORD}\nMONGODB_DB_NAME=${DB}\n`);
  const env = devEnv({ DEMO_SEED_PASSWORD: undefined, MONGODB_DB_NAME: undefined });
  loadAppEnvFiles(root, env);
  assert.equal(env.DEMO_SEED_PASSWORD, undefined);
  assert.equal(env.MONGODB_DB_NAME, DB);

  const { MongoClient, state } = fakeMongo();
  const code = await refusalCode(main({ env: devEnv({ DEMO_SEED_PASSWORD: undefined }), root, MongoClient, log: () => {} }));
  assert.equal(code, 'weak_password');
  assert.equal(state.constructed, 0);
});

test('env files never override values already set in the terminal, and .env.local wins over .env', () => {
  const root = emptyRoot();
  fs.writeFileSync(path.join(root, '.env'), 'MONGODB_DB_NAME=from-dotenv\nEXTRA_ONE=a\n');
  fs.writeFileSync(path.join(root, '.env.local'), 'MONGODB_DB_NAME=from-local\nEXTRA_TWO=b\n');
  const env = { MONGODB_DB_NAME: DB };
  loadAppEnvFiles(root, env);
  assert.equal(env.MONGODB_DB_NAME, DB);
  assert.equal(env.EXTRA_TWO, 'b');
  assert.equal(env.EXTRA_ONE, undefined);
});

test('identity verification accepts only a single forexorbit_dev user scoped to the dev database', () => {
  const config = { dbName: DB, username: 'forexorbit_dev' };
  assert.equal(verifyConnectionIdentity(goodStatus(), config), true);

  const variants = {
    'no authInfo': () => ({ ok: 1 }),
    'null status': () => null,
    'wrong user': (s) => { s.authInfo.authenticatedUsers = [{ user: 'forexorbit_app', db: 'admin' }]; },
    'two users': (s) => { s.authInfo.authenticatedUsers.push({ user: 'other', db: 'admin' }); },
    'no users': (s) => { s.authInfo.authenticatedUsers = []; },
    'no roles': (s) => { s.authInfo.authenticatedUserRoles = []; },
    'role on another db': (s) => { s.authInfo.authenticatedUserRoles.push({ role: 'read', db: 'Forex_elearning' }); },
    'admin-wide role': (s) => { s.authInfo.authenticatedUserRoles = [{ role: 'readWriteAnyDatabase', db: 'admin' }]; },
    'dbOwner role': (s) => { s.authInfo.authenticatedUserRoles = [{ role: 'dbOwner', db: DB }]; },
    'read only': (s) => { s.authInfo.authenticatedUserRoles = [{ role: 'read', db: DB }]; },
    'privileges missing': (s) => { delete s.authInfo.authenticatedUserPrivileges; },
    'cluster privilege': (s) => { s.authInfo.authenticatedUserPrivileges.push({ resource: { cluster: true }, actions: ['listDatabases'] }); },
    'any resource': (s) => { s.authInfo.authenticatedUserPrivileges.push({ resource: { anyResource: true }, actions: ['find'] }); },
    'all databases': (s) => { s.authInfo.authenticatedUserPrivileges.push({ resource: { db: '', collection: '' }, actions: ['find'] }); },
    'other database privilege': (s) => { s.authInfo.authenticatedUserPrivileges.push({ resource: { db: 'Forex_elearning', collection: '' }, actions: ['find'] }); },
    'no insert action': (s) => { s.authInfo.authenticatedUserPrivileges = [{ resource: { db: DB, collection: '' }, actions: ['find'] }]; },
  };
  for (const [label, mutate] of Object.entries(variants)) {
    const status = goodStatus();
    const replaced = mutate(status);
    const input = replaced === undefined ? status : replaced;
    assert.throws(
      () => verifyConnectionIdentity(input, config),
      (error) => error instanceof SeedRefusal && error.code === 'identity_unverified',
      label
    );
  }
});

test('main writes nothing when connectionStatus fails or identity is unverifiable', async () => {
  const failing = fakeMongo({ commandError: Object.assign(new Error('denied'), { codeName: 'Unauthorized' }) });
  assert.equal(
    await refusalCode(main({ env: devEnv(), root: emptyRoot(), MongoClient: failing.MongoClient, log: () => {} })),
    'identity_unverified'
  );
  assert.equal(failing.state.writes.length, 0);
  assert.equal(failing.state.closed, true);

  const broad = goodStatus();
  broad.authInfo.authenticatedUserRoles.push({ role: 'readWriteAnyDatabase', db: 'admin' });
  const wide = fakeMongo({ status: broad });
  assert.equal(
    await refusalCode(main({ env: devEnv(), root: emptyRoot(), MongoClient: wide.MongoClient, log: () => {} })),
    'identity_unverified'
  );
  assert.equal(wide.state.writes.length, 0);
});

test('main refuses when users, courses, or lessons already contain documents', async () => {
  assert.deepEqual([...GUARDED_COLLECTIONS], ['users', 'courses', 'lessons']);
  for (const name of [...GUARDED_COLLECTIONS, 'quizzes', 'progress']) {
    const fake = fakeMongo({ seedDocs: { [name]: [{ _id: new ObjectId() }] } });
    const code = await refusalCode(main({ env: devEnv(), root: emptyRoot(), MongoClient: fake.MongoClient, log: () => {} }));
    assert.equal(code, 'not_empty', name);
    assert.equal(fake.state.writes.length, 0, name);
    assert.equal(fake.state.store.get(name).length, 1, name);
  }
});

test('successful run preserves the existing community rooms and writes only seed collections', async () => {
  const rooms = [1, 2, 3].map((i) => ({ _id: new ObjectId(), name: `room-${i}` }));
  const fake = fakeMongo({ seedDocs: { communityRooms: rooms } });
  const { lines, log } = captureLog();

  const result = await main({ env: devEnv(), root: emptyRoot(), MongoClient: fake.MongoClient, log });

  assert.equal(result.roomsBefore, 3);
  assert.equal(result.roomsAfter, 3);
  assert.deepEqual(fake.state.store.get('communityRooms'), rooms);
  assert.ok(fake.state.writes.every((w) => SEED_COLLECTIONS.includes(w.collection)));
  assert.ok(!fake.state.writes.some((w) => w.collection === 'communityRooms'));
  assert.deepEqual([...new Set(fake.state.dbNames)], [DB]);

  const users = fake.state.store.get('users');
  const approved = (role) => users.filter((u) => u.role === role && u.status === 'approved');
  assert.equal(approved('superadmin').length, 1);
  assert.equal(approved('admin').length, 1);
  assert.equal(approved('instructor').length, 1);
  assert.ok(approved('student').some((u) => u.email === 'student@demo.com'));
  assert.ok(users.every((u) => /@demo\.com$/.test(u.email)));
  assert.ok(users.every((u) => u.password !== PASSWORD && u.password.startsWith('$2')));
  assert.equal(await bcrypt.compare(PASSWORD, users[0].password), true);

  assert.equal(fake.state.store.get('courses').length, 8);
  assert.equal(fake.state.store.get('lessons').length, 35);
  assert.equal(fake.state.store.get('quizzes').length, 7);
  assert.ok(fake.state.store.get('progress').length > 0);

  const courseIds = new Set(fake.state.store.get('courses').map((c) => String(c._id)));
  assert.ok(fake.state.store.get('lessons').every((l) => courseIds.has(l.courseId)));
  const instructor = approved('instructor')[0];
  assert.ok(fake.state.store.get('courses').every((c) => c.instructorId === String(instructor._id)));

  const output = lines.join('\n');
  assert.ok(!output.includes(PASSWORD));
  assert.ok(!output.includes('not-a-real-secret'));
  assert.ok(!output.includes('example.invalid'));
});

test('a failing stage stops the run and reports the completed stages without rollback claims', async () => {
  const fake = fakeMongo({ failInsertOn: 'lessons' });
  await assert.rejects(
    main({ env: devEnv(), root: emptyRoot(), MongoClient: fake.MongoClient, log: () => {} }),
    (error) => {
      assert.ok(error instanceof SeedStageError);
      assert.equal(error.stage, 'lessons');
      assert.equal(error.causeCode, 'SimulatedFailure');
      assert.deepEqual(error.completed.map((s) => s.stage), ['users', 'courses']);
      return true;
    }
  );
  assert.equal(fake.state.store.get('quizzes'), undefined);
  assert.equal(fake.state.closed, true);
});

test('script source never targets the shared database or reuses the production seed scripts', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'seed-dev.js'), 'utf8');
  assert.ok(!/['"`]Forex_elearning['"`]/.test(source));
  assert.ok(!/require\([^)]*seed\//.test(source));
  assert.ok(!source.includes('communityNews'));
  assert.ok(!/\.(deleteMany|deleteOne|updateMany|updateOne|replaceOne|drop|dropDatabase|bulkWrite)\(/.test(source));
  assert.ok(!/@gmail\.com/.test(source));
});
