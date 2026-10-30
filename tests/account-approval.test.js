/**
 * H3: account approval and rejection are reserved for the Super Admin (lib/account-approval.js,
 * POST /api/admin/approvals). Covers every caller role, every action and target role,
 * self-approval, Super Admin protection, invalid ids, already-processed accounts, simultaneous
 * decisions, audit entries, signup roles and admin-role provisioning. Also covers user management
 * (PUT/DELETE /api/admin/users/:id): deletion is Super Admin only, and role changes and deletions
 * are audited, with audit failures reported. In-memory database only.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ObjectId } = require('mongodb');

const approval = require('../lib/account-approval');
const { AUDIT_COLLECTION } = require('../lib/course-payment');

const read = (relative) => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
const NOW = new Date('2026-10-30T10:00:00Z');

/** Users and audit rows in memory; supports the queries lib/account-approval.js makes. */
function memoryDb(seed) {
  const collections = { users: seed.map((row) => ({ ...row })), [AUDIT_COLLECTION]: [] };
  const sameId = (a, b) => String(a) === String(b);
  const matches = (doc, filter) =>
    Object.entries(filter).every(([key, cond]) => {
      if (key === '_id') return sameId(doc._id, cond);
      if (cond && typeof cond === 'object' && Array.isArray(cond.$in)) return cond.$in.includes(doc[key]);
      if (cond && typeof cond === 'object' && '$ne' in cond) return doc[key] !== cond.$ne;
      return doc[key] === cond;
    });
  return {
    rows: (name) => collections[name],
    collection(name) {
      collections[name] = collections[name] || [];
      const rows = collections[name];
      return {
        findOne: async (filter) => {
          const doc = rows.find((row) => matches(row, filter));
          return doc ? { ...doc } : null;
        },
        updateOne: async (filter, update) => {
          const doc = rows.find((row) => matches(row, filter));
          if (!doc) return { matchedCount: 0, modifiedCount: 0 };
          Object.assign(doc, update.$set || {});
          return { matchedCount: 1, modifiedCount: 1 };
        },
        insertOne: async (doc) => {
          rows.push({ ...doc });
          return { insertedId: new ObjectId() };
        },
        deleteOne: async (filter) => {
          const index = rows.findIndex((row) => matches(row, filter));
          if (index === -1) return { deletedCount: 0 };
          rows.splice(index, 1);
          return { deletedCount: 1 };
        },
      };
    },
  };
}

const ids = {
  superadmin: new ObjectId(),
  admin: new ObjectId(),
  instructor: new ObjectId(),
  student: new ObjectId(),
  pendingStudent: new ObjectId(),
  pendingInstructor: new ObjectId(),
  pendingAdmin: new ObjectId(),
  approvedInstructor: new ObjectId(),
  rejectedInstructor: new ObjectId(),
  legacyNoStatus: new ObjectId(),
};

function seed() {
  return [
    { _id: ids.superadmin, email: 'super@example.com', name: 'Super', role: 'superadmin', status: 'approved', sessionGeneration: 3 },
    { _id: ids.admin, email: 'admin@example.com', name: 'Admin', role: 'admin', status: 'approved' },
    { _id: ids.instructor, email: 'inst@example.com', name: 'Inst', role: 'instructor', status: 'approved' },
    { _id: ids.student, email: 'stud@example.com', name: 'Stud', role: 'student', status: 'approved' },
    { _id: ids.pendingStudent, email: 'ps@example.com', name: 'PS', role: 'student', status: 'pending', sessionGeneration: 1 },
    { _id: ids.pendingInstructor, email: 'pi@example.com', name: 'PI', role: 'instructor', status: 'pending' },
    { _id: ids.pendingAdmin, email: 'pa@example.com', name: 'PA', role: 'admin', status: 'pending' },
    { _id: ids.approvedInstructor, email: 'ai@example.com', name: 'AI', role: 'instructor', status: 'approved' },
    { _id: ids.rejectedInstructor, email: 'ri@example.com', name: 'RI', role: 'instructor', status: 'rejected' },
    { _id: ids.legacyNoStatus, email: 'old@example.com', name: 'Old', role: 'instructor' },
  ];
}

const actor = (role) => ({ userId: String(ids[role]), email: `${role}@example.com`, role });
const decide = (db, who, target, action, extra = {}) =>
  approval.decideAccountApproval(db, { actor: who, userId: typeof target === 'string' ? target : String(target), action, now: NOW, ...extra });

const userRow = (db, id) => db.rows('users').find((row) => String(row._id) === String(id));

test('only the Super Admin can approve or reject: every other role is refused without changes', async () => {
  for (const role of ['student', 'instructor', 'admin']) {
    for (const action of ['approve', 'reject']) {
      for (const target of [ids.pendingStudent, ids.pendingInstructor, ids.pendingAdmin]) {
        const db = memoryDb(seed());
        const result = await decide(db, actor(role), target, action);
        assert.equal(result.ok, false, `${role} ${action}`);
        assert.equal(result.status, 403);
        assert.equal(result.code, 'superadmin_required');
        assert.equal(userRow(db, target).status, 'pending', 'target unchanged');
        assert.equal(db.rows(AUDIT_COLLECTION).length, 0, 'nothing audited');
      }
    }
  }
  for (const missing of [null, undefined, {}, { userId: String(ids.superadmin), role: 'Superadmin' }]) {
    assert.equal(approval.decideApprovalRequest({ actor: missing, userId: String(ids.pendingAdmin), action: 'approve' }).status, 403);
  }
});

test('the Super Admin can approve and reject pending students, instructors and admins, each audited', async () => {
  const cases = [
    [ids.pendingStudent, 'student'],
    [ids.pendingInstructor, 'instructor'],
    [ids.pendingAdmin, 'admin'],
  ];
  for (const [target, role] of cases) {
    for (const action of ['approve', 'reject']) {
      const db = memoryDb(seed());
      const result = await decide(db, actor('superadmin'), target, action);
      const expected = action === 'approve' ? 'approved' : 'rejected';
      assert.equal(result.ok, true, `${action} ${role}`);
      assert.equal(result.status, 200);
      assert.deepEqual(result.user, { id: String(target), email: userRow(db, target).email, name: userRow(db, target).name, role, status: expected });

      const row = userRow(db, target);
      assert.equal(row.status, expected);
      assert.equal(row.role, role, 'role is never changed by a decision');
      assert.equal(row.reviewedBy, 'superadmin@example.com');
      assert.equal(row.reviewedById, String(ids.superadmin));
      assert.equal(row.reviewedAt, NOW);

      const audit = db.rows(AUDIT_COLLECTION);
      assert.equal(audit.length, 1);
      assert.deepEqual(audit[0], {
        entityType: 'account',
        entityId: String(target),
        reference: null,
        action: action === 'approve' ? 'account_approved' : 'account_rejected',
        reason: '',
        before: { status: 'pending', role },
        after: { status: expected, role },
        actor: { userId: String(ids.superadmin), email: 'superadmin@example.com' },
        createdAt: NOW,
      });
    }
  }
});

test('the Super Admin account is protected and the caller can never decide their own account', async () => {
  const db = memoryDb(seed());
  // A Super Admin record set to pending by bad data is still never a target.
  userRow(db, ids.superadmin).status = 'pending';
  const other = { userId: String(new ObjectId()), email: 'second-super@example.com', role: 'superadmin' };
  for (const action of ['approve', 'reject']) {
    const protectedResult = await decide(db, other, ids.superadmin, action);
    assert.equal(protectedResult.status, 403);
    assert.equal(protectedResult.code, 'superadmin_protected');

    const self = await decide(db, actor('superadmin'), ids.superadmin, action);
    assert.equal(self.status, 403);
    assert.equal(self.code, 'self_approval');
  }
  // Self-approval is refused before any lookup, for any pending caller id.
  const pendingSelf = { userId: String(ids.pendingAdmin), email: 'pa@example.com', role: 'superadmin' };
  assert.equal((await decide(db, pendingSelf, ids.pendingAdmin, 'approve')).code, 'self_approval');
  assert.equal(userRow(db, ids.pendingAdmin).status, 'pending');
  assert.equal(userRow(db, ids.superadmin).sessionGeneration, 3);
  assert.equal(db.rows(AUDIT_COLLECTION).length, 0);
});

test('invalid ids and actions get 400; unknown accounts get 404', async () => {
  const db = memoryDb(seed());
  for (const bad of [undefined, null, '', 'abc', '123', 'zzzzzzzzzzzzzzzzzzzzzzzz', `${ids.pendingAdmin}x`, 42, { $ne: null }, [String(ids.pendingAdmin)]]) {
    const result = await decide(db, actor('superadmin'), bad === undefined ? undefined : bad, 'approve', { userId: bad });
    assert.equal(result.status, 400, `id ${JSON.stringify(bad)}`);
    assert.equal(result.code, 'invalid_user_id');
  }
  for (const action of [undefined, '', 'APPROVE', 'delete', 'promote', ['approve'], 1]) {
    const result = await decide(db, actor('superadmin'), ids.pendingAdmin, action);
    assert.equal(result.status, 400, `action ${JSON.stringify(action)}`);
    assert.equal(result.code, 'invalid_action');
  }
  const unknown = await decide(db, actor('superadmin'), String(new ObjectId()), 'approve');
  assert.equal(unknown.status, 404);
  assert.equal(unknown.code, 'not_found');
  assert.equal(db.rows(AUDIT_COLLECTION).length, 0);
});

test('accounts that are not pending are refused as already processed', async () => {
  const db = memoryDb(seed());
  for (const target of [ids.approvedInstructor, ids.rejectedInstructor, ids.legacyNoStatus, ids.admin, ids.student]) {
    for (const action of ['approve', 'reject']) {
      const result = await decide(db, actor('superadmin'), target, action);
      assert.equal(result.status, 409, `${target} ${action}`);
      assert.equal(result.code, 'not_pending');
    }
  }
  assert.equal(userRow(db, ids.rejectedInstructor).status, 'rejected', 'a rejection cannot be turned into an approval');
  assert.equal('status' in userRow(db, ids.legacyNoStatus), false);
  assert.equal(db.rows(AUDIT_COLLECTION).length, 0);
});

test('a decided account cannot be decided again, and two simultaneous decisions produce one', async () => {
  const db = memoryDb(seed());
  assert.equal((await decide(db, actor('superadmin'), ids.pendingInstructor, 'approve')).ok, true);
  const again = await decide(db, actor('superadmin'), ids.pendingInstructor, 'reject');
  assert.equal(again.status, 409);
  assert.equal(userRow(db, ids.pendingInstructor).status, 'approved');

  const race = memoryDb(seed());
  const results = await Promise.all([
    decide(race, actor('superadmin'), ids.pendingAdmin, 'approve'),
    decide(race, actor('superadmin'), ids.pendingAdmin, 'reject'),
  ]);
  assert.deepEqual(results.map((r) => r.ok).sort(), [false, true]);
  assert.equal(results.find((r) => !r.ok).status, 409);
  assert.equal(race.rows(AUDIT_COLLECTION).length, 1, 'only the applied decision is audited');
  assert.equal(race.rows(AUDIT_COLLECTION)[0].after.status, userRow(race, ids.pendingAdmin).status);
});

test('a decision leaves session generation and the rest of the account untouched', async () => {
  const db = memoryDb(seed());
  const before = { ...userRow(db, ids.pendingStudent) };
  await decide(db, actor('superadmin'), ids.pendingStudent, 'reject');
  const after = userRow(db, ids.pendingStudent);
  assert.equal(after.sessionGeneration, before.sessionGeneration);
  for (const key of ['email', 'name', 'role']) assert.equal(after[key], before[key]);
});

test('every role transition that grants or removes instructor or admin access is Super Admin only', () => {
  const callers = ['student', 'instructor', 'admin', 'superadmin'];
  const assignable = ['student', 'instructor', 'admin'];
  for (const caller of callers) {
    for (const currentRole of [...assignable, 'superadmin']) {
      for (const newRole of assignable) {
        const result = approval.decideRoleChange({ actor: actor(caller), currentRole, newRole });
        const label = `${caller}: ${currentRole} -> ${newRole}`;
        if (currentRole === 'superadmin') {
          assert.deepEqual([result.status, result.code], [403, 'superadmin_protected'], label);
        } else if (newRole === currentRole) {
          assert.equal(result.ok, true, `${label} (no change)`);
        } else if (caller === 'superadmin') {
          assert.equal(result.ok, true, label);
        } else {
          assert.deepEqual([result.status, result.code], [403, 'superadmin_required'], label);
        }
      }
    }
  }
  // The transitions named in the policy, spelled out.
  const admin = actor('admin');
  const sa = actor('superadmin');
  for (const [from, to] of [['student', 'instructor'], ['instructor', 'student'], ['student', 'admin'], ['admin', 'student'], ['instructor', 'admin'], ['admin', 'instructor']]) {
    assert.equal(approval.decideRoleChange({ actor: admin, currentRole: from, newRole: to }).status, 403, `admin ${from} -> ${to}`);
    assert.equal(approval.decideRoleChange({ actor: sa, currentRole: from, newRole: to }).ok, true, `superadmin ${from} -> ${to}`);
  }
  assert.deepEqual([...approval.PRIVILEGED_ROLES], ['instructor', 'admin']);

  // The route applies role changes through changeAccountRole, which calls decideRoleChange.
  const route = read('pages/api/admin/users/[id].ts');
  assert.match(route, /const result = await changeAccountRole\(db, \{/);
  assert.match(read('lib/account-approval.js'), /const change = decideRoleChange\(\{ actor, currentRole: target\.role, newRole: role \}\);/);
  assert.match(route, /export default withAuth\(handler, \['admin', 'superadmin'\]\);/);
});

test('an audit write failure after a saved decision is reported, never as a silent success', async () => {
  const db = memoryDb(seed());
  const base = db.collection.bind(db);
  db.collection = (name) => {
    const col = base(name);
    if (name === AUDIT_COLLECTION) col.insertOne = async () => { throw new Error('audit store unavailable'); };
    return col;
  };
  const result = await decide(db, actor('superadmin'), ids.pendingInstructor, 'approve');
  assert.equal(result.ok, false);
  assert.equal(result.status, 500);
  assert.equal(result.code, 'audit_write_failed');
  assert.equal(result.decisionSaved, true);
  assert.equal(result.user.status, 'approved');
  // The decision stands and still names its reviewer on the account.
  const row = userRow(db, ids.pendingInstructor);
  assert.equal(row.status, 'approved');
  assert.equal(row.reviewedById, String(ids.superadmin));
  assert.equal(row.reviewedAt, NOW);
  // Repeating it cannot apply a second decision.
  assert.equal((await decide(db, actor('superadmin'), ids.pendingInstructor, 'reject')).status, 409);

  const route = read('pages/api/admin/approvals.ts');
  assert.match(route, /if \('decisionSaved' in result\) \{/);
  assert.match(route, /decisionSaved: true, user: result\.user/);
  const page = read('pages/admin/index.tsx');
  assert.match(page, /if \(decisionSavedWithoutAudit\(error\)\) \{/);
});

test('public signup accepts students and instructors only', () => {
  assert.deepEqual([...approval.PUBLIC_SIGNUP_ROLES], ['student', 'instructor']);
  const route = read('pages/api/auth/signup.ts');
  assert.match(route, /if \(!PUBLIC_SIGNUP_ROLES\.includes\(role\)\) \{\s*return res\.status\(400\)\.json\(\{ error: 'Invalid role' \}\);/);
  assert.doesNotMatch(route, /\['admin', 'instructor', 'student'\]/);
  const page = read('pages/signup.tsx');
  assert.doesNotMatch(page, /<option value="admin">/);
  assert.doesNotMatch(page, /<option value="superadmin">/);
});

test('the approvals route is Super Admin only and the admin page hides approvals from ordinary admins', () => {
  const route = read('pages/api/admin/approvals.ts');
  assert.match(route, /export default withAuth\(handler, \['superadmin'\]\);/);
  assert.match(route, /decideAccountApproval\(db, \{/);
  assert.doesNotMatch(route, /req\.user!\.role !== 'admin'/);

  const page = read('pages/admin/index.tsx');
  assert.match(page, /if \(user\.role === 'superadmin'\) loadPendingUsers\(\);/);
  assert.match(page, /\{isSuperAdmin && pendingUsers\.length > 0 && \(/);
  assert.match(page, /\{isSuperAdmin && \(\s*<button\s*onClick=\{\(\) => \{\s*setActiveTab\('approvals'\);/);
  assert.match(page, /\{activeTab === 'approvals' && isSuperAdmin && \(/);
  assert.match(page, /if \(activeTab === 'approvals' && user && user\.role !== 'superadmin'\) setActiveTab\('courses'\);/);
  assert.match(page, /disabled=\{userItem\.role === 'superadmin' \|\| !isSuperAdmin\}/);
  assert.match(page, /'Only the Super Admin can change roles'/);
});

test('account decisions appear in the Super Admin audit log and can be filtered', () => {
  assert.match(read('lib/admin-purchase-ledger.js'), /\['purchase', 'payment_exception', 'account'\]\.includes\(q\.entityType\)/);
});

// ---------------------------------------------------------------------------
// Through the real route: withAuth (JWT, live role and status, session binding) and approvals.ts.
// Only the database connection and the socket server are replaced.
// ---------------------------------------------------------------------------

const Module = require('module');
const ts = require('typescript');
const ROOT = path.join(__dirname, '..');

function loadRoute(db, route = 'pages/api/admin/approvals.ts') {
  const stubs = {
    [path.join(ROOT, 'lib/mongodb')]: { getDb: async () => db },
    [path.join(ROOT, 'lib/socket-server')]: { getSocketServer: () => null },
  };
  const cache = new Map();
  const load = (filename) => {
    if (cache.has(filename)) return cache.get(filename).exports;
    const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    });
    const mod = new Module(filename);
    mod.filename = filename;
    mod.paths = Module._nodeModulePaths(path.dirname(filename));
    cache.set(filename, mod);
    mod.require = (id) => {
      const base = id.startsWith('@/') ? path.join(ROOT, id.slice(2)) : id.startsWith('.') ? path.join(path.dirname(filename), id) : null;
      if (!base) return require(id);
      const bare = base.replace(/\.(ts|js)$/, '');
      if (stubs[bare]) return stubs[bare];
      for (const ext of ['.ts', '.tsx', '.js']) {
        if (fs.existsSync(bare + ext)) return ext === '.js' ? require(bare + ext) : load(bare + ext);
      }
      return require(base);
    };
    mod._compile(outputText, filename);
    return mod.exports;
  };
  return load(path.join(ROOT, route)).default;
}

/** memoryDb plus the middleware's projection read and the pending list query. */
function routeDb() {
  const db = memoryDb(seed());
  const base = db.collection.bind(db);
  db.collection = (name) => {
    const col = base(name);
    col.find = (filter) => {
      const rows = db.rows(name).filter((row) =>
        Object.entries(filter).every(([k, c]) => (c && Array.isArray(c.$in) ? c.$in.includes(row[k]) : row[k] === c))
      );
      const cursor = { sort: () => cursor, toArray: async () => rows.map((r) => ({ ...r })) };
      return cursor;
    };
    return col;
  };
  return db;
}

async function call(handler, { token, method = 'POST', body, query = {} }) {
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    getHeader(k) { return this.headers[k.toLowerCase()]; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  await handler({ method, headers: token ? { authorization: `Bearer ${token}` } : {}, body, query }, res);
  return res;
}

test('through the route: only a signed-in Super Admin reaches approvals; responses use 400/403/404/409', async () => {
  const savedSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'test-only-approval-secret';
  try {
    const { issueAuthToken } = require('../lib/token-core');
    const db = routeDb();
    const handler = loadRoute(db);
    const tokenFor = (key) => {
      const row = userRow(db, ids[key]);
      return issueAuthToken({ userId: String(row._id), email: row.email, role: row.role, generation: row.sessionGeneration });
    };
    const target = String(ids.pendingInstructor);

    assert.equal((await call(handler, { body: { userId: target, action: 'approve' } })).statusCode, 401, 'no token');
    for (const role of ['student', 'instructor', 'admin']) {
      for (const method of ['GET', 'POST']) {
        const res = await call(handler, { token: tokenFor(role), method, body: { userId: target, action: 'approve' } });
        assert.equal(res.statusCode, 403, `${role} ${method}`);
      }
    }
    // A pending or rejected account cannot use the route even with a token minted for it.
    assert.equal((await call(handler, { token: tokenFor('pendingAdmin'), body: { userId: target, action: 'approve' } })).statusCode, 403);
    assert.equal(userRow(db, ids.pendingInstructor).status, 'pending');

    const sa = tokenFor('superadmin');
    const list = await call(handler, { token: sa, method: 'GET' });
    assert.equal(list.statusCode, 200);
    assert.deepEqual(list.body.map((u) => u.id).sort(), [ids.pendingAdmin, ids.pendingInstructor, ids.pendingStudent].map(String).sort());
    assert.ok(list.body.every((u) => !('password' in u) && !('sessionGeneration' in u)));
    assert.equal(list.headers['cache-control'], 'no-store');

    assert.equal((await call(handler, { token: sa, body: { userId: 'not-an-id', action: 'approve' } })).statusCode, 400);
    assert.equal((await call(handler, { token: sa, body: { userId: target, action: 'promote' } })).statusCode, 400);
    assert.equal((await call(handler, { token: sa, body: undefined })).statusCode, 400);
    assert.equal((await call(handler, { token: sa, body: { userId: String(new ObjectId()), action: 'approve' } })).statusCode, 404);
    assert.equal((await call(handler, { token: sa, body: { userId: String(ids.superadmin), action: 'reject' } })).statusCode, 403);
    assert.equal((await call(handler, { token: sa, body: { userId: String(ids.approvedInstructor), action: 'reject' } })).statusCode, 409);

    const ok = await call(handler, { token: sa, body: { userId: target, action: 'approve' } });
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.body.user.status, 'approved');
    assert.equal((await call(handler, { token: sa, body: { userId: target, action: 'reject' } })).statusCode, 409);
    assert.equal(db.rows(AUDIT_COLLECTION).length, 1);
    assert.equal(db.rows(AUDIT_COLLECTION)[0].actor.userId, String(ids.superadmin));
    assert.equal(db.rows(AUDIT_COLLECTION)[0].action, 'account_approved');

    // The Super Admin's existing token still works: decisions do not touch sessions.
    assert.equal((await call(handler, { token: sa, method: 'GET' })).statusCode, 200);
  } finally {
    if (savedSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = savedSecret;
  }
});

test('through the route: role changes that grant or remove staff access need the Super Admin', async () => {
  const savedSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'test-only-approval-secret';
  try {
    const { issueAuthToken } = require('../lib/token-core');
    const db = routeDb();
    const handler = loadRoute(db, 'pages/api/admin/users/[id].ts');
    const tokenFor = (key) => {
      const row = userRow(db, ids[key]);
      return issueAuthToken({ userId: String(row._id), email: row.email, role: row.role, generation: row.sessionGeneration });
    };
    const put = (key, target, role) => call(handler, { token: tokenFor(key), method: 'PUT', query: { id: String(target) }, body: { role } });

    // Ordinary admin: every promotion and demotion is refused and nothing changes.
    for (const [target, role] of [
      [ids.student, 'instructor'],
      [ids.instructor, 'student'],
      [ids.student, 'admin'],
      [ids.instructor, 'admin'],
    ]) {
      const before = userRow(db, target).role;
      const res = await put('admin', target, role);
      assert.equal(res.statusCode, 403, `admin: ${before} -> ${role}`);
      assert.equal(userRow(db, target).role, before);
    }
    // Students and instructors cannot reach user management at all.
    assert.equal((await put('student', ids.instructor, 'student')).statusCode, 403);
    assert.equal((await put('instructor', ids.student, 'instructor')).statusCode, 403);
    // The Super Admin's role is never changed, by anyone.
    assert.equal((await put('admin', ids.superadmin, 'student')).statusCode, 403);
    assert.equal(userRow(db, ids.superadmin).role, 'superadmin');

    // Super Admin performs each transition.
    assert.equal((await put('superadmin', ids.student, 'instructor')).statusCode, 200);
    assert.equal(userRow(db, ids.student).role, 'instructor');
    assert.equal((await put('superadmin', ids.student, 'student')).statusCode, 200);
    assert.equal(userRow(db, ids.student).role, 'student');
    assert.equal((await put('superadmin', ids.instructor, 'admin')).statusCode, 200);
    assert.equal((await put('superadmin', ids.instructor, 'instructor')).statusCode, 200);
    assert.equal(userRow(db, ids.instructor).role, 'instructor');
    // Session generation is untouched by role changes, as before.
    assert.equal(userRow(db, ids.superadmin).sessionGeneration, 3);
  } finally {
    if (savedSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = savedSecret;
  }
});

// ---------------------------------------------------------------------------
// User management: account deletion is Super Admin only; role changes and deletions are audited.
// ---------------------------------------------------------------------------

const remove = (db, who, target, extra = {}) =>
  approval.deleteAccount(db, { actor: who, userId: typeof target === 'string' ? target : String(target), now: NOW, ...extra });
const changeRole = (db, who, target, role) =>
  approval.changeAccountRole(db, { actor: who, userId: String(target), role, now: NOW });

/** Makes every audit insert fail, as an unavailable audit store would. */
function failAuditWrites(db) {
  const base = db.collection.bind(db);
  db.collection = (name) => {
    const col = base(name);
    if (name === AUDIT_COLLECTION) col.insertOne = async () => { throw new Error('audit store unavailable'); };
    return col;
  };
  return db;
}

const deletableTargets = ['admin', 'instructor', 'student', 'pendingStudent', 'pendingInstructor', 'pendingAdmin', 'approvedInstructor', 'rejectedInstructor', 'legacyNoStatus'];

test('only the Super Admin can delete accounts: every other role is refused for every target, with nothing deleted', async () => {
  for (const role of ['student', 'instructor', 'admin']) {
    for (const key of deletableTargets) {
      const db = memoryDb(seed());
      const result = await remove(db, actor(role), ids[key]);
      assert.deepEqual([result.ok, result.status, result.code], [false, 403, 'superadmin_required'], `${role} deletes ${key}`);
      assert.ok(userRow(db, ids[key]), 'account still exists');
      assert.equal(db.rows('users').length, seed().length);
      assert.equal(db.rows(AUDIT_COLLECTION).length, 0, 'nothing audited');
    }
  }
  // Refused before any lookup, for a missing actor or a role that only looks like Super Admin.
  for (const missing of [null, undefined, {}, { userId: String(ids.superadmin), role: 'Superadmin' }, { userId: String(ids.admin), role: 'super-admin' }]) {
    const decision = approval.decideDeletionRequest({ actor: missing, userId: String(ids.student) });
    assert.deepEqual([decision.status, decision.code], [403, 'superadmin_required']);
  }
});

test('the Super Admin can delete every other account; each deletion is audited with the account it removed', async () => {
  for (const key of deletableTargets) {
    const db = memoryDb(seed());
    const before = { ...userRow(db, ids[key]) };
    const result = await remove(db, actor('superadmin'), ids[key]);
    assert.equal(result.ok, true, key);
    assert.equal(result.status, 200);
    assert.deepEqual(result.user, { id: String(ids[key]), email: before.email, role: before.role });
    assert.equal(userRow(db, ids[key]), undefined, 'hard delete, as before');
    assert.equal(db.rows('users').length, seed().length - 1, 'only that account is removed');

    const audit = db.rows(AUDIT_COLLECTION);
    assert.equal(audit.length, 1);
    assert.deepEqual(audit[0], {
      entityType: 'account',
      entityId: String(ids[key]),
      reference: null,
      action: 'account_deleted',
      reason: '',
      before: { email: before.email, role: before.role, status: before.status === undefined ? null : before.status },
      after: null,
      actor: { userId: String(ids.superadmin), email: 'superadmin@example.com' },
      createdAt: NOW,
    });
    assert.equal('password' in audit[0].before, false, 'no credentials in the audit entry');
  }
});

test('deletion never removes the Super Admin or the caller, and rejects bad or unknown ids', async () => {
  const db = memoryDb(seed());
  const otherSuper = { userId: String(new ObjectId()), email: 'second-super@example.com', role: 'superadmin' };
  const protectedResult = await remove(db, otherSuper, ids.superadmin);
  assert.deepEqual([protectedResult.status, protectedResult.code, protectedResult.error], [403, 'superadmin_protected', 'Cannot delete Super Admin account']);

  const self = await remove(db, actor('superadmin'), ids.superadmin);
  assert.deepEqual([self.status, self.code, self.error], [400, 'self_deletion', 'Cannot delete your own account']);

  // Another Super Admin record (bad data) is protected even when the caller is a Super Admin.
  const secondSuperId = new ObjectId();
  db.rows('users').push({ _id: secondSuperId, email: 'dup-super@example.com', role: 'superadmin', status: 'approved' });
  assert.equal((await remove(db, actor('superadmin'), secondSuperId)).code, 'superadmin_protected');

  for (const bad of [undefined, null, '', 'abc', 'not-a-hex-id', 'zzzzzzzzzzzzzzzzzzzzzzzz', `${ids.student}x`, '123456789012', 42, { $ne: null }, [String(ids.student)]]) {
    const result = await remove(db, actor('superadmin'), bad, { userId: bad });
    assert.deepEqual([result.status, result.code], [400, 'invalid_user_id'], `id ${JSON.stringify(bad)}`);
  }
  const unknown = await remove(db, actor('superadmin'), String(new ObjectId()));
  assert.deepEqual([unknown.status, unknown.code], [404, 'not_found']);

  assert.ok(userRow(db, ids.superadmin));
  assert.ok(userRow(db, secondSuperId));
  assert.equal(db.rows(AUDIT_COLLECTION).length, 0, 'refusals are not audited');
});

test('the Super Admin stays protected if the record becomes a Super Admin between the check and the delete', async () => {
  const db = memoryDb(seed());
  const base = db.collection.bind(db);
  db.collection = (name) => {
    const col = base(name);
    if (name === 'users') {
      const findOne = col.findOne;
      col.findOne = async (filter, options) => {
        const doc = await findOne(filter, options);
        // Promoted by someone else right after the read.
        userRow(db, ids.admin).role = 'superadmin';
        return doc;
      };
    }
    return col;
  };
  const result = await remove(db, actor('superadmin'), ids.admin);
  assert.deepEqual([result.status, result.code], [404, 'not_found']);
  assert.ok(userRow(db, ids.admin), 'not deleted');
  assert.equal(db.rows(AUDIT_COLLECTION).length, 0);
});

test('two simultaneous deletions of one account delete it once and audit it once', async () => {
  const db = memoryDb(seed());
  const results = await Promise.all([remove(db, actor('superadmin'), ids.instructor), remove(db, actor('superadmin'), ids.instructor)]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 404]);
  assert.equal(userRow(db, ids.instructor), undefined);
  assert.equal(db.rows(AUDIT_COLLECTION).length, 1);
});

test('a deletion whose audit entry cannot be written is reported as saved without audit, never as a success', async () => {
  const db = failAuditWrites(memoryDb(seed()));
  const result = await remove(db, actor('superadmin'), ids.pendingInstructor);
  assert.equal(result.ok, false);
  assert.equal(result.status, 500);
  assert.equal(result.code, 'audit_write_failed');
  assert.equal(result.decisionSaved, true);
  assert.match(result.error, /deletion was saved, but the audit entry could not be written/);
  assert.deepEqual(result.user, { id: String(ids.pendingInstructor), email: 'pi@example.com', role: 'instructor' });
  assert.equal(userRow(db, ids.pendingInstructor), undefined, 'the deletion stands');
  // Repeating it finds nothing to delete and cannot be mistaken for a success.
  assert.equal((await remove(db, actor('superadmin'), ids.pendingInstructor)).status, 404);
});

test('a role change is audited with its before and after roles; a request that changes nothing is not', async () => {
  const transitions = [
    ['student', 'instructor'], ['instructor', 'student'], ['student', 'admin'],
    ['admin', 'student'], ['instructor', 'admin'], ['admin', 'instructor'],
  ];
  for (const [from, to] of transitions) {
    const db = memoryDb(seed());
    const target = { student: ids.student, instructor: ids.instructor, admin: ids.admin }[from];
    const result = await changeRole(db, actor('superadmin'), target, to);
    assert.deepEqual(result, { ok: true, status: 200, user: { id: String(target), role: to } }, `${from} -> ${to}`);
    assert.equal(userRow(db, target).role, to);
    assert.equal(userRow(db, target).updatedAt, NOW);
    assert.deepEqual(db.rows(AUDIT_COLLECTION), [{
      entityType: 'account',
      entityId: String(target),
      reference: null,
      action: 'role_changed',
      reason: '',
      before: { role: from },
      after: { role: to },
      actor: { userId: String(ids.superadmin), email: 'superadmin@example.com' },
      createdAt: NOW,
    }]);
  }
  // Unchanged role: accepted for any staff caller, as before, and nothing is audited.
  for (const who of ['admin', 'superadmin']) {
    const db = memoryDb(seed());
    const same = await changeRole(db, actor(who), ids.student, 'student');
    assert.equal(same.ok, true, who);
    assert.equal(db.rows(AUDIT_COLLECTION).length, 0);
  }
});

test('refused role changes change nothing and are not audited', async () => {
  const db = memoryDb(seed());
  for (const [target, role] of [[ids.student, 'instructor'], [ids.instructor, 'student'], [ids.student, 'admin'], [ids.admin, 'student']]) {
    const before = userRow(db, target).role;
    const result = await changeRole(db, actor('admin'), target, role);
    assert.deepEqual([result.status, result.code], [403, 'superadmin_required']);
    assert.equal(userRow(db, target).role, before);
  }
  assert.equal((await changeRole(db, actor('superadmin'), ids.superadmin, 'student')).code, 'superadmin_protected');
  for (const role of [undefined, '', 'superadmin', 'Admin', ['admin'], 1]) {
    assert.equal((await changeRole(db, actor('superadmin'), ids.student, role)).status, 400, `role ${JSON.stringify(role)}`);
  }
  assert.equal((await approval.changeAccountRole(db, { actor: actor('superadmin'), userId: undefined, role: 'student' })).error, 'Invalid user ID');
  assert.equal((await approval.changeAccountRole(db, { actor: actor('superadmin'), userId: 'not-an-id', role: 'student' })).error, 'Invalid user ID format');
  assert.equal((await changeRole(db, actor('superadmin'), new ObjectId(), 'student')).status, 404);
  assert.equal(userRow(db, ids.superadmin).role, 'superadmin');
  assert.equal(db.rows(AUDIT_COLLECTION).length, 0);
});

test('two simultaneous role changes apply one and refuse the other, so the audit entry matches the account', async () => {
  const db = memoryDb(seed());
  const results = await Promise.all([
    changeRole(db, actor('superadmin'), ids.student, 'instructor'),
    changeRole(db, actor('superadmin'), ids.student, 'admin'),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  assert.equal(results.find((r) => !r.ok).code, 'concurrent_change');
  const audit = db.rows(AUDIT_COLLECTION);
  assert.equal(audit.length, 1);
  assert.deepEqual(audit[0].before, { role: 'student' });
  assert.equal(audit[0].after.role, userRow(db, ids.student).role);
});

test('a role change whose audit entry cannot be written is reported as saved without audit, never as a success', async () => {
  const db = failAuditWrites(memoryDb(seed()));
  const result = await changeRole(db, actor('superadmin'), ids.student, 'instructor');
  assert.deepEqual([result.ok, result.status, result.code, result.decisionSaved], [false, 500, 'audit_write_failed', true]);
  assert.match(result.error, /role change was saved, but the audit entry could not be written/);
  assert.deepEqual(result.user, { id: String(ids.student), role: 'instructor' });
  assert.equal(userRow(db, ids.student).role, 'instructor', 'the change stands');
});

test('the admin page shows Delete only to the Super Admin and reports changes saved without audit', () => {
  const page = read('pages/admin/index.tsx');
  assert.match(page, /\{isSuperAdmin && \(\s*<button\s*onClick=\{\(\) => handleDeleteUser\(userItem\._id \|\| userItem\.id\)\}/);
  assert.equal((page.match(/handleDeleteUser\(/g) || []).length, 1, 'the only call is the Super Admin-only button');
  const handlerBody = (name) => {
    const start = page.indexOf(`const ${name} = async`);
    return page.slice(start, page.indexOf('\n  };', start));
  };
  assert.match(handlerBody('handleDeleteUser'), /if \(decisionSavedWithoutAudit\(error\)\) \{/);
  assert.match(handlerBody('handleUpdateUserRole'), /if \(decisionSavedWithoutAudit\(error\)\) \{/);

  const route = read('pages/api/admin/users/[id].ts');
  assert.match(route, /const result = await deleteAccount\(db, \{/);
  assert.doesNotMatch(route, /deleteOne\(/, 'the route deletes only through deleteAccount');
  assert.doesNotMatch(route, /updateOne\(/, 'the route changes roles only through changeAccountRole');
});

test('through the route: only a signed-in Super Admin can delete an account; deletions and role changes are audited', async () => {
  const savedSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'test-only-approval-secret';
  try {
    const { issueAuthToken } = require('../lib/token-core');
    const db = routeDb();
    const handler = loadRoute(db, 'pages/api/admin/users/[id].ts');
    const tokens = {};
    for (const key of Object.keys(ids)) {
      const row = userRow(db, ids[key]);
      tokens[key] = issueAuthToken({ userId: String(row._id), email: row.email, role: row.role, generation: row.sessionGeneration });
    }
    const del = (key, target) => call(handler, { token: key && tokens[key], method: 'DELETE', query: { id: String(target) } });
    const count = () => db.rows('users').length;
    const initial = count();

    assert.equal((await del(null, ids.student)).statusCode, 401, 'no token');
    // Students and instructors are refused by the middleware; ordinary admins by the deletion rule.
    for (const caller of ['student', 'instructor']) {
      assert.equal((await del(caller, ids.pendingStudent)).statusCode, 403, caller);
    }
    for (const key of deletableTargets.filter((k) => k !== 'admin')) {
      const res = await del('admin', ids[key]);
      assert.equal(res.statusCode, 403, `admin deletes ${key}`);
      assert.equal(res.body.code, 'superadmin_required');
    }
    assert.equal((await del('admin', ids.superadmin)).statusCode, 403);
    // Pending staff cannot use their tokens at all.
    assert.equal((await del('pendingAdmin', ids.student)).statusCode, 403);
    assert.equal(count(), initial, 'nothing deleted by any refused caller');
    assert.equal(db.rows(AUDIT_COLLECTION).length, 0);

    // Super Admin: bad id, unknown id, own account and wrong method keep their responses.
    assert.equal((await del('superadmin', 'not-a-hex-id')).statusCode, 400);
    assert.equal((await del('superadmin', new ObjectId())).statusCode, 404);
    const self = await del('superadmin', ids.superadmin);
    assert.deepEqual([self.statusCode, self.body.error], [400, 'Cannot delete your own account']);
    assert.equal((await call(handler, { token: tokens.superadmin, method: 'POST', query: { id: String(ids.student) } })).statusCode, 405);
    // PATCH is suspension and reactivation (tests/account-security.test.js); without an action it changes nothing.
    assert.equal((await call(handler, { token: tokens.superadmin, method: 'PATCH', query: { id: String(ids.student) } })).statusCode, 400);

    const ok = await del('superadmin', ids.pendingInstructor);
    assert.deepEqual([ok.statusCode, ok.body], [200, { success: true, message: 'User deleted successfully' }]);
    assert.equal(userRow(db, ids.pendingInstructor), undefined);
    assert.equal(count(), initial - 1);
    assert.equal((await del('superadmin', ids.pendingInstructor)).statusCode, 404, 'already deleted');

    const roleRes = await call(handler, { token: tokens.superadmin, method: 'PUT', query: { id: String(ids.student) }, body: { role: 'instructor' } });
    assert.deepEqual([roleRes.statusCode, roleRes.body], [200, { success: true, message: 'User role updated to instructor successfully' }]);
    assert.equal((await call(handler, { token: tokens.superadmin, method: 'PUT', query: { id: String(ids.student) }, body: undefined })).statusCode, 400);

    const audit = db.rows(AUDIT_COLLECTION);
    assert.deepEqual(audit.map((row) => [row.action, row.entityId, row.actor.userId]), [
      ['account_deleted', String(ids.pendingInstructor), String(ids.superadmin)],
      ['role_changed', String(ids.student), String(ids.superadmin)],
    ]);
    assert.equal(audit[0].actor.email, 'super@example.com', 'actor is the signed-in account');
    assert.deepEqual(audit[0].before, { email: 'pi@example.com', role: 'instructor', status: 'pending' });
    assert.deepEqual([audit[1].before, audit[1].after], [{ role: 'student' }, { role: 'instructor' }]);
  } finally {
    if (savedSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = savedSecret;
  }
});

test('through the route: a deletion or role change saved without its audit entry returns 500 with decisionSaved', async () => {
  const savedSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'test-only-approval-secret';
  const originalError = console.error;
  const logged = [];
  console.error = (line) => logged.push(String(line));
  try {
    const { issueAuthToken } = require('../lib/token-core');
    const db = failAuditWrites(routeDb());
    const handler = loadRoute(db, 'pages/api/admin/users/[id].ts');
    const row = userRow(db, ids.superadmin);
    const token = issueAuthToken({ userId: String(row._id), email: row.email, role: row.role, generation: row.sessionGeneration });

    const deleted = await call(handler, { token, method: 'DELETE', query: { id: String(ids.student) } });
    assert.equal(deleted.statusCode, 500);
    assert.deepEqual(deleted.body, {
      error: 'The deletion was saved, but the audit entry could not be written. Do not repeat it.',
      code: 'audit_write_failed',
      decisionSaved: true,
      user: { id: String(ids.student), email: 'stud@example.com', role: 'student' },
    });
    assert.equal(userRow(db, ids.student), undefined);

    const changed = await call(handler, { token, method: 'PUT', query: { id: String(ids.instructor) }, body: { role: 'admin' } });
    assert.equal(changed.statusCode, 500);
    assert.deepEqual(changed.body, {
      error: 'The role change was saved, but the audit entry could not be written. Do not repeat it.',
      code: 'audit_write_failed',
      decisionSaved: true,
      user: { id: String(ids.instructor), role: 'admin' },
    });
    assert.equal(userRow(db, ids.instructor).role, 'admin');

    assert.deepEqual(logged.map((line) => JSON.parse(line)), [
      { event: 'accountDeletion', result: 'audit_write_failed', userId: String(ids.student) },
      { event: 'accountRoleChange', result: 'audit_write_failed', userId: String(ids.instructor) },
    ]);
  } finally {
    console.error = originalError;
    if (savedSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = savedSecret;
  }
});
