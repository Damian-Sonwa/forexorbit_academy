/**
 * Phase 6 enrollment against a real MongoDB server (npm run test:mongo:enrollment).
 *
 * The enrollment index E1 is built with the real driver: the duplicate scan, the refusal while
 * exact duplicates exist, concurrent enrollment writes, and a verified payment that enrolls the
 * student. Paystack is a stub; nothing leaves the machine.
 *
 * Requires MONGODB_URI_TEST (an isolated server, never production) and MONGODB_DB_NAME_TEST
 * (must end in "_test"). Skipped when MONGODB_URI_TEST is unset.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');

const { openTestDatabase, testDatabaseConfig } = require('../helpers/mongo-test-db');
const payment = require('../../lib/course-payment');
const { COURSE_PAYMENT_INDEXES } = require('../../lib/course-payment-indexes');
const { ENROLLMENT_INDEXES, enrollmentDuplicateReport, ensureEnrollmentIndexes } = require('../../lib/enrollment-indexes');
const { ensureActiveEnrollment } = require('../../lib/enrollment-store');
const { enrollDuplicateStatus } = require('../../lib/enrollment-state');
const { runReconciliation } = require('../../lib/payment-reconciliation');

const config = testDatabaseConfig();
const skip = config.ok ? false : config.reason;
const NOW = new Date('2026-11-06T10:00:00Z');
const id = () => new ObjectId().toHexString();

async function fresh() {
  const conn = await openTestDatabase();
  await conn.reset();
  return conn;
}

test('real MongoDB: E1 refuses to build over exact duplicates, reports cross-type ones, then builds and enforces uniqueness', { skip }, async () => {
  const conn = await fresh();
  try {
    const progress = conn.db.collection('progress');
    const [student, course] = [id(), id()];
    await progress.insertMany([
      { userId: student, courseId: course, active: true },
      { userId: student, courseId: course, active: false, withdrawnAt: NOW },
      { userId: student, courseId: new ObjectId(id()) },
      { userId: 'other', courseId: new ObjectId(course) },
      { userId: 'other', courseId: course },
    ]);
    const report = await enrollmentDuplicateReport(conn.db);
    assert.deepEqual(report, { exactGroups: 1, crossTypeGroups: 1 });
    const refused = await ensureEnrollmentIndexes(conn.db, { apply: true });
    assert.deepEqual([refused.ok, refused.built, refused.states[0].state], [false, [], 'missing']);
    assert.equal(await progress.countDocuments({}), 5, 'nothing was merged or deleted');

    await progress.deleteOne({ userId: student, courseId: course, active: false });
    const built = await ensureEnrollmentIndexes(conn.db, { apply: true });
    assert.deepEqual([built.ok, built.built], [true, ['progress_user_course']]);
    const index = (await progress.indexes()).find((i) => i.name === 'progress_user_course');
    assert.deepEqual([index.key, index.unique, index.partialFilterExpression], [{ userId: 1, courseId: 1 }, true, undefined]);
    const again = await ensureEnrollmentIndexes(conn.db, { apply: true });
    assert.deepEqual([again.ok, again.built], [true, []], 'building twice is a no-op');

    let error = null;
    try {
      await progress.insertOne({ userId: student, courseId: course, active: true });
    } catch (caught) {
      error = caught;
    }
    assert.ok(error, 'a second row for the same student and course is rejected');
    assert.deepEqual(enrollDuplicateStatus(error), { status: 400, body: { error: 'Already enrolled' } });
    assert.equal(ENROLLMENT_INDEXES.length, 1);
  } finally {
    await conn.close();
  }
});

test('real MongoDB: the production case, an existing non-unique progress_user_course, is converted in place (Option 1)', { skip }, async () => {
  const conn = await fresh();
  try {
    const progress = conn.db.collection('progress');
    await progress.createIndex({ userId: 1, courseId: 1 }, { name: 'progress_user_course' });
    const [student, course] = [id(), id()];
    const { insertedId: redundant } = await progress.insertOne({ userId: student, courseId: course, progress: 0, completedLessons: [] });
    await progress.insertOne({ userId: student, courseId: course, progress: 20, completedLessons: ['l1'] });

    const lines = [];
    const report = await ensureEnrollmentIndexes(conn.db, { log: (line) => lines.push(line) });
    assert.equal(report.states[0].state, 'conflicting');
    assert.match(lines[0], /^index E1 progress_user_course: conflicting \(not unique; convert with collMod after resolving duplicates\)$/);
    assert.deepEqual(report.duplicates, { exactGroups: 1, crossTypeGroups: 0 }, 'the scan runs for a conflicting index too');
    const refused = await ensureEnrollmentIndexes(conn.db, { apply: true });
    assert.deepEqual([refused.ok, refused.built], [false, []], '--apply never touches the existing index');

    // While the duplicate exists the unique conversion is refused by MongoDB itself.
    await conn.db.command({ collMod: 'progress', index: { name: 'progress_user_course', prepareUnique: true } });
    await assert.rejects(conn.db.command({ collMod: 'progress', index: { name: 'progress_user_course', unique: true } }));
    await assert.rejects(progress.insertOne({ userId: student, courseId: course }), 'prepareUnique already refuses new duplicates');

    await progress.deleteOne({ _id: redundant });
    await conn.db.command({ collMod: 'progress', index: { name: 'progress_user_course', unique: true } });
    const after = await ensureEnrollmentIndexes(conn.db, { apply: true });
    assert.deepEqual([after.ok, after.built, after.states[0].state], [true, [], 'present']);
    assert.equal(await progress.countDocuments({ userId: student, courseId: course }), 1);
    assert.deepEqual((await progress.findOne({ userId: student, courseId: course })).completedLessons, ['l1'], 'the kept row is untouched');
  } finally {
    await conn.close();
  }
});

test('real MongoDB: concurrent enrollments and a verified payment leave exactly one active row', { skip }, async () => {
  const conn = await fresh();
  try {
    const built = await ensureEnrollmentIndexes(conn.db, { apply: true });
    assert.equal(built.ok, true);
    for (const index of COURSE_PAYMENT_INDEXES) await conn.db.collection(index.collection).createIndex(index.key, index.options);
    const [student, course] = [id(), id()];
    const results = await Promise.all(Array.from({ length: 8 }, () => ensureActiveEnrollment(conn.db, { userId: student, courseId: course, now: NOW })));
    assert.equal(results.filter((r) => r.action === 'created').length, 1);
    assert.equal(await conn.db.collection('progress').countDocuments({ userId: student, courseId: course }), 1);

    // A verified payment for another course enrolls the student once.
    const paidCourse = id();
    const lookup = (map) => async (key) => map[key] || { outcome: 'not_found' };
    const created = await payment.createCourseIntent(conn.db, { userId: student, courseId: paidCourse, fetchTransaction: lookup({}), makeReference: () => 'fo_c_p6int_1_abcdef12', now: NOW });
    const intent = await conn.db.collection(payment.COLLECTIONS.intents).findOne({ reference: created.reference });
    const data = { id: 990001, status: 'success', reference: intent.reference, amount: intent.amountKobo, currency: 'NGN', metadata: { userId: student, courseId: paidCourse } };
    const confirm = () => payment.confirmCoursePayment(conn.db, { reference: intent.reference, source: 'webhook', sessionUserId: student, expectedCourseId: paidCourse, fetchTransaction: lookup({ [intent.reference]: { outcome: 'found', data } }), now: NOW });
    await Promise.all([confirm(), confirm(), confirm()]);
    const rows = await conn.db.collection('progress').find({ userId: student, courseId: paidCourse }).toArray();
    assert.deepEqual(rows.map((r) => [r.active, r.enrolledVia]), [[true, 'payment-webhook']]);

    // Reconciliation finds nothing more to enroll.
    const report = await runReconciliation(conn.db, { apply: true, fetchTransaction: lookup({}), fetchRefund: lookup({}), listRefunds: lookup({}), now: NOW });
    assert.equal(report.items.filter((i) => i.type === 'entitlement_without_enrollment').length, 0);
  } finally {
    await conn.close();
  }
});
