'use strict';

/**
 * Permanent course deletion (Phase 4, Decision 2).
 *
 * Archiving is the normal way to retire a course. Permanent deletion is for courses that never
 * gathered any learning, financial or audit history, for example a draft created by mistake:
 *   - Super Admin only;
 *   - never a published course (archive it first, so no new enrolment or checkout can start);
 *   - refused, with code `course_has_dependents`, while any record listed in PROTECTED_RECORDS
 *     refers to the course or one of its lessons. Nothing is cascade-deleted.
 * When it is allowed, the course, its lessons, their quizzes and its (unsubmitted) assignments
 * are removed, an audit entry is written, and unused course images are cleaned up afterwards.
 *
 * Races: the request first claims the course (`deletionStartedAt`, set only if the course is
 * still in the state that was checked). Enrolment and checkout accept only published courses, and
 * lifecycle changes require the claim to be absent, so nothing new can attach while the
 * dependency check and the deletes run. A claim left by a failed attempt expires after
 * CLAIM_TTL_MS.
 */

const { ObjectId } = require('mongodb');
const { AUDIT_COLLECTION, COLLECTIONS } = require('./course-payment');
const { COURSE_STATUS, courseStatus, statusFilter } = require('./course-lifecycle');

const CLAIM_TTL_MS = 10 * 60 * 1000;

/** Records that must be kept, so their course cannot be deleted. Keyed by course or lesson id. */
const PROTECTED_RECORDS = Object.freeze([
  { kind: 'enrollments', collection: 'progress', key: 'courseId' },
  { kind: 'course_access', collection: COLLECTIONS.courseAccess, key: 'courseId' },
  { kind: 'course_purchases', collection: COLLECTIONS.coursePurchases, key: 'courseId' },
  { kind: 'payment_intents', collection: COLLECTIONS.intents, key: 'courseId' },
  { kind: 'payments', collection: COLLECTIONS.payments, key: 'courseId' },
  { kind: 'payment_exceptions', collection: COLLECTIONS.exceptions, key: 'courseId' },
  { kind: 'certificates', collection: 'certificates', key: 'courseId' },
  { kind: 'quiz_scores', collection: 'quizScores', key: 'courseId' },
  { kind: 'assignment_submissions', collection: 'assignmentSubmissions', key: 'courseId' },
  { kind: 'classes', collection: 'classes', key: 'courseId' },
  { kind: 'lesson_access', collection: COLLECTIONS.lessonAccess, key: 'lessonId', byLesson: true },
  { kind: 'lesson_purchases', collection: COLLECTIONS.lessonPurchases, key: 'lessonId', byLesson: true },
  { kind: 'lesson_messages', collection: 'messages', key: 'lessonId', byLesson: true },
]);

function idValues(id) {
  const values = [String(id)];
  if (ObjectId.isValid(String(id))) values.push(new ObjectId(String(id)));
  return values;
}

/** Which kinds of protected record exist for the course (existence only, one read each). */
async function protectedRecordKinds(db, courseId, lessonIds) {
  const courseValues = idValues(courseId);
  const lessonValues = (lessonIds || []).flatMap(idValues);
  const found = [];
  for (const record of PROTECTED_RECORDS) {
    const values = record.byLesson ? lessonValues : courseValues;
    if (!values.length) continue;
    const count = await db.collection(record.collection).countDocuments({ [record.key]: { $in: values } }, { limit: 1 });
    if (count > 0) found.push(record.kind);
  }
  return found;
}

function decideCourseDeletion({ member, course }) {
  if (!member || member.role !== 'superadmin') {
    return {
      ok: false,
      status: 403,
      code: 'archive_instead',
      error: 'Only the Super Admin can delete a course permanently. Archive the course instead.',
    };
  }
  if (!course || course._id == null) {
    return { ok: false, status: 404, code: 'course_not_found', error: 'Course not found' };
  }
  const status = courseStatus(course);
  if (status === COURSE_STATUS.PUBLISHED) {
    return {
      ok: false,
      status: 409,
      code: 'course_published',
      error: 'A published course cannot be deleted. Archive it first; archiving keeps every student record.',
    };
  }
  return { ok: true, status: 200, courseId: String(course._id), from: status };
}

/** `status` is draft, in_review or archived (a plain `{ status }` filter, never legacy rows). */
function claimFilter(courseId, status, now) {
  return {
    _id: new ObjectId(String(courseId)),
    ...statusFilter(status),
    $or: [{ deletionStartedAt: { $exists: false } }, { deletionStartedAt: { $lt: new Date(now.getTime() - CLAIM_TTL_MS) } }],
  };
}

/**
 * Deletes the course if it has no protected records. Returns
 *   { ok: true, deleted: { lessons, quizzes, assignments }, assets }   (assets: images to clean up)
 *   { ok: false, status, code, error, dependents? }
 */
async function deleteCoursePermanently(db, { courseId, from, actor, assetsOf, now = new Date() }) {
  const courses = db.collection('courses');
  if (from === COURSE_STATUS.PUBLISHED) throw new Error('published courses are never deleted');
  const claimed = await courses.updateOne(claimFilter(courseId, from, now), { $set: { deletionStartedAt: now } });
  if (!claimed.matchedCount) {
    return { ok: false, status: 409, code: 'course_changed', error: 'The course changed or is already being deleted. Reload and try again.' };
  }
  const release = () => courses.updateOne({ _id: new ObjectId(String(courseId)) }, { $unset: { deletionStartedAt: '' } });
  let lessons;
  let dependents;
  try {
    lessons = await db.collection('lessons')
      .find({ courseId: String(courseId) }, { projection: { _id: 1, content: 1, description: 1, summary: 1, title: 1, lessonSummary: 1, videoUrl: 1, pdfUrl: 1, resources: 1 } })
      .toArray();
    dependents = await protectedRecordKinds(db, courseId, lessons.map((lesson) => String(lesson._id)));
  } catch (error) {
    await release();
    throw error;
  }
  if (dependents.length) {
    await release();
    return {
      ok: false,
      status: 409,
      code: 'course_has_dependents',
      error: 'This course has student, payment or certificate records and cannot be deleted. Archive it instead.',
      dependents,
    };
  }
  const course = await courses.findOne({ _id: new ObjectId(String(courseId)) }, { projection: { title: 1, description: 1, thumbnail: 1, status: 1, instructorId: 1 } });
  const assets = typeof assetsOf === 'function' ? assetsOf(course, lessons) : [];
  const lessonIds = lessons.map((lesson) => String(lesson._id));
  const quizzes = lessonIds.length ? await db.collection('quizzes').deleteMany({ lessonId: { $in: lessonIds } }) : { deletedCount: 0 };
  const assignments = await db.collection('assignments').deleteMany({ courseId: { $in: idValues(courseId) } });
  const removedLessons = await db.collection('lessons').deleteMany({ courseId: String(courseId) });
  await courses.deleteOne({ _id: new ObjectId(String(courseId)) });
  try {
    await db.collection(AUDIT_COLLECTION).insertOne({
      entityType: 'course',
      entityId: String(courseId),
      reference: null,
      action: 'course_deleted',
      reason: '',
      before: { status: from, title: course && typeof course.title === 'string' ? course.title : '', lessons: lessonIds.length },
      after: null,
      actor: { userId: String(actor.userId), email: typeof actor.email === 'string' ? actor.email : null },
      createdAt: now,
    });
  } catch {
    console.error(JSON.stringify({ event: 'courseDelete', courseId: String(courseId), result: 'audit_write_failed' }));
  }
  return {
    ok: true,
    status: 200,
    deleted: { lessons: removedLessons.deletedCount || 0, quizzes: quizzes.deletedCount || 0, assignments: assignments.deletedCount || 0 },
    assets,
  };
}

module.exports = {
  CLAIM_TTL_MS,
  PROTECTED_RECORDS,
  decideCourseDeletion,
  deleteCoursePermanently,
  protectedRecordKinds,
};
