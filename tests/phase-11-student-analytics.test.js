/**
 * Phase 11: student dashboard and analytics (backend).
 *
 * Uses the in-memory stand-in (tests/helpers/memory-db.js), not a real MongoDB: these cover the
 * calculation rules, access rules, isolation and read-only behaviour, not driver or index behaviour.
 * Route tests call the real handlers with the session stubbed to a chosen student.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Decimal128, ObjectId } = require('mongodb');

const { memoryDb } = require('./helpers/memory-db');
const { loadModule, mockResponse } = require('./helpers/ts-loader');
const A = require('../lib/student-analytics');
const { performanceFrom, accountOverview } = require('../lib/trading/analytics');
const { recordLessonCompletion } = require('../lib/course-progress');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const D = (text) => Decimal128.fromString(text);
const NOW = new Date('2026-11-21T10:00:00Z');
const daysAgo = (n, hour = 10) => new Date(Date.UTC(2026, 10, 21 - n, hour, 0, 0));
const id = () => new ObjectId();
const hex = (o) => o.toHexString();

/** Records a write attempt on any collection method that changes data. */
function watched(db) {
  const writes = [];
  const methods = ['insertOne', 'insertMany', 'updateOne', 'updateMany', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndUpdate', 'findOneAndDelete', 'bulkWrite'];
  return {
    writes,
    collection(name) {
      const col = db.collection(name);
      return new Proxy(col, {
        get(target, prop) {
          if (methods.includes(prop)) return (...args) => { writes.push(`${name}.${prop}`); return target[prop](...args); };
          return typeof target[prop] === 'function' ? target[prop].bind(target) : target[prop];
        },
      });
    },
  };
}

function world() {
  const A_ID = id();
  const B_ID = id();
  const a = hex(A_ID);
  const b = hex(B_ID);
  const c1 = id(); const c2 = id(); const c3 = id(); const c4 = id();
  const l1 = id(); const l2 = id(); const l3 = id(); const l4 = id(); const l5 = id(); const l6 = id(); const l7 = id();
  const lessons = [
    { _id: l1, courseId: hex(c1), title: 'Candles', order: 1 },
    { _id: l2, courseId: hex(c1), title: 'Trends', order: 2 },
    { _id: l3, courseId: hex(c1), title: 'Advanced <b>risk</b>', order: 3, requiredLevel: 'advanced' },
    { _id: l4, courseId: hex(c2), title: 'Pips', order: 1 },
    { _id: l5, courseId: hex(c2), title: 'Lots', order: 2 },
    { _id: l6, courseId: hex(c3), title: 'Draft lesson', order: 1 },
    { _id: l7, courseId: hex(c4), title: 'Locked course lesson 1', order: 1 },
  ];
  const l8 = id();
  lessons.push({ _id: l8, courseId: hex(c4), title: 'Locked course lesson 2', order: 2 });
  const quiz = (lesson, settings = {}, extra = {}) => ({ _id: id(), lessonId: hex(lesson), questions: [{ id: 'aaaaaaaaaaaa', question: 'Q', options: ['a', 'b'], correctAnswer: 1 }], settings: { status: 'published', maxAttempts: null, passingPercent: 70, availableFrom: null, availableUntil: null, ...settings }, ...extra });
  const db = memoryDb({
    users: [{ _id: A_ID, name: 'Ada Lovelace', role: 'student' }, { _id: B_ID, name: 'Bob Byte', role: 'student' }],
    courses: [
      { _id: c1, title: 'Forex <i>Basics</i>', status: 'published', difficulty: 'beginner' },
      { _id: c2, title: 'Pip Maths', status: 'published', difficulty: 'beginner' },
      { _id: c3, title: 'Hidden draft', status: 'draft', difficulty: 'beginner' },
      { _id: c4, title: 'Unpaid course', status: 'published', difficulty: 'beginner' },
    ],
    lessons,
    progress: [
      // c1: one lesson done (dated), last viewed l1, paid.
      { _id: id(), userId: a, courseId: hex(c1), completedLessons: [hex(l1)], lessonCompletedAt: { [hex(l1)]: daysAgo(2, 23) }, enrolledAt: daysAgo(10), lastLessonId: hex(l1), lastViewedAt: daysAgo(1), progress: 33 },
      // c2: complete; l4 dated, l5 completed before Phase 11 (undated).
      { _id: id(), userId: a, courseId: hex(c2), completedLessons: [hex(l4), hex(l5)], lessonCompletedAt: { [hex(l4)]: daysAgo(5) }, enrolledAt: daysAgo(20), completedAt: daysAgo(4), progress: 100, lastViewedAt: daysAgo(4) },
      // draft course: not visible; withdrawn duplicate of c1: ignored.
      { _id: id(), userId: a, courseId: hex(c3), completedLessons: [hex(l6)], enrolledAt: daysAgo(3) },
      { _id: id(), userId: a, courseId: hex(c4), completedLessons: [], enrolledAt: daysAgo(1), withdrawnAt: daysAgo(0) },
      // Student B.
      { _id: id(), userId: b, courseId: hex(c1), completedLessons: [hex(l1), hex(l2)], lessonCompletedAt: { [hex(l1)]: daysAgo(1), [hex(l2)]: daysAgo(1) }, enrolledAt: daysAgo(2), lastViewedAt: daysAgo(1) },
    ],
    userCourseAccess: [{ userId: a, courseId: hex(c1), paid: true }, { userId: a, courseId: hex(c2), paid: true }, { userId: b, courseId: hex(c1), paid: true }],
    learningDays: [
      { _id: `${a}:2026-11-20`, userId: a, day: '2026-11-20', minutes: 30 },
      { _id: `${a}:2026-11-19`, userId: a, day: '2026-11-19', minutes: 15 },
      { _id: `${a}:2026-07-01`, userId: a, day: '2026-07-01', minutes: 5 },
      { _id: `${b}:2026-11-20`, userId: b, day: '2026-11-20', minutes: 999 },
    ],
    quizzes: [
      quiz(l1),                                                   // A attempted: failed once -> retake
      quiz(l2, { maxAttempts: 1 }),                               // A used its single attempt -> excluded
      quiz(l3),                                                   // prerequisite-blocked (advanced in beginner course)
      quiz(l4, { availableFrom: new Date('2026-12-01T00:00:00Z') }), // opens soon (course c2)
      quiz(l5, { status: 'draft' }),                              // draft -> excluded
      quiz(l7),                                                   // course c4 withdrawn -> excluded
    ],
    quizAttempts: [
      { _id: id(), userId: a, lessonId: hex(l1), number: 1, status: 'submitted', result: { passed: false, percent: 40 } },
      { _id: id(), userId: a, lessonId: hex(l2), number: 1, status: 'submitted', result: { passed: false, percent: 50 } },
      { _id: id(), userId: b, lessonId: hex(l1), number: 1, status: 'submitted', result: { passed: true, percent: 90 } },
    ],
    quizScores: [
      { _id: id(), userId: a, lessonId: hex(l1), courseId: hex(c1), percentage: 40, passed: false, attemptNumber: 1, createdAt: daysAgo(3), answers: [1] },
      { _id: id(), userId: a, lessonId: hex(l2), courseId: hex(c1), percentage: 50, passed: false, attemptNumber: 1, createdAt: daysAgo(2) },
      { _id: id(), userId: a, lessonId: hex(l4), courseId: hex(c2), percentage: 80, passed: true, attemptNumber: 1, createdAt: daysAgo(6) },
      { _id: id(), userId: a, lessonId: hex(l5), courseId: hex(c2), score: 100, createdAt: daysAgo(7) }, // legacy row: no pass mark
      { _id: id(), userId: b, lessonId: hex(l1), courseId: hex(c1), percentage: 90, passed: true, createdAt: daysAgo(1) },
    ],
    assignments: [
      { _id: id(), courseId: hex(c1), lessonId: hex(l1), title: 'Mark the trend', dueDate: '2026-11-19', points: 10 }, // overdue
      { _id: id(), courseId: hex(c1), lessonId: hex(l2), title: 'Submitted one', dueDate: '2026-12-30' },
      { _id: id(), courseId: hex(c2), lessonId: null, title: 'Course essay', dueDate: '2026-12-24' },                  // course-level, c2 paid -> visible
      { _id: id(), courseId: hex(c3), lessonId: hex(l6), title: 'Draft course work' },
    ],
    certificates: [{ _id: id(), userId: a, courseId: hex(c2), issuedAt: daysAgo(3) }, { _id: id(), userId: b, courseId: hex(c1), issuedAt: daysAgo(1) }],
  });
  const assignmentRows = db.collection('assignments').docs;
  db.collection('assignmentSubmissions').docs.push(
    { _id: id(), userId: a, assignmentId: String(assignmentRows[1]._id), submittedAt: daysAgo(1), status: 'submitted' },
    { _id: id(), userId: b, assignmentId: String(assignmentRows[0]._id), submittedAt: daysAgo(1), status: 'submitted' },
  );
  return { db, a, b, c1, c2, c3, c4, l1, l2, l3, l4, l5, l7, assignmentRows };
}

const pos = (userId, { status = 'closed', pl = '0.00', instrument = 'EUR_USD', closedAt = daysAgo(1), side = 'buy', closeReason = 'manual' } = {}) => ({
  _id: id(), accountId: id(), userId, orderId: id(), instrument, side, units: 1000,
  entry: D('1.10000'), stopLoss: D('1.09000'), takeProfit: null, margin: D('36.67'), plannedRisk: D('10.00'), status,
  openedAt: new Date(closedAt.getTime() - 3600000),
  ...(status === 'closed' ? { exit: D('1.10100'), realizedPl: D(pl), closeReason, closedAt } : {}),
});

// ---------------------------------------------------------------------------
// Learning overview, courses, continue learning
// ---------------------------------------------------------------------------

test('overview: active enrollments in visible courses only; lesson-weighted overall progress', async () => {
  const { db, a } = world();
  const d = await A.studentDashboard(db, { userId: a, name: 'Ada Lovelace', now: NOW, env: {} });
  assert.deepEqual(d.overview, { enrolled: 2, completedCourses: 1, inProgressCourses: 1, notStartedCourses: 0, completedLessons: 3, totalLessons: 5, overallPercent: 60 });
  assert.equal(d.student.firstName, 'Ada');
  assert.ok(!d.courses.some((c) => c.title === 'Hidden draft'), 'draft course left out');
  assert.ok(!d.courses.some((c) => c.title === 'Unpaid course'), 'withdrawn enrollment left out');
});

test('continue learning: the most recently studied incomplete course, at the right lesson', async () => {
  const { db, a, c1, l2 } = world();
  const d = await A.studentDashboard(db, { userId: a, now: NOW, env: {} });
  assert.equal(d.continue.courseId, hex(c1));
  assert.equal(d.continue.lessonId, hex(l2), 'next open, unfinished lesson after the last viewed (completed) one');
  assert.equal(d.continue.href, `/courses/${hex(c1)}/lessons/${hex(l2)}`);
  const card1 = d.courses.find((c) => c.courseId === hex(c1));
  const card2 = d.courses.find((c) => c.title === 'Pip Maths');
  assert.deepEqual([card1.action, card1.href, card1.completedLessons, card1.totalLessons], ['continue', d.continue.href, 1, 3]);
  assert.deepEqual([card2.action, card2.status, card2.href], ['review', 'completed', `/courses/${card2.courseId}`]);
  assert.ok(!('lessons' in card1), 'lesson lists are not sent with course cards');
});

test('empty student: zeros, no continue, a browse recommendation, no milestones', async () => {
  const db = memoryDb({});
  const d = await A.studentDashboard(db, { userId: hex(id()), now: NOW, env: {} });
  assert.equal(d.continue, null);
  assert.equal(d.overview.overallPercent, null);
  assert.deepEqual(d.recommendations.map((r) => r.id), ['browse']);
  assert.equal(d.milestones.filter((m) => m.achieved).length, 0);
  assert.equal(d.upcoming.items.length, 0);
  assert.equal(d.activity.events.length, 0);
  assert.equal(d.trading.hasAccount, false);
  assert.equal(d.trading.performance.closedTrades, 0);
});

// ---------------------------------------------------------------------------
// Learning series
// ---------------------------------------------------------------------------

test('learning series: every day present, zero-filled, scoped to the student, Lagos calendar days', async () => {
  const { db, a } = world();
  const s = await A.studentLearningSeries(db, { userId: a, range: '7', now: NOW });
  assert.equal(s.buckets.length, 7);
  assert.equal(s.buckets[6].key, '2026-11-21');
  assert.equal(s.buckets.find((x) => x.key === '2026-11-20').minutes, 30, "student B's 999 minutes are not counted");
  assert.equal(s.totals.minutes, 45);
  // 23:00 UTC on 19 Nov is 00:00 on 20 Nov in Lagos (UTC+1).
  assert.equal(s.buckets.find((x) => x.key === '2026-11-20').lessons, 1);
  assert.equal(s.buckets.find((x) => x.key === '2026-11-19').lessons, 0);
  assert.equal(s.undatedCompletions, 1, 'l5 was completed before completion times were recorded');
  assert.ok(s.buckets.every((x) => typeof x.minutes === 'number' && typeof x.lessons === 'number'));
});

test('learning series: 30 / 90 / all ranges, monthly buckets for all, invalid range falls back to 30', async () => {
  const { db, a } = world();
  assert.equal((await A.studentLearningSeries(db, { userId: a, range: '30', now: NOW })).buckets.length, 30);
  assert.equal((await A.studentLearningSeries(db, { userId: a, range: '90', now: NOW })).buckets.length, 90);
  const all = await A.studentLearningSeries(db, { userId: a, range: 'all', now: NOW });
  assert.equal(all.granularity, 'month');
  assert.deepEqual(all.buckets.map((x) => x.key), ['2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
  assert.equal(all.buckets[0].minutes, 5);
  assert.equal(all.buckets[1].minutes, 0, 'a month without activity is a real zero');
  assert.equal(all.totals.minutes, 50);
  assert.equal(A.parseRange('365'), '30');
  assert.equal(A.parseRange({ $gt: '' }), '30');
});

test('lesson completion time: recorded once, never moved by a repeat', async () => {
  const userId = hex(id());
  const courseId = hex(id());
  const lessonId = hex(id());
  const db = memoryDb({ progress: [{ _id: id(), userId, courseId, completedLessons: [] }], lessons: [{ _id: new ObjectId(lessonId), courseId, order: 1 }] });
  const first = new Date('2026-11-20T08:00:00Z');
  await recordLessonCompletion(db, { userId, courseId, lessonId, now: first });
  await recordLessonCompletion(db, { userId, courseId, lessonId, now: new Date('2026-11-21T08:00:00Z') });
  const row = db.collection('progress').docs[0];
  assert.equal(row.lessonCompletedAt[lessonId].getTime(), first.getTime());
  assert.deepEqual(row.completedLessons, [lessonId]);
});

// ---------------------------------------------------------------------------
// Assessments
// ---------------------------------------------------------------------------

test('assessment performance: own attempts only; pass rate over attempts with a pass mark; no answers', async () => {
  const { db, a } = world();
  const d = await A.studentDashboard(db, { userId: a, now: NOW, env: {} });
  const s = d.assessments;
  assert.equal(s.attempts, 4);
  assert.equal(s.quizzesAttempted, 4);
  assert.equal(s.quizzesPassed, 1);
  assert.equal(s.passRate, 33.3, '1 passed of 3 attempts with a pass mark (the legacy row has none)');
  assert.equal(s.averagePercent, 67.5);
  assert.deepEqual(s.trend.map((t) => t.percent), [100, 80, 40, 50], 'oldest first');
  assert.equal(s.recent[0].lessonTitle, 'Trends');
  assert.ok(!JSON.stringify(d).includes('correctAnswer'), 'no answer key anywhere in the dashboard');
  assert.ok(!('passedLessonIds' in s), 'internal sets are not sent');
});

test('upcoming: open and eligible work only, with the right statuses', async () => {
  const { db, a, l1, l4 } = world();
  const d = await A.studentDashboard(db, { userId: a, now: NOW, env: {} });
  const byId = Object.fromEntries(d.upcoming.items.map((i) => [i.id, i]));
  assert.equal(byId[`quiz:${hex(l1)}`].status, 'retake_available', 'failed once, attempts unlimited');
  assert.equal(byId[`quiz:${hex(l4)}`].status, 'opens_soon');
  const ids = Object.keys(byId);
  assert.equal(ids.filter((k) => k.startsWith('quiz:')).length, 2, 'single-attempt quiz used up, prerequisite-blocked, draft and withdrawn-course quizzes are left out');
  const assignments = d.upcoming.items.filter((i) => i.kind === 'assignment');
  assert.deepEqual(assignments.map((i) => [i.title, i.status]).sort(), [['Course essay', 'not_submitted'], ['Mark the trend', 'overdue']]);
  assert.equal(assignments.find((i) => i.title === 'Mark the trend').dueAt, '2026-11-19T23:59:59.999Z', 'a date-only due date is the end of that day');
  assert.equal(d.upcoming.items[0].status, 'overdue', 'urgent work first');
  assert.equal(d.upcoming.retakes, 1);
  for (const item of d.upcoming.items) assert.ok(!('questions' in item) && !('correctAnswer' in item));
});

test('upcoming: a locked lesson (not paid) and its quiz never appear', async () => {
  const { db, a, c1, l2 } = world();
  db.collection('userCourseAccess').docs.splice(0, 1); // A loses the c1 entitlement: l2, l3 lock
  const d = await A.studentDashboard(db, { userId: a, now: NOW, env: {} });
  assert.ok(!d.upcoming.items.some((i) => i.lessonId === hex(l2)));
  assert.ok(!d.upcoming.items.some((i) => i.title === 'Submitted one'));
  assert.ok(d.upcoming.items.some((i) => i.courseId === hex(c1) && i.lessonId === d.upcoming.items.find((x) => x.title === 'Mark the trend').lessonId), 'the free first lesson stays open');
});

// ---------------------------------------------------------------------------
// Milestones, recommendations, activity
// ---------------------------------------------------------------------------

test('milestones: achieved only when the records satisfy them, with dates only when recorded', async () => {
  const { db, a } = world();
  const d = await A.studentDashboard(db, { userId: a, now: NOW, env: {} });
  const m = Object.fromEntries(d.milestones.map((x) => [x.id, x]));
  assert.equal(m.first_course_started.achieved, true);
  assert.equal(m.first_course_started.at, daysAgo(20).toISOString());
  assert.equal(m.first_course_completed.at, daysAgo(4).toISOString());
  assert.equal(m.first_quiz_passed.at, daysAgo(6).toISOString());
  assert.equal(m.first_certificate.achieved, true);
  assert.equal(m.lessons_10.achieved, false);
  assert.deepEqual(m.lessons_10.progress, { current: 3, target: 10 });
  assert.equal(m.streak_7.achieved, false);
  assert.equal(m.first_practice_trade.achieved, false);
  assert.equal(m.first_practice_trade.at, null);
});

test('recommendations: deterministic, accessible, nothing already done', async () => {
  const { db, a, c1, l2 } = world();
  const d = await A.studentDashboard(db, { userId: a, now: NOW, env: {} });
  assert.equal(d.recommendations[0].id, 'resume');
  assert.equal(d.recommendations[0].href, `/courses/${hex(c1)}/lessons/${hex(l2)}`);
  assert.ok(d.recommendations.length <= 4);
  assert.ok(d.recommendations.some((r) => r.id.startsWith('assessment:assignment:')), 'the overdue assignment');
  assert.ok(d.recommendations.some((r) => r.id === 'practise'), 'lessons done but no practice trade yet');
  assert.ok(!d.recommendations.some((r) => r.href.includes('Hidden')));
  const again = await A.studentDashboard(db, { userId: a, now: NOW, env: {} });
  assert.deepEqual(again.recommendations, d.recommendations, 'same records, same recommendations');
});

test('activity: merged, newest first, own events only, paged within a bounded window', async () => {
  const { db, a, b } = world();
  db.collection('tradingPositions').docs.push(pos(a, { pl: '5.25', closedAt: daysAgo(0, 9) }), pos(b, { pl: '99.00', closedAt: daysAgo(0, 9) }));
  const page1 = await A.studentActivity(db, { userId: a, page: 1, limit: 5, now: NOW });
  assert.equal(page1.events.length, 5);
  const times = page1.events.map((e) => new Date(e.at).getTime());
  assert.deepEqual([...times].sort((x, y) => y - x), times);
  assert.equal(page1.events[0].type, 'trade_closed');
  assert.match(page1.events[0].detail, /^5\.25 USD · simulated$/);
  const page2 = await A.studentActivity(db, { userId: a, page: 2, limit: 5, now: NOW });
  const paged = [...page1.events, ...page2.events];
  assert.equal(new Set(paged.map((e) => e.id)).size, paged.length, 'no event repeats across pages');
  const all = (await A.studentActivity(db, { userId: a, page: 1, limit: 20, now: NOW })).events;
  assert.deepEqual(all.slice(0, 10).map((e) => e.id), paged.map((e) => e.id), 'pages are slices of one ordering');
  const text = JSON.stringify(all);
  assert.ok(!text.includes('99.00') && !text.includes('Hidden draft'), "no other student's or hidden-course events");
  const types = new Set(all.map((e) => e.type));
  for (const t of ['course_started', 'course_completed', 'lesson_completed', 'quiz_finished', 'assignment_submitted', 'certificate_earned', 'trade_closed']) assert.ok(types.has(t), t);
  const clamped = await A.studentActivity(db, { userId: a, page: 999, limit: 500, now: NOW });
  assert.deepEqual([clamped.limit, clamped.page], [20, 5], 'page size capped at 20 within the 100 most recent');
});

// ---------------------------------------------------------------------------
// Practice trading
// ---------------------------------------------------------------------------

test('trading performance: exact decimal results, wins/losses/breakeven, averages half-even', () => {
  const u = hex(id());
  const rows = [
    pos(u, { pl: '0.10', closedAt: daysAgo(3) }),
    pos(u, { pl: '0.20', closedAt: daysAgo(3) }),
    pos(u, { pl: '-0.05', instrument: 'GBP_USD', closedAt: daysAgo(2), closeReason: 'stop_loss' }),
    pos(u, { pl: '0.00', instrument: 'GBP_USD', closedAt: daysAgo(1) }),
    pos(u, { pl: '0.01', closedAt: daysAgo(1) }),
  ];
  const p = performanceFrom(rows);
  assert.deepEqual([p.closedTrades, p.wins, p.losses, p.breakeven], [5, 3, 1, 1]);
  assert.equal(p.netRealized, '0.26', 'exact: no floating-point drift');
  assert.equal(p.winRate, '60.00');
  assert.equal(p.averageWin, '0.10', '0.31 / 3 = 0.1033 -> 0.10 (half-even)');
  assert.equal(p.averageLoss, '-0.05');
  assert.equal(p.bestTrade, '0.20');
  assert.equal(p.worstTrade, '-0.05');
  assert.deepEqual(p.byInstrument.map((r) => [r.instrument, r.trades, r.net, r.winRate]), [['EUR_USD', 3, '0.31', '100.00'], ['GBP_USD', 2, '-0.05', '0.00']]);
  assert.deepEqual(p.series.map((s) => [s.day, s.trades, s.net, s.cumulative]), [['2026-11-18', 2, '0.30', '0.30'], ['2026-11-19', 1, '-0.05', '0.25'], ['2026-11-20', 2, '0.01', '0.26']]);
  assert.deepEqual(p.closeReasons, { manual: 4, stop_loss: 1 });
  const none = performanceFrom([]);
  assert.deepEqual([none.winRate, none.averageWin, none.averageLoss, none.netRealized], [null, null, null, '0.00']);
});

test('trading analytics: open positions are never trades; other students never counted; reviews counted', async () => {
  const { db, a, b } = world();
  db.collection('tradingPositions').docs.push(pos(a, { pl: '12.34' }), pos(a, { status: 'open' }), pos(a, { status: 'void' }), pos(b, { pl: '-500.00' }));
  db.collection('tradingReviews').docs.push({ _id: 'review:x', userId: a });
  const t = await A.studentTrading(db, { userId: a, now: NOW, env: {} });
  assert.equal(t.performance.closedTrades, 1);
  assert.equal(t.performance.netRealized, '12.34');
  assert.deepEqual(t.reviews, { reviewed: 1, pending: 0 });
  assert.equal(t.recent.length, 2, 'open and closed shown in recent; void left out');
  assert.equal(t.simulated, true);
  assert.match(t.marketLabel, /SIMULATED/);
  assert.equal(t.hasAccount, false, 'no active account slot');
});

test('trading account overview: the stored account valued without running the engine', async () => {
  const u = hex(id());
  const accountId = id();
  const db = memoryDb({
    tradingAccountSlots: [{ _id: u, activeAccountId: accountId }],
    tradingAccounts: [{ _id: accountId, userId: u, currency: 'USD', status: 'active', generation: 1, startingBalance: D('10000.00'), balance: D('10012.34'), peakBalance: D('10012.34'), maxDrawdown: D('0.00') }],
    tradingPositions: [{ ...pos(u, { status: 'open' }), accountId }],
  });
  const w = watched(db);
  const o = await accountOverview(w, u, { now: NOW, env: {} });
  assert.equal(o.account.balance, '10012.34');
  assert.equal(o.account.virtual, true);
  assert.equal(o.openPositions, 1);
  assert.equal(o.account.equity, null, 'no simulated quote available: equity is not invented');
  assert.deepEqual(w.writes, [], 'no write of any kind');
});

test('read-only: building the whole dashboard writes nothing', async () => {
  const { db, a } = world();
  db.collection('tradingPositions').docs.push(pos(a, { pl: '1.00' }), pos(a, { status: 'open' }));
  const w = watched(db);
  await A.studentDashboard(w, { userId: a, now: NOW, env: {} });
  await A.studentActivity(w, { userId: a, page: 2, now: NOW });
  await A.studentLearningSeries(w, { userId: a, range: 'all', now: NOW });
  await A.studentTrading(w, { userId: a, now: NOW, env: {} });
  assert.deepEqual(w.writes, []);
});

// ---------------------------------------------------------------------------
// Routes: authentication, roles, isolation
// ---------------------------------------------------------------------------

function loadRoute(file, db) {
  const seen = {};
  const stubs = {
    'lib/auth-middleware': { withAuth: (handler, roles) => { seen.roles = roles; return handler; } },
    'lib/mongodb': { getDb: async () => db },
    'lib/content-rate-limit': { allowRequest: async () => { seen.limited = (seen.limited || 0) + 1; return true; }, dashboardLimiter: {} },
  };
  const handler = loadModule(file, stubs).default;
  return { handler, seen };
}

test('routes: students only, GET only, private, rate limited', async () => {
  const { db, a } = world();
  for (const file of ['pages/api/student/dashboard.ts', 'pages/api/student/analytics/learning.ts', 'pages/api/student/analytics/activity.ts', 'pages/api/student/analytics/trading.ts']) {
    const { handler, seen } = loadRoute(file, db);
    assert.deepEqual(seen.roles, ['student'], `${file}: students only (staff and unauthenticated refused by withAuth)`);
    const post = mockResponse();
    await handler({ method: 'POST', query: {}, user: { userId: a, role: 'student' } }, post);
    assert.equal(post.statusCode, 405, file);
    const res = mockResponse();
    await handler({ method: 'GET', query: {}, user: { userId: a, role: 'student' } }, res);
    assert.equal(res.statusCode, 200, file);
    assert.match(String(res.headers['cache-control']), /no-store/, file);
    assert.ok(seen.limited >= 1, `${file}: rate limited`);
  }
});

test('routes: a request cannot name another student (query parameters are ignored)', async () => {
  const { db, a, b } = world();
  const { handler } = loadRoute('pages/api/student/dashboard.ts', db);
  const res = mockResponse();
  await handler({ method: 'GET', query: { userId: b, studentId: b, range: '7' }, user: { userId: a, role: 'student' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.student.firstName, 'Ada');
  assert.equal(res.body.learning.series.totals.minutes, 45, "A's minutes, not B's");
  const activity = loadRoute('pages/api/student/analytics/activity.ts', db).handler;
  const r2 = mockResponse();
  await activity({ method: 'GET', query: { userId: b, page: '1', limit: '20' }, user: { userId: a, role: 'student' } }, r2);
  assert.ok(!JSON.stringify(r2.body).includes('Bob'));
  for (const file of ['pages/api/student/dashboard.ts', 'pages/api/student/analytics/learning.ts', 'pages/api/student/analytics/activity.ts', 'pages/api/student/analytics/trading.ts', 'lib/student-analytics-route.ts']) {
    assert.ok(!/req\.query\.(userId|studentId|accountId)/.test(read(file)), `${file} never reads an identity from the query`);
  }
});

test('routes: a failure returns a safe error body, never internals', async () => {
  const broken = { collection() { throw new Error('internal detail: secret-host-token'); } };
  const { handler } = loadRoute('pages/api/student/analytics/trading.ts', broken);
  const res = mockResponse();
  const origError = console.error;
  console.error = () => {};
  try {
    await handler({ method: 'GET', query: {}, user: { userId: hex(id()), role: 'student' } }, res);
  } finally {
    console.error = origError;
  }
  assert.equal(res.statusCode, 500);
  assert.ok(!JSON.stringify(res.body).includes('secret'));
});

test('no staff or role change: existing analytics boundaries stay as they were', () => {
  const route = read('lib/student-analytics-route.ts');
  assert.match(route, /\}, \['student'\]\);/);
  // Account approval stays Super Admin only and is untouched by this phase.
  const approval = read('lib/account-approval.js');
  assert.match(approval, /superadmin/);
  // The badges route no longer lets a student read another student's badges.
  const badges = read('pages/api/badges/index.ts');
  assert.match(badges, /req\.user!\.role === 'student'\s*\?\s*req\.user!\.userId/);
});

test('indexes: the dashboard reads use existing indexes; no new index or collection', () => {
  const learning = require('../lib/learning-indexes').LEARNING_INDEXES;
  const assessment = require('../lib/assessment-indexes').ASSESSMENT_INDEXES;
  const trading = require('../lib/trading/indexes').TRADING_INDEXES;
  const has = (list, collection, key) => list.some((d) => d.collection === collection && JSON.stringify(d.key) === JSON.stringify(key));
  assert.ok(has(learning, 'progress', { userId: 1 }));
  assert.ok(has(learning, 'learningDays', { userId: 1, day: -1 }));
  assert.ok(has(assessment, 'quizScores', { userId: 1, createdAt: -1, _id: -1 }));
  assert.ok(has(assessment, 'quizzes', { lessonId: 1 }));
  assert.ok(has(assessment, 'quizAttempts', { userId: 1, lessonId: 1, number: 1 }));
  assert.ok(has(assessment, 'assignmentSubmissions', { userId: 1, assignmentId: 1 }));
  assert.ok(has(trading, 'tradingPositions', { userId: 1, status: 1, openedAt: -1, _id: -1 }));
  assert.equal(trading.length, 20, 'no trading index added in Phase 11');
});
