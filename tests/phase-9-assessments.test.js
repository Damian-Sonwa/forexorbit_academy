/**
 * Phase 9: quizzes, assessments and grading (docs/audits/phase-9-assessments.md).
 *
 * The real route handlers (cookie sessions, CSRF and exact Origin through withAuth) and libraries
 * run against an in-memory database with the real unique indexes (tests/helpers/payment-memory-db.js).
 * That is not real-MongoDB coverage: concurrency on a real server, index builds, aggregation and the
 * leaderboard are in tests/integration/assessments-phase9-mongo.test.js.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ObjectId } = require('mongodb');

const payment = require('../lib/course-payment');
const Q = require('../lib/quiz-assessment');
const A = require('../lib/quiz-attempts');
const G = require('../lib/assignment-grading');
const { ASSESSMENT_INDEXES, compareAssessmentIndex } = require('../lib/assessment-indexes');
const { presentEnrollmentProgress } = require('../lib/enrollment-state');
const reconcileScript = require('../scripts/quiz-attempt-reconcile');
const { matches, paymentMemoryDb } = require('./helpers/payment-memory-db');
const { loadModule, mockResponse } = require('./helpers/ts-loader');
const { requestHeaders, seedSession } = require('./helpers/session-cookie');

const ROOT = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const ROUTE_ENV = { NODE_ENV: 'test', PAYSTACK_SECRET_KEY: 'sk_test_phase9_unit_only', MONGODB_DB_NAME: 'forexorbit_p9_test', MONGO_URI: 'mongodb://127.0.0.1:27017', APP_ORIGIN: undefined, PORT: undefined, SHARED_RATE_LIMIT: undefined };
const newId = () => new ObjectId().toHexString();
const T0 = new Date('2026-11-10T10:00:00Z');
const after = (seconds, from = T0) => new Date(from.getTime() + seconds * 1000);
const [QA, QB, QC] = ['aaaaaaaaaaaa', 'bbbbbbbbbbbb', 'cccccccccccc'];
const QUESTIONS = [
  { id: QA, question: 'Pip?', options: ['No', 'Yes'], correctAnswer: 1, points: 1, explanation: 'EXPLAIN-A' },
  { id: QB, question: 'Spread?', options: ['Yes', 'No', 'Maybe'], correctAnswer: 0, points: 1, explanation: 'EXPLAIN-B' },
  { id: QC, question: 'Lot?', options: ['A', 'B', 'C', 'D'], correctAnswer: 2, points: 2, explanation: 'EXPLAIN-C' },
];
const ALL_RIGHT = { [QA]: 1, [QB]: 0, [QC]: 2 };

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

/** The two aggregations the staff results need, computed from the rows (real server: integration test). */
function withResultsAggregate(db) {
  db.collection('quizAttempts').aggregate = (pipeline) => ({
    toArray: async () => {
      const rows = db.rows('quizAttempts').filter((row) => matches(row, pipeline[0].$match));
      if (!rows.length) return [];
      return [{
        attempts: rows.length,
        students: new Set(rows.map((r) => r.userId)).size,
        averagePercent: rows.reduce((sum, r) => sum + r.result.percent, 0) / rows.length,
        passed: rows.filter((r) => r.result.passed === true).length,
      }];
    },
  });
  return db;
}

function newDb({ racy = false } = {}) {
  return withResultsAggregate(paymentMemoryDb({ uniqueIndexes: ASSESSMENT_INDEXES, racy }));
}

function account(db, userId, role, extra = {}) {
  db.rows('users').push({ _id: new ObjectId(userId), email: `${role}-${userId.slice(-6)}@example.test`, name: `${role} ${userId.slice(-4)}`, role, status: 'approved', sessionGeneration: 0, points: 0, ...extra });
}

function putQuiz(db, lessonId, courseId, settings, extra = {}) {
  const rows = db.rows('quizzes');
  const at = rows.findIndex((q) => q.lessonId === lessonId);
  if (at >= 0) rows.splice(at, 1);
  rows.push({ _id: new ObjectId(), lessonId, courseId, questions: JSON.parse(JSON.stringify(QUESTIONS)), version: 1, ...(settings === undefined ? {} : { settings }), ...extra });
}

const SETTINGS = { status: 'published', maxAttempts: null, timeLimitMinutes: null, passingPercent: null, reviewPolicy: 'after_submission', shuffleQuestions: false, shuffleOptions: false, availableFrom: null, availableUntil: null };

/** Course C (published): l1 free preview, l2 paid, l3 paid. Course D: another instructor's. */
function world({ racy = false, settings = SETTINGS, withNotifications } = {}) {
  const db = newDb({ racy });
  const w = { student: newId(), other: newId(), outsider: newId(), unpaid: newId(), instructor: newId(), rival: newId(), admin: newId(), C: newId(), D: newId(), l1: newId(), l2: newId(), l3: newId(), d1: newId() };
  const course = (id, instructorId, title) => db.rows('courses').push({ _id: new ObjectId(id), title, status: 'published', instructorId, difficulty: 'beginner', freePreviewExplicit: true });
  course(w.C, w.instructor, 'Price Action');
  course(w.D, w.rival, 'Risk');
  const lesson = (id, courseId, order, flags = {}) => db.rows('lessons').push({ _id: new ObjectId(id), courseId, order, title: `Lesson ${order}`, type: 'text', content: '<p>x</p>', ...flags });
  lesson(w.l1, w.C, 1, { isFreePreview: true });
  lesson(w.l2, w.C, 2);
  lesson(w.l3, w.C, 3);
  lesson(w.d1, w.D, 1, { isFreePreview: true });
  for (const key of ['student', 'other', 'outsider', 'unpaid']) account(db, w[key], 'student');
  account(db, w.instructor, 'instructor');
  account(db, w.rival, 'instructor');
  account(db, w.admin, 'admin');
  const enroll = (userId) => db.rows('progress').push({ _id: new ObjectId(), userId, courseId: w.C, progress: 0, completedLessons: [], active: true, createdAt: T0 });
  const entitle = (userId) => db.rows(payment.COLLECTIONS.courseAccess).push({ _id: new ObjectId(), userId, courseId: w.C, paid: true, entitlementType: 'paid_course', unlockedAt: T0 });
  enroll(w.student); entitle(w.student);
  enroll(w.other); entitle(w.other);
  enroll(w.unpaid);
  putQuiz(db, w.l2, w.C, settings);
  const notifications = [];
  const stubs = {
    'lib/mongodb': { getDb: async () => db },
    'lib/socket-server': { getSocketServer: () => null },
    'lib/notifications': { createNotification: withNotifications || (async (n) => { notifications.push(n); return 'n1'; }) },
  };
  const r = {
    quiz: loadModule('pages/api/quizzes/[lessonId].ts', stubs).default,
    attempts: loadModule('pages/api/quizzes/[lessonId]/attempts/index.ts', stubs).default,
    attempt: loadModule('pages/api/quizzes/[lessonId]/attempts/[attemptId].ts', stubs).default,
    history: loadModule('pages/api/quizzes/history.ts', stubs).default,
    lesson: loadModule('pages/api/lessons/[id].ts', stubs).default,
    grade: loadModule('pages/api/assignments/[id]/grade.ts', stubs).default,
    submit: loadModule('pages/api/assignments/[id]/submit.ts', stubs).default,
    assignments: loadModule('pages/api/assignments/index.ts', stubs).default,
  };
  const T = {};
  for (const key of ['student', 'other', 'outsider', 'unpaid', 'instructor', 'rival', 'admin']) T[key] = seedSession(db.rows('sessions'), { userId: w[key], generation: 0, now: new Date() });
  return { db, w, r, T, notifications };
}

async function call(handler, { method = 'GET', token, body, query = {}, headers } = {}) {
  const res = mockResponse();
  await handler({ method, url: '/api/test', headers: headers || requestHeaders(token), body, query, socket: { remoteAddress: '10.0.0.9' } }, res);
  return res;
}

const startReq = (x, token, lessonId = x.w.l2) => call(x.r.attempts, { method: 'POST', token, query: { lessonId } });
const attemptReq = (x, method, token, attemptId, body, lessonId = x.w.l2) => call(x.r.attempt, { method, token, body, query: { lessonId, attemptId } });
const ctxOf = (x, key = 'student', lessonId = x.w.l2) => A.loadQuizContext(x.db, { userId: x.w[key], lessonId, withAnswerKey: true });
const enrollmentOf = (x, key = 'student') => x.db.rows('progress').find((p) => p.userId === x.w[key]);
const scoresOf = (x, key = 'student') => x.db.rows('quizScores').filter((s) => s.userId === x.w[key]);

/** Replaces one collection method so its Nth call (1-based) fails, then behaves normally. */
function failCall(db, name, method, nth = 1) {
  const col = db.collection(name);
  const original = col[method].bind(col);
  let calls = 0;
  col[method] = async (...args) => {
    calls += 1;
    if (calls === nth) throw new Error(`injected failure: ${name}.${method} #${nth}`);
    return original(...args);
  };
  return () => { col[method] = original; };
}

const route = (fn) => () => withEnv(ROUTE_ENV, fn);

// ---------------------------------------------------------------------------
// Question and assessment management
// ---------------------------------------------------------------------------

test('questions: malformed, incomplete or contradictory questions are refused by the server', () => {
  const good = { question: 'Q', options: ['a', 'b'], correctAnswer: 0 };
  const cases = [
    [[], 'no questions'],
    ['nope', 'not a list'],
    [Array.from({ length: 101 }, () => good), 'too many questions'],
    [[null], 'null item'],
    [[{ ...good, question: '   ' }], 'blank text'],
    [[{ ...good, question: 'x'.repeat(2001) }], 'text too long'],
    [[{ ...good, options: ['only'] }], 'one option'],
    [[{ ...good, options: Array.from({ length: 9 }, (_, i) => `o${i}`) }], 'nine options'],
    [[{ ...good, options: ['a', ' '] }], 'blank option'],
    [[{ ...good, options: ['Same', ' same '] }], 'same option twice'],
    [[{ ...good, options: ['a', 1] }], 'option not text'],
    [[{ ...good, correctAnswer: 2 }], 'answer out of range'],
    [[{ ...good, correctAnswer: -1 }], 'negative answer'],
    [[{ ...good, correctAnswer: '0' }], 'answer as text'],
    [[{ ...good, correctAnswer: [0, 1] }], 'two correct answers: single-answer questions only'],
    [[{ ...good, correctAnswer: undefined }], 'no correct answer'],
    [[{ ...good, points: 0 }], 'zero points'],
    [[{ ...good, points: 101 }], 'too many points'],
    [[{ ...good, points: 1.5 }], 'fractional points'],
    [[{ ...good, explanation: 'x'.repeat(2001) }], 'explanation too long'],
  ];
  for (const [input, label] of cases) {
    const result = Q.normalizeQuestions(input);
    assert.equal(result.ok, false, label);
    assert.equal(result.status, 400, label);
  }
});

test('questions: the supported type is single-answer multiple choice; ids stay stable across edits', () => {
  const trueFalse = Q.normalizeQuestions([{ question: 'True?', options: ['True', 'False'], correctAnswer: 1 }]);
  assert.equal(trueFalse.ok, true);
  assert.deepEqual([trueFalse.questions[0].points, trueFalse.questions[0].explanation], [1, '']);
  assert.match(trueFalse.questions[0].id, /^[a-f0-9]{12}$/);
  const edited = Q.normalizeQuestions([{ id: QA, question: 'New', options: ['a', 'b'], correctAnswer: 0 }, { id: QA, question: 'Copy', options: ['a', 'b'], correctAnswer: 0 }, { id: 'bad id', question: 'X', options: ['a', 'b'], correctAnswer: 0 }]);
  assert.equal(edited.questions[0].id, QA, 'kept');
  assert.notEqual(edited.questions[1].id, QA, 'a repeated id gets a new one');
  assert.match(edited.questions[2].id, /^[a-f0-9]{12}$/);
  assert.equal(new Set(edited.questions.map((q) => q.id)).size, 3);
});

test('settings: every value is validated; omitted values keep what is stored', () => {
  const bad = [
    'nope', [], { status: 'live' }, { maxAttempts: 0 }, { maxAttempts: 21 }, { maxAttempts: 1.5 }, { maxAttempts: '3' },
    { timeLimitMinutes: 0 }, { timeLimitMinutes: 301 }, { passingPercent: -1 }, { passingPercent: 101 }, { passingPercent: 50.5 },
    { reviewPolicy: 'always' }, { shuffleQuestions: 'yes' }, { availableFrom: 'not a date' },
    { availableFrom: '2026-12-02T00:00:00Z', availableUntil: '2026-12-01T00:00:00Z' },
  ];
  for (const input of bad) assert.equal(Q.normalizeSettings(input).ok, false, JSON.stringify(input));
  const merged = Q.normalizeSettings({ maxAttempts: 2 }, { ...SETTINGS, passingPercent: 70, status: 'draft' });
  assert.deepEqual([merged.settings.maxAttempts, merged.settings.passingPercent, merged.settings.status], [2, 70, 'draft']);
  assert.equal(Q.normalizeSettings({ maxAttempts: null, timeLimitMinutes: null, passingPercent: null }).ok, true, 'null means none');
});

test('correct answers: the student quiz read has no questions, no key, no explanations', route(async () => {
  const x = world();
  const res = await call(x.r.quiz, { token: x.T.student, query: { lessonId: x.w.l2 } });
  assert.equal(res.statusCode, 200);
  const text = JSON.stringify(res.body);
  for (const secret of ['correctAnswer', 'EXPLAIN', 'Pip?', '"questions"']) assert.equal(text.includes(secret), false, secret);
  assert.deepEqual([res.body.quiz.questionCount, res.body.quiz.totalPoints], [3, 4]);
  assert.match(res.headers['cache-control'], /no-store/);
}));

test('correct answers: reads that do not start an attempt never load the key, even on the server', route(async () => {
  const x = world();
  const seen = [];
  const col = x.db.collection('quizzes');
  const original = col.findOne.bind(col);
  col.findOne = (filter, options) => { seen.push(options); return original(filter, options); };
  await call(x.r.quiz, { token: x.T.student, query: { lessonId: x.w.l2 } });
  assert.deepEqual(seen[0].projection, { 'questions.correctAnswer': 0, 'questions.explanation': 0 });
}));

test('correct answers: an attempt in progress carries the questions, never the key', route(async () => {
  const x = world();
  const res = await startReq(x, x.T.student);
  assert.equal(res.statusCode, 201);
  const text = JSON.stringify(res.body);
  assert.equal(res.body.attempt.questions.length, 3);
  for (const secret of ['correctAnswer', '"correct"', 'EXPLAIN', 'review']) assert.equal(text.includes(secret), false, secret);
  const again = await attemptReq(x, 'GET', x.T.student, res.body.attempt.id);
  assert.equal(JSON.stringify(again.body).includes('correct'), false);
}));

test('publication: a draft does not exist for students through any route; staff still see it', route(async () => {
  const x = world({ settings: { ...SETTINGS, status: 'draft' } });
  assert.equal((await call(x.r.quiz, { token: x.T.student, query: { lessonId: x.w.l2 } })).statusCode, 404);
  assert.equal((await startReq(x, x.T.student)).statusCode, 404);
  assert.equal((await call(x.r.attempts, { token: x.T.student, query: { lessonId: x.w.l2 } })).statusCode, 404);
  assert.equal((await call(x.r.quiz, { method: 'POST', token: x.T.student, body: { answers: [1, 0, 2] }, query: { lessonId: x.w.l2 } })).statusCode, 404);
  assert.equal(x.db.rows('quizAttempts').length, 0);
  const staff = await call(x.r.quiz, { token: x.T.instructor, query: { lessonId: x.w.l2 } });
  assert.deepEqual([staff.statusCode, staff.body.questions[0].correctAnswer, staff.body.settings.status], [200, 1, 'draft']);
}));

test('publication: instructors author on draft courses; a published course is admin-only (the Phase 4 rule stands)', route(async () => {
  const x = world();
  const body = { questions: [{ question: 'New?', options: ['a', 'b'], correctAnswer: 1 }], settings: { status: 'published' } };
  const locked = await call(x.r.quiz, { method: 'PUT', token: x.T.instructor, body, query: { lessonId: x.w.l2 } });
  assert.equal(locked.statusCode, 409);
  assert.equal(x.db.rows('quizzes')[0].version, 1);
  x.db.rows('courses').find((c) => String(c._id) === x.w.C).status = 'draft';
  const saved = await call(x.r.quiz, { method: 'PUT', token: x.T.instructor, body, query: { lessonId: x.w.l2 } });
  assert.deepEqual([saved.statusCode, saved.body.version], [200, 2]);
}));

test('publication: quizzes are created, edited, published and unpublished through the server, each save a version', route(async () => {
  const x = world();
  const body = { questions: [{ question: 'New?', options: ['a', 'b'], correctAnswer: 1 }], settings: { status: 'draft', passingPercent: 60 } };
  const created = await call(x.r.quiz, { method: 'PUT', token: x.T.admin, body, query: { lessonId: x.w.l3 } });
  assert.deepEqual([created.statusCode, created.body.settings.status, created.body.version], [201, 'draft', 1]);
  const stored = x.db.rows('quizzes').find((q) => q.lessonId === x.w.l3);
  assert.equal(stored.courseId, x.w.C, 'the course comes from the lesson, not the request');
  const published = await call(x.r.quiz, { method: 'PUT', token: x.T.admin, body: { questions: created.body.questions, settings: { status: 'published' } }, query: { lessonId: x.w.l3 } });
  assert.deepEqual([published.statusCode, published.body.settings.status, published.body.settings.passingPercent, published.body.version], [200, 'published', 60, 2]);
  assert.equal(published.body.questions[0].id, created.body.questions[0].id, 'the question keeps its identity');
  assert.equal((await startReq(x, x.T.student, x.w.l3)).statusCode, 201);
  const hidden = await call(x.r.quiz, { method: 'PUT', token: x.T.admin, body: { questions: created.body.questions, settings: { status: 'draft' } }, query: { lessonId: x.w.l3 } });
  assert.equal(hidden.body.settings.status, 'draft');
  const malformed = await call(x.r.quiz, { method: 'PUT', token: x.T.admin, body: { questions: [{ question: 'x', options: ['a', ''], correctAnswer: 0 }] }, query: { lessonId: x.w.l3 } });
  assert.equal(malformed.statusCode, 400);
  assert.match(malformed.body.error, /empty or too long option/);
}));

test('availability: the server decides; before opening and after closing nothing starts', route(async () => {
  const x = world();
  const soon = new Date(Date.now() + 3600000);
  const past = new Date(Date.now() - 3600000);
  putQuiz(x.db, x.w.l2, x.w.C, { ...SETTINGS, availableFrom: soon });
  const early = await startReq(x, x.T.student);
  assert.deepEqual([early.statusCode, early.body.code], [403, 'quiz_not_open']);
  putQuiz(x.db, x.w.l2, x.w.C, { ...SETTINGS, availableUntil: past });
  const late = await startReq(x, x.T.student);
  assert.deepEqual([late.statusCode, late.body.code], [403, 'quiz_closed']);
  const overview = await call(x.r.quiz, { token: x.T.student, query: { lessonId: x.w.l2 } });
  assert.deepEqual([overview.statusCode, overview.body.canStart, overview.body.unavailableReason], [200, false, 'quiz_closed']);
}));

test('legacy quizzes: unlimited attempts as before; publication state is preserved, never granted', route(async () => {
  assert.deepEqual([Q.quizSettings({ questions: [] }).status, Q.quizSettings({ questions: [] }).maxAttempts], ['published', null]);
  assert.equal(Q.quizSettings({ published: false }).status, 'draft');
  assert.equal(Q.quizSettings({ status: 'unpublished' }).status, 'draft');
  assert.equal(Q.quizSettings({ status: 'published' }).status, 'published');
  const x = world({ settings: undefined });
  for (let i = 0; i < 3; i += 1) {
    const s = await startReq(x, x.T.student);
    assert.equal(s.statusCode, 201);
    assert.equal((await attemptReq(x, 'POST', x.T.student, s.body.attempt.id, { answers: ALL_RIGHT })).statusCode, 200);
  }
  putQuiz(x.db, x.w.l3, x.w.C, undefined, { published: false });
  assert.equal((await startReq(x, x.T.student, x.w.l3)).statusCode, 404, 'an unpublished legacy quiz stays hidden');
  const saved = await call(x.r.quiz, { method: 'PUT', token: x.T.admin, body: { questions: QUESTIONS }, query: { lessonId: x.w.l3 } });
  assert.equal(saved.body.settings.status, 'draft', 'saving it from an editor without settings does not publish it');
}));

test('snapshots: an edit after the start changes neither the attempt nor its score', route(async () => {
  const x = world();
  const started = await startReq(x, x.T.student);
  const row = x.db.rows('quizzes')[0];
  row.questions[0].question = 'EDITED';
  row.questions[0].correctAnswer = 0;
  row.questions[2].points = 50;
  row.questions.pop();
  const resumed = await startReq(x, x.T.student);
  assert.equal(resumed.body.attempt.questions[0].question, 'Pip?');
  assert.equal(resumed.body.attempt.questions.length, 3);
  const done = await attemptReq(x, 'POST', x.T.student, started.body.attempt.id, { answers: ALL_RIGHT });
  assert.deepEqual([done.body.attempt.result.percent, done.body.attempt.result.available], [100, 4]);
  const fresh = await startReq(x, x.T.student);
  assert.equal(fresh.body.attempt.questions[0].question, 'EDITED', 'the next attempt uses the current quiz');
  assert.equal(fresh.body.attempt.questions.length, 2);
  // The stored result reproduces from the attempt alone.
  const stored = x.db.rows('quizAttempts').find((a) => String(a._id) === started.body.attempt.id);
  assert.deepEqual(Q.scoreAttempt(stored.questions, stored.answers, stored.passingPercent), stored.result);
}));

test('randomization: one order per attempt, on the server, kept across refreshes; grading follows the original key', route(async () => {
  const x = world({ settings: { ...SETTINGS, shuffleQuestions: true, shuffleOptions: true } });
  const ctx = await ctxOf(x);
  let seed = 7;
  const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const started = await A.startAttempt(x.db, ctx, { random });
  const stored = x.db.rows('quizAttempts')[0];
  const original = (id) => QUESTIONS.find((q) => q.id === id);
  for (const q of stored.questions) {
    assert.equal(q.options[q.correct], original(q.id).options[original(q.id).correctAnswer], 'the key follows its option');
    assert.deepEqual(q.options.slice().sort(), original(q.id).options.slice().sort());
  }
  const views = [];
  for (let i = 0; i < 3; i += 1) views.push((await attemptReq(x, 'GET', x.T.student, String(started.attempt._id))).body.attempt.questions);
  assert.deepEqual(views[0], views[1]);
  assert.deepEqual(views[1], views[2]);
  assert.deepEqual(views[0].map((q) => q.id), stored.questions.map((q) => q.id));
  // Answering by what each option says, in this attempt's order, scores full marks.
  const answers = Object.fromEntries(stored.questions.map((q) => [q.id, q.options.indexOf(original(q.id).options[original(q.id).correctAnswer])]));
  const done = await attemptReq(x, 'POST', x.T.student, String(started.attempt._id), { answers });
  assert.equal(done.body.attempt.result.percent, 100);
  const orders = new Set();
  for (let i = 0; i < 12; i += 1) orders.add(JSON.stringify(Q.buildAttemptQuestions(x.db.rows('quizzes')[0], { random }).map((q) => [q.id, q.correct])));
  assert.ok(orders.size > 1, 'different attempts get different orders');
  const plain = world();
  const fixed = Q.buildAttemptQuestions(plain.db.rows('quizzes')[0]);
  assert.deepEqual(fixed.map((q) => [q.id, q.correct]), QUESTIONS.map((q) => [q.id, q.correctAnswer]), 'without shuffling the order is the stored one');
}));

// ---------------------------------------------------------------------------
// Attempt lifecycle
// ---------------------------------------------------------------------------

test('start: a refresh, a second tab or a retry resumes the one open attempt', route(async () => {
  const x = world({ settings: { ...SETTINGS, maxAttempts: 2 } });
  const first = await startReq(x, x.T.student);
  const again = await startReq(x, x.T.student);
  assert.deepEqual([first.statusCode, again.statusCode, again.body.resumed], [201, 200, true]);
  assert.equal(first.body.attempt.id, again.body.attempt.id);
  assert.equal(x.db.rows('quizAttempts').length, 1);
  assert.equal(x.db.rows('quizAttemptCounters')[0].count, 1, 'a resume does not use up an attempt');
}));

test('limits: attempts stop at the limit, numbered in order; the client cannot change that', route(async () => {
  const x = world({ settings: { ...SETTINGS, maxAttempts: 2 } });
  for (const number of [1, 2]) {
    const s = await startReq(x, x.T.student);
    assert.equal(s.body.attempt.number, number);
    await attemptReq(x, 'POST', x.T.student, s.body.attempt.id, { answers: {} });
  }
  const refused = await call(x.r.attempts, { method: 'POST', token: x.T.student, body: { maxAttempts: 99, number: 1, userId: x.w.other }, query: { lessonId: x.w.l2 } });
  assert.deepEqual([refused.statusCode, refused.body.code], [409, 'attempt_limit']);
  const legacy = await call(x.r.quiz, { method: 'POST', token: x.T.student, body: { answers: [1, 0, 2] }, query: { lessonId: x.w.l2 } });
  assert.equal(legacy.statusCode, 409, 'the one-step route obeys the same limit');
  const overview = await call(x.r.quiz, { token: x.T.student, query: { lessonId: x.w.l2 } });
  assert.deepEqual([overview.body.attemptsUsed, overview.body.attemptsRemaining, overview.body.canStart], [2, 0, false]);
  assert.equal(x.db.rows('quizAttempts').filter((a) => a.userId === x.w.other).length, 0);
}));

test('concurrency: parallel starts make one attempt and never pass the limit (in memory; real server in the integration test)', route(async () => {
  const x = world({ racy: true, settings: { ...SETTINGS, maxAttempts: 1 } });
  const ctx = await ctxOf(x);
  const results = await Promise.all(Array.from({ length: 12 }, () => A.startAttempt(x.db, ctx)));
  assert.ok(results.every((r) => r.ok), JSON.stringify(results.filter((r) => !r.ok)));
  assert.equal(new Set(results.map((r) => String(r.attempt._id))).size, 1);
  assert.equal(x.db.rows('quizAttempts').length, 1);
}));

test('concurrency: a request that finds the reservation first writes the attempt; the reserving request returns it, not an error', route(async () => {
  const x = world();
  const ctx = await ctxOf(x);
  const col = x.db.collection('quizAttempts');
  const insert = col.insertOne.bind(col);
  let raced = false;
  col.insertOne = async (doc) => {
    if (!raced) {
      raced = true;
      await A.startAttempt(x.db, ctx); // The second request runs entirely in the gap.
    }
    return insert(doc);
  };
  const first = await A.startAttempt(x.db, ctx);
  assert.deepEqual([first.ok, first.resumed], [true, true]);
  assert.equal(x.db.rows('quizAttempts').length, 1);
  assert.equal(String(first.attempt._id), String(x.db.rows('quizAttempts')[0]._id));
}));

test('recovery: a reservation whose attempt was never written does not cost the student an attempt', route(async () => {
  const x = world({ settings: { ...SETTINGS, maxAttempts: 1 } });
  const ctx = await ctxOf(x);
  const restore = failCall(x.db, 'quizAttempts', 'insertOne');
  await assert.rejects(A.startAttempt(x.db, ctx), /injected/);
  restore();
  assert.equal(x.db.rows('quizAttempts').length, 0);
  const retried = await A.startAttempt(x.db, ctx);
  assert.deepEqual([retried.ok, retried.attempt.number], [true, 1]);
  assert.equal(x.db.rows('quizAttemptCounters')[0].count, 1);
  // The same gap when the quiz has since been withdrawn: the reservation is released.
  const y = world({ settings: { ...SETTINGS, maxAttempts: 1 } });
  const yctx = await ctxOf(y);
  const undo = failCall(y.db, 'quizAttempts', 'insertOne');
  await assert.rejects(A.startAttempt(y.db, yctx), /injected/);
  undo();
  yctx.quiz.settings = { ...SETTINGS, status: 'draft' };
  const gone = await A.startAttempt(y.db, yctx);
  assert.equal(gone.code, 'quiz_not_found');
  assert.deepEqual([y.db.rows('quizAttemptCounters')[0].count, y.db.rows('quizAttemptCounters')[0].openAttemptId], [0, null]);
}));

test('timer: the deadline comes from server time and the configured limit, capped by the closing time', route(async () => {
  assert.equal(Q.attemptDeadline(T0, { timeLimitMinutes: null, availableUntil: null }), null);
  assert.deepEqual(Q.attemptDeadline(T0, { timeLimitMinutes: 30, availableUntil: null }), after(1800));
  assert.deepEqual(Q.attemptDeadline(T0, { timeLimitMinutes: 30, availableUntil: after(600) }), after(600));
  const x = world({ settings: { ...SETTINGS, timeLimitMinutes: 10 } });
  const before = Date.now();
  const res = await call(x.r.attempts, { method: 'POST', token: x.T.student, body: { deadlineAt: '2099-01-01T00:00:00Z', startedAt: '2099-01-01T00:00:00Z' }, query: { lessonId: x.w.l2 } });
  const deadline = new Date(res.body.attempt.deadlineAt).getTime();
  assert.ok(deadline >= before + 600000 && deadline <= Date.now() + 600000, 'client times are ignored');
  assert.ok(Math.abs(new Date(res.body.attempt.serverNow).getTime() - Date.now()) < 5000, 'the client is told server time, to correct its display');
}));

test('timer: a device clock cannot extend an attempt; nothing in a request reaches the deadline', route(async () => {
  const x = world({ settings: { ...SETTINGS, timeLimitMinutes: 10 } });
  const s = await startReq(x, x.T.student);
  const stored = x.db.rows('quizAttempts')[0];
  stored.deadlineAt = new Date(Date.now() - 60000);
  const res = await call(x.r.attempt, { method: 'POST', token: x.T.student, body: { answers: ALL_RIGHT, now: '2020-01-01T00:00:00Z', deadlineAt: '2099-01-01' }, query: { lessonId: x.w.l2, attemptId: s.body.attempt.id }, headers: requestHeaders(x.T.student, { date: 'Wed, 01 Jan 2020 00:00:00 GMT' }) });
  assert.deepEqual([res.body.expired, res.body.attempt.status, res.body.attempt.result.percent], [true, 'expired', 0], 'answers sent late are not graded');
}));

test('grace: one rule. Until deadline + 10 s reads keep the attempt open, autosaves land and a submit counts every answer', route(async () => {
  assert.equal(Q.SUBMIT_GRACE_SECONDS, 10);
  const x = world({ settings: { ...SETTINGS, timeLimitMinutes: 1 } });
  const ctx = await ctxOf(x);
  const { attempt } = await A.startAttempt(x.db, ctx, { now: T0 });
  const id = String(attempt._id);
  const deadline = after(60);
  const inGrace = after(9, deadline);
  assert.equal((await A.readAttempt(x.db, ctx, id, { now: inGrace })).attempt.status, 'in_progress', 'a read at the deadline does not expire it');
  assert.equal((await A.attemptOverview(x.db, ctx, { now: inGrace })).inProgressAttemptId, id);
  assert.equal((await A.saveAnswer(x.db, ctx, id, { questionId: QA, answer: 1 }, { now: inGrace })).ok, true, 'autosave in the grace period');
  const done = await A.submitAttempt(x.db, ctx, id, { answers: { [QB]: 0, [QC]: 2 } }, { now: inGrace });
  assert.deepEqual([done.attempt.status, done.attempt.result.percent], ['submitted', 100], 'answers unsaved at the deadline are not lost');
}));

test('grace: at deadline + 10 s every path expires the attempt the same way, on the answers saved in time', route(async () => {
  const paths = {
    read: (x, ctx, id, now) => A.readAttempt(x.db, ctx, id, { now }),
    overview: (x, ctx, id, now) => A.attemptOverview(x.db, ctx, { now }),
    save: (x, ctx, id, now) => A.saveAnswer(x.db, ctx, id, { questionId: QB, answer: 0 }, { now }),
    submit: (x, ctx, id, now) => A.submitAttempt(x.db, ctx, id, { answers: { [QB]: 0, [QC]: 2 } }, { now }),
    start: (x, ctx, id, now) => A.startAttempt(x.db, ctx, { now }),
  };
  for (const [name, run] of Object.entries(paths)) {
    const x = world({ settings: { ...SETTINGS, timeLimitMinutes: 1 } });
    const ctx = await ctxOf(x);
    const { attempt } = await A.startAttempt(x.db, ctx, { now: T0 });
    const id = String(attempt._id);
    await A.saveAnswer(x.db, ctx, id, { questionId: QA, answer: 1 }, { now: after(30) });
    await run(x, ctx, id, after(70));
    const stored = x.db.rows('quizAttempts').find((a) => String(a._id) === id);
    assert.equal(stored.status, 'expired', name);
    assert.deepEqual(stored.answers, { [QA]: 1 }, `${name}: nothing later than the grace period counts`);
    assert.deepEqual(stored.submittedAt, after(60), `${name}: the attempt ended at its deadline`);
    assert.equal(stored.result.percent, 25, name);
    assert.equal(scoresOf(x).length, 1, name);
  }
}));

test('expiry: an expired attempt cannot be submitted as valid or reopened; a save reports it closed', route(async () => {
  const x = world({ settings: { ...SETTINGS, timeLimitMinutes: 1 } });
  const ctx = await ctxOf(x);
  const { attempt } = await A.startAttempt(x.db, ctx, { now: T0 });
  const id = String(attempt._id);
  await A.readAttempt(x.db, ctx, id, { now: after(120) });
  const submit = await A.submitAttempt(x.db, ctx, id, { answers: ALL_RIGHT }, { now: after(120) });
  assert.deepEqual([submit.alreadyFinal, submit.attempt.status, submit.attempt.result.percent], [true, 'expired', 0]);
  const save = await A.saveAnswer(x.db, ctx, id, { questionId: QA, answer: 1 }, { now: after(120) });
  assert.deepEqual([save.status, save.code], [409, 'attempt_closed']);
  assert.equal(x.db.rows('quizAttempts').filter((a) => a.status === 'in_progress').length, 0);
}));

test('autosave: only this attempt\'s questions and real options; a change replaces, null clears', route(async () => {
  const x = world();
  const s = await startReq(x, x.T.student);
  const id = s.body.attempt.id;
  const save = (body) => attemptReq(x, 'PUT', x.T.student, id, body);
  assert.equal((await save({ questionId: QA, answer: 0 })).statusCode, 200);
  assert.equal((await save({ questionId: QA, answer: 1 })).body.attempt.answers[QA], 1);
  for (const [body, code] of [
    [{ questionId: 'dddddddddddd', answer: 0 }, 'unknown_question'],
    [{ questionId: '__proto__', answer: 0 }, 'unknown_question'],
    [{ questionId: { $ne: null }, answer: 0 }, 'unknown_question'],
    [{}, 'unknown_question'],
    [{ questionId: QA, answer: 2 }, 'invalid_answer'],
    [{ questionId: QA, answer: -1 }, 'invalid_answer'],
    [{ questionId: QA, answer: '1' }, 'invalid_answer'],
    [{ questionId: QA, answer: 0.5 }, 'invalid_answer'],
    [{ questionId: QA, answer: { $gt: 0 } }, 'invalid_answer'],
  ]) {
    const res = await save(body);
    assert.deepEqual([res.statusCode, res.body.code], [400, code], JSON.stringify(body));
  }
  assert.deepEqual(x.db.rows('quizAttempts')[0].answers, { [QA]: 1 });
  const cleared = await save({ questionId: QA, answer: null });
  assert.deepEqual(cleared.body.attempt.answers, {});
  const resumed = await startReq(x, x.T.student);
  assert.deepEqual(resumed.body.attempt.answers, {});
  await save({ questionId: QC, answer: 3 });
  assert.equal((await startReq(x, x.T.student)).body.attempt.answers[QC], 3, 'saved answers come back after a refresh');
}));

test('submission: repeats return the stored result; later answers change nothing; a finished attempt never reopens', route(async () => {
  const x = world();
  const s = await startReq(x, x.T.student);
  const id = s.body.attempt.id;
  const first = await attemptReq(x, 'POST', x.T.student, id, { answers: ALL_RIGHT });
  const second = await attemptReq(x, 'POST', x.T.student, id, { answers: { [QA]: 0, [QB]: 1, [QC]: 0 } });
  assert.deepEqual([first.statusCode, second.statusCode, second.body.alreadySubmitted], [200, 200, true]);
  assert.deepEqual(second.body.attempt.result, first.body.attempt.result);
  assert.equal(scoresOf(x).length, 1);
  assert.equal((await attemptReq(x, 'PUT', x.T.student, id, { questionId: QA, answer: 0 })).statusCode, 409);
  assert.equal(x.db.rows('quizAttempts')[0].status, 'submitted');
  assert.notEqual((await startReq(x, x.T.student)).body.attempt.id, id, 'the next start is a new attempt');
}));

test('submission: concurrent submits make one result, one score row and one completion', route(async () => {
  const x = world({ racy: true });
  const ctx = await ctxOf(x);
  const { attempt } = await A.startAttempt(x.db, ctx);
  const id = String(attempt._id);
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => A.submitAttempt(x.db, ctx, id, { answers: i % 2 ? ALL_RIGHT : { [QA]: 0 } })));
  assert.ok(results.every((r) => r.ok));
  assert.equal(new Set(results.map((r) => r.attempt.result.percent)).size, 1, 'everyone gets the same stored result');
  assert.equal(scoresOf(x).length, 1);
  assert.equal(x.db.rows('quizAttempts')[0].effectsPending, undefined);
  assert.equal(enrollmentOf(x).completedLessons.filter((l) => l === x.w.l2).length, 1);
}));

test('ownership: a student cannot read, save or submit another student\'s attempt, whatever the request says', route(async () => {
  const x = world();
  const s = await startReq(x, x.T.student);
  const id = s.body.attempt.id;
  assert.equal((await attemptReq(x, 'GET', x.T.other, id)).statusCode, 404);
  assert.equal((await attemptReq(x, 'PUT', x.T.other, id, { questionId: QA, answer: 1, userId: x.w.student })).statusCode, 404);
  assert.equal((await attemptReq(x, 'POST', x.T.other, id, { answers: ALL_RIGHT, userId: x.w.student })).statusCode, 404);
  const list = await call(x.r.attempts, { token: x.T.other, query: { lessonId: x.w.l2, userId: x.w.student } });
  assert.deepEqual(list.body.attempts, []);
  assert.equal(x.db.rows('quizAttempts')[0].status, 'in_progress');
  assert.deepEqual(x.db.rows('quizAttempts')[0].answers, {});
  // The right id under the wrong lesson is not found either.
  putQuiz(x.db, x.w.l1, x.w.C, SETTINGS);
  assert.equal((await attemptReq(x, 'GET', x.T.student, id, undefined, x.w.l1)).statusCode, 404);
}));

test('access: enrollment, the paywall and the account are enforced on every attempt route', route(async () => {
  const x = world();
  assert.equal((await startReq(x, x.T.outsider)).statusCode, 403, 'not enrolled');
  const locked = await startReq(x, x.T.unpaid);
  assert.deepEqual([locked.statusCode, locked.body.code], [403, 'lesson_locked'], 'enrolled but not paid (Phase 6)');
  assert.equal((await call(x.r.quiz, { token: x.T.unpaid, query: { lessonId: x.w.l2 } })).statusCode, 403);
  const s = await startReq(x, x.T.student);
  x.db.rows('users').find((u) => String(u._id) === x.w.student).status = 'suspended';
  assert.ok([401, 403].includes((await attemptReq(x, 'GET', x.T.student, s.body.attempt.id)).statusCode), 'a suspended account');
  const y = world();
  const started = await startReq(y, y.T.student);
  enrollmentOf(y).active = false;
  y.db.rows(payment.COLLECTIONS.courseAccess).length = 0;
  assert.equal((await attemptReq(y, 'POST', y.T.student, started.body.attempt.id, { answers: ALL_RIGHT })).statusCode, 403, 'access withdrawn mid-attempt');
}));

test('authorization: instructors reach only their own course; students reach no staff operation', route(async () => {
  const x = world();
  const s = await startReq(x, x.T.student);
  await attemptReq(x, 'POST', x.T.student, s.body.attempt.id, { answers: ALL_RIGHT });
  const id = s.body.attempt.id;
  const staffRead = (token) => call(x.r.attempt, { token, query: { lessonId: x.w.l2, attemptId: id } });
  assert.equal((await call(x.r.attempts, { token: x.T.rival, query: { lessonId: x.w.l2 } })).statusCode, 403);
  assert.equal((await staffRead(x.T.rival)).statusCode, 403);
  assert.equal((await call(x.r.quiz, { token: x.T.rival, query: { lessonId: x.w.l2 } })).statusCode, 403);
  assert.equal((await call(x.r.quiz, { method: 'PUT', token: x.T.rival, body: { questions: QUESTIONS }, query: { lessonId: x.w.l2 } })).statusCode, 403);
  assert.equal((await call(x.r.quiz, { method: 'PUT', token: x.T.student, body: { questions: QUESTIONS, settings: { maxAttempts: 20 } }, query: { lessonId: x.w.l2 } })).statusCode, 403);
  assert.equal(x.db.rows('quizzes')[0].version, 1, 'the student changed nothing');
  const own = await call(x.r.attempts, { token: x.T.student, query: { lessonId: x.w.l2 } });
  assert.equal(own.body.summary, undefined, 'a student gets their own overview, not the results queue');
  assert.equal(own.body.attempts.length, 1);
  for (const token of [x.T.instructor, x.T.admin]) {
    assert.equal((await staffRead(token)).statusCode, 200);
    assert.equal((await call(x.r.attempts, { token, query: { lessonId: x.w.l2 } })).body.summary.attempts, 1);
  }
  assert.equal((await attemptReq(x, 'POST', x.T.instructor, id, { answers: {} })).statusCode, 404, 'staff never submit');
  assert.equal((await startReq(x, x.T.instructor)).statusCode, 403, 'staff do not take quizzes');
}));

test('security: no session is 401, a missing CSRF header or foreign Origin is refused, private responses are not stored', route(async () => {
  const x = world();
  assert.equal((await call(x.r.attempts, { method: 'POST', query: { lessonId: x.w.l2 } })).statusCode, 401);
  const noCsrf = await call(x.r.attempts, { method: 'POST', query: { lessonId: x.w.l2 }, headers: { ...requestHeaders(x.T.student), 'x-fo-csrf': undefined } });
  assert.equal(noCsrf.statusCode, 403);
  const foreign = await call(x.r.attempts, { method: 'POST', query: { lessonId: x.w.l2 }, headers: requestHeaders(x.T.student, { origin: 'https://evil.example' }) });
  assert.equal(foreign.statusCode, 403);
  assert.equal(x.db.rows('quizAttempts').length, 0);
  const s = await startReq(x, x.T.student);
  for (const res of [s, await attemptReq(x, 'GET', x.T.student, s.body.attempt.id), await call(x.r.history, { token: x.T.student })]) {
    assert.match(String(res.headers['cache-control']), /no-store/);
  }
}));

test('security: operator objects and malformed ids in routes and queries are refused, not interpreted', route(async () => {
  const x = world();
  const s = await startReq(x, x.T.student);
  await attemptReq(x, 'POST', x.T.student, s.body.attempt.id, { answers: {} });
  for (const lessonId of [{ $ne: null }, 'not-an-id', '']) {
    const res = await call(x.r.attempts, { token: x.T.student, query: { lessonId } });
    assert.ok([400, 404].includes(res.statusCode), `lesson ${JSON.stringify(lessonId)} -> ${res.statusCode}`);
  }
  for (const attemptId of [{ $ne: null }, 'not-an-id', ['x']]) {
    assert.equal((await call(x.r.attempt, { token: x.T.student, query: { lessonId: x.w.l2, attemptId } })).statusCode, 404, JSON.stringify(attemptId));
  }
  const paged = await call(x.r.attempts, { token: x.T.instructor, query: { lessonId: x.w.l2, page: { $gt: 0 }, limit: '-5' } });
  assert.deepEqual([paged.statusCode, paged.body.pagination.page, paged.body.pagination.limit], [200, 1, 50]);
  assert.equal((await call(x.r.attempts, { method: 'POST', token: x.T.student, body: 'x', query: { lessonId: x.w.l2 } })).statusCode, 201);
}));

// ---------------------------------------------------------------------------
// Scoring and results
// ---------------------------------------------------------------------------

const frozen = (points) => points.map((p, i) => ({ id: `q${i}`, options: ['a', 'b', 'c'], correct: 0, points: p }));

test('scoring: correct, incorrect and unanswered; weighted; earned never above available', () => {
  const q = frozen([1, 1, 2]);
  assert.deepEqual((({ earned, available, percent, correctCount, answeredCount }) => [earned, available, percent, correctCount, answeredCount])(Q.scoreAttempt(q, { q0: 0, q1: 1 }, null)), [1, 4, 25, 1, 2]);
  assert.equal(Q.scoreAttempt(q, { q0: 0, q1: 0, q2: 0 }, null).percent, 100);
  assert.deepEqual([Q.scoreAttempt(q, {}, null).percent, Q.scoreAttempt(q, {}, null).answeredCount], [0, 0], 'unanswered scores 0');
  assert.equal(Q.scoreAttempt(q, { q0: 9, q1: '0', q2: null, ghost: 0 }, null).earned, 0, 'invalid and unknown answers score 0');
  const big = Q.scoreAttempt(q, { q0: 0, q1: 0, q2: 0, q0x: 0 }, null);
  assert.ok(big.earned <= big.available);
  assert.equal(Q.scoreAttempt([], {}, null).percent, 0);
  // No partial credit: a question is all or nothing.
  assert.deepEqual(Q.scoreAttempt(frozen([5]), { q0: 1 }, null).perQuestion[0], { id: 'q0', answered: true, correct: false, earned: 0 });
});

test('scoring: percentages round to 2 decimals, the same way every time', () => {
  const pct = (points, answers) => Q.scoreAttempt(frozen(points), answers, null).percent;
  assert.equal(pct([1, 1, 1], { q0: 0 }), 33.33);
  assert.equal(pct([1, 1, 1], { q0: 0, q1: 0 }), 66.67);
  assert.equal(pct([1, 1, 1, 1, 1, 1, 1], { q0: 0 }), 14.29);
  assert.equal(pct([100, 100, 100], { q0: 0, q1: 0 }), 66.67);
  for (let i = 0; i < 5; i += 1) assert.equal(pct([3, 7, 11], { q1: 0 }), 33.33);
});

test('pass marks: at the mark passes, below fails, none is null; compared on the stored percentage', () => {
  const q = frozen([1, 1, 1, 1]);
  assert.equal(Q.scoreAttempt(q, { q0: 0, q1: 0 }, 50).passed, true);
  assert.equal(Q.scoreAttempt(q, { q0: 0 }, 50).passed, false);
  assert.equal(Q.scoreAttempt(q, { q0: 0 }, null).passed, null);
  assert.equal(Q.scoreAttempt(q, {}, 0).passed, true);
  assert.equal(Q.scoreAttempt(frozen([1, 1, 1]), { q0: 0, q1: 0 }, 67).passed, false, '66.67 is below 67');
});

test('scoring: scores, percentages and pass flags sent by the browser have no effect', route(async () => {
  const x = world({ settings: { ...SETTINGS, passingPercent: 90 } });
  const s = await startReq(x, x.T.student);
  const res = await attemptReq(x, 'POST', x.T.student, s.body.attempt.id, { answers: { [QA]: 0 }, score: 100, percent: 100, passed: true, correct: 3, total: 3, earned: 4, result: { percent: 100, passed: true }, correctAnswer: 0 });
  assert.deepEqual([res.body.attempt.result.percent, res.body.attempt.result.passed, res.body.attempt.result.earned], [0, false, 0]);
  const row = scoresOf(x)[0];
  assert.deepEqual([row.score, row.passed, row.correct], [0, false, 0]);
  const x2 = world();
  const legacy = await call(x2.r.quiz, { method: 'POST', token: x2.T.student, body: { answers: [0, 1, 0], score: 100, userId: x2.w.other }, query: { lessonId: x2.w.l2 } });
  assert.deepEqual([legacy.statusCode, legacy.body.score], [200, 0]);
  assert.equal(scoresOf(x2, 'other').length, 0, 'a user id in the body impersonates nobody');
}));

test('submission: an answer for a question outside the attempt is refused and scores nothing', route(async () => {
  const x = world();
  const s = await startReq(x, x.T.student);
  const res = await attemptReq(x, 'POST', x.T.student, s.body.attempt.id, { answers: { [QA]: 1, dddddddddddd: 0 } });
  assert.deepEqual([res.statusCode, res.body.code], [400, 'unknown_question']);
  assert.equal(x.db.rows('quizAttempts')[0].status, 'in_progress');
  assert.equal((await attemptReq(x, 'POST', x.T.student, s.body.attempt.id, { answers: 'x' })).statusCode, 400);
  assert.equal((await attemptReq(x, 'POST', x.T.student, s.body.attempt.id, { answers: [1, 0, 2] })).statusCode, 400);
}));

test('review policy: the key appears only when the policy allows it, on every route', route(async () => {
  const finish = async (x, answers) => {
    const s = await startReq(x, x.T.student);
    return attemptReq(x, 'POST', x.T.student, s.body.attempt.id, { answers });
  };
  const leaked = (res) => JSON.stringify(res.body).includes('correctAnswer') || JSON.stringify(res.body).includes('EXPLAIN');

  const always = world();
  const a = await finish(always, ALL_RIGHT);
  assert.equal(leaked(a), true);
  assert.equal(a.body.attempt.review[0].explanation, 'EXPLAIN-A');

  const never = world({ settings: { ...SETTINGS, reviewPolicy: 'never' } });
  const n = await finish(never, ALL_RIGHT);
  assert.equal(leaked(n), false);
  assert.equal(n.body.attempt.reviewAvailable, false);
  assert.equal(leaked(await attemptReq(never, 'GET', never.T.student, n.body.attempt.id)), false);
  const nl = await call(never.r.quiz, { method: 'POST', token: never.T.student, body: { answers: [1, 0, 2] }, query: { lessonId: never.w.l2 } });
  assert.equal(leaked(nl), false, 'the one-step route too');

  const pass = world({ settings: { ...SETTINGS, reviewPolicy: 'after_pass', passingPercent: 50 } });
  const failed = await finish(pass, {});
  assert.equal(leaked(failed), false, 'not after a failed attempt');
  await finish(pass, ALL_RIGHT);
  assert.equal(leaked(await attemptReq(pass, 'GET', pass.T.student, failed.body.attempt.id)), true, 'after passing, earlier attempts too');

  const last = world({ settings: { ...SETTINGS, reviewPolicy: 'after_last_attempt', maxAttempts: 2 } });
  const one = await finish(last, {});
  assert.equal(leaked(one), false, 'an attempt remains');
  const two = await finish(last, ALL_RIGHT);
  assert.equal(leaked(two), true, 'none remain');
  const unlimited = Q.reviewAllowed({ status: 'submitted' }, [{ status: 'submitted' }], { ...SETTINGS, reviewPolicy: 'after_last_attempt', maxAttempts: null });
  assert.equal(unlimited, false, 'with unlimited attempts there is no last attempt');
  assert.equal(Q.reviewAllowed({ status: 'in_progress' }, [], SETTINGS), false);
  assert.equal(Q.reviewAllowed({ status: 'cancelled' }, [], SETTINGS), false);
}));

test('completion: passing completes the lesson; a failed attempt does not; with no pass mark submitting does', route(async () => {
  const run = async (settings, answers) => {
    const x = world({ settings });
    const s = await startReq(x, x.T.student);
    await attemptReq(x, 'POST', x.T.student, s.body.attempt.id, { answers });
    return enrollmentOf(x).completedLessons.includes(x.w.l2);
  };
  assert.equal(await run({ ...SETTINGS, passingPercent: 50 }, ALL_RIGHT), true);
  assert.equal(await run({ ...SETTINGS, passingPercent: 50 }, { [QA]: 0 }), false);
  assert.equal(await run(SETTINGS, { [QA]: 0 }), true);
}));

test('completion: a timed-out attempt with no answers never completes the lesson; with answers the normal rules apply', route(async () => {
  const run = async (settings, save) => {
    const x = world({ settings: { ...SETTINGS, timeLimitMinutes: 1, ...settings } });
    const ctx = await ctxOf(x);
    const { attempt } = await A.startAttempt(x.db, ctx, { now: T0 });
    if (save) await A.saveAnswer(x.db, ctx, String(attempt._id), save, { now: after(5) });
    await A.readAttempt(x.db, ctx, String(attempt._id), { now: after(300) });
    return { done: enrollmentOf(x).completedLessons.includes(x.w.l2), stored: x.db.rows('quizAttempts')[0], scores: scoresOf(x) };
  };
  const empty = await run({}, null);
  assert.equal(empty.done, false, 'zero answers, no pass mark');
  assert.equal(empty.stored.status, 'expired');
  assert.equal(empty.scores.length, 1, 'it is still a recorded result');
  assert.equal(empty.stored.effectsPending, undefined);
  assert.equal((await run({}, { questionId: QA, answer: 0 })).done, true, 'an answer, no pass mark');
  assert.equal((await run({ passingPercent: 10 }, { questionId: QA, answer: 0 })).done, false, 'timed out and failed');
  assert.equal((await run({ passingPercent: 10 }, { questionId: QC, answer: 2 })).done, true, 'timed out and passed');
}));

test('completion: an attempt with no answers never completes the lesson, submitted or timed out, on any route', route(async () => {
  const open = (x) => enrollmentOf(x).completedLessons.includes(x.w.l2);

  // 1. Submitted with no answers, no pass mark.
  const empty = world();
  const s = await startReq(empty, empty.T.student);
  const res = await attemptReq(empty, 'POST', empty.T.student, s.body.attempt.id, { answers: {} });
  assert.deepEqual([res.statusCode, res.body.attempt.status, res.body.attempt.result.percent, res.body.attempt.result.answeredCount], [200, 'submitted', 0, 0]);
  assert.equal(open(empty), false);
  assert.equal(scoresOf(empty).length, 1, 'it is still a recorded result');
  assert.equal(empty.db.rows('quizAttempts')[0].effectsPending, undefined, 'and it is finished, not stuck');

  // 2. A non-empty submitted attempt, no pass mark, even with every answer wrong.
  const wrong = world();
  const w = await startReq(wrong, wrong.T.student);
  await attemptReq(wrong, 'POST', wrong.T.student, w.body.attempt.id, { answers: { [QA]: 0 } });
  assert.equal(open(wrong), true);

  // 3. Timed out with no answers, no pass mark.
  const timed = world({ settings: { ...SETTINGS, timeLimitMinutes: 1 } });
  const ctx = await ctxOf(timed);
  const t = await A.startAttempt(timed.db, ctx, { now: T0 });
  await A.readAttempt(timed.db, ctx, String(t.attempt._id), { now: after(300) });
  assert.equal(timed.db.rows('quizAttempts')[0].status, 'expired');
  assert.equal(open(timed), false);

  // The one-step route follows the same rule: nothing answered, nothing completed.
  const legacy = world();
  const blank = await call(legacy.r.quiz, { method: 'POST', token: legacy.T.student, body: { answers: [null, null, null] }, query: { lessonId: legacy.w.l2 } });
  assert.equal(blank.statusCode, 200);
  assert.equal(open(legacy), false);
  await call(legacy.r.quiz, { method: 'POST', token: legacy.T.student, body: { answers: [0, null, null] }, query: { lessonId: legacy.w.l2 } });
  assert.equal(open(legacy), true);

  // A pass mark of 0 "passes" an empty attempt; it still completes nothing.
  const zero = world({ settings: { ...SETTINGS, passingPercent: 0 } });
  const z = await startReq(zero, zero.T.student);
  const passed = await attemptReq(zero, 'POST', zero.T.student, z.body.attempt.id, { answers: {} });
  assert.equal(passed.body.attempt.result.passed, true);
  assert.equal(open(zero), false);

  // A retake with an answer completes the lesson, once.
  const retake = await startReq(empty, empty.T.student);
  await attemptReq(empty, 'POST', empty.T.student, retake.body.attempt.id, { answers: { [QA]: 1 } });
  assert.equal(enrollmentOf(empty).completedLessons.filter((l) => l === empty.w.l2).length, 1);

  // Cleared answers are no answers.
  const cleared = world();
  const c = await startReq(cleared, cleared.T.student);
  await attemptReq(cleared, 'PUT', cleared.T.student, c.body.attempt.id, { questionId: QA, answer: 1 });
  await attemptReq(cleared, 'PUT', cleared.T.student, c.body.attempt.id, { questionId: QA, answer: null });
  await attemptReq(cleared, 'POST', cleared.T.student, c.body.attempt.id, {});
  assert.equal(open(cleared), false);

  for (const status of ['submitted', 'expired']) {
    assert.equal(Q.attemptCompletesLesson({ status, result: { passed: null, answeredCount: 0 } }), false, status);
    assert.equal(Q.attemptCompletesLesson({ status, result: { passed: true, answeredCount: 0 } }), false, status);
    assert.equal(Q.attemptCompletesLesson({ status, result: { passed: null, answeredCount: 1 } }), true, status);
    assert.equal(Q.attemptCompletesLesson({ status, result: { passed: false, answeredCount: 3 } }), false, status);
  }
}));

test('leaderboard: the route averages every finished attempt; nothing filters retakes or timed-out attempts', route(async () => {
  const x = world();
  let pipeline = null;
  x.db.collection('quizScores').aggregate = (stages) => { pipeline = stages; return { toArray: async () => [] }; };
  const handler = loadModule('pages/api/leaderboard/index.ts', { 'lib/mongodb': { getDb: async () => x.db } }).default;
  const res = await call(handler, { token: x.T.student, query: { type: 'quizzes' } });
  assert.equal(res.statusCode, 200);
  assert.equal(pipeline.some((stage) => stage.$match), false, 'no attempt is left out');
  assert.deepEqual(pipeline[0].$group, { _id: '$userId', avgScore: { $avg: '$score' }, totalQuizzes: { $sum: 1 } });
}));

test('leaderboard: a score row exists only for a finalized, scored attempt', route(async () => {
  const x = world({ settings: { ...SETTINGS, timeLimitMinutes: 1 } });
  const ctx = await ctxOf(x);
  const { attempt } = await A.startAttempt(x.db, ctx, { now: T0 });
  await A.saveAnswer(x.db, ctx, String(attempt._id), { questionId: QA, answer: 1 }, { now: after(5) });
  assert.equal(scoresOf(x).length, 0, 'in progress');
  assert.equal((await A.sweepAttempts(x.db, { now: after(600) })).overdue, 1);
  assert.equal(scoresOf(x).length, 0, 'overdue but not yet finalized; a report changes nothing');
  await A.sweepAttempts(x.db, { apply: true, now: after(600) });
  assert.deepEqual(scoresOf(x).map((r) => [r.status, r.score]), [['expired', 25]], 'timed out and scored on the saved answer');
  const y = world();
  await startReq(y, y.T.other);
  await call(y.r.lesson, { method: 'DELETE', token: y.T.admin, query: { id: y.w.l2 } });
  assert.equal(y.db.rows('quizScores').length, 0, 'a cancelled attempt never counts');
}));

test('the rules are told to users where they apply', () => {
  const board = read('pages/leaderboard.tsx');
  assert.match(board, /average of every quiz attempt you have finished/);
  assert.match(board, /Retakes count/);
  assert.match(board, /ran out of time count once they are scored/);
  assert.match(board, /still in progress do not count/);
  assert.match(board, />Attempts<\/th>/);
  const quiz = read('components/Quiz.tsx');
  assert.match(quiz, /including retakes and attempts that run out of time, counts toward your quiz average/);
  assert.match(quiz, /does not complete the lesson/);
  assert.match(quiz, /does not complete this lesson/);
  assert.match(read('components/instructor/QuizSettingsPanel.tsx'), /no answers never completes the lesson/);
});

test('completion: never records a lesson the student cannot open (Phase 6)', route(async () => {
  const x = world();
  const s = await startReq(x, x.T.student);
  x.db.rows(payment.COLLECTIONS.courseAccess).splice(0);
  const stored = x.db.rows('quizAttempts')[0];
  await A.finalizeAttempt(x.db, stored, { status: 'submitted', answers: ALL_RIGHT, now: new Date() });
  assert.equal(s.statusCode, 201);
  assert.equal(enrollmentOf(x).completedLessons.includes(x.w.l2), false);
  assert.equal(scoresOf(x).length, 1, 'the result still stands');
}));

test('scores: one row per attempt, matching the attempt; its id is the attempt id', route(async () => {
  const x = world({ settings: { ...SETTINGS, passingPercent: 50 } });
  const s = await startReq(x, x.T.student);
  await attemptReq(x, 'POST', x.T.student, s.body.attempt.id, { answers: { [QA]: 1, [QC]: 2 } });
  const [row] = scoresOf(x);
  const attempt = x.db.rows('quizAttempts')[0];
  assert.equal(String(row._id), s.body.attempt.id);
  assert.deepEqual(
    [row.attemptId, row.attemptNumber, row.score, row.percentage, row.correct, row.totalQuestions, row.earned, row.available, row.passed, row.status, row.courseId],
    [s.body.attempt.id, 1, 75, 75, 2, 3, 3, 4, true, 'submitted', x.w.C]
  );
  assert.deepEqual(row.createdAt, attempt.finalizedAt);
  const shownOn = (scores) => presentEnrollmentProgress({ userId: x.w.student, courseId: x.w.C, completedLessons: [] }, { course: null, totalLessons: 0, quizScores: scores }).quizScores;
  const [shown, old] = shownOn([row, { score: 80 }]);
  assert.deepEqual([shown.score, shown.totalQuestions, shown.percentage], [2, 3, 75], '/progress shows 2/3, not 75/3');
  assert.deepEqual([old.score, old.totalQuestions, old.percentage], [80, 0, 80], 'rows from before Phase 9');
}));

// ---------------------------------------------------------------------------
// Failure injection: submission reconciliation
// ---------------------------------------------------------------------------

const STEPS = [
  ['the terminal update', 'quizAttempts', 'updateOne', 1, false],
  ['releasing the open slot', 'quizAttemptCounters', 'updateOne', 1, true],
  ['the score write', 'quizScores', 'insertOne', 1, true],
  ['the lesson completion', 'progress', 'findOneAndUpdate', 1, true],
  ['clearing effectsPending', 'quizAttempts', 'updateOne', 2, true],
];

for (const [label, name, method, nth, finalized] of STEPS) {
  test(`recovery: a failure at ${label} reports an error, then a retry completes everything exactly once`, route(async () => {
    const x = world({ settings: { ...SETTINGS, passingPercent: 50 } });
    const s = await startReq(x, x.T.student);
    const id = s.body.attempt.id;
    const restore = failCall(x.db, name, method, nth);
    const failed = await attemptReq(x, 'POST', x.T.student, id, { answers: ALL_RIGHT });
    restore();
    assert.equal(failed.statusCode, 500, 'never reported as a success');
    assert.equal(JSON.stringify(failed.body).includes('injected'), false, 'no internal detail');
    const stored = () => x.db.rows('quizAttempts')[0];
    assert.equal(stored().status, finalized ? 'submitted' : 'in_progress');
    assert.equal(stored().effectsPending, finalized ? true : undefined);

    const retry = await attemptReq(x, 'POST', x.T.student, id, { answers: ALL_RIGHT });
    assert.equal(retry.statusCode, 200);
    assert.deepEqual([retry.body.attempt.status, retry.body.attempt.result.percent], ['submitted', 100]);
    assert.equal(stored().effectsPending, undefined);
    assert.equal(scoresOf(x).length, 1);
    assert.equal(enrollmentOf(x).completedLessons.filter((l) => l === x.w.l2).length, 1);
    assert.equal(x.db.rows('quizAttemptCounters')[0].openAttemptId, null);

    const again = await attemptReq(x, 'POST', x.T.student, id, {});
    assert.equal(again.statusCode, 200);
    assert.equal(scoresOf(x).length, 1, 'a further retry adds nothing');
  }));
}

test('recovery: each later entry point reconciles an interrupted attempt, not only a repeated submit', route(async () => {
  const entries = {
    'reading the attempt': (x, id) => attemptReq(x, 'GET', x.T.student, id),
    'the quiz overview': (x) => call(x.r.quiz, { token: x.T.student, query: { lessonId: x.w.l2 } }),
    'starting again': (x) => startReq(x, x.T.student),
    'a late autosave': (x, id) => attemptReq(x, 'PUT', x.T.student, id, { questionId: QA, answer: 0 }),
  };
  for (const [label, run] of Object.entries(entries)) {
    const x = world();
    const s = await startReq(x, x.T.student);
    const restore = failCall(x.db, 'quizScores', 'insertOne');
    assert.equal((await attemptReq(x, 'POST', x.T.student, s.body.attempt.id, { answers: ALL_RIGHT })).statusCode, 500);
    restore();
    assert.equal(scoresOf(x).length, 0);
    await run(x, s.body.attempt.id);
    const first = x.db.rows('quizAttempts').find((a) => String(a._id) === s.body.attempt.id);
    assert.equal(first.effectsPending, undefined, label);
    assert.equal(scoresOf(x).length, 1, label);
    assert.equal(enrollmentOf(x).completedLessons.includes(x.w.l2), true, label);
  }
}));

test('recovery: while a failure persists the read fails too, so nothing shows a result that is not durable', route(async () => {
  const x = world();
  const s = await startReq(x, x.T.student);
  const col = x.db.collection('quizScores');
  const insert = col.insertOne;
  col.insertOne = async () => { throw new Error('injected: down'); };
  assert.equal((await attemptReq(x, 'POST', x.T.student, s.body.attempt.id, { answers: ALL_RIGHT })).statusCode, 500);
  assert.equal((await attemptReq(x, 'GET', x.T.student, s.body.attempt.id)).statusCode, 500);
  col.insertOne = insert;
  const read = await attemptReq(x, 'GET', x.T.student, s.body.attempt.id);
  assert.deepEqual([read.statusCode, read.body.attempt.result.percent], [200, 100]);
}));

test('recovery: a stale open slot on a finished attempt never blocks the next attempt', route(async () => {
  const x = world();
  const s = await startReq(x, x.T.student);
  await attemptReq(x, 'POST', x.T.student, s.body.attempt.id, { answers: {} });
  x.db.rows('quizAttemptCounters')[0].openAttemptId = s.body.attempt.id;
  const next = await startReq(x, x.T.student);
  assert.deepEqual([next.statusCode, next.body.attempt.number], [201, 2]);
}));

test('recovery: two processes reconciling at once still write one score row', route(async () => {
  const x = world({ racy: true });
  const ctx = await ctxOf(x);
  const { attempt } = await A.startAttempt(x.db, ctx);
  const restore = failCall(x.db, 'quizScores', 'insertOne');
  await assert.rejects(A.submitAttempt(x.db, ctx, String(attempt._id), { answers: ALL_RIGHT }));
  restore();
  const stored = { ...x.db.rows('quizAttempts')[0] };
  await Promise.all(Array.from({ length: 6 }, () => A.reconcileAttempt(x.db, stored)));
  assert.equal(scoresOf(x).length, 1);
}));

test('sweep: read-only by default; --apply finishes interrupted and overdue attempts for students who never return', route(async () => {
  const x = world({ settings: { ...SETTINGS, timeLimitMinutes: 1 } });
  const ctx = await ctxOf(x);
  const other = await ctxOf(x, 'other');
  const a = await A.startAttempt(x.db, ctx, { now: T0 });
  await A.startAttempt(x.db, other, { now: T0 });
  const restore = failCall(x.db, 'quizScores', 'insertOne');
  await assert.rejects(A.submitAttempt(x.db, ctx, String(a.attempt._id), { answers: ALL_RIGHT }, { now: after(5) }));
  restore();
  const now = after(600);
  const report = await A.sweepAttempts(x.db, { now });
  assert.deepEqual([report.pending, report.overdue, report.reconciled, report.expired], [1, 1, 0, 0]);
  assert.equal(x.db.rows('quizScores').length, 0, 'the report changed nothing');
  const applied = await A.sweepAttempts(x.db, { apply: true, now });
  assert.deepEqual([applied.reconciled, applied.expired, applied.failed], [1, 1, 0]);
  assert.equal(x.db.rows('quizScores').length, 2);
  assert.deepEqual((await A.sweepAttempts(x.db, { now })).pending, 0);
  assert.deepEqual(reconcileScript.parseArgs(['node', 's', '--database', 'x', '--apply']), { database: 'x', apply: true });
  assert.ok(reconcileScript.parseArgs(['node', 's']).error);
  const lines = [];
  const run = await reconcileScript.run(x.db, { apply: false, log: (l) => lines.push(l) });
  assert.equal(run.ok, true);
  assert.equal(lines.some((l) => /Finished/.test(l)), false, 'a report is only a report');
}));

// ---------------------------------------------------------------------------
// Results, history, lesson deletion
// ---------------------------------------------------------------------------

test('history: a student sees their own results across quizzes, including old ones; never anyone else\'s, never answers', route(async () => {
  const x = world();
  const s = await startReq(x, x.T.student);
  await attemptReq(x, 'POST', x.T.student, s.body.attempt.id, { answers: ALL_RIGHT });
  const o = await startReq(x, x.T.other);
  await attemptReq(x, 'POST', x.T.other, o.body.attempt.id, { answers: {} });
  x.db.rows('quizScores').push({ _id: new ObjectId(), userId: x.w.student, lessonId: x.w.l1, courseId: x.w.C, score: 80, answers: [1, 2], createdAt: new Date('2026-01-01') });
  const res = await call(x.r.history, { token: x.T.student, query: { userId: x.w.other } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.results.length, 2);
  assert.deepEqual(res.body.results.map((r) => r.percent), [100, 80], 'newest first');
  assert.equal(res.body.results[0].lessonTitle, 'Lesson 2');
  assert.equal(res.body.results[1].attemptNumber, null, 'a result from before Phase 9');
  assert.equal(JSON.stringify(res.body).includes('answers'), false);
  assert.equal((await call(x.r.history, { method: 'POST', token: x.T.student })).statusCode, 405);
  for (let i = 0; i < 25; i += 1) x.db.rows('quizScores').push({ _id: new ObjectId(), userId: x.w.student, lessonId: x.w.l1, courseId: x.w.C, score: i, createdAt: new Date(2026, 0, 2 + i) });
  const page = await call(x.r.history, { token: x.T.student, query: { page: '3', limit: '10' } });
  assert.equal(page.body.results.length, 7);
  assert.deepEqual([page.body.pagination.total, page.body.pagination.pages, page.body.pagination.page], [27, 3, 3]);
}));

test('history: titles load in two batched queries however many results there are', route(async () => {
  const x = world();
  for (let i = 0; i < 30; i += 1) x.db.rows('quizScores').push({ _id: new ObjectId(), userId: x.w.student, lessonId: x.w.l2, courseId: x.w.C, score: i, createdAt: new Date(2026, 0, 1 + i) });
  const counts = { lessons: 0, courses: 0 };
  for (const name of Object.keys(counts)) {
    const col = x.db.collection(name);
    const find = col.find.bind(col);
    col.find = (...args) => { counts[name] += 1; return find(...args); };
  }
  await A.assessmentHistory(x.db, { userId: x.w.student, limit: 30 });
  assert.deepEqual(counts, { lessons: 1, courses: 1 });
}));

test('results: staff read every finished attempt in pages; the summary covers all of them; in-progress work stays out', route(async () => {
  const x = world({ settings: { ...SETTINGS, passingPercent: 50 } });
  const ctx = await ctxOf(x);
  for (let i = 0; i < 230; i += 1) {
    const userId = newId();
    x.db.rows('quizAttempts').push({ _id: new ObjectId(), userId, lessonId: x.w.l2, courseId: x.w.C, number: 1, status: 'submitted', submittedAt: new Date(2026, 0, 1, 0, i), result: { percent: i % 2 ? 100 : 0, passed: Boolean(i % 2) } });
  }
  x.db.rows('quizAttempts').push({ _id: new ObjectId(), userId: x.w.other, lessonId: x.w.l2, number: 1, status: 'in_progress', deadlineAt: null, answers: { [QA]: 1 } });
  const res = await call(x.r.attempts, { token: x.T.instructor, query: { lessonId: x.w.l2, page: '5', limit: '50' } });
  assert.deepEqual([res.body.attempts.length, res.body.pagination.total, res.body.pagination.pages], [30, 230, 5]);
  assert.deepEqual([res.body.summary.attempts, res.body.summary.students, res.body.summary.passed, res.body.summary.averagePercent], [230, 230, 115, 50]);
  const all = new Set();
  for (let page = 1; page <= 5; page += 1) {
    (await A.quizResults(x.db, ctx, { page, limit: 50 })).attempts.forEach((a) => all.add(a.attemptId));
  }
  assert.equal(all.size, 230, 'beyond 200, and no row twice');
  assert.equal((await A.quizResults(x.db, ctx, { limit: 5000 })).pagination.limit, 100, 'a page has a ceiling');
  assert.equal(JSON.stringify(res.body).includes(QA), false);
}));

test('results: time that ran out with nobody watching shows up when staff look', route(async () => {
  const x = world({ settings: { ...SETTINGS, timeLimitMinutes: 1 } });
  const ctx = await ctxOf(x);
  await A.startAttempt(x.db, ctx, { now: T0 });
  const staff = await A.loadQuizContext(x.db, { userId: x.w.instructor, lessonId: x.w.l2 });
  const results = await A.quizResults(x.db, staff, { now: after(600) });
  assert.deepEqual([results.attempts.length, results.attempts[0].status], [1, 'expired']);
  assert.equal(scoresOf(x).length, 1);
}));

test('review: staff see an attempt against its frozen questions, also after the quiz changed; never an open attempt', route(async () => {
  const x = world();
  const s = await startReq(x, x.T.student);
  const open = await call(x.r.attempt, { token: x.T.instructor, query: { lessonId: x.w.l2, attemptId: s.body.attempt.id } });
  assert.equal(open.statusCode, 404, 'in-progress answers are the student\'s');
  await attemptReq(x, 'POST', x.T.student, s.body.attempt.id, { answers: { [QA]: 0 } });
  x.db.rows('quizzes')[0].questions[0].question = 'EDITED';
  const res = await call(x.r.attempt, { token: x.T.instructor, query: { lessonId: x.w.l2, attemptId: s.body.attempt.id } });
  const q = res.body.attempt.questions[0];
  assert.deepEqual([q.question, q.answer, q.correctAnswer, q.correct], ['Pip?', 0, 1, false]);
  assert.equal(res.body.attempt.questions[1].answer, null);
}));

test('lesson deletion: open attempts are cancelled with no score, finished results stay, and history still reads', route(async () => {
  const x = world();
  const finished = await startReq(x, x.T.student);
  await attemptReq(x, 'POST', x.T.student, finished.body.attempt.id, { answers: ALL_RIGHT });
  const open = await startReq(x, x.T.other);
  const res = await call(x.r.lesson, { method: 'DELETE', token: x.T.admin, query: { id: x.w.l2 } });
  assert.equal(res.statusCode, 200);
  const rows = x.db.rows('quizAttempts');
  const cancelled = rows.find((a) => String(a._id) === open.body.attempt.id);
  assert.deepEqual([cancelled.status, cancelled.cancelReason], ['cancelled', 'lesson_deleted']);
  assert.equal(cancelled.result, undefined);
  assert.equal(rows.find((a) => String(a._id) === finished.body.attempt.id).status, 'submitted');
  assert.equal(x.db.rows('quizAttemptCounters').length, 0);
  assert.equal(x.db.rows('quizzes').length, 0);
  assert.equal(scoresOf(x).length, 1, 'the finished result is a student record');
  assert.equal(scoresOf(x, 'other').length, 0);
  const history = await call(x.r.history, { token: x.T.student });
  assert.deepEqual([history.body.results.length, history.body.results[0].lessonTitle, history.body.results[0].percent], [1, null, 100]);
  assert.equal((await A.sweepAttempts(x.db, {})).overdue, 0, 'nothing left to expire');
}));

test('lesson deletion: a failure while closing attempts leaves the lesson there, so it can be deleted again', route(async () => {
  const x = world();
  await startReq(x, x.T.student);
  const col = x.db.collection('quizAttempts');
  const updateMany = col.updateMany;
  col.updateMany = async () => { throw new Error('injected'); };
  assert.equal((await call(x.r.lesson, { method: 'DELETE', token: x.T.admin, query: { id: x.w.l2 } })).statusCode, 500);
  col.updateMany = updateMany;
  assert.ok(x.db.rows('lessons').some((l) => String(l._id) === x.w.l2));
  assert.equal((await call(x.r.lesson, { method: 'DELETE', token: x.T.admin, query: { id: x.w.l2 } })).statusCode, 200);
  assert.equal(x.db.rows('quizAttempts')[0].status, 'cancelled');
}));

// ---------------------------------------------------------------------------
// Assignments and grading
// ---------------------------------------------------------------------------

function assignmentWorld(options = {}) {
  const x = world(options);
  const assignmentId = newId();
  x.db.rows('assignments').push({ _id: new ObjectId(assignmentId), courseId: x.w.C, lessonId: x.w.l2, title: 'Journal', instructions: 'Write', points: 50, dueDate: options.dueDate ?? null });
  x.assignmentId = assignmentId;
  x.submit = (token, text = 'my work', extra = {}) => call(x.r.submit, { method: 'POST', token, body: { submissionText: text, ...extra }, query: { id: assignmentId } });
  x.grade = (token, submissionId, grade, feedback = 'ok', extra = {}) => call(x.r.grade, { method: 'POST', token, body: { submissionId, grade, feedback, ...extra }, query: { id: assignmentId } });
  x.points = (key = 'student') => x.db.rows('users').find((u) => String(u._id) === x.w[key]).points;
  x.sub = () => x.db.rows('assignmentSubmissions')[0];
  return x;
}

test('grading: the course instructor grades; another instructor, the student and strangers cannot; values are validated', route(async () => {
  const x = assignmentWorld();
  await x.submit(x.T.student);
  const id = String(x.sub()._id);
  assert.equal((await x.grade(x.T.rival, id, 100)).statusCode, 403);
  assert.equal((await x.grade(x.T.student, id, 100)).statusCode, 403);
  assert.equal((await x.grade(x.T.other, id, 100)).statusCode, 403);
  assert.equal(x.sub().grade, null);
  for (const grade of [-1, 101, 'high', null, undefined]) assert.equal((await x.grade(x.T.instructor, id, grade)).statusCode, 400, String(grade));
  assert.equal((await x.grade(x.T.instructor, id, 80, 'x'.repeat(5001))).statusCode, 400);
  assert.equal((await x.grade(x.T.instructor, newId(), 80)).statusCode, 404);
  const ok = await x.grade(x.T.instructor, id, 80, 'Good');
  assert.deepEqual([ok.statusCode, ok.body.pointsAwarded], [200, 40]);
  assert.deepEqual([x.sub().status, x.sub().grade, x.sub().feedback, x.sub().gradedBy], ['graded', 80, 'Good', x.w.instructor]);
  assert.match(String(ok.headers['cache-control']), /no-store/);
  assert.equal((await x.grade(x.T.admin, id, 90)).statusCode, 200, 'admins follow the existing role policy');
}));

test('grading: a submission of another assignment cannot be graded through this one', route(async () => {
  const x = assignmentWorld();
  await x.submit(x.T.student);
  const foreign = newId();
  x.db.rows('assignments').push({ _id: new ObjectId(foreign), courseId: x.w.C, title: 'Other', instructions: 'x', points: 10 });
  const res = await call(x.r.grade, { method: 'POST', token: x.T.instructor, body: { submissionId: String(x.sub()._id), grade: 100 }, query: { id: foreign } });
  assert.equal(res.statusCode, 404);
  assert.equal(x.sub().grade, null);
}));

test('regrading: only the difference in points moves, up or down; a repeat moves nothing; history keeps every grade', route(async () => {
  const x = assignmentWorld();
  await x.submit(x.T.student);
  const base = x.points(); // participation points on first submission
  assert.equal(base, 50);
  const id = String(x.sub()._id);
  await x.grade(x.T.instructor, id, 80);
  assert.equal(x.points(), base + 40);
  await x.grade(x.T.instructor, id, 100, 'Better');
  assert.equal(x.points(), base + 50);
  await x.grade(x.T.instructor, id, 50, 'Corrected');
  assert.equal(x.points(), base + 25);
  await x.grade(x.T.instructor, id, 50, 'Corrected');
  assert.equal(x.points(), base + 25, 'the same grade again');
  await x.grade(x.T.instructor, id, 0, 'Zero is a grade');
  assert.equal(x.points(), base);
  const history = x.sub().gradeHistory;
  assert.deepEqual(history.map((h) => [h.previousGrade, h.grade, h.pointsAwarded]), [[null, 80, 40], [80, 100, 50], [100, 50, 25], [50, 50, 25], [50, 0, 0]]);
  assert.ok(history.every((h) => h.gradedBy === x.w.instructor && h.gradedAt instanceof Date));
  assert.equal(x.sub().pointsPending, undefined);
  assert.deepEqual(x.db.rows('users').find((u) => String(u._id) === x.w.student).pointAwardKeys, [], 'no award keys left behind');
}));

test('grading: two graders at once: one wins, the other is told; history and points stay consistent', route(async () => {
  const x = assignmentWorld();
  await x.submit(x.T.student);
  const id = String(x.sub()._id);
  const col = x.db.collection('assignmentSubmissions');
  const findOne = col.findOne.bind(col);
  let injected = false;
  col.findOne = async (...args) => {
    const row = await findOne(...args);
    if (!injected) { // The second grader saves between this read and this write.
      injected = true;
      await x.grade(x.T.admin, id, 60, 'First');
    }
    return row;
  };
  const late = await x.grade(x.T.instructor, id, 90, 'Second');
  assert.deepEqual([late.statusCode, late.body.code], [409, 'submission_changed']);
  assert.equal(x.sub().gradeHistory.length, 1);
  assert.equal(x.sub().grade, 60);
  assert.equal(x.points(), 50 + 30);
}));

test('grading: a grade applies only to the work the grader read; a resubmission in between is a conflict', route(async () => {
  const x = assignmentWorld();
  await x.submit(x.T.student, 'first');
  const id = String(x.sub()._id);
  const col = x.db.collection('assignmentSubmissions');
  const findOne = col.findOne.bind(col);
  let injected = false;
  col.findOne = async (...args) => {
    const row = await findOne(...args);
    if (!injected) {
      injected = true;
      col.findOne = findOne;
      await new Promise((resolve) => setTimeout(resolve, 2));
      await x.submit(x.T.student, 'rewritten');
    }
    return row;
  };
  const res = await x.grade(x.T.instructor, id, 90);
  assert.deepEqual([res.statusCode, res.body.code], [409, 'submission_changed']);
  assert.equal(x.sub().grade, null);
  assert.equal(x.sub().submissionText, 'rewritten');
}));

test('resubmission: the earlier version and its grade are kept, the grade no longer stands for the new work, points are not repeated', route(async () => {
  const x = assignmentWorld();
  await x.submit(x.T.student, 'v1');
  const id = String(x.sub()._id);
  await x.grade(x.T.instructor, id, 80, 'Good start');
  const before = x.points();
  assert.equal(before, 90);
  assert.equal((await x.submit(x.T.student, 'v2')).statusCode, 200);
  assert.equal(x.points(), before, 'no participation points for a resubmission');
  const row = x.sub();
  assert.deepEqual([row.status, row.grade, row.feedback, row.submissionText, row.pointsAwarded], ['submitted', null, null, 'v2', 40]);
  assert.deepEqual([row.previousVersions.length, row.previousVersions[0].submissionText, row.previousVersions[0].grade, row.previousVersions[0].feedback, row.previousVersions[0].pointsAwarded], [1, 'v1', 80, 'Good start', 40]);
  assert.equal(row.gradeHistory.length, 1, 'the grading history is untouched');
  await x.grade(x.T.instructor, id, 90, 'Improved');
  assert.equal(x.points(), before + 5, 'only the difference');
  assert.deepEqual(x.sub().gradeHistory.map((h) => [h.previousGrade, h.grade]), [[null, 80], [80, 90]]);
  await x.submit(x.T.student, 'v3');
  await x.grade(x.T.instructor, id, 90, 'Same');
  assert.equal(x.points(), before + 5);
  assert.equal(x.sub().previousVersions.length, 2);
}));

test('legacy submissions: a grade from before Phase 9 is honoured, so a resubmission and regrade never pay twice', route(async () => {
  for (const status of ['graded', 'submitted']) { // Before Phase 9 a resubmission set 'submitted' and kept the grade.
    const x = assignmentWorld();
    await x.submit(x.T.student, 'old');
    const row = x.sub();
    Object.assign(row, { status, grade: 80, feedback: 'Old feedback', gradedBy: x.w.instructor });
    x.db.rows('users').find((u) => String(u._id) === x.w.student).points = 90; // 50 + 40 already paid
    await x.submit(x.T.student, 'new');
    assert.deepEqual([x.sub().pointsAwarded, x.sub().previousVersions[0].grade, x.sub().previousVersions[0].feedback], [40, 80, 'Old feedback'], status);
    await x.grade(x.T.instructor, String(row._id), 100);
    assert.equal(x.points(), 90 + 10, `${status}: the difference, not 50 again`);
    assert.equal(x.sub().gradeHistory[0].previousGrade, 80);
  }
  const direct = assignmentWorld();
  await direct.submit(direct.T.student);
  Object.assign(direct.sub(), { status: 'graded', grade: 60 });
  direct.db.rows('users').find((u) => String(u._id) === direct.w.student).points = 80;
  await direct.grade(direct.T.instructor, String(direct.sub()._id), 60);
  assert.equal(direct.points(), 80, 'regrading a legacy grade to the same value pays nothing');
  assert.equal(G.previouslyAwarded({ status: 'submitted', grade: null }, 50), 0);
  assert.equal(G.previouslyAwarded({ pointsAwarded: 7, grade: 100 }, 50), 7);
}));

test('submission points: one award however many parallel first submissions arrive', route(async () => {
  const x = assignmentWorld({ racy: true });
  const results = await Promise.all(Array.from({ length: 6 }, () => x.submit(x.T.student, 'same')));
  assert.ok(results.every((r) => r.statusCode === 200));
  assert.equal(x.db.rows('assignmentSubmissions').length, 1, 'index A2');
  assert.equal(x.points(), 50);
}));

test('late work: accepted and flagged; a date without a time means the whole day; the student sees the flag', route(async () => {
  assert.equal(G.isLate(null, T0), false);
  assert.equal(G.isLate('not a date', T0), false);
  assert.equal(G.isLate('2026-11-10', new Date('2026-11-10T23:59:00Z')), false);
  assert.equal(G.isLate('2026-11-10', new Date('2026-11-11T00:00:01Z')), true);
  assert.equal(G.isLate('2026-11-10T09:00:00Z', T0), true);
  const late = assignmentWorld({ dueDate: new Date(Date.now() - 3600000).toISOString() });
  const res = await late.submit(late.T.student);
  assert.deepEqual([res.statusCode, res.body.late, late.sub().late], [200, true, true]);
  const onTime = assignmentWorld({ dueDate: new Date(Date.now() + 3600000).toISOString() });
  assert.equal((await onTime.submit(onTime.T.student)).body.late, false);
  const list = await call(late.r.assignments, { token: late.T.student, query: { lessonId: late.w.l2 } });
  assert.equal(list.body[0].submission.late, true);
}));

test('feedback: the student is notified, sees their own grade only, and a failed notification undoes nothing', route(async () => {
  const x = assignmentWorld();
  await x.submit(x.T.student);
  await x.submit(x.T.other);
  const id = String(x.sub()._id);
  await x.grade(x.T.instructor, id, 75, 'Nice');
  assert.deepEqual([x.notifications.length, x.notifications[0].userId, x.notifications[0].type, x.notifications[0].metadata.grade], [1, x.w.student, 'task_feedback', 75]);
  const own = await call(x.r.assignments, { token: x.T.student, query: { lessonId: x.w.l2 } });
  assert.deepEqual([own.body[0].submission.grade, own.body[0].submission.feedback, own.body[0].submission.status], [75, 'Nice', 'graded']);
  assert.equal(JSON.stringify(own.body).includes('gradeHistory'), false, 'grader records are not for students');
  assert.equal(JSON.stringify(own.body).includes('gradedBy'), false);
  const other = await call(x.r.assignments, { token: x.T.other, query: { lessonId: x.w.l2 } });
  assert.equal(other.body[0].submission.grade, null);
  const y = assignmentWorld({ withNotifications: async () => { throw new Error('notify down'); } });
  await y.submit(y.T.student);
  const res = await y.grade(y.T.instructor, String(y.sub()._id), 70);
  assert.deepEqual([res.statusCode, y.sub().grade], [200, 70]);
}));

test('points recovery: an interrupted award is finished once by the next grade, by a resubmission or by the sweep', route(async () => {
  const interrupted = async () => {
    const x = assignmentWorld();
    await x.submit(x.T.student);
    const restore = failCall(x.db, 'users', 'updateOne');
    const res = await x.grade(x.T.instructor, String(x.sub()._id), 80);
    restore();
    assert.equal(res.statusCode, 500);
    assert.deepEqual([x.sub().grade, x.sub().pointsPending.delta, x.points()], [80, 40, 50]);
    return x;
  };
  const a = await interrupted();
  await a.grade(a.T.instructor, String(a.sub()._id), 80);
  assert.equal(a.points(), 90);
  assert.equal(a.sub().pointsPending, undefined);

  const b = await interrupted();
  await b.submit(b.T.student, 'v2');
  assert.equal(b.points(), 90);

  const c = await interrupted();
  assert.deepEqual(await G.sweepPendingPoints(c.db), { pending: 1, settled: 0, failed: 0 }, 'read-only by default');
  assert.equal(c.points(), 50);
  assert.deepEqual(await G.sweepPendingPoints(c.db, { apply: true }), { pending: 1, settled: 1, failed: 0 });
  assert.equal(c.points(), 90);
  assert.deepEqual(await G.sweepPendingPoints(c.db), { pending: 0, settled: 0, failed: 0 });
}));

test('points recovery: a crash after the points moved but before the record says so never pays twice', route(async () => {
  const x = assignmentWorld();
  await x.submit(x.T.student);
  const restore = failCall(x.db, 'assignmentSubmissions', 'updateOne', 2); // 1: the grade; 2: clearing pointsPending
  const res = await x.grade(x.T.instructor, String(x.sub()._id), 80);
  restore();
  assert.equal(res.statusCode, 500);
  assert.equal(x.points(), 90, 'already moved');
  assert.ok(x.sub().pointsPending, 'not yet recorded as done');
  await G.settlePendingPoints(x.db, x.sub());
  assert.equal(x.points(), 90, 'the key on the user stops a second award');
  assert.equal(x.sub().pointsPending, undefined);
  assert.deepEqual(x.db.rows('users').find((u) => String(u._id) === x.w.student).pointAwardKeys, []);
}));

test('points recovery: a failure at the first submission keeps the work and pays the participation points once', route(async () => {
  const x = assignmentWorld();
  const restore = failCall(x.db, 'users', 'updateOne');
  assert.equal((await x.submit(x.T.student)).statusCode, 500);
  restore();
  assert.equal(x.sub().submissionText, 'my work');
  assert.equal(x.points(), 0);
  assert.equal((await x.submit(x.T.student, 'my work')).statusCode, 200);
  assert.equal(x.points(), 50);
  assert.equal(x.db.rows('assignmentSubmissions').length, 1);
}));

test('assignments: staff cannot submit; a locked lesson\'s assignment is out of reach', route(async () => {
  const x = assignmentWorld();
  assert.equal((await x.submit(x.T.instructor)).statusCode, 403);
  assert.equal((await x.submit(x.T.outsider)).statusCode, 403);
  assert.equal((await x.submit(x.T.unpaid)).statusCode, 403);
  assert.equal((await x.submit(x.T.student, '   ')).statusCode, 400);
  assert.equal(x.db.rows('assignmentSubmissions').length, 0);
}));

// ---------------------------------------------------------------------------
// Indexes, permissions and the shape of the code
// ---------------------------------------------------------------------------

test('indexes: A1-A6 are defined as documented; A5 is partial so rows from before Phase 9 cannot collide', () => {
  assert.deepEqual(ASSESSMENT_INDEXES.map((d) => [d.id, d.collection, d.options.name, Boolean(d.options.unique)]), [
    ['A1', 'quizAttempts', 'quiz_attempt_user_lesson_number', true],
    ['A2', 'assignmentSubmissions', 'assignment_submission_user_assignment', true],
    ['A3', 'quizAttempts', 'quiz_attempt_lesson_results', false],
    ['A4', 'quizzes', 'quiz_lesson', true],
    ['A5', 'quizScores', 'quiz_score_attempt', true],
    ['A6', 'quizScores', 'quiz_score_user_recent', false],
  ]);
  const a5 = ASSESSMENT_INDEXES[4];
  assert.deepEqual(a5.options.partialFilterExpression, { attemptId: { $type: 'string' } });
  assert.equal(compareAssessmentIndex(a5, []), 'missing');
  assert.equal(compareAssessmentIndex(a5, [{ name: 'quiz_score_attempt', key: { attemptId: 1 }, unique: true, partialFilterExpression: { attemptId: { $type: 'string' } } }]), 'present');
  assert.equal(compareAssessmentIndex(a5, [{ name: 'quiz_score_attempt', key: { attemptId: 1 }, unique: true }]), 'conflicting', 'a plain unique index would fail on old rows');
  assert.equal(compareAssessmentIndex(a5, [{ name: 'other', key: { attemptId: 1 } }]), 'conflicting');
  for (const definition of ASSESSMENT_INDEXES.filter((d) => d.options.unique)) assert.ok(definition.duplicateKey, `${definition.id} checks duplicates first`);
});

test('permissions: the application role covers every assessment and learning collection', () => {
  const { READ_WRITE_COLLECTIONS } = require('../lib/app-database-role');
  for (const name of ['quizAttempts', 'quizAttemptCounters', 'quizScores', 'quizzes', 'assignments', 'assignmentSubmissions', 'learningDays', 'learningMinutes']) {
    assert.ok(READ_WRITE_COLLECTIONS.includes(name), name);
  }
});

test('rate limits and caching are on every assessment write path', () => {
  const quiz = read('pages/api/quizzes/[lessonId].ts');
  const attempts = read('pages/api/quizzes/[lessonId]/attempts/index.ts');
  const attempt = read('pages/api/quizzes/[lessonId]/attempts/[attemptId].ts');
  assert.match(quiz, /allowRequest\(assessmentLimiter/);
  assert.match(quiz, /allowRequest\(authoringLimiter/);
  assert.match(attempts, /allowRequest\(assessmentLimiter/);
  assert.match(attempt, /allowRequest\(assessmentLimiter/);
  assert.match(read('pages/api/assignments/[id]/submit.ts'), /allowRequest\(assessmentLimiter/);
  assert.match(read('pages/api/assignments/[id]/grade.ts'), /allowRequest\(authoringLimiter/);
  assert.match(read('pages/api/assignments/index.ts'), /allowRequest\(authoringLimiter/);
  assert.match(read('pages/api/assignments/[id].ts'), /allowRequest\(authoringLimiter/);
  for (const source of [quiz, attempts, attempt, read('pages/api/quizzes/history.ts'), read('pages/api/assignments/[id]/grade.ts'), read('pages/api/assignments/[id]/submit.ts')]) {
    assert.match(source, /setPrivateNoStore\(res\)/);
  }
});

test('the browser never decides: the client sends answers only and shows a result only after the server confirmed it', () => {
  const ui = read('components/Quiz.tsx');
  assert.equal(/\{ answers \}\);/.test(ui), true);
  for (const banned of ['score:', 'passed:', 'deadlineAt:']) {
    assert.equal(ui.split('apiClient.').slice(1).some((call) => call.split(')')[0].includes(banned)), false, banned);
  }
  assert.match(ui, /Not submitted yet/);
  assert.match(ui, /serverNow/);
});
