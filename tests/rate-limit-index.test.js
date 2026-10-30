/**
 * R1 tooling without a database: the test-database guard (tests/helpers/mongo-test-db.js), the
 * R1-only index tool's arguments and production protection (scripts/rate-limit-index.js), and
 * the SHARED_RATE_LIMIT switch. Real-MongoDB behaviour is covered by
 * tests/integration/rate-limit-mongo.test.js (npm run test:mongo).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');

const { testDatabaseConfig, openTestDatabase, DEFAULT_TEST_DB_NAME } = require('./helpers/mongo-test-db');
const { parseArgs, PRODUCTION_DB_NAME } = require('../scripts/rate-limit-index');
const { RATE_LIMIT_TTL_INDEX, sharedLimitEnabled } = require('../lib/shared-rate-limit');

const ROOT = path.join(__dirname, '..');
const LOCAL = 'mongodb://127.0.0.1:27027';

test('test database: only MONGODB_URI_TEST is used, never the application connection', () => {
  assert.equal(testDatabaseConfig({}).ok, false, 'unset: skipped');
  assert.equal(testDatabaseConfig({ MONGO_URI: LOCAL, MONGODB_URI: LOCAL }).ok, false, 'no fallback to MONGO_URI/MONGODB_URI');
  assert.deepEqual(testDatabaseConfig({ MONGODB_URI_TEST: LOCAL }), { ok: true, uri: LOCAL, dbName: DEFAULT_TEST_DB_NAME });
  assert.equal(DEFAULT_TEST_DB_NAME, 'Forex_elearning_r1_test');
  for (const name of ['MONGO_URI', 'MONGODB_URI']) {
    const same = testDatabaseConfig({ MONGODB_URI_TEST: LOCAL, [name]: LOCAL });
    assert.equal(same.ok, false, `same as ${name}`);
  }
  for (const dbName of ['Forex_elearning', 'forex_elearning', 'Forex_elearning_dev', 'test', 'prod_test_backup', 'a b_test']) {
    assert.equal(testDatabaseConfig({ MONGODB_URI_TEST: LOCAL, MONGODB_DB_NAME_TEST: dbName }).ok, false, dbName);
  }
  assert.equal(testDatabaseConfig({ MONGODB_URI_TEST: LOCAL, MONGODB_DB_NAME_TEST: 'forexorbit_ci_test' }).ok, true);
  assert.equal(testDatabaseConfig({ MONGODB_URI_TEST: 'http://example.test' }).ok, false);
  const reason = testDatabaseConfig({ MONGODB_URI_TEST: 'mongodb://user:secret-pass@127.0.0.1:1', MONGO_URI: 'mongodb://user:secret-pass@127.0.0.1:1' }).reason;
  assert.equal(reason.includes('secret-pass'), false, 'reasons never include the connection string');
});

test('test database: an unreachable server fails clearly and quickly', async () => {
  await assert.rejects(
    openTestDatabase({ MONGODB_URI_TEST: 'mongodb://127.0.0.1:1' }, { serverSelectionTimeoutMS: 300 }),
    /ECONNREFUSED|Server selection timed out|connect/i
  );
  await assert.rejects(openTestDatabase({}), /MONGODB_URI_TEST is not set/);
});

test('R1 tool: inspect by default, create only with --apply, never drop', () => {
  assert.deepEqual(parseArgs(['node', 's', '--database', 'Forex_elearning_dev']), { database: 'Forex_elearning_dev', mode: 'inspect' });
  assert.deepEqual(parseArgs(['node', 's', '--database', 'Forex_elearning_dev', '--apply']), { database: 'Forex_elearning_dev', mode: 'apply' });
  assert.match(parseArgs(['node', 's']).error, /--database/);
  assert.match(parseArgs(['node', 's', '--database', '--apply']).error, /--database/);
  assert.match(parseArgs(['node', 's', '--database', 'x_test', '--rollback']).error, /never drops/);
  assert.match(parseArgs(['node', 's', '--database', 'x_test', '--force']).error, /Unknown option/);
});

test('R1 tool: the production database needs its name confirmed', () => {
  assert.equal(PRODUCTION_DB_NAME, 'Forex_elearning');
  for (const argv of [['--database', 'Forex_elearning'], ['--database', 'Forex_elearning', '--apply'], ['--database', 'Forex_elearning', '--confirm-production', 'Forex_elearning_dev']]) {
    assert.match(parseArgs(['node', 's', ...argv]).error, /production database/);
  }
  assert.deepEqual(parseArgs(['node', 's', '--database', 'Forex_elearning', '--confirm-production', 'Forex_elearning', '--apply']), {
    database: 'Forex_elearning',
    mode: 'apply',
  });
});

test('R1 tool CLI: refuses an unconfirmed production target before connecting', () => {
  // The URI points at a closed port: a refusal that happened after connecting would time out instead.
  const run = spawnSync(process.execPath, ['scripts/rate-limit-index.js', '--database', 'Forex_elearning', '--apply'], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, MONGO_URI: 'mongodb://127.0.0.1:1' },
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /production database/);
  assert.equal(`${run.stdout}${run.stderr}`.includes('127.0.0.1:1'), false, 'the connection string is not printed');
});

test('R1 definition is unchanged and the switch accepts only "mongodb"', () => {
  assert.deepEqual(RATE_LIMIT_TTL_INDEX, {
    id: 'R1',
    collection: 'rateLimits',
    key: { expiresAt: 1 },
    options: { name: 'ttl_rate_limit_window', expireAfterSeconds: 0 },
  });
  const warnings = [];
  const realWarn = console.warn;
  console.warn = (message) => warnings.push(message);
  try {
    assert.equal(sharedLimitEnabled({ SHARED_RATE_LIMIT: 'mongodb' }), true);
    assert.equal(sharedLimitEnabled({ SHARED_RATE_LIMIT: 'mongo' }), false);
    assert.equal(sharedLimitEnabled({ SHARED_RATE_LIMIT: 'mongo' }), false);
    assert.equal(sharedLimitEnabled({}), false);
  } finally {
    console.warn = realWarn;
  }
  assert.equal(warnings.length, 1, 'a mistyped value is reported once');
  assert.match(warnings[0], /not to "mongodb"/);
});
