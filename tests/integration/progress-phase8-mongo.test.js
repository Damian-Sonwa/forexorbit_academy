/**
 * Phase 8 learning progress against a real MongoDB server (npm run test:mongo:progress).
 *
 * What only a real server can show: the completion compare-and-set (a numeric path on an array)
 * under truly concurrent writes, the one-record-per-minute rule under parallel upserts (duplicate
 * key on _id), the newest-wins last-viewed update, the Phase 8 indexes (L8, L9) built by the
 * index script logic with the TTL option, and that the summary's queries use those indexes.
 *
 * Requires MONGODB_URI_TEST (an isolated server, never production) and MONGODB_DB_NAME_TEST
 * (must end in "_test"). Skipped when MONGODB_URI_TEST is unset.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');

const { openTestDatabase, testDatabaseConfig } = require('../helpers/mongo-test-db');
const { recordLessonCompletion } = require('../../lib/course-progress');
const activity = require('../../lib/learning-activity');
const { buildProgressSummary } = require('../../lib/progress-summary');
const { LEARNING_INDEXES } = require('../../lib/learning-indexes');
const { ENROLLMENT_INDEXES, ensureEnrollmentIndexes } = require('../../lib/enrollment-indexes');
const { run: runLearningIndexes } = require('../../scripts/learning-indexes');

const config = testDatabaseConfig();
const skip = config.ok ? false : config.reason;
const id = () => new ObjectId().toHexString();

async function fresh() {
  const conn = await openTestDatabase();
  await conn.reset();
  return conn;
}

test('real MongoDB: 24 concurrent completions of 12 lessons (two devices) store exactly 100% and one completedAt', { skip }, async () => {
  const conn = await fresh();
  try {
    await ensureEnrollmentIndexes(conn.db, { apply: true });
    assert.equal(ENROLLMENT_INDEXES[0].options.unique, true);
    for (let round = 0; round < 5; round += 1) {
      const [userId, courseId] = [id(), id()];
      const lessons = Array.from({ length: 12 }, () => new ObjectId());
      await conn.db.collection('lessons').insertMany(lessons.map((_id, order) => ({ _id, courseId, order, title: `L${order}` })));
      await conn.db.collection('progress').insertOne({ userId, courseId, progress: 0, completedLessons: [], active: true });
      // Every lesson twice (two tabs / devices), all at once.
      const calls = [...lessons, ...lessons].map((lesson) => recordLessonCompletion(conn.db, { userId, courseId, lessonId: String(lesson) }));
      await Promise.all(calls);
      const row = await conn.db.collection('progress').findOne({ userId, courseId });
      assert.equal(row.completedLessons.length, 12, `round ${round}: no duplicate ids`);
      assert.equal(row.progress, 100, `round ${round}: the stored percentage is never an older, lower value`);
      assert.ok(row.completedAt instanceof Date);
    }
  } finally {
    await conn.reset();
    await conn.close();
  }
});

test('real MongoDB: parallel activity signals in one minute make one minute; newest view wins', { skip }, async () => {
  const conn = await fresh();
  try {
    const [userId, courseId, early, late] = [id(), id(), id(), id()];
    await conn.db.collection('progress').insertOne({ userId, courseId, progress: 0, completedLessons: [], active: true });
    const now = new Date('2026-10-20T09:15:20Z');
    await Promise.all(Array.from({ length: 25 }, () => activity.recordActivity(conn.db, { userId, courseId, lessonId: early, event: 'heartbeat', now })));
    assert.equal(await conn.db.collection('learningMinutes').countDocuments({ userId }), 1);
    assert.equal((await conn.db.collection('learningDays').findOne({ userId })).minutes, 1);
    await activity.recordActivity(conn.db, { userId, courseId, lessonId: late, event: 'view', now: new Date('2026-10-20T09:30:00Z') });
    await activity.recordActivity(conn.db, { userId, courseId, lessonId: early, event: 'view', now: new Date('2026-10-20T09:20:00Z') });
    const row = await conn.db.collection('progress').findOne({ userId, courseId });
    assert.deepEqual([row.lastLessonId, row.lastViewedAt.toISOString(), row.lastActivityAt.toISOString()], [late, '2026-10-20T09:30:00.000Z', '2026-10-20T09:30:00.000Z']);
  } finally {
    await conn.reset();
    await conn.close();
  }
});

test('real MongoDB: the index script builds L8/L9 on collections that do not exist yet; the summary uses them', { skip }, async () => {
  const conn = await fresh();
  try {
    const plan = await runLearningIndexes(conn.db, { mode: 'plan', log: () => {} });
    assert.ok(plan.states.filter((s) => ['L8', 'L9'].includes(s.definition.id)).every((s) => s.state === 'no collection'));
    const applied = await runLearningIndexes(conn.db, { mode: 'apply', log: () => {} });
    assert.equal(applied.ok, true);
    const ttl = (await conn.db.collection('learningMinutes').indexes()).find((i) => i.name === 'ttl_learning_minutes');
    assert.equal(ttl.expireAfterSeconds, LEARNING_INDEXES.find((d) => d.id === 'L9').options.expireAfterSeconds);
    const again = await runLearningIndexes(conn.db, { mode: 'apply', log: () => {} });
    assert.equal(again.ok, true, 'idempotent');

    const userId = id();
    for (let d = 1; d <= 20; d += 1) {
      await activity.recordActivity(conn.db, { userId, courseId: id(), lessonId: id(), event: 'heartbeat', now: new Date(Date.UTC(2026, 9, d, 12)) });
    }
    const plan2 = await conn.db.collection('learningDays').find({ userId }).sort({ day: -1 }).explain('queryPlanner');
    assert.match(JSON.stringify(plan2.queryPlanner.winningPlan), /perf_learning_days_user/);
    const stats = await activity.learningStats(conn.db, userId, { now: new Date('2026-10-20T13:00:00Z') });
    assert.deepEqual([stats.totalMinutes, stats.streak.current, stats.streak.longest], [20, 20, 20]);
    const progressPlan = await conn.db.collection('progress').find({ userId }).explain('queryPlanner');
    assert.doesNotMatch(JSON.stringify(progressPlan.queryPlanner.winningPlan), /COLLSCAN/);
    const summary = await buildProgressSummary(conn.db, { userId, now: new Date('2026-10-20T13:00:00Z') });
    assert.equal(summary.learning.streak.current, 20);
  } finally {
    await conn.reset();
    await conn.close();
  }
});
