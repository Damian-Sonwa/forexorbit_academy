/**
 * Real MongoDB: the production index state of Forex_elearning (read-only inspection, 2026-11-20)
 * rebuilt in a disposable _test database, then the three index scripts and the A4 in-place unique
 * conversion run against it. Uses only MONGODB_URI_TEST (tests/helpers/mongo-test-db.js); skipped
 * without it. Never production.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { openTestDatabase, testDatabaseConfig } = require('../helpers/mongo-test-db');
const { run: runLearning } = require('../../scripts/learning-indexes');
const { run: runAssessment } = require('../../scripts/assessment-indexes');
const { run: runTrading } = require('../../scripts/trading-indexes');
const { assessmentIndexReport } = require('../../lib/assessment-indexes');
const conversion = require('../../lib/unique-conversion');
const { run: runConversion } = require('../../scripts/quiz-lesson-unique');
const { saveQuizVersion } = require('../../lib/quiz-store');

const config = testDatabaseConfig();
const skip = config.ok ? false : config.reason;
const quiet = () => {};

// tradingReviews joined with the trade reviews (T19, T20).
const MISSING_COLLECTIONS = ['assignmentSubmissions', 'learningDays', 'learningMinutes', 'marketCheckpoints', 'marketIncidents', 'marketQuotes', 'quizAttempts', 'tradingOperations', 'tradingOrders', 'tradingPositions', 'tradingReviews'];

/** The production shape: the same collections, indexes and (approximate) document counts. */
async function productionShape(db) {
  const many = (n, make) => Array.from({ length: n }, (_, i) => make(i));
  await db.collection('progress').insertMany(many(108, (i) => ({ userId: `u${i % 40}`, courseId: `c${Math.floor(i / 40)}`, progress: i })));
  await db.collection('progress').createIndex({ userId: 1, courseId: 1 }, { name: 'progress_user_course', unique: true });
  await db.collection('lessons').insertMany(many(34, (i) => ({ courseId: `c${i % 3}`, order: i })));
  await db.collection('lessons').createIndex({ courseId: 1, order: 1 }, { name: 'lessons_course_order' });
  await db.collection('quizScores').insertMany(many(76, (i) => ({ userId: `u${i % 30}`, courseId: 'c0', score: i })));
  await db.collection('quizScores').createIndex({ userId: 1, courseId: 1 }, { name: 'quizscores_user_course' });
  await db.collection('quizzes').insertMany(many(34, (i) => ({ lessonId: `lesson${i}`, questions: [], version: 1 })));
  await db.collection('quizzes').createIndex({ lessonId: 1 }, { name: 'quizzes_lesson' });
  await db.collection('notifications').insertOne({ userId: 'u1', createdAt: new Date() });
  await db.createCollection('demoTradeJournal');
  await db.collection('users').insertMany(many(59, (i) => ({ role: i % 5 ? 'student' : 'instructor', points: i })));
  await db.collection('tradingLedger').insertOne({ accountId: 'a1', seq: 1 });
  for (const name of ['tradingAccounts', 'tradingAccountSlots', 'demoTasks', 'demoTaskSubmissions']) await db.collection(name).insertOne({ seeded: true });
}

/** Every collection, its options and its indexes: what "nothing changed" is checked against. */
async function snapshot(db) {
  const out = {};
  for (const info of (await db.listCollections().toArray()).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    out[info.name] = { options: info.options, indexes: (await db.collection(info.name).indexes()).map((i) => omit(i, ['v'])).sort((a, b) => (a.name < b.name ? -1 : 1)) };
  }
  return out;
}

async function fresh() {
  const conn = await openTestDatabase();
  await conn.reset();
  await productionShape(conn.db);
  return conn;
}

async function closing(conn, fn) {
  try {
    await fn();
  } finally {
    await conn.reset().catch(() => {});
    await conn.close();
  }
}

const omit = (object, keys) => Object.fromEntries(Object.entries(object).filter(([k]) => !keys.includes(k)));
const indexNames = async (db, name) => (await db.collection(name).indexes()).map((i) => i.name).sort();

test('real MongoDB, production shape: every report is read-only; L1/L2/L3 are satisfied, A4 conflicts, 10 collections are reported missing and not created', { skip }, async () => {
  const conn = await fresh();
  await closing(conn, async () => {
    const before = await snapshot(conn.db);
    const lines = [];
    const learning = await runLearning(conn.db, { mode: 'plan', log: (l) => lines.push(l) });
    const assessment = await runAssessment(conn.db, { apply: false, log: (l) => lines.push(l) });
    const trading = await runTrading(conn.db, { apply: false, log: (l) => lines.push(l) });
    assert.deepEqual(await snapshot(conn.db), before, 'no index and no collection changed');
    assert.deepEqual([learning.ok, assessment.ok, trading.ok], [true, false, true]);
    const by = Object.fromEntries([...learning.states, ...assessment.report, ...trading.report].map((r) => [r.id, r]));
    assert.deepEqual(['L1', 'L2', 'L3', 'A4'].map((id) => [by[id].state, by[id].satisfiedBy || null]), [
      ['present', 'progress_user_course'], ['present', 'lessons_course_order'], ['present', 'quizscores_user_course'], ['conflicting', null],
    ]);
    assert.deepEqual([...new Set(Object.values(by).filter((r) => r.createsCollection).map((r) => r.collection))].sort(), MISSING_COLLECTIONS);
    assert.ok(lines.includes('Would create collections: learningDays, learningMinutes.'));
    assert.ok(lines.some((l) => /^A4 quizzes quiz_lesson: conflicting \(quizzes_lesson \(same key\): unique false \(required true\)\)/.test(l)));
    assert.ok(lines.includes('Blocked: A4. --apply refuses and builds nothing until they are resolved.'));
  });
});

test('real MongoDB, production shape: trading and learning apply build only the missing indexes, never a second index on an existing key; assessment refuses whole while A4 conflicts; reruns are idempotent', { skip, timeout: 120000 }, async () => {
  const conn = await fresh();
  await closing(conn, async () => {
    const db = conn.db;
    const trading = await runTrading(db, { apply: true, log: quiet });
    assert.equal(trading.ok, true);
    assert.equal(trading.built.length, 20); // T19 and T20 (trade reviews) joined the plan
    const learning = await runLearning(db, { mode: 'apply', log: quiet });
    assert.deepEqual([learning.ok, learning.built], [true, ['L4', 'L5', 'L6', 'L7', 'L8', 'L9']]);
    assert.deepEqual(await indexNames(db, 'progress'), ['_id_', 'perf_progress_course_rank', 'progress_user_course'], 'no perf_progress_user next to the unique prefix');
    assert.deepEqual(await indexNames(db, 'lessons'), ['_id_', 'lessons_course_order']);
    assert.deepEqual(await indexNames(db, 'quizScores'), ['_id_', 'quizscores_user_course']);
    const ttl = (await db.collection('learningMinutes').indexes()).find((i) => i.name === 'ttl_learning_minutes');
    assert.equal(ttl.expireAfterSeconds, 7776000);

    const beforeAssessment = await snapshot(db);
    const refused = await runAssessment(db, { apply: true, log: quiet });
    assert.deepEqual([refused.ok, refused.built, refused.blocked], [false, [], ['A4']]);
    assert.deepEqual(await snapshot(db), beforeAssessment, 'a conflict changes nothing, creates no collection');
    assert.ok(!(await db.listCollections({ name: 'quizAttempts' }).toArray()).length);

    for (const again of [await runTrading(db, { apply: true, log: quiet }), await runLearning(db, { mode: 'apply', log: quiet })]) {
      assert.deepEqual([again.ok, again.built], [true, []]);
    }
    const names = (await db.listCollections().toArray()).map((c) => c.name);
    for (const c of ['learningDays', 'learningMinutes', 'marketCheckpoints', 'marketIncidents', 'marketQuotes', 'tradingOperations', 'tradingOrders', 'tradingPositions']) {
      assert.ok(names.includes(c), `${c} was created by apply`);
      assert.equal(await db.collection(c).countDocuments({}), 0, `${c} is empty`);
    }
  });
});

test('real MongoDB: genuine mismatches on an existing key are refused and nothing is built anywhere', { skip }, async () => {
  for (const [collection, key, options] of [
    ['lessons', { courseId: 1, order: 1 }, { unique: true }],
    ['lessons', { courseId: 1, order: 1 }, { sparse: true }],
    ['lessons', { courseId: 1, order: 1 }, { partialFilterExpression: { order: { $gte: 0 } } }],
    ['lessons', { courseId: 1, order: 1 }, { collation: { locale: 'en', strength: 2 } }],
    ['learningMinutes', { at: 1 }, { expireAfterSeconds: 60 }],
  ]) {
    const conn = await openTestDatabase();
    await closing(conn, async () => {
      await conn.reset();
      await conn.db.collection(collection).createIndex(key, { name: 'someone_elses', ...options });
      const before = await snapshot(conn.db);
      const result = await runLearning(conn.db, { mode: 'apply', log: quiet });
      assert.equal(result.ok, false, JSON.stringify(options));
      assert.deepEqual(await snapshot(conn.db), before, `${JSON.stringify(options)}: nothing built`);
    });
  }
});

test('real MongoDB: learning rollback drops only what the script built; production indexes and equivalents stay', { skip }, async () => {
  const conn = await fresh();
  await closing(conn, async () => {
    await runLearning(conn.db, { mode: 'apply', log: quiet });
    const result = await runLearning(conn.db, { mode: 'rollback', log: quiet });
    assert.deepEqual(result.dropped, ['L4', 'L5', 'L6', 'L7', 'L8', 'L9']);
    assert.deepEqual(await indexNames(conn.db, 'progress'), ['_id_', 'progress_user_course']);
    assert.deepEqual(await indexNames(conn.db, 'lessons'), ['_id_', 'lessons_course_order']);
    assert.deepEqual(await indexNames(conn.db, 'quizScores'), ['_id_', 'quizscores_user_course']);
  });
});

test('real MongoDB, A4: prepare, interruption, abort, prepare, convert; the index is present throughout, stays quizzes_lesson, and nothing else changes', { skip, timeout: 120000 }, async () => {
  const conn = await fresh();
  await closing(conn, async () => {
    const db = conn.db;
    const others = async () => {
      const s = await snapshot(db);
      s.quizzes.indexes = s.quizzes.indexes.map((i) => omit(i, ['unique', 'prepareUnique']));
      return s;
    };
    const baseline = await others();
    const quizzes = db.collection('quizzes');
    const stage = async () => (await conversion.inspectConversion(db)).stage;

    const report = await runConversion(db, { step: 'report', log: quiet });
    assert.deepEqual([report.ok, report.state.stage, report.state.data], [true, 'non-unique', { documents: 34, duplicateGroups: 0, nullOrMissing: 0, wrongType: 0, clean: true }]);
    assert.equal((await runConversion(db, { step: 'convert', log: quiet })).ok, false, 'convert before prepare is refused');
    assert.equal(await stage(), 'non-unique');

    const prepared = await conversion.prepareUnique(db);
    assert.deepEqual([prepared.ok, prepared.changed, prepared.after.stage], [true, true, 'prepared']);
    await assert.rejects(quizzes.insertOne({ lessonId: 'lesson3' }), (e) => e.code === 11000, 'prepared: a new duplicate is rejected');
    await assert.rejects(quizzes.updateOne({ lessonId: 'lesson4' }, { $set: { lessonId: 'lesson5' } }), (e) => e.code === 11000);
    assert.deepEqual((await conversion.prepareUnique(db)).changed, false, 'prepare again: nothing to do');

    // Interruption: the process stops here. A new connection sees the prepared state and resumes.
    await conn.client.close();
    const resumed = await openTestDatabase();
    try {
      const rdb = resumed.db;
      assert.equal((await conversion.inspectConversion(rdb)).stage, 'prepared');
      const aborted = await conversion.abortPrepare(rdb);
      assert.deepEqual([aborted.ok, aborted.after.stage], [true, 'non-unique']);
      assert.equal((await conversion.prepareUnique(rdb)).after.stage, 'prepared');
      const converted = await conversion.convertToUnique(rdb);
      assert.deepEqual([converted.ok, converted.changed, converted.after.stage], [true, true, 'unique']);
      const index = (await rdb.collection('quizzes').indexes()).find((i) => i.name === 'quizzes_lesson');
      assert.deepEqual([index.key, index.unique, index.prepareUnique], [{ lessonId: 1 }, true, undefined]);
      await assert.rejects(rdb.collection('quizzes').insertOne({ lessonId: 'lesson7' }), (e) => e.code === 11000, 'unique: a duplicate is rejected');
      const after = await snapshot(rdb);
      after.quizzes.indexes = after.quizzes.indexes.map((i) => omit(i, ['unique', 'prepareUnique']));
      assert.deepEqual(after, baseline, 'no other index, collection or option changed');
      assert.equal(await rdb.collection('quizzes').countDocuments({}), 34, 'no document added or removed');

      assert.deepEqual((await conversion.convertToUnique(rdb)).changed, false, 'convert again: nothing to do');
      const noUndo = await conversion.abortPrepare(rdb);
      assert.deepEqual([noUndo.ok, noUndo.changed], [false, false], 'a unique index is not made non-unique');

      // The assessment script now accepts quizzes_lesson for A4 and builds the rest.
      const a4 = (await assessmentIndexReport(rdb)).find((r) => r.id === 'A4');
      assert.deepEqual([a4.state, a4.satisfiedBy], ['present', 'quizzes_lesson']);
      const applied = await runAssessment(rdb, { apply: true, log: quiet });
      assert.deepEqual([applied.ok, applied.built], [true, ['A1', 'A2', 'A3', 'A5', 'A6', 'A7']]); // A7: Phase 12
      assert.deepEqual(await indexNames(rdb, 'quizzes'), ['_id_', 'quizzes_lesson'], 'no quiz_lesson next to it');
      assert.deepEqual((await runAssessment(rdb, { apply: true, log: quiet })).built, []);
    } finally {
      await resumed.reset().catch(() => {});
      await resumed.close();
    }
  });
});

test('real MongoDB, A4: unclean data is refused before any change; a duplicate that slips in before prepare keeps the index prepared', { skip }, async () => {
  for (const [label, row] of [['duplicate', { lessonId: 'lesson1' }], ['missing', { title: 'no lesson' }], ['null', { lessonId: null }], ['wrong type', { lessonId: 42 }]]) {
    const conn = await fresh();
    await closing(conn, async () => {
      await conn.db.collection('quizzes').insertOne(row);
      const before = await snapshot(conn.db);
      const result = await conversion.prepareUnique(conn.db);
      assert.deepEqual([result.ok, result.changed], [false, false], label);
      assert.match(result.reason, /data not clean/);
      assert.deepEqual(await snapshot(conn.db), before, `${label}: nothing changed`);
    });
  }
  // The race: a duplicate written between the preflight and collMod prepareUnique (simulated by
  // preparing directly). prepareUnique does not check existing keys; the conversion refuses, the
  // server's dry run refuses too, and the index stays prepared until the duplicate is resolved.
  const conn = await fresh();
  await closing(conn, async () => {
    await conn.db.collection('quizzes').insertOne({ lessonId: 'lesson1' });
    await conn.db.command({ collMod: 'quizzes', index: { name: 'quizzes_lesson', prepareUnique: true } });
    const result = await conversion.convertToUnique(conn.db);
    assert.deepEqual([result.ok, result.changed], [false, false]);
    await assert.rejects(conn.db.command({ collMod: 'quizzes', index: { name: 'quizzes_lesson', unique: true }, dryRun: true }), (e) => e.codeName === 'CannotConvertIndexToUnique' && e.errorResponse.violations.length === 1);
    assert.equal((await conversion.inspectConversion(conn.db)).stage, 'prepared');
    assert.equal((await conversion.abortPrepare(conn.db)).after.stage, 'non-unique', 'abort returns to the start');
  });
});

test('real MongoDB, A4: simultaneous first saves of one lesson make one quiz with the unique index; without it they can make several', { skip, timeout: 120000 }, async (t) => {
  const conn = await openTestDatabase();
  await closing(conn, async () => {
    await conn.reset();
    const countAfterRace = async (unique) => {
      await conn.db.collection('quizzes').drop().catch(() => {});
      await conn.db.collection('quizzes').createIndex({ lessonId: 1 }, { name: 'quizzes_lesson', ...(unique ? { unique: true } : {}) });
      let docs = 0;
      let errors = 0;
      for (let round = 0; round < 30; round += 1) {
        const lessonId = `race${round}`;
        const results = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => saveQuizVersion(conn.db.collection('quizzes'), { lessonId, set: { questions: [i] }, now: new Date() })));
        errors += results.filter((r) => r.status === 'rejected').length;
        docs += await conn.db.collection('quizzes').countDocuments({ lessonId });
      }
      return { docs, errors };
    };
    const withIndex = await countAfterRace(true);
    assert.deepEqual(withIndex, { docs: 30, errors: 0 }, 'one quiz per lesson, every save succeeded');
    const versions = await conn.db.collection('quizzes').aggregate([{ $group: { _id: null, v: { $sum: '$version' } } }]).toArray();
    assert.equal(versions[0].v, 300, 'every save counted as a version');
    const without = await countAfterRace(false);
    t.diagnostic(`without a unique index: ${without.docs} quizzes for 30 lessons`);
    assert.ok(without.docs >= 30);
  });
});

test('real MongoDB: history pages and the A3 results queue are read in index order (no in-memory SORT), with the app\'s own sorts', { skip, timeout: 120000 }, async () => {
  const { ObjectId } = require('mongodb');
  const { ensureTradingIndexes } = require('../../lib/trading/indexes');
  const { ensureAssessmentIndexes } = require('../../lib/assessment-indexes');
  const conn = await openTestDatabase();
  await closing(conn, async () => {
    await conn.reset();
    const db = conn.db;
    const accounts = [new ObjectId(), new ObjectId()];
    const at = (i) => new Date(Date.UTC(2026, 0, 1) + Math.floor(i / 3) * 60000); // ties on purpose
    const many = (n, make) => Array.from({ length: n }, (_, i) => make(i));
    await db.collection('tradingOrders').insertMany(many(600, (i) => ({ userId: 'u', accountId: accounts[i % 2], status: 'filled', createdAt: at(i) })));
    await db.collection('tradingPositions').insertMany(many(600, (i) => ({ userId: 'u', accountId: accounts[i % 2], status: 'closed', openedAt: at(i) })));
    await db.collection('tradingOperations').insertMany(many(600, (i) => ({ _id: `op${i}`, userId: 'u', status: 'done', type: i % 2 ? 'fill' : 'close', executedAt: at(i) })));
    await db.collection('tradingLedger').insertMany(many(600, (i) => ({ accountId: accounts[i % 2], seq: i, createdAt: at(i) })));
    await db.collection('quizScores').insertMany(many(600, (i) => ({ userId: 'u', createdAt: at(i) })));
    await db.collection('quizAttempts').insertMany(many(600, (i) => ({ userId: `s${i}`, lessonId: 'l', number: 1, status: i % 4 ? 'submitted' : 'expired', submittedAt: at(i) })));
    assert.equal((await ensureTradingIndexes(db, { apply: true })).ok, true);
    assert.equal((await ensureAssessmentIndexes(db, { apply: true })).ok, true);
    const stages = (plan) => {
      const out = [];
      const walk = (s) => { if (!s) return; out.push(s.stage); (s.inputStages || []).forEach(walk); walk(s.inputStage); };
      walk(plan.queryPlanner.winningPlan.queryPlan || plan.queryPlanner.winningPlan);
      return out;
    };
    // The exact filters and sorts of lib/trading/views.js and lib/quiz-attempts.js.
    for (const [label, collection, filter, sort, index] of [
      ['orders history', 'tradingOrders', { userId: 'u' }, { createdAt: -1, _id: -1 }, 'trading_order_user_recent'],
      ['closed positions', 'tradingPositions', { userId: 'u', status: 'closed' }, { openedAt: -1, _id: -1 }, 'trading_position_user_recent'],
      ['ledger, two accounts', 'tradingLedger', { accountId: { $in: accounts } }, { createdAt: -1, seq: -1 }, 'trading_ledger_account_recent'],
      ['executions', 'tradingOperations', { userId: 'u', status: 'done', type: { $in: ['fill', 'close'] } }, { executedAt: -1, _id: 1 }, 'trading_operation_user_recent'],
      ['quiz history (A6)', 'quizScores', { userId: 'u' }, { createdAt: -1, _id: -1 }, 'quiz_score_user_recent'],
      ['results queue (A3)', 'quizAttempts', { lessonId: 'l', status: { $in: ['submitted', 'expired'] } }, { submittedAt: -1, _id: -1 }, 'quiz_attempt_lesson_results'],
    ]) {
      const plan = await db.collection(collection).find(filter).sort(sort).skip(25).limit(25).explain('executionStats');
      assert.ok(!stages(plan).includes('SORT'), `${label}: no in-memory sort (${stages(plan).join(' > ')})`);
      assert.match(JSON.stringify(plan.queryPlanner.winningPlan), new RegExp(index), label);
      assert.ok(plan.executionStats.totalDocsExamined <= 60, `${label}: reads about one page, not the history (${plan.executionStats.totalDocsExamined})`);
    }
  });
});
