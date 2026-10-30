/**
 * scripts/password-reset-indexes.js: definitions, argument guard and the inspect/apply logic
 * against an in-memory stand-in. No database is contacted.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');

const { RESET_TOKENS_COLLECTION, RESET_TOKEN_INDEXES } = require('../lib/password-reset-token');
const tool = require('../scripts/password-reset-indexes');

const ROOT = path.join(__dirname, '..');

function fakeDb(existing = null) {
  const calls = { created: [], dropped: 0 };
  let indexes = existing;
  const db = {
    calls,
    listCollections: () => ({ toArray: async () => (indexes ? [{ name: RESET_TOKENS_COLLECTION }] : []) }),
    collection(name) {
      assert.equal(name, RESET_TOKENS_COLLECTION, 'only the reset token collection is touched');
      return {
        indexes: async () => indexes || [],
        estimatedDocumentCount: async () => 0,
        createIndex: async (key, options) => {
          calls.created.push(options.name);
          indexes = [...(indexes || [{ name: '_id_', key: { _id: 1 } }]), { name: options.name, key, ...options }];
          return options.name;
        },
        dropIndex: async () => { calls.dropped += 1; },
      };
    },
  };
  return db;
}

const asStored = (definition) => ({ name: definition.options.name, key: definition.key, ...definition.options });
const quiet = () => {};

test('the three indexes are defined exactly', () => {
  assert.deepEqual(
    RESET_TOKEN_INDEXES.map((d) => [d.id, d.collection, d.key, d.options]),
    [
      ['T1', 'passwordResetTokens', { tokenHash: 1 }, { name: 'uniq_reset_token_hash', unique: true }],
      ['T2', 'passwordResetTokens', { userId: 1 }, { name: 'uniq_active_reset_per_user', unique: true, partialFilterExpression: { status: 'active' } }],
      ['T3', 'passwordResetTokens', { expiresAt: 1 }, { name: 'ttl_reset_token_expiry', expireAfterSeconds: 86400 }],
    ]
  );
});

test('arguments: production needs its name repeated; dropping is never offered', () => {
  const parse = (...args) => tool.parseArgs(['node', 's', ...args]);
  assert.match(parse().error, /--database/);
  assert.match(parse('--database', 'Forex_elearning').error, /production database/);
  assert.match(parse('--database', 'Forex_elearning', '--apply').error, /production database/);
  assert.match(parse('--database', 'Forex_elearning', '--confirm-production', 'forex_elearning').error, /production database/);
  assert.match(parse('--database', 'x_test', '--rollback').error, /never drops/);
  assert.match(parse('--database', 'x_test', '--drop').error, /never drops/);
  assert.match(parse('--database', 'x_test', '--force').error, /Unknown option/);
  assert.deepEqual(parse('--database', 'x_test'), { database: 'x_test', mode: 'inspect' });
  assert.deepEqual(parse('--database', 'x_test', '--apply'), { database: 'x_test', mode: 'apply' });
  assert.deepEqual(parse('--database', 'Forex_elearning', '--confirm-production', 'Forex_elearning', '--apply'), { database: 'Forex_elearning', mode: 'apply' });
});

test('inspect reports what is missing and creates nothing', async () => {
  const db = fakeDb();
  const result = await tool.run(db, { mode: 'inspect', log: quiet });
  assert.deepEqual(result, { ok: true, mode: 'inspect', state: 'missing', created: [] });
  assert.deepEqual(db.calls.created, []);
});

test('apply creates only the missing indexes, verifies them, and a second run does nothing', async () => {
  const db = fakeDb([{ name: '_id_', key: { _id: 1 } }, asStored(RESET_TOKEN_INDEXES[0])]);
  const first = await tool.run(db, { mode: 'apply', log: quiet });
  assert.deepEqual(first, { ok: true, mode: 'apply', state: 'present', created: ['uniq_active_reset_per_user', 'ttl_reset_token_expiry'] });
  const second = await tool.run(db, { mode: 'apply', log: quiet });
  assert.deepEqual(second, { ok: true, mode: 'apply', state: 'present', created: [] });
  assert.equal(db.calls.dropped, 0);
});

test('a conflicting index stops the tool before anything is created', async () => {
  const wrongTtl = { ...asStored(RESET_TOKEN_INDEXES[2]), expireAfterSeconds: 0 };
  const sameKeysOtherName = { name: 'tokenHash_1', key: { tokenHash: 1 }, unique: true };
  for (const existing of [[wrongTtl], [sameKeysOtherName]]) {
    const db = fakeDb([{ name: '_id_', key: { _id: 1 } }, ...existing]);
    const result = await tool.run(db, { mode: 'apply', log: quiet });
    assert.equal(result.ok, false);
    assert.equal(result.state, 'conflict');
    assert.deepEqual(db.calls.created, []);
    assert.equal(db.calls.dropped, 0);
  }
});

test('CLI: an unconfirmed production target is refused before connecting, without printing the URI', () => {
  // The URI points at a closed port: a refusal after connecting would time out instead.
  const run = spawnSync(process.execPath, ['scripts/password-reset-indexes.js', '--database', 'Forex_elearning', '--apply'], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, MONGO_URI: 'mongodb://127.0.0.1:1' },
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /production database/);
  assert.equal(`${run.stdout}${run.stderr}`.includes('127.0.0.1:1'), false);
});
