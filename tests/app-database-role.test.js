/**
 * D9: the app database role and its read-only checker. No database connection.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const role = require('../lib/app-database-role');
const { COLLECTIONS, AUDIT_COLLECTION } = require('../lib/course-payment');
const { parseArgs, report } = require('../scripts/check-db-role');

const DB = 'Forex_elearning';
const root = path.join(__dirname, '..');

/** What the built-in `readWrite` role grants: write actions on every collection in the database. */
const readWriteBuiltIn = [{ resource: { db: DB, collection: '' }, actions: ['find', 'insert', 'update', 'remove', 'createCollection', 'createIndex', 'dropCollection', 'listCollections'] }];

test('the built-in readWrite grant fails: it can update and remove audit entries', () => {
  const result = role.evaluatePrivileges(readWriteBuiltIn, DB);
  assert.equal(result.ok, false);
  assert.deepEqual(result.auditViolations, [{ collection: 'adminAuditLog', actions: ['update', 'remove', 'dropCollection'] }]);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.excessive, [{ resource: `${DB}.*`, actions: ['createCollection', 'createIndex', 'dropCollection', 'find', 'insert', 'remove', 'update'] }]);
});

test('the custom role passes: audit log find and insert only, every app collection read-write', () => {
  const result = role.evaluatePrivileges(role.rolePrivileges(DB), DB);
  assert.deepEqual(result, { ok: true, auditViolations: [], missing: [], excessive: [], warnings: [] });
  const audit = role.rolePrivileges(DB).filter((p) => p.resource.collection === AUDIT_COLLECTION);
  assert.deepEqual(audit, [{ resource: { db: DB, collection: 'adminAuditLog' }, actions: ['find', 'insert'] }]);
  const dbWide = role.rolePrivileges(DB).filter((p) => p.resource.collection === '');
  assert.deepEqual(dbWide, [{ resource: { db: DB, collection: '' }, actions: ['listCollections'] }]);
});

test('the custom role plus any database-wide, other-database or any-resource write grant fails', () => {
  for (const extra of [
    { resource: { db: DB, collection: '' }, actions: ['update'] },
    { resource: { db: '', collection: '' }, actions: ['remove'] },
    { resource: { anyResource: true }, actions: ['update'] },
    { resource: { db: DB, collection: 'adminAuditLog' }, actions: ['collMod'] },
  ]) {
    const result = role.evaluatePrivileges([...role.rolePrivileges(DB), extra], DB);
    assert.equal(result.ok, false, JSON.stringify(extra));
    assert.equal(result.auditViolations.length, 1);
  }
});

test('any privilege beyond the role fails as excessive, even where the audit log is untouched', () => {
  const cases = [
    [{ resource: { db: 'other_db', collection: '' }, actions: ['update', 'remove'] }, { resource: 'other_db.*', actions: ['remove', 'update'] }],
    [{ resource: { db: DB, collection: 'users' }, actions: ['dropCollection'] }, { resource: `${DB}.users`, actions: ['dropCollection'] }],
    [{ resource: { db: DB, collection: '' }, actions: ['dropDatabase'] }, { resource: `${DB}.*`, actions: ['dropDatabase'] }],
    [{ resource: { db: 'admin', collection: '' }, actions: ['createUser', 'grantRole'] }, { resource: 'admin.*', actions: ['createUser', 'grantRole'] }],
    [{ resource: { cluster: true }, actions: ['shutdown'] }, { resource: 'cluster', actions: ['shutdown'] }],
    [{ resource: { db: DB, collection: 'paystackPayments' }, actions: ['createIndex'] }, { resource: `${DB}.paystackPayments`, actions: ['createIndex'] }],
  ];
  for (const [extra, expected] of cases) {
    const result = role.evaluatePrivileges([...role.rolePrivileges(DB), extra], DB);
    assert.equal(result.ok, false, JSON.stringify(extra));
    const dropsAuditLog = extra.actions.includes('dropDatabase');
    assert.deepEqual(result.auditViolations, dropsAuditLog ? [{ collection: 'adminAuditLog', actions: ['dropDatabase'] }] : [], JSON.stringify(extra));
    assert.deepEqual(result.excessive, [expected]);
  }
});

test('a role missing an action the app needs fails and names it', () => {
  const privileges = role.rolePrivileges(DB).map((p) => (p.resource.collection === 'paystackPayments' ? { ...p, actions: ['find', 'insert'] } : p));
  const result = role.evaluatePrivileges(privileges, DB);
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, [{ collection: 'paystackPayments', actions: ['update', 'remove'] }]);
  const noAudit = role.evaluatePrivileges(role.rolePrivileges(DB).filter((p) => p.resource.collection !== 'adminAuditLog'), DB);
  assert.deepEqual(noAudit.missing, [{ collection: 'adminAuditLog', actions: ['find', 'insert'] }]);
});

test('missing setup privileges for the seed-experts route are warnings, not failures', () => {
  const privileges = role.rolePrivileges(DB).filter((p) => !p.actions.includes('createIndex') && p.resource.collection !== '');
  const result = role.evaluatePrivileges(privileges, DB);
  assert.equal(result.ok, true);
  assert.equal(result.warnings.length, 4);
});

test('the role covers every collection the app uses', () => {
  const covered = new Set([...role.READ_WRITE_COLLECTIONS, ...role.APPEND_ONLY_COLLECTIONS]);
  Object.values(COLLECTIONS).forEach((name) => assert.ok(covered.has(name), name));
  assert.ok(covered.has(AUDIT_COLLECTION));

  const knownIdentifiers = {
    AUDIT_COLLECTION: 'adminAuditLog',
    COLLECTION: 'passwordResetSecurityLogs',
    PASSWORD_PHONE_RESETS_COLLECTION: 'passwordPhoneResets',
    RESET_TOKENS_COLLECTION: 'passwordResetTokens',
    SECURITY_LOG_COLLECTION: 'passwordResetSecurityLogs',
    QUESTIONS: 'communityQuestions',
    REPLIES: 'communityReplies',
    VOTES: 'communityVotes',
    REQUESTS: 'consultationRequests',
    SESSIONS: 'consultationSessions',
    RATE_LIMIT_COLLECTION: 'rateLimits',
    // Chosen at runtime: payments or access rows (admin ledger), questions or replies (community votes).
    name: null,
    collection: null,
  };
  Object.values(knownIdentifiers).filter(Boolean).forEach((name) => assert.ok(covered.has(name), name));

  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const relative = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(relative);
      else if (/\.(js|ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) files.push(relative);
    }
  };
  ['lib', 'pages', 'components', 'hooks'].filter((dir) => fs.existsSync(path.join(root, dir))).forEach(walk);
  files.push('server.js');

  for (const file of files) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    for (const match of source.matchAll(/collection\(\s*['"`]([A-Za-z0-9_]+)['"`]/g)) {
      assert.ok(covered.has(match[1]), `${file} uses collection "${match[1]}", which the app role does not cover`);
    }
    for (const match of source.matchAll(/collection\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)/g)) {
      assert.ok(match[1] in knownIdentifiers, `${file} uses collection(${match[1]}); add its collection to lib/app-database-role.js`);
    }
  }
});

test('the checker takes a database name, never prints the connection string, and only reads', () => {
  assert.match(parseArgs(['node', 's']).error, /--database/);
  assert.deepEqual(parseArgs(['node', 's', '--database', DB, '--print-role']), { database: DB, printRole: true });
  const source = fs.readFileSync(path.join(root, 'scripts', 'check-db-role.js'), 'utf8');
  assert.doesNotMatch(source, /console\.(log|error)\([^)]*\buri\b/);
  assert.doesNotMatch(source, /\.(insertOne|insertMany|updateOne|updateMany|deleteOne|deleteMany|createIndex|dropIndex|createRole|updateUser|grantRolesToUser)\(/);
  assert.doesNotMatch(source, /command\(\{ (?!connectionStatus)/);

  const lines = [];
  report(role.evaluatePrivileges(readWriteBuiltIn, DB), (line) => lines.push(line));
  assert.deepEqual(lines, [
    'FAIL adminAuditLog allows: update, remove, dropCollection',
    `FAIL ${DB}.* grants more than the role: createCollection, createIndex, dropCollection, find, insert, remove, update`,
    'FAIL: see the lines above.',
  ]);
});
