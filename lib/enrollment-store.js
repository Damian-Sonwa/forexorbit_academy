'use strict';

/**
 * Server-side enrollment writes (Phase 6). Enrollment rows live in `progress`, one per student
 * and course (unique index E1, lib/enrollment-indexes.js). Rows are never deleted: a withdrawal
 * sets `active: false` and `withdrawnAt` (lib/enrollment-state.js).
 *
 * `ensureActiveEnrollment` is used after a verified course payment, by reconciliation, and by a
 * Super Admin access grant, so a student who holds the course entitlement is never left without
 * the enrollment the lesson routes require:
 *   - no row: one is created (a concurrent creation loses on the unique index and is treated as
 *     existing);
 *   - a withdrawn row: reactivated only when `reactivate` is true (a new payment or an explicit
 *     grant). A replayed event or a reconciliation pass never re-enrolls a student who left.
 */

const { ObjectId } = require('mongodb');
const { isActiveEnrollment } = require('./enrollment-state');

const ENROLLMENTS = 'progress';

function isDuplicateKey(error) {
  return Boolean(error && (error.code === 11000 || error.codeName === 'DuplicateKey'));
}

/** Both stored forms of a course id: new rows use the string, older rows may hold an ObjectId. */
function courseIdForms(courseId) {
  const value = String(courseId);
  return ObjectId.isValid(value) && value.length === 24 ? [value, new ObjectId(value)] : [value];
}

function enrollmentQuery(userId, courseId) {
  return { userId: String(userId), $or: courseIdForms(courseId).map((form) => ({ courseId: form })) };
}

async function findEnrollment(db, userId, courseId) {
  return db.collection(ENROLLMENTS).findOne(enrollmentQuery(userId, courseId));
}

/**
 * Makes sure the student has an enrollment row for the course. Returns
 * `{ action: 'created' | 'reactivated' | 'existing' | 'withdrawn_kept' }`.
 */
async function ensureActiveEnrollment(db, { userId, courseId, reactivate = false, via = 'system', now = new Date() }) {
  const enrollments = db.collection(ENROLLMENTS);
  const existing = await findEnrollment(db, userId, courseId);
  if (existing) {
    if (isActiveEnrollment(existing)) return { action: 'existing' };
    if (!reactivate) return { action: 'withdrawn_kept' };
    const updated = await enrollments.updateOne(
      { _id: existing._id, $or: [{ active: false }, { withdrawnAt: { $exists: true } }] },
      { $set: { active: true, updatedAt: now, reactivatedVia: via }, $unset: { withdrawnAt: '' } }
    );
    return { action: updated.modifiedCount ? 'reactivated' : 'existing' };
  }
  try {
    await enrollments.insertOne({
      userId: String(userId),
      courseId: String(courseId),
      progress: 0,
      completedLessons: [],
      active: true,
      enrolledVia: via,
      createdAt: now,
      updatedAt: now,
    });
    return { action: 'created' };
  } catch (error) {
    if (isDuplicateKey(error)) return { action: 'existing' };
    throw error;
  }
}

module.exports = { ENROLLMENTS, courseIdForms, enrollmentQuery, findEnrollment, ensureActiveEnrollment };
