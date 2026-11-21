/**
 * Phase 13: admin portal and platform operations (backend and routes).
 *
 * Routes run through the real withAuth (session cookie, live role and status) over the in-memory
 * stand-in (tests/helpers/payment-memory-db.js); the database connection, socket server and
 * notification delivery are replaced. Not real-MongoDB or real-Paystack coverage.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const { ObjectId } = require('mongodb');

const { paymentMemoryDb } = require('./helpers/payment-memory-db');
const { loadModule, mockResponse } = require('./helpers/ts-loader');
const { requestHeaders, seedSession } = require('./helpers/session-cookie');
const A = require('../lib/admin-portal');
const payment = require('../lib/course-payment');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const ROUTE_ENV = { NODE_ENV: 'test', PAYSTACK_SECRET_KEY: 'sk_test_phase13_unit_only', MONGODB_DB_NAME: 'forexorbit_p13_test', MONGO_URI: 'mongodb://127.0.0.1:27017', APP_ORIGIN: undefined, PORT: undefined, SHARED_RATE_LIMIT: undefined };
const newId = () => new ObjectId().toHexString();
const NOW = Date.now();
const ago = (h) => new Date(NOW - h * 3600000);
const C = payment.COLLECTIONS;

async function withEnv(env, fn) {
  const saved = {};
  for (const key of Object.keys(env)) {
    saved[key] = process.env[key];
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}
const route = (fn) => () => withEnv(ROUTE_ENV, fn);

function world() {
  const db = paymentMemoryDb({});
  const w = { s1: newId(), s2: newId(), s3: newId(), sP: newId(), i1: newId(), iX: newId(), admin: newId(), adminX: newId(), sa: newId(), C1: newId(), C2: newId(), C3: newId() };
  const hash = bcrypt.hashSync('Correct-Horse-9', 4);
  const user = (id, role, extra = {}) => db.rows('users').push({ _id: new ObjectId(id), email: `${role}-${id.slice(-6)}@example.test`, phone: '+2348011112222', name: `${role} ${id.slice(-4)}`, role, status: 'approved', sessionGeneration: 0, password: hash, createdAt: ago(48), ...extra });
  user(w.s1, 'student', { name: 'Sam Student' });
  user(w.s2, 'student', { name: 'Sus Pended', status: 'suspended', statusReason: 'Chargeback investigation' });
  user(w.s3, 'student', { name: '=HYPERLINK("http://evil.example","x")' });
  user(w.sP, 'instructor', { name: 'Pending Person', status: 'pending', createdAt: ago(2) });
  user(w.i1, 'instructor', { name: 'Ivy Instructor' });
  user(w.iX, 'instructor', { name: 'Gone Instructor', status: 'suspended' });
  user(w.admin, 'admin', { name: 'Ada Admin' });
  user(w.adminX, 'admin', { name: 'Suspended Admin', status: 'suspended' });
  user(w.sa, 'superadmin', { name: 'Super Admin' });
  const course = (id, title, status, instructorId) => db.rows('courses').push({ _id: new ObjectId(id), title, status, instructorId, updatedAt: ago(5), createdAt: ago(500) });
  course(w.C1, 'Price Action', 'published', w.i1);
  course(w.C2, 'Risk Basics', 'in_review', w.iX);
  course(w.C3, 'Orphan Draft', 'draft', undefined);
  db.rows('lessons').push({ _id: new ObjectId(), courseId: w.C1, title: 'L1', order: 1 });
  db.rows('progress').push(
    { _id: new ObjectId(), userId: w.s1, courseId: w.C1, progress: 100, completedAt: ago(10), enrolledAt: ago(40), active: true },
    { _id: new ObjectId(), userId: w.s3, courseId: w.C1, progress: 20, enrolledAt: ago(30), active: true },
    { _id: new ObjectId(), userId: w.s2, courseId: w.C1, progress: 0, enrolledAt: ago(300), withdrawnAt: ago(200) },
  );
  db.rows(C.courseAccess).push(
    { _id: new ObjectId(), userId: w.s1, courseId: w.C1, paid: true, entitlementType: 'paid_course', paystackReference: 'ref_paid_1', unlockedAt: ago(40) },
    { _id: new ObjectId(), userId: w.s3, courseId: w.C1, entitlementType: 'complimentary', unlockedAt: ago(30) },
  );
  const intent = (reference, status, extra = {}) => db.rows(C.intents).push({ _id: new ObjectId(), reference, userId: w.s1, courseId: w.C1, kind: 'course', amountKobo: 2500000, currency: 'NGN', status, createdAt: ago(40), expiresAt: new Date(NOW + 3600000), ...extra });
  intent('ref_paid_1', 'paid', { paidAt: ago(40) });
  intent('ref_pending', 'pending', { createdAt: ago(1) });
  intent('ref_old_pending', 'pending', { createdAt: ago(72), expiresAt: ago(70) });
  intent('ref_stalled', 'processing', { claimedAt: ago(5) });
  intent('ref_confirming', 'processing', { claimedAt: new Date(NOW - 5000) });
  intent('ref_held', 'held', { heldReason: 'duplicate_purchase' });
  intent('ref_closed', 'superseded');
  intent('ref_refunded', 'paid', { paidAt: ago(30), userId: w.s3 });
  intent('ref_refund_open', 'paid', { paidAt: ago(20) });
  db.rows(C.refunds).push(
    { _id: new ObjectId(), paymentReference: 'ref_refunded', userId: w.s3, courseId: w.C1, amountKobo: 2500000, status: 'processed', full: true, revokeAccess: false, reason: 'Duplicate', requestedAt: ago(20), updatedAt: ago(19) },
    { _id: new ObjectId(), paymentReference: 'ref_refund_open', userId: w.s1, courseId: w.C1, amountKobo: 1000000, status: 'uncertain', full: false, reason: 'Goodwill', requestedAt: ago(5), updatedAt: ago(5) },
  );
  db.rows(C.exceptions).push({ _id: new ObjectId(), reference: 'ref_held', reason: 'duplicate_purchase', createdAt: ago(10) });
  db.rows('adminAuditLog').push({ _id: new ObjectId(), entityType: 'account', entityId: w.s2, action: 'account_suspended', reason: 'Chargeback investigation', before: { status: 'approved' }, after: { status: 'suspended' }, actor: { userId: w.sa, email: 'superadmin@example.test' }, createdAt: ago(3) });
  db.rows('learningDays').push({ _id: `${w.s1}:x`, userId: w.s1, day: new Date(NOW).toISOString().slice(0, 10), minutes: 30 });

  const notifications = [];
  const stubs = {
    'lib/mongodb': { getDb: async () => db },
    'lib/socket-server': { getSocketServer: () => null },
    'lib/notifications': { createNotification: async (n) => { notifications.push(n); return 'n1'; }, createNotificationsForUsers: async (ids, n) => { notifications.push({ ...n, userIds: ids }); return ids; } },
  };
  const r = {};
  for (const name of ['overview', 'users/index', 'users/[id]', 'courses', 'enrollments', 'payments', 'refunds', 'reports', 'config', 'audit', 'export']) r[name] = loadModule(`pages/api/admin/portal/${name}.ts`, stubs).default;
  r.patchUser = loadModule('pages/api/admin/users/[id].ts', stubs).default;
  r.approvals = loadModule('pages/api/admin/approvals.ts', stubs).default;
  r.login = loadModule('pages/api/auth/login.ts', stubs).default;
  r.signup = loadModule('pages/api/auth/signup.ts', stubs).default;
  const T = {};
  for (const key of ['s1', 's2', 'i1', 'admin', 'adminX', 'sa']) T[key] = seedSession(db.rows('sessions'), { userId: w[key], generation: 0, now: new Date() });
  return { db, w, r, T, notifications, stubs };
}

async function call(handler, { method = 'GET', token, body, query = {} } = {}) {
  const res = mockResponse();
  res.send = function send(payload) { this.body = payload; return this; };
  await handler({ method, url: '/api/test', headers: requestHeaders(token), body, query, socket: { remoteAddress: '10.0.0.13' } }, res);
  return res;
}
const sup = (x) => ({ userId: x.w.sa, role: 'superadmin', email: 'superadmin@example.test' });
const adm = (x) => ({ userId: x.w.admin, role: 'admin', email: 'admin@example.test' });

// ---------------------------------------------------------------------------
// Roles and boundaries
// ---------------------------------------------------------------------------

test('roles: students, instructors and suspended admins are refused; admins are refused the Super Admin areas', route(async () => {
  const x = world();
  const all = ['overview', 'users/index', 'courses', 'enrollments', 'payments', 'refunds', 'reports', 'config', 'audit'];
  for (const name of all) {
    assert.equal((await call(x.r[name], { token: x.T.s1 })).statusCode, 403, `${name}: student`);
    assert.equal((await call(x.r[name], { token: x.T.i1 })).statusCode, 403, `${name}: instructor`);
    assert.ok([401, 403].includes((await call(x.r[name], { token: x.T.adminX })).statusCode), `${name}: suspended admin`);
    assert.equal((await call(x.r[name], {})).statusCode, 401, `${name}: signed out`);
    assert.equal((await call(x.r[name], { token: x.T.sa })).statusCode, 200, `${name}: Super Admin`);
  }
  for (const name of ['overview', 'users/index', 'courses', 'enrollments', 'reports', 'config']) assert.equal((await call(x.r[name], { token: x.T.admin })).statusCode, 200, `${name}: admin`);
  for (const name of ['payments', 'refunds', 'audit']) assert.equal((await call(x.r[name], { token: x.T.admin })).statusCode, 403, `${name}: admin is refused`);
  const res = await call(x.r.overview, { token: x.T.admin });
  assert.match(String(res.headers['cache-control']), /no-store/);
  assert.equal((await call(x.r.overview, { method: 'POST', token: x.T.sa })).statusCode, 405);
}));

test('approval and suspension stay Super Admin only, through the existing routes', route(async () => {
  const x = world();
  const approve = await call(x.r.approvals, { method: 'POST', token: x.T.admin, body: { userId: x.w.sP, action: 'approve' } });
  assert.equal(approve.statusCode, 403);
  const suspend = await call(x.r.patchUser, { method: 'PATCH', token: x.T.admin, body: { action: 'suspend', reason: 'Testing the boundary' }, query: { id: x.w.s1 } });
  assert.equal(suspend.statusCode, 403);
  assert.equal(x.db.rows('users').find((u) => String(u._id) === x.w.s1).status, 'approved');
  const ok = await call(x.r.patchUser, { method: 'PATCH', token: x.T.sa, body: { action: 'suspend', reason: 'Fraud review in progress' }, query: { id: x.w.s1 } });
  assert.equal(ok.statusCode, 200);
  assert.ok(x.db.rows('adminAuditLog').some((e) => e.entityType === 'account' && e.entityId === x.w.s1 && e.action === 'account_suspended'));
  // The suspended student's stale session no longer works anywhere.
  assert.ok([401, 403].includes((await call(x.r.overview, { token: x.T.s1 })).statusCode));
}));

test('suspended accounts: sign-in is refused even with the right password', route(async () => {
  const x = world();
  const res = await call(x.r.login, { method: 'POST', body: { email: x.db.rows('users').find((u) => String(u._id) === x.w.s2).email, password: 'Correct-Horse-9' } });
  assert.equal(res.statusCode, 403);
  assert.ok(!(res.headers['set-cookie'] || '').toString().includes('session'), 'no session cookie');
  // Password reset uses the same live account check (lib/password-reset.js).
  assert.match(read('lib/password-reset.js'), /const access = decideAccountAccess\(\{ userId: String\(user\._id\), record: user \}\);/);
}));

test('signup: a pending account notifies the Super Admin only, once', route(async () => {
  const x = world();
  // MongoDB assigns ObjectIds to new documents; the stand-in uses plain strings unless told.
  const users = x.db.collection('users');
  const insertOne = users.insertOne.bind(users);
  users.insertOne = (doc, ...rest) => insertOne({ _id: new ObjectId(), ...doc }, ...rest);
  const res = await call(x.r.signup, { method: 'POST', body: { name: 'New Teacher', email: 'teacher.new@example.test', password: 'Strong-Password-42!', role: 'instructor' } });
  assert.equal(res.statusCode, 201, JSON.stringify(res.body));
  const n = x.notifications.find((m) => m.title === 'Account waiting for approval');
  assert.ok(n, 'the Super Admin is told');
  assert.deepEqual(n.userIds, [x.w.sa], 'ordinary admins are not notified about approvals');
  assert.equal(n.dedupeKey, `pending-account:${res.body.user.id}`, "one notice per account");
  const student = await call(x.r.signup, { method: 'POST', body: { name: 'New Student', email: 'student.new@example.test', password: 'Strong-Password-42!', role: 'student' } });
  assert.equal(student.statusCode, 201);
  assert.equal(x.notifications.filter((m) => m.title === 'Account waiting for approval').length, 1, 'students are approved at signup: no notice');
}));

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

test('overview (admin): platform metrics, no finance, no audit, no approval alert', route(async () => {
  const x = world();
  const res = await call(x.r.overview, { token: x.T.admin, query: { days: '30' } });
  const m = res.body.metrics;
  assert.deepEqual([m.students, m.activeStudents, m.instructors, m.activeInstructors, m.suspended], [3, 2, 3, 1, 3]);
  assert.deepEqual(m.coursesByStatus, { draft: 1, in_review: 1, published: 1, archived: 0 });
  assert.deepEqual([m.enrollments, m.completions, m.coursesNeedingInstructor, m.activeLearners], [2, 1, 2, 1]);
  assert.equal(res.body.finance, null);
  assert.equal(res.body.recentActions, null);
  assert.ok(!res.body.alerts.some((a) => a.id === 'pending_approvals'));
  assert.ok(res.body.alerts.some((a) => a.id === 'courses_in_review'));
  assert.ok(res.body.alerts.some((a) => a.id === 'courses_without_instructor'));
  assert.ok(!JSON.stringify(res.body).includes('25000'), 'no money figures for an admin');
}));

test('overview (Super Admin): exact money, pending never counted as revenue, financial alerts', route(async () => {
  const x = world();
  const res = await call(x.r.overview, { token: x.T.sa, query: { days: '30' } });
  const f = res.body.finance;
  assert.deepEqual([f.gross, f.refunds, f.net, f.paidCount], ['75000.00', '25000.00', '50000.00', 3]);
  assert.deepEqual([f.states.pending, f.states.abandoned, f.states.stalled, f.states.confirming, f.states.held, f.states.closed], [1, 1, 1, 1, 1, 1]);
  assert.deepEqual([f.openExceptions, f.held, f.refundsNeedingAttention], [1, 1, 1]);
  const ids = res.body.alerts.map((a) => a.id);
  for (const id of ['pending_approvals', 'payment_exceptions', 'stalled_confirmations', 'held_payments', 'refunds_attention']) assert.ok(ids.includes(id), id);
  assert.equal(res.body.recentActions[0].action, 'account_suspended');
}));

// ---------------------------------------------------------------------------
// Users, courses, enrollments
// ---------------------------------------------------------------------------

test('users: server-side search, filters and pagination; no personal details in the list', route(async () => {
  const x = world();
  assert.deepEqual((await call(x.r['users/index'], { token: x.T.admin, query: { q: 'sam' } })).body.rows.map((u) => u.name), ['Sam Student']);
  const suspended = await call(x.r['users/index'], { token: x.T.admin, query: { status: 'suspended' } });
  assert.deepEqual(suspended.body.rows.map((u) => u.status), ['suspended', 'suspended', 'suspended']);
  const instructors = await call(x.r['users/index'], { token: x.T.admin, query: { role: 'instructor' } });
  assert.equal(instructors.body.rows.find((u) => u.id === x.w.i1).courses, 1);
  const paged = await call(x.r['users/index'], { token: x.T.admin, query: { limit: '2', page: '2' } });
  assert.deepEqual([paged.body.rows.length, paged.body.pagination.pages], [2, 5]);
  assert.ok(!JSON.stringify(paged.body).includes('+234'), 'no phone numbers in the list');
  assert.equal(paged.body.canChangeStatus, false);
  assert.equal((await call(x.r['users/index'], { token: x.T.admin, query: { q: '.*' } })).body.rows.length, 0, 'the search is a literal, not a pattern');
}));

test('user detail: admins see status, enrollments and learning; payments, history and phone are Super Admin only', route(async () => {
  const x = world();
  const a = await call(x.r['users/[id]'], { token: x.T.admin, query: { id: x.w.s1 } });
  assert.equal(a.statusCode, 200);
  assert.deepEqual([a.body.payments, a.body.history, a.body.user.phone], [null, null, undefined]);
  assert.equal(a.body.enrollments[0].access.reference, undefined, 'no payment reference for an admin');
  assert.equal(a.body.learning.totalMinutes, 30);
  assert.equal(a.body.permissions.canChangeStatus, false);
  const s = await call(x.r['users/[id]'], { token: x.T.sa, query: { id: x.w.s2 } });
  assert.equal(s.body.user.phone, '+2348011112222');
  assert.equal(s.body.user.statusReason, 'Chargeback investigation');
  assert.equal(s.body.history[0].action, 'account_suspended');
  const s1 = await call(x.r['users/[id]'], { token: x.T.sa, query: { id: x.w.s1 } });
  assert.ok(s1.body.payments.some((p) => p.reference === 'ref_refund_open' && p.refund === 'refund_pending'));
  assert.equal(s1.body.enrollments[0].access.reference, 'ref_paid_1');
  assert.equal((await call(x.r['users/[id]'], { token: x.T.sa, query: { id: newId() } })).statusCode, 404);
}));

test('courses: status filter, instructor attention, counts', route(async () => {
  const x = world();
  const all = await call(x.r.courses, { token: x.T.admin });
  const c1 = all.body.rows.find((c) => c.courseId === x.w.C1);
  assert.deepEqual([c1.enrollments, c1.completionRate, c1.lessons, c1.instructor.name, c1.instructorNeedsAttention], [2, 50, 1, 'Ivy Instructor', false]);
  assert.deepEqual((await call(x.r.courses, { token: x.T.admin, query: { status: 'in_review' } })).body.rows.map((c) => c.title), ['Risk Basics']);
  const attention = await call(x.r.courses, { token: x.T.admin, query: { attention: 'instructor' } });
  assert.deepEqual(attention.body.rows.map((c) => c.title).sort(), ['Orphan Draft', 'Risk Basics']);
}));

test('enrollments: entitlement filters; payment references for the Super Admin only; read-only', route(async () => {
  const x = world();
  const before = JSON.stringify([x.db.rows('progress'), x.db.rows(C.courseAccess)]);
  const a = await call(x.r.enrollments, { token: x.T.admin });
  assert.equal(a.body.rows.length, 3);
  assert.ok(a.body.rows.every((e) => !('email' in e) && (!e.access || !('reference' in e.access))));
  assert.deepEqual((await call(x.r.enrollments, { token: x.T.admin, query: { access: 'paid' } })).body.rows.map((e) => e.studentId), [x.w.s1]);
  assert.deepEqual((await call(x.r.enrollments, { token: x.T.admin, query: { access: 'granted' } })).body.rows.map((e) => e.studentId), [x.w.s3]);
  assert.deepEqual((await call(x.r.enrollments, { token: x.T.admin, query: { status: 'withdrawn' } })).body.rows.map((e) => e.studentId), [x.w.s2]);
  const s = await call(x.r.enrollments, { token: x.T.sa, query: { access: 'paid' } });
  assert.equal(s.body.rows[0].access.reference, 'ref_paid_1');
  assert.equal(JSON.stringify([x.db.rows('progress'), x.db.rows(C.courseAccess)]), before, 'nothing is changed');
}));

// ---------------------------------------------------------------------------
// Payments, refunds, reports
// ---------------------------------------------------------------------------

test('payments: every checkout state classified honestly; filters', route(async () => {
  const x = world();
  const res = await call(x.r.payments, { token: x.T.sa, query: { limit: '50' } });
  const by = Object.fromEntries(res.body.rows.map((p) => [p.reference, p]));
  assert.deepEqual(
    ['ref_paid_1', 'ref_pending', 'ref_old_pending', 'ref_stalled', 'ref_confirming', 'ref_held', 'ref_closed'].map((r) => by[r].state),
    ['paid', 'pending', 'abandoned', 'stalled', 'confirming', 'held', 'closed']
  );
  assert.deepEqual([by.ref_refunded.refund, by.ref_refunded.refunded, by.ref_refund_open.refund], ['refunded', '25000.00', 'refund_pending']);
  assert.equal(by.ref_paid_1.amount, '25000.00');
  assert.deepEqual((await call(x.r.payments, { token: x.T.sa, query: { state: 'abandoned' } })).body.rows.map((p) => p.reference), ['ref_old_pending']);
  assert.deepEqual((await call(x.r.payments, { token: x.T.sa, query: { state: 'stalled' } })).body.rows.map((p) => p.reference), ['ref_stalled']);
  assert.deepEqual((await call(x.r.payments, { token: x.T.sa, query: { state: 'refunded' } })).body.rows.map((p) => p.reference), ['ref_refunded']);
  assert.deepEqual((await call(x.r.payments, { token: x.T.sa, query: { q: 'ref_hel' } })).body.rows.map((p) => p.reference), ['ref_held']);
  assert.equal((await call(x.r.payments, { token: x.T.sa, query: { q: '.*' } })).body.rows.length, 0, 'literal prefix search');
  const today = new Date(NOW).toISOString().slice(0, 10);
  assert.ok((await call(x.r.payments, { token: x.T.sa, query: { from: today, to: today } })).body.rows.every((p) => p.createdAt.slice(0, 10) === today));
}));

test('refunds: monitoring with status groups', route(async () => {
  const x = world();
  const res = await call(x.r.refunds, { token: x.T.sa });
  assert.deepEqual(res.body.counts, { open: 1, processed: 1, failed: 0 });
  assert.deepEqual((await call(x.r.refunds, { token: x.T.sa, query: { status: 'open' } })).body.rows.map((r) => [r.reference, r.status, r.amount]), [['ref_refund_open', 'uncertain', '10000.00']]);
}));

test('reports: daily figures; gross, refunds and net exact for the Super Admin; none for an admin', route(async () => {
  const x = world();
  const today = new Date(NOW).toISOString().slice(0, 10);
  const from = new Date(NOW - 10 * 86400000).toISOString().slice(0, 10);
  const s = await call(x.r.reports, { token: x.T.sa, query: { from, to: today } });
  assert.equal(s.statusCode, 200);
  assert.deepEqual([s.body.finance.gross, s.body.finance.refunds, s.body.finance.net], ['75000.00', '25000.00', '50000.00']);
  assert.equal(s.body.daily.length, s.body.range.days);
  assert.ok(s.body.totals.completions >= 1);
  const a = await call(x.r.reports, { token: x.T.admin, query: { from, to: today } });
  assert.deepEqual([a.body.finance, a.body.grading], [null, null]);
  assert.equal((await call(x.r.reports, { token: x.T.admin, query: { from: today, to: from } })).statusCode, 400);
  const long = await call(x.r.reports, { token: x.T.admin, query: { from: '2020-01-01', to: today } });
  assert.ok(long.body.range.days <= 367, 'ranges are capped at a year');
}));

test('money: exact kobo arithmetic and naira formatting', () => {
  const many = Array.from({ length: 1000 }, () => A.kobo(1)).reduce((a, b) => a + b, 0n);
  assert.equal(A.naira(many), '10.00');
  assert.equal(A.naira(A.kobo(2500000) - A.kobo(2500001)), '-0.01');
  assert.equal(A.kobo('12.5'), 0n, 'never parses a float');
  assert.equal(A.checkoutState({ status: 'mystery' }), 'unknown', 'an unknown state is never shown as success or failure');
});

// ---------------------------------------------------------------------------
// Exports, audit, configuration
// ---------------------------------------------------------------------------

test('exports: role per type, formula-safe cells, an audit entry for every export', route(async () => {
  const x = world();
  assert.equal((await call(x.r.export, { token: x.T.admin, query: { type: 'users' } })).statusCode, 403);
  assert.equal((await call(x.r.export, { token: x.T.admin, query: { type: 'payments' } })).statusCode, 403);
  assert.equal((await call(x.r.export, { token: x.T.s1, query: { type: 'courses' } })).statusCode, 403);
  assert.equal((await call(x.r.export, { token: x.T.admin, query: { type: 'everything' } })).statusCode, 400);
  const courses = await call(x.r.export, { token: x.T.admin, query: { type: 'courses' } });
  assert.equal(courses.statusCode, 200);
  assert.match(String(courses.headers['content-type']), /text\/csv/);
  assert.match(String(courses.headers['content-disposition']), /attachment; filename="forexorbit-courses-\d{4}-\d{2}-\d{2}\.csv"/);
  assert.ok(!courses.body.includes('@example.test'), 'no emails in an admin export');
  const enroll = await call(x.r.export, { token: x.T.admin, query: { type: 'enrollments' } });
  assert.ok(enroll.body.includes("\"'=HYPERLINK(\"\"http://evil.example\"\",\"\"x\"\")\""), 'a formula is neutralised and quoted');
  assert.ok(!enroll.body.split('\r\n')[0].includes('payment_reference'));
  const pay = await call(x.r.export, { token: x.T.sa, query: { type: 'payments', state: 'paid' } });
  assert.equal(pay.body.split('\r\n')[0], 'reference,student,email,course,amount_ngn,state,refund,refunded_ngn,created_at,paid_at');
  assert.equal(pay.headers['x-export-rows'], '3');
  const audits = x.db.rows('adminAuditLog').filter((e) => e.entityType === 'export');
  assert.deepEqual(audits.map((e) => [e.after.type, e.actor.userId]), [['courses', x.w.admin], ['enrollments', x.w.admin], ['payments', x.w.sa]]);
  assert.deepEqual(audits[2].after.filters, { state: 'paid' });
}));

test('exports: refused when the audit entry cannot be written', route(async () => {
  const x = world();
  const col = x.db.collection('adminAuditLog');
  col.insertOne = async () => { throw new Error('write failed'); };
  const res = await call(x.r.export, { token: x.T.sa, query: { type: 'users' } });
  assert.equal(res.statusCode, 500);
  assert.ok(typeof res.body === 'object' && !String(res.body.error).includes('@'), 'no data handed out');
}));

test('csv cells: formulas neutralised; quotes, commas and line breaks quoted', () => {
  assert.equal(A.csvCell('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(A.csvCell('+1'), "'+1");
  assert.equal(A.csvCell('-1'), "'-1");
  assert.equal(A.csvCell('@cmd'), "'@cmd");
  assert.equal(A.csvCell('\tx'), "'\tx");
  assert.equal(A.csvCell('a,b'), '"a,b"');
  assert.equal(A.csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(A.csvCell('two\nlines'), '"two\nlines"');
  assert.equal(A.csvCell(null), '');
});

test('audit viewer: Super Admin only, with filters; the log is append-only for the app', route(async () => {
  const x = world();
  const res = await call(x.r.audit, { token: x.T.sa, query: { entityType: 'account', actor: 'superadmin@' } });
  assert.deepEqual(res.body.rows.map((r) => r.action), ['account_suspended']);
  assert.equal((await call(x.r.audit, { token: x.T.sa, query: { entityType: 'export' } })).body.rows.length, 0);
  assert.equal((await call(x.r.audit, { token: x.T.admin })).statusCode, 403);
  const role = require('../lib/app-database-role');
  assert.ok(role.APPEND_ONLY_COLLECTIONS.includes('adminAuditLog'));
  assert.ok(!role.READ_WRITE_COLLECTIONS.includes('adminAuditLog'), 'the app cannot update or delete audit entries');
}));

test('platform configuration: what is configured, never a secret value; not editable', route(async () => {
  const x = world();
  const res = await call(x.r.config, { token: x.T.admin });
  assert.equal(res.body.editable, false);
  const text = JSON.stringify(res.body);
  assert.ok(!text.includes('sk_test_phase13_unit_only') && !text.includes('mongodb://'), 'no secret values');
  assert.ok(res.body.integrations.some((i) => i.id === 'payments' && i.state === 'enabled (test)'));
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.equal((await call(x.r.config, { method, token: x.T.sa })).statusCode, 405);
}));

test('reconciliation runs are audited; the panel is shared, not duplicated', () => {
  const route = read('pages/api/admin/payments/reconcile.ts');
  assert.match(route, /action: 'reconciliation_run'/);
  assert.match(route, /withAuth\(handler, \['superadmin'\]\)/);
  assert.match(read('pages/admin/purchases.tsx'), /import ReconcilePanel from '@\/components\/admin\/ReconcilePanel';/);
  assert.ok(!read('pages/admin/purchases.tsx').includes('function ReconcilePanel('));
});

test('no new financial write path: the portal never posts to payment, refund or grant routes itself', () => {
  for (const file of ['lib/admin-portal.js', ...fs.readdirSync(path.join(__dirname, '../pages/api/admin/portal')).filter((f) => f.endsWith('.ts')).map((f) => `pages/api/admin/portal/${f}`)]) {
    const src = read(file);
    assert.ok(!/confirmCoursePayment|requestRefund|refreshRefund|grantCourseAccess|updateOne|deleteOne|deleteMany|updateMany/.test(src), `${file} writes no financial or academic record`);
  }
});
