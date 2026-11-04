/**
 * Regression tests for findings closed in the final Phase 9 and Phase 10 remediation.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ObjectId } = require('mongodb');

const { readLessonDetail } = require('../lib/course-lesson-list');
const { LOGIN_RULES, createAuthLimiter } = require('../lib/auth-rate-limit');
const { TRADING_INDEXES } = require('../lib/trading/indexes');
const { READ_WRITE_COLLECTIONS, APPEND_ONLY_COLLECTIONS } = require('../lib/app-database-role');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

/** A database that applies `questions.*: 0` projections and records what each quiz read asked for. */
function lessonDb(role) {
  const userId = new ObjectId();
  const courseId = new ObjectId();
  const lessonId = new ObjectId();
  const reads = [];
  const quiz = { lessonId: String(lessonId), settings: { status: 'published' }, questions: [{ id: 'q1', question: 'Q', options: ['a', 'b'], correctAnswer: 1, explanation: 'why', points: 1 }] };
  const rows = {
    users: { _id: userId, email: 'x@example.test', role, status: 'approved' },
    lessons: { _id: lessonId, courseId: String(courseId), title: 'L', order: 1, content: 'c' },
    courses: { _id: courseId, title: 'C', instructorId: String(userId), price: 0, status: 'published' },
    progress: { userId: String(userId), courseId: String(courseId), completedLessons: [], status: 'active' },
  };
  const empty = { project: () => empty, sort: () => empty, limit: () => empty, skip: () => empty, toArray: async () => [] };
  const db = {
    collection: (name) => ({
      findOne: async (filter, options = {}) => {
        if (name !== 'quizzes') return rows[name] || null;
        const projection = options.projection || {};
        reads.push(projection);
        const hide = Object.keys(projection).filter((k) => projection[k] === 0).map((k) => k.replace('questions.', ''));
        return { ...quiz, questions: quiz.questions.map((q) => Object.fromEntries(Object.entries(q).filter(([k]) => !hide.includes(k)))) };
      },
      find: (filter) => (name === 'lessons' ? { ...empty, toArray: async () => [rows.lessons] } : empty),
      countDocuments: async () => 0,
    }),
  };
  return { db, reads, userId: String(userId), lessonId: String(lessonId) };
}

test('P9-22: a student lesson read never asks the database for the answer key', async () => {
  const x = lessonDb('student');
  const result = await readLessonDetail(x.db, { userId: x.userId, lessonId: x.lessonId, env: {} });
  assert.ok(x.reads.length >= 1, `the quiz was read (status ${result.status})`);
  for (const projection of x.reads) {
    assert.equal(projection['questions.correctAnswer'], 0);
    assert.equal(projection['questions.explanation'], 0);
  }
  assert.doesNotMatch(JSON.stringify(result.body), /correctAnswer|explanation/);
});

test('P9-22: the course instructor still gets the authoring view, with the key', async () => {
  const x = lessonDb('instructor');
  const result = await readLessonDetail(x.db, { userId: x.userId, lessonId: x.lessonId, env: {} });
  assert.equal(x.reads.length, 2, 'a second read, only after the reader is known to be allowed');
  assert.equal(result.body.quiz.questions[0].correctAnswer, 1);
});

test('P9-29: a request refused by the wider rule spends nothing on the narrower ones', async () => {
  const counts = new Map();
  const db = {
    collection: () => ({
      findOneAndUpdate: async (filter) => {
        counts.set(filter._id, (counts.get(filter._id) || 0) + 1);
        return { count: counts.get(filter._id) };
      },
    }),
  };
  const limiter = createAuthLimiter(LOGIN_RULES);
  const env = { SHARED_RATE_LIMIT: 'mongodb', JWT_SECRET: 'test-only' };
  const now = Date.UTC(2026, 2, 4, 12, 1);
  // The address is already at its limit, through other accounts.
  for (let i = 0; i < 30; i += 1) await limiter.consume({ ip: '203.0.113.5', email: `user${i}@example.test`, getDb: async () => db, env, now });
  // Another instance: its in-process count is empty, so the shared rules are what refuse this.
  const refused = await createAuthLimiter(LOGIN_RULES).consume({ ip: '203.0.113.5', email: 'target@example.test', getDb: async () => db, env, now });
  assert.equal(refused.status, 429);
  const scopes = [...counts.keys()].filter((id) => id.startsWith('login-email') && counts.get(id) > 1);
  assert.deepEqual(scopes, []);
  assert.equal([...counts.keys()].filter((id) => id.startsWith('login-email-ip')).length, 30, 'the refused request reached no narrower rule');
});

test('P10-28: every indexed collection is in the app role, and demo tasks and submissions are covered', () => {
  const covered = new Set([...READ_WRITE_COLLECTIONS, ...APPEND_ONLY_COLLECTIONS]);
  for (const index of TRADING_INDEXES) assert.ok(covered.has(index.collection), index.collection);
  const ids = new Set(TRADING_INDEXES.map((i) => i.id));
  assert.equal(ids.size, TRADING_INDEXES.length, 'ids are unique');
  for (const name of ['demoTasks', 'demoTaskSubmissions', 'marketCheckpoints', 'marketIncidents']) {
    assert.ok(TRADING_INDEXES.some((i) => i.collection === name), name);
  }
  assert.ok(TRADING_INDEXES.find((i) => i.collection === 'marketCheckpoints').options.unique);
});

test('P10-29: a general task notifies all students in one call', () => {
  const source = read('pages/api/demo-trading/tasks.ts');
  assert.match(source, /createNotificationsForUsers\(students\.map/);
  const loop = source.slice(source.indexOf('for (const student of students)'));
  assert.doesNotMatch(loop.slice(0, loop.indexOf('catch')), /createNotification/);
});

test('P10-30: journal entries have no grade fields; grades belong to submissions', () => {
  const source = read('pages/api/demo-trading/journal.ts');
  assert.match(source, /\['grade', 'feedback', 'reviewedAt'\]/);
  assert.doesNotMatch(source, /entry\.grade|entry\.feedback|entry\.reviewedAt/);
});

test('P10-31: one practice page, and every practice list is bounded', () => {
  const page = read('pages/demo-trading.tsx');
  assert.match(page, /destination: '\/student-dashboard'/);
  assert.ok(page.length < 600, 'the duplicate page is gone');
  assert.match(read('pages/student-dashboard.tsx'), /useState<ActiveSection>\('live'\)/);
  for (const file of ['journal.ts', 'tasks.ts', 'submissions.ts', 'submissions/student.ts', 'tasks/[id]/submissions.ts']) {
    assert.match(read(`pages/api/demo-trading/${file}`), /listPage/, file);
    assert.match(read(`pages/api/demo-trading/${file}`), /\.limit\(/, file);
  }
});

test('only the Super Admin can suspend or resume the market; the seed is never selected for a response', () => {
  const route = read('pages/api/admin/market.ts');
  assert.match(route, /req\.user!\.role !== 'superadmin'/);
  assert.match(route, /withAuth\(handler, \['admin', 'superadmin'\]\)/);
  assert.doesNotMatch(route, /\.seed\b/);
});
