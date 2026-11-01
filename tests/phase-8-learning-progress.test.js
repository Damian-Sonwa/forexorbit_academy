/**
 * Phase 8: learning progress and student tracking. The real route handlers (Phase 4.5 cookie
 * sessions, CSRF and exact Origin through withAuth) and libraries run against an in-memory
 * database with the real unique indexes (tests/helpers/payment-memory-db.js). A fake Socket.IO
 * server records the cross-tab / cross-device broadcasts. Real-MongoDB concurrency is in
 * tests/integration/progress-phase8-mongo.test.js.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ObjectId } = require('mongodb');

const payment = require('../lib/course-payment');
const { grantCourseAccess, revokeCourseGrant } = require('../lib/course-access-admin');
const activity = require('../lib/learning-activity');
const { buildProgressSummary, SUMMARY_LESSON_PROJECTION } = require('../lib/progress-summary');
const { progressPercent, recomputeCourseProgress, recordLessonCompletion } = require('../lib/course-progress');
const { ENROLLMENT_INDEXES } = require('../lib/enrollment-indexes');
const { REFUND_INDEXES } = require('../lib/refund-indexes');
const { COURSE_PAYMENT_INDEXES } = require('../lib/course-payment-indexes');
const { matches, paymentMemoryDb, yieldTurn } = require('./helpers/payment-memory-db');
const { loadModule, mockResponse } = require('./helpers/ts-loader');
const { requestHeaders, seedSession } = require('./helpers/session-cookie');

const { COLLECTIONS } = payment;
const ROOT = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const INDEXES = [...COURSE_PAYMENT_INDEXES, ...REFUND_INDEXES, ...ENROLLMENT_INDEXES];
const NOW = new Date('2026-11-08T10:00:30Z');
const at = (iso) => new Date(iso);
const newId = () => new ObjectId().toHexString();
const ROUTE_ENV = { NODE_ENV: 'test', PAYSTACK_SECRET_KEY: 'sk_test_phase8_unit_only', MONGODB_DB_NAME: 'forexorbit_p8_test', MONGO_URI: 'mongodb://127.0.0.1:27017', APP_ORIGIN: undefined, PORT: undefined, SHARED_RATE_LIMIT: undefined };

/** paymentMemoryDb plus findOneAndUpdate ($addToSet) and a query log; `racy` interleaves calls. */
function newDb({ racy = false } = {}) {
  const db = paymentMemoryDb({ uniqueIndexes: INDEXES, racy });
  const base = db.collection.bind(db);
  db.log = [];
  db.collection = (name) => {
    const col = base(name);
    if (!col.__phase8) {
      col.__phase8 = true;
      const find = col.find.bind(col);
      col.find = (query, options) => {
        db.log.push({ name, op: 'find', query, options });
        return find(query, options);
      };
      col.findOneAndUpdate = async (filter, update) => {
        if (racy) await yieldTurn();
        const doc = col.docs.find((row) => matches(row, filter));
        if (!doc) return null;
        for (const [key, value] of Object.entries(update.$addToSet || {})) {
          const list = Array.isArray(doc[key]) ? doc[key] : [];
          if (!list.map(String).includes(String(value))) list.push(value);
          doc[key] = list;
        }
        Object.assign(doc, update.$set || {});
        const snapshot = { ...doc, completedLessons: [...(doc.completedLessons || [])] };
        if (racy) await yieldTurn();
        return snapshot;
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

function fakeIo() {
  const emits = [];
  return { emits, to: (room) => ({ emit: (event, data) => emits.push({ room, event, data }) }) };
}

/**
 * Course P (published, explicit previews): l1 preview, l2 paid, l3 paid, l4 demo.
 * Course Q (published): q1 preview, q2 paid. Course D (draft): d1.
 */
function seed(db) {
  const w = { student: newId(), payer: newId(), other: newId(), stranger: newId(), superadmin: newId(), instructor: newId(), P: newId(), Q: newId(), D: newId(), l: {} };
  const course = (id, status, title) => db.rows('courses').push({ _id: new ObjectId(id), title, status, instructorId: w.instructor, difficulty: 'beginner', freePreviewExplicit: true, createdAt: NOW });
  course(w.P, 'published', 'Price Action');
  course(w.Q, 'published', 'Risk');
  course(w.D, 'draft', 'Draft');
  const lesson = (key, courseId, order, flags = {}) => {
    const id = newId();
    w.l[key] = id;
    db.rows('lessons').push({ _id: new ObjectId(id), courseId, order, title: `Lesson ${key}`, type: 'text', content: `<p>BODY-${key}</p>`, ...flags });
  };
  lesson('l1', w.P, 1, { isFreePreview: true });
  lesson('l2', w.P, 2);
  lesson('l3', w.P, 3);
  lesson('l4', w.P, 4, { isDemo: true });
  lesson('q1', w.Q, 1, { isFreePreview: true });
  lesson('q2', w.Q, 2);
  lesson('d1', w.D, 1, { isFreePreview: true });
  return w;
}

function enroll(db, userId, courseId, extra = {}) {
  db.rows('progress').push({ _id: new ObjectId(), userId, courseId, progress: 0, completedLessons: [], active: true, createdAt: NOW, ...extra });
}
function entitle(db, userId, courseId) {
  db.rows(COLLECTIONS.courseAccess).push({ _id: new ObjectId(), userId, courseId, paid: true, entitlementType: 'paid_course', unlockedAt: NOW });
}
function account(db, userId, role) {
  db.rows('users').push({ _id: new ObjectId(userId), email: `${role}-${userId.slice(-6)}@example.test`, name: `${role} ${userId.slice(-4)}`, role, status: 'approved', sessionGeneration: 0 });
}
function session(db, userId) {
  return seedSession(db.rows('sessions'), { userId, generation: 0, now: new Date() });
}

async function call(handler, { method = 'GET', token, body, query = {}, headers } = {}) {
  const res = mockResponse();
  await handler({ method, url: '/api/test', headers: headers || requestHeaders(token), body, query, socket: { remoteAddress: '10.0.0.8' } }, res);
  return res;
}

function world({ racy = false } = {}) {
  const db = newDb({ racy });
  const w = seed(db);
  const io = fakeIo();
  const stubs = { 'lib/mongodb': { getDb: async () => db }, 'lib/socket-server': { getSocketServer: () => io } };
  const r = {
    progress: loadModule('pages/api/progress/index.ts', stubs).default,
    activity: loadModule('pages/api/progress/activity.ts', stubs).default,
    summary: loadModule('pages/api/progress/summary.ts', stubs).default,
    certificates: loadModule('pages/api/certificates/index.ts', stubs).default,
  };
  for (const [key, role] of [['student', 'student'], ['payer', 'student'], ['other', 'student'], ['stranger', 'student'], ['superadmin', 'superadmin'], ['instructor', 'instructor']]) account(db, w[key], role);
  const T = {};
  for (const key of ['student', 'payer', 'other', 'stranger', 'superadmin', 'instructor']) T[key] = session(db, w[key]);
  enroll(db, w.student, w.P);
  enroll(db, w.payer, w.P);
  enroll(db, w.other, w.P);
  entitle(db, w.payer, w.P);
  return { db, w, r, T, io };
}

const row = (db, userId, courseId) => db.rows('progress').find((p) => p.userId === userId && String(p.courseId) === courseId);
const complete = (r, token, courseId, lessonId, extra = {}) => call(r.progress, { method: 'POST', token, body: { courseId, lessonId, ...extra } });
const view = (r, token, lessonId, event = 'view', extra = {}) => call(r.activity, { method: 'POST', token, body: { lessonId, event, ...extra } });
const summaryOf = async (r, token) => (await call(r.summary, { token })).body;

// ---------------------------------------------------------------------------
// Progress integrity
// ---------------------------------------------------------------------------

test('integrity: repeated and duplicate (parallel) completion requests are idempotent and never inflate progress', async () => {
  await withEnv(ROUTE_ENV, async () => {
    const { db, w, r, T } = world();
    for (let i = 0; i < 3; i += 1) assert.equal((await complete(r, T.payer, w.P, w.l.l1)).statusCode, 200);
    await Promise.all([1, 2, 3, 4].map(() => complete(r, T.payer, w.P, w.l.l2)));
    const p = row(db, w.payer, w.P);
    assert.deepEqual(p.completedLessons.sort(), [w.l.l1, w.l.l2].sort());
    assert.equal(p.progress, 50);
    const s = await summaryOf(r, T.payer);
    assert.deepEqual([s.totals.completedLessons, s.courses[0].percent], [2, 50]);
  });
});

test('integrity: course completion never exceeds 100% and counts only lessons of the course', async () => {
  await withEnv(ROUTE_ENV, async () => {
    assert.equal(progressPercent(['a', 'b', 'c', 'x', 'y'], ['a', 'b']), 100);
    assert.equal(progressPercent(['foreign-1', 'foreign-2'], ['a', 'b']), 0);
    const { db, w, r, T } = world();
    // A stored row polluted with ids of another course's lessons and deleted lessons.
    row(db, w.payer, w.P).completedLessons = [w.l.q1, w.l.q2, 'deleted-lesson'];
    for (const key of ['l1', 'l2', 'l3', 'l4']) await complete(r, T.payer, w.P, w.l[key]);
    const p = row(db, w.payer, w.P);
    assert.equal(p.progress, 100);
    const s = await summaryOf(r, T.payer);
    assert.deepEqual([s.courses[0].percent, s.courses[0].completedLessons, s.courses[0].totalLessons], [100, 4, 4]);
    // Another course's lesson cannot be recorded against P.
    const foreign = await complete(r, T.payer, w.P, w.l.q1);
    assert.equal(foreign.statusCode, 403);
  });
});

test('integrity: deleting or reordering lessons does not silently corrupt history; completedAt is permanent', async () => {
  await withEnv(ROUTE_ENV, async () => {
    const { db, w, r, T } = world();
    for (const key of ['l1', 'l2', 'l3', 'l4']) await complete(r, T.payer, w.P, w.l[key]);
    const completedAt = row(db, w.payer, w.P).completedAt;
    assert.ok(completedAt instanceof Date);
    // Reorder: nothing about completion depends on order.
    for (const lesson of db.rows('lessons')) if (String(lesson.courseId) === w.P) lesson.order = 10 - lesson.order;
    await recomputeCourseProgress(db, w.P);
    assert.equal(row(db, w.payer, w.P).progress, 100);
    // Delete one lesson: history keeps the id, the percentage is measured against what remains.
    db.rows('lessons').splice(db.rows('lessons').findIndex((l) => String(l._id) === w.l.l3), 1);
    await recomputeCourseProgress(db, w.P);
    assert.ok(row(db, w.payer, w.P).completedLessons.includes(w.l.l3), 'history keeps the deleted id');
    assert.equal(row(db, w.payer, w.P).progress, 100);
    // Add a lesson: coverage drops, the completion stays.
    db.rows('lessons').push({ _id: new ObjectId(), courseId: w.P, order: 9, title: 'New lesson' });
    await recomputeCourseProgress(db, w.P);
    assert.equal(row(db, w.payer, w.P).progress, 75);
    assert.equal(row(db, w.payer, w.P).completedAt, completedAt);
    const s = await summaryOf(r, T.payer);
    assert.equal(s.courses[0].status, 'completed');
    assert.equal(s.inProgress.length, 0, 'a completed course is not shown as in progress');
    assert.deepEqual([s.courses[0].completedLessons, s.courses[0].totalLessons], [3, 4]);
  });
});

// ---------------------------------------------------------------------------
// Ownership and security
// ---------------------------------------------------------------------------

test('security: a client-supplied userId never selects whose progress is written or read', async () => {
  await withEnv(ROUTE_ENV, async () => {
    const { db, w, r, T } = world();
    const res = await complete(r, T.student, w.P, w.l.l1, { userId: w.other });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(row(db, w.student, w.P).completedLessons, [w.l.l1]);
    assert.deepEqual(row(db, w.other, w.P).completedLessons, [], 'the other student is untouched');
    await view(r, T.student, w.l.l1, 'view', { userId: w.other, courseId: w.Q });
    assert.equal(row(db, w.other, w.P).lastLessonId, undefined);
    assert.ok(db.rows('learningMinutes').every((m) => m.userId === w.student));
    // Reads: only the session's own data, whatever the query says.
    const s = await call(r.summary, { token: T.student, query: { userId: w.other } });
    assert.equal(s.body.totals.completedLessons, 1);
    const list = await call(r.progress, { token: T.student, query: { userId: w.other } });
    assert.ok(list.body.every((p) => p.userId === w.student));
    // No session at all.
    assert.equal((await call(r.summary, {})).statusCode, 401);
    assert.equal((await call(r.activity, { method: 'POST', body: { lessonId: w.l.l1, event: 'view' } })).statusCode, 401);
    // Activity without the CSRF header (Phase 4.5).
    const noCsrf = requestHeaders(T.student);
    delete noCsrf['x-fo-csrf'];
    assert.equal((await call(r.activity, { method: 'POST', headers: noCsrf, body: { lessonId: w.l.l1, event: 'view' } })).statusCode, 403);
  });
});

test('security: unenrolled, revoked and locked access cannot write progress or activity; bad relationships are refused', async () => {
  await withEnv(ROUTE_ENV, async () => {
    const { db, w, r, T } = world();
    assert.equal((await complete(r, T.stranger, w.P, w.l.l1)).statusCode, 403, 'not enrolled');
    assert.equal((await view(r, T.stranger, w.l.l1)).statusCode, 403);
    assert.equal((await complete(r, T.student, w.P, w.l.l2)).body.code, 'lesson_locked', 'paid lesson without access');
    assert.equal((await view(r, T.student, w.l.l2)).body.code, 'lesson_locked');
    assert.equal((await view(r, T.student, w.l.q1)).statusCode, 403, 'a lesson of a course they are not enrolled in');
    assert.equal((await view(r, T.student, w.l.d1)).statusCode, 403, 'a draft course');
    assert.equal((await complete(r, T.student, w.Q, w.l.l1)).statusCode, 403, 'lesson and course do not match');
    for (const body of [{ lessonId: 'nope', event: 'view' }, { lessonId: w.l.l1, event: 'complete' }, { lessonId: w.l.l1 }, { lessonId: { $ne: null }, event: 'view' }]) {
      assert.equal((await call(r.activity, { method: 'POST', token: T.student, body })).statusCode, 400, JSON.stringify(body));
    }
    assert.equal((await call(r.activity, { token: T.student })).statusCode, 405);
    // Revoked complimentary access.
    const actor = { userId: w.superadmin, email: 'owner@example.test', role: 'superadmin' };
    await grantCourseAccess(db, { actor, userId: w.student, courseId: w.P, reason: 'Phase 8 access check', now: NOW });
    assert.equal((await complete(r, T.student, w.P, w.l.l2)).statusCode, 200);
    await revokeCourseGrant(db, { actor, userId: w.student, courseId: w.P, reason: 'Phase 8 revocation', now: NOW });
    assert.equal((await complete(r, T.student, w.P, w.l.l3)).body.code, 'lesson_locked');
    assert.equal((await view(r, T.student, w.l.l3)).body.code, 'lesson_locked');
    // Withdrawn enrollment.
    row(db, w.payer, w.P).active = false;
    assert.equal((await complete(r, T.payer, w.P, w.l.l1)).statusCode, 403);
    assert.equal((await view(r, T.payer, w.l.l1)).statusCode, 403);
    // Staff signals are accepted but not recorded.
    const staff = await view(r, T.superadmin, w.l.l1);
    assert.deepEqual([staff.statusCode, staff.body.recorded], [200, false]);
    assert.ok(db.rows('learningMinutes').every((m) => m.userId === w.student));
    assert.equal((await call(r.progress, { method: 'POST', token: T.instructor, body: { courseId: w.P, lessonId: w.l.l1 } })).statusCode, 403);
  });
});

test('security: activity signals are rate limited per account', async () => {
  await withEnv(ROUTE_ENV, async () => {
    const { w, r, T } = world();
    const { ACTIVITY_RULES } = require('../lib/content-rate-limit');
    let last;
    for (let i = 0; i <= ACTIVITY_RULES[0].max; i += 1) last = await view(r, T.other, w.l.l1, 'heartbeat');
    assert.equal(last.statusCode, 429);
    assert.equal((await view(r, T.student, w.l.l1, 'heartbeat')).statusCode, 200, 'another account is not affected');
  });
});

test('security: summary and activity responses are private; no other student or lesson body appears', async () => {
  await withEnv(ROUTE_ENV, async () => {
    const { w, r, T } = world();
    await complete(r, T.other, w.P, w.l.l1);
    const res = await call(r.summary, { token: T.student });
    assert.equal(res.headers['cache-control'], 'private, no-store, max-age=0');
    const text = JSON.stringify(res.body);
    assert.equal(text.includes(w.other), false);
    assert.equal(/BODY-/.test(text), false);
    assert.equal((await view(r, T.student, w.l.l1)).headers['cache-control'], 'private, no-store, max-age=0');
  });
});

// ---------------------------------------------------------------------------
// Persistence and synchronization
// ---------------------------------------------------------------------------

test('sync: progress is the same after refresh, after logout/login and on another device (another session)', async () => {
  await withEnv(ROUTE_ENV, async () => {
    const { db, w, r, T } = world();
    await view(r, T.payer, w.l.l2);
    await complete(r, T.payer, w.P, w.l.l1);
    await complete(r, T.payer, w.P, w.l.l2);
    const first = await summaryOf(r, T.payer);
    const refreshed = await summaryOf(r, T.payer);
    assert.deepEqual(refreshed.courses, first.courses);
    // Sign out (session revoked) and sign in again, or a phone with its own session.
    db.rows('sessions').find((s) => s.userId === w.payer).revokedAt = new Date();
    assert.equal((await call(r.summary, { token: T.payer })).statusCode, 401);
    const phone = session(db, w.payer);
    const onPhone = await summaryOf(r, phone);
    assert.deepEqual(onPhone.courses, first.courses);
    assert.deepEqual(onPhone.continue, first.continue);
  });
});

test('sync: a completion is broadcast to every tab and device of that account only', async () => {
  await withEnv(ROUTE_ENV, async () => {
    const { w, r, T, io } = world();
    await complete(r, T.payer, w.P, w.l.l2);
    const events = io.emits.filter((e) => e.event === 'progressUpdated');
    assert.equal(events.length, 1);
    assert.equal(events[0].room, `user:${w.payer}`);
    assert.deepEqual([events[0].data.courseId, events[0].data.lessonId, events[0].data.progress], [w.P, w.l.l2, 25]);
    // Refused writes broadcast nothing.
    await complete(r, T.student, w.P, w.l.l2);
    assert.equal(io.emits.filter((e) => e.event === 'progressUpdated').length, 1);
    // The socket completion path broadcasts to the account's room too, after the paywall.
    const source = read('server.js');
    const handler = source.slice(source.indexOf("socket.on('progressUpdate'"), source.indexOf("socket.on('lessonUpdated'"));
    assert.ok(handler.indexOf('.isOpen(decision.lessonId)) return;') < handler.indexOf("io.to(`user:${decision.userId}`).emit('progressUpdated'"));
    // Clients: lesson page, course page and dashboard subscribe and refetch on focus/reconnect.
    const sync = read('hooks/useProgressSync.ts');
    assert.match(sync, /socket\.on\('progressUpdated'/);
    assert.match(sync, /window\.addEventListener\('focus', refetch\)/);
    assert.match(sync, /socket\.io\.on\('reconnect'/);
    for (const page of ['pages/courses/[id]/lessons/[lessonId].tsx', 'pages/courses/[id].tsx', 'hooks/useProgressSummary.ts']) assert.match(read(page), /useProgressSync\(/, page);
  });
});

test('sync: concurrent completions from two tabs/devices never lose progress (interleaved reads and writes)', async () => {
  await withEnv(ROUTE_ENV, async () => {
    for (let round = 0; round < 5; round += 1) {
      const { db, w, r, T } = world({ racy: true });
      const tabB = session(db, w.payer);
      await Promise.all([
        complete(r, T.payer, w.P, w.l.l1),
        complete(r, tabB, w.P, w.l.l2),
        complete(r, T.payer, w.P, w.l.l3),
        complete(r, tabB, w.P, w.l.l4),
      ]);
      const p = row(db, w.payer, w.P);
      assert.equal(p.completedLessons.length, 4);
      assert.equal(p.progress, 100, `round ${round}: the stored percentage matches the full list`);
      assert.ok(p.completedAt instanceof Date);
    }
  });
});

test('sync: the stale-write guard: an older snapshot cannot overwrite a newer percentage (lib level)', async () => {
  const db = newDb();
  const courseId = newId();
  const lessons = [newId(), newId()];
  for (const id of lessons) db.rows('lessons').push({ _id: new ObjectId(id), courseId });
  db.rows('progress').push({ _id: new ObjectId(), userId: 'u1', courseId, completedLessons: [], progress: 0, active: true });
  // Simulate the slow request: its snapshot saw one lesson, then a second completion landed.
  const col = db.collection('progress');
  const original = col.findOneAndUpdate;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  col.findOneAndUpdate = async (...args) => {
    const snap = await original(...args);
    if (snap.completedLessons.length === 1) await gate;
    return snap;
  };
  const slow = recordLessonCompletion(db, { userId: 'u1', courseId, lessonId: lessons[0] });
  await yieldTurn();
  await recordLessonCompletion(db, { userId: 'u1', courseId, lessonId: lessons[1] });
  assert.equal(db.rows('progress')[0].progress, 100);
  release();
  await slow;
  assert.equal(db.rows('progress')[0].progress, 100, 'the older snapshot (50%) did not overwrite 100%');
});

test('sync: offline recovery: a retried completion and replayed activity create no duplicates', async () => {
  await withEnv(ROUTE_ENV, async () => {
    const { db, w, r, T } = world();
    // The first request reached the server but its answer was lost; the client retries.
    await complete(r, T.student, w.P, w.l.l1);
    await complete(r, T.student, w.P, w.l.l1);
    assert.deepEqual(row(db, w.student, w.P).completedLessons, [w.l.l1]);
    const now = at('2026-11-08T10:15:10Z');
    for (let i = 0; i < 5; i += 1) await activity.recordActivity(db, { userId: w.student, courseId: w.P, lessonId: w.l.l1, event: 'heartbeat', now });
    assert.equal(db.rows('learningMinutes').length, 1);
    assert.equal(db.rows('learningDays')[0].minutes, 1);
    // Signals are never queued offline (time cannot be backfilled): the hook sends only live.
    const hook = read('hooks/useLearningActivity.ts');
    assert.equal(/localStorage|indexedDB|queue/i.test(hook.replace(/Signals are not queued/g, '')), false);
  });
});

// ---------------------------------------------------------------------------
// Resume learning
// ---------------------------------------------------------------------------

test('resume: the last viewed lesson is persisted (newest wins) and Continue opens it', async () => {
  await withEnv(ROUTE_ENV, async () => {
    const { db, w, r, T } = world();
    // Past server times (the route below records with the real clock, which is later).
    await activity.recordActivity(db, { userId: w.payer, courseId: w.P, lessonId: w.l.l3, event: 'view', now: at('2026-10-08T10:05:00Z') });
    // A delayed, older view arrives later: it must not replace the newer one.
    await activity.recordActivity(db, { userId: w.payer, courseId: w.P, lessonId: w.l.l1, event: 'view', now: at('2026-10-08T10:01:00Z') });
    const p = row(db, w.payer, w.P);
    assert.deepEqual([p.lastLessonId, p.lastViewedAt.toISOString()], [w.l.l3, '2026-10-08T10:05:00.000Z']);
    const s = await summaryOf(r, T.payer);
    assert.deepEqual([s.continue.courseId, s.continue.lessonId, s.continue.reason], [w.P, w.l.l3, 'last_viewed']);
    // Through the route: opening l2 makes it the last viewed lesson.
    await view(r, T.payer, w.l.l2);
    assert.equal(row(db, w.payer, w.P).lastLessonId, w.l.l2);
    // Completed the last viewed lesson: continue with the next unfinished one after it.
    await complete(r, T.payer, w.P, w.l.l2);
    const after = await summaryOf(r, T.payer);
    assert.deepEqual([after.continue.lessonId, after.continue.reason], [w.l.l3, 'next_after_last_viewed']);
  });
});

test('resume: a deleted or no-longer-accessible last lesson falls back safely; locked lessons are never offered', async () => {
  await withEnv(ROUTE_ENV, async () => {
    const { db, w, r, T } = world();
    const actor = { userId: w.superadmin, email: 'owner@example.test', role: 'superadmin' };
    await grantCourseAccess(db, { actor, userId: w.student, courseId: w.P, reason: 'Phase 8 resume check', now: NOW });
    await view(r, T.student, w.l.l3);
    assert.equal((await summaryOf(r, T.student)).continue.lessonId, w.l.l3);
    // Access revoked: l3 is locked now; continue goes to the next open unfinished lesson after it
    // (l4, the demo lesson), never to l3.
    await revokeCourseGrant(db, { actor, userId: w.student, courseId: w.P, reason: 'Phase 8 resume revoke', now: NOW });
    const revoked = await summaryOf(r, T.student);
    assert.deepEqual([revoked.continue.lessonId, revoked.continue.reason], [w.l.l4, 'next_after_last_viewed']);
    await complete(r, T.student, w.P, w.l.l4);
    const before = await summaryOf(r, T.student);
    assert.deepEqual([before.continue.lessonId, before.continue.reason], [w.l.l1, 'first_unfinished']);
    // Every open lesson done, only locked ones left: the course page (unlock), no lesson.
    await complete(r, T.student, w.P, w.l.l1);
    const locked = await summaryOf(r, T.student);
    assert.deepEqual([locked.continue.lessonId, locked.continue.reason], [null, 'locked_remaining']);
    // Payer: the last viewed lesson is deleted.
    await view(r, T.payer, w.l.l3);
    db.rows('lessons').splice(db.rows('lessons').findIndex((l) => String(l._id) === w.l.l3), 1);
    const gone = await summaryOf(r, T.payer);
    assert.deepEqual([gone.continue.lessonId, gone.continue.reason], [w.l.l1, 'last_viewed_unavailable']);
    // The course becomes a draft: it leaves the summary entirely.
    db.rows('courses').find((c) => String(c._id) === w.P).status = 'draft';
    const hidden = await summaryOf(r, T.payer);
    assert.deepEqual([hidden.continue, hidden.courses.length], [null, 0]);
  });
});

test('resume: the most recently studied unfinished course is continued; completed courses are not', async () => {
  await withEnv(ROUTE_ENV, async () => {
    const { db, w, r, T } = world();
    enroll(db, w.payer, w.Q);
    await activity.recordActivity(db, { userId: w.payer, courseId: w.Q, lessonId: w.l.q1, event: 'view', now: at('2026-11-08T09:00:00Z') });
    await activity.recordActivity(db, { userId: w.payer, courseId: w.P, lessonId: w.l.l2, event: 'view', now: at('2026-11-08T09:30:00Z') });
    assert.equal((await summaryOf(r, T.payer)).continue.courseId, w.P);
    for (const key of ['l1', 'l2', 'l3', 'l4']) await complete(r, T.payer, w.P, w.l[key]);
    const s = await summaryOf(r, T.payer);
    assert.equal(s.continue.courseId, w.Q, 'P is complete, so Q is continued');
    assert.deepEqual(s.completed.map((c) => c.courseId), [w.P]);
    assert.deepEqual(s.inProgress.map((c) => c.courseId), [w.Q]);
  });
});

// ---------------------------------------------------------------------------
// Learning analytics
// ---------------------------------------------------------------------------

test('analytics: idle time is not counted (client rule) and the server counts each minute once', async () => {
  const { shouldSendHeartbeat, ACTIVE_WINDOW_MS } = loadModule('hooks/useLearningActivity.ts', { react: { useCallback: (f) => f, useEffect: () => {}, useRef: (v) => ({ current: v }) }, 'lib/api-client': { apiClient: {} } });
  const now = 1_000_000;
  assert.equal(shouldSendHeartbeat({ visible: true, lastActiveAt: now - 10_000, now }), true);
  assert.equal(shouldSendHeartbeat({ visible: true, lastActiveAt: now - ACTIVE_WINDOW_MS - 1, now }), false, 'idle');
  assert.equal(shouldSendHeartbeat({ visible: false, lastActiveAt: now, now }), false, 'hidden tab');
  const db = newDb();
  // Ten signals over three clock minutes (two tabs) = three active minutes.
  const times = ['10:00:01', '10:00:20', '10:00:31', '10:00:59', '10:01:00', '10:01:30', '10:01:45', '10:02:05', '10:02:30', '10:02:50'];
  for (const t of times) await activity.recordActivity(db, { userId: 'u1', courseId: 'c1', lessonId: 'l1', event: 'heartbeat', now: at(`2026-11-08T${t}Z`) });
  const stats = await activity.learningStats(db, 'u1', { now: at('2026-11-08T12:00:00Z') });
  assert.deepEqual([stats.todayMinutes, stats.totalMinutes], [3, 3]);
  // An hour of silence (idle, tab closed) adds nothing.
  await activity.recordActivity(db, { userId: 'u1', courseId: 'c1', lessonId: 'l1', event: 'heartbeat', now: at('2026-11-08T11:05:00Z') });
  assert.equal((await activity.learningStats(db, 'u1', { now: at('2026-11-08T12:00:00Z') })).totalMinutes, 4);
});

test('analytics: duplicate and parallel signals in one minute cannot inflate time', async () => {
  const db = paymentMemoryDb({ racy: true });
  const now = at('2026-11-08T10:30:10Z');
  await Promise.all(Array.from({ length: 12 }, () => activity.recordActivity(db, { userId: 'u1', courseId: 'c1', lessonId: 'l1', event: 'heartbeat', now })));
  assert.equal(db.rows('learningMinutes').length, 1);
  assert.equal(db.rows('learningDays').length, 1);
  assert.equal(db.rows('learningDays')[0].minutes, 1);
});

test('analytics: streak rules (consecutive learning days to today, or to yesterday)', () => {
  const s = activity.computeStreak;
  assert.deepEqual(s([], '2026-11-08'), { current: 0, longest: 0, activeToday: false });
  assert.deepEqual(s(['2026-11-08'], '2026-11-08'), { current: 1, longest: 1, activeToday: true });
  assert.deepEqual(s(['2026-11-06', '2026-11-07'], '2026-11-08'), { current: 2, longest: 2, activeToday: false }, 'not lost until a whole day passes');
  assert.deepEqual(s(['2026-11-05', '2026-11-06'], '2026-11-08'), { current: 0, longest: 2, activeToday: false }, 'a missed day ends it');
  assert.deepEqual(s(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-07', '2026-11-08', '2026-11-08'], '2026-11-08'), { current: 2, longest: 4, activeToday: true });
  assert.deepEqual(s(['2026-02-28', '2026-03-01'], '2026-03-01').current, 2, 'month boundary');
  assert.deepEqual(s(['2027-12-31', '2028-01-01'], '2028-01-01').current, 2, 'year boundary');
  assert.deepEqual(s(['bad', null, '2026-11-08'], '2026-11-08').current, 1, 'malformed keys ignored');
});

test('analytics: timezone boundaries use Africa/Lagos (UTC+1) consistently for days and streaks', async () => {
  assert.equal(activity.LEARNING_TIMEZONE, 'Africa/Lagos');
  assert.equal(activity.dayKey(at('2026-11-07T22:59:59Z')), '2026-11-07');
  assert.equal(activity.dayKey(at('2026-11-07T23:00:00Z')), '2026-11-08', '00:00 in Lagos');
  assert.equal(activity.minuteOf(at('2026-11-07T23:00:59.900Z')).key, '2026-11-07T23:00');
  const db = newDb();
  // 23:30 UTC on the 7th is the 8th in Lagos; 22:30 UTC on the 8th is still the 8th.
  await activity.recordActivity(db, { userId: 'u1', courseId: 'c1', lessonId: 'l1', event: 'heartbeat', now: at('2026-11-06T12:00:00Z') });
  await activity.recordActivity(db, { userId: 'u1', courseId: 'c1', lessonId: 'l1', event: 'heartbeat', now: at('2026-11-07T23:30:00Z') });
  await activity.recordActivity(db, { userId: 'u1', courseId: 'c1', lessonId: 'l1', event: 'heartbeat', now: at('2026-11-08T22:30:00Z') });
  assert.deepEqual(db.rows('learningDays').map((d) => [d.day, d.minutes]), [['2026-11-06', 1], ['2026-11-08', 2]]);
  const stats = await activity.learningStats(db, 'u1', { now: at('2026-11-08T22:59:00Z') });
  assert.deepEqual([stats.today, stats.todayMinutes, stats.streak.current], ['2026-11-08', 2, 1], 'the 7th (Lagos) had no learning');
  // Just after midnight in Lagos, the 8th counts as yesterday.
  const next = await activity.learningStats(db, 'u1', { now: at('2026-11-08T23:00:01Z') });
  assert.deepEqual([next.today, next.todayMinutes, next.streak.current, next.streak.activeToday], ['2026-11-09', 0, 1, false]);
});

test('analytics: recent activity comes from persisted learning days and the summary', async () => {
  await withEnv(ROUTE_ENV, async () => {
    const { w, r, T } = world();
    await view(r, T.student, w.l.l1);
    await view(r, T.student, w.l.l1, 'heartbeat');
    const s = await summaryOf(r, T.student);
    assert.equal(s.learning.recent.length, 7);
    assert.equal(s.learning.todayMinutes, 1, 'two signals in the same minute');
    assert.equal(s.learning.streak.current, 1);
    assert.deepEqual(s.recent.map((c) => [c.courseId, c.lastLesson.lessonId]), [[w.P, w.l.l1]]);
  });
});

// ---------------------------------------------------------------------------
// Course lists and certificates
// ---------------------------------------------------------------------------

test('lists: completed / in-progress / not-started are accurate and a course appears once', async () => {
  await withEnv(ROUTE_ENV, async () => {
    const { db, w, r, T } = world();
    enroll(db, w.payer, w.Q);
    // An old duplicate row of P with the course id stored as an ObjectId (pre-E1 data).
    db.rows('progress').push({ _id: new ObjectId(), userId: w.payer, courseId: new ObjectId(w.P), completedLessons: [], progress: 0, active: true });
    for (const key of ['l1', 'l2', 'l3', 'l4']) await complete(r, T.payer, w.P, w.l[key]);
    const s = await summaryOf(r, T.payer);
    assert.equal(s.courses.filter((c) => c.courseId === w.P).length, 1, 'no duplicate course');
    assert.deepEqual(s.completed.map((c) => c.courseId), [w.P]);
    assert.deepEqual(s.inProgress.map((c) => c.courseId), []);
    assert.equal(s.courses.find((c) => c.courseId === w.Q).status, 'not_started');
    assert.deepEqual(s.totals, { enrolled: 2, completedCourses: 1, inProgressCourses: 0, completedLessons: 4 });
    // A withdrawn course leaves the lists.
    row(db, w.payer, w.Q).active = false;
    assert.equal((await summaryOf(r, T.payer)).courses.length, 1);
  });
});

test('certificates: eligibility uses the authoritative completion; refunded or revoked access follows Phase 6', async () => {
  await withEnv(ROUTE_ENV, async () => {
    const { db, w, r, T } = world();
    // A stored 100 made of deleted lessons is not a completion.
    Object.assign(row(db, w.payer, w.P), { progress: 100, completedLessons: ['gone-1', 'gone-2'] });
    const refused = await call(r.certificates, { method: 'POST', token: T.payer, body: { courseId: w.P } });
    assert.equal(refused.statusCode, 400);
    for (const key of ['l1', 'l2', 'l3', 'l4']) await complete(r, T.payer, w.P, w.l[key]);
    // Refund with access removal before claiming: no certificate.
    const access = db.rows(COLLECTIONS.courseAccess).find((a) => a.userId === w.payer);
    Object.assign(access, { paid: false, entitlementType: 'refunded' });
    const refunded = await call(r.certificates, { method: 'POST', token: T.payer, body: { courseId: w.P } });
    assert.deepEqual([refunded.statusCode, refunded.body.code], [403, 'course_access_required']);
    Object.assign(access, { paid: true, entitlementType: 'paid_course' });
    const issued = await call(r.certificates, { method: 'POST', token: T.payer, body: { courseId: w.P } });
    assert.equal(issued.statusCode, 201);
    assert.deepEqual([issued.body.completedLessons, issued.body.totalLessons, issued.body.completionBasis], [4, 4, 'recorded']);
    // The feature stays switched off for the product (no new certificate rule in Phase 8).
    assert.match(read('lib/feature-access.js'), /CERTIFICATES:\s*false/);
  });
});

// ---------------------------------------------------------------------------
// Performance
// ---------------------------------------------------------------------------

test('performance: the summary runs a fixed number of queries and never reads lesson bodies', async () => {
  await withEnv(ROUTE_ENV, async () => {
    const counts = [];
    for (const extra of [0, 12]) {
      const { db, w } = world();
      for (let i = 0; i < extra; i += 1) {
        const cid = newId();
        db.rows('courses').push({ _id: new ObjectId(cid), title: `C${i}`, status: 'published', freePreviewExplicit: true });
        db.rows('lessons').push({ _id: new ObjectId(), courseId: cid, order: 1, title: 'x', isFreePreview: true, content: 'HEAVY' });
        enroll(db, w.payer, cid);
      }
      const calls = [];
      const base = db.collection.bind(db);
      db.collection = (name) => {
        const col = base(name);
        return new Proxy(col, { get: (t, k) => (['find', 'findOne', 'countDocuments'].includes(k) ? (...a) => { calls.push([name, k, a[1] && a[1].projection]); return t[k](...a); } : t[k]) });
      };
      await buildProgressSummary(db, { userId: w.payer, now: NOW });
      counts.push(calls.length);
      const lessonRead = calls.find(([name]) => name === 'lessons');
      assert.deepEqual(lessonRead[2], SUMMARY_LESSON_PROJECTION);
      for (const field of ['content', 'videoUrl', 'pdfUrl', 'resources', 'lessonSummary', 'description']) assert.equal(SUMMARY_LESSON_PROJECTION[field], undefined, field);
    }
    assert.equal(counts[0], counts[1], `queries do not grow with courses (${counts.join(' vs ')})`);
    assert.ok(counts[0] <= 7, `${counts[0]} queries`);
  });
});

test('performance: the dashboard makes one summary request instead of one lesson request per course', () => {
  const page = read('pages/dashboard.tsx');
  assert.equal(page.includes('/lessons?courseId='), false);
  assert.match(read('hooks/useProgressSummary.ts'), /apiClient\.get<ProgressSummary>\('\/progress\/summary'\)/);
  const indexes = require('../lib/learning-indexes').LEARNING_INDEXES;
  assert.ok(indexes.some((d) => d.collection === 'learningDays' && JSON.stringify(d.key) === JSON.stringify({ userId: 1, day: -1 })));
  assert.ok(indexes.some((d) => d.collection === 'learningMinutes' && d.options.expireAfterSeconds === 90 * 86400));
});

test('sync: API routes see the Socket.IO server that server.js set, even from a separately loaded module copy', () => {
  // server.js sets it through lib/socket-server.js; Next.js bundles API routes with their own copy
  // of the module (here: the TypeScript file loaded fresh). Before Phase 8 that copy returned null,
  // so req.io was never set and no HTTP route could broadcast.
  const fromServer = require('../lib/socket-server.js');
  const bundledCopy = loadModule('lib/socket-server.ts');
  const io = { marker: 'phase-8' };
  const previous = fromServer.getSocketServer();
  try {
    fromServer.setSocketServer(io);
    assert.equal(bundledCopy.getSocketServer(), io);
    assert.equal(loadModule('lib/socket-server.ts').getSocketServer(), io, 'any number of copies');
  } finally {
    fromServer.setSocketServer(previous);
  }
});

test('bundle safety: lib/enrollment-state.js (also bundled for the browser) never reaches the MongoDB driver', () => {
  const seen = new Set();
  const walk = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(/require\(['"]mongodb['"]\)/.test(source), false, `${path.relative(ROOT, file)} requires mongodb`);
    for (const [, spec] of source.matchAll(/require\(['"](\.{1,2}\/[^'"]+)['"]\)/g)) {
      const base = path.join(path.dirname(file), spec);
      const resolved = [base, `${base}.js`, `${base}.ts`].find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
      if (resolved) walk(resolved);
    }
  };
  walk(path.join(ROOT, 'lib/enrollment-state.js'));
  assert.ok(seen.has(path.join(ROOT, 'lib/progress-math.js')));
});
