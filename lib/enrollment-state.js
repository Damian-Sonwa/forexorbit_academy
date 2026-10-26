/**
 * Enrollment state.
 * The withdrawn-enrollment rule below is implemented so every reader shares it.
 * The product owner approved it on 26 October 2026. Rows without withdrawnAt stay active.
 * Do not delete progress documents.
 */

const STORED_ID = /^[a-fA-F0-9]{24}$/;

function isStoredCourseId(value) {
  return typeof value === 'string' && STORED_ID.test(value);
}

function isActiveEnrollment(row) {
  if (!row || typeof row !== 'object') return false;
  if (row.active === false) return false;
  if (row.withdrawnAt != null && row.withdrawnAt !== '') return false;
  return true;
}

function activeEnrollmentFilter() {
  return {
    active: { $ne: false },
    withdrawnAt: { $exists: false },
  };
}

function enrollmentDecisionRecord(row) {
  if (!row || typeof row !== 'object') return null;
  const record = {
    userId: row.userId,
    courseId: row.courseId,
    progress: typeof row.progress === 'number' ? row.progress : 0,
  };
  if (row.active === false) record.active = false;
  if (row.withdrawnAt != null && row.withdrawnAt !== '') record.withdrawnAt = row.withdrawnAt;
  return record;
}

function sameUser(row, userId) {
  return Boolean(row && String(row.userId) === String(userId));
}

function decideEnroll({ role, userId, courseId, course, existing }) {
  if (role !== 'student') {
    return { ok: false, status: 403, error: 'Unauthorized' };
  }
  if (!isStoredCourseId(courseId)) {
    return { ok: false, status: 400, error: 'Invalid course ID', writes: false };
  }
  if (!course || course._id == null || String(course._id) !== String(courseId)) {
    return { ok: false, status: 404, error: 'Course not found', writes: false };
  }
  if (existing && sameUser(existing, userId) && isActiveEnrollment(existing)) {
    return { ok: false, status: 400, error: 'Already enrolled', writes: false };
  }
  if (existing && sameUser(existing, userId)) {
    return {
      ok: true,
      status: 200,
      action: 'reactivate',
      courseId: String(courseId),
      writes: true,
    };
  }
  return {
    ok: true,
    status: 200,
    action: 'insert',
    courseId: String(courseId),
    writes: true,
    document: {
      userId: String(userId),
      courseId: String(courseId),
      progress: 0,
      completedLessons: [],
      active: true,
    },
  };
}

function decideUnenroll({ role, userId, courseId, existing }) {
  if (role !== 'student') {
    return { ok: false, status: 403, error: 'Unauthorized', writes: false };
  }
  if (!isStoredCourseId(courseId)) {
    return { ok: false, status: 400, error: 'Invalid course ID', writes: false };
  }
  if (!existing || !sameUser(existing, userId) || !isActiveEnrollment(existing)) {
    return { ok: true, status: 200, action: 'none', writes: false };
  }
  return {
    ok: true,
    status: 200,
    action: 'withdraw',
    courseId: String(courseId),
    writes: true,
  };
}

function enrollDuplicateStatus(error) {
  const code = error && (error.code || error.codeName);
  if (code === 11000 || code === 'DuplicateKey') {
    return { status: 400, body: { error: 'Already enrolled' } };
  }
  return { status: 500, body: { error: 'Internal server error' } };
}

function quizHistoryQuery(userId, courseId) {
  return {
    userId: userId == null ? '' : String(userId),
    courseId: courseId == null ? '' : String(courseId),
  };
}

function presentQuizScore(score) {
  const source = score && typeof score === 'object' ? score : {};
  const totalQuestions = typeof source.totalQuestions === 'number' ? source.totalQuestions : 0;
  const value = typeof source.score === 'number' ? source.score : 0;
  return {
    lessonId: source.lessonId == null ? '' : String(source.lessonId),
    score: value,
    totalQuestions,
    percentage: totalQuestions > 0 ? Math.round((value / totalQuestions) * 100) : 0,
  };
}

function presentEnrollmentProgress(row, details) {
  const source = row && typeof row === 'object' ? row : {};
  const extra = details && typeof details === 'object' ? details : {};
  const course = extra.course && typeof extra.course === 'object' ? extra.course : null;
  const lessons = Array.isArray(source.completedLessons) ? source.completedLessons.map((id) => String(id)) : [];
  const active = isActiveEnrollment(source);
  const courseView = course ? {
    id: String(course.id || course._id || ''),
    title: typeof course.title === 'string' ? course.title : '',
    thumbnail: course.thumbnail,
    difficulty: course.difficulty,
    category: course.category,
  } : null;
  return {
    _id: source._id == null ? '' : String(source._id),
    userId: source.userId == null ? '' : String(source.userId),
    courseId: source.courseId == null ? '' : String(source.courseId),
    progress: typeof source.progress === 'number' ? source.progress : 0,
    completedLessons: lessons,
    completedLessonsCount: lessons.length,
    totalLessons: typeof extra.totalLessons === 'number' ? extra.totalLessons : 0,
    active,
    withdrawnAt: source.withdrawnAt == null ? null : source.withdrawnAt,
    course: courseView,
    countsTowardActiveTotals: Boolean(active && courseView),
    quizScores: (Array.isArray(extra.quizScores) ? extra.quizScores : []).map(presentQuizScore),
  };
}

function countsTowardActiveTotals(row) {
  if (!row || row.course == null) return false;
  if (row.countsTowardActiveTotals === false) return false;
  return isActiveEnrollment(row);
}

function sumActiveCompletedLessons(rows) {
  return (Array.isArray(rows) ? rows : []).reduce((sum, row) => {
    if (!countsTowardActiveTotals(row)) return sum;
    const lessons = Array.isArray(row.completedLessons) ? row.completedLessons.length : 0;
    return sum + lessons;
  }, 0);
}

function courseCountsAsLevelProgress(row, lessonIds) {
  if (!isActiveEnrollment(row)) return false;
  const completed = new Set((Array.isArray(row && row.completedLessons) ? row.completedLessons : []).map((id) => String(id)));
  const ids = Array.isArray(lessonIds) ? lessonIds.map((id) => String(id)).filter(Boolean) : [];
  if (ids.length === 0) return false;
  return ids.every((id) => completed.has(id));
}

function decideStaffCertificate(input) {
  const role = input && input.role;
  if (role !== 'admin' && role !== 'superadmin') {
    return { ok: false, status: 403, error: 'Admin access required', issues: false, reactivatesEnrollment: false };
  }
  return { ok: true, status: 200, issues: true, reactivatesEnrollment: false };
}

function createEnrollmentRepository() {
  const rows = [];
  const keys = new Set();

  function keyFor(userId, courseId) {
    return `${String(userId)}:${String(courseId)}`;
  }

  return {
    rows,
    commit(decision, userId) {
      if (!decision || !decision.ok) {
        return { status: decision ? decision.status : 500, body: { error: decision ? decision.error : 'Internal server error' } };
      }
      if (decision.action === 'none') {
        return { status: 200, body: { success: true, enrolled: false } };
      }
      if (decision.action === 'reactivate') {
        const row = rows.find((item) => keyFor(item.userId, item.courseId) === keyFor(userId, decision.courseId));
        if (row) {
          row.active = true;
          delete row.withdrawnAt;
          row.updatedAt = new Date();
        }
        return { status: 200, body: { success: true, enrolled: true } };
      }
      if (decision.action === 'withdraw') {
        const row = rows.find((item) => keyFor(item.userId, item.courseId) === keyFor(userId, decision.courseId));
        if (row) {
          row.active = false;
          row.withdrawnAt = new Date();
          row.updatedAt = row.withdrawnAt;
        }
        return { status: 200, body: { success: true, enrolled: false } };
      }
      const key = keyFor(userId, decision.courseId);
      if (keys.has(key)) {
        const error = new Error('E11000 duplicate key');
        error.code = 11000;
        throw error;
      }
      keys.add(key);
      rows.push({
        ...decision.document,
        userId: String(userId),
        _id: `row-${rows.length + 1}`,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      return { status: 200, body: { success: true, enrolled: true } };
    },
  };
}

module.exports = {
  isStoredCourseId,
  isActiveEnrollment,
  activeEnrollmentFilter,
  enrollmentDecisionRecord,
  decideEnroll,
  decideUnenroll,
  enrollDuplicateStatus,
  quizHistoryQuery,
  presentEnrollmentProgress,
  countsTowardActiveTotals,
  sumActiveCompletedLessons,
  courseCountsAsLevelProgress,
  decideStaffCertificate,
  createEnrollmentRepository,
};
