'use strict';

/**
 * A student's learning summary (Phase 8): their courses with completion status, where to
 * continue, in-progress / completed / recently studied lists, learning time and streak.
 *
 * Everything comes from persisted records, read with a fixed number of queries however many
 * courses the student has (no per-course requests):
 *   1. progress rows of the student                       (index L1 perf_progress_user)
 *   2. those courses (title, status, preview flag only)   (_id)
 *   3. their lessons: navigation fields, never bodies      (index L2 perf_lessons_course_order)
 *   4. course entitlements of the student, one $in query   (unique I4 on userId + courseId)
 *   5./6. legacy per-lesson access (lib/course-payment.js legacyLessonIdsWithAccess)
 *   7. learning days                                       (index A2, lib/learning-activity-indexes.js)
 *
 * Course percentage and completion use lib/course-progress.js (current lessons only, never above
 * 100, completedAt permanent). Lock state uses the Phase 6 rule (priceCourseLessons). Visibility
 * uses lib/course-lifecycle.js canSeeCourse: drafts and courses in review are left out; an
 * archived course stays for an active enrollment.
 *
 * Continue learning (docs/audits/phase-8-learning-progress.md, section 4.6): the most recently
 * studied course that is not complete; in it, the last viewed lesson if it still exists, is open
 * and is not completed; otherwise the next open, unfinished lesson after it in course order;
 * otherwise the first open, unfinished lesson. When only locked lessons remain the course page is
 * offered (to unlock), with no lesson.
 */

const { ObjectId } = require('mongodb');
const { isActiveEnrollment } = require('./enrollment-state');
const { canSeeCourse } = require('./course-lifecycle');
const { courseCompletion, currentCompletedIds } = require('./course-progress');
const { priceCourseLessons, sortLessonsByOrder } = require('./course-lesson-list');
const { COLLECTIONS, GRANTED_ENTITLEMENTS, legacyLessonIdsWithAccess } = require('./course-payment');
const { learningStats } = require('./learning-activity');

const STORED_ID = /^[a-fA-F0-9]{24}$/;
const SUMMARY_LESSON_PROJECTION = Object.freeze({ _id: 1, courseId: 1, title: 1, order: 1, isFreePreview: 1, isFirstLesson: 1, isDemo: 1 });
const SUMMARY_COURSE_PROJECTION = Object.freeze({ title: 1, thumbnail: 1, difficulty: 1, category: 1, status: 1, freePreviewExplicit: 1, instructorId: 1 });
const RECENT_LIMIT = 5;

const time = (value) => (value instanceof Date ? value.getTime() : value ? new Date(value).getTime() || 0 : 0);
const iso = (value) => (value ? new Date(value).toISOString() : null);

/** Most recent study of the course: last view, last activity, or the last progress write. */
function lastStudiedAt(row) {
  return Math.max(time(row.lastViewedAt), time(row.lastActivityAt), time(row.updatedAt));
}

/** Where to continue in one course; `lessons` sorted, `pricing` from priceCourseLessons. */
function resumeTarget({ lessons, pricing, completed, lastLessonId }) {
  const open = (lesson) => {
    const price = pricing.get(String(lesson._id));
    return Boolean(price && !price.locked);
  };
  const usable = (lesson) => open(lesson) && !completed.has(String(lesson._id));
  const index = lastLessonId ? lessons.findIndex((lesson) => String(lesson._id) === String(lastLessonId)) : -1;
  if (index >= 0 && usable(lessons[index])) return { lesson: lessons[index], reason: 'last_viewed' };
  if (index >= 0) {
    const after = lessons.slice(index + 1).find(usable);
    if (after) return { lesson: after, reason: 'next_after_last_viewed' };
  }
  const first = lessons.find(usable);
  if (first) return { lesson: first, reason: lastLessonId && index < 0 ? 'last_viewed_unavailable' : 'first_unfinished' };
  if (lessons.some((lesson) => !open(lesson) && !completed.has(String(lesson._id)))) return { lesson: null, reason: 'locked_remaining' };
  return null;
}

async function loadEntitlements(db, userId, courseIds, lessonIds) {
  const [paidRows, legacy] = await Promise.all([
    courseIds.length
      ? db.collection(COLLECTIONS.courseAccess).find({
        userId: String(userId),
        courseId: { $in: courseIds },
        $or: [{ paid: true }, { entitlementType: { $in: [...GRANTED_ENTITLEMENTS] } }],
      }, { projection: { courseId: 1 } }).toArray()
      : [],
    lessonIds.length ? legacyLessonIdsWithAccess(db, String(userId), lessonIds) : new Set(),
  ]);
  return { paidCourses: new Set(paidRows.map((row) => String(row.courseId))), legacyLessonIds: legacy };
}

async function buildProgressSummary(db, { userId, role = 'student', now = new Date(), env } = {}) {
  const member = { userId: String(userId), role };
  const rows = (await db.collection('progress').find({ userId: String(userId) }).toArray()).filter(isActiveEnrollment);
  const courseIds = [...new Set(rows.map((row) => String(row.courseId || '')).filter((id) => STORED_ID.test(id)))];
  const [courseRows, lessonRows, stats] = await Promise.all([
    courseIds.length
      ? db.collection('courses').find({ _id: { $in: courseIds.map((id) => new ObjectId(id)) } }, { projection: SUMMARY_COURSE_PROJECTION }).toArray()
      : [],
    courseIds.length
      ? db.collection('lessons').find({ courseId: { $in: courseIds } }, { projection: SUMMARY_LESSON_PROJECTION }).toArray()
      : [],
    learningStats(db, userId, { now }),
  ]);
  const courseById = new Map(courseRows.map((course) => [String(course._id), course]));
  const lessonsByCourse = new Map();
  for (const lesson of lessonRows) {
    const key = String(lesson.courseId);
    if (!lessonsByCourse.has(key)) lessonsByCourse.set(key, []);
    lessonsByCourse.get(key).push(lesson);
  }
  const entitlements = await loadEntitlements(db, userId, courseIds, lessonRows.map((lesson) => String(lesson._id)));

  const seen = new Set();
  const courses = [];
  for (const row of rows) {
    const courseId = String(row.courseId || '');
    const course = courseById.get(courseId);
    // One entry per course (E1 keeps one row, but older data may hold a second form of the id).
    if (!course || seen.has(courseId)) continue;
    if (!canSeeCourse(member, course, { activeEnrollment: true })) continue;
    seen.add(courseId);
    const lessons = sortLessonsByOrder(lessonsByCourse.get(courseId) || []);
    const lessonIds = lessons.map((lesson) => String(lesson._id));
    const completion = courseCompletion({ enrollment: row, currentLessonIds: lessonIds });
    const completedIds = currentCompletedIds(row.completedLessons, lessonIds);
    const pricing = priceCourseLessons(lessons, {
      staff: false,
      coursePaid: entitlements.paidCourses.has(courseId),
      legacyLessonIds: entitlements.legacyLessonIds,
    }, env, { explicitPreview: course.freePreviewExplicit === true });
    const completed = new Set(completedIds);
    const target = completion.complete ? null : resumeTarget({ lessons, pricing, completed, lastLessonId: row.lastLessonId });
    const lastViewed = row.lastLessonId ? lessons.find((lesson) => String(lesson._id) === String(row.lastLessonId)) : null;
    const status = completion.complete ? 'completed' : completedIds.length > 0 || row.lastViewedAt ? 'in_progress' : 'not_started';
    courses.push({
      courseId,
      title: typeof course.title === 'string' ? course.title : 'Course',
      thumbnail: course.thumbnail || null,
      difficulty: course.difficulty || null,
      category: course.category || null,
      archived: course.status === 'archived',
      status,
      percent: Math.round(completion.percent * 100) / 100,
      completedLessons: completedIds.length,
      totalLessons: lessonIds.length,
      completedAt: iso(row.completedAt),
      lastViewedAt: iso(row.lastViewedAt),
      lastStudiedAt: lastStudiedAt(row) ? new Date(lastStudiedAt(row)).toISOString() : null,
      lastLesson: lastViewed ? { lessonId: String(lastViewed._id), title: lastViewed.title || 'Lesson' } : null,
      next: target
        ? { lessonId: target.lesson ? String(target.lesson._id) : null, title: target.lesson ? target.lesson.title || 'Lesson' : null, reason: target.reason }
        : null,
    });
  }
  const byRecent = [...courses].sort((a, b) => time(b.lastStudiedAt) - time(a.lastStudiedAt));
  const resumable = byRecent.find((course) => course.status !== 'completed' && course.next);
  return {
    continue: resumable
      ? { courseId: resumable.courseId, courseTitle: resumable.title, lessonId: resumable.next.lessonId, lessonTitle: resumable.next.title, reason: resumable.next.reason, percent: resumable.percent }
      : null,
    totals: {
      enrolled: courses.length,
      completedCourses: courses.filter((c) => c.status === 'completed').length,
      inProgressCourses: courses.filter((c) => c.status === 'in_progress').length,
      completedLessons: courses.reduce((sum, c) => sum + c.completedLessons, 0),
    },
    courses,
    inProgress: byRecent.filter((c) => c.status === 'in_progress'),
    completed: [...courses].filter((c) => c.status === 'completed').sort((a, b) => time(b.completedAt) - time(a.completedAt)),
    recent: byRecent.filter((c) => c.lastViewedAt).slice(0, RECENT_LIMIT),
    learning: stats,
  };
}

module.exports = { RECENT_LIMIT, SUMMARY_COURSE_PROJECTION, SUMMARY_LESSON_PROJECTION, buildProgressSummary, lastStudiedAt, resumeTarget };
