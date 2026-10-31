/**
 * Safety guard of the acceptance harness (scripts/acceptance/guard.js). Run on its own:
 *   node --test tests/acceptance-guard.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { memoryDb } = require('./helpers/memory-db');
const guard = require('../scripts/acceptance/guard');

const local = { ACCEPTANCE_MONGODB_URI: 'mongodb://127.0.0.1:27017', ACCEPTANCE_DB_NAME: 'forexorbit_phase4_acceptance' };

test('a local, dedicated acceptance database is accepted', () => {
  const ok = guard.checkAcceptanceConfig(local);
  assert.deepEqual([ok.ok, ok.dbName, ok.hosts], [true, 'forexorbit_phase4_acceptance', 'local']);
  assert.equal(guard.checkAcceptanceConfig({ ...local, ACCEPTANCE_DB_NAME: 'fo_test' }).ok, true);
});

test('production names, reused application URIs and missing settings are refused', () => {
  const refused = [
    {},
    { ACCEPTANCE_MONGODB_URI: local.ACCEPTANCE_MONGODB_URI },
    { ...local, ACCEPTANCE_DB_NAME: 'Forex_elearning' },
    { ...local, ACCEPTANCE_DB_NAME: 'FOREX_ELEARNING' },
    { ...local, ACCEPTANCE_DB_NAME: 'Forex_elearning_dev' },
    { ...local, ACCEPTANCE_DB_NAME: 'acceptance' },
    { ...local, ACCEPTANCE_MONGODB_URI: 'http://127.0.0.1' },
    { ...local, MONGO_URI: local.ACCEPTANCE_MONGODB_URI },
    { ...local, MONGODB_URI: local.ACCEPTANCE_MONGODB_URI },
    { ...local, ACCEPTANCE_MONGODB_URI: 'mongodb://127.0.0.1:27017/Forex_elearning' },
  ];
  for (const env of refused) assert.equal(guard.checkAcceptanceConfig(env).ok, false, JSON.stringify(env));
});

test('a remote server needs the explicit dedicated-test-cluster opt-in', () => {
  const remote = { ...local, ACCEPTANCE_MONGODB_URI: 'mongodb://acceptance-tester@test-cluster.example.net:27017' };
  const refused = guard.checkAcceptanceConfig(remote);
  assert.equal(refused.ok, false);
  assert.equal(refused.reason.includes('acceptance-tester'), false, 'the reason never repeats the URI');
  assert.equal(guard.checkAcceptanceConfig({ ...remote, ACCEPTANCE_ALLOW_REMOTE: 'yes' }).ok, false);
  assert.equal(guard.checkAcceptanceConfig({ ...remote, ACCEPTANCE_ALLOW_REMOTE: 'dedicated-test-cluster' }).ok, true);
  assert.deepEqual(guard.hostsOf('mongodb://a:1,b:2/x'), ['a', 'b']);
});

test('only an empty database or one marked by this harness is used', async () => {
  const withList = (db, names) => Object.assign(db, { listCollections: () => ({ toArray: async () => names.map((name) => ({ name })) }) });
  assert.deepEqual(await guard.checkDisposable(withList(memoryDb({}), [])), { ok: true, fresh: true });
  const marked = withList(memoryDb({ [guard.MARKER_COLLECTION]: [{ ...guard.MARKER }] }), [guard.MARKER_COLLECTION, 'users']);
  assert.deepEqual(await guard.checkDisposable(marked), { ok: true, fresh: false });
  const foreign = withList(memoryDb({ users: [{ email: 'someone' }] }), ['users']);
  assert.equal((await guard.checkDisposable(foreign)).ok, false);
});
