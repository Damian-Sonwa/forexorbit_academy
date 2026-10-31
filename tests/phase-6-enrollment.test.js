/**
 * Phase 6: enrollment and course access. The real route handlers (Phase 4.5 cookie sessions, CSRF
 * and exact Origin through withAuth) and libraries run against an in-memory database that enforces
 * the real unique indexes, including the new enrollment index E1 (tests/helpers/payment-memory-db.js).
 * Paystack is a stub: nothing leaves the process.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ObjectId } = require('mongodb');

const payment = require('../lib/course-payment');
const refunds = require('../lib/payment-refunds');
const { runReconciliation } = require('../lib/payment-reconciliation');
const { courseContentAccess } = require('../lib/course-lesson-list');
const { ensureActiveEnrollment } = require('../lib/enrollment-store');
const { decideEnroll } = require('../lib/enrollment-state');
const { canSeeCourse } = require('../lib/course-lifecycle');
const { ENROLLMENT_INDEXES, compareEnrollmentIndex, ensureEnrollmentIndexes } = require('../lib/enrollment-indexes');
const { grantCourseAccess, revokeCourseGrant, studentAccessOverview } = require('../lib/course-access-admin');
const { REFUND_INDEXES } = require('../lib/refund-indexes');
const { COURSE_PAYMENT_INDEXES } = require('../lib/course-payment-indexes');
const { matches, paymentMemoryDb } = require('./helpers/payment-memory-db');
const { loadModule, mockResponse } = require('./helpers/ts-loader');
const { requestHeaders, seedSession } = require('./helpers/session-cookie');

const { COLLECTIONS } = payment;
const ROOT = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const INDEXES = [...COURSE_PAYMENT_INDEXES, ...REFUND_INDEXES, ...ENROLLMENT_INDEXES];
const NOW = new Date('2026-11-06T10:00:00Z');
const later = (ms) => new Date(NOW.getTime() + ms);
const MIN = 60 * 1000;
const newId = () => new ObjectId().toHexString();
const ROUTE_ENV = { NODE_ENV: 'test', PAYSTACK_SECRET_KEY: 'sk_test_phase6_unit_only', MONGODB_DB_NAME: 'forexorbit_p6_test', MONGO_URI: 'mongodb://127.0.0.1:27017', APP_ORIGIN: undefined, PORT: undefined, SHARED_RATE_LIMIT: undefined };

/** paymentMemoryDb plus findOneAndUpdate with $addToSet (lib/course-progress.js). */
function newDb(extra = {}) {
  const db = paymentMemoryDb({ uniqueIndexes: INDEXES, ...extra });
  const base = db.collection.bind(db);
  db.collection = (name) => {
    const col = base(name);
    if (!col.findOneAndUpdate) {
      col.findOneAndUpdate = async (filter, update) => {
        const doc = col.docs.find((row) => matches(row, filter));
        if (!doc) return null;
        for (const [key, value] of Object.entries(update.$addToSet || {})) {
          const list = Array.isArray(doc[key]) ? doc[key] : [];
          if (!list.map(String).includes(String(value))) list.push(value);
          doc[key] = list;
        }
        Object.assign(doc, update.$set || {});
        return { ...doc };
      };
    }
    return col;
  };
  return db;
}

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

/**
 * Course P (published, explicit previews): preview, paid1, demo, paid2.
 * Course X (archived): preview, paid. Course D (draft). Course Q (published, another instructor).
 */
function seedWorld(db) {
  const w = {
    student: newId(), other: newId(), instructor: newId(), otherInstructor: newId(), admin: newId(), superadmin: newId(),
    P: newId(), X: newId(), D: newId(), Q: newId(), lesson: {},
  };
  const course = (id, status, instructorId, title) => db.rows('courses').push({ _id: new ObjectId(id), title, status, instructorId, difficulty: 'beginner', freePreviewExplicit: true, createdAt: NOW });
  course(w.P, 'published', w.instructor, 'Course P');
  course(w.X, 'archived', w.instructor, 'Course X');
  course(w.D, 'draft', w.instructor, 'Course D');
  course(w.Q, 'published', w.otherInstructor, 'Course Q');
  const lesson = (key, courseId, order, flags = {}) => {
    const id = newId();
    w.lesson[key] = id;
    db.rows('lessons').push({ _id: new ObjectId(id), courseId, order, title: key, type: 'text', content: `${key} content`, videoUrl: `https://video.example.test/${key}`, ...flags });
  };
  lesson('preview', w.P, 1, { isFreePreview: true });
  lesson('paid1', w.P, 2);
  lesson('demo', w.P, 3, { isDemo: true });
  lesson('paid2', w.P, 4);
  lesson('xPreview', w.X, 1, { isFreePreview: true });
  lesson('xPaid', w.X, 2);
  lesson('qPreview', w.Q, 1, { isFreePreview: true });
  lesson('qPaid', w.Q, 2);
  return w;
}

function enrollRow(db, userId, courseId, extra = {}) {
  db.rows('progress').push({ _id: new ObjectId(), userId, courseId, progress: 0, completedLessons: [], active: true, createdAt: NOW, ...extra });
}

function entitle(db, userId, courseId, extra = {}) {
  db.rows(COLLECTIONS.courseAccess).push({ _id: new ObjectId(), userId, courseId, paid: true, entitlementType: 'paid_course', unlockedAt: NOW, ...extra });
}

function signIn(db, userId, roleName, status = 'approved') {
  db.rows('users').push({ _id: new ObjectId(userId), email: `${roleName}-${userId.slice(-6)}@example.test`, name: `${roleName} ${userId.slice(-4)}`, role: roleName, status, sessionGeneration: 0 });
  return seedSession(db.rows('sessions'), { userId, generation: 0, now: new Date() });
}

async function call(handler, { method = 'GET', token, body, query = {}, headers } = {}) {
  const res = mockResponse();
  await handler({ method, url: '/api/test', headers: headers || requestHeaders(token), body, query, socket: { remoteAddress: '10.0.0.6' } }, res);
  return res;
}

function route(file, db) {
  return loadModule(file, { 'lib/mongodb': { getDb: async () => db }, 'lib/socket-server': { getSocketServer: () => null } }).default;
}

// Phase 5 helpers: a verified checkout through the real confirmation path.
let refSeq = 0;
const makeReference = () => `fo_c_p6_${++refSeq}_abcdef12`;
function provider(map = {}) {
  const calls = [];
  const fn = async (key) => { calls.push(key); const entry = map[key]; return typeof entry === 'function' ? entry() : entry || { outcome: 'not_found' }; };
  fn.calls = calls;
  return fn;
}
async function startCheckout(db, userId, courseId) {
  const result = await payment.createCourseIntent(db, { userId, courseId, fetchTransaction: provider(), makeReference, now: NOW });
  assert.equal(result.ok, true);
  return db.collection(COLLECTIONS.intents).findOne({ reference: result.reference });
}
const successData = (intent, overrides = {}) => ({ id: 880000 + refSeq, status: 'success', reference: intent.reference, amount: intent.amountKobo, currency: 'NGN', paid_at: NOW.toISOString(), metadata: { userId: intent.userId, courseId: intent.courseId }, ...overrides });
async function pay(db, userId, courseId, overrides = {}, now = NOW) {
  const intent = await startCheckout(db, userId, courseId);
  const data = successData(intent, overrides);
  const result = await payment.confirmCoursePayment(db, {
    reference: intent.reference, source: 'checkout', sessionUserId: userId, expectedCourseId: courseId,
    fetchTransaction: provider({ [intent.reference]: { outcome: 'found', data } }), now,
  });
  return { intent, data, result };
}
const SUPER = { userId: newId(), email: 'owner@example.test', role: 'superadmin' };
let reqSeq = 0;
const refundInput = (reference, extra = {}) => ({ reference, revokeAccess: false, reason: 'Customer asked for a refund', requestId: `req-p6-${++reqSeq}`, actor: SUPER, now: NOW, createRefund: async () => ({ outcome: 'created', data: { id: `rf_p6_${reqSeq}`, status: 'pending' } }), ...extra });
const isOpenFor = async (db, userId, courseId, lessonId) => (await courseContentAccess(db, { userId, role: 'student' }, courseId)).isOpen(lessonId);
const activeRows = (db, userId, courseId) => db.rows('progress').filter((r) => String(r.userId) === userId && String(r.courseId) === courseId);

// ---------------------------------------------------------------------------
// Enrollment lifecycle (POST/DELETE /api/courses/:id/enroll)
// ---------------------------------------------------------------------------

test('enroll: free enrollment in a published course, one row; repeat and invalid targets refused', async () => {
  await withEnv(ROUTE_ENV, async () => {
    const db = newDb();
    const w = seedWorld(db);
    const handler = route('pages/api/courses/[id]/enroll.ts', db);
    const token = signIn(db, w.student, 'student');
    const ok = await call(handler, { method: 'POST', token, query: { id: w.P } });
    assert.deepEqual([ok.statusCode, ok.body], [200, { success: true, enrolled: true }]);
    assert.equal(activeRows(db, w.student, w.P).length, 1);
    assert.equal(activeRows(db, w.student, w.P)[0].enrolledVia, 'student');
    const again = await call(handler, { method: 'POST', token, query: { id: w.P } });
    assert.deepEqual([again.statusCode, again.body.error], [400, 'Already enrolled']);
    assert.equal((await call(handler, { method: 'POST', token, query: { id: 'not-an-id' } })).statusCode, 400);
    assert.equal((await call(handler, { method: 'POST', token, query: { id: newId() } })).statusCode, 404);
    const draft = await call(handler, { method: 'POST', token, query: { id: w.D } });
    assert.ok(draft.statusCode >= 400 && draft.statusCode < 500, 'a draft course takes no enrollment');
    const archived = await call(handler, { method: 'POST', token, query: { id: w.X } });
    assert.ok(archived.statusCode >= 400 && archived.statusCode < 500, 'an archived course takes no new student');
    assert.equal(db.rows('progress').length, 1);
    // Not a student, and no session.
    const instructor = signIn(db, w.instructor, 'instructor');
    assert.equal((await call(handler, { method: 'POST', token: instructor, query: { id: w.P } })).statusCode, 403);
    assert.equal((await call(handler, { method: 'POST', query: { id: w.P } })).statusCode, 401);
    // Without the CSRF header (Phase 4.5).
    const noCsrf = requestHeaders(token);
    delete noCsrf['x-fo-csrf'];
    assert.equal((await call(handler, { method: 'POST', query: { id: w.P }, headers: noCsrf })).statusCode, 403);
  });
});

test('enroll: concurrent requests create one enrollment row (unique index E1); withdraw keeps the row', async () => {
  await withEnv(ROUTE_ENV, async () => {
    const db = newDb({ racy: true });
    const w = seedWorld(db);
    const handler = route('pages/api/courses/[id]/enroll.ts', db);
    const token = signIn(db, w.student, 'student');
    const results = await Promise.all([1, 2, 3].map(() => call(handler, { method: 'POST', token, query: { id: w.P } })));
    assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 400, 400]);
    assert.equal(activeRows(db, w.student, w.P).length, 1);
    const left = await call(handler, { method: 'DELETE', token, query: { id: w.P } });
    assert.equal(left.statusCode, 200);
    const [row] = activeRows(db, w.student, w.P);
    assert.deepEqual([row.active, row.withdrawnAt instanceof Date], [false, true], 'withdrawal keeps the history');
    const back = await call(handler, { method: 'POST', token, query: { id: w.P } });
    assert.equal(back.statusCode, 200);
    assert.deepEqual([activeRows(db, w.student, w.P).length, activeRows(db, w.student, w.P)[0].active], [1, true]);
  });
});

test('enroll: a student who bought an archived course can return to it; nobody else can join', async () => {
  await withEnv(ROUTE_ENV, async () => {
    const db = newDb();
    const w = seedWorld(db);
    entitle(db, w.student, w.X);
    enrollRow(db, w.student, w.X, { active: false, withdrawnAt: NOW });
    const handler = route('pages/api/courses/[id]/enroll.ts', db);
    const owner = signIn(db, w.student, 'student');
    const other = signIn(db, w.other, 'student');
    const detail = route('pages/api/courses/[id].ts', db);
    const seen = await call(detail, { token: owner, query: { id: w.X, lessons: 'none' } });
    assert.deepEqual([seen.statusCode, seen.body.owned, seen.body.enrolled], [200, true, false], 'the owner still sees the archived course');
    assert.equal((await call(detail, { token: other, query: { id: w.X, lessons: 'none' } })).statusCode, 404);
    assert.equal((await call(handler, { method: 'POST', token: owner, query: { id: w.X } })).statusCode, 200);
    assert.equal(activeRows(db, w.student, w.X)[0].active, true);
    assert.ok((await call(handler, { method: 'POST', token: other, query: { id: w.X } })).statusCode >= 400);
    // The decision itself.
    const course = { _id: w.X, status: 'archived' };
    assert.equal(decideEnroll({ role: 'student', userId: w.other, courseId: w.X, course, existing: null }).ok, false);
    assert.equal(decideEnroll({ role: 'student', userId: w.other, courseId: w.X, course, existing: null, entitled: true }).ok, true);
    assert.equal(decideEnroll({ role: 'student', userId: w.other, courseId: w.D, course: { _id: w.D, status: 'draft' }, existing: null, entitled: true }).ok, false, 'an entitlement never opens a draft');
    assert.equal(canSeeCourse({ userId: w.other, role: 'student' }, course, { owned: true }), true);
    assert.equal(canSeeCourse({ userId: w.other, role: 'student' }, course, {}), false);
  });
});

test('course list: owned and completed flags for students; archived courses listed for owners', async () => {
  await withEnv(ROUTE_ENV, async () => {
    const db = newDb();
    const w = seedWorld(db);
    entitle(db, w.student, w.P);
    enrollRow(db, w.student, w.P, { progress: 100, completedAt: NOW });
    entitle(db, w.student, w.X);
    const token = signIn(db, w.student, 'student');
    const res = await call(route('pages/api/courses/index.ts', db), { token });
    assert.equal(res.statusCode, 200);
    const byId = new Map(res.body.map((c) => [c.id, c]));
    assert.deepEqual([byId.get(w.P).owned, byId.get(w.P).completed, byId.get(w.P).enrolled], [true, true, true]);
    assert.deepEqual([byId.get(w.X).owned, byId.get(w.X).enrolled], [true, false], 'a bought archived course stays listed');
    assert.deepEqual([byId.get(w.Q).owned, byId.get(w.Q).completed], [false, false]);
    assert.equal(byId.has(w.D), false);
  });
});

// ---------------------------------------------------------------------------
// Payment integration (Phase 5 confirmation path)
// ---------------------------------------------------------------------------

test('payment: a verified payment unlocks only its course and enrolls the student', async () => {
  const db = newDb();
  const w = seedWorld(db);
  const { result } = await pay(db, w.student, w.P);
  assert.equal(result.ok, true);
  const [row] = activeRows(db, w.student, w.P);
  assert.deepEqual([row.active, row.enrolledVia], [true, 'payment-checkout']);
  assert.equal(await isOpenFor(db, w.student, w.P, w.lesson.paid1), true);
  assert.equal(await isOpenFor(db, w.student, w.Q, w.lesson.qPaid), false, 'a payment for one course never unlocks another');
  assert.equal(await isOpenFor(db, w.other, w.P, w.lesson.paid1), false, 'nor another student');
});

test('payment: failed, pending, unknown and mismatched payments grant neither access nor enrollment', async () => {
  const db = newDb();
  const w = seedWorld(db);
  for (const overrides of [{ status: 'failed' }, { status: 'pending' }, { status: 'abandoned' }, { amount: 500000 }]) {
    const { result } = await pay(db, w.student, w.P, overrides);
    assert.equal(result.ok, false, JSON.stringify(overrides));
  }
  const unknown = await payment.confirmCoursePayment(db, {
    reference: 'fo_c_unknown_1_abcdef12', source: 'checkout', sessionUserId: w.student, expectedCourseId: w.P,
    fetchTransaction: provider(), now: NOW,
  });
  assert.equal(unknown.ok, false);
  assert.equal(await payment.hasCourseEntitlement(db, w.student, w.P), false);
  assert.equal(activeRows(db, w.student, w.P).length, 0);
  assert.equal(await isOpenFor(db, w.student, w.P, w.lesson.paid1), false);
});

test('payment: a new payment reactivates a withdrawn enrollment; a replayed webhook does not', async () => {
  const db = newDb();
  const w = seedWorld(db);
  enrollRow(db, w.student, w.P, { active: false, withdrawnAt: NOW });
  const { intent, data } = await pay(db, w.student, w.P);
  assert.deepEqual([activeRows(db, w.student, w.P).length, activeRows(db, w.student, w.P)[0].active], [1, true]);
  // The student leaves again; Paystack redelivers the same charge.success.
  const [row] = activeRows(db, w.student, w.P);
  row.active = false;
  row.withdrawnAt = later(MIN);
  const replay = await payment.processWebhookEvent(db, { event: 'charge.success', data }, later(2 * MIN), {
    fetchTransaction: provider({ [intent.reference]: { outcome: 'found', data } }),
  });
  assert.equal(replay.ack, true);
  assert.equal(activeRows(db, w.student, w.P)[0].active, false, 'a replay never re-enrolls a student who left');
  assert.equal(db.rows(COLLECTIONS.payments).length, 1);
  assert.equal(db.rows(COLLECTIONS.courseAccess).length, 1, 'no duplicate entitlement');
  // The direct rule.
  assert.deepEqual(await ensureActiveEnrollment(db, { userId: w.student, courseId: w.P, now: NOW }), { action: 'withdrawn_kept' });
  assert.deepEqual(await ensureActiveEnrollment(db, { userId: w.student, courseId: w.P, reactivate: true, now: NOW }), { action: 'reactivated' });
});

test('payment: duplicate confirmations of one payment create one entitlement and one enrollment', async () => {
  const db = newDb({ racy: true });
  const w = seedWorld(db);
  const intent = await startCheckout(db, w.student, w.P);
  const data = successData(intent);
  const confirm = () => payment.confirmCoursePayment(db, {
    reference: intent.reference, source: 'checkout', sessionUserId: w.student, expectedCourseId: w.P,
    fetchTransaction: provider({ [intent.reference]: { outcome: 'found', data } }), now: NOW,
  });
  await Promise.all([confirm(), confirm(), confirm()]);
  assert.equal(db.rows(COLLECTIONS.payments).length, 1);
  assert.equal(db.rows(COLLECTIONS.courseAccess).length, 1);
  assert.equal(activeRows(db, w.student, w.P).length, 1);
});

test('reconciliation R4: an entitled student without any enrollment row is enrolled; a withdrawal is respected', async () => {
  const db = newDb();
  const w = seedWorld(db);
  entitle(db, w.student, w.P, { paystackReference: 'fo_c_legacy_1_abcdef12' });
  entitle(db, w.other, w.P);
  enrollRow(db, w.other, w.P, { active: false, withdrawnAt: NOW });
  const options = { fetchTransaction: provider(), fetchRefund: provider(), listRefunds: provider(), now: later(MIN) };
  const report = await runReconciliation(db, { ...options, apply: false });
  assert.deepEqual(report.items.filter((i) => i.type === 'entitlement_without_enrollment').map((i) => i.action), ['would_enroll']);
  assert.equal(activeRows(db, w.student, w.P).length, 0, 'report mode writes nothing');
  const applied = await runReconciliation(db, { ...options, apply: true });
  assert.deepEqual(applied.items.filter((i) => i.type === 'entitlement_without_enrollment').map((i) => i.action), ['enrolled']);
  assert.deepEqual([activeRows(db, w.student, w.P)[0].active, activeRows(db, w.student, w.P)[0].enrolledVia], [true, 'reconciliation']);
  assert.equal(activeRows(db, w.other, w.P)[0].active, false);
  const again = await runReconciliation(db, { ...options, apply: true });
  assert.equal(again.items.filter((i) => i.type === 'entitlement_without_enrollment').length, 0, 'idempotent');
});

// ---------------------------------------------------------------------------
// Access control: the shared rule and every route that serves learning material
// ---------------------------------------------------------------------------

test('courseContentAccess: previews and demos open; paid lessons need the course entitlement; grants, refunds and legacy rows', async () => {
  const db = newDb();
  const w = seedWorld(db);
  const access = await courseContentAccess(db, { userId: w.student, role: 'student' }, w.P);
  assert.deepEqual([access.isOpen(w.lesson.preview), access.isOpen(w.lesson.demo), access.isOpen(w.lesson.paid1), access.allOpen, access.isOpen(null)], [true, true, false, false, false]);
  db.rows('userLessonAccess').push({ userId: w.student, lessonId: w.lesson.paid1, courseId: w.P, paid: true });
  const legacy = await courseContentAccess(db, { userId: w.student, role: 'student' }, w.P);
  assert.deepEqual([legacy.isOpen(w.lesson.paid1), legacy.isOpen(w.lesson.paid2)], [true, false], 'a legacy lesson purchase opens only that lesson');
  entitle(db, w.other, w.P, { paid: false, entitlementType: 'complimentary' });
  assert.equal((await courseContentAccess(db, { userId: w.other, role: 'student' }, w.P)).allOpen, true);
  const refunded = newId();
  entitle(db, refunded, w.P, { paid: false, entitlementType: 'refunded' });
  assert.equal(await isOpenFor(db, refunded, w.P, w.lesson.paid1), false);
  assert.equal((await courseContentAccess(db, { userId: w.instructor, role: 'instructor' }, w.P)).allOpen, true, 'staff are decided by the read rules');
  assert.equal((await courseContentAccess(db, null, w.P)).isOpen(w.lesson.preview), false);
  assert.equal((await courseContentAccess(db, { userId: w.student, role: 'student' }, 'bad')).allOpen, false);
});

test('progress: only open lessons can be completed; the session decides whose progress; cross-course refused', async () => {
  await withEnv(ROUTE_ENV, async () => {
    const db = newDb();
    const w = seedWorld(db);
    enrollRow(db, w.student, w.P);
    enrollRow(db, w.other, w.P);
    const handler = route('pages/api/progress/index.ts', db);
    const token = signIn(db, w.student, 'student');
    const locked = await call(handler, { method: 'POST', token, body: { courseId: w.P, lessonId: w.lesson.paid1 } });
    assert.deepEqual([locked.statusCode, locked.body.code], [403, 'lesson_locked']);
    assert.deepEqual(activeRows(db, w.student, w.P)[0].completedLessons, [], 'nothing recorded for a locked lesson');
    const free = await call(handler, { method: 'POST', token, body: { courseId: w.P, lessonId: w.lesson.preview, userId: w.other } });
    assert.equal(free.statusCode, 200);
    assert.deepEqual(activeRows(db, w.student, w.P)[0].completedLessons, [w.lesson.preview]);
    assert.deepEqual(activeRows(db, w.other, w.P)[0].completedLessons, [], 'a userId in the body changes nothing');
    const crossCourse = await call(handler, { method: 'POST', token, body: { courseId: w.P, lessonId: w.lesson.qPreview } });
    assert.equal(crossCourse.statusCode, 403);
    const notEnrolled = await call(handler, { method: 'POST', token, body: { courseId: w.Q, lessonId: w.lesson.qPreview } });
    assert.equal(notEnrolled.statusCode, 403);
    // With the entitlement every lesson counts, and completion is recorded at 100%.
    entitle(db, w.student, w.P);
    for (const key of ['paid1', 'demo', 'paid2']) {
      assert.equal((await call(handler, { method: 'POST', token, body: { courseId: w.P, lessonId: w.lesson[key] } })).statusCode, 200, key);
    }
    const [row] = activeRows(db, w.student, w.P);
    assert.deepEqual([row.progress, row.completedAt instanceof Date], [100, true]);
  });
});

test('certificates: completion alone is not enough; the course must be open in full; refund removal closes it', async () => {
  await withEnv(ROUTE_ENV, async () => {
    const db = newDb();
    const w = seedWorld(db);
    const all = [w.lesson.preview, w.lesson.paid1, w.lesson.demo, w.lesson.paid2];
    enrollRow(db, w.student, w.P, { completedLessons: all, progress: 100, completedAt: NOW });
    const handler = route('pages/api/certificates/index.ts', db);
    const token = signIn(db, w.student, 'student');
    const unpaid = await call(handler, { method: 'POST', token, body: { courseId: w.P } });
    assert.deepEqual([unpaid.statusCode, unpaid.body.code], [403, 'course_access_required']);
    entitle(db, w.student, w.P, { paid: false, entitlementType: 'refunded' });
    assert.equal((await call(handler, { method: 'POST', token, body: { courseId: w.P } })).statusCode, 403, 'access removed by a refund');
    db.rows(COLLECTIONS.courseAccess)[0].entitlementType = 'complimentary';
    const issued = await call(handler, { method: 'POST', token, body: { courseId: w.P } });
    assert.equal(issued.statusCode, 201);
    assert.equal(db.rows('certificates').length, 1);
    assert.equal((await call(handler, { method: 'POST', token, body: { courseId: w.P } })).statusCode, 400, 'issued once');
  });
});

test('certificate detail: student own only; instructor only for own courses; invalid id 400', async () => {
  await withEnv(ROUTE_ENV, async () => {
    const db = newDb();
    const w = seedWorld(db);
    const certId = new ObjectId();
    db.rows('certificates').push({ _id: certId, userId: w.student, courseId: w.P, certificateId: 'CERT-1', issuedAt: NOW });
    const handler = route('pages/api/certificates/[id].ts', db);
    const get = (token, id = String(certId)) => call(handler, { token, query: { id } });
    assert.equal((await get(signIn(db, w.student, 'student'))).statusCode, 200);
    assert.equal((await get(signIn(db, w.other, 'student'))).statusCode, 403);
    assert.equal((await get(signIn(db, w.instructor, 'instructor'))).statusCode, 200);
    const stranger = await get(signIn(db, w.otherInstructor, 'instructor'));
    assert.equal(stranger.statusCode, 403, 'another course\'s instructor cannot read it (with the student\'s email)');
    assert.equal(stranger.body.user, undefined);
    assert.equal((await get(signIn(db, w.admin, 'admin'))).statusCode, 200);
    assert.equal((await get(signIn(db, newId(), 'student'), 'nope')).statusCode, 400);
  });
});

test('assignments: locked lessons\' and course-level assignments hidden, unreadable and unsubmittable until the course is open', async () => {
  await withEnv(ROUTE_ENV, async () => {
    const db = newDb();
    const w = seedWorld(db);
    enrollRow(db, w.student, w.P);
    const assignment = (lessonId, title) => {
      const id = new ObjectId();
      db.rows('assignments').push({ _id: id, courseId: w.P, lessonId, title, instructions: `${title} instructions`, points: 10 });
      return String(id);
    };
    const freeA = assignment(w.lesson.preview, 'Free');
    const paidA = assignment(w.lesson.paid1, 'Paid');
    const courseA = assignment(null, 'Course project');
    const token = signIn(db, w.student, 'student');
    const list = await call(route('pages/api/assignments/index.ts', db), { token, query: { courseId: w.P } });
    assert.equal(list.statusCode, 200);
    assert.deepEqual(list.body.map((a) => a.title), ['Free']);
    const detail = route('pages/api/assignments/[id].ts', db);
    assert.equal((await call(detail, { token, query: { id: freeA } })).statusCode, 200);
    for (const id of [paidA, courseA]) {
      const res = await call(detail, { token, query: { id } });
      assert.deepEqual([res.statusCode, res.body.code, res.body.instructions], [403, 'assignment_locked', undefined]);
    }
    const submit = route('pages/api/assignments/[id]/submit.ts', db);
    const refused = await call(submit, { method: 'POST', token, query: { id: paidA }, body: { submissionText: 'answer' } });
    assert.equal(refused.statusCode, 403);
    assert.equal(db.rows('assignmentSubmissions').length, 0);
    entitle(db, w.student, w.P);
    const listAfter = await call(route('pages/api/assignments/index.ts', db), { token, query: { courseId: w.P } });
    assert.deepEqual(listAfter.body.map((a) => a.title).sort(), ['Course project', 'Free', 'Paid']);
    assert.equal((await call(submit, { method: 'POST', token, query: { id: paidA }, body: { submissionText: 'answer' } })).statusCode, 200);
    // Staff (course instructor) still see everything.
    const staff = await call(route('pages/api/assignments/index.ts', db), { token: signIn(db, w.instructor, 'instructor'), query: { courseId: w.P } });
    assert.equal(staff.body.length, 3);
  });
});

test('lesson chat (HTTP): follows the lesson paywall', async () => {
  await withEnv(ROUTE_ENV, async () => {
    const db = newDb();
    const w = seedWorld(db);
    enrollRow(db, w.student, w.P);
    db.rows('messages').push({ _id: new ObjectId(), lessonId: w.lesson.paid1, userId: w.other, text: 'paid lesson discussion', createdAt: NOW });
    const handler = route('pages/api/messages/index.ts', db);
    const token = signIn(db, w.student, 'student');
    const locked = await call(handler, { token, query: { lessonId: w.lesson.paid1 } });
    assert.deepEqual([locked.statusCode, locked.body.code], [403, 'lesson_locked']);
    const send = await call(handler, { method: 'POST', token, body: { lessonId: w.lesson.paid1, text: 'hello' } });
    assert.equal(send.statusCode, 403);
    assert.equal(db.rows('messages').length, 1);
    assert.equal((await call(handler, { token, query: { lessonId: w.lesson.preview } })).statusCode, 200);
    entitle(db, w.student, w.P);
    const open = await call(handler, { token, query: { lessonId: w.lesson.paid1 } });
    assert.deepEqual([open.statusCode, open.body.length], [200, 1]);
  });
});

test('lesson detail and list: direct URLs return no paid content without the entitlement; suspended accounts are refused', async () => {
  await withEnv(ROUTE_ENV, async () => {
    const db = newDb();
    const w = seedWorld(db);
    enrollRow(db, w.student, w.P);
    const lesson = route('pages/api/lessons/[id].ts', db);
    const token = signIn(db, w.student, 'student');
    const paid = await call(lesson, { token, query: { id: w.lesson.paid1 } });
    assert.equal(paid.statusCode, 403);
    assert.equal(JSON.stringify(paid.body).includes('paid1 content'), false);
    assert.equal(JSON.stringify(paid.body).includes('video.example.test'), false);
    const preview = await call(lesson, { token, query: { id: w.lesson.preview } });
    assert.deepEqual([preview.statusCode, preview.body.content], [200, 'preview content']);
    const otherCourse = await call(lesson, { token, query: { id: w.lesson.qPreview } });
    assert.equal(otherCourse.statusCode, 403, 'not enrolled in that course');
    const list = await call(route('pages/api/courses/[id]/lessons.ts', db), { token, query: { id: w.P } });
    const paidView = list.body.lessons.find((l) => String(l._id) === w.lesson.paid1);
    assert.deepEqual([paidView.locked, paidView.content, paidView.videoUrl], [true, null, null]);
    // Suspended: every route refuses through withAuth.
    const suspended = newId();
    entitle(db, suspended, w.P);
    enrollRow(db, suspended, w.P);
    const suspendedToken = signIn(db, suspended, 'student', 'suspended');
    assert.ok([401, 403].includes((await call(lesson, { token: suspendedToken, query: { id: w.lesson.paid1 } })).statusCode));
    assert.ok([401, 403].includes((await call(route('pages/api/progress/index.ts', db), { method: 'POST', token: suspendedToken, body: { courseId: w.P, lessonId: w.lesson.paid1 } })).statusCode));
    assert.deepEqual(activeRows(db, suspended, w.P)[0].completedLessons, []);
  });
});

// ---------------------------------------------------------------------------
// Refund integration (Phase 5 rules, Phase 6 access result)
// ---------------------------------------------------------------------------

async function refundTo(db, w, status, { revokeAccess = false, amountKobo } = {}) {
  const { intent } = await pay(db, w.student, w.P);
  const out = await refunds.requestRefund(db, refundInput(intent.reference, { revokeAccess, ...(amountKobo ? { amountKobo } : {}) }));
  assert.equal(out.ok, true);
  const providerId = out.refund.providerRefundId;
  if (status === 'uncertain' || status === 'pending') return intent;
  const fetchRefund = provider({ [providerId]: { outcome: 'found', data: { id: providerId, status } } });
  const event = { event: `refund.${status}`, data: { id: providerId, transaction_reference: intent.reference, amount: out.refund.amountKobo, status } };
  for (let i = 0; i < 2; i += 1) {
    await payment.processWebhookEvent(db, event, later((i + 1) * MIN), { onRefundEvent: (e, d, at) => refunds.processRefundEvent(db, e, d, { fetchRefund, now: at }) });
  }
  return intent;
}

test('refunds: partial and full-without-removal keep access; pending, failed and uncertain keep access; processed full-with-removal removes it once', async () => {
  const cases = [
    ['partial processed', { status: 'processed', amountKobo: 300000 }, true],
    ['full processed, keep access', { status: 'processed' }, true],
    ['full with removal, still pending', { status: 'pending', revokeAccess: true }, true],
    ['full with removal, failed', { status: 'failed', revokeAccess: true }, true],
    ['full with removal, processed', { status: 'processed', revokeAccess: true }, false],
  ];
  for (const [label, options, kept] of cases) {
    const db = newDb();
    const w = seedWorld(db);
    await refundTo(db, w, options.status, options);
    assert.equal(await isOpenFor(db, w.student, w.P, w.lesson.paid1), kept, label);
    assert.equal(db.rows(COLLECTIONS.payments).length, 1, `${label}: payment history kept`);
    assert.equal(db.rows(COLLECTIONS.courseAccess).length, 1, `${label}: access row kept`);
    assert.equal(activeRows(db, w.student, w.P).length, 1, `${label}: enrollment history kept`);
    assert.equal(await isOpenFor(db, w.student, w.P, w.lesson.preview), true, `${label}: free previews stay open`);
  }
  // Uncertain creation outcome: nothing changes.
  const db = newDb();
  const w = seedWorld(db);
  const { intent } = await pay(db, w.student, w.P);
  const unsure = await refunds.requestRefund(db, refundInput(intent.reference, { revokeAccess: true, createRefund: async () => ({ outcome: 'uncertain', reason: 'timeout' }) }));
  assert.equal(unsure.code, 'refund_uncertain');
  assert.equal(await isOpenFor(db, w.student, w.P, w.lesson.paid1), true);
  // Repeated processed events revoke once and leave one audit entry per step.
  const db2 = newDb();
  const w2 = seedWorld(db2);
  await refundTo(db2, w2, 'processed', { revokeAccess: true });
  assert.deepEqual(db2.rows('adminAuditLog').map((a) => a.action).sort(), ['refund_processed', 'refund_requested']);
  assert.equal(db2.rows(COLLECTIONS.courseAccess)[0].entitlementType, 'refunded');
});

// ---------------------------------------------------------------------------
// Administrative enrollment management
// ---------------------------------------------------------------------------

test('admin course access: Super Admin only (route), reason required, audited grant with enrollment, revoke grants only', async () => {
  await withEnv(ROUTE_ENV, async () => {
    const db = newDb();
    const w = seedWorld(db);
    const handler = route('pages/api/admin/course-access.ts', db);
    const owner = signIn(db, w.superadmin, 'superadmin');
    const student = signIn(db, w.student, 'student');
    const admin = signIn(db, w.admin, 'admin');
    const body = { action: 'grant', userId: w.student, courseId: w.P, reason: 'Scholarship award' };
    assert.equal((await call(handler, { method: 'POST', token: student, body })).statusCode, 403);
    assert.equal((await call(handler, { method: 'POST', token: admin, body })).statusCode, 403);
    assert.equal((await call(handler, { method: 'POST', body })).statusCode, 401);
    assert.equal((await call(handler, { method: 'POST', token: owner, body: { ...body, reason: 'x' } })).statusCode, 400);
    assert.equal((await call(handler, { method: 'POST', token: owner, body: { ...body, action: 'delete' } })).statusCode, 400);
    signIn(db, w.instructor, 'instructor');
    assert.equal((await call(handler, { method: 'POST', token: owner, body: { ...body, userId: w.instructor } })).statusCode, 409, 'students only');
    assert.equal((await call(handler, { method: 'POST', token: owner, body: { ...body, courseId: w.D } })).statusCode, 409, 'no draft course');
    const granted = await call(handler, { method: 'POST', token: owner, body });
    assert.deepEqual([granted.statusCode, granted.body.code], [200, 'granted']);
    assert.equal(await isOpenFor(db, w.student, w.P, w.lesson.paid2), true);
    assert.deepEqual([activeRows(db, w.student, w.P)[0].active, activeRows(db, w.student, w.P)[0].enrolledVia], [true, 'admin-grant']);
    assert.equal((await call(handler, { method: 'POST', token: owner, body })).body.code, 'already_entitled');
    const overview = await call(handler, { token: owner, query: { email: db.rows('users').find((u) => String(u._id) === w.student).email } });
    assert.equal(overview.statusCode, 200);
    const entry = overview.body.courses.find((c) => c.courseId === w.P);
    assert.deepEqual([entry.access.entitlementType, entry.access.entitled, entry.enrollment.active, entry.title], ['complimentary', true, true, 'Course P']);
    assert.equal((await call(handler, { token: student, query: { userId: w.student } })).statusCode, 403);
    const revoked = await call(handler, { method: 'POST', token: owner, body: { ...body, action: 'revoke', reason: 'Scholarship ended' } });
    assert.deepEqual([revoked.statusCode, revoked.body.code], [200, 'revoked']);
    assert.equal(await isOpenFor(db, w.student, w.P, w.lesson.paid2), false);
    const [access] = db.rows(COLLECTIONS.courseAccess);
    assert.deepEqual([access.entitlementType, access.revokedReason, access.accessHistory.length], ['grant_revoked', 'Scholarship ended', 1]);
    assert.equal(activeRows(db, w.student, w.P)[0].active, true, 'the enrollment is kept; previews stay open');
    const audit = db.rows('adminAuditLog');
    assert.deepEqual(audit.map((a) => a.action), ['course_access_granted', 'course_access_grant_revoked']);
    assert.ok(audit.every((a) => a.actor.userId === w.superadmin && a.entityType === 'course_access' && a.reason));
    // Grant again after a revocation; then paid access cannot be revoked here.
    assert.equal((await call(handler, { method: 'POST', token: owner, body: { ...body, reason: 'Scholarship renewed' } })).statusCode, 200);
    assert.equal(db.rows(COLLECTIONS.courseAccess)[0].accessHistory.length, 2);
    signIn(db, w.other, 'student');
    entitle(db, w.other, w.Q);
    const paidRevoke = await call(handler, { method: 'POST', token: owner, body: { action: 'revoke', userId: w.other, courseId: w.Q, reason: 'Should not work' } });
    assert.deepEqual([paidRevoke.statusCode, paidRevoke.body.code], [409, 'paid_access']);
  });
});

test('admin course access: a concurrent change is refused instead of overwritten', async () => {
  const db = newDb();
  const w = seedWorld(db);
  db.rows('users').push({ _id: new ObjectId(w.student), role: 'student', status: 'approved', email: 's@example.test' });
  entitle(db, w.student, w.P, { paid: false, entitlementType: 'refunded' });
  const actor = { userId: w.superadmin, email: 'owner@example.test' };
  const [a, b] = await Promise.all([
    grantCourseAccess(db, { actor, userId: w.student, courseId: w.P, reason: 'First grant reason' }),
    grantCourseAccess(db, { actor, userId: w.student, courseId: w.P, reason: 'Second grant reason' }),
  ]);
  assert.deepEqual([a.ok, b.ok].sort(), [false, true]);
  assert.equal(db.rows(COLLECTIONS.courseAccess).length, 1);
  assert.equal((await revokeCourseGrant(db, { actor, userId: w.student, courseId: w.Q, reason: 'Nothing to revoke' })).code, 'no_access');
  assert.equal((await studentAccessOverview(db, {})).status, 400);
});

// ---------------------------------------------------------------------------
// Enrollment index E1
// ---------------------------------------------------------------------------

test('enrollment index E1: definition, comparison, read-only report; refuses to build over unknown state', async () => {
  assert.deepEqual(ENROLLMENT_INDEXES.map((i) => [i.id, i.collection, i.key, i.options]), [['E1', 'progress', { userId: 1, courseId: 1 }, { name: 'uniq_enrollment_user_course', unique: true }]]);
  const [e1] = ENROLLMENT_INDEXES;
  assert.equal(compareEnrollmentIndex(e1, []), 'missing');
  assert.equal(compareEnrollmentIndex(e1, [{ name: 'uniq_enrollment_user_course', key: { userId: 1, courseId: 1 }, unique: true }]), 'present');
  assert.equal(compareEnrollmentIndex(e1, [{ name: 'uniq_enrollment_user_course', key: { userId: 1, courseId: 1 } }]), 'conflicting');
  assert.equal(compareEnrollmentIndex(e1, [{ name: 'other', key: { userId: 1, courseId: 1 }, unique: true }]), 'conflicting');
  const denied = { collection: () => ({ indexes: async () => { throw Object.assign(new Error('not authorized'), { code: 13 }); } }) };
  const out = await ensureEnrollmentIndexes(denied, { apply: true });
  assert.deepEqual([out.ok, out.built, out.states[0].state], [false, [], 'unknown']);
});

// ---------------------------------------------------------------------------
// Source contracts: the socket lesson room and the student pages
// ---------------------------------------------------------------------------

test('source contract: socket lesson rooms and chat use the same paywall', () => {
  const server = read('server.js');
  assert.match(server, /lessonOpen = \(await courseContentAccess\(db, account\.user, courseId\)\)\.isOpen\(String\(lesson\._id\)\)/);
  assert.match(server, /if \(decision\.ok && !loaded\.lessonOpen\) return \{ ok: false/);
  assert.match(server, /if \(!decision\.ok \|\| !loaded\.lessonOpen\) return;/);
  assert.match(server, /decisions\.set\(String\(userId\), room\.ok && open \? room : \{ ok: false \}\)/);
});

test('source contract: student pages prevent duplicate enrollment actions and show the server\'s answer', () => {
  const card = read('components/CourseCard.tsx');
  assert.match(card, /disabled=\{busy\}/);
  assert.match(card, /setActionError\(messageFromUnknown\(error\)\)/);
  assert.match(card, /course\.owned \?/);
  const page = read('pages/courses/[id].tsx');
  assert.match(page, /setEnrollError\(messageFromUnknown\(error\)\)/);
  assert.match(page, /This course is archived and no longer takes new students\./);
  assert.match(page, /You have full access to this course\./);
  assert.match(read('pages/index.tsx'), /disabled=\{enrolling\}/);
  assert.doesNotMatch(read('hooks/useCourses.ts'), /throw new Error\(err\.message/);
});
