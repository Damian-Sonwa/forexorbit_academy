/**
 * Staff progress is a course aggregate.
 * It does not return lesson ids, quiz scores, or student contact details.
 */

const { isActiveEnrollment } = require('./enrollment-state');
const { canReadCourseLessons } = require('./course-response');

function summarizeStaffProgress({ role, userId, courses, rows, difficulty, courseId }) {
  if (role !== 'instructor' && role !== 'admin' && role !== 'superadmin') {
    return { ok: false, status: 403, error: 'Not authorized' };
  }
  const requestedDifficulty = typeof difficulty === 'string' ? difficulty : '';
  const requestedCourse = typeof courseId === 'string' ? courseId : '';
  const visible = (Array.isArray(courses) ? courses : []).filter((course) => {
    if (!course) return false;
    const id = String(course._id || course.id || '');
    if (!id) return false;
    if (requestedCourse && id !== requestedCourse) return false;
    if (requestedDifficulty && course.difficulty !== requestedDifficulty) return false;
    return canReadCourseLessons(role, userId, course.instructorId);
  });
  const visibleIds = new Set(visible.map((course) => String(course._id || course.id)));
  const activeRows = (Array.isArray(rows) ? rows : []).filter((row) => {
    return isActiveEnrollment(row) && visibleIds.has(String(row.courseId));
  });
  const courseViews = visible.map((course) => {
    const id = String(course._id || course.id);
    const mine = activeRows.filter((row) => String(row.courseId) === id);
    return {
      courseId: id,
      title: typeof course.title === 'string' ? course.title : '',
      difficulty: typeof course.difficulty === 'string' ? course.difficulty : '',
      activeEnrollments: mine.length,
      completed: mine.filter((row) => typeof row.progress === 'number' && row.progress >= 100).length,
      inProgress: mine.filter((row) => typeof row.progress === 'number' && row.progress > 0 && row.progress < 100).length,
    };
  });
  const studentIds = new Set(activeRows.map((row) => String(row.userId)));
  return {
    ok: true,
    status: 200,
    courses: courseViews,
    totals: {
      students: studentIds.size,
      courses: courseViews.length,
      completed: courseViews.reduce((sum, course) => sum + course.completed, 0),
      inProgress: courseViews.reduce((sum, course) => sum + course.inProgress, 0),
    },
  };
}

module.exports = { summarizeStaffProgress };
