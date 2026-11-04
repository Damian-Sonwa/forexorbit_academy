/**
 * Phase 9 assessments against a real MongoDB server (npm run test:mongo:assessments).
 *
 * What only a real server can show: truly concurrent attempt creation and submission, duplicate
 * key handling, conditional updates under contention, dotted-path autosaves, the index build with
 * its duplicate checks and partial filter, the aggregations behind staff results and the
 * leaderboard, projections, and query plans. Failure injection wraps the real driver: the database
 * work is real and only the chosen call throws.
 *
 * Requires MONGODB_URI_TEST (an isolated server, never production) and MONGODB_DB_NAME_TEST (must
 * end in "_test"). Skipped when MONGODB_URI_TEST is unset.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');

const { openTestDatabase, testDatabaseConfig } = require('../helpers/mongo-test-db');
const { loadModule, mockResponse } = require('../helpers/ts-loader');
const { requestHeaders, seedSession } = require('../helpers/session-cookie');
const A = require('../../lib/quiz-attempts');
const G = require('../../lib/assignment-grading');
const { ASSESSMENT_INDEXES, assessmentIndexReport, ensureAssessmentIndexes } = require('../../lib/assessment-indexes');
const { run: runIndexScript } = require('../../scripts/assessment-indexes');
const { run: runReconcile } = require('../../scripts/quiz-attempt-reconcile');

const config = testDatabaseConfig();
const skip = config.ok ? false : config.reason;
const newId = () => new ObjectId().toHexString();
const ROUTE_ENV = { NODE_ENV: 'test', PAYSTACK_SECRET_KEY: 'sk_test_phase9_unit_only', APP_ORIGIN: undefined, PORT: undefined, SHARED_RATE_LIMIT: undefined };
const [QA, QB] = ['aaaaaaaaaaaa', 'bbbbbbbbbbbb'];
const QUESTIONS = [
  { id: QA, question: 'One', options: ['a', 'b'], correctAnswer: 1, points: 1, explanation: 'SECRET-EXPLANATION' },
  { id: QB, question: 'Two', options: ['a', 'b', 'c'], correctAnswer: 0, points: 3, explanation: '' },
];
const RIGHT = { [QA]: 1, [QB]: 0 };
const SETTINGS = { status: 'published', maxAttempts: null, timeLimitMinutes: null, passingPercent: null, reviewPolicy: 'after_submission', shuffleQuestions: false, shuffleOptions: false, availableFrom: null, availableUntil: null };

async function fresh({ indexes = true } = {}) {
  const conn = await openTestDatabase();
  await conn.reset();
  if (indexes) {
    await conn.db.createCollection('quizAttempts');
    await conn.db.createCollection('quizScores');
    await conn.db.createCollection('quizzes');
    await conn.db.createCollection('assignmentSubmissions');
    await ensureAssessmentIndexes(conn.db, { apply: true });
  }
  return conn;
}

async function closing(conn, fn) {
  try {
    await fn();
  } finally {
    await conn.reset();
    await conn.close();
  }
}

/** One published course with an open lesson and quiz. */
async function seed(db, settings = {}) {
  const w = { courseId: newId(), lessonId: newId(), instructor: newId() };
  await db.collection('courses').insertOne({ _id: new ObjectId(w.courseId), title: 'Course', status: 'published', instructorId: w.instructor, difficulty: 'beginner', freePreviewExplicit: true });
  await db.collection('lessons').insertOne({ _id: new ObjectId(w.lessonId), courseId: w.courseId, order: 1, title: 'Lesson', isFreePreview: true });
  await db.collection('users').insertOne({ _id: new ObjectId(w.instructor), email: 'i@example.test', name: 'I', role: 'instructor', status: 'approved', sessionGeneration: 0 });
  await db.collection('quizzes').insertOne({ lessonId: w.lessonId, courseId: w.courseId, questions: QUESTIONS, settings: { ...SETTINGS, ...settings }, version: 1 });
  return w;
}

async function student(db, w) {
  const userId = newId();
  await db.collection('users').insertOne({ _id: new ObjectId(userId), email: `s${userId}@example.test`, name: `S${userId.slice(-4)}`, role: 'student', status: 'approved', sessionGeneration: 0, points: 0 });
  await db.collection('progress').insertOne({ userId, courseId: w.courseId, progress: 0, completedLessons: [], active: true });
  return userId;
}

const context = (db, userId, w) => A.loadQuizContext(db, { userId, lessonId: w.lessonId, withAnswerKey: true });
const attemptsOf = (db, userId) => db.collection('quizAttempts').find({ userId }).toArray();
const scoresOf = (db, userId) => db.collection('quizScores').find({ userId }).toArray();

/** The real database, with one chosen call replaced. Everything else goes to the server. */
function failing(db, plan) {
  const counts = new Map();
  const wrap = (name) => {
    const real = db.collection(name);
    return new Proxy(real, {
      get(target, prop) {
        const value = target[prop];
        if (typeof value !== 'function') return value;
        return (...args) => {
          const key = `${name}.${String(prop)}`;
          counts.set(key, (counts.get(key) || 0) + 1);
          if (plan.key === key && counts.get(key) === plan.nth) return Promise.reject(new Error(`injected ${key}`));
          return value.apply(target, args);
        };
      },
    });
  };
  return { collection: wrap };
}

async function callRoute(handler, { method = 'GET', token, body, query = {} }) {
  const res = mockResponse();
  await handler({ method, url: '/api/test', headers: requestHeaders(token), body, query, socket: { remoteAddress: '10.0.0.7' } }, res);
  return res;
}

async function sessionFor(db, userId) {
  const rows = [];
  const token = seedSession(rows, { userId, generation: 0, now: new Date() });
  await db.collection('sessions').insertMany(rows);
  return token;
}

async function withRouteEnv(fn) {
  const saved = {};
  for (const [key, value] of Object.entries(ROUTE_ENV)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
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

// ---------------------------------------------------------------------------
// Concurrent attempt creation
// ---------------------------------------------------------------------------

test('real MongoDB: 40 simultaneous starts, repeated: one attempt, no error, no 500-class failure', { skip }, async () => {
  const conn = await fresh();
  await closing(conn, async () => {
    const w = await seed(conn.db);
    for (let round = 0; round < 15; round += 1) {
      const userId = await student(conn.db, w);
      const ctx = await context(conn.db, userId, w);
      const settled = await Promise.allSettled(Array.from({ length: 40 }, () => A.startAttempt(conn.db, ctx)));
      const thrown = settled.filter((s) => s.status === 'rejected').map((s) => s.reason.message);
      assert.deepEqual(thrown, [], `round ${round}: nothing throws`);
      const refused = settled.filter((s) => !s.value.ok).map((s) => s.value.code);
      assert.ok(refused.every((code) => code === 'attempt_busy'), `round ${round}: ${refused}`);
      const ok = settled.filter((s) => s.value.ok);
      assert.ok(ok.length > 0);
      assert.equal(new Set(ok.map((s) => String(s.value.attempt._id))).size, 1, `round ${round}: one attempt`);
      assert.equal((await attemptsOf(conn.db, userId)).length, 1, `round ${round}`);
      assert.equal((await conn.db.collection('quizAttemptCounters').findOne({ userId })).count, 1, `round ${round}`);
    }
  });
});

test('real MongoDB: the insert gap. A request that finds the reservation first wins; the other returns that attempt, never an error', { skip }, async () => {
  const conn = await fresh();
  await closing(conn, async () => {
    const w = await seed(conn.db);
    const userId = await student(conn.db, w);
    const ctx = await context(conn.db, userId, w);
    // A reserves the number, then stalls before its insert while B runs from start to finish.
    let stalled = false;
    const slow = {
      collection(name) {
        const real = conn.db.collection(name);
        if (name !== 'quizAttempts') return real;
        return new Proxy(real, {
          get(target, prop) {
            if (prop === 'insertOne' && !stalled) {
              stalled = true;
              return async (doc) => {
                const b = await A.startAttempt(conn.db, ctx);
                assert.equal(b.ok, true);
                return target.insertOne(doc); // E11000 on the real server
              };
            }
            const value = target[prop];
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
      },
    };
    const a = await A.startAttempt(slow, ctx);
    assert.deepEqual([stalled, a.ok, a.resumed], [true, true, true]);
    assert.equal((await attemptsOf(conn.db, userId)).length, 1);
    assert.equal(String(a.attempt._id), String((await attemptsOf(conn.db, userId))[0]._id));
  });
});

test('real MongoDB: the attempt limit holds under parallel start and submit', { skip }, async () => {
  const conn = await fresh();
  await closing(conn, async () => {
    const w = await seed(conn.db, { maxAttempts: 3 });
    const userId = await student(conn.db, w);
    const ctx = await context(conn.db, userId, w);
    const worker = async () => {
      for (let i = 0; i < 8; i += 1) {
        const started = await A.startAttempt(conn.db, ctx);
        if (started.ok) await A.submitAttempt(conn.db, ctx, String(started.attempt._id), { answers: {} });
      }
    };
    await Promise.all(Array.from({ length: 12 }, worker));
    const rows = await attemptsOf(conn.db, userId);
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map((r) => r.number).sort(), [1, 2, 3]);
    assert.ok(rows.every((r) => r.status === 'submitted'));
    assert.equal((await scoresOf(conn.db, userId)).length, 3);
    assert.equal((await A.startAttempt(conn.db, ctx)).code, 'attempt_limit');
  });
});

test('real MongoDB: the limit is enforced by the atomic reservation itself, even when the read before it is stale', { skip }, async () => {
  const conn = await fresh();
  await closing(conn, async () => {
    const w = await seed(conn.db, { maxAttempts: 1 });
    const userId = await student(conn.db, w);
    const ctx = await context(conn.db, userId, w);
    const first = await A.startAttempt(conn.db, ctx);
    await A.submitAttempt(conn.db, ctx, String(first.attempt._id), { answers: {} });
    // This request read the counter before the first attempt existed.
    let stale = true;
    const racing = {
      collection(name) {
        const real = conn.db.collection(name);
        if (name !== 'quizAttemptCounters') return real;
        return new Proxy(real, {
          get(target, prop) {
            if (prop === 'findOne' && stale) {
              stale = false;
              return async () => null;
            }
            const value = target[prop];
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
      },
    };
    const second = await A.startAttempt(racing, ctx);
    assert.deepEqual([stale, second.ok, second.code], [false, false, 'attempt_limit']);
    assert.equal((await attemptsOf(conn.db, userId)).length, 1);
    assert.equal((await conn.db.collection('quizAttemptCounters').findOne({ userId })).count, 1);
  });
});

// ---------------------------------------------------------------------------
// Submission, idempotency, expiry
// ---------------------------------------------------------------------------

test('real MongoDB: 30 concurrent submits: one result, one score row, one completion', { skip }, async () => {
  const conn = await fresh();
  await closing(conn, async () => {
    const w = await seed(conn.db);
    for (let round = 0; round < 5; round += 1) {
      const userId = await student(conn.db, w);
      const ctx = await context(conn.db, userId, w);
      const { attempt } = await A.startAttempt(conn.db, ctx);
      const results = await Promise.all(Array.from({ length: 30 }, (_, i) => A.submitAttempt(conn.db, ctx, String(attempt._id), { answers: i % 3 ? RIGHT : { [QA]: 0 } })));
      assert.ok(results.every((r) => r.ok));
      assert.equal(new Set(results.map((r) => r.attempt.result.percent)).size, 1, 'one stored result for everyone');
      const scores = await scoresOf(conn.db, userId);
      assert.equal(scores.length, 1);
      const [stored] = await attemptsOf(conn.db, userId);
      assert.equal(stored.effectsPending, undefined);
      assert.equal(scores[0].score, stored.result.percent, 'the score row and the attempt agree');
      const row = await conn.db.collection('progress').findOne({ userId });
      assert.deepEqual(row.completedLessons, [w.lessonId]);
    }
  });
});

test('real MongoDB: a duplicate submit returns the stored result and writes nothing', { skip }, async () => {
  const conn = await fresh();
  await closing(conn, async () => {
    const w = await seed(conn.db);
    const userId = await student(conn.db, w);
    const ctx = await context(conn.db, userId, w);
    const { attempt } = await A.startAttempt(conn.db, ctx);
    const first = await A.submitAttempt(conn.db, ctx, String(attempt._id), { answers: RIGHT });
    const second = await A.submitAttempt(conn.db, ctx, String(attempt._id), { answers: {} });
    assert.equal(second.alreadyFinal, true);
    assert.deepEqual(second.attempt.result, first.attempt.result);
    assert.equal((await scoresOf(conn.db, userId)).length, 1);
  });
});

test('real MongoDB: expiry against a racing submit and reads has one outcome; grace answers count, later ones do not', { skip }, async () => {
  const conn = await fresh();
  await closing(conn, async () => {
    const w = await seed(conn.db, { timeLimitMinutes: 1 });
    const T = new Date('2026-11-10T10:00:00Z');
    const at = (s) => new Date(T.getTime() + s * 1000);
    const userId = await student(conn.db, w);
    const ctx = await context(conn.db, userId, w);
    const { attempt } = await A.startAttempt(conn.db, ctx, { now: T });
    const id = String(attempt._id);
    assert.equal((await A.saveAnswer(conn.db, ctx, id, { questionId: QA, answer: 1 }, { now: at(69) })).ok, true, 'inside the grace period');
    const refused = await A.saveAnswer(conn.db, ctx, id, { questionId: QB, answer: 0 }, { now: at(70) });
    assert.equal(refused.code, 'attempt_closed');
    const calls = [];
    for (let i = 0; i < 20; i += 1) {
      calls.push(A.readAttempt(conn.db, ctx, id, { now: at(90) }));
      calls.push(A.submitAttempt(conn.db, ctx, id, { answers: RIGHT }, { now: at(90) }));
    }
    await Promise.all(calls);
    const [stored] = await attemptsOf(conn.db, userId);
    assert.deepEqual([stored.status, stored.result.percent], ['expired', 25]);
    assert.deepEqual(stored.submittedAt, at(60));
    assert.equal((await scoresOf(conn.db, userId)).length, 1);
  });
});

test('real MongoDB: a timed-out attempt with no answers records a result and does not complete the lesson', { skip }, async () => {
  const conn = await fresh();
  await closing(conn, async () => {
    const w = await seed(conn.db, { timeLimitMinutes: 1 });
    const userId = await student(conn.db, w);
    const ctx = await context(conn.db, userId, w);
    const T = new Date('2026-11-10T10:00:00Z');
    const { attempt } = await A.startAttempt(conn.db, ctx, { now: T });
    await A.readAttempt(conn.db, ctx, String(attempt._id), { now: new Date(T.getTime() + 600000) });
    assert.equal((await scoresOf(conn.db, userId)).length, 1);
    assert.deepEqual((await conn.db.collection('progress').findOne({ userId })).completedLessons, []);
  });
});

test('real MongoDB: completion: an empty submit and an empty timeout do not complete the lesson; a non-empty submit does', { skip }, async () => {
  const conn = await fresh();
  await closing(conn, async () => {
    const lessons = async (userId) => (await conn.db.collection('progress').findOne({ userId })).completedLessons;
    const w = await seed(conn.db);
    const blank = await student(conn.db, w);
    const ctx = await context(conn.db, blank, w);
    const first = await A.startAttempt(conn.db, ctx);
    const done = await A.submitAttempt(conn.db, ctx, String(first.attempt._id), { answers: {} });
    assert.deepEqual([done.attempt.status, done.attempt.effectsPending], ['submitted', undefined]);
    assert.deepEqual(await lessons(blank), [], 'empty submit');
    assert.equal((await scoresOf(conn.db, blank)).length, 1);
    const second = await A.startAttempt(conn.db, ctx);
    await A.submitAttempt(conn.db, ctx, String(second.attempt._id), { answers: { [QA]: 0 } });
    assert.deepEqual(await lessons(blank), [w.lessonId], 'a non-empty submit, even a wrong answer');

    const timed = await seed(conn.db, { timeLimitMinutes: 1 });
    const idle = await student(conn.db, timed);
    const tctx = await context(conn.db, idle, timed);
    const T = new Date('2026-11-10T10:00:00Z');
    const t = await A.startAttempt(conn.db, tctx, { now: T });
    await A.readAttempt(conn.db, tctx, String(t.attempt._id), { now: new Date(T.getTime() + 600000) });
    assert.equal((await attemptsOf(conn.db, idle))[0].status, 'expired');
    assert.deepEqual(await lessons(idle), [], 'empty timeout');
  });
});

test('real MongoDB: parallel autosaves of different questions all land; dotted paths nest; null clears', { skip }, async () => {
  const conn = await fresh();
  await closing(conn, async () => {
    const w = await seed(conn.db);
    const userId = await student(conn.db, w);
    const ctx = await context(conn.db, userId, w);
    const { attempt } = await A.startAttempt(conn.db, ctx);
    const id = String(attempt._id);
    await Promise.all([
      A.saveAnswer(conn.db, ctx, id, { questionId: QA, answer: 1 }),
      A.saveAnswer(conn.db, ctx, id, { questionId: QB, answer: 2 }),
    ]);
    assert.deepEqual((await attemptsOf(conn.db, userId))[0].answers, { [QA]: 1, [QB]: 2 });
    await A.saveAnswer(conn.db, ctx, id, { questionId: QB, answer: null });
    assert.deepEqual((await attemptsOf(conn.db, userId))[0].answers, { [QA]: 1 });
  });
});

// ---------------------------------------------------------------------------
// Reconciliation with failure injection
// ---------------------------------------------------------------------------

const STEPS = [
  ['quizAttempts.updateOne', 1, 'in_progress'],
  ['quizAttemptCounters.updateOne', 1, 'submitted'],
  ['quizScores.insertOne', 1, 'submitted'],
  ['progress.findOneAndUpdate', 1, 'submitted'],
  ['quizAttempts.updateOne', 2, 'submitted'],
];

for (const [key, nth, statusAfter] of STEPS) {
  test(`real MongoDB: failure at ${key} #${nth}: not reported as done; a retry finishes everything once`, { skip }, async () => {
    const conn = await fresh();
    await closing(conn, async () => {
      const w = await seed(conn.db);
      const userId = await student(conn.db, w);
      const ctx = await context(conn.db, userId, w);
      const { attempt } = await A.startAttempt(conn.db, ctx);
      const id = String(attempt._id);
      await assert.rejects(A.submitAttempt(failing(conn.db, { key, nth }), ctx, id, { answers: RIGHT }), /injected/);
      const [mid] = await attemptsOf(conn.db, userId);
      assert.equal(mid.status, statusAfter);
      assert.equal(mid.effectsPending, statusAfter === 'submitted' ? true : undefined);
      const retried = await A.submitAttempt(conn.db, ctx, id, { answers: RIGHT });
      assert.deepEqual([retried.ok, retried.attempt.status, retried.attempt.result.percent], [true, 'submitted', 100]);
      const [done] = await attemptsOf(conn.db, userId);
      assert.equal(done.effectsPending, undefined);
      assert.equal((await scoresOf(conn.db, userId)).length, 1);
      assert.deepEqual((await conn.db.collection('progress').findOne({ userId })).completedLessons, [w.lessonId]);
      assert.equal((await conn.db.collection('quizAttemptCounters').findOne({ userId })).openAttemptId, null);
    });
  });
}

test('real MongoDB: 25 concurrent reconciles of one interrupted attempt write one score; the sweep finishes abandoned work', { skip }, async () => {
  const conn = await fresh();
  await closing(conn, async () => {
    const w = await seed(conn.db, { timeLimitMinutes: 1 });
    const userId = await student(conn.db, w);
    const ctx = await context(conn.db, userId, w);
    const { attempt } = await A.startAttempt(conn.db, ctx);
    await assert.rejects(A.submitAttempt(failing(conn.db, { key: 'quizScores.insertOne', nth: 1 }), ctx, String(attempt._id), { answers: RIGHT }));
    const [stored] = await attemptsOf(conn.db, userId);
    await Promise.all(Array.from({ length: 25 }, () => A.reconcileAttempt(conn.db, stored)));
    assert.equal((await scoresOf(conn.db, userId)).length, 1);

    const abandoned = await student(conn.db, w);
    const old = new Date(Date.now() - 3600000);
    await A.startAttempt(conn.db, await context(conn.db, abandoned, w), { now: old });
    const pending = await student(conn.db, w);
    const pctx = await context(conn.db, pending, w);
    const p = await A.startAttempt(conn.db, pctx);
    await assert.rejects(A.submitAttempt(failing(conn.db, { key: 'quizScores.insertOne', nth: 1 }), pctx, String(p.attempt._id), { answers: RIGHT }));
    const lines = [];
    const report = await runReconcile(conn.db, { apply: false, log: (l) => lines.push(l) });
    assert.deepEqual([report.attempts.pending, report.attempts.overdue], [1, 1]);
    assert.equal((await scoresOf(conn.db, pending)).length, 0, 'the report wrote nothing');
    const applied = await runReconcile(conn.db, { apply: true, log: () => {} });
    assert.deepEqual([applied.ok, applied.attempts.reconciled, applied.attempts.expired], [true, 1, 1]);
    assert.equal((await scoresOf(conn.db, pending)).length, 1);
    assert.equal((await attemptsOf(conn.db, abandoned))[0].status, 'expired');
  });
});

// ---------------------------------------------------------------------------
// Indexes
// ---------------------------------------------------------------------------

test('real MongoDB: the index script is read-only without --apply, builds A1-A6 with it, and is idempotent', { skip }, async () => {
  const conn = await fresh({ indexes: false });
  await closing(conn, async () => {
    await conn.db.collection('quizScores').insertMany([
      { userId: 'old1', lessonId: 'l', score: 50 },
      { userId: 'old2', lessonId: 'l', score: 60 },
    ]);
    const log = [];
    const report = await runIndexScript(conn.db, { apply: false, log: (l) => log.push(l) });
    assert.equal(report.built.length, 0);
    const names = (await conn.db.collection('quizScores').indexes()).map((i) => i.name);
    assert.deepEqual(names, ['_id_'], 'the report built nothing');
    assert.deepEqual((await conn.db.listCollections().toArray()).map((c) => c.name), ['quizScores'], 'and created no collection');
    assert.ok(log.some((l) => /A5 quizScores quiz_score_attempt: missing/.test(l)));

    const applied = await runIndexScript(conn.db, { apply: true, log: () => {} });
    assert.deepEqual([applied.ok, applied.built], [true, ['A1', 'A2', 'A3', 'A4', 'A5', 'A6']], 'rows from before Phase 9 do not block A5');
    const again = await runIndexScript(conn.db, { apply: true, log: () => {} });
    assert.deepEqual([again.ok, again.built], [true, []]);
    assert.ok((await assessmentIndexReport(conn.db)).every((r) => r.state === 'present'));
    const a5 = (await conn.db.collection('quizScores').indexes()).find((i) => i.name === 'quiz_score_attempt');
    assert.deepEqual([a5.unique, a5.partialFilterExpression], [true, { attemptId: { $type: 'string' } }]);
  });
});

test('real MongoDB: duplicates block the build of A1, A2, A4 and A5, nothing is built, nothing is touched', { skip }, async () => {
  for (const [id, collection, rows] of [
    ['A1', 'quizAttempts', [{ userId: 'u', lessonId: 'l', number: 1 }, { userId: 'u', lessonId: 'l', number: 1 }]],
    ['A2', 'assignmentSubmissions', [{ userId: 'u', assignmentId: 'a' }, { userId: 'u', assignmentId: 'a' }]],
    ['A4', 'quizzes', [{ lessonId: 'l' }, { lessonId: 'l' }]],
    ['A5', 'quizScores', [{ attemptId: 'x' }, { attemptId: 'x' }]],
  ]) {
    const conn = await fresh({ indexes: false });
    await closing(conn, async () => {
      await conn.db.collection(collection).insertMany(rows);
      const result = await ensureAssessmentIndexes(conn.db, { apply: true });
      assert.deepEqual([result.ok, result.built, result.blocked], [false, [], [id]], id);
      assert.equal(await conn.db.collection(collection).countDocuments({}), 2, `${id}: nothing was deleted`);
      assert.equal((await conn.db.collection(collection).indexes()).length, 1, `${id}: nothing was built`);
      const row = (await assessmentIndexReport(conn.db)).find((r) => r.id === id);
      assert.equal(row.duplicates, 1);
    });
  }
});

test('real MongoDB: a conflicting existing index is reported and refused, never replaced', { skip }, async () => {
  const conn = await fresh({ indexes: false });
  await closing(conn, async () => {
    await conn.db.collection('quizScores').createIndex({ attemptId: 1 }, { name: 'quiz_score_attempt', unique: true, sparse: true });
    const result = await ensureAssessmentIndexes(conn.db, { apply: true });
    assert.deepEqual([result.ok, result.blocked], [false, ['A5']]);
    assert.equal((await conn.db.collection('quizScores').indexes()).find((i) => i.name === 'quiz_score_attempt').sparse, true);
  });
});

test('real MongoDB: unique indexes reject duplicates; rows without an attemptId coexist', { skip }, async () => {
  const conn = await fresh();
  await closing(conn, async () => {
    const dup = async (name, doc) => {
      await conn.db.collection(name).insertOne({ ...doc });
      await assert.rejects(conn.db.collection(name).insertOne({ ...doc }), (e) => e.code === 11000, name);
    };
    await dup('quizAttempts', { userId: 'u', lessonId: 'l', number: 1 });
    await dup('assignmentSubmissions', { userId: 'u', assignmentId: 'a' });
    await dup('quizzes', { lessonId: 'l' });
    await dup('quizScores', { attemptId: 'x' });
    await conn.db.collection('quizScores').insertMany([{ userId: 'u', score: 1 }, { userId: 'u', score: 2 }]);
    assert.equal(await conn.db.collection('quizScores').countDocuments({ userId: 'u' }), 2);
  });
});

test('real MongoDB: the staff queue, student history and attempt lookups use their indexes', { skip }, async () => {
  const conn = await fresh();
  await closing(conn, async () => {
    const planOf = async (cursor) => JSON.stringify((await cursor.explain('queryPlanner')).queryPlanner.winningPlan);
    await conn.db.collection('quizAttempts').insertMany(Array.from({ length: 50 }, (_, i) => ({ userId: `u${i}`, lessonId: 'l', number: 1, status: 'submitted', submittedAt: new Date(2026, 0, 1, 0, i) })));
    await conn.db.collection('quizScores').insertMany(Array.from({ length: 50 }, (_, i) => ({ userId: 'u', score: i, createdAt: new Date(2026, 0, 1 + i) })));
    assert.match(await planOf(conn.db.collection('quizAttempts').find({ lessonId: 'l', status: { $in: ['submitted', 'expired'] } }).sort({ submittedAt: -1, _id: -1 }).limit(50)), /quiz_attempt_lesson_results/);
    assert.match(await planOf(conn.db.collection('quizScores').find({ userId: 'u' }).sort({ createdAt: -1, _id: -1 }).limit(50)), /quiz_score_user_recent/);
    assert.match(await planOf(conn.db.collection('quizAttempts').find({ userId: 'u1', lessonId: 'l' }).sort({ number: 1 })), /quiz_attempt_user_lesson_number/);
  });
});

// ---------------------------------------------------------------------------
// Results and leaderboard
// ---------------------------------------------------------------------------

test('real MongoDB: staff results page beyond 200 and the summary is computed over all attempts', { skip }, async () => {
  const conn = await fresh();
  await closing(conn, async () => {
    const w = await seed(conn.db);
    const rows = Array.from({ length: 230 }, (_, i) => ({ _id: new ObjectId(), userId: `user${i % 100}`, lessonId: w.lessonId, number: Math.floor(i / 100) + 1, status: i % 2 ? 'submitted' : 'expired', submittedAt: new Date(2026, 0, 1, 0, i), questions: QUESTIONS, answers: { [QA]: 1 }, result: { percent: i % 2 ? 80 : 40, passed: Boolean(i % 2) } }));
    rows.push({ _id: new ObjectId(), userId: 'open', lessonId: w.lessonId, number: 1, status: 'in_progress', deadlineAt: null, answers: {} });
    await conn.db.collection('quizAttempts').insertMany(rows);
    const ctx = await A.loadQuizContext(conn.db, { userId: w.instructor, lessonId: w.lessonId });
    const seen = new Set();
    let last = Infinity;
    for (let page = 1; page <= 5; page += 1) {
      const res = await A.quizResults(conn.db, ctx, { page, limit: 50 });
      assert.deepEqual([res.pagination.total, res.pagination.pages], [230, 5]);
      assert.deepEqual([res.summary.attempts, res.summary.students, res.summary.passed, res.summary.averagePercent], [230, 100, 115, 60]);
      for (const row of res.attempts) {
        seen.add(row.attemptId);
        const time = new Date(row.submittedAt).getTime();
        assert.ok(time <= last, 'newest first across pages');
        last = time;
        assert.equal('questions' in row, false);
      }
    }
    assert.equal(seen.size, 230);
    const empty = await A.loadQuizContext(conn.db, { userId: w.instructor, lessonId: w.lessonId });
    await conn.db.collection('quizAttempts').deleteMany({});
    const none = await A.quizResults(conn.db, empty, {});
    assert.deepEqual([none.attempts.length, none.summary.attempts, none.summary.averagePercent, none.pagination.pages], [0, 0, null, 0]);
  });
});

test('real MongoDB: history reads old and new rows newest first, in pages, without answers', { skip }, async () => {
  const conn = await fresh();
  await closing(conn, async () => {
    const w = await seed(conn.db);
    const userId = await student(conn.db, w);
    const ctx = await context(conn.db, userId, w);
    const { attempt } = await A.startAttempt(conn.db, ctx);
    await A.submitAttempt(conn.db, ctx, String(attempt._id), { answers: RIGHT });
    await conn.db.collection('quizScores').insertOne({ userId, lessonId: w.lessonId, courseId: w.courseId, score: 40, answers: [1, 0], createdAt: new Date('2026-01-01') });
    const res = await A.assessmentHistory(conn.db, { userId, limit: 1, page: 2 });
    assert.deepEqual([res.results.length, res.results[0].percent, res.pagination.total], [1, 40, 2]);
    assert.equal(res.results[0].lessonTitle, 'Lesson');
    assert.equal(JSON.stringify(res).includes('answers'), false);
  });
});

test('real MongoDB: a student context never loads the answer key from the server', { skip }, async () => {
  const conn = await fresh();
  await closing(conn, async () => {
    const w = await seed(conn.db);
    const userId = await student(conn.db, w);
    const ctx = await A.loadQuizContext(conn.db, { userId, lessonId: w.lessonId });
    const text = JSON.stringify(ctx.quiz);
    assert.equal(text.includes('correctAnswer'), false);
    assert.equal(text.includes('SECRET-EXPLANATION'), false);
    assert.equal(ctx.quiz.questions.length, 2, 'the count and points are still there');
    assert.equal((await context(conn.db, userId, w)).quiz.questions[0].correctAnswer, 1, 'only the start path has it');
  });
});

test('real MongoDB: the quiz leaderboard averages every recorded result, one per attempt, through the real route', { skip }, async () => {
  const conn = await fresh();
  await closing(conn, async () => {
    await withRouteEnv(async () => {
      const w = await seed(conn.db);
      const [a, b, c, d] = [await student(conn.db, w), await student(conn.db, w), await student(conn.db, w), await student(conn.db, w)];
      for (const [userId, runs] of [[a, [RIGHT, { [QA]: 1 }]], [b, [{ [QB]: 0 }]], [c, [RIGHT, {}]], [d, [RIGHT]]]) {
        const ctx = await context(conn.db, userId, w);
        for (const answers of runs) {
          const { attempt } = await A.startAttempt(conn.db, ctx);
          await A.submitAttempt(conn.db, ctx, String(attempt._id), { answers });
          await A.submitAttempt(conn.db, ctx, String(attempt._id), { answers }); // A repeat changes nothing.
        }
      }
      // A timed-out attempt is a finished attempt: d runs out of time on a second try.
      const dctx = await context(conn.db, d, w);
      const late = await A.startAttempt(conn.db, dctx);
      await conn.db.collection('quizAttempts').updateOne({ _id: late.attempt._id }, { $set: { deadlineAt: new Date(Date.now() - 60000) } });
      await A.readAttempt(conn.db, dctx, String(late.attempt._id));
      const handler = loadModule('pages/api/leaderboard/index.ts', { 'lib/mongodb': { getDb: async () => conn.db } }).default;
      const res = await callRoute(handler, { token: await sessionFor(conn.db, a), query: { type: 'quizzes' } });
      assert.equal(res.statusCode, 200);
      const rows = Object.fromEntries((res.body.rankings || res.body.leaderboard || res.body).map((r) => [r.userId, r]));
      assert.deepEqual([rows[a].avgScore, rows[a].totalQuizzes], [63, 2], '(100 + 25) / 2, rounded for display');
      assert.equal(rows[a].name, `S${a.slice(-4)}`, 'the row names the student, not "Unknown"');
      assert.deepEqual([rows[b].avgScore, rows[b].totalQuizzes], [75, 1]);
      assert.deepEqual([rows[c].avgScore, rows[c].totalQuizzes], [50, 2], 'a lower retake lowers the average');
      assert.deepEqual([rows[d].avgScore, rows[d].totalQuizzes], [50, 2], 'a timed-out attempt counts');
    });
  });
});

test('real MongoDB: only attempts in a final scored state count; abandoned and interrupted ones join once reconciled, exactly once', { skip }, async () => {
  const conn = await fresh();
  await closing(conn, async () => {
    await withRouteEnv(async () => {
      const w = await seed(conn.db, { timeLimitMinutes: 5 });
      const handler = loadModule('pages/api/leaderboard/index.ts', { 'lib/mongodb': { getDb: async () => conn.db } }).default;
      const [open, abandoned, interrupted, viewer] = [await student(conn.db, w), await student(conn.db, w), await student(conn.db, w), await student(conn.db, w)];
      const token = await sessionFor(conn.db, viewer);
      const board = async () => Object.fromEntries((await callRoute(handler, { token, query: { type: 'quizzes' } })).body.map((r) => [r.userId, r]));

      // Still running, with an answer saved.
      const octx = await context(conn.db, open, w);
      const o = await A.startAttempt(conn.db, octx);
      await A.saveAnswer(conn.db, octx, String(o.attempt._id), { questionId: QA, answer: 1 });
      // Time ran out and nothing has settled it yet.
      const actx = await context(conn.db, abandoned, w);
      const a = await A.startAttempt(conn.db, actx, { now: new Date(Date.now() - 3600000) });
      await A.saveAnswer(conn.db, actx, String(a.attempt._id), { questionId: QA, answer: 1 }, { now: new Date(Date.now() - 3590000) });
      // Submitted, but the score write failed: final on the attempt, no scored result yet.
      const ictx = await context(conn.db, interrupted, w);
      const i = await A.startAttempt(conn.db, ictx);
      await assert.rejects(A.submitAttempt(failing(conn.db, { key: 'quizScores.insertOne', nth: 1 }), ictx, String(i.attempt._id), { answers: RIGHT }));

      assert.deepEqual(Object.keys(await board()), [], 'none of the three counts yet');

      const swept = await runReconcile(conn.db, { apply: true, log: () => {} });
      assert.deepEqual([swept.attempts.reconciled, swept.attempts.expired], [1, 1]);
      await runReconcile(conn.db, { apply: true, log: () => {} }); // A second sweep changes nothing.
      const after = await board();
      assert.deepEqual([after[abandoned].avgScore, after[abandoned].totalQuizzes], [25, 1], 'timed out, finalized and scored on its saved answer');
      assert.deepEqual([after[interrupted].avgScore, after[interrupted].totalQuizzes], [100, 1], 'interrupted, then reconciled');
      assert.equal(after[open], undefined, 'still in progress');
    });
  });
});

test('real MongoDB: the Completions tab names students, for certificates issued by the real route and older ObjectId rows', { skip }, async () => {
  const conn = await fresh();
  await closing(conn, async () => {
    await withRouteEnv(async () => {
      const w = await seed(conn.db);
      const earner = await student(conn.db, w);
      await conn.db.collection('progress').updateOne({ userId: earner }, { $set: { completedLessons: [w.lessonId], progress: 100 } });
      const stubs = { 'lib/mongodb': { getDb: async () => conn.db } };
      const issue = loadModule('pages/api/certificates/index.ts', stubs).default;
      const token = await sessionFor(conn.db, earner);
      const issued = await callRoute(issue, { method: 'POST', token, body: { courseId: w.courseId } });
      assert.equal(issued.statusCode, 201, JSON.stringify(issued.body));
      assert.equal(typeof (await conn.db.collection('certificates').findOne({ userId: earner })).userId, 'string');
      const older = await student(conn.db, w);
      await conn.db.collection('certificates').insertOne({ userId: new ObjectId(older), courseId: w.courseId, certificateId: 'CERT-OLD' });
      const handler = loadModule('pages/api/leaderboard/index.ts', stubs).default;
      const res = await callRoute(handler, { token, query: { type: 'completions' } });
      assert.equal(res.statusCode, 200);
      const rows = Object.fromEntries(res.body.map((r) => [r.userId, r]));
      assert.deepEqual([rows[earner].name, rows[earner].completions], [`S${earner.slice(-4)}`, 1], 'stored as a string');
      assert.deepEqual([rows[older].name, rows[older].completions], [`S${older.slice(-4)}`, 1], 'stored as an ObjectId');
    });
  });
});

// ---------------------------------------------------------------------------
// Assignments
// ---------------------------------------------------------------------------

async function assignmentWorld(db) {
  const w = await seed(db);
  const assignmentId = newId();
  await db.collection('assignments').insertOne({ _id: new ObjectId(assignmentId), courseId: w.courseId, lessonId: w.lessonId, title: 'Journal', instructions: 'Write', points: 50 });
  const stubs = { 'lib/mongodb': { getDb: async () => db }, 'lib/notifications': { createNotification: async () => 'n' }, 'lib/socket-server': { getSocketServer: () => null } };
  const r = {
    grade: loadModule('pages/api/assignments/[id]/grade.ts', stubs).default,
    submit: loadModule('pages/api/assignments/[id]/submit.ts', stubs).default,
  };
  const userId = await student(db, w);
  const T = { student: await sessionFor(db, userId), instructor: await sessionFor(db, w.instructor) };
  const points = async () => (await db.collection('users').findOne({ _id: new ObjectId(userId) })).points;
  const submit = (text = 'work') => callRoute(r.submit, { method: 'POST', token: T.student, body: { submissionText: text }, query: { id: assignmentId } });
  const grade = (submissionId, value) => callRoute(r.grade, { method: 'POST', token: T.instructor, body: { submissionId, grade: value, feedback: 'f' }, query: { id: assignmentId } });
  const row = () => db.collection('assignmentSubmissions').findOne({ userId });
  return { w, userId, points, submit, grade, row };
}

test('real MongoDB: parallel first submissions: one row (A2), one award', { skip }, async () => {
  const conn = await fresh();
  await closing(conn, async () => {
    await withRouteEnv(async () => {
      const x = await assignmentWorld(conn.db);
      const results = await Promise.all(Array.from({ length: 15 }, () => x.submit('same')));
      assert.ok(results.every((r) => r.statusCode === 200), results.map((r) => r.statusCode).join());
      assert.equal(await conn.db.collection('assignmentSubmissions').countDocuments({ userId: x.userId }), 1);
      assert.equal(await x.points(), 50);
    });
  });
});

test('real MongoDB: concurrent grading: the stored points always equal what history says was awarded', { skip }, async () => {
  const conn = await fresh();
  await closing(conn, async () => {
    await withRouteEnv(async () => {
      const x = await assignmentWorld(conn.db);
      await x.submit();
      const id = String((await x.row())._id);
      const statuses = (await Promise.all([20, 40, 60, 80, 100, 90, 70, 50].map((g) => x.grade(id, g)))).map((r) => r.statusCode);
      assert.ok(statuses.every((s) => s === 200 || s === 409), statuses.join());
      assert.ok(statuses.includes(200));
      const row = await x.row();
      assert.equal(row.gradeHistory.length, statuses.filter((s) => s === 200).length);
      assert.equal(row.gradeHistory[row.gradeHistory.length - 1].grade, row.grade);
      assert.equal(await x.points(), 50 + row.pointsAwarded);
      assert.equal(row.pointsPending, undefined);
    });
  });
});

test('real MongoDB: regrade and resubmission move only the difference; the record survives', { skip }, async () => {
  const conn = await fresh();
  await closing(conn, async () => {
    await withRouteEnv(async () => {
      const x = await assignmentWorld(conn.db);
      await x.submit('v1');
      const id = String((await x.row())._id);
      await x.grade(id, 80);
      assert.equal(await x.points(), 90);
      await x.submit('v2');
      assert.equal(await x.points(), 90);
      await x.grade(id, 100);
      assert.equal(await x.points(), 100);
      await x.grade(id, 40);
      assert.equal(await x.points(), 70);
      const row = await x.row();
      assert.deepEqual(row.gradeHistory.map((h) => h.grade), [80, 100, 40]);
      assert.deepEqual([row.previousVersions.length, row.previousVersions[0].grade], [1, 80]);
    });
  });
});

test('real MongoDB: an interrupted award applies exactly once across 20 concurrent retries', { skip }, async () => {
  const conn = await fresh();
  await closing(conn, async () => {
    await withRouteEnv(async () => {
      const x = await assignmentWorld(conn.db);
      await x.submit();
      const row = await x.row();
      // Stored as the grade route stores it, with the points not yet moved.
      await conn.db.collection('assignmentSubmissions').updateOne({ _id: row._id }, { $set: { grade: 80, status: 'graded', pointsAwarded: 40, gradeVersion: 1, pointsPending: { key: `${row._id}:grade:1`, delta: 40 } } });
      const pending = await x.row();
      await Promise.all(Array.from({ length: 20 }, () => G.settlePendingPoints(conn.db, pending)));
      assert.equal(await x.points(), 90);
      assert.equal((await x.row()).pointsPending, undefined);
      // The crash window: points moved, record not cleared. The key on the user stops a repeat.
      await conn.db.collection('assignmentSubmissions').updateOne({ _id: row._id }, { $set: { pointsPending: { key: 'k2', delta: 5 } } });
      await assert.rejects(G.settlePendingPoints(failing(conn.db, { key: 'assignmentSubmissions.updateOne', nth: 1 }), await x.row()));
      assert.equal(await x.points(), 95);
      await G.settlePendingPoints(conn.db, await x.row());
      assert.equal(await x.points(), 95, 'not 100');
      const user = await conn.db.collection('users').findOne({ _id: new ObjectId(x.userId) });
      assert.deepEqual(user.pointAwardKeys, []);
    });
  });
});

test('definitions: every index in the plan has a name and the unique ones a duplicate check', { skip }, () => {
  assert.equal(ASSESSMENT_INDEXES.length, 6);
});
