'use strict';

/**
 * Super Admin course-access management (Phase 6).
 *
 *   overview   one student's enrollments (`progress`) and course entitlements (`userCourseAccess`),
 *              course by course
 *   grant      complimentary full-course access (the existing `complimentary` entitlement type,
 *              lib/course-payment.js GRANTED_ENTITLEMENTS) plus an active enrollment
 *   revoke     ends a complimentary or manual grant. Paid access is never revoked here: it ends only
 *              through a full refund with access removal (lib/payment-refunds.js, Phase 5).
 *
 * Every grant and revocation needs a reason, is conditional on the access row not having changed
 * since it was read, keeps the previous state in `accessHistory`, and is written to the
 * append-only `adminAuditLog`. Rows are never deleted. The routes allow the Super Admin only.
 */

const { ObjectId } = require('mongodb');
const { AUDIT_COLLECTION, COLLECTIONS, GRANTED_ENTITLEMENTS, isDuplicateKey, isEntitledRow } = require('./course-payment');
const { ENROLLMENTS, ensureActiveEnrollment } = require('./enrollment-store');
const { isActiveEnrollment } = require('./enrollment-state');
const { COURSE_STATUS, courseStatus } = require('./course-lifecycle');

const STORED_ID = /^[a-fA-F0-9]{24}$/;
const REASON_MIN = 5;
const REASON_MAX = 500;
const GRANT_REVOKED = 'grant_revoked';

function refuse(status, code, error) {
  return { ok: false, status, code, error };
}

function isStoredId(value) {
  return typeof value === 'string' && STORED_ID.test(value);
}

function cleanReason(value) {
  const text = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  return text.length >= REASON_MIN && text.length <= REASON_MAX ? text : null;
}

function actorOf(actor) {
  return { userId: String(actor.userId), email: typeof actor.email === 'string' ? actor.email : null };
}

function stateOf(access) {
  if (!access) return null;
  return {
    entitlementType: access.entitlementType == null ? null : String(access.entitlementType),
    paid: access.paid === true,
    entitled: isEntitledRow(access),
  };
}

async function appendAudit(db, entry) {
  try {
    await db.collection(AUDIT_COLLECTION).insertOne(entry);
  } catch (error) {
    if (!isDuplicateKey(error)) console.error(JSON.stringify({ event: 'course_access_audit', result: 'write_failed', action: entry.action }));
  }
}

function presentAccess(access) {
  if (!access) return null;
  return {
    entitlementType: access.entitlementType == null ? null : String(access.entitlementType),
    paid: access.paid === true,
    entitled: isEntitledRow(access),
    paystackReference: access.paystackReference ? String(access.paystackReference) : null,
    unlockedAt: access.unlockedAt || null,
    grantedAt: access.grantedAt || null,
    grantReason: typeof access.grantReason === 'string' ? access.grantReason : null,
    revokedAt: access.revokedAt || null,
    revokedReason: typeof access.revokedReason === 'string' ? access.revokedReason : null,
  };
}

function presentEnrollment(row) {
  if (!row) return null;
  return {
    active: isActiveEnrollment(row),
    withdrawnAt: row.withdrawnAt || null,
    progress: typeof row.progress === 'number' ? Math.min(100, row.progress) : 0,
    completedAt: row.completedAt || null,
    enrolledVia: typeof row.enrolledVia === 'string' ? row.enrolledVia : null,
    enrolledAt: row.createdAt || null,
  };
}

async function findStudent(db, { userId, email }) {
  const users = db.collection('users');
  const projection = { name: 1, email: 1, role: 1, status: 1 };
  if (isStoredId(userId)) return users.findOne({ _id: new ObjectId(userId) }, { projection });
  const address = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!address || address.length > 254) return null;
  return users.findOne({ email: address }, { projection });
}

/** One student's enrollments and entitlements, course by course. */
async function studentAccessOverview(db, { userId, email }) {
  if (!isStoredId(userId) && !(typeof email === 'string' && email.trim())) {
    return refuse(400, 'student_required', 'Enter a student email address or account ID.');
  }
  const user = await findStudent(db, { userId, email });
  if (!user) return refuse(404, 'student_not_found', 'No account matches.');
  if (user.role !== 'student') return refuse(409, 'not_a_student', 'That account is not a student account.');
  const id = String(user._id);
  const [enrollments, accessRows] = await Promise.all([
    db.collection(ENROLLMENTS).find({ userId: id }).toArray(),
    db.collection(COLLECTIONS.courseAccess).find({ userId: id }).toArray(),
  ]);
  const byCourse = new Map();
  const entry = (courseId) => {
    const key = String(courseId);
    if (!byCourse.has(key)) byCourse.set(key, { courseId: key, enrollment: null, access: null });
    return byCourse.get(key);
  };
  for (const row of enrollments) if (row.courseId != null) entry(row.courseId).enrollment = presentEnrollment(row);
  for (const row of accessRows) if (row.courseId != null) entry(row.courseId).access = presentAccess(row);
  const ids = [...byCourse.keys()].filter(isStoredId).map((value) => new ObjectId(value));
  const courses = ids.length
    ? await db.collection('courses').find({ _id: { $in: ids } }, { projection: { title: 1, status: 1 } }).toArray()
    : [];
  const courseById = new Map(courses.map((course) => [String(course._id), course]));
  return {
    ok: true,
    status: 200,
    student: { id, name: typeof user.name === 'string' ? user.name : '', email: typeof user.email === 'string' ? user.email : '', status: user.status || 'approved' },
    courses: [...byCourse.values()].map((item) => {
      const course = courseById.get(item.courseId);
      return { ...item, title: course && typeof course.title === 'string' ? course.title : null, courseStatus: course ? courseStatus(course) : null };
    }),
  };
}

async function loadTarget(db, { userId, courseId }) {
  if (!isStoredId(userId) || !isStoredId(courseId)) return refuse(400, 'invalid_target', 'A student and a course are required.');
  const [user, course] = await Promise.all([
    db.collection('users').findOne({ _id: new ObjectId(userId) }, { projection: { role: 1 } }),
    db.collection('courses').findOne({ _id: new ObjectId(courseId) }, { projection: { status: 1, title: 1 } }),
  ]);
  if (!user) return refuse(404, 'student_not_found', 'No account matches.');
  if (user.role !== 'student') return refuse(409, 'not_a_student', 'Course access can be granted to student accounts only.');
  if (!course) return refuse(404, 'course_not_found', 'Course not found.');
  return { ok: true, course };
}

function historyWith(access, now) {
  const previous = Array.isArray(access.accessHistory) ? access.accessHistory.slice(-19) : [];
  return [...previous, {
    entitlementType: access.entitlementType == null ? null : String(access.entitlementType),
    paid: access.paid === true,
    revokedAt: access.revokedAt || null,
    changedAt: now,
  }];
}

/** Matches the access row only while it is still in the state that was read. */
function unchangedFilter(access) {
  return {
    _id: access._id,
    paid: access.paid === true ? true : { $ne: true },
    entitlementType: access.entitlementType == null ? { $exists: false } : access.entitlementType,
  };
}

async function grantCourseAccess(db, { actor, userId, courseId, reason, now = new Date() }) {
  const why = cleanReason(reason);
  if (!why) return refuse(400, 'reason_required', `Give a reason (${REASON_MIN}-${REASON_MAX} characters).`);
  const target = await loadTarget(db, { userId, courseId });
  if (!target.ok) return target;
  const status = courseStatus(target.course);
  if (status !== COURSE_STATUS.PUBLISHED && status !== COURSE_STATUS.ARCHIVED) {
    return refuse(409, 'course_not_available', 'Access can be granted only to a published or archived course.');
  }
  const accessCol = db.collection(COLLECTIONS.courseAccess);
  const access = await accessCol.findOne({ userId, courseId });
  if (access && isEntitledRow(access)) return refuse(409, 'already_entitled', 'The student already has access to this course.');
  const grant = {
    entitlementType: 'complimentary',
    grantedAt: now,
    grantedBy: actorOf(actor),
    grantReason: why,
    source: 'admin-grant',
  };
  if (!access) {
    try {
      await accessCol.insertOne({ userId, courseId, paid: false, ...grant, createdAt: now });
    } catch (error) {
      if (isDuplicateKey(error)) return refuse(409, 'access_changed', 'The access record changed meanwhile. Reload and try again.');
      throw error;
    }
  } else {
    const updated = await accessCol.updateOne(unchangedFilter(access), { $set: { ...grant, accessHistory: historyWith(access, now) } });
    if (!updated.modifiedCount) return refuse(409, 'access_changed', 'The access record changed meanwhile. Reload and try again.');
  }
  const enrollment = await ensureActiveEnrollment(db, { userId, courseId, reactivate: true, via: 'admin-grant', now });
  await appendAudit(db, {
    _id: `course_access:${userId}:${courseId}:granted:${now.getTime()}`,
    entityType: 'course_access',
    entityId: `${userId}:${courseId}`,
    action: 'course_access_granted',
    reason: why,
    before: stateOf(access),
    after: { entitlementType: 'complimentary', paid: false, entitled: true, enrollment: enrollment.action },
    actor: actorOf(actor),
    createdAt: now,
  });
  return { ok: true, status: 200, code: 'granted', enrollment: enrollment.action };
}

async function revokeCourseGrant(db, { actor, userId, courseId, reason, now = new Date() }) {
  const why = cleanReason(reason);
  if (!why) return refuse(400, 'reason_required', `Give a reason (${REASON_MIN}-${REASON_MAX} characters).`);
  const target = await loadTarget(db, { userId, courseId });
  if (!target.ok) return target;
  const accessCol = db.collection(COLLECTIONS.courseAccess);
  const access = await accessCol.findOne({ userId, courseId });
  if (!access || !isEntitledRow(access)) return refuse(409, 'no_access', 'The student has no access to revoke for this course.');
  if (access.paid === true || !GRANTED_ENTITLEMENTS.includes(access.entitlementType)) {
    return refuse(409, 'paid_access', 'Paid access ends only through a full refund with access removal (Purchases).');
  }
  const updated = await accessCol.updateOne(unchangedFilter(access), {
    $set: {
      entitlementType: GRANT_REVOKED,
      revokedAt: now,
      revokedBy: actorOf(actor),
      revokedReason: why,
      accessHistory: historyWith(access, now),
    },
  });
  if (!updated.modifiedCount) return refuse(409, 'access_changed', 'The access record changed meanwhile. Reload and try again.');
  await appendAudit(db, {
    _id: `course_access:${userId}:${courseId}:revoked:${now.getTime()}`,
    entityType: 'course_access',
    entityId: `${userId}:${courseId}`,
    action: 'course_access_grant_revoked',
    reason: why,
    before: stateOf(access),
    after: { entitlementType: GRANT_REVOKED, paid: false, entitled: false },
    actor: actorOf(actor),
    createdAt: now,
  });
  return { ok: true, status: 200, code: 'revoked' };
}

module.exports = { GRANT_REVOKED, REASON_MAX, REASON_MIN, grantCourseAccess, revokeCourseGrant, studentAccessOverview };
