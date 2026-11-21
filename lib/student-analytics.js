'use strict';

/**
 * Student dashboard and analytics (Phase 11). Read-only: nothing here writes a record.
 *
 * Every function takes the student's id from the session (the routes pass req.user.userId) and
 * scopes every query to it. There is no request parameter that names a student, a course or an
 * account, so one student can never read another's data through these endpoints.
 *
 * Sources (all existing records; no new collection):
 *   progress rows ............ enrollments, completed lesson ids, lessonCompletedAt (Phase 11),
 *                              completedAt, enrolledAt                       (index L1)
 *   lib/progress-summary.js .. course list, status, percent, Continue learning (Phase 8 rules)
 *   learningDays ............. active minutes per day                        (index L8)
 *   quizzes / quizAttempts ... upcoming quizzes and attempt state            (A4, A1)
 *   quizScores ............... finished quiz results                        (A6)
 *   assignments / assignmentSubmissions  upcoming assignments              (A2)
 *   certificates ............. issued certificates                          (certificates userId+courseId)
 *   lib/trading/analytics.js . practice trading (read-only)
 *
 * Calculation rules
 *   Enrolled course      an active enrollment (not withdrawn) in a course the student may still see
 *                        (Phase 8 canSeeCourse), one per course however many rows exist.
 *   Completed course     lib/course-progress.js completion (all current lessons, or a stored completedAt).
 *   In progress          not completed, and at least one completed lesson or a viewed lesson.
 *   Lessons completed    completed ids that are still lessons of the course (deleted lessons drop out).
 *   Overall progress     lessons completed / lessons in all enrolled courses (lesson-weighted),
 *                        rounded to 0.1; null when the enrolled courses have no lessons.
 *   Learning minutes     learningDays minutes (Phase 8 active-minute rule), by Africa/Lagos day.
 *   Lessons over time    first completion time per lesson (lessonCompletedAt). Completions recorded
 *                        before Phase 11 have no time: they count in totals, never in a time bucket,
 *                        and the response says how many are undated.
 *   Quiz attempt         a quizScores row (one per finished attempt, legacy rows included).
 *   Pass rate            passed attempts / attempts that had a pass mark.
 *   Quiz passed          at least one attempt with passed === true.
 *   Assessment done      passed, or (no pass mark) at least one finished attempt.
 */

const { ObjectId } = require('mongodb');
const { buildProgressSummary } = require('./progress-summary');
const { dayKey, shiftDay, LEARNING_TIMEZONE, computeStreak } = require('./learning-activity');
const { quizAvailability, quizSettings, FINISHED_STATUSES } = require('./quiz-assessment');
const { isActiveEnrollment } = require('./enrollment-state');
const { lessonPrerequisiteBlocksStudent } = require('./account-access');
const { tradingAnalytics } = require('./trading/analytics');
const { acceptsSubmissions } = require('./academic-operations');
const { formatMoney, moneyFrom } = require('./trading/money');

const STORED_ID = /^[a-fA-F0-9]{24}$/;
const RANGES = Object.freeze({ '7': 7, '30': 30, '90': 90, all: null });
const SCORE_SCAN_LIMIT = 500;
const UPCOMING_LIMIT = 10;
const ACTIVITY_PAGE_SIZE = 10;
const ACTIVITY_MAX_PAGE_SIZE = 20;
/** Activity pages reach back over this many most recent events (bounded reads per source). */
const ACTIVITY_WINDOW = 100;
const RECENT_SCORES = 5;
const TREND_POINTS = 20;

const time = (value) => (value ? new Date(value).getTime() || 0 : 0);
const iso = (value) => (value ? new Date(value).toISOString() : null);
const oid = (id) => new ObjectId(String(id));
const lessonHref = (courseId, lessonId) => (lessonId ? `/courses/${courseId}/lessons/${lessonId}` : `/courses/${courseId}`);
const round1 = (n) => Math.round(n * 10) / 10;

/** The student's active enrollment rows, with the Phase 11 completion times. */
async function enrollmentRows(db, userId) {
  const rows = await db.collection('progress')
    .find({ userId: String(userId) }, { projection: { courseId: 1, completedLessons: 1, lessonCompletedAt: 1, completedAt: 1, enrolledAt: 1, createdAt: 1, progress: 1, withdrawnAt: 1, active: 1 } })
    .toArray();
  return rows.filter(isActiveEnrollment);
}

/** Lesson completion events with a recorded time, for courses in `courses` (visible, enrolled). */
function completionEvents(rows, courses) {
  const byCourse = new Map(courses.map((c) => [c.courseId, c]));
  const events = [];
  for (const row of rows) {
    const course = byCourse.get(String(row.courseId));
    if (!course || !row.lessonCompletedAt || typeof row.lessonCompletedAt !== 'object') continue;
    const titles = new Map((course.lessons || []).map((l) => [l.lessonId, l.title]));
    for (const [lessonId, at] of Object.entries(row.lessonCompletedAt)) {
      if (!titles.has(lessonId) || !at) continue; // a deleted lesson no longer counts
      events.push({ courseId: course.courseId, courseTitle: course.title, lessonId, lessonTitle: titles.get(lessonId), at: new Date(at) });
    }
  }
  return events;
}

/** Overview numbers from the Phase 8 summary (see the rules above). */
function overviewFrom(summary) {
  const totalLessons = summary.courses.reduce((sum, c) => sum + c.totalLessons, 0);
  const notStarted = summary.courses.filter((c) => c.status === 'not_started').length;
  return {
    enrolled: summary.totals.enrolled,
    completedCourses: summary.totals.completedCourses,
    inProgressCourses: summary.totals.inProgressCourses,
    notStartedCourses: notStarted,
    completedLessons: summary.totals.completedLessons,
    totalLessons,
    overallPercent: totalLessons ? round1((summary.totals.completedLessons / totalLessons) * 100) : null,
  };
}

/** Courses for the dashboard: no lesson lists, just what a course card needs. */
function courseCards(summary) {
  return summary.courses
    .map((c) => ({
      courseId: c.courseId,
      title: c.title,
      thumbnail: c.thumbnail,
      difficulty: c.difficulty,
      category: c.category,
      archived: c.archived,
      status: c.status,
      percent: c.percent,
      completedLessons: c.completedLessons,
      totalLessons: c.totalLessons,
      completedAt: c.completedAt,
      lastStudiedAt: c.lastStudiedAt,
      lastLesson: c.lastLesson,
      href: c.status === 'completed' || !c.next
        ? `/courses/${c.courseId}`
        : lessonHref(c.courseId, c.next.lessonId),
      action: c.status === 'completed' ? 'review' : c.status === 'not_started' ? 'start' : 'continue',
    }))
    .sort((a, b) => time(b.lastStudiedAt) - time(a.lastStudiedAt) || a.title.localeCompare(b.title));
}

// ---------------------------------------------------------------------------
// Assessments
// ---------------------------------------------------------------------------

const scorePercent = (r) => (typeof r.percentage === 'number' ? r.percentage : typeof r.score === 'number' ? r.score : 0);

async function assessmentPerformance(db, userId, titles) {
  const scores = db.collection('quizScores');
  const [rows, attempts, firstPass] = await Promise.all([
    scores.find({ userId: String(userId) }, { projection: { lessonId: 1, courseId: 1, percentage: 1, score: 1, passed: 1, createdAt: 1, attemptNumber: 1 } })
      .sort({ createdAt: -1, _id: -1 }).limit(SCORE_SCAN_LIMIT).toArray(),
    scores.countDocuments({ userId: String(userId) }),
    scores.find({ userId: String(userId), passed: true }, { projection: { createdAt: 1 } }).sort({ createdAt: 1, _id: 1 }).limit(1).toArray(),
  ]);
  const withMark = rows.filter((r) => typeof r.passed === 'boolean');
  const passedAttempts = withMark.filter((r) => r.passed).length;
  const quizzes = new Set(rows.map((r) => String(r.lessonId)));
  const passedQuizzes = new Set(rows.filter((r) => r.passed === true).map((r) => String(r.lessonId)));
  const describe = (r) => ({
    id: String(r._id),
    lessonId: String(r.lessonId),
    courseId: String(r.courseId),
    lessonTitle: titles.lessons.get(String(r.lessonId)) || null,
    courseTitle: titles.courses.get(String(r.courseId)) || null,
    percent: round1(scorePercent(r)),
    passed: typeof r.passed === 'boolean' ? r.passed : null,
    attemptNumber: typeof r.attemptNumber === 'number' ? r.attemptNumber : null,
    finishedAt: iso(r.createdAt),
    href: titles.visibleCourses.has(String(r.courseId)) ? lessonHref(String(r.courseId), String(r.lessonId)) : null,
  });
  return {
    attempts,
    scanned: rows.length,
    quizzesAttempted: quizzes.size,
    quizzesPassed: passedQuizzes.size,
    passRate: withMark.length ? round1((passedAttempts / withMark.length) * 100) : null,
    averagePercent: rows.length ? round1(rows.reduce((s, r) => s + scorePercent(r), 0) / rows.length) : null,
    bestPercent: rows.length ? round1(Math.max(...rows.map(scorePercent))) : null,
    recent: rows.slice(0, RECENT_SCORES).map(describe),
    trend: rows.slice(0, TREND_POINTS).reverse().map((r) => ({ at: iso(r.createdAt), percent: round1(scorePercent(r)), passed: typeof r.passed === 'boolean' ? r.passed : null })),
    firstPassedAt: firstPass[0] ? iso(firstPass[0].createdAt) : null,
    passedLessonIds: passedQuizzes,
  };
}

/**
 * Quizzes and assignments the student may open now or soon and has not finished.
 * Quiz eligibility mirrors loadQuizContext: active enrollment (the summary only lists those), the
 * lesson open under the Phase 6 lock rule, not blocked by its level prerequisite, and the quiz
 * published with questions (quizAvailability). Answer keys are never read: only setting fields and
 * question ids are projected.
 */
async function upcomingAssessments(db, userId, { summary, rows, now }) {
  const rowByCourse = new Map(rows.map((r) => [String(r.courseId), r]));
  const courseById = new Map(summary.courses.map((c) => [c.courseId, c]));
  const openLessons = [];
  for (const c of summary.courses) for (const l of c.lessons || []) if (l.open) openLessons.push({ ...l, courseId: c.courseId });
  const lessonIds = openLessons.map((l) => l.lessonId);
  const courseIds = summary.courses.map((c) => c.courseId);
  const [quizzes, lessonRules, assignments] = await Promise.all([
    lessonIds.length
      ? db.collection('quizzes').find({ lessonId: { $in: lessonIds } }, { projection: { lessonId: 1, settings: 1, status: 1, published: 1, 'questions.id': 1 } }).toArray()
      : [],
    lessonIds.length
      ? db.collection('lessons').find({ _id: { $in: lessonIds.map(oid) } }, { projection: { requiredLevel: 1, courseId: 1 } }).toArray()
      : [],
    courseIds.length
      ? db.collection('assignments').find({ courseId: { $in: courseIds } }, { projection: { title: 1, courseId: 1, lessonId: 1, dueDate: 1, points: 1, status: 1 } }).toArray()
      : [],
  ]);
  const lessonById = new Map(openLessons.map((l) => [l.lessonId, l]));
  const ruleById = new Map(lessonRules.map((l) => [String(l._id), l]));
  const quizLessonIds = quizzes.map((q) => String(q.lessonId));
  // Phase 12: only published assignments are open work (drafts are hidden, closed take no submissions).
  const visibleAssignments = assignments.filter((a) => {
    const course = courseById.get(String(a.courseId));
    if (!course || !acceptsSubmissions(a)) return false;
    return a.lessonId ? lessonById.has(String(a.lessonId)) : course.allOpen === true;
  });
  const [attempts, submissions] = await Promise.all([
    quizLessonIds.length
      ? db.collection('quizAttempts').find({ userId: String(userId), lessonId: { $in: quizLessonIds } }, { projection: { lessonId: 1, status: 1, number: 1, 'result.passed': 1, 'result.percent': 1 } }).toArray()
      : [],
    visibleAssignments.length
      ? db.collection('assignmentSubmissions').find({ userId: String(userId), assignmentId: { $in: visibleAssignments.map((a) => String(a._id)) } }, { projection: { assignmentId: 1, status: 1, submittedAt: 1, grade: 1 } }).toArray()
      : [],
  ]);
  const attemptsByLesson = new Map();
  for (const a of attempts) {
    const key = String(a.lessonId);
    if (!attemptsByLesson.has(key)) attemptsByLesson.set(key, []);
    attemptsByLesson.get(key).push(a);
  }

  const items = [];
  const retakes = [];
  for (const quiz of quizzes) {
    const lessonId = String(quiz.lessonId);
    const lesson = lessonById.get(lessonId);
    const course = lesson && courseById.get(lesson.courseId);
    if (!lesson || !course) continue;
    const rule = ruleById.get(lessonId);
    if (lessonPrerequisiteBlocksStudent(rule ? { requiredLevel: rule.requiredLevel } : null, { difficulty: course.difficulty }, rowByCourse.get(course.courseId))) continue;
    const settings = quizSettings(quiz);
    const availability = quizAvailability(quiz, now);
    if (!availability.ok && availability.code !== 'quiz_not_open') continue; // draft, empty or closed
    const list = attemptsByLesson.get(lessonId) || [];
    const finished = list.filter((a) => FINISHED_STATUSES.includes(a.status));
    const inProgress = list.some((a) => a.status === 'in_progress');
    const passed = finished.some((a) => a.result && a.result.passed === true);
    const hasPassMark = typeof settings.passingPercent === 'number';
    const done = passed || (!hasPassMark && finished.length > 0);
    const used = list.length;
    const remaining = settings.maxAttempts ? Math.max(0, settings.maxAttempts - used) : null;
    if (done && !inProgress) continue;
    if (!inProgress && remaining === 0) continue; // no attempts left: shown in performance, not here
    const status = inProgress ? 'in_progress' : !availability.ok ? 'opens_soon' : finished.length ? 'retake_available' : 'not_started';
    const item = {
      kind: 'quiz',
      id: `quiz:${lessonId}`,
      title: `Quiz · ${lesson.title}`,
      courseId: course.courseId,
      courseTitle: course.title,
      lessonId,
      lessonTitle: lesson.title,
      status,
      opensAt: iso(settings.availableFrom),
      dueAt: iso(settings.availableUntil),
      attemptsUsed: used,
      attemptsRemaining: remaining,
      maxAttempts: settings.maxAttempts,
      timeLimitMinutes: settings.timeLimitMinutes,
      passingPercent: settings.passingPercent,
      bestPercent: finished.length ? round1(Math.max(...finished.map((a) => (a.result && typeof a.result.percent === 'number' ? a.result.percent : 0)))) : null,
      href: lessonHref(course.courseId, lessonId),
    };
    items.push(item);
    if (status === 'retake_available') retakes.push(item);
  }
  const submittedIds = new Set(submissions.map((s) => String(s.assignmentId)));
  for (const a of visibleAssignments) {
    if (submittedIds.has(String(a._id))) continue;
    const course = courseById.get(String(a.courseId));
    const lesson = a.lessonId ? lessonById.get(String(a.lessonId)) : null;
    const due = a.dueDate ? new Date(a.dueDate) : null;
    // A date-only due date means the end of that day (lib/assignment-grading.js isLate).
    if (due && typeof a.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(a.dueDate)) due.setUTCHours(23, 59, 59, 999);
    const validDue = due && !Number.isNaN(due.getTime()) ? due : null;
    items.push({
      kind: 'assignment',
      id: `assignment:${a._id}`,
      title: typeof a.title === 'string' && a.title ? a.title : 'Assignment',
      courseId: course.courseId,
      courseTitle: course.title,
      lessonId: lesson ? lesson.lessonId : null,
      lessonTitle: lesson ? lesson.title : null,
      status: validDue && validDue.getTime() < now.getTime() ? 'overdue' : 'not_submitted',
      opensAt: null,
      dueAt: validDue ? validDue.toISOString() : null,
      points: typeof a.points === 'number' ? a.points : null,
      href: lessonHref(course.courseId, lesson ? lesson.lessonId : null),
    });
  }
  const rank = { in_progress: 0, overdue: 1, retake_available: 2, not_started: 2, not_submitted: 2, opens_soon: 3 };
  items.sort((a, b) => {
    if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
    const ad = a.status === 'opens_soon' ? a.opensAt : a.dueAt;
    const bd = b.status === 'opens_soon' ? b.opensAt : b.dueAt;
    if (ad && bd) return time(ad) - time(bd);
    if (ad) return -1;
    if (bd) return 1;
    return a.courseTitle.localeCompare(b.courseTitle) || a.title.localeCompare(b.title);
  });
  return { items: items.slice(0, UPCOMING_LIMIT), total: items.length, retakes: retakes.length };
}

// ---------------------------------------------------------------------------
// Milestones and recommendations
// ---------------------------------------------------------------------------

/** Achieved only when the condition holds in the records; dates only when the records have one. */
function milestonesFrom({ overview, rows, completions, assessments, certificates, streak, trading }) {
  const earliest = (dates) => dates.filter(Boolean).map((d) => new Date(d)).sort((a, b) => a - b)[0] || null;
  const nth = (dates, n) => dates.filter(Boolean).map((d) => new Date(d)).sort((a, b) => a - b)[n - 1] || null;
  const lessonDates = completions.map((c) => c.at);
  const completedDates = rows.map((r) => r.completedAt).filter(Boolean);
  const items = [
    { id: 'first_course_started', title: 'First course started', description: 'Enrolled in your first course.', achieved: overview.enrolled >= 1, at: earliest(rows.map((r) => r.enrolledAt || r.createdAt)) },
    { id: 'first_lesson', title: 'First lesson completed', description: 'Completed your first lesson.', achieved: overview.completedLessons >= 1, at: earliest(lessonDates) },
    { id: 'lessons_10', title: '10 lessons completed', description: 'Ten lessons finished across your courses.', achieved: overview.completedLessons >= 10, at: overview.completedLessons >= 10 && lessonDates.length === overview.completedLessons ? nth(lessonDates, 10) : null, progress: { current: Math.min(overview.completedLessons, 10), target: 10 } },
    { id: 'first_course_completed', title: 'First course completed', description: 'Finished every lesson of a course.', achieved: overview.completedCourses >= 1, at: earliest(completedDates) },
    { id: 'courses_3', title: 'Three courses completed', description: 'Three courses finished.', achieved: overview.completedCourses >= 3, at: overview.completedCourses >= 3 ? nth(completedDates, 3) : null, progress: { current: Math.min(overview.completedCourses, 3), target: 3 } },
    { id: 'first_quiz_passed', title: 'First quiz passed', description: 'Passed a quiz with a pass mark.', achieved: Boolean(assessments.firstPassedAt), at: assessments.firstPassedAt },
    { id: 'quizzes_5', title: 'Five quizzes passed', description: 'Passed five different quizzes.', achieved: assessments.quizzesPassed >= 5, at: null, progress: { current: Math.min(assessments.quizzesPassed, 5), target: 5 } },
    { id: 'first_certificate', title: 'First certificate', description: 'Earned a course certificate.', achieved: certificates.length >= 1, at: earliest(certificates.map((c) => c.issuedAt)) },
    { id: 'streak_7', title: '7-day learning streak', description: 'Learned on seven days in a row.', achieved: streak.longest >= 7, at: null, progress: { current: Math.min(streak.longest, 7), target: 7 } },
    { id: 'first_practice_trade', title: 'First practice trade', description: 'Closed your first simulated trade.', achieved: trading.performance.closedTrades >= 1, at: iso(trading.firstClosedAt) },
    { id: 'practice_10', title: '10 practice trades', description: 'Closed ten simulated trades.', achieved: trading.performance.closedTrades >= 10, at: null, progress: { current: Math.min(trading.performance.closedTrades, 10), target: 10 } },
    { id: 'first_review', title: 'First trade review', description: 'Reviewed a closed practice trade.', achieved: trading.reviews.reviewed >= 1, at: null },
  ];
  return items.map((m) => ({ ...m, at: m.achieved && m.at ? iso(m.at) : null }));
}

/**
 * Deterministic, transparent rules, in priority order; at most four; never something already done
 * or something the student cannot open (every source above is already filtered for access).
 */
function recommendationsFrom({ summary, overview, upcoming, assessments, trading }) {
  const out = [];
  const cont = summary.continue;
  if (cont && cont.lessonId) {
    out.push({ id: 'resume', kind: 'learn', title: `Continue ${cont.courseTitle}`, reason: `Your next lesson is "${cont.lessonTitle}". You are ${Math.round(cont.percent)}% through the course.`, href: lessonHref(cont.courseId, cont.lessonId), action: 'Resume lesson' });
  } else if (cont) {
    out.push({ id: 'unlock', kind: 'learn', title: `Unlock the rest of ${cont.courseTitle}`, reason: 'The remaining lessons of this course are locked.', href: `/courses/${cont.courseId}`, action: 'Open course' });
  }
  const urgent = upcoming.items.find((i) => i.status === 'in_progress' || i.status === 'overdue');
  const next = urgent || upcoming.items.find((i) => i.status === 'not_started' || i.status === 'not_submitted');
  if (next) {
    const reason = next.status === 'in_progress' ? 'You have an attempt in progress.' : next.status === 'overdue' ? 'This assignment is past its due date and not submitted.' : next.dueAt ? `Due ${next.dueAt.slice(0, 10)}.` : `Part of ${next.courseTitle}.`;
    out.push({ id: `assessment:${next.id}`, kind: 'assess', title: next.title, reason, href: next.href, action: next.kind === 'quiz' ? 'Open quiz' : 'Open assignment' });
  }
  const retake = upcoming.items.find((i) => i.status === 'retake_available');
  if (retake && out.length < 4) {
    out.push({ id: `retake:${retake.id}`, kind: 'assess', title: `Retake ${retake.title}`, reason: `Best score so far ${retake.bestPercent ?? 0}%; pass mark ${retake.passingPercent}%.${retake.attemptsRemaining !== null ? ` ${retake.attemptsRemaining} attempt(s) left.` : ''}`, href: retake.href, action: 'Review and retake' });
  }
  if (trading.reviews.pending > 0 && out.length < 4) {
    out.push({ id: 'review_trades', kind: 'practice', title: `Review ${trading.reviews.pending} closed practice trade${trading.reviews.pending === 1 ? '' : 's'}`, reason: 'Write down why you entered and what you would change while it is fresh.', href: '/student-dashboard', action: 'Open trade journal' });
  }
  if (overview.completedLessons > 0 && trading.performance.closedTrades === 0 && out.length < 4) {
    out.push({ id: 'practise', kind: 'practice', title: 'Practise what you learned', reason: trading.hasAccount ? 'You have a practice account but no closed trade yet.' : 'Open a practice account with USD 10,000 of virtual funds.', href: '/student-dashboard', action: 'Open practice desk' });
  }
  if (overview.enrolled === 0) {
    out.push({ id: 'browse', kind: 'learn', title: 'Choose your first course', reason: 'Everything starts from a course: lessons, quizzes and practice.', href: '/courses', action: 'Browse courses' });
  } else if (overview.enrolled > 0 && overview.completedCourses === overview.enrolled && out.length < 4) {
    out.push({ id: 'next_course', kind: 'learn', title: 'Start another course', reason: 'You have completed every course you are enrolled in.', href: '/courses', action: 'Browse courses' });
  }
  if (assessments.recent[0] && assessments.recent[0].passed === false && assessments.recent[0].href && out.length < 4 && !retake) {
    const r = assessments.recent[0];
    out.push({ id: `revisit:${r.id}`, kind: 'assess', title: `Revisit ${r.lessonTitle || 'your last quiz'}`, reason: `Your last result was ${r.percent}%, below the pass mark.`, href: r.href, action: 'Revisit lesson' });
  }
  return out.slice(0, 4);
}

// ---------------------------------------------------------------------------
// Learning series
// ---------------------------------------------------------------------------

function parseRange(value) {
  return Object.prototype.hasOwnProperty.call(RANGES, value) ? value : '30';
}

const monthOf = (day) => day.slice(0, 7);

/**
 * Minutes and lessons completed per day (7/30/90) or per month (all), in the learning timezone.
 * Every bucket in the range is present (zeros included), so gaps are real gaps.
 */
async function learningSeries(db, userId, { range = '30', now = new Date(), completions = null, undated = 0 } = {}) {
  const key = parseRange(range);
  const days = RANGES[key];
  const today = dayKey(now);
  const start = days ? shiftDay(today, -(days - 1)) : null;
  const filter = { userId: String(userId), ...(start ? { day: { $gte: start } } : {}) };
  const dayRows = await db.collection('learningDays').find(filter, { projection: { day: 1, minutes: 1 } }).sort({ day: 1 }).limit(3660).toArray();
  const minutes = new Map(dayRows.map((r) => [r.day, typeof r.minutes === 'number' ? r.minutes : 0]));
  const lessons = new Map();
  for (const c of completions || []) {
    const d = dayKey(c.at);
    if (!start || d >= start) lessons.set(d, (lessons.get(d) || 0) + 1);
  }
  let buckets;
  if (days) {
    buckets = [];
    for (let i = days - 1; i >= 0; i -= 1) {
      const day = shiftDay(today, -i);
      buckets.push({ key: day, minutes: minutes.get(day) || 0, lessons: lessons.get(day) || 0 });
    }
  } else {
    const firstDay = [...minutes.keys(), ...lessons.keys()].sort()[0] || today;
    const months = [];
    for (let m = monthOf(firstDay); m <= monthOf(today);) {
      months.push(m);
      const [y, mo] = m.split('-').map(Number);
      m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
    }
    const sum = (map) => { const out = new Map(); for (const [d, v] of map) out.set(monthOf(d), (out.get(monthOf(d)) || 0) + v); return out; };
    const mm = sum(minutes);
    const ml = sum(lessons);
    buckets = months.map((m) => ({ key: m, minutes: mm.get(m) || 0, lessons: ml.get(m) || 0 }));
  }
  return {
    range: key,
    granularity: days ? 'day' : 'month',
    timezone: LEARNING_TIMEZONE,
    buckets,
    totals: {
      minutes: buckets.reduce((s, b) => s + b.minutes, 0),
      lessons: buckets.reduce((s, b) => s + b.lessons, 0),
      activeDays: [...minutes.entries()].filter(([, v]) => v > 0).length,
    },
    undatedCompletions: undated,
  };
}

// ---------------------------------------------------------------------------
// Activity timeline
// ---------------------------------------------------------------------------

/** Most recent events across sources; bounded per source; newest first. */
async function activityEvents(db, userId, { summary, rows, completions, window = ACTIVITY_WINDOW }) {
  const visible = new Map(summary.courses.map((c) => [c.courseId, c]));
  const uid = String(userId);
  const [scores, submissions, certificates, trades] = await Promise.all([
    db.collection('quizScores').find({ userId: uid }, { projection: { lessonId: 1, courseId: 1, percentage: 1, score: 1, passed: 1, createdAt: 1 } }).sort({ createdAt: -1, _id: -1 }).limit(window).toArray(),
    db.collection('assignmentSubmissions').find({ userId: uid }, { projection: { assignmentId: 1, submittedAt: 1, createdAt: 1 } }).sort({ submittedAt: -1 }).limit(window).toArray(),
    db.collection('certificates').find({ userId: uid }, { projection: { courseId: 1, issuedAt: 1 } }).sort({ issuedAt: -1 }).limit(window).toArray(),
    db.collection('tradingPositions').find({ userId: uid, status: 'closed' }, { projection: { instrument: 1, side: 1, realizedPl: 1, closedAt: 1 } }).sort({ closedAt: -1 }).limit(window).toArray(),
  ]);
  const assignmentIds = [...new Set(submissions.map((s) => String(s.assignmentId)))].filter((id) => STORED_ID.test(id));
  const scoreLessonIds = [...new Set(scores.map((s) => String(s.lessonId)))].filter((id) => STORED_ID.test(id));
  const [assignments, scoreLessons] = await Promise.all([
    assignmentIds.length ? db.collection('assignments').find({ _id: { $in: assignmentIds.map(oid) } }, { projection: { title: 1, courseId: 1, lessonId: 1 } }).toArray() : [],
    scoreLessonIds.length ? db.collection('lessons').find({ _id: { $in: scoreLessonIds.map(oid) } }, { projection: { title: 1 } }).toArray() : [],
  ]);
  const assignmentById = new Map(assignments.map((a) => [String(a._id), a]));
  const lessonTitle = new Map(scoreLessons.map((l) => [String(l._id), l.title || 'Lesson']));
  const courseTitle = (id) => (visible.get(String(id)) ? visible.get(String(id)).title : null);
  const events = [];
  for (const r of rows) {
    const c = visible.get(String(r.courseId));
    if (!c) continue;
    const started = r.enrolledAt || r.createdAt;
    if (started) events.push({ id: `start:${c.courseId}`, type: 'course_started', at: started, title: `Started ${c.title}`, detail: null, href: `/courses/${c.courseId}` });
    if (r.completedAt) events.push({ id: `done:${c.courseId}`, type: 'course_completed', at: r.completedAt, title: `Completed ${c.title}`, detail: null, href: `/courses/${c.courseId}` });
  }
  for (const e of completions) events.push({ id: `lesson:${e.lessonId}`, type: 'lesson_completed', at: e.at, title: `Completed "${e.lessonTitle}"`, detail: e.courseTitle, href: lessonHref(e.courseId, e.lessonId) });
  for (const s of scores) {
    const pct = round1(scorePercent(s));
    events.push({
      id: `quiz:${s._id}`,
      type: 'quiz_finished',
      at: s.createdAt,
      title: `Quiz: ${lessonTitle.get(String(s.lessonId)) || 'lesson quiz'}`,
      detail: `${pct}%${s.passed === true ? ' · passed' : s.passed === false ? ' · not passed' : ''}`,
      href: visible.has(String(s.courseId)) ? lessonHref(String(s.courseId), String(s.lessonId)) : null,
    });
  }
  for (const s of submissions) {
    const a = assignmentById.get(String(s.assignmentId));
    events.push({
      id: `submission:${s._id}`,
      type: 'assignment_submitted',
      at: s.submittedAt || s.createdAt,
      title: `Submitted ${a && a.title ? a.title : 'an assignment'}`,
      detail: a ? courseTitle(a.courseId) : null,
      href: a && visible.has(String(a.courseId)) ? lessonHref(String(a.courseId), a.lessonId ? String(a.lessonId) : null) : null,
    });
  }
  for (const c of certificates) events.push({ id: `certificate:${c._id}`, type: 'certificate_earned', at: c.issuedAt, title: `Certificate earned${courseTitle(c.courseId) ? `: ${courseTitle(c.courseId)}` : ''}`, detail: null, href: '/certificates' });
  for (const t of trades) {
    events.push({
      id: `trade:${t._id}`,
      type: 'trade_closed',
      at: t.closedAt,
      title: `Practice trade closed: ${t.side === 'buy' ? 'Buy' : 'Sell'} ${String(t.instrument).replace('_', '/')}`,
      detail: `${formatMoney(moneyFrom(t.realizedPl))} USD · simulated`,
      href: '/student-dashboard',
    });
  }
  return events
    .filter((e) => e.at && time(e.at) > 0)
    .sort((a, b) => time(b.at) - time(a.at) || a.id.localeCompare(b.id))
    .slice(0, window)
    .map((e) => ({ ...e, at: iso(e.at) }));
}

function pageOf(page, limit) {
  const size = Math.min(ACTIVITY_MAX_PAGE_SIZE, Math.max(1, Number.isInteger(limit) ? limit : ACTIVITY_PAGE_SIZE));
  const maxPage = Math.max(1, Math.floor(ACTIVITY_WINDOW / size));
  const number = Math.min(maxPage, Math.max(1, Number.isInteger(page) ? page : 1));
  return { page: number, limit: size, maxPage };
}

// ---------------------------------------------------------------------------
// Entry points (one per endpoint)
// ---------------------------------------------------------------------------

/** Shared base: summary with lessons, enrollment rows, dated completions, title maps. */
async function base(db, userId, now) {
  const [summary, rows] = await Promise.all([
    buildProgressSummary(db, { userId: String(userId), role: 'student', now, withLessons: true }),
    enrollmentRows(db, userId),
  ]);
  const completions = completionEvents(rows, summary.courses);
  const lessons = new Map();
  for (const c of summary.courses) for (const l of c.lessons || []) lessons.set(l.lessonId, l.title);
  const titles = { lessons, courses: new Map(summary.courses.map((c) => [c.courseId, c.title])), visibleCourses: new Set(summary.courses.map((c) => c.courseId)) };
  const datedCurrent = completions.length;
  const undated = Math.max(0, summary.totals.completedLessons - datedCurrent);
  return { summary, rows, completions, titles, undated };
}

async function studentDashboard(db, { userId, name = null, now = new Date(), env = process.env, range = '30' }) {
  const b = await base(db, userId, now);
  const overview = overviewFrom(b.summary);
  const [assessments, upcoming, certificates, trading, series, events] = await Promise.all([
    assessmentPerformance(db, userId, b.titles),
    upcomingAssessments(db, userId, { summary: b.summary, rows: b.rows, now }),
    db.collection('certificates').find({ userId: String(userId) }, { projection: { courseId: 1, issuedAt: 1 } }).sort({ issuedAt: -1 }).limit(50).toArray(),
    tradingAnalytics(db, String(userId), { now, env }),
    learningSeries(db, userId, { range, now, completions: b.completions, undated: b.undated }),
    activityEvents(db, userId, { summary: b.summary, rows: b.rows, completions: b.completions, window: ACTIVITY_PAGE_SIZE }),
  ]);
  const streak = b.summary.learning && b.summary.learning.streak ? b.summary.learning.streak : computeStreak([], dayKey(now));
  const { passedLessonIds, ...assessmentView } = assessments;
  void passedLessonIds;
  const milestones = milestonesFrom({ overview, rows: b.rows, completions: b.completions, assessments, certificates, streak, trading });
  return {
    generatedAt: now.toISOString(),
    student: { firstName: typeof name === 'string' && name.trim() ? name.trim().split(/\s+/)[0] : null },
    overview,
    continue: b.summary.continue
      ? { ...b.summary.continue, href: lessonHref(b.summary.continue.courseId, b.summary.continue.lessonId), lastStudiedAt: (b.summary.courses.find((c) => c.courseId === b.summary.continue.courseId) || {}).lastStudiedAt || null }
      : null,
    courses: courseCards(b.summary),
    learning: { ...b.summary.learning, series },
    assessments: assessmentView,
    upcoming,
    milestones,
    certificates: certificates.length,
    recommendations: recommendationsFrom({ summary: b.summary, overview, upcoming, assessments, trading }),
    activity: { events, hasMore: events.length >= ACTIVITY_PAGE_SIZE },
    trading: {
      simulated: true,
      marketLabel: trading.marketLabel,
      hasAccount: trading.hasAccount,
      overview: trading.overview,
      performance: trading.performance,
      reviews: trading.reviews,
      recent: trading.recent,
    },
  };
}

async function studentLearningSeries(db, { userId, range, now = new Date() }) {
  const b = await base(db, userId, now);
  return learningSeries(db, userId, { range, now, completions: b.completions, undated: b.undated });
}

async function studentActivity(db, { userId, page, limit, now = new Date() }) {
  const paging = pageOf(page, limit);
  const b = await base(db, userId, now);
  const window = Math.min(ACTIVITY_WINDOW, paging.page * paging.limit + 1);
  const events = await activityEvents(db, userId, { summary: b.summary, rows: b.rows, completions: b.completions, window });
  const start = (paging.page - 1) * paging.limit;
  return {
    events: events.slice(start, start + paging.limit),
    page: paging.page,
    limit: paging.limit,
    hasMore: events.length > start + paging.limit && paging.page < paging.maxPage,
    window: ACTIVITY_WINDOW,
  };
}

async function studentTrading(db, { userId, now = new Date(), env = process.env }) {
  const t = await tradingAnalytics(db, String(userId), { now, env });
  const { firstClosedAt, ...view } = t;
  return { ...view, firstClosedAt: iso(firstClosedAt) };
}

module.exports = {
  ACTIVITY_WINDOW,
  RANGES,
  activityEvents,
  assessmentPerformance,
  completionEvents,
  learningSeries,
  milestonesFrom,
  overviewFrom,
  pageOf,
  parseRange,
  recommendationsFrom,
  studentActivity,
  studentDashboard,
  studentLearningSeries,
  studentTrading,
  upcomingAssessments,
};
