/**
 * Local development never reaches the production database by default (lib/dev-database-guard.js,
 * used by lib/mongodb.js and db/mongoClient.ts). Child processes run in an empty directory, so no
 * .env is loaded, and their URI points at a closed local port: nothing is ever contacted.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { checkDevelopmentDatabase } = require('../lib/dev-database-guard');

const ROOT = path.join(__dirname, '..');

test('outside production an explicit non-production database name is required', () => {
  assert.equal(checkDevelopmentDatabase({}).ok, false, 'unset: refused (getDb would default to production)');
  assert.match(checkDevelopmentDatabase({}).reason, /never defaults to the production database/);
  for (const name of ['Forex_elearning', 'forex_elearning', ' FOREX_ELEARNING ']) {
    assert.equal(checkDevelopmentDatabase({ MONGODB_DB_NAME: name }).ok, false, name);
  }
  for (const name of ['forexorbit', 'Forex_elearning_prod', 'staging']) {
    assert.equal(checkDevelopmentDatabase({ MONGODB_DB_NAME: name }).ok, false, `${name}: not clearly non-production`);
  }
  for (const name of ['Forex_elearning_dev', 'forexorbit_p10_test', 'forexorbit_phase5_acceptance', 'mine_local']) {
    assert.equal(checkDevelopmentDatabase({ MONGODB_DB_NAME: name }).ok, true, name);
    assert.equal(checkDevelopmentDatabase({ NODE_ENV: 'development', MONGODB_DB_NAME: name }).ok, true, name);
  }
});

test('production is unaffected: an unset name keeps the Forex_elearning default', () => {
  assert.deepEqual(checkDevelopmentDatabase({ NODE_ENV: 'production' }), { ok: true });
  assert.deepEqual(checkDevelopmentDatabase({ NODE_ENV: 'production', MONGODB_DB_NAME: 'Forex_elearning' }), { ok: true });
  const start = fs.readFileSync(path.join(ROOT, 'scripts', 'start-production.js'), 'utf8');
  assert.match(start, /process\.env\.NODE_ENV = 'production';/, 'npm start sets production before server.js loads');
});

test('loading the connection module refuses before connecting; production loads', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'forexorbit-devdb-'));
  try {
    const load = (env) => spawnSync(process.execPath, ['-e', `require(${JSON.stringify(path.join(ROOT, 'lib', 'mongodb.js'))}); console.log('loaded'); process.exit(0);`], {
      cwd,
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, MONGO_URI: 'mongodb://127.0.0.1:1/never_used', ...env },
      encoding: 'utf8',
      timeout: 30000,
    });
    const refused = load({});
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /Refusing to start: MONGODB_DB_NAME is not set/);
    assert.doesNotMatch(refused.stdout + refused.stderr, /never_used/, 'the URI is not printed');
    assert.match(load({ MONGODB_DB_NAME: 'Forex_elearning' }).stderr, /is the production database/);
    assert.equal(load({ MONGODB_DB_NAME: 'Forex_elearning_dev' }).stdout.trim().split('\n').pop(), 'loaded');
    assert.equal(load({ NODE_ENV: 'production' }).stdout.trim().split('\n').pop(), 'loaded');
    const noUri = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(path.join(ROOT, 'lib', 'mongodb.js'))})`], { cwd, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot }, encoding: 'utf8', timeout: 30000 });
    assert.match(noUri.stderr, /MongoDB URI not set/, 'no URI: a clear error, no fallback');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('both connection paths use the guard', () => {
  assert.match(fs.readFileSync(path.join(ROOT, 'lib', 'mongodb.js'), 'utf8'), /require\('\.\/dev-database-guard'\)\.assertDevelopmentDatabase\(\);/);
  assert.match(fs.readFileSync(path.join(ROOT, 'db', 'mongoClient.ts'), 'utf8'), /\nassertDevelopmentDatabase\(\);/);
});
