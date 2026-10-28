/**
 * Read-only legacy course access impact report.
 *
 * Compares the access rules that applied before the Phase 1 full-course purchase change with the
 * current rules, and prints aggregate counts only. No user IDs, emails, names, or references are printed.
 *
 * The only database operations used are `listCollections`, `find` with a projection, and the
 * `ping` and `connectionStatus` commands. Every collection is reached through `readOnlyDb`, which
 * exposes nothing else.
 *
 * Usage (PowerShell):
 *   $env:LEGACY_REPORT_CONFIRM_DB = '<database name>'; node scripts/legacy-course-access-report.js
 * The confirmation must equal the database the app would use (MONGODB_DB_NAME, else Forex_elearning).
 */

const GRANTED_ENTITLEMENTS = new Set(['complimentary', 'manual_grant']);
const STAFF_ROLES = new Set(['admin', 'superadmin', 'instructor']);
const REQUIRED_COLLECTIONS = ['users', 'courses', 'lessons'];
const READ_COMMANDS = new Set(['ping', 'connectionStatus']);
const WRITE_ACTIONS = new Set([
  'insert', 'update', 'remove', 'createIndex', 'dropIndex', 'dropCollection', 'dropDatabase',
  'createCollection', 'renameCollectionSameDB', 'collMod', 'bypassDocumentValidation',
]);

const PROJECTIONS = {
  users: { _id: 1, role: 1 },
  courses: { _id: 1 },
  lessons: { _id: 1, courseId: 1 },
  userCourseAccess: { _id: 0, userId: 1, courseId: 1, paid: 1, entitlementType: 1, source: 1, paystackReference: 1 },
  userLessonAccess: { _id: 0, userId: 1, lessonId: 1, courseId: 1, paid: 1, source: 1, paystackReference: 1 },
  lessonPurchases: { _id: 0, userId: 1, lessonId: 1, reference: 1, paystackReference: 1, source: 1 },
  paystackPayments: { _id: 0, reference: 1, userId: 1, courseId: 1, lessonId: 1, kind: 1, status: 1, amountKobo: 1, currency: 1 },
  coursePurchases: { _id: 0, userId: 1, courseId: 1, status: 1, paymentReference: 1 },
  progress: { _id: 0, userId: 1, courseId: 1, active: 1, withdrawnAt: 1 },
};

function describeUri(uri) {
  const value = String(uri || '').trim();
  if (/^mongodb\+srv:/i.test(value)) return 'remote SRV cluster';
  if (/^mongodb:\/\/(?:[^@/]*@)?(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|\?|$)/i.test(value)) return 'local MongoDB';
  if (/^mongodb:/i.test(value)) return 'remote MongoDB host';
  return 'unrecognized';
}

/** Mongo matches a string query only against a stored string, so non-string IDs are reported, not coerced. */
function stringId(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function anyId(value) {
  if (typeof value === 'string') return value.trim() || null;
  if (value && typeof value.toHexString === 'function') return value.toHexString();
  return null;
}

function bump(map, key) {
  const k = key === undefined || key === null || key === '' ? '(missing)' : String(key);
  map[k] = (map[k] || 0) + 1;
}

function isActiveEnrollment(row) {
  return row.active !== false && (row.withdrawnAt === undefined || row.withdrawnAt === null || row.withdrawnAt === '');
}

/**
 * Old rules (before Phase 1), per user and course:
 *   A  userCourseAccess with paid true or with no paid field
 *   B  any userLessonAccess row naming the course, paid true or no paid field
 *   C  any lessonPurchases row for a lesson whose stored courseId string is the course
 * Current rule: userCourseAccess with paid true, or entitlementType complimentary / manual_grant.
 * Lesson-level, old: userLessonAccess paid true or no paid field, or any lessonPurchases row.
 * Lesson-level, current: userLessonAccess paid true, or any lessonPurchases row.
 */
function classify(data) {
  const users = new Map();
  for (const u of data.users || []) {
    const id = anyId(u._id);
    if (id) users.set(id, typeof u.role === 'string' ? u.role : null);
  }
  const courseIds = new Set((data.courses || []).map((c) => anyId(c._id)).filter(Boolean));
  const lessonCourse = new Map();
  const lessonCourseIdTypes = {};
  for (const l of data.lessons || []) {
    const id = anyId(l._id);
    if (!id) continue;
    bump(lessonCourseIdTypes, typeof l.courseId === 'string' ? 'string' : anyId(l.courseId) ? 'objectId' : 'missing');
    lessonCourse.set(id, { stringCourseId: stringId(l.courseId), anyCourseId: anyId(l.courseId) });
  }

  const successfulPayments = (data.paystackPayments || []).filter((p) => p.status === 'success');
  const paymentRefs = new Set(successfulPayments.map((p) => stringId(p.reference)).filter(Boolean));
  const coursePaymentPairs = new Set();
  for (const p of successfulPayments) {
    if (p.kind === 'lesson' || p.lessonId) continue;
    const u = anyId(p.userId);
    const c = anyId(p.courseId);
    if (u && c) coursePaymentPairs.add(`${u}|${c}`);
  }
  const paidCoursePurchasePairs = new Set();
  for (const r of data.coursePurchases || []) {
    const u = anyId(r.userId);
    const c = anyId(r.courseId);
    if (u && c && r.status === 'paid') paidCoursePurchasePairs.add(`${u}|${c}`);
  }
  const activeEnrollments = new Set();
  for (const r of data.progress || []) {
    const u = anyId(r.userId);
    const c = anyId(r.courseId);
    if (u && c && isActiveEnrollment(r)) activeEnrollments.add(`${u}|${c}`);
  }

  const pairs = new Map();
  const pair = (u, c) => {
    const key = `${u}|${c}`;
    if (!pairs.has(key)) {
      pairs.set(key, { userId: u, courseId: c, oldA_paid: false, oldA_unflagged: false, oldB: false, oldC: false, newPaid: false, newGrant: false, refs: new Set() });
    }
    return pairs.get(key);
  };

  const unreadable = { userCourseAccess: 0, userLessonAccess: 0, lessonPurchases: 0 };
  const sources = { userCourseAccess: {}, userLessonAccess: {}, lessonPurchases: {} };
  const paidField = { userCourseAccess: {}, userLessonAccess: {} };

  for (const r of data.userCourseAccess || []) {
    bump(sources.userCourseAccess, r.source);
    bump(paidField.userCourseAccess, 'paid' in r ? `paid=${JSON.stringify(r.paid)}` : 'no paid field');
    const u = stringId(r.userId);
    const c = stringId(r.courseId);
    if (!u || !c) { unreadable.userCourseAccess += 1; continue; }
    const p = pair(u, c);
    if (r.paid === true) p.oldA_paid = true;
    if (!('paid' in r)) p.oldA_unflagged = true;
    if (r.paid === true) p.newPaid = true;
    if (GRANTED_ENTITLEMENTS.has(r.entitlementType)) p.newGrant = true;
    const ref = stringId(r.paystackReference);
    if (ref) p.refs.add(ref);
  }

  const lessonLevel = {
    rows: 0,
    unflaggedRows: 0,
    unflaggedRowsWithLedgerPayment: 0,
    paidFalseRows: 0,
    studentsLosingSomeLessonAccess: new Set(),
  };
  const keptLessonsByPair = new Map();
  const keepLesson = (u, c, lessonId) => {
    const key = `${u}|${c}`;
    if (!keptLessonsByPair.has(key)) keptLessonsByPair.set(key, new Set());
    keptLessonsByPair.get(key).add(lessonId);
  };

  for (const r of data.userLessonAccess || []) {
    lessonLevel.rows += 1;
    bump(sources.userLessonAccess, r.source);
    bump(paidField.userLessonAccess, 'paid' in r ? `paid=${JSON.stringify(r.paid)}` : 'no paid field');
    const u = stringId(r.userId);
    const lessonId = stringId(r.lessonId);
    if (!u || !lessonId) { unreadable.userLessonAccess += 1; continue; }
    const grantsOld = r.paid === true || !('paid' in r);
    if (r.paid === false) lessonLevel.paidFalseRows += 1;
    if (!('paid' in r)) {
      lessonLevel.unflaggedRows += 1;
      lessonLevel.studentsLosingSomeLessonAccess.add(u);
      const ref = stringId(r.paystackReference);
      if (ref && paymentRefs.has(ref)) lessonLevel.unflaggedRowsWithLedgerPayment += 1;
    }
    const c = stringId(r.courseId);
    if (grantsOld && c) pair(u, c).oldB = true;
    if (r.paid === true) {
      const lessonCourseId = c || (lessonCourse.get(lessonId) || {}).anyCourseId;
      if (lessonCourseId) keepLesson(u, lessonCourseId, lessonId);
    }
  }

  let lessonPurchasesUnmapped = 0;
  for (const r of data.lessonPurchases || []) {
    bump(sources.lessonPurchases, r.source);
    const u = stringId(r.userId);
    const lessonId = stringId(r.lessonId);
    if (!u || !lessonId) { unreadable.lessonPurchases += 1; continue; }
    const lesson = lessonCourse.get(lessonId);
    if (!lesson) { lessonPurchasesUnmapped += 1; continue; }
    if (lesson.stringCourseId) pair(u, lesson.stringCourseId).oldC = true;
    if (lesson.anyCourseId) keepLesson(u, lesson.anyCourseId, lessonId);
  }

  const categories = {
    verified_full_course: 0,
    paid_flag_without_ledger_match: 0,
    explicit_grant: 0,
    loses_course_access_unflagged_course_row: 0,
    loses_course_access_lesson_purchase_only: 0,
    no_access_before_or_after: 0,
    staff_unaffected: 0,
    unclassifiable_missing_user_or_course: 0,
  };
  const losing = {
    unflaggedWithLedgerPayment: 0,
    unflaggedWithoutLedgerPayment: 0,
    lessonOnlyKeepingSomeLessons: 0,
    lessonOnlyKeepingNoLessons: 0,
    viaUserLessonAccess: 0,
    viaLessonPurchases: 0,
    activelyEnrolled: 0,
  };
  const students = {};
  const addStudent = (category, u) => {
    if (!students[category]) students[category] = new Set();
    students[category].add(u);
  };

  for (const p of pairs.values()) {
    const key = `${p.userId}|${p.courseId}`;
    const role = users.get(p.userId);
    const oldAccess = p.oldA_paid || p.oldA_unflagged || p.oldB || p.oldC;
    const newAccess = p.newPaid || p.newGrant;
    const hasLedger = coursePaymentPairs.has(key) || [...p.refs].some((ref) => paymentRefs.has(ref));
    let category;
    if (role === undefined || !courseIds.has(p.courseId)) category = 'unclassifiable_missing_user_or_course';
    else if (STAFF_ROLES.has(role)) category = 'staff_unaffected';
    else if (newAccess) {
      if (p.newPaid) category = hasLedger ? 'verified_full_course' : 'paid_flag_without_ledger_match';
      else category = 'explicit_grant';
    } else if (oldAccess) {
      category = p.oldA_unflagged ? 'loses_course_access_unflagged_course_row' : 'loses_course_access_lesson_purchase_only';
      if (p.oldA_unflagged) {
        if (hasLedger || paidCoursePurchasePairs.has(key)) losing.unflaggedWithLedgerPayment += 1;
        else losing.unflaggedWithoutLedgerPayment += 1;
      } else {
        const kept = keptLessonsByPair.get(key);
        if (kept && kept.size > 0) losing.lessonOnlyKeepingSomeLessons += 1;
        else losing.lessonOnlyKeepingNoLessons += 1;
        if (p.oldB) losing.viaUserLessonAccess += 1;
        if (p.oldC) losing.viaLessonPurchases += 1;
      }
      if (activeEnrollments.has(key)) losing.activelyEnrolled += 1;
    } else category = 'no_access_before_or_after';
    categories[category] += 1;
    addStudent(category, p.userId);
  }

  const studentsWhoMayLose = new Set([
    ...(students.loses_course_access_unflagged_course_row || []),
    ...(students.loses_course_access_lesson_purchase_only || []),
  ]);
  for (const u of lessonLevel.studentsLosingSomeLessonAccess) {
    const role = users.get(u);
    if (role !== undefined && !STAFF_ROLES.has(role)) studentsWhoMayLose.add(u);
  }

  let successfulCoursePaymentsWithoutPaidAccess = 0;
  for (const key of coursePaymentPairs) {
    const p = pairs.get(key);
    if (!p || !(p.newPaid || p.newGrant)) successfulCoursePaymentsWithoutPaidAccess += 1;
  }
  const amounts = { course: {}, lesson: {} };
  for (const p of successfulPayments) {
    bump(p.kind === 'lesson' || p.lessonId ? amounts.lesson : amounts.course, `${p.amountKobo ?? '(missing)'} ${p.currency ?? '(missing)'}`);
  }

  const totalPairs = pairs.size;
  const categorySum = Object.values(categories).reduce((a, b) => a + b, 0);
  return {
    totals: {
      users: users.size,
      courses: courseIds.size,
      lessons: lessonCourse.size,
      userCourseAccessRows: (data.userCourseAccess || []).length,
      userLessonAccessRows: (data.userLessonAccess || []).length,
      lessonPurchasesRows: (data.lessonPurchases || []).length,
      paystackPaymentsSuccess: successfulPayments.length,
      coursePurchasesRows: (data.coursePurchases || []).length,
      userCoursePairsWithAnyAccessRecord: totalPairs,
    },
    pairsByCategory: categories,
    studentsByCategory: Object.fromEntries(Object.keys(categories).map((k) => [k, students[k] ? students[k].size : 0])),
    losingCourseAccessDetail: losing,
    lessonLevel: {
      userLessonAccessRows: lessonLevel.rows,
      rowsWithoutPaidFieldLosingLessonAccess: lessonLevel.unflaggedRows,
      ofWhichMatchSuccessfulLedgerPayment: lessonLevel.unflaggedRowsWithLedgerPayment,
      rowsWithPaidFalse: lessonLevel.paidFalseRows,
      studentsLosingSomeLessonAccess: lessonLevel.studentsLosingSomeLessonAccess.size,
    },
    studentsWhoMayLoseAnyAccess: studentsWhoMayLose.size,
    successfulCoursePaymentsWithoutCurrentAccess: successfulCoursePaymentsWithoutPaidAccess,
    unclassifiableRows: {
      nonStringUserOrCourseOrLessonId: unreadable,
      lessonPurchasesForUnknownLesson: lessonPurchasesUnmapped,
    },
    shapes: { paidField, sources, lessonCourseIdTypes, successfulPaymentAmounts: amounts },
    checks: { categorySumMatchesPairs: categorySum === totalPairs },
  };
}

/** The only handle the report uses. It has no write method. */
function readOnlyDb(db) {
  return Object.freeze({
    async collectionNames() {
      const rows = await db.listCollections({}, { nameOnly: true }).toArray();
      return rows.map((r) => r.name);
    },
    async readAll(name, projection) {
      return db.collection(name).find({}, { projection }).toArray();
    },
    async command(cmd) {
      const name = Object.keys(cmd)[0];
      if (!READ_COMMANDS.has(name)) throw new Error(`Command not allowed: ${name}`);
      return db.command(cmd);
    },
  });
}

function credentialCanWrite(status, dbName) {
  const privileges = (status && status.authInfo && status.authInfo.authenticatedUserPrivileges) || [];
  return privileges.some((p) => {
    const r = p.resource || {};
    const coversDb = r.anyResource === true || r.db === '' || r.db === dbName;
    return coversDb && (p.actions || []).some((a) => WRITE_ACTIONS.has(a));
  });
}

async function main() {
  require('dotenv').config({ path: '.env.local' });
  require('dotenv').config();
  const uri = (process.env.MONGO_URI || process.env.MONGODB_URI || '').trim();
  const dbName = (process.env.MONGODB_DB_NAME || '').trim() || 'Forex_elearning';
  const confirm = (process.env.LEGACY_REPORT_CONFIRM_DB || '').trim();
  const environment = describeUri(uri);
  console.log(JSON.stringify({ step: 'identity', environment, dbName, dbNameSource: process.env.MONGODB_DB_NAME ? 'MONGODB_DB_NAME' : 'default' }));
  if (!uri || environment === 'unrecognized') {
    console.error('Stopped: no usable MongoDB URI is configured.');
    process.exit(2);
  }
  if (confirm !== dbName) {
    console.error('Stopped: LEGACY_REPORT_CONFIRM_DB must equal the database name shown above. Nothing was queried.');
    process.exit(2);
  }

  const { MongoClient } = require('mongodb');
  const client = new MongoClient(uri, {
    appName: 'forexorbit-legacy-access-report-readonly',
    readPreference: 'secondaryPreferred',
    retryWrites: false,
    maxPoolSize: 2,
    serverSelectionTimeoutMS: 15000,
  });
  try {
    await client.connect();
    const db = readOnlyDb(client.db(dbName));
    await db.command({ ping: 1 });
    const names = await db.collectionNames();
    const missing = REQUIRED_COLLECTIONS.filter((n) => !names.includes(n));
    if (missing.length) {
      console.error(JSON.stringify({ step: 'stopped', reason: 'expected collections missing', missing }));
      process.exit(3);
    }
    const status = await db.command({ connectionStatus: 1, showPrivileges: true });
    const present = Object.keys(PROJECTIONS).filter((n) => names.includes(n));
    console.log(JSON.stringify({
      step: 'verified',
      collectionCount: names.length,
      absentAccessCollections: Object.keys(PROJECTIONS).filter((n) => !names.includes(n)),
      credentialCanWrite: credentialCanWrite(status, dbName),
      readOnlyEnforcedBy: 'script (find, listCollections, ping, connectionStatus only)',
    }));
    const data = {};
    for (const name of present) data[name] = await db.readAll(name, PROJECTIONS[name]);
    console.log(JSON.stringify({ step: 'report', generatedAt: new Date().toISOString(), ...classify(data) }, null, 2));
  } finally {
    await client.close();
  }
}

module.exports = { classify, describeUri, credentialCanWrite, readOnlyDb, PROJECTIONS };

if (require.main === module) {
  main().catch((err) => {
    console.error(JSON.stringify({ step: 'failed', name: err && err.name, code: err && err.code }));
    process.exit(1);
  });
}
