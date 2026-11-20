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
  assert.deepEqual(result.auditViolations, role.APPEND_ONLY_COLLECTIONS.map((collection) => ({ collection, actions: ['update', 'remove', 'dropCollection'] })));
  assert.deepEqual(role.APPEND_ONLY_COLLECTIONS, ['adminAuditLog', 'marketIncidents', 'tradingLedger']);
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
    // A grant on one collection touches that collection; a wider grant touches every append-only one.
    assert.equal(result.auditViolations.length, extra.resource.collection ? 1 : role.APPEND_ONLY_COLLECTIONS.length, JSON.stringify(extra));
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
    assert.deepEqual(result.auditViolations, dropsAuditLog ? role.APPEND_ONLY_COLLECTIONS.map((collection) => ({ collection, actions: ['dropDatabase'] })) : [], JSON.stringify(extra));
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
    SESSION_COLLECTION: 'sessions',
    RATE_LIMIT_COLLECTION: 'rateLimits',
    ENROLLMENT_COLLECTION: 'progress',
    ENROLLMENTS: 'progress',
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
    // Phase 9: `collection(COLLECTIONS.x)` (a member expression) escaped the checks above, which is
    // how Phase 8's learningDays and learningMinutes were missed. Such modules must be listed here.
    for (const match of source.matchAll(/collection\(\s*([A-Za-z_][A-Za-z0-9_]*)\.[A-Za-z_][A-Za-z0-9_]*\s*\)/g)) {
      assert.ok(MEMBER_COLLECTION_MODULES.has(file.replace(/\\/g, '/')), `${file} uses collection(${match[1]}.…); add the module to MEMBER_COLLECTION_MODULES with its collections`);
    }
  }
  for (const [file, source] of MEMBER_COLLECTION_MODULES) {
    for (const name of namesFrom(source)) assert.ok(covered.has(name), `${file}: ${name} is not covered by the app role`);
  }
});

/**
 * Files that name collections through a member expression, and where the names come from:
 * [module, export]. Payment code uses COLLECTIONS from lib/course-payment.js; table-driven code
 * (index definitions, course deletion) reads `.collection` from an exported table.
 */
const PAYMENT = ['lib/course-payment.js', 'COLLECTIONS'];
const MEMBER_COLLECTION_MODULES = new Map([
  ['lib/course-payment.js', PAYMENT],
  ['lib/admin-purchase-ledger.js', PAYMENT],
  ['lib/course-access-admin.js', PAYMENT],
  ['lib/payment-history.js', PAYMENT],
  ['lib/payment-reconciliation.js', PAYMENT],
  ['lib/payment-refunds.js', PAYMENT],
  ['lib/progress-summary.js', PAYMENT],
  ['pages/api/courses/index.ts', PAYMENT],
  ['lib/refund-indexes.js', PAYMENT],
  ['lib/learning-activity.js', ['lib/learning-activity.js', 'COLLECTIONS']],
  ['lib/quiz-attempts.js', ['lib/quiz-attempts.js', 'COLLECTIONS']],
  ['lib/trading/engine.js', ['lib/trading/engine.js', 'COLLECTIONS']],
  ['lib/trading/retention.js', ['lib/trading/engine.js', 'COLLECTIONS']],
  ['pages/api/admin/market.ts', ['lib/trading/market-data.js', 'COLLECTIONS']],
  ['lib/market/series.js', ['lib/market/series.js', 'COLLECTIONS']],
  ['lib/market/health.js', ['lib/market/health.js', 'COLLECTIONS']],
  ['lib/trading/views.js', ['lib/trading/engine.js', 'COLLECTIONS']],
  ['lib/trading/market-data.js', ['lib/trading/market-data.js', 'COLLECTIONS']],
  ['lib/trading/import.js', ['lib/trading/market-data.js', 'COLLECTIONS']],
  ['lib/trading/indexes.js', ['lib/trading/indexes.js', 'TRADING_INDEXES']],
  ['lib/course-deletion.js', ['lib/course-deletion.js', 'PROTECTED_RECORDS']],
  ['lib/assessment-indexes.js', ['lib/assessment-indexes.js', 'ASSESSMENT_INDEXES']],
  ['lib/enrollment-indexes.js', ['lib/enrollment-indexes.js', 'ENROLLMENT_INDEXES']],
  // The shared planner touches only the definitions' collections; trading and assessment are listed above.
  ['lib/index-plan.js', ['lib/learning-indexes.js', 'LEARNING_INDEXES']],
  ['lib/unique-conversion.js', ['lib/unique-conversion.js', 'CONVERSIONS']],
]);
/** Collection names a [module, export] source provides (an object of names or a table of rows). */
function namesFrom([file, exported]) {
  const value = require(path.join(root, file))[exported];
  const items = Array.isArray(value) ? value.map((row) => row.collection) : Object.values(value);
  return items.filter((name) => typeof name === 'string');
}

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
    'FAIL marketIncidents allows: update, remove, dropCollection',
    'FAIL tradingLedger allows: update, remove, dropCollection',
    `FAIL ${DB}.* grants more than the role: createCollection, createIndex, dropCollection, find, insert, remove, update`,
    'FAIL: see the lines above.',
  ]);
});

// F1 (Phase 10 completion): the Atlas role JSON is generated from rolePrivileges(), never by hand.
const { driftedFiles, roleFiles } = require('../scripts/atlas-role');

/** Phase 8-10 collections, from the modules that own them (not a hand-kept list). */
const TRADING_AND_MARKET = Object.freeze([
  ...Object.values(require('../lib/trading/engine').COLLECTIONS),
  ...Object.values(require('../lib/trading/market-data').COLLECTIONS),
  ...Object.values(require('../lib/market/series').COLLECTIONS),
  ...Object.values(require('../lib/market/health').COLLECTIONS),
]);

/** resource -> sorted actions: the effective grant, however the entries are split or ordered. */
function effective(privileges) {
  const map = new Map();
  for (const p of privileges) {
    const label = p.resource.cluster ? 'cluster' : `${p.resource.db}.${p.resource.collection}`;
    map.set(label, [...new Set([...(map.get(label) || []), ...p.actions])].sort());
  }
  return Object.fromEntries([...map].sort(([a], [b]) => a.localeCompare(b)));
}

test('F1: the Atlas Admin API JSON grants exactly rolePrivileges(), action for action', () => {
  const atlas = role.atlasAdminApiRole(DB);
  assert.deepEqual(effective(role.privilegesFromAtlasRole(atlas)), effective(role.rolePrivileges(DB)));
  // Every (resource, action) pair appears once: nothing doubled, nothing dropped.
  const pairs = atlas.actions.flatMap((a) => a.resources.map((r) => `${a.action}:${r.collection}`));
  assert.equal(new Set(pairs).size, pairs.length);
  assert.equal(pairs.length, role.rolePrivileges(DB).reduce((n, p) => n + p.actions.length, 0));
  assert.equal(atlas.roleName, role.ROLE_NAME);
  assert.deepEqual(atlas.inheritedRoles, []);
  assert.deepEqual(atlas.actions.map((a) => a.action), ['FIND', 'INSERT', 'UPDATE', 'REMOVE', 'CREATE_COLLECTION', 'CREATE_INDEX', 'LIST_COLLECTIONS']);
  for (const entry of atlas.actions) for (const resource of entry.resources) assert.deepEqual(Object.keys(resource), ['cluster', 'db', 'collection']);
  assert.ok(atlas.actions.every((a) => a.resources.every((r) => r.cluster === false && r.db === DB)));
  // The checker accepts what the Atlas JSON grants: nothing missing, nothing excessive.
  assert.deepEqual(role.evaluatePrivileges(role.privilegesFromAtlasRole(atlas), DB), { ok: true, auditViolations: [], missing: [], excessive: [], warnings: [] });
  assert.deepEqual(role.createRoleDocument(DB), { role: role.ROLE_NAME, privileges: role.rolePrivileges(DB), roles: [] });
});

test('F1: the committed docs/audits/atlas files are byte-for-byte what rolePrivileges() generates', () => {
  assert.deepEqual(driftedFiles(DB), [], 'run: node scripts/atlas-role.js --database Forex_elearning --write');
  const files = roleFiles(DB);
  assert.deepEqual(JSON.parse(files['forexorbitAppRole.createRole.json']).privileges, role.rolePrivileges(DB));
  assert.deepEqual(effective(role.privilegesFromAtlasRole(JSON.parse(files['forexorbitAppRole.atlas-admin-api.json']))), effective(role.rolePrivileges(DB)));
});

test('F1: the 11 trading and market collections and the 4 Phase 8/9 collections are granted exactly', () => {
  const unique = [...new Set(TRADING_AND_MARKET)].sort();
  assert.deepEqual(unique, ['marketCheckpoints', 'marketDataSets', 'marketHealth', 'marketIncidents', 'marketQuotes', 'tradingAccountSlots', 'tradingAccounts', 'tradingLedger', 'tradingOperations', 'tradingOrders', 'tradingPositions']);
  const atlas = role.atlasAdminApiRole(DB);
  const holders = (action) => new Set(((atlas.actions.find((a) => a.action === action) || {}).resources || []).map((r) => r.collection));
  const [find, insert, update, remove] = ['FIND', 'INSERT', 'UPDATE', 'REMOVE'].map(holders);
  const appendOnly = ['marketIncidents', 'tradingLedger'];
  for (const name of [...unique, 'learningDays', 'learningMinutes', 'quizAttemptCounters', 'quizAttempts']) {
    assert.ok(find.has(name) && insert.has(name), `${name}: find and insert`);
    assert.equal(update.has(name) && remove.has(name), !appendOnly.includes(name), `${name}: update/remove only when not append-only`);
  }
  for (const name of appendOnly) {
    const actions = role.rolePrivileges(DB).filter((p) => p.resource.collection === name).flatMap((p) => p.actions);
    assert.deepEqual(actions, ['find', 'insert'], `${name} stays append-only`);
    for (const forbidden of role.AUDIT_FORBIDDEN_ACTIONS) assert.equal(holders(forbidden.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase()).has(name), false, `${name}: ${forbidden}`);
  }
});
