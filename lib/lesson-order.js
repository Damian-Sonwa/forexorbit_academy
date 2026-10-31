'use strict';

/**
 * Lesson positions within a course (Phase 4, M3).
 *
 * Positions are assigned by the server, never taken from a lesson form:
 *   - a new lesson goes to the end. The course document keeps a counter (`lessonOrderSeq`)
 *     raised atomically, so two lessons created at the same moment get different positions;
 *   - a reorder rewrites every position as 1..n from one full, exact list of the course's lessons.
 * Every change to the set of lessons raises `lessonOrderVersion` on the course. A reorder claims
 * the version it validated against, so a reorder that raced another reorder, a new lesson or a
 * deleted lesson is refused (409) instead of leaving duplicate or missing positions.
 *
 * Free previews are explicit lesson flags (Decision 3), so no position change makes a lesson
 * free or paid. Progress stores lesson ids, not positions, so reordering never changes it.
 */

const { ObjectId } = require('mongodb');
const { decideContentEdit } = require('./course-lifecycle');

/** Same rule as ownsCourse in lib/account-access.js: assigned instructor, admin, Super Admin. */
function ownsCourseForOrder(member, course) {
  if (!member || !course) return false;
  if (member.role === 'admin' || member.role === 'superadmin') return true;
  return member.role === 'instructor' && course.instructorId != null && String(course.instructorId) === String(member.userId);
}

const MAX_LESSONS_PER_REORDER = 500;

function versionFilter(version) {
  return Number.isInteger(version) ? { lessonOrderVersion: version } : { lessonOrderVersion: { $exists: false } };
}

/** The next position at the end of the course. Raises the course's lesson version. */
async function nextLessonPosition(db, courseId) {
  const id = new ObjectId(String(courseId));
  const last = await db.collection('lessons')
    .find({ courseId: String(courseId) }, { projection: { order: 1 } })
    .sort({ order: -1 })
    .limit(1)
    .toArray();
  const highest = last.length && Number.isFinite(last[0].order) ? Math.max(0, Math.floor(last[0].order)) : 0;
  // Two steps, each atomic: never below the highest stored position, then one more.
  await db.collection('courses').updateOne({ _id: id }, { $max: { lessonOrderSeq: highest } });
  const course = await db.collection('courses').findOneAndUpdate(
    { _id: id },
    { $inc: { lessonOrderSeq: 1, lessonOrderVersion: 1 } },
    { returnDocument: 'after', includeResultMetadata: false, projection: { lessonOrderSeq: 1 } }
  );
  if (!course || !Number.isInteger(course.lessonOrderSeq)) throw new Error('lesson position unavailable');
  return course.lessonOrderSeq;
}

/** Records that the course's set of lessons changed (for example a lesson was deleted). */
async function touchLessonSet(db, courseId) {
  await db.collection('courses').updateOne({ _id: new ObjectId(String(courseId)) }, { $inc: { lessonOrderVersion: 1 } });
}

/**
 * Checks a reorder request: the member may edit the course and `lessonIds` is exactly the
 * course's current lessons, each once.
 */
function decideLessonReorder({ member, course, lessonIds, currentLessonIds }) {
  if (!member || !['instructor', 'admin', 'superadmin'].includes(member.role)) {
    return { ok: false, status: 403, code: 'not_authorized', error: 'Not authorized' };
  }
  if (!course || course._id == null) {
    return { ok: false, status: 404, code: 'course_not_found', error: 'Course not found' };
  }
  if (!ownsCourseForOrder(member, course)) {
    return { ok: false, status: 403, code: 'not_authorized', error: 'Not authorized' };
  }
  const editable = decideContentEdit(member, course);
  if (!editable.ok) return editable;
  if (!Array.isArray(lessonIds) || lessonIds.length > MAX_LESSONS_PER_REORDER || !lessonIds.every((id) => typeof id === 'string' && /^[a-f0-9]{24}$/i.test(id))) {
    return { ok: false, status: 400, code: 'invalid_order', error: 'Send the list of lesson ids in their new order.' };
  }
  const requested = lessonIds.map((id) => id.toLowerCase());
  const current = (currentLessonIds || []).map((id) => String(id).toLowerCase());
  const unique = new Set(requested);
  if (unique.size !== requested.length) {
    return { ok: false, status: 400, code: 'invalid_order', error: 'Each lesson can appear only once.' };
  }
  if (unique.size !== current.length || !current.every((id) => unique.has(id))) {
    return { ok: false, status: 409, code: 'lessons_changed', error: 'The lessons of this course changed. Reload the page and try again.' };
  }
  return { ok: true, status: 200, courseId: String(course._id), lessonIds: requested };
}

/**
 * Applies a checked reorder. `version` is the course's lessonOrderVersion read before the check.
 * Returns false when another change won the race (nothing is written then).
 */
async function applyLessonReorder(db, { courseId, lessonIds, version }) {
  const claimed = await db.collection('courses').updateOne(
    { _id: new ObjectId(String(courseId)), ...versionFilter(version) },
    { $inc: { lessonOrderVersion: 1 }, $max: { lessonOrderSeq: lessonIds.length } }
  );
  if (!claimed.matchedCount) return false;
  await db.collection('lessons').bulkWrite(
    lessonIds.map((id, index) => ({
      updateOne: { filter: { _id: new ObjectId(id), courseId: String(courseId) }, update: { $set: { order: index + 1, updatedAt: new Date() } } },
    })),
    { ordered: true }
  );
  return true;
}

module.exports = {
  MAX_LESSONS_PER_REORDER,
  applyLessonReorder,
  decideLessonReorder,
  nextLessonPosition,
  touchLessonSet,
  versionFilter,
};
