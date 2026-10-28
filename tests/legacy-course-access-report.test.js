/**
 * Legacy course access report: classifier behavior on synthetic rows, and a source check that the
 * script has no write-capable database call. Does not connect to a database.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { classify, describeUri, credentialCanWrite, readOnlyDb } = require('../scripts/legacy-course-access-report');

const C1 = 'c'.repeat(24);
const C2 = 'd'.repeat(24);
const L1 = '1'.repeat(24);
const L2 = '2'.repeat(24);
const L3 = '3'.repeat(24);

function fixture() {
  const users = ['u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7', 'staff'].map((id) => ({ _id: id, role: id === 'staff' ? 'instructor' : 'student' }));
  return {
    users,
    courses: [{ _id: C1 }, { _id: C2 }],
    lessons: [{ _id: L1, courseId: C1 }, { _id: L2, courseId: C1 }, { _id: L3, courseId: C2 }],
    userCourseAccess: [
      { userId: 'u1', courseId: C1, paid: true, paystackReference: 'ref_u1', source: 'paystack-course' },
      { userId: 'u2', courseId: C1, paid: true, source: 'manual' },
      { userId: 'u3', courseId: C1, entitlementType: 'complimentary' },
      { userId: 'u4', courseId: C1, paystackReference: 'ref_u4' },
      { userId: 'u7', courseId: C1, paid: false },
      { userId: 'staff', courseId: C1 },
      { userId: 'ghost', courseId: C1, paid: true },
    ],
    userLessonAccess: [
      { userId: 'u5', lessonId: L1, courseId: C1, paid: true, paystackReference: 'ref_u5' },
      { userId: 'u6', lessonId: L3, courseId: C2, paystackReference: 'ref_u6' },
    ],
    lessonPurchases: [{ userId: 'u6', lessonId: L1 }, { userId: 'u6', lessonId: 'f'.repeat(24) }],
    paystackPayments: [
      { reference: 'ref_u1', userId: 'u1', courseId: C1, kind: 'course', status: 'success', amountKobo: 500000, currency: 'NGN' },
      { reference: 'ref_u4', userId: 'u4', courseId: C1, kind: 'course', status: 'success', amountKobo: 500000, currency: 'NGN' },
      { reference: 'ref_u5', userId: 'u5', courseId: C1, lessonId: L1, kind: 'lesson', status: 'success', amountKobo: 300000, currency: 'NGN' },
      { reference: 'ref_u6', userId: 'u6', courseId: C2, lessonId: L3, kind: 'lesson', status: 'success', amountKobo: 300000, currency: 'NGN' },
      { reference: 'ref_lost', userId: 'u7', courseId: C2, kind: 'course', status: 'success', amountKobo: 500000, currency: 'NGN' },
    ],
    progress: [{ userId: 'u4', courseId: C1 }, { userId: 'u5', courseId: C1, withdrawnAt: new Date() }],
  };
}

test('each user-course pair falls into exactly one category under the old and new rules', () => {
  const r = classify(fixture());
  assert.deepEqual(r.pairsByCategory, {
    verified_full_course: 1,
    paid_flag_without_ledger_match: 1,
    explicit_grant: 1,
    loses_course_access_unflagged_course_row: 1,
    loses_course_access_lesson_purchase_only: 3,
    no_access_before_or_after: 1,
    staff_unaffected: 1,
    unclassifiable_missing_user_or_course: 1,
  });
  assert.equal(r.checks.categorySumMatchesPairs, true);
});

test('losing pairs are split by evidence and by what lesson access remains', () => {
  const r = classify(fixture());
  assert.equal(r.losingCourseAccessDetail.unflaggedWithLedgerPayment, 1);
  assert.equal(r.losingCourseAccessDetail.unflaggedWithoutLedgerPayment, 0);
  assert.equal(r.losingCourseAccessDetail.lessonOnlyKeepingSomeLessons, 2);
  assert.equal(r.losingCourseAccessDetail.lessonOnlyKeepingNoLessons, 1);
  assert.equal(r.losingCourseAccessDetail.activelyEnrolled, 1);
});

test('lesson rows without a paid field are counted as losing lesson access', () => {
  const r = classify(fixture());
  assert.equal(r.lessonLevel.rowsWithoutPaidFieldLosingLessonAccess, 1);
  assert.equal(r.lessonLevel.ofWhichMatchSuccessfulLedgerPayment, 1);
  assert.equal(r.studentsWhoMayLoseAnyAccess, 3);
  assert.equal(r.unclassifiableRows.lessonPurchasesForUnknownLesson, 1);
});

test('a successful course payment with no current entitlement is surfaced', () => {
  assert.equal(classify(fixture()).successfulCoursePaymentsWithoutCurrentAccess, 2);
});

test('non-string IDs are reported as unreadable rather than coerced', () => {
  const data = fixture();
  data.userCourseAccess.push({ userId: { toHexString: () => 'u1' }, courseId: C2, paid: true });
  const r = classify(data);
  assert.equal(r.unclassifiableRows.nonStringUserOrCourseOrLessonId.userCourseAccess, 1);
});

test('the output holds counts only, never user IDs or references', () => {
  const text = JSON.stringify(classify(fixture()));
  for (const secret of ['u1', 'u4', 'u6', 'ref_u1', 'ref_lost', 'ghost']) {
    assert.equal(text.includes(`"${secret}"`), false, secret);
  }
});

test('the environment description never contains the host or credentials', () => {
  const srv = 'mongodb+srv:' + '//';
  assert.equal(describeUri(`${srv}user:pw@cluster0.example.net/db`), 'remote SRV cluster');
  assert.equal(describeUri('mongodb://localhost:27017/db'), 'local MongoDB');
  assert.equal(describeUri('mongodb://db.example.net/db'), 'remote MongoDB host');
  assert.equal(describeUri(''), 'unrecognized');
});

test('write privileges are detected from connectionStatus without exposing user names', () => {
  const status = (actions, db) => ({ authInfo: { authenticatedUsers: [{ user: 'x' }], authenticatedUserPrivileges: [{ resource: { db, collection: '' }, actions }] } });
  assert.equal(credentialCanWrite(status(['find', 'insert'], 'Forex_elearning'), 'Forex_elearning'), true);
  assert.equal(credentialCanWrite(status(['find', 'listCollections'], 'Forex_elearning'), 'Forex_elearning'), false);
  assert.equal(credentialCanWrite(status(['insert'], 'other'), 'Forex_elearning'), false);
});

test('the read-only handle refuses commands outside the allowlist', async () => {
  const db = readOnlyDb({ command: async () => ({ ok: 1 }) });
  await assert.rejects(db.command({ dropDatabase: 1 }), /not allowed/);
  await assert.rejects(db.command({ insert: 'users' }), /not allowed/);
  assert.deepEqual(await db.command({ ping: 1 }), { ok: 1 });
  assert.equal(Object.isFrozen(db), true);
});

test('source contract: the report script contains no write-capable database call', () => {
  const source = fs.readFileSync(path.join(__dirname, '../scripts/legacy-course-access-report.js'), 'utf8');
  const forbidden = [
    /\.insert(One|Many)?\(/, /\.update(One|Many)?\(/, /\.replaceOne\(/, /\.delete(One|Many)\(/,
    /\.findOneAnd\w+\(/, /\.bulkWrite\(/, /\.createIndex(es)?\(/, /\.drop\w*\(/, /\.aggregate\(/,
    /\$out\b/, /\$merge\b/, /\.rename\(/, /\.createCollection\(/,
  ];
  for (const pattern of forbidden) {
    assert.equal(pattern.test(source), false, String(pattern));
  }
});
