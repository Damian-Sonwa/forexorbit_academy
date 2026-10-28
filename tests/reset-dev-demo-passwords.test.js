'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const bcrypt = require('bcryptjs');

const { demoEmails, main } = require('../scripts/reset-dev-demo-passwords');
const { SeedRefusal } = require('../scripts/seed-dev');

const DB = 'Forex_elearning_dev';
const PASSWORD = 'test-only-new-pass-456';
const DEV_URI = 'mongodb://forexorbit_dev:not-a-real-secret@dev.example.invalid/Forex_elearning_dev';

function devEnv(overrides = {}) {
  return { MONGO_URI: DEV_URI, MONGODB_DB_NAME: DB, DEMO_SEED_PASSWORD: PASSWORD, ...overrides };
}

function goodStatus(actions = ['find', 'insert', 'update', 'remove']) {
  return {
    authInfo: {
      authenticatedUsers: [{ user: 'forexorbit_dev', db: 'admin' }],
      authenticatedUserRoles: [{ role: 'readWrite', db: DB }],
      authenticatedUserPrivileges: [{ resource: { db: DB, collection: '' }, actions }],
    },
  };
}

function fakeMongo({ users = [], status = goodStatus() } = {}) {
  const state = { users: users.map((u) => ({ ...u })), updates: 0, constructed: 0 };
  const inList = (filter, user) => filter.email.$in.includes(user.email);
  const collection = (name) => {
    assert.equal(name, 'users');
    return {
      async countDocuments(filter) {
        return state.users.filter((u) => inList(filter, u)).length;
      },
      async updateMany(filter, update) {
        state.updates += 1;
        let modifiedCount = 0;
        for (const user of state.users) {
          if (inList(filter, user)) {
            Object.assign(user, update.$set);
            modifiedCount += 1;
          }
        }
        return { matchedCount: modifiedCount, modifiedCount };
      },
      async findOne(filter) {
        return state.users.find((u) => u.email === filter.email) || null;
      },
    };
  };
  class FakeClient {
    constructor() {
      state.constructed += 1;
    }
    async connect() {}
    db(name) {
      assert.equal(name, DB);
      return { collection, command: async () => status };
    }
    async close() {}
  }
  return { MongoClient: FakeClient, state };
}

const emptyRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'reset-dev-test-'));

async function refusal(promise) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof SeedRefusal) return error.code;
    throw error;
  }
  return null;
}

test('demo account list contains only the seeded @demo.com addresses', () => {
  const emails = demoEmails();
  assert.equal(emails.length, 35);
  assert.ok(emails.every((e) => /@demo\.com$/.test(e)));
  assert.ok(emails.includes('superadmin@demo.com'));
});

test('resets only demo accounts and leaves other users untouched', async () => {
  const other = { email: 'someone@example.invalid', password: 'original-hash' };
  const fake = fakeMongo({ users: [...demoEmails().map((email) => ({ email, password: 'old' })), other] });
  const lines = [];
  const result = await main({ env: devEnv(), root: emptyRoot(), MongoClient: fake.MongoClient, log: (l) => lines.push(l) });
  assert.equal(result.modified, 35);
  assert.equal(result.verified, true);
  assert.equal(fake.state.users.find((u) => u.email === other.email).password, 'original-hash');
  assert.equal(await bcrypt.compare(PASSWORD, fake.state.users[0].password), true);
  assert.ok(!lines.join('\n').includes(PASSWORD));
  assert.ok(!lines.join('\n').includes('not-a-real-secret'));
});

test('refuses without changes on weak password, wrong database, missing update privilege, or no demo accounts', async () => {
  const seeded = demoEmails().map((email) => ({ email, password: 'old' }));
  const cases = [
    [devEnv({ DEMO_SEED_PASSWORD: 'short' }), {}, 'weak_password'],
    [devEnv({ MONGODB_DB_NAME: 'Forex_elearning' }), {}, 'wrong_database'],
    [devEnv(), { status: goodStatus(['find', 'insert']) }, 'identity_unverified'],
    [devEnv(), { status: { ok: 1 } }, 'identity_unverified'],
    [devEnv(), { users: [] }, 'no_demo_accounts'],
  ];
  for (const [env, options, expected] of cases) {
    const fake = fakeMongo({ users: seeded, ...options });
    assert.equal(await refusal(main({ env, root: emptyRoot(), MongoClient: fake.MongoClient, log: () => {} })), expected);
    assert.equal(fake.state.updates, 0, expected);
  }
});
