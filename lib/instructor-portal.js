'use strict';

/**
 * Instructor portal (Phase 12): the teaching scope and the read models of the portal.
 * Read-only: nothing here writes a record (grading, assignments and reassignment have their own,
 * audited write paths).
 *
 * Scope. An instructor's scope is the courses whose `instructorId` is theirs (string or ObjectId
 * form, as stored), the same rule as ownsCourse / isAssignedInstructor. Admins and the Super Admin
 * see every course, as ownsCourse already allows them. The member always comes from the session
 * (withAuth reads the live account: an inactive account never gets here). A course, student or
 * submission outside the scope is reported as not found, so ids cannot be probed.
 *
 * Privacy. Students are shown by name and learning level only (no email, phone or address), plus
 * the learning and assessment records of the scoped courses. Quiz answers and answer keys are
 * never read.
 *
 * Metric definitions (overview):
 *   Assigned courses      courses in scope, by status (draft, in_review, published, archived).
 *   Enrollments           active enrollment rows (not withdrawn) in scoped courses.
 *   Students              distinct students with at least one such enrollment.
 *   Completion rate       enrollments with completedAt (or stored progress 100) / enrollments.
 *   Average progress      mean stored course progress of those enrollments (lib/course-progress.js).
 *   Active learners (7d)  students with any learning activity on a scoped course in the last 7 days.
 *   Pending submissions   assignment submissions in scoped courses whose status is not 'graded'
 *                         (new work and resubmissions waiting for a grade); late = submitted after
 *                         the due date (stored at submission, lib/assignment-grading.js isLate).
 *   Graded submissions    submissions with status 'graded'.
 *   Quiz attempts         finished attempts (submitted or expired) on lessons of scoped courses;
 *                         pass rate over attempts that had a pass mark; average percent.
 */

const { ObjectId } = require('mongodb');
const { isActiveEnrollment } = require('./enrollment-state');
const { COURSE_STATUSES } = require('./course-lifecycle');
const { sortLessonsByOrder } = require('./course-lesson-list');
const { FINISHED_STATUSES } = require('./quiz-assessment');

const STORED_ID = /^[a-fA-F0-9]{24}$/;
const STAFF = new Set(['instructor', 'admin', 'superadmin']);
const COURSE_LIMIT = 500;
const PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const ACTIVE_WINDOW_MS = 7 * 24 * 3600 * 1000;
const PREVIEW_LENGTH = 200;

const isId = (v) => typeof v === 'string' && STORED_ID.test(v);
const oid = (v) => new ObjectId(String(v));
const iso = (v) => (v ? new Date(v).toISOString() : null);
const time = (v) => (v ? new Date(v).getTime() || 0 : 0);
const round1 = (n) => Math.round(n * 10) / 10;
const text = (v, fallback = '') => (typeof v === 'string' && v ? v : fallback);

function paging(page, limit) {
  const size = Math.min(MAX_PAGE_SIZE, Math.max(1, Number.isInteger(limit) ? limit : PAGE_SIZE));
  const number = Math.max(1, Number.isInteger(page) ? page : 1);
  return { page: number, limit: size, skip: (number - 1) * size };
}

/** Both stored forms of a course id (string and ObjectId), for courseId fields. */
const courseIdForms = (ids) => ids.flatMap((id) => [id, oid(id)]);

/**
 * The member's courses. Returns { ok, courses, ids, byId } or a refusal for non-staff.
 * `courseId` narrows to one course and refuses (404) one outside the scope.
 */
async function teachingScope(db, member, { courseId } = {}) {
  if (!member || !STAFF.has(member.role) || !isId(String(member.userId || ''))) return { ok: false, status: 403, error: 'Not authorized' };
  if (courseId !== undefined && courseId !== null && courseId !== '' && !isId(courseId)) return { ok: false, status: 404, error: 'Course not found' };
  const filter = member.role === 'instructor' ? { instructorId: { $in: [member.userId, oid(member.userId)] } } : {};
  if (courseId) filter._id = oid(courseId);
  const courses = await db.collection('courses')
    .find(filter, { projection: { title: 1, status: 1, difficulty: 1, category: 1, thumbnail: 1, instructorId: 1, updatedAt: 1, createdAt: 1 } })
    .sort({ updatedAt: -1, _id: -1 })
    .limit(COURSE_LIMIT)
    .toArray();
  if (courseId && !courses.length) return { ok: false, status: 404, error: 'Course not found' };
  const ids = courses.map((c) => String(c._id));
  return { ok: true, courses, ids, byId: new Map(courses.map((c) => [String(c._id), c])) };
}

const courseStatus = (c) => (c.status === undefined ? 'published' : COURSE_STATUSES.includes(c.status) ? c.status : 'draft');

async function lessonsOf(db, courseIds) {
  if (!courseIds.length) return [];
  return db.collection('lessons').find({ courseId: { $in: courseIds } }, { projection: { courseId: 1, title: 1, order: 1 } }).toArray();
}

async function assignmentsOf(db, courseIds, { assignmentId } = {}) {
  if (!courseIds.length) return [];
  const filter = { courseId: { $in: courseIds } };
  if (assignmentId) filter._id = oid(assignmentId);
  return db.collection('assignments').find(filter, { projection: { title: 1, courseId: 1, lessonId: 1, dueDate: 1, points: 1, status: 1 } }).toArray();
}

async function activeRows(db, courseIds, projection = {}) {
  if (!courseIds.length) return [];
  const rows = await db.collection('progress')
    .find({ courseId: { $in: courseIdForms(courseIds) } }, { projection: { userId: 1, courseId: 1, progress: 1, completedAt: 1, completedLessons: 1, enrolledAt: 1, createdAt: 1, lastActivityAt: 1, lastViewedAt: 1, withdrawnAt: 1, active: 1, ...projection } })
    .toArray();
  return rows.filter(isActiveEnrollment).map((r) => ({ ...r, courseId: String(r.courseId), userId: String(r.userId) }));
}

const completed = (r) => Boolean(r.completedAt) || (typeof r.progress === 'number' && r.progress >= 100);
const lastActive = (r) => Math.max(time(r.lastActivityAt), time(r.lastViewedAt));

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

async function instructorOverview(db, member, { now = new Date() } = {}) {
  const scope = await teachingScope(db, member);
  if (!scope.ok) return scope;
  const { ids, courses } = scope;
  const [rows, lessons, assignments] = await Promise.all([activeRows(db, ids), lessonsOf(db, ids), assignmentsOf(db, ids)]);
  const assignmentIds = assignments.map((a) => String(a._id));
  const lessonIds = lessons.map((l) => String(l._id));
  const [submissions, attempts] = await Promise.all([
    assignmentIds.length
      ? db.collection('assignmentSubmissions').find({ assignmentId: { $in: assignmentIds } }, { projection: { assignmentId: 1, userId: 1, status: 1, late: 1, submittedAt: 1, gradedAt: 1, grade: 1 } }).toArray()
      : [],
    lessonIds.length
      ? db.collection('quizAttempts').find({ lessonId: { $in: lessonIds }, status: { $in: [...FINISHED_STATUSES] } }, { projection: { lessonId: 1, userId: 1, 'result.percent': 1, 'result.passed': 1, submittedAt: 1 } }).toArray()
      : [],
  ]);

  const byStatus = Object.fromEntries(COURSE_STATUSES.map((s) => [s, 0]));
  for (const c of courses) byStatus[courseStatus(c)] += 1;
  const students = new Set(rows.map((r) => r.userId));
  const done = rows.filter(completed).length;
  const active = new Set(rows.filter((r) => now.getTime() - lastActive(r) <= ACTIVE_WINDOW_MS).map((r) => r.userId));
  const pending = submissions.filter((s) => s.status !== 'graded');
  const withMark = attempts.filter((a) => a.result && typeof a.result.passed === 'boolean');

  // Per course: enrollments, completion, pending grading.
  const assignmentCourse = new Map(assignments.map((a) => [String(a._id), String(a.courseId)]));
  const perCourse = new Map(ids.map((id) => [id, { enrollments: 0, completed: 0, progressSum: 0, pending: 0, lessons: 0 }]));
  for (const r of rows) {
    const p = perCourse.get(r.courseId);
    if (!p) continue;
    p.enrollments += 1;
    if (completed(r)) p.completed += 1;
    p.progressSum += typeof r.progress === 'number' ? Math.min(100, Math.max(0, r.progress)) : 0;
  }
  for (const s of pending) {
    const p = perCourse.get(assignmentCourse.get(String(s.assignmentId)));
    if (p) p.pending += 1;
  }
  for (const l of lessons) {
    const p = perCourse.get(String(l.courseId));
    if (p) p.lessons += 1;
  }

  return {
    ok: true,
    scope: member.role === 'instructor' ? 'assigned' : 'all',
    metrics: {
      courses: courses.length,
      coursesByStatus: byStatus,
      students: students.size,
      enrollments: rows.length,
      completionRate: rows.length ? round1((done / rows.length) * 100) : null,
      averageProgress: rows.length ? round1(rows.reduce((s, r) => s + (typeof r.progress === 'number' ? Math.min(100, Math.max(0, r.progress)) : 0), 0) / rows.length) : null,
      activeLearners7d: active.size,
      pendingSubmissions: pending.length,
      latePending: pending.filter((s) => s.late === true).length,
      gradedSubmissions: submissions.length - pending.length,
      oldestPendingAt: pending.length ? iso(pending.reduce((min, s) => (time(s.submittedAt) && (!min || time(s.submittedAt) < min) ? time(s.submittedAt) : min), 0)) : null,
      quizAttempts: attempts.length,
      quizPassRate: withMark.length ? round1((withMark.filter((a) => a.result.passed).length / withMark.length) * 100) : null,
      quizAveragePercent: attempts.length ? round1(attempts.reduce((s, a) => s + (a.result && typeof a.result.percent === 'number' ? a.result.percent : 0), 0) / attempts.length) : null,
    },
    courses: courses.map((c) => {
      const p = perCourse.get(String(c._id));
      return {
        courseId: String(c._id),
        title: text(c.title, 'Course'),
        status: courseStatus(c),
        difficulty: c.difficulty || null,
        lessons: p.lessons,
        enrollments: p.enrollments,
        completionRate: p.enrollments ? round1((p.completed / p.enrollments) * 100) : null,
        averageProgress: p.enrollments ? round1(p.progressSum / p.enrollments) : null,
        pendingSubmissions: p.pending,
        updatedAt: iso(c.updatedAt),
      };
    }),
    recent: await recentTeachingEvents(db, { scope, rows, submissions, assignments, limit: 8 }),
  };
}

/** Newest submissions and enrollments in scope (names joined in one query). */
async function recentTeachingEvents(db, { scope, rows, submissions, assignments, limit }) {
  const assignmentById = new Map(assignments.map((a) => [String(a._id), a]));
  const events = [];
  for (const s of submissions) {
    const a = assignmentById.get(String(s.assignmentId));
    if (!a || !s.submittedAt) continue;
    events.push({ type: s.status === 'graded' ? 'submission_graded' : 'submission', at: s.status === 'graded' && s.gradedAt ? s.gradedAt : s.submittedAt, userId: String(s.userId), courseId: String(a.courseId), title: text(a.title, 'Assignment'), submissionId: String(s._id), late: s.late === true });
  }
  for (const r of rows) {
    const at = r.enrolledAt || r.createdAt;
    if (at) events.push({ type: 'enrollment', at, userId: r.userId, courseId: r.courseId, title: null });
  }
  events.sort((a, b) => time(b.at) - time(a.at));
  const top = events.slice(0, limit);
  const names = await studentNames(db, top.map((e) => e.userId));
  return top.map((e) => ({
    type: e.type,
    at: iso(e.at),
    student: names.get(e.userId) || 'Student',
    studentId: e.userId,
    courseId: e.courseId,
    courseTitle: text((scope.byId.get(e.courseId) || {}).title, 'Course'),
    assignmentTitle: e.title,
    submissionId: e.submissionId || null,
    late: Boolean(e.late),
  }));
}

async function studentNames(db, userIds) {
  const ids = [...new Set(userIds.filter(isId))];
  if (!ids.length) return new Map();
  const users = await db.collection('users').find({ _id: { $in: ids.map(oid) } }, { projection: { name: 1 } }).toArray();
  return new Map(users.map((u) => [String(u._id), text(u.name, 'Student')]));
}

// ---------------------------------------------------------------------------
// Students
// ---------------------------------------------------------------------------

/**
 * Students enrolled in the member's courses (one row per student and course), paginated.
 * Filters: courseId (in scope), q (name contains), status (in_progress | completed | not_started).
 */
async function instructorStudents(db, member, { courseId, q, status, page, limit, now = new Date() } = {}) {
  const scope = await teachingScope(db, member, { courseId });
  if (!scope.ok) return scope;
  const rows = await activeRows(db, scope.ids);
  const users = rows.length
    ? await db.collection('users').find({ _id: { $in: [...new Set(rows.map((r) => r.userId))].filter(isId).map(oid) } }, { projection: { name: 1, learningLevel: 1, 'studentDetails.tradingLevel': 1, role: 1 } }).toArray()
    : [];
  const userById = new Map(users.map((u) => [String(u._id), u]));
  const lessons = await lessonsOf(db, scope.ids);
  const lessonsByCourse = new Map();
  for (const l of lessons) {
    const k = String(l.courseId);
    if (!lessonsByCourse.has(k)) lessonsByCourse.set(k, new Set());
    lessonsByCourse.get(k).add(String(l._id));
  }
  const needle = typeof q === 'string' ? q.trim().toLowerCase().slice(0, 80) : '';
  const statusOf = (r) => {
    const current = lessonsByCourse.get(r.courseId) || new Set();
    const doneCount = (Array.isArray(r.completedLessons) ? r.completedLessons : []).filter((id) => current.has(String(id))).length;
    return completed(r) ? 'completed' : doneCount > 0 || r.lastViewedAt ? 'in_progress' : 'not_started';
  };
  let list = rows
    .filter((r) => userById.has(r.userId) && userById.get(r.userId).role === 'student')
    .map((r) => ({ r, user: userById.get(r.userId), status: statusOf(r) }));
  if (needle) list = list.filter((x) => text(x.user.name).toLowerCase().includes(needle));
  if (['in_progress', 'completed', 'not_started'].includes(status)) list = list.filter((x) => x.status === status);
  list.sort((a, b) => lastActive(b.r) - lastActive(a.r) || text(a.user.name).localeCompare(text(b.user.name)));
  const pg = paging(page, limit);
  const slice = list.slice(pg.skip, pg.skip + pg.limit);

  // Page-level joins: quiz attempts and submissions of these students in these courses.
  const pageUsers = [...new Set(slice.map((x) => x.r.userId))];
  const pageCourses = [...new Set(slice.map((x) => x.r.courseId))];
  const pageLessonIds = lessons.filter((l) => pageCourses.includes(String(l.courseId))).map((l) => String(l._id));
  const lessonCourse = new Map(lessons.map((l) => [String(l._id), String(l.courseId)]));
  const pageAssignments = await assignmentsOf(db, pageCourses);
  const assignmentCourse = new Map(pageAssignments.map((a) => [String(a._id), String(a.courseId)]));
  const [attempts, subs] = await Promise.all([
    pageUsers.length && pageLessonIds.length
      ? db.collection('quizAttempts').find({ userId: { $in: pageUsers }, lessonId: { $in: pageLessonIds }, status: { $in: [...FINISHED_STATUSES] } }, { projection: { userId: 1, lessonId: 1, 'result.percent': 1, 'result.passed': 1 } }).toArray()
      : [],
    pageUsers.length && pageAssignments.length
      ? db.collection('assignmentSubmissions').find({ userId: { $in: pageUsers }, assignmentId: { $in: pageAssignments.map((a) => String(a._id)) } }, { projection: { userId: 1, assignmentId: 1, status: 1, grade: 1 } }).toArray()
      : [],
  ]);
  const key = (u, c) => `${u}|${c}`;
  const quiz = new Map();
  for (const a of attempts) {
    const k = key(String(a.userId), lessonCourse.get(String(a.lessonId)));
    const v = quiz.get(k) || { n: 0, sum: 0, passed: 0 };
    v.n += 1;
    v.sum += a.result && typeof a.result.percent === 'number' ? a.result.percent : 0;
    if (a.result && a.result.passed === true) v.passed += 1;
    quiz.set(k, v);
  }
  const work = new Map();
  for (const s of subs) {
    const k = key(String(s.userId), assignmentCourse.get(String(s.assignmentId)));
    const v = work.get(k) || { submitted: 0, pending: 0, graded: 0 };
    v.submitted += 1;
    if (s.status === 'graded') v.graded += 1; else v.pending += 1;
    work.set(k, v);
  }

  return {
    ok: true,
    rows: slice.map(({ r, user, status: st }) => {
      const current = lessonsByCourse.get(r.courseId) || new Set();
      const q2 = quiz.get(key(r.userId, r.courseId));
      const w = work.get(key(r.userId, r.courseId));
      return {
        studentId: r.userId,
        name: text(user.name, 'Student'),
        level: user.learningLevel || (user.studentDetails && user.studentDetails.tradingLevel) || null,
        courseId: r.courseId,
        courseTitle: text((scope.byId.get(r.courseId) || {}).title, 'Course'),
        status: st,
        progress: typeof r.progress === 'number' ? Math.min(100, Math.max(0, r.progress)) : 0,
        completedLessons: (Array.isArray(r.completedLessons) ? r.completedLessons : []).filter((id) => current.has(String(id))).length,
        totalLessons: current.size,
        enrolledAt: iso(r.enrolledAt || r.createdAt),
        lastActivityAt: lastActive(r) ? new Date(lastActive(r)).toISOString() : null,
        activeRecently: now.getTime() - lastActive(r) <= ACTIVE_WINDOW_MS,
        quiz: q2 ? { attempts: q2.n, averagePercent: round1(q2.sum / q2.n), passed: q2.passed } : { attempts: 0, averagePercent: null, passed: 0 },
        submissions: w || { submitted: 0, pending: 0, graded: 0 },
      };
    }),
    courses: scope.courses.map((c) => ({ courseId: String(c._id), title: text(c.title, 'Course') })),
    pagination: { page: pg.page, limit: pg.limit, total: list.length, pages: Math.max(1, Math.ceil(list.length / pg.limit)) },
  };
}

/**
 * One student's records in the member's courses. 404 unless the student has an active enrollment
 * in at least one scoped course (an unrelated student is indistinguishable from a missing one).
 */
async function instructorStudentDetail(db, member, { studentId, courseId } = {}) {
  if (!isId(studentId)) return { ok: false, status: 404, error: 'Student not found' };
  const scope = await teachingScope(db, member, { courseId });
  if (!scope.ok) return scope;
  const rows = (await activeRows(db, scope.ids, { lessonCompletedAt: 1 })).filter((r) => r.userId === studentId);
  if (!rows.length) return { ok: false, status: 404, error: 'Student not found' };
  const user = await db.collection('users').findOne({ _id: oid(studentId) }, { projection: { name: 1, learningLevel: 1, 'studentDetails.tradingLevel': 1, role: 1, createdAt: 1 } });
  if (!user || user.role !== 'student') return { ok: false, status: 404, error: 'Student not found' };
  const courseIds = rows.map((r) => r.courseId);
  const lessons = await lessonsOf(db, courseIds);
  const lessonIds = lessons.map((l) => String(l._id));
  const assignments = await assignmentsOf(db, courseIds);
  const [attempts, submissions] = await Promise.all([
    lessonIds.length
      ? db.collection('quizAttempts').find({ userId: studentId, lessonId: { $in: lessonIds }, status: { $in: [...FINISHED_STATUSES] } }, { projection: { lessonId: 1, number: 1, status: 1, submittedAt: 1, 'result.percent': 1, 'result.passed': 1 } }).sort({ submittedAt: -1 }).limit(100).toArray()
      : [],
    assignments.length
      ? db.collection('assignmentSubmissions').find({ userId: studentId, assignmentId: { $in: assignments.map((a) => String(a._id)) } }, { projection: { assignmentId: 1, status: 1, grade: 1, feedback: 1, late: 1, submittedAt: 1, gradedAt: 1 } }).toArray()
      : [],
  ]);
  const lessonById = new Map(lessons.map((l) => [String(l._id), l]));
  const assignmentById = new Map(assignments.map((a) => [String(a._id), a]));
  const courses = rows.map((r) => {
    const own = sortLessonsByOrder(lessons.filter((l) => String(l.courseId) === r.courseId));
    const done = new Set((Array.isArray(r.completedLessons) ? r.completedLessons : []).map(String));
    const times = r.lessonCompletedAt && typeof r.lessonCompletedAt === 'object' ? r.lessonCompletedAt : {};
    return {
      courseId: r.courseId,
      title: text((scope.byId.get(r.courseId) || {}).title, 'Course'),
      progress: typeof r.progress === 'number' ? Math.min(100, Math.max(0, r.progress)) : 0,
      completedAt: iso(r.completedAt),
      enrolledAt: iso(r.enrolledAt || r.createdAt),
      lastActivityAt: lastActive(r) ? new Date(lastActive(r)).toISOString() : null,
      lessons: own.map((l) => ({ lessonId: String(l._id), title: text(l.title, 'Lesson'), completed: done.has(String(l._id)), completedAt: iso(times[String(l._id)]) })),
    };
  });
  const activity = [];
  for (const c of courses) for (const l of c.lessons) if (l.completedAt) activity.push({ type: 'lesson_completed', at: l.completedAt, title: l.title, courseTitle: c.title });
  for (const a of attempts) {
    const l = lessonById.get(String(a.lessonId));
    if (a.submittedAt) activity.push({ type: 'quiz_finished', at: iso(a.submittedAt), title: l ? text(l.title, 'Lesson') : 'Lesson quiz', courseTitle: l ? text((scope.byId.get(String(l.courseId)) || {}).title, 'Course') : null, percent: a.result ? a.result.percent : null, passed: a.result ? a.result.passed : null });
  }
  for (const s of submissions) {
    const a = assignmentById.get(String(s.assignmentId));
    if (s.submittedAt) activity.push({ type: 'assignment_submitted', at: iso(s.submittedAt), title: a ? text(a.title, 'Assignment') : 'Assignment', courseTitle: a ? text((scope.byId.get(String(a.courseId)) || {}).title, 'Course') : null, late: s.late === true });
  }
  activity.sort((x, y) => time(y.at) - time(x.at));
  return {
    ok: true,
    student: { studentId, name: text(user.name, 'Student'), level: user.learningLevel || (user.studentDetails && user.studentDetails.tradingLevel) || null, joinedAt: iso(user.createdAt) },
    courses,
    quizzes: attempts.map((a) => {
      const l = lessonById.get(String(a.lessonId));
      return { lessonId: String(a.lessonId), lessonTitle: l ? text(l.title, 'Lesson') : 'Lesson', courseId: l ? String(l.courseId) : null, attempt: a.number || null, status: a.status, percent: a.result && typeof a.result.percent === 'number' ? a.result.percent : null, passed: a.result && typeof a.result.passed === 'boolean' ? a.result.passed : null, finishedAt: iso(a.submittedAt) };
    }),
    submissions: submissions.map((s) => {
      const a = assignmentById.get(String(s.assignmentId));
      return { submissionId: String(s._id), assignmentId: String(s.assignmentId), assignmentTitle: a ? text(a.title, 'Assignment') : 'Assignment', courseId: a ? String(a.courseId) : null, status: s.status === 'graded' ? 'graded' : 'pending', grade: typeof s.grade === 'number' ? s.grade : null, late: s.late === true, submittedAt: iso(s.submittedAt), gradedAt: iso(s.gradedAt) };
    }).sort((x, y) => time(y.submittedAt) - time(x.submittedAt)),
    activity: activity.slice(0, 30),
  };
}

// ---------------------------------------------------------------------------
// Submissions (grading queue)
// ---------------------------------------------------------------------------

const QUEUE_STATUSES = Object.freeze(['pending', 'graded', 'late', 'all']);

/**
 * Assignment submissions in the member's courses, paginated. pending: oldest first (fair queue);
 * graded / all: newest first. Text is previewed; the full work comes from submissionDetail.
 */
async function instructorSubmissions(db, member, { status = 'pending', courseId, assignmentId, page, limit } = {}) {
  const scope = await teachingScope(db, member, { courseId });
  if (!scope.ok) return scope;
  if (assignmentId !== undefined && assignmentId !== null && assignmentId !== '' && !isId(assignmentId)) return { ok: false, status: 404, error: 'Assignment not found' };
  const assignments = await assignmentsOf(db, scope.ids, { assignmentId: assignmentId || undefined });
  if (assignmentId && !assignments.length) return { ok: false, status: 404, error: 'Assignment not found' };
  const st = QUEUE_STATUSES.includes(status) ? status : 'pending';
  const pg = paging(page, limit);
  const empty = { ok: true, filter: st, rows: [], counts: { pending: 0, graded: 0, late: 0 }, assignments: [], pagination: { page: pg.page, limit: pg.limit, total: 0, pages: 1 } };
  if (!assignments.length) return { ...empty, courses: scope.courses.map((c) => ({ courseId: String(c._id), title: text(c.title, 'Course') })) };
  const ids = assignments.map((a) => String(a._id));
  const base = { assignmentId: { $in: ids } };
  const filter = st === 'pending' ? { ...base, status: { $ne: 'graded' } }
    : st === 'graded' ? { ...base, status: 'graded' }
      : st === 'late' ? { ...base, status: { $ne: 'graded' }, late: true }
        : base;
  const col = db.collection('assignmentSubmissions');
  const [rows, total, pendingCount, gradedCount, lateCount] = await Promise.all([
    col.find(filter, { projection: { assignmentId: 1, userId: 1, status: 1, grade: 1, late: 1, submittedAt: 1, gradedAt: 1, submissionText: 1, submissionFile: 1, gradeVersion: 1 } })
      .sort(st === 'pending' || st === 'late' ? { submittedAt: 1, _id: 1 } : { submittedAt: -1, _id: -1 })
      .skip(pg.skip).limit(pg.limit).toArray(),
    col.countDocuments(filter),
    col.countDocuments({ ...base, status: { $ne: 'graded' } }),
    col.countDocuments({ ...base, status: 'graded' }),
    col.countDocuments({ ...base, status: { $ne: 'graded' }, late: true }),
  ]);
  const names = await studentNames(db, rows.map((r) => String(r.userId)));
  const assignmentById = new Map(assignments.map((a) => [String(a._id), a]));
  return {
    ok: true,
    filter: st,
    rows: rows.map((r) => {
      const a = assignmentById.get(String(r.assignmentId));
      const body = typeof r.submissionText === 'string' ? r.submissionText : '';
      return {
        submissionId: String(r._id),
        assignmentId: String(r.assignmentId),
        assignmentTitle: text(a.title, 'Assignment'),
        points: typeof a.points === 'number' ? a.points : 100,
        dueDate: iso(a.dueDate),
        courseId: String(a.courseId),
        courseTitle: text((scope.byId.get(String(a.courseId)) || {}).title, 'Course'),
        studentId: String(r.userId),
        student: names.get(String(r.userId)) || 'Student',
        status: r.status === 'graded' ? 'graded' : 'pending',
        grade: typeof r.grade === 'number' ? r.grade : null,
        late: r.late === true,
        submittedAt: iso(r.submittedAt),
        gradedAt: iso(r.gradedAt),
        preview: body.length > PREVIEW_LENGTH ? `${body.slice(0, PREVIEW_LENGTH)}…` : body,
        hasFile: typeof r.submissionFile === 'string' && r.submissionFile.length > 0,
      };
    }),
    counts: { pending: pendingCount, graded: gradedCount, late: lateCount },
    assignments: assignments.map((a) => ({ assignmentId: String(a._id), title: text(a.title, 'Assignment'), courseId: String(a.courseId) })),
    courses: scope.courses.map((c) => ({ courseId: String(c._id), title: text(c.title, 'Course') })),
    pagination: { page: pg.page, limit: pg.limit, total, pages: Math.max(1, Math.ceil(total / pg.limit)) },
  };
}

/** One submission for review and grading: the full work, the assignment and the grade history. */
async function submissionDetail(db, member, { submissionId } = {}) {
  if (!isId(submissionId)) return { ok: false, status: 404, error: 'Submission not found' };
  const submission = await db.collection('assignmentSubmissions').findOne({ _id: oid(submissionId) });
  if (!submission || !isId(String(submission.assignmentId))) return { ok: false, status: 404, error: 'Submission not found' };
  const assignment = await db.collection('assignments').findOne({ _id: oid(String(submission.assignmentId)) }, { projection: { title: 1, courseId: 1, lessonId: 1, dueDate: 1, points: 1, instructions: 1, description: 1, status: 1 } });
  if (!assignment || !isId(String(assignment.courseId))) return { ok: false, status: 404, error: 'Submission not found' };
  const scope = await teachingScope(db, member, { courseId: String(assignment.courseId) });
  if (!scope.ok) return { ok: false, status: 404, error: 'Submission not found' };
  const names = await studentNames(db, [String(submission.userId)]);
  const graderIds = (Array.isArray(submission.gradeHistory) ? submission.gradeHistory : []).map((h) => String(h.gradedBy || ''));
  const graders = await studentNames(db, graderIds);
  return {
    ok: true,
    submission: {
      submissionId: String(submission._id),
      studentId: String(submission.userId),
      student: names.get(String(submission.userId)) || 'Student',
      status: submission.status === 'graded' ? 'graded' : 'pending',
      grade: typeof submission.grade === 'number' ? submission.grade : null,
      feedback: typeof submission.feedback === 'string' ? submission.feedback : null,
      late: submission.late === true,
      submittedAt: iso(submission.submittedAt),
      gradedAt: iso(submission.gradedAt),
      submissionText: typeof submission.submissionText === 'string' ? submission.submissionText : '',
      submissionFile: typeof submission.submissionFile === 'string' ? submission.submissionFile : null,
      gradeVersion: typeof submission.gradeVersion === 'number' ? submission.gradeVersion : 0,
      gradeHistory: (Array.isArray(submission.gradeHistory) ? submission.gradeHistory : []).map((h) => ({
        grade: h.grade,
        previousGrade: typeof h.previousGrade === 'number' ? h.previousGrade : null,
        feedback: typeof h.feedback === 'string' ? h.feedback : null,
        reason: typeof h.reason === 'string' ? h.reason : null,
        gradedBy: graders.get(String(h.gradedBy || '')) || 'Staff',
        gradedAt: iso(h.gradedAt),
      })),
      previousVersions: (Array.isArray(submission.previousVersions) ? submission.previousVersions : []).map((v) => ({ submittedAt: iso(v.submittedAt), grade: typeof v.grade === 'number' ? v.grade : null })),
    },
    assignment: {
      assignmentId: String(assignment._id),
      title: text(assignment.title, 'Assignment'),
      instructions: text(assignment.instructions),
      description: text(assignment.description),
      points: typeof assignment.points === 'number' ? assignment.points : 100,
      dueDate: iso(assignment.dueDate),
      courseId: String(assignment.courseId),
      courseTitle: text((scope.byId.get(String(assignment.courseId)) || {}).title, 'Course'),
      lessonId: assignment.lessonId ? String(assignment.lessonId) : null,
    },
  };
}

// ---------------------------------------------------------------------------
// Activity history and profile
// ---------------------------------------------------------------------------

const ACTIVITY_LABELS = Object.freeze({
  assignment_graded: 'Graded a submission',
  assignment_regraded: 'Changed a grade',
  course_reassigned: 'Course reassigned',
});

/**
 * The member's own academic actions (grades) and reassignments of their courses, from the
 * append-only audit log, newest first, paginated. Instructors see only entries about themselves.
 */
async function instructorActivity(db, member, { page, limit } = {}) {
  if (!member || !STAFF.has(member.role) || !isId(String(member.userId || ''))) return { ok: false, status: 403, error: 'Not authorized' };
  const pg = paging(page, limit);
  const uid = String(member.userId);
  const filter = {
    entityType: { $in: ['grade', 'course'] },
    $or: [{ 'actor.userId': uid }, { 'after.instructorId': uid }, { 'before.instructorId': uid }],
  };
  const col = db.collection('adminAuditLog');
  const [rows, total] = await Promise.all([
    col.find(filter).sort({ createdAt: -1, _id: -1 }).skip(pg.skip).limit(pg.limit).toArray(),
    col.countDocuments(filter),
  ]);
  const studentIds = rows.map((r) => r.context && r.context.studentId).filter(Boolean).map(String);
  const names = await studentNames(db, studentIds);
  return {
    ok: true,
    rows: rows.map((r) => ({
      id: String(r._id),
      action: r.action,
      label: ACTIVITY_LABELS[r.action] || r.action,
      at: iso(r.createdAt),
      courseTitle: r.context && r.context.courseTitle ? r.context.courseTitle : null,
      assignmentTitle: r.context && r.context.assignmentTitle ? r.context.assignmentTitle : null,
      student: r.context && r.context.studentId ? names.get(String(r.context.studentId)) || 'Student' : null,
      before: r.before || null,
      after: r.after || null,
      reason: r.reason || null,
      byYou: r.actor && String(r.actor.userId) === uid,
      // For a reassignment: whether the member gained or lost the course.
      direction: r.entityType === 'course' ? (r.after && String(r.after.instructorId) === uid ? 'assigned_to_you' : r.before && String(r.before.instructorId) === uid ? 'moved_from_you' : null) : null,
    })),
    pagination: { page: pg.page, limit: pg.limit, total, pages: Math.max(1, Math.ceil(total / pg.limit)) },
  };
}

/** The member's own account as the portal shows it, with their assigned courses. */
async function instructorProfile(db, member) {
  const scope = await teachingScope(db, member);
  if (!scope.ok) return scope;
  const user = await db.collection('users').findOne({ _id: oid(member.userId) }, { projection: { name: 1, email: 1, role: 1, status: 1, createdAt: 1, profilePhoto: 1, phone: 1 } });
  if (!user) return { ok: false, status: 404, error: 'Account not found' };
  return {
    ok: true,
    profile: {
      name: text(user.name, 'Instructor'),
      email: text(user.email),
      role: user.role,
      status: user.status || 'approved',
      joinedAt: iso(user.createdAt),
      hasPhoto: Boolean(user.profilePhoto),
    },
    courses: scope.courses.map((c) => ({ courseId: String(c._id), title: text(c.title, 'Course'), status: courseStatus(c) })),
  };
}

module.exports = {
  QUEUE_STATUSES,
  instructorActivity,
  instructorOverview,
  instructorProfile,
  instructorStudentDetail,
  instructorStudents,
  instructorSubmissions,
  submissionDetail,
  teachingScope,
};
