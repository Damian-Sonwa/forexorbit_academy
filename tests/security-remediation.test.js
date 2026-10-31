/**
 * Static checks for the 26 October 2026 security remediation.
 * Does not connect to a database, send SMS, or import application handlers.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

const removedPaths = [
  'pages/api/migrate-lessons.ts',
  'pages/api/auth/test-email.ts',
  'scripts/migrate-lesson-content.js',
];

const sourceRoots = [
  'pages',
  'scripts',
  'lib',
  'db',
  'server',
  'seed',
  'src',
  'components',
  'hooks',
  'tests',
];

function walk(dir, found) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, found);
    } else if (/\.(ts|tsx|js|jsx|mjs|cjs|md)$/.test(entry.name)) {
      found.push(full);
    }
  }
}

test('removed maintenance and SMS diagnostic routes are absent', () => {
  for (const relative of removedPaths) {
    assert.equal(fs.existsSync(path.join(root, relative)), false, relative);
  }
});

test('source does not embed a MongoDB SRV connection string', () => {
  const files = [];
  for (const relative of sourceRoots) {
    walk(path.join(root, relative), files);
  }
  files.push(path.join(root, 'next.config.js'), path.join(root, 'server.js'), path.join(root, 'MIGRATION_README.md'));

  const embedded = /mongodb\+srv:\/\/[^\s'"`]+/;
  const hits = [];
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    if (embedded.test(text)) hits.push(path.relative(root, file));
  }
  assert.deepEqual(hits, []);
});

test('Next config does not inline database or JWT secrets', () => {
  const text = fs.readFileSync(path.join(root, 'next.config.js'), 'utf8');
  assert.equal(text.includes('MONGO_URI:'), false);
  assert.equal(text.includes('JWT_SECRET:'), false);
});

test('disabled operator scripts cannot connect or change accounts', () => {
  for (const relative of ['scripts/set-superadmin.js', 'scripts/reset-superadmin-password.js']) {
    const text = fs.readFileSync(path.join(root, relative), 'utf8');
    assert.equal(text.includes('MongoClient'), false, relative);
    assert.equal(text.includes('bcrypt'), false, relative);
    assert.match(text, /process\.exit\(1\)/);
  }
});

test('password hash helper requires an argument and does not target an account', () => {
  const text = fs.readFileSync(path.join(root, 'scripts/generate-password-hash.js'), 'utf8');
  assert.equal(text.includes('updateOne'), false);
  assert.match(text, /process\.argv\[2\]/);
  assert.equal(/process\.argv\[2\]\s*\|\|/.test(text), false);
});

test('login still verifies a password and starts a cookie session', () => {
  const text = fs.readFileSync(path.join(root, 'pages/api/auth/login.ts'), 'utf8');
  assert.match(text, /bcrypt\.compare/);
  assert.match(text, /startSession\(res, db,/);
  assert.doesNotMatch(text, /issueAuthToken|token:/);
  assert.match(text, /getDb\(/);
});

test('auth middleware still rejects missing sessions before the handler', () => {
  const text = fs.readFileSync(path.join(root, 'lib/auth-middleware.ts'), 'utf8');
  assert.match(text, /checkRequestOrigin\(req\)/);
  assert.match(text, /authenticateRequest\(req, res, db\)/);
  assert.match(text, /decideAccountAccess/);
  assert.doesNotMatch(text, /authorization|Bearer|verifyToken/i);
  assert.match(fs.readFileSync(path.join(root, 'lib/session-auth.ts'), 'utf8'), /Authentication required/);
  const access = fs.readFileSync(path.join(root, 'lib/account-access.js'), 'utf8');
  assert.match(access, /Insufficient permissions/);
});
