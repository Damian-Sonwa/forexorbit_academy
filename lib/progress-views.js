'use strict';

/**
 * Enrollment progress for one learner, as returned by GET /api/progress.
 *
 * Reads a fixed number of queries however many courses the learner is enrolled in: the
 * progress rows, the courses they name (only the fields shown), the lesson ids of those courses
 * (to count them, without loading lesson content) and the learner's quiz scores for them.
 * The earlier version ran three queries per enrollment and loaded every lesson document in full.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ObjectId } = require('mongodb');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { presentEnrollmentProgress, quizHistoryQuery } = require('./enrollment-state');

const COURSE_ID = /^[a-fA-F0-9]{24}$/;

async function loadEnrollmentProgress(db, userId) {
  const userProgress = await db.collection('progress').find({ userId }).toArray();
  const courseIds = [...new Set(userProgress.map((row) => (row.courseId == null ? '' : String(row.courseId))).filter(Boolean))];
  if (courseIds.length === 0) {
    return userProgress.map((row) => presentEnrollmentProgress(row, { course: null, totalLessons: 0, quizScores: [] }));
  }

  const objectIds = courseIds.filter((id) => COURSE_ID.test(id)).map((id) => new ObjectId(id));
  // Same match as the per-course query this replaces (quizHistoryQuery), widened to all courses.
  const quizFilter = { ...quizHistoryQuery(userId, ''), courseId: { $in: courseIds } };
  const [courseRows, lessonRows, scoreRows] = await Promise.all([
    objectIds.length
      ? db.collection('courses')
        .find({ _id: { $in: objectIds } }, { projection: { title: 1, thumbnail: 1, difficulty: 1, category: 1 } })
        .toArray()
      : [],
    db.collection('lessons').find({ courseId: { $in: courseIds } }, { projection: { courseId: 1 } }).toArray(),
    db.collection('quizScores').find(quizFilter).toArray(),
  ]);

  const courseById = new Map(courseRows.map((course) => [String(course._id), course]));
  const lessonCount = new Map();
  for (const lesson of lessonRows) {
    const key = String(lesson.courseId);
    lessonCount.set(key, (lessonCount.get(key) || 0) + 1);
  }
  const scoresByCourse = new Map();
  for (const score of scoreRows) {
    const key = String(score.courseId);
    if (!scoresByCourse.has(key)) scoresByCourse.set(key, []);
    scoresByCourse.get(key).push(score);
  }

  return userProgress.map((row) => {
    const courseIdStr = row.courseId == null ? '' : String(row.courseId);
    const course = COURSE_ID.test(courseIdStr) ? courseById.get(courseIdStr.toLowerCase()) || null : null;
    return presentEnrollmentProgress(row, {
      course: course ? {
        id: String(course._id),
        title: course.title,
        thumbnail: course.thumbnail,
        difficulty: course.difficulty,
        category: course.category,
      } : null,
      totalLessons: courseIdStr ? lessonCount.get(courseIdStr) || 0 : 0,
      quizScores: courseIdStr ? scoresByCourse.get(courseIdStr) || [] : [],
    });
  });
}

module.exports = { loadEnrollmentProgress };
