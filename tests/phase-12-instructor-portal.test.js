/**
 * Phase 12: instructor portal and academic operations (backend and routes).
 *
 * Routes run through the real withAuth (session cookie, live role and status) over the in-memory
 * stand-in with unique indexes and duplicate-key errors (tests/helpers/payment-memory-db.js); the
 * database connection, socket server and notification delivery are replaced. Not real-MongoDB
 * coverage: index use and true concurrency are not shown here.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ObjectId } = require('mongodb');

const { paymentMemoryDb } = require('./helpers/payment-memory-db');
const { loadModule, mockResponse } = require('./helpers/ts-loader');
const { requestHeaders, seedSession } = require('./helpers/session-cookie');
const { ASSESSMENT_INDEXES } = require('../lib/assessment-indexes');
const payment = require('../lib/course-payment');
const P = require('../lib/instructor-portal');
const O = require('../lib/academic-operations');
const SA = require('../lib/student-analytics');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const ROUTE_ENV = { NODE_ENV: 'test', PAYSTACK_SECRET_KEY: 'sk_test_phase12_unit_only', MONGODB_DB_NAME: 'forexorbit_p12_test', MONGO_URI: 'mongodb://127.0.0.1:27017', APP_ORIGIN: undefined, PORT: undefined, SHARED_RATE_LIMIT: undefined };
const newId = () => new ObjectId().toHexString();
const NOW = Date.now();
const ago = (days) => new Date(NOW - days * 86400000);

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
  const db = paymentMemoryDb({ uniqueIndexes: ASSESSMENT_INDEXES });
  const w = {
    insA: newId(), insB: newId(), insX: newId(), admin: newId(), s1: newId(), s2: newId(), s3: newId(), sW: newId(),
    CA: newId(), CA2: newId(), CB: newId(), a1: newId(), a2: newId(), b1: newId(), asgA: newId(), asgB: newId(), subS1: newId(), subS2: newId(), subS3: newId(),
  };
  const user = (id, role, extra = {}) => db.rows('users').push({ _id: new ObjectId(id), email: `${role}-${id.slice(-6)}@example.test`, phone: '+2348000000000', name: `${role} ${id.slice(-4)}`, role, status: 'approved', sessionGeneration: 0, points: 0, createdAt: ago(90), ...extra });
  user(w.insA, 'instructor', { name: 'Ada Instructor' });
  user(w.insB, 'instructor', { name: 'Ben Instructor' });
  user(w.insX, 'instructor', { name: 'Sus Pended', status: 'suspended' });
  user(w.admin, 'admin');
  user(w.s1, 'student', { name: 'Sam Student', learningLevel: 'beginner' });
  user(w.s2, 'student', { name: 'Tia Student' });
  user(w.s3, 'student', { name: 'Uma Student' });
  user(w.sW, 'student', { name: 'Wes Withdrawn' });
  const course = (id, instructorId, title, status) => db.rows('courses').push({ _id: new ObjectId(id), title, status, instructorId, difficulty: 'beginner', freePreviewExplicit: true, updatedAt: ago(1) });
  course(w.CA, w.insA, 'Price Action', 'published');
  course(w.CA2, w.insA, 'Draft Course', 'draft');
  course(w.CB, w.insB, 'Risk', 'published');
  const lesson = (id, courseId, order) => db.rows('lessons').push({ _id: new ObjectId(id), courseId, order, title: `Lesson ${order}`, isFreePreview: order === 1 });
  lesson(w.a1, w.CA, 1);
  lesson(w.a2, w.CA, 2);
  lesson(w.b1, w.CB, 1);
  const enroll = (userId, courseId, extra) => db.rows('progress').push({ _id: new ObjectId(), userId, courseId, active: true, createdAt: ago(30), enrolledAt: ago(30), ...extra });
  enroll(w.s1, w.CA, { progress: 50, completedLessons: [w.a1], lessonCompletedAt: { [w.a1]: ago(3) }, lastActivityAt: ago(2) });
  enroll(w.s2, w.CA, { progress: 100, completedLessons: [w.a1, w.a2], completedAt: ago(5), lastActivityAt: ago(10) });
  enroll(w.sW, w.CA, { progress: 0, completedLessons: [], withdrawnAt: ago(4) });
  enroll(w.s3, w.CB, { progress: 100, completedLessons: [w.b1], completedAt: ago(1), lastActivityAt: ago(1) });
  for (const [u, c] of [[w.s1, w.CA], [w.s2, w.CA], [w.s3, w.CB]]) db.rows(payment.COLLECTIONS.courseAccess).push({ _id: new ObjectId(), userId: u, courseId: c, paid: true, entitlementType: 'paid_course' });
  db.rows('assignments').push(
    { _id: new ObjectId(w.asgA), courseId: w.CA, lessonId: w.a1, title: 'Mark the trend', instructions: 'Draw it', points: 50, dueDate: ago(7) },
    { _id: new ObjectId(w.asgB), courseId: w.CB, lessonId: w.b1, title: 'Size a trade', instructions: 'Compute', points: 10 },
  );
  db.rows('assignmentSubmissions').push(
    { _id: new ObjectId(w.subS1), assignmentId: w.asgA, userId: w.s1, status: 'submitted', submissionText: 'My trend lines', late: true, submittedAt: ago(2) },
    { _id: new ObjectId(w.subS2), assignmentId: w.asgA, userId: w.s2, status: 'graded', grade: 80, feedback: 'Good', gradedBy: w.insA, submissionText: 'Mine', submittedAt: ago(6), gradedAt: ago(5), pointsAwarded: 40 },
    { _id: new ObjectId(w.subS3), assignmentId: w.asgB, userId: w.s3, status: 'submitted', submissionText: 'Sizing', submittedAt: ago(1) },
  );
  db.rows('quizAttempts').push(
    { _id: new ObjectId(), userId: w.s1, lessonId: w.a1, number: 1, status: 'submitted', submittedAt: ago(3), result: { percent: 90, passed: true }, questions: [{ correctAnswer: 1 }] },
    { _id: new ObjectId(), userId: w.s2, lessonId: w.a2, number: 1, status: 'expired', submittedAt: ago(6), result: { percent: 40, passed: false } },
    { _id: new ObjectId(), userId: w.s3, lessonId: w.b1, number: 1, status: 'submitted', submittedAt: ago(1), result: { percent: 100, passed: true } },
  );
  db.rows('quizScores').push({ _id: new ObjectId(), userId: w.s1, lessonId: w.a1, courseId: w.CA, percentage: 90, passed: true, createdAt: ago(3) });

  const notifications = [];
  const stubs = {
    'lib/mongodb': { getDb: async () => db },
    'lib/socket-server': { getSocketServer: () => null },
    'lib/notifications': { createNotification: async (n) => { notifications.push(n); return 'n1'; } },
  };
  const r = {
    overview: loadModule('pages/api/instructor/overview.ts', stubs).default,
    students: loadModule('pages/api/instructor/students/index.ts', stubs).default,
    student: loadModule('pages/api/instructor/students/[studentId].ts', stubs).default,
    queue: loadModule('pages/api/instructor/submissions/index.ts', stubs).default,
    submission: loadModule('pages/api/instructor/submissions/[submissionId].ts', stubs).default,
    activity: loadModule('pages/api/instructor/activity.ts', stubs).default,
    profile: loadModule('pages/api/instructor/profile.ts', stubs).default,
    grade: loadModule('pages/api/assignments/[id]/grade.ts', stubs).default,
    reassign: loadModule('pages/api/admin/courses/[id]/reassign.ts', stubs).default,
    assignment: loadModule('pages/api/assignments/[id].ts', stubs).default,
    assignments: loadModule('pages/api/assignments/index.ts', stubs).default,
    submit: loadModule('pages/api/assignments/[id]/submit.ts', stubs).default,
  };
  const T = {};
  for (const key of ['insA', 'insB', 'insX', 'admin', 's1', 's3']) T[key] = seedSession(db.rows('sessions'), { userId: w[key], generation: 0, now: new Date() });
  return { db, w, r, T, notifications };
}

async function call(handler, { method = 'GET', token, body, query = {} } = {}) {
  const res = mockResponse();
  await handler({ method, url: '/api/test', headers: requestHeaders(token), body, query, socket: { remoteAddress: '10.0.0.12' } }, res);
  return res;
}
const snapshot = (x, names) => JSON.stringify(names.map((n) => x.db.rows(n)));

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

test('portal routes: students and suspended instructors are refused; GET only; private', route(async () => {
  const x = world();
  for (const name of ['overview', 'students', 'queue', 'activity', 'profile']) {
    assert.equal((await call(x.r[name], { token: x.T.s1 })).statusCode, 403, `${name}: student`);
    // A suspended account's session no longer authenticates (401), before any role check (403).
    assert.ok([401, 403].includes((await call(x.r[name], { token: x.T.insX })).statusCode), `${name}: suspended instructor`);
    assert.equal((await call(x.r[name], {})).statusCode, 401, `${name}: signed out`);
    const ok = await call(x.r[name], { token: x.T.insA });
    assert.equal(ok.statusCode, 200, name);
    assert.match(String(ok.headers['cache-control']), /no-store/);
  }
  assert.equal((await call(x.r.overview, { method: 'POST', token: x.T.insA })).statusCode, 405);
}));

test('scope: an instructor sees only assigned courses; a foreign course id is not found; admins see all', route(async () => {
  const x = world();
  const a = await call(x.r.overview, { token: x.T.insA });
  assert.deepEqual(a.body.courses.map((c) => c.title).sort(), ['Draft Course', 'Price Action']);
  assert.equal(a.body.scope, 'assigned');
  assert.equal((await call(x.r.students, { token: x.T.insA, query: { courseId: x.w.CB } })).statusCode, 404);
  assert.equal((await call(x.r.queue, { token: x.T.insA, query: { courseId: x.w.CB } })).statusCode, 404);
  assert.equal((await call(x.r.queue, { token: x.T.insA, query: { assignmentId: x.w.asgB } })).statusCode, 404);
  assert.equal((await call(x.r.students, { token: x.T.insA, query: { courseId: 'not-an-id' } })).statusCode, 404);
  const admin = await call(x.r.overview, { token: x.T.admin });
  assert.equal(admin.body.scope, 'all');
  assert.equal(admin.body.courses.length, 3);
}));

test('students: unrelated students are not found, whatever id is supplied', route(async () => {
  const x = world();
  assert.equal((await call(x.r.student, { token: x.T.insA, query: { studentId: x.w.s3 } })).statusCode, 404, "B's student");
  assert.equal((await call(x.r.student, { token: x.T.insA, query: { studentId: x.w.sW } })).statusCode, 404, 'withdrawn');
  assert.equal((await call(x.r.student, { token: x.T.insA, query: { studentId: x.w.insB } })).statusCode, 404, 'not a student');
  assert.equal((await call(x.r.student, { token: x.T.insA, query: { studentId: x.w.s1, courseId: x.w.CB } })).statusCode, 404);
  assert.equal((await call(x.r.submission, { token: x.T.insA, query: { submissionId: x.w.subS3 } })).statusCode, 404, "B's submission");
  assert.equal((await call(x.r.submission, { token: x.T.insB, query: { submissionId: x.w.subS1 } })).statusCode, 404, "A's submission for B");
}));

// ---------------------------------------------------------------------------
// Read models
// ---------------------------------------------------------------------------

test('overview metrics: exact, from authorised records only', route(async () => {
  const x = world();
  const { metrics: m } = (await call(x.r.overview, { token: x.T.insA })).body;
  assert.deepEqual(m.coursesByStatus, { draft: 1, in_review: 0, published: 1, archived: 0 });
  assert.equal(m.courses, 2);
  assert.equal(m.students, 2, 'withdrawn and other-course students left out');
  assert.equal(m.enrollments, 2);
  assert.equal(m.completionRate, 50);
  assert.equal(m.averageProgress, 75);
  assert.equal(m.activeLearners7d, 1);
  assert.deepEqual([m.pendingSubmissions, m.latePending, m.gradedSubmissions], [1, 1, 1]);
  assert.equal(m.oldestPendingAt, ago(2).toISOString().slice(0, 19) + m.oldestPendingAt.slice(19));
  assert.deepEqual([m.quizAttempts, m.quizPassRate, m.quizAveragePercent], [2, 50, 65]);
}));

test('students list: names and records, no contact details, filters and pagination', route(async () => {
  const x = world();
  const res = await call(x.r.students, { token: x.T.insA });
  assert.deepEqual(res.body.rows.map((r) => r.name), ['Sam Student', 'Tia Student'], 'most recently active first');
  const sam = res.body.rows[0];
  assert.deepEqual([sam.status, sam.progress, sam.completedLessons, sam.totalLessons, sam.quiz.attempts, sam.quiz.averagePercent, sam.submissions.pending], ['in_progress', 50, 1, 2, 1, 90, 1]);
  const text = JSON.stringify(res.body);
  assert.ok(!text.includes('@example.test') && !text.includes('+234'), 'no email or phone');
  assert.deepEqual((await call(x.r.students, { token: x.T.insA, query: { status: 'completed' } })).body.rows.map((r) => r.name), ['Tia Student']);
  assert.deepEqual((await call(x.r.students, { token: x.T.insA, query: { q: 'sam' } })).body.rows.map((r) => r.name), ['Sam Student']);
  const paged = await call(x.r.students, { token: x.T.insA, query: { limit: '1', page: '2' } });
  assert.deepEqual([paged.body.rows.length, paged.body.pagination.pages, paged.body.rows[0].name], [1, 2, 'Tia Student']);
}));

test('student detail: lessons with completion times, quiz summaries without answers, submissions', route(async () => {
  const x = world();
  const res = await call(x.r.student, { token: x.T.insA, query: { studentId: x.w.s1 } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.courses[0].lessons.map((l) => [l.completed, Boolean(l.completedAt)]), [[true, true], [false, false]]);
  assert.deepEqual(res.body.quizzes.map((q) => [q.percent, q.passed]), [[90, true]]);
  assert.deepEqual(res.body.submissions.map((s) => [s.status, s.late]), [['pending', true]]);
  assert.ok(!JSON.stringify(res.body).includes('correctAnswer'));
  assert.ok(!JSON.stringify(res.body).includes('@example.test'));
}));

test('grading queue: pending oldest first, late and graded filters, counts', route(async () => {
  const x = world();
  const pending = await call(x.r.queue, { token: x.T.insA });
  assert.deepEqual(pending.body.rows.map((r) => r.submissionId), [x.w.subS1]);
  assert.deepEqual(pending.body.counts, { pending: 1, graded: 1, late: 1 });
  assert.equal(pending.body.filter, 'pending');
  assert.equal(pending.body.rows[0].preview, 'My trend lines');
  assert.deepEqual((await call(x.r.queue, { token: x.T.insA, query: { status: 'graded' } })).body.rows.map((r) => r.grade), [80]);
  assert.equal((await call(x.r.queue, { token: x.T.insA, query: { status: 'late' } })).body.rows.length, 1);
  assert.equal((await call(x.r.queue, { token: x.T.insA, query: { status: 'all' } })).body.rows.length, 2);
  const detail = await call(x.r.submission, { token: x.T.insA, query: { submissionId: x.w.subS1 } });
  assert.deepEqual([detail.body.submission.submissionText, detail.body.assignment.points, detail.body.submission.late], ['My trend lines', 50, true]);
}));

// ---------------------------------------------------------------------------
// Grading, audit, notifications
// ---------------------------------------------------------------------------

test('grading: the course instructor grades; the grade is audited and notified once; quiz scores untouched', route(async () => {
  const x = world();
  const scoresBefore = snapshot(x, ['quizScores', 'quizAttempts']);
  const ok = await call(x.r.grade, { method: 'POST', token: x.T.insA, body: { submissionId: x.w.subS1, grade: 70, feedback: 'Solid' }, query: { id: x.w.asgA } });
  assert.equal(ok.statusCode, 200);
  const sub = x.db.rows('assignmentSubmissions').find((s) => String(s._id) === x.w.subS1);
  assert.deepEqual([sub.grade, sub.status, sub.gradeVersion, sub.gradeAuditPending], [70, 'graded', 1, undefined]);
  assert.deepEqual([sub.gradeHistory[0].version, sub.gradeHistory[0].reason], [1, null]);
  const audit = x.db.rows('adminAuditLog').find((a) => a._id === `grade:${x.w.subS1}:1`);
  assert.ok(audit, 'audit entry written');
  assert.deepEqual([audit.entityType, audit.action, audit.before.grade, audit.after.grade, audit.outcome], ['grade', 'assignment_graded', null, 70, 'saved']);
  assert.deepEqual([audit.actor.userId, audit.context.studentId, audit.context.courseId, audit.context.assignmentId], [x.w.insA, x.w.s1, x.w.CA, x.w.asgA]);
  assert.equal(x.notifications.length, 1);
  assert.equal(x.notifications[0].dedupeKey, `grade:${x.w.subS1}:1`);
  assert.equal(snapshot(x, ['quizScores', 'quizAttempts']), scoresBefore, 'automated quiz results are never changed by grading');
}));

test('regrading: a change needs a reason; history and audit keep previous and new grade', route(async () => {
  const x = world();
  const g = (body) => call(x.r.grade, { method: 'POST', token: x.T.insA, body: { submissionId: x.w.subS2, ...body }, query: { id: x.w.asgA } });
  const refused = await g({ grade: 90, feedback: 'Better' });
  assert.deepEqual([refused.statusCode, refused.body.code], [400, 'reason_required']);
  assert.equal((await g({ grade: 90, reason: 'no' })).statusCode, 400, 'too short');
  assert.equal(x.db.rows('assignmentSubmissions').find((s) => String(s._id) === x.w.subS2).grade, 80);
  const same = await g({ grade: 80, feedback: 'Same grade, new feedback' });
  assert.equal(same.statusCode, 200, 're-saving the same grade needs no reason');
  const changed = await g({ grade: 90, feedback: 'Better', reason: 'Re-marked against the rubric' });
  assert.equal(changed.statusCode, 200);
  const sub = x.db.rows('assignmentSubmissions').find((s) => String(s._id) === x.w.subS2);
  assert.deepEqual(sub.gradeHistory.map((h) => [h.previousGrade, h.grade, h.reason]), [[80, 80, null], [80, 90, 'Re-marked against the rubric']]);
  const audit = x.db.rows('adminAuditLog').find((a) => a._id === `grade:${x.w.subS2}:2`);
  assert.deepEqual([audit.action, audit.before.grade, audit.after.grade, audit.reason], ['assignment_regraded', 80, 90, 'Re-marked against the rubric']);
  assert.equal(x.notifications.at(-1).title, 'Grade updated');
}));

test('grading authority: another instructor, a suspended instructor and a student cannot grade', route(async () => {
  const x = world();
  const g = (token) => call(x.r.grade, { method: 'POST', token, body: { submissionId: x.w.subS1, grade: 100, feedback: 'x' }, query: { id: x.w.asgA } });
  assert.equal((await g(x.T.insB)).statusCode, 403);
  assert.equal((await g(x.T.insX)).statusCode, 403);
  assert.equal((await g(x.T.s1)).statusCode, 403);
  assert.equal(x.db.rows('assignmentSubmissions').find((s) => String(s._id) === x.w.subS1).grade, undefined);
  assert.equal(x.db.rows('adminAuditLog').length, 0);
}));

test('grade audit: idempotent under retries; an interrupted audit is repaired from the history', route(async () => {
  const x = world();
  const entry = O.gradeAuditEntry({ submissionId: x.w.subS1, version: 1, previousGrade: null, grade: 60, reason: '', regrade: false, actor: { userId: x.w.insA }, context: { studentId: x.w.s1 }, now: new Date() });
  x.db.rows('assignmentSubmissions').find((s) => String(s._id) === x.w.subS1).gradeAuditPending = 1;
  assert.equal(await O.writeGradeAudit(x.db, entry), true);
  assert.equal(await O.writeGradeAudit(x.db, entry), true, 'a duplicate is not an error');
  assert.equal(x.db.rows('adminAuditLog').length, 1);
  assert.equal(x.db.rows('assignmentSubmissions').find((s) => String(s._id) === x.w.subS1).gradeAuditPending, undefined);
  // Interrupted: the grade and history were saved, the audit entry was not.
  const sub2 = x.db.rows('assignmentSubmissions').find((s) => String(s._id) === x.w.subS2);
  Object.assign(sub2, { gradeVersion: 1, gradeAuditPending: 1, gradeHistory: [{ grade: 85, previousGrade: null, gradedBy: x.w.insA, gradedAt: new Date(), version: 1, reason: null }] });
  assert.deepEqual(await O.repairGradeAudits(x.db), { repaired: 1 });
  assert.ok(x.db.rows('adminAuditLog').some((a) => a._id === `grade:${x.w.subS2}:1` && a.after.grade === 85 && a.context.courseId === x.w.CA));
  assert.equal(sub2.gradeAuditPending, undefined);
}));

test('activity: an instructor sees only their own grade actions and their course moves', route(async () => {
  const x = world();
  await call(x.r.grade, { method: 'POST', token: x.T.insA, body: { submissionId: x.w.subS1, grade: 70, feedback: 'ok' }, query: { id: x.w.asgA } });
  await call(x.r.grade, { method: 'POST', token: x.T.insB, body: { submissionId: x.w.subS3, grade: 50, feedback: 'ok' }, query: { id: x.w.asgB } });
  const a = await call(x.r.activity, { token: x.T.insA });
  assert.deepEqual(a.body.rows.map((r) => [r.action, r.student, r.byYou]), [['assignment_graded', 'Sam Student', true]]);
  const b = await call(x.r.activity, { token: x.T.insB });
  assert.deepEqual(b.body.rows.map((r) => r.student), ['Uma Student']);
}));

// ---------------------------------------------------------------------------
// Reassignment and handover
// ---------------------------------------------------------------------------

test('reassignment: admins only; the course moves, every student record stays, access follows at once', route(async () => {
  const x = world();
  assert.equal((await call(x.r.reassign, { method: 'POST', token: x.T.insA, body: { instructorId: x.w.insB, reason: 'Taking over' }, query: { id: x.w.CA } })).statusCode, 403, 'instructors cannot');
  const records = ['progress', 'quizAttempts', 'quizScores', 'assignmentSubmissions', 'assignments', 'lessons', payment.COLLECTIONS.courseAccess];
  const before = snapshot(x, records);
  const res = await call(x.r.reassign, { method: 'POST', token: x.T.admin, body: { instructorId: x.w.insB, reason: 'Instructor on leave' }, query: { id: x.w.CA } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual([res.body.instructorId, res.body.previousInstructorId], [x.w.insB, x.w.insA]);
  assert.equal(snapshot(x, records), before, 'enrollments, progress, quiz history, submissions and grades are untouched');
  const course = x.db.rows('courses').find((c) => String(c._id) === x.w.CA);
  assert.deepEqual([course.instructorId, String(course._id), course.instructorHistory.length, course.instructorHistory[0].reason], [x.w.insB, x.w.CA, 1, 'Instructor on leave']);
  const audit = x.db.rows('adminAuditLog').find((a) => a.action === 'course_reassigned');
  assert.deepEqual([audit.before.instructorId, audit.after.instructorId, audit.actor.userId, audit.reason], [x.w.insA, x.w.insB, x.w.admin, 'Instructor on leave']);
  assert.deepEqual(x.notifications.map((n) => n.userId).sort(), [x.w.insA, x.w.insB].sort());
  assert.ok(x.notifications.every((n) => typeof n.dedupeKey === 'string' && n.dedupeKey.startsWith(`reassign:${x.w.CA}:`)));
  // Access follows the owner on the very next request.
  assert.deepEqual((await call(x.r.overview, { token: x.T.insA })).body.courses.map((c) => c.title), ['Draft Course']);
  assert.equal((await call(x.r.student, { token: x.T.insA, query: { studentId: x.w.s1 } })).statusCode, 404);
  assert.equal((await call(x.r.grade, { method: 'POST', token: x.T.insA, body: { submissionId: x.w.subS1, grade: 70, feedback: 'x' }, query: { id: x.w.asgA } })).statusCode, 403, 'the previous instructor can no longer grade');
  assert.equal((await call(x.r.student, { token: x.T.insB, query: { studentId: x.w.s1 } })).statusCode, 200, 'the new instructor sees the students');
  assert.equal((await call(x.r.grade, { method: 'POST', token: x.T.insB, body: { submissionId: x.w.subS1, grade: 70, feedback: 'x' }, query: { id: x.w.asgA } })).statusCode, 200);
  const history = await call(x.r.reassign, { token: x.T.admin, query: { id: x.w.CA } });
  assert.deepEqual([history.body.course.instructor, history.body.history[0].from, history.body.history[0].to], ['Ben Instructor', 'Ada Instructor', 'Ben Instructor']);
  const activity = await call(x.r.activity, { token: x.T.insA });
  assert.ok(activity.body.rows.some((r) => r.action === 'course_reassigned' && r.direction === 'moved_from_you'));
}));

test('reassignment refusals: reason, inactive or non-instructor target, same instructor, unknown course', route(async () => {
  const x = world();
  const go = (body, id = x.w.CA) => call(x.r.reassign, { method: 'POST', token: x.T.admin, body, query: { id } });
  assert.deepEqual([(await go({ instructorId: x.w.insB })).body.code], ['reason_required']);
  assert.equal((await go({ instructorId: x.w.insX, reason: 'Covering' })).statusCode, 400, 'suspended instructor');
  assert.equal((await go({ instructorId: x.w.s1, reason: 'Covering' })).statusCode, 400, 'a student');
  assert.equal((await go({ instructorId: x.w.admin, reason: 'Covering' })).statusCode, 400, 'an admin');
  assert.equal((await go({ instructorId: x.w.insA, reason: 'Covering' })).statusCode, 409, 'already assigned');
  assert.equal((await go({ instructorId: x.w.insB, reason: 'Covering' }, newId())).statusCode, 404);
  assert.equal(x.db.rows('courses').find((c) => String(c._id) === x.w.CA).instructorId, x.w.insA);
  assert.equal(x.db.rows('adminAuditLog').length, 0);
}));

test('reassignment: two conflicting handovers cannot both apply', route(async () => {
  const x = world();
  const stale = { ...x.db.rows('courses').find((c) => String(c._id) === x.w.CA) };
  const first = await O.applyReassignment(x.db, { course: stale, from: x.w.insA, to: x.w.insB, actor: { userId: x.w.admin, role: 'admin' }, reason: 'First', now: new Date() });
  assert.equal(first.ok, true);
  const second = await O.applyReassignment(x.db, { course: stale, from: x.w.insA, to: x.w.insX, actor: { userId: x.w.admin, role: 'admin' }, reason: 'Second, from a stale read', now: new Date() });
  assert.deepEqual([second.ok, second.status, second.code], [false, 409, 'course_changed']);
  const course = x.db.rows('courses').find((c) => String(c._id) === x.w.CA);
  assert.deepEqual([course.instructorId, course.instructorHistory.length], [x.w.insB, 1]);
}));

test('course editor: an admin changing the instructor there is audited the same way', () => {
  const source = read('pages/api/courses/[id].ts');
  assert.match(source, /await applyReassignment\(db, \{/);
  assert.match(source, /'Changed in the course editor'/);
  // The decision still ignores an instructor's attempt to reassign (lib/account-access.js decideCourseUpdate).
  assert.match(read('lib/account-access.js'), /An instructor's request to reassign is ignored/);
});

// ---------------------------------------------------------------------------
// Assignments: status, validation, submissions
// ---------------------------------------------------------------------------

test('assignment edits: validated; points locked after grading; submissions never changed', route(async () => {
  const x = world();
  const put = (body, token = x.T.insA) => call(x.r.assignment, { method: 'PUT', token, body, query: { id: x.w.asgA } });
  const subsBefore = snapshot(x, ['assignmentSubmissions']);
  assert.deepEqual([(await put({ points: 70 })).statusCode, (await put({ points: 70 })).body.code], [409, 'points_locked'], 'a graded submission exists');
  assert.equal((await put({ points: 50, title: 'Mark the trend (v2)' })).statusCode, 200, 'same points is fine');
  assert.equal((await put({ dueDate: 'not a date' })).statusCode, 400);
  assert.equal((await put({ title: 'x'.repeat(201) })).statusCode, 400);
  assert.equal((await put({ status: 'archived' })).statusCode, 400);
  assert.equal((await put({ status: 'closed' }, x.T.insB)).statusCode, 403, "another instructor's course");
  assert.equal(snapshot(x, ['assignmentSubmissions']), subsBefore);
  const row = x.db.rows('assignments').find((a) => String(a._id) === x.w.asgA);
  assert.deepEqual([row.title, row.points], ['Mark the trend (v2)', 50]);
}));

test('assignment status: drafts are hidden from students, closed ones take no new work, grading continues', route(async () => {
  const x = world();
  const asg = x.db.rows('assignments').find((a) => String(a._id) === x.w.asgA);
  asg.status = 'closed';
  const closed = await call(x.r.submit, { method: 'POST', token: x.T.s1, body: { submissionText: 'Again' }, query: { id: x.w.asgA } });
  assert.deepEqual([closed.statusCode, closed.body.code], [409, 'assignment_closed']);
  assert.equal((await call(x.r.grade, { method: 'POST', token: x.T.insA, body: { submissionId: x.w.subS1, grade: 60, feedback: 'ok' }, query: { id: x.w.asgA } })).statusCode, 200, 'closed work can still be graded');
  asg.status = 'draft';
  assert.equal((await call(x.r.submit, { method: 'POST', token: x.T.s1, body: { submissionText: 'Again' }, query: { id: x.w.asgA } })).statusCode, 404);
  assert.equal((await call(x.r.assignment, { token: x.T.s1, query: { id: x.w.asgA } })).statusCode, 404);
  const list = await call(x.r.assignments, { token: x.T.s1, query: { courseId: x.w.CA } });
  assert.equal(list.statusCode, 200);
  assert.ok(!list.body.some((a) => String(a._id) === x.w.asgA), 'drafts are not listed for students');
  const staff = await call(x.r.assignments, { token: x.T.insA, query: { courseId: x.w.CA } });
  assert.ok(staff.body.some((a) => String(a._id) === x.w.asgA && a.status === 'draft'), 'staff still see the draft');
}));

test('assignment create: status draft or published (default published); invalid status refused', route(async () => {
  const x = world();
  const post = (body) => call(x.r.assignments, { method: 'POST', token: x.T.insA, body: { courseId: x.w.CA, lessonId: x.w.a2, title: 'New', instructions: 'Do it', points: 10, ...body } });
  const def = await post({});
  assert.equal(def.statusCode, 201);
  assert.equal(x.db.rows('assignments').find((a) => String(a._id) === def.body.id).status, 'published');
  assert.equal((await post({ status: 'draft' })).statusCode, 201);
  assert.equal((await post({ status: 'live' })).statusCode, 400);
  assert.equal((await call(x.r.assignments, { method: 'POST', token: x.T.insA, body: { courseId: x.w.CB, title: 'Sneaky', instructions: 'x' } })).statusCode, 403, 'not in an unassigned course');
}));

test('rules: grade change, assignment patch and status helpers', () => {
  assert.deepEqual(O.decideGradeChange({ currentGrade: null, newGrade: 70, reason: undefined }), { ok: true, regrade: false, changing: false, reason: '' });
  assert.equal(O.decideGradeChange({ currentGrade: 70, newGrade: 70, reason: '' }).ok, true);
  assert.equal(O.decideGradeChange({ currentGrade: 70, newGrade: 75, reason: '' }).code, 'reason_required');
  assert.equal(O.decideGradeChange({ currentGrade: 70, newGrade: 75, reason: 'x'.repeat(501) }).code, 'invalid_reason');
  assert.equal(O.readAssignmentPatch({ points: 2.5 }).ok, false);
  assert.equal(O.readAssignmentPatch({ points: 1001 }).ok, false);
  assert.deepEqual(O.readAssignmentPatch({ dueDate: '2026-12-01' }).set, { dueDate: '2026-12-01' });
  assert.deepEqual(O.readAssignmentPatch({ dueDate: null }).set, { dueDate: null });
  assert.deepEqual([O.assignmentStatus({}), O.visibleToStudents({ status: 'draft' }), O.acceptsSubmissions({ status: 'closed' }), O.acceptsSubmissions({})], ['published', false, false, true]);
});

test('student dashboard (Phase 11): draft and closed assignments are not listed as open work', async () => {
  const x = world();
  x.db.rows('assignments').find((a) => String(a._id) === x.w.asgA).status = 'closed';
  const d = await SA.studentDashboard(x.db, { userId: x.w.s1, now: new Date(), env: ROUTE_ENV });
  assert.ok(!d.upcoming.items.some((i) => i.id === `assignment:${x.w.asgA}`));
});

// ---------------------------------------------------------------------------
// Profile, approval boundary, indexes, role
// ---------------------------------------------------------------------------

test('profile: own account and assigned courses only', route(async () => {
  const x = world();
  const res = await call(x.r.profile, { token: x.T.insA });
  assert.deepEqual([res.body.profile.name, res.body.profile.status, res.body.courses.length], ['Ada Instructor', 'approved', 2]);
}));

test('boundaries: account approval and suspension stay Super Admin only; no role was widened', () => {
  const approval = read('lib/account-approval.js');
  assert.match(approval, /Only the Super Admin can approve or reject accounts\./);
  assert.match(approval, /Only the Super Admin can suspend or reactivate accounts\./);
  assert.match(read('pages/api/admin/courses/[id]/reassign.ts'), /withAuth\(handler, \['admin', 'superadmin'\]\)/);
  assert.match(read('lib/instructor-route.ts'), /\['instructor', 'admin', 'superadmin'\]\);/);
  assert.match(read('pages/api/admin/audit-log.ts'), /withAuth\(handler, \['superadmin'\]\)/, 'the audit trail stays Super Admin only');
});

test('indexes and role: A7 serves the grading queue; every collection is already covered by the app role', () => {
  const a7 = ASSESSMENT_INDEXES.find((i) => i.id === 'A7');
  assert.deepEqual([a7.collection, a7.key, Boolean(a7.options.unique)], ['assignmentSubmissions', { assignmentId: 1, status: 1, submittedAt: 1 }, false]);
  const role = require('../lib/app-database-role');
  for (const name of ['courses', 'progress', 'lessons', 'assignments', 'assignmentSubmissions', 'quizAttempts', 'users', 'notifications']) assert.ok(role.READ_WRITE_COLLECTIONS.includes(name), name);
  assert.ok(role.APPEND_ONLY_COLLECTIONS.includes('adminAuditLog'));
});
