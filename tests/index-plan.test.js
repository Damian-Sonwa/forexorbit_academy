/**
 * Index equivalence and planning (lib/index-plan.js), the A4 in-place conversion guards
 * (lib/unique-conversion.js, scripts/quiz-lesson-unique.js) and the quiz save retry
 * (lib/quiz-store.js). In-memory stand-ins only; tests/integration/index-conflicts-mongo.test.js
 * runs the same paths on a real MongoDB.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const plan = require('../lib/index-plan');
const { LEARNING_INDEXES } = require('../lib/learning-indexes');
const { ASSESSMENT_INDEXES, ensureAssessmentIndexes } = require('../lib/assessment-indexes');
const { TRADING_INDEXES, ensureTradingIndexes } = require('../lib/trading/indexes');
const { run: runLearning } = require('../scripts/learning-indexes');
const conversion = require('../lib/unique-conversion');
const { parseArgs: parseConversionArgs } = require('../scripts/quiz-lesson-unique');
const { isDuplicateKey, saveQuizVersion } = require('../lib/quiz-store');

const ROOT = path.join(__dirname, '..');
const ID = { name: '_id_', key: { _id: 1 } };
const L2 = LEARNING_INDEXES.find((d) => d.id === 'L2');
const L9 = LEARNING_INDEXES.find((d) => d.id === 'L9');
const A4 = ASSESSMENT_INDEXES.find((d) => d.id === 'A4');
const A5 = ASSESSMENT_INDEXES.find((d) => d.id === 'A5');

// The read-only production inspection of Forex_elearning (MongoDB 8.0.39), index for index.
const PRODUCTION = {
  progress: [ID, { name: 'progress_user_course', key: { userId: 1, courseId: 1 }, unique: true }],
  lessons: [ID, { name: 'lessons_course_order', key: { courseId: 1, order: 1 } }],
  quizScores: [ID, { name: 'quizscores_user_course', key: { userId: 1, courseId: 1 } }],
  notifications: [ID],
  demoTradeJournal: [ID],
  users: [ID],
  quizzes: [ID, { name: 'quizzes_lesson', key: { lessonId: 1 } }],
  tradingLedger: [ID],
  tradingAccounts: [ID],
  tradingAccountSlots: [ID],
  demoTasks: [ID],
  demoTaskSubmissions: [ID],
};

/** A database stand-in: collections, indexes, a duplicate count per collection, recorded writes. */
function fakeDb(initial = PRODUCTION, { duplicates = {}, failOn = null } = {}) {
  const indexes = Object.fromEntries(Object.entries(initial).map(([name, list]) => [name, list.map((i) => ({ ...i }))]));
  const writes = [];
  return {
    indexes,
    writes,
    listCollections: () => ({ toArray: async () => Object.keys(indexes).map((name) => ({ name })) }),
    collection(name) {
      return {
        indexes: async () => (indexes[name] || []).map((i) => ({ ...i })),
        aggregate: () => ({ toArray: async () => (duplicates[name] ? [{ groups: duplicates[name] }] : []) }),
        createIndex: async (key, options) => {
          if (failOn === options.name) throw Object.assign(new Error('boom'), { codeName: 'IndexBuildAborted' });
          writes.push(['create', name, options.name]);
          if (!indexes[name]) { indexes[name] = [ID]; writes.push(['created collection', name]); }
          indexes[name].push({ key, ...options });
        },
        dropIndex: async (indexName) => { writes.push(['drop', name, indexName]); indexes[name] = indexes[name].filter((i) => i.name !== indexName); },
      };
    },
  };
}

const state = (definition, existing) => plan.classifyIndex(definition, existing);

// ---------------------------------------------------------------------------
// Part 2: equivalence
// ---------------------------------------------------------------------------

test('same key and options under the expected name: present, exact', () => {
  assert.deepEqual(state(L2, [ID, { name: 'perf_lessons_course_order', key: { courseId: 1, order: 1 } }]), { state: 'present', satisfiedBy: 'perf_lessons_course_order', coverage: 'exact', reasons: [] });
});

test('same key and options under another name: present, satisfied by the existing name (L2, L3 production)', () => {
  assert.deepEqual(state(L2, PRODUCTION.lessons), { state: 'present', satisfiedBy: 'lessons_course_order', coverage: 'equivalent', reasons: [] });
  const L3 = LEARNING_INDEXES.find((d) => d.id === 'L3');
  assert.deepEqual(state(L3, PRODUCTION.quizScores), { state: 'present', satisfiedBy: 'quizscores_user_course', coverage: 'equivalent', reasons: [] });
  // Values MongoDB may return as 1.0 or as a driver number object compare equal to 1.
  assert.equal(state(L2, [{ name: 'x', key: { courseId: 1.0, order: { toNumber: () => 1 } } }]).state, 'present');
});

test('same key, other options: conflicting with the reason, never equivalent', () => {
  const lessons = (extra) => [ID, { name: 'lessons_course_order', key: { courseId: 1, order: 1 }, ...extra }];
  for (const [extra, reason] of [
    [{ unique: true }, /unique true \(required false\)/],
    [{ sparse: true }, /sparse true/],
    [{ hidden: true }, /hidden true/],
    [{ partialFilterExpression: { order: { $gt: 0 } } }, /partialFilterExpression/],
    [{ collation: { locale: 'en', strength: 2 } }, /collation/],
    [{ expireAfterSeconds: 60 }, /expireAfterSeconds 60 \(required null\)/],
    [{ prepareUnique: true }, /prepareUnique true \(a unique conversion was started/],
  ]) {
    const result = state(L2, lessons(extra));
    assert.equal(result.state, 'conflicting', JSON.stringify(extra));
    assert.match(result.reasons.join(' '), reason);
  }
  // The simple collation is the absence of one.
  assert.equal(state(L2, lessons({ collation: { locale: 'simple' } })).state, 'present');
});

test('TTL: another expiry, or none, is a conflict; the same expiry under another name is present', () => {
  assert.equal(state(L9, [ID, { name: 'ttl_learning_minutes', key: { at: 1 }, expireAfterSeconds: 60 }]).state, 'conflicting');
  assert.equal(state(L9, [ID, { name: 'mine', key: { at: 1 } }]).state, 'conflicting');
  assert.deepEqual(state(L9, [ID, { name: 'mine', key: { at: 1 }, expireAfterSeconds: 7776000 }]).satisfiedBy, 'mine');
  assert.equal(L9.options.expireAfterSeconds, 7776000);
});

test('partial filter: the same filter in any key order is present; another filter is a conflict', () => {
  const same = { name: 'other', key: { attemptId: 1 }, unique: true, partialFilterExpression: { attemptId: { $type: 'string' } } };
  assert.equal(state(A5, [ID, same]).state, 'present');
  assert.equal(state(A5, [ID, { ...same, partialFilterExpression: { attemptId: { $exists: true } } }]).state, 'conflicting');
  assert.equal(state(A5, [ID, { ...same, partialFilterExpression: undefined }]).state, 'conflicting');
  const two = { ...ASSESSMENT_INDEXES[0], options: { ...A5.options, partialFilterExpression: { a: 1, b: 2 } }, key: { attemptId: 1 } };
  assert.equal(state(two, [ID, { ...same, partialFilterExpression: { b: 2, a: 1 } }]).state, 'present');
});

test('A4 production: the non-unique quizzes_lesson is a conflict (convert in place); once unique it is present under that name', () => {
  const before = state(A4, PRODUCTION.quizzes);
  assert.equal(before.state, 'conflicting');
  assert.match(before.reasons[0], /^quizzes_lesson \(same key\): unique false \(required true\)/);
  assert.equal(state(A4, [ID, { name: 'quizzes_lesson', key: { lessonId: 1 }, prepareUnique: true }]).state, 'conflicting', 'prepared is not done');
  assert.deepEqual(state(A4, [ID, { name: 'quizzes_lesson', key: { lessonId: 1 }, unique: true }]), { state: 'present', satisfiedBy: 'quizzes_lesson', coverage: 'equivalent', reasons: [] });
});

test('a missing index, another key order or direction: missing, not equivalent', () => {
  assert.equal(state(L2, [ID]).state, 'missing');
  assert.equal(state(L2, [ID, { name: 'x', key: { order: 1, courseId: 1 } }]).state, 'missing');
  assert.equal(state(L2, [ID, { name: 'x', key: { courseId: 1, order: -1 } }]).state, 'missing');
});

test('the definition name taken by another key is a conflict', () => {
  const result = state(L2, [ID, { name: 'perf_lessons_course_order', key: { courseId: 1 } }]);
  assert.equal(result.state, 'conflicting');
  assert.match(result.reasons[0], /exists with key/);
});

test('several candidates: the selection is deterministic (own name first, then by name)', () => {
  const a = { name: 'b_index', key: { courseId: 1, order: 1 } };
  const b = { name: 'a_index', key: { courseId: 1, order: 1 } };
  const own = { name: 'perf_lessons_course_order', key: { courseId: 1, order: 1 } };
  assert.equal(state(L2, [ID, a, b]).satisfiedBy, 'a_index');
  assert.equal(state(L2, [ID, b, a]).satisfiedBy, 'a_index');
  assert.equal(state(L2, [ID, a, own, b]).satisfiedBy, 'perf_lessons_course_order');
  // An exact candidate wins over a same-key candidate with other options.
  assert.equal(state(L2, [ID, { ...a, sparse: true }, b]).state, 'present');
});

test('L1 is covered by the prefix of the unique progress_user_course; prefix cover is opt-in and needs no filter', () => {
  const L1 = LEARNING_INDEXES.find((d) => d.id === 'L1');
  assert.deepEqual(state(L1, PRODUCTION.progress), { state: 'present', satisfiedBy: 'progress_user_course', coverage: 'prefix', reasons: [] });
  assert.equal(state(L1, [ID, { name: 'p', key: { userId: 1, courseId: 1 }, partialFilterExpression: { a: 1 } }]).state, 'missing');
  assert.equal(state(L1, [ID, { name: 'p', key: { courseId: 1, userId: 1 } }]).state, 'missing', 'not a prefix');
  assert.equal(state({ ...L1, coveredByPrefix: false }, PRODUCTION.progress).state, 'missing', 'never inferred');
  assert.deepEqual(LEARNING_INDEXES.filter((d) => d.coveredByPrefix).map((d) => d.id), ['L1']);
  assert.equal(state(L1, [ID, { name: 'perf_progress_user', key: { userId: 1 }, unique: true }]).state, 'conflicting', 'own name, other options');
});

// ---------------------------------------------------------------------------
// Part 5: report and apply share the plan
// ---------------------------------------------------------------------------

test('production shape: all 36 definitions classify as the read-only production report found, with the fixes', async () => {
  const db = fakeDb();
  const rows = [
    ...await plan.planIndexes(db, LEARNING_INDEXES),
    ...await plan.planIndexes(db, ASSESSMENT_INDEXES),
    ...await plan.planIndexes(db, TRADING_INDEXES),
  ];
  assert.equal(rows.length, 36);
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.deepEqual(['L1', 'L2', 'L3'].map((id) => [by[id].state, by[id].satisfiedBy]), [['present', 'progress_user_course'], ['present', 'lessons_course_order'], ['present', 'quizscores_user_course']]);
  assert.equal(by.A4.state, 'conflicting');
  assert.deepEqual(rows.filter((r) => r.state === 'no collection').map((r) => r.id), ['L8', 'L9', 'A1', 'A2', 'A3', 'A7', 'T1', 'T2', 'T3', 'T4', 'T5', 'T8', 'T11', 'T12', 'T13', 'T17', 'T18', 'T19', 'T20']);
  assert.deepEqual([...new Set(rows.filter((r) => r.createsCollection).map((r) => r.collection))].sort(),
    ['assignmentSubmissions', 'learningDays', 'learningMinutes', 'marketCheckpoints', 'marketIncidents', 'marketQuotes', 'quizAttempts', 'tradingOperations', 'tradingOrders', 'tradingPositions', 'tradingReviews']);
  assert.deepEqual(rows.filter((r) => r.state === 'missing').map((r) => r.id), ['L4', 'L5', 'L6', 'L7', 'A5', 'A6', 'T6', 'T7', 'T9', 'T10', 'T14', 'T15', 'T16']);
  assert.equal(db.writes.length, 0, 'planning only reads');
});

test('report and apply agree: apply refuses exactly what the report blocks, and builds exactly what it lists', async () => {
  for (const [definitions, ensure] of [[ASSESSMENT_INDEXES, ensureAssessmentIndexes], [TRADING_INDEXES, ensureTradingIndexes]]) {
    const db = fakeDb();
    const report = await ensure(db, { apply: false });
    assert.equal(db.writes.length, 0);
    const blocked = plan.blockedRows(report.report).map((r) => r.id);
    const listed = plan.toBuild(report.report).map((r) => r.id);
    const applied = await ensure(db, { apply: true });
    if (blocked.length) {
      assert.deepEqual([applied.ok, applied.built, applied.blocked], [false, [], blocked]);
      assert.equal(db.writes.length, 0, 'a conflict refuses the whole script');
    } else {
      assert.deepEqual(applied.built, listed);
      assert.deepEqual(db.writes.filter((w) => w[0] === 'create').map((w) => w[2]), listed.map((id) => definitions.find((d) => d.id === id).options.name));
      assert.equal(applied.ok, true);
      const again = await ensure(db, { apply: true });
      assert.deepEqual([again.ok, again.built], [true, []], 'idempotent');
    }
  }
});

test('learning apply on the production shape builds L4-L9 only, never a second index on an L1/L2/L3 key', async () => {
  const db = fakeDb();
  const report = await runLearning(db, { mode: 'plan', log: () => {} });
  assert.equal(report.ok, true);
  const result = await runLearning(db, { mode: 'apply', log: () => {} });
  assert.deepEqual([result.ok, result.built], [true, ['L4', 'L5', 'L6', 'L7', 'L8', 'L9']]);
  assert.deepEqual(db.writes.filter((w) => w[0] === 'created collection').map((w) => w[1]), ['learningDays', 'learningMinutes']);
  assert.ok(!db.writes.some((w) => ['perf_progress_user', 'perf_lessons_course_order', 'perf_quizscores_user_course'].includes(w[2])));
});

test('a genuine conflict makes the learning report exit non-zero and apply build nothing', async () => {
  const db = fakeDb({ ...PRODUCTION, lessons: [ID, { name: 'lessons_course_order', key: { courseId: 1, order: 1 }, unique: true }] });
  const lines = [];
  const report = await runLearning(db, { mode: 'plan', log: (l) => lines.push(l) });
  assert.equal(report.ok, false);
  assert.ok(lines.some((l) => /^Blocked: L2\./.test(l)));
  const applied = await runLearning(db, { mode: 'apply', log: () => {} });
  assert.equal(applied.ok, false);
  assert.equal(db.writes.length, 0);
});

test('duplicates block a unique definition in report and apply', async () => {
  const db = fakeDb(PRODUCTION, { duplicates: { tradingLedger: 2 } });
  const report = await ensureTradingIndexes(db, { apply: false });
  assert.equal(report.ok, false);
  assert.equal(report.report.find((r) => r.id === 'T6').duplicates, 2);
  const applied = await ensureTradingIndexes(db, { apply: true });
  assert.deepEqual([applied.ok, applied.blocked, db.writes.length], [false, ['T6'], 0]);
});

test('a failed build stops the run and is reported with what was built before it; never success', async () => {
  const db = fakeDb(PRODUCTION, { failOn: 'trading_ledger_account_recent' });
  const result = await ensureTradingIndexes(db, { apply: true });
  assert.equal(result.ok, false);
  assert.deepEqual(result.failed, { id: 'T7', error: 'IndexBuildAborted' });
  assert.ok(result.built.length > 0 && !result.built.includes('T7'));
  const lines = [];
  await require('../scripts/trading-indexes').run(fakeDb(PRODUCTION, { failOn: 'trading_ledger_account_recent' }), { apply: true, log: (l) => lines.push(l) });
  assert.ok(lines.some((l) => /^Build of T7 failed \(IndexBuildAborted\)\. Built before the failure: T1/.test(l)));
  assert.ok(!lines.some((l) => /^Verified/.test(l)));
});

test('rows say which index satisfies a definition and which collections apply would create', async () => {
  const rows = await plan.planIndexes(fakeDb(), LEARNING_INDEXES);
  const text = rows.map((r) => plan.describeRow(r));
  assert.ok(text.includes('L2 lessons perf_lessons_course_order: present (satisfied by existing lessons_course_order)'));
  assert.ok(text.includes('L1 progress perf_progress_user: present (covered by the prefix of existing progress_user_course)'));
  assert.ok(text.includes('L8 learningDays perf_learning_days_user: no collection (--apply would create collection learningDays)'));
  assert.deepEqual(plan.describePlan(rows), [
    'Would build: L4 (notifications.perf_notifications_user_recent), L5 (demoTradeJournal.perf_journal_student_recent), L6 (progress.perf_progress_course_rank), L7 (users.perf_users_role_points), L8 (learningDays.perf_learning_days_user), L9 (learningMinutes.ttl_learning_minutes).',
    'Would create collections: learningDays, learningMinutes.',
  ]);
});

test('rollback drops only indexes under this script\'s own name and exact definition; never L1/L2/L3 covers', async () => {
  const db = fakeDb();
  await runLearning(db, { mode: 'apply', log: () => {} });
  const lines = [];
  const result = await runLearning(db, { mode: 'rollback', log: (l) => lines.push(l) });
  assert.deepEqual(result.dropped, ['L4', 'L5', 'L6', 'L7', 'L8', 'L9']);
  assert.deepEqual(db.indexes.progress.map((i) => i.name), ['_id_', 'progress_user_course']);
  assert.deepEqual(db.indexes.lessons.map((i) => i.name), ['_id_', 'lessons_course_order']);
  assert.deepEqual(db.indexes.quizScores.map((i) => i.name), ['_id_', 'quizscores_user_course']);
  assert.ok(lines.includes('Kept L2: satisfied by lessons_course_order, which this script did not build.'));
  // An index with this script's name but another definition (built by someone else) is not dropped.
  const other = fakeDb({ ...PRODUCTION, users: [ID, { name: 'perf_users_role_points', key: { role: 1, points: -1 }, sparse: true }] });
  await runLearning(other, { mode: 'rollback', log: () => {} });
  assert.ok(other.indexes.users.some((i) => i.name === 'perf_users_role_points'));
});

test('the planner and the conversion never delete, change or insert documents and never drop', () => {
  for (const file of ['lib/index-plan.js', 'lib/unique-conversion.js', 'scripts/quiz-lesson-unique.js', 'scripts/assessment-indexes.js', 'scripts/trading-indexes.js']) {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.doesNotMatch(source, /\.(deleteOne|deleteMany|updateOne|updateMany|insertOne|insertMany|replaceOne|bulkWrite|drop|dropIndex|dropIndexes|dropCollection)\(/, file);
    assert.doesNotMatch(source, /force/i, `${file}: no force option`);
  }
});

// ---------------------------------------------------------------------------
// Part 3: A4 conversion guards
// ---------------------------------------------------------------------------

test('A4 stages: non-unique, prepared, unique, and anything unexpected stops', () => {
  const t = conversion.A4_CONVERSION;
  assert.equal(conversion.stageOf({ name: 'quizzes_lesson', key: { lessonId: 1 } }, t).stage, 'non-unique');
  assert.equal(conversion.stageOf({ name: 'quizzes_lesson', key: { lessonId: 1 }, prepareUnique: true }, t).stage, 'prepared');
  assert.equal(conversion.stageOf({ name: 'quizzes_lesson', key: { lessonId: 1 }, unique: true }, t).stage, 'unique');
  assert.equal(conversion.stageOf(undefined, t).stage, 'absent');
  for (const extra of [{ key: { lessonId: -1 } }, { sparse: true }, { partialFilterExpression: { a: 1 } }, { collation: { locale: 'en' } }, { hidden: true }, { expireAfterSeconds: 5 }]) {
    assert.equal(conversion.stageOf({ name: 'quizzes_lesson', key: { lessonId: 1 }, ...extra }, t).stage, 'unexpected', JSON.stringify(extra));
  }
});

const statusDb = (privileges, users = [{ user: 'u', db: 'admin' }]) => ({
  databaseName: 'Forex_elearning',
  sent: [],
  async command(cmd) {
    this.sent.push(Object.keys(cmd)[0]);
    if (cmd.connectionStatus) return { authInfo: { authenticatedUsers: users, authenticatedUserPrivileges: privileges } };
    throw new Error('no other command may be sent');
  },
  listCollections: () => { throw new Error('not reached'); },
});

test('A4 privileges: the Phase 10 indexer (no collMod) is refused before any other command; the converter role passes', async () => {
  const on = (collection, actions) => ({ resource: { db: 'Forex_elearning', collection }, actions });
  const indexer = [on('quizzes', ['createIndex', 'find', 'listIndexes']), on('', ['listCollections'])];
  for (const step of [conversion.prepareUnique, conversion.convertToUnique, conversion.abortPrepare]) {
    const db = statusDb(indexer);
    const result = await step(db);
    assert.deepEqual([result.ok, result.changed], [false, false]);
    assert.match(result.reason, /lacks collMod on Forex_elearning\.quizzes; nothing was sent/);
    assert.deepEqual(db.sent, ['connectionStatus']);
  }
  const converter = [on('quizzes', ['collMod', 'find', 'listIndexes']), on('', ['listCollections'])];
  assert.deepEqual(await conversion.checkPrivileges(statusDb(converter)), { ok: true, authentication: true, missing: [] });
  assert.deepEqual((await conversion.checkPrivileges(statusDb([on('quizzes', ['collMod', 'find', 'listIndexes'])]))).missing, ['listCollections (database)']);
  assert.deepEqual((await conversion.checkPrivileges(statusDb([on('other', ['collMod', 'find', 'listIndexes']), on('', ['listCollections'])]))).missing, ['collMod', 'find', 'listIndexes'], 'another collection does not count');
});

test('A4 script: one step per run, report by default', () => {
  assert.equal(parseConversionArgs(['node', 's', '--database', 'x']).step, 'report');
  assert.equal(parseConversionArgs(['node', 's', '--database', 'x', '--prepare']).step, 'prepare');
  assert.ok(parseConversionArgs(['node', 's', '--database', 'x', '--prepare', '--convert']).error);
  assert.ok(parseConversionArgs(['node', 's']).error);
});

// ---------------------------------------------------------------------------
// Quiz save: duplicate-key handling
// ---------------------------------------------------------------------------

test('quiz save: one duplicate-key error is retried once; a second, or any other error, is thrown unchanged', async () => {
  const collection = (failures) => ({
    calls: 0,
    async findOneAndUpdate(filter, update, options) {
      this.calls += 1;
      const failure = failures[this.calls - 1];
      if (failure) throw failure;
      return { filter, update, options };
    },
  });
  const dup = Object.assign(new Error('E11000'), { code: 11000 });
  const once = collection([dup]);
  const saved = await saveQuizVersion(once, { lessonId: 'l', set: { questions: [] }, now: new Date(0) });
  assert.equal(once.calls, 2);
  assert.deepEqual(saved.filter, { lessonId: 'l' });
  assert.deepEqual(saved.options, { upsert: true, returnDocument: 'after', includeResultMetadata: false });
  assert.deepEqual(saved.update.$inc, { version: 1 });
  const twice = collection([dup, dup]);
  await assert.rejects(saveQuizVersion(twice, { lessonId: 'l', set: {}, now: new Date(0) }), (e) => e === dup);
  assert.equal(twice.calls, 2);
  const other = Object.assign(new Error('network'), { code: 6 });
  const failing = collection([other]);
  await assert.rejects(saveQuizVersion(failing, { lessonId: 'l', set: {}, now: new Date(0) }), (e) => e === other);
  assert.equal(failing.calls, 1, 'an unrelated error is not retried');
  assert.equal(isDuplicateKey({ codeName: 'DuplicateKey' }), true);
  assert.equal(isDuplicateKey(null), false);
});

test('the quiz route saves through saveQuizVersion', () => {
  const source = fs.readFileSync(path.join(ROOT, 'pages/api/quizzes/[lessonId].ts'), 'utf8');
  assert.match(source, /await saveQuizVersion\(quizzes, \{/);
  assert.doesNotMatch(source, /quizzes\.findOneAndUpdate\(/);
});
