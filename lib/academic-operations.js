'use strict';

/**
 * Academic operations with audit evidence (Phase 12): grade audit, assignment editing rules and
 * course reassignment. The audit trail is the existing append-only admin audit log
 * (`adminAuditLog`, find/insert only for the app role), which the Super Admin reads at
 * /api/admin/audit-log (entity types `grade` and `course`).
 *
 * Grades. The submission's own `gradeHistory` (written atomically with the grade by
 * POST /api/assignments/:id/grade) stays the primary record: grade, previous grade, feedback,
 * grader, time and, from Phase 12, the reason for a change. The audit entry repeats it with the
 * course, assignment and student, under a deterministic id (`grade:<submissionId>:<version>`), so a
 * retry or a repair can never write it twice. The grade route marks `gradeAuditPending` in the same
 * atomic update and clears it once the entry exists; repairGradeAudits finishes any that a failure
 * interrupted. Automated quiz scores are never touched here (they live in quizAttempts/quizScores).
 *
 * Reassignment. A course has one instructor. Reassigning changes only `courses.instructorId` (plus
 * a history entry on the course) with a conditional update on the instructor that was read, so two
 * concurrent reassignments cannot both apply. Enrollments, progress, quiz attempts and scores,
 * assignments, submissions and grades are keyed by course, lesson and student, never by
 * instructor, so they are untouched; access follows the course owner on every request, so the
 * previous instructor loses access at once and the new one gains exactly the same rights.
 */

const { ObjectId } = require('mongodb');
const { AUDIT_COLLECTION } = require('./course-payment');

const STORED_ID = /^[a-fA-F0-9]{24}$/;
const REASON_MIN = 5;
const REASON_MAX = 500;
const TITLE_MAX = 200;
const INSTRUCTIONS_MAX = 10000;
const DESCRIPTION_MAX = 5000;
const POINTS_MAX = 1000;
const ASSIGNMENT_STATUSES = Object.freeze(['draft', 'published', 'closed']);

const isId = (v) => typeof v === 'string' && STORED_ID.test(v);
const refuse = (status, code, error) => ({ ok: false, status, code, error });

/** Trimmed text with control characters removed; null when not a string. */
function clean(value) {
  if (typeof value !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
}

function readReason(value, { required }) {
  const reason = clean(value);
  if (!reason) return required ? refuse(400, 'reason_required', `Give a reason of ${REASON_MIN} to ${REASON_MAX} characters.`) : { ok: true, reason: '' };
  if (reason.length < REASON_MIN || reason.length > REASON_MAX) return refuse(400, 'invalid_reason', `Give a reason of ${REASON_MIN} to ${REASON_MAX} characters.`);
  return { ok: true, reason };
}

// ---------------------------------------------------------------------------
// Grades
// ---------------------------------------------------------------------------

/**
 * Whether this grade action is a change of an existing grade (needs a reason) and the reason.
 * A first grade, or re-saving the same grade with new feedback, needs none.
 */
function decideGradeChange({ currentGrade, newGrade, reason }) {
  const changing = typeof currentGrade === 'number' && currentGrade !== newGrade;
  const checked = readReason(reason, { required: changing });
  if (!checked.ok) return checked;
  return { ok: true, regrade: typeof currentGrade === 'number', changing, reason: checked.reason };
}

const gradeAuditId = (submissionId, version) => `grade:${submissionId}:${version}`;

/** The audit entry for one grade version (pure). */
function gradeAuditEntry({ submissionId, version, previousGrade, grade, reason, regrade, actor, context, now }) {
  return {
    _id: gradeAuditId(submissionId, version),
    entityType: 'grade',
    entityId: String(submissionId),
    reference: context && context.assignmentId ? String(context.assignmentId) : null,
    action: regrade ? 'assignment_regraded' : 'assignment_graded',
    reason: reason || '',
    before: { grade: typeof previousGrade === 'number' ? previousGrade : null, version: version - 1 },
    after: { grade, version },
    outcome: 'saved',
    context: {
      courseId: context && context.courseId ? String(context.courseId) : null,
      courseTitle: context && context.courseTitle ? String(context.courseTitle) : null,
      assignmentId: context && context.assignmentId ? String(context.assignmentId) : null,
      assignmentTitle: context && context.assignmentTitle ? String(context.assignmentTitle) : null,
      studentId: context && context.studentId ? String(context.studentId) : null,
    },
    actor: { userId: String(actor.userId), email: typeof actor.email === 'string' ? actor.email : null, role: actor.role || null },
    createdAt: now,
  };
}

const isDuplicateKey = (error) => Boolean(error && (error.code === 11000 || /E11000/.test(String(error.message || ''))));

/** Writes the entry (idempotent) and clears the pending mark. Returns true when the entry exists. */
async function writeGradeAudit(db, entry) {
  try {
    await db.collection(AUDIT_COLLECTION).insertOne(entry);
  } catch (error) {
    if (!isDuplicateKey(error)) return false;
  }
  const version = entry.after.version;
  await db.collection('assignmentSubmissions').updateOne(
    { _id: new ObjectId(entry.entityId), gradeAuditPending: version },
    { $unset: { gradeAuditPending: '' } }
  );
  return true;
}

/** Finishes audit entries an interrupted grade left pending (from the grade history). */
async function repairGradeAudits(db, { limit = 100 } = {}) {
  const rows = await db.collection('assignmentSubmissions').find({ gradeAuditPending: { $exists: true } }).limit(limit).toArray();
  let repaired = 0;
  for (const row of rows) {
    const history = Array.isArray(row.gradeHistory) ? row.gradeHistory : [];
    const entryOf = history.find((h) => h.version === row.gradeAuditPending) || history[history.length - 1];
    if (!entryOf) continue;
    const assignment = isId(String(row.assignmentId)) ? await db.collection('assignments').findOne({ _id: new ObjectId(String(row.assignmentId)) }, { projection: { courseId: 1, title: 1 } }) : null;
    const ok = await writeGradeAudit(db, gradeAuditEntry({
      submissionId: String(row._id),
      version: row.gradeAuditPending,
      previousGrade: entryOf.previousGrade,
      grade: entryOf.grade,
      reason: entryOf.reason || '',
      regrade: typeof entryOf.previousGrade === 'number',
      actor: { userId: String(entryOf.gradedBy || ''), email: null, role: null },
      context: { courseId: assignment ? assignment.courseId : null, assignmentId: row.assignmentId, assignmentTitle: assignment ? assignment.title : null, studentId: row.userId },
      now: entryOf.gradedAt ? new Date(entryOf.gradedAt) : new Date(),
    }));
    if (ok) repaired += 1;
  }
  return { repaired };
}

// ---------------------------------------------------------------------------
// Assignments
// ---------------------------------------------------------------------------

/** A due date: ISO date-time or YYYY-MM-DD (end of that day applies at submission), or null. */
function readDueDate(value) {
  if (value === null || value === '') return { ok: true, value: null };
  if (typeof value !== 'string') return refuse(400, 'invalid_due_date', 'The due date is not valid.');
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return refuse(400, 'invalid_due_date', 'The due date is not valid.');
  return { ok: true, value: /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : date };
}

/**
 * Validates an assignment edit. `graded` is whether any submission of it has been graded: then the
 * points cannot change (awarded points would no longer match). Returns { ok, set } with only the
 * fields given, or a refusal. Submissions and grades are never touched by an edit.
 */
function readAssignmentPatch(body, { graded = false, currentPoints } = {}) {
  const input = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const set = {};
  if ('title' in input) {
    const title = clean(input.title);
    if (!title) return refuse(400, 'invalid_title', 'A title is required.');
    if (title.length > TITLE_MAX) return refuse(400, 'invalid_title', `The title can be at most ${TITLE_MAX} characters.`);
    set.title = title;
  }
  if ('instructions' in input) {
    const instructions = clean(input.instructions);
    if (!instructions) return refuse(400, 'invalid_instructions', 'Instructions are required.');
    if (instructions.length > INSTRUCTIONS_MAX) return refuse(400, 'invalid_instructions', `Instructions can be at most ${INSTRUCTIONS_MAX} characters.`);
    set.instructions = instructions;
  }
  if ('description' in input) {
    const description = clean(input.description);
    if (description === null) return refuse(400, 'invalid_description', 'The description is not valid.');
    if (description.length > DESCRIPTION_MAX) return refuse(400, 'invalid_description', `The description can be at most ${DESCRIPTION_MAX} characters.`);
    set.description = description;
  }
  if ('dueDate' in input) {
    const due = readDueDate(input.dueDate);
    if (!due.ok) return due;
    set.dueDate = due.value;
  }
  if ('points' in input) {
    const points = input.points;
    if (!Number.isInteger(points) || points < 0 || points > POINTS_MAX) return refuse(400, 'invalid_points', `Points must be a whole number from 0 to ${POINTS_MAX}.`);
    if (graded && points !== (typeof currentPoints === 'number' ? currentPoints : 100)) {
      return refuse(409, 'points_locked', 'Points cannot change once a submission has been graded.');
    }
    set.points = points;
  }
  if ('status' in input) {
    if (!ASSIGNMENT_STATUSES.includes(input.status)) return refuse(400, 'invalid_status', 'Status must be draft, published or closed.');
    set.status = input.status;
  }
  return { ok: true, set };
}

/** Status as stored; assignments saved before Phase 12 have none and stay published. */
const assignmentStatus = (assignment) => (assignment && ASSIGNMENT_STATUSES.includes(assignment.status) ? assignment.status : 'published');
/** Students see published and closed assignments; drafts are staff-only. */
const visibleToStudents = (assignment) => assignmentStatus(assignment) !== 'draft';
/** New submissions only while published. */
const acceptsSubmissions = (assignment) => assignmentStatus(assignment) === 'published';

// ---------------------------------------------------------------------------
// Course reassignment
// ---------------------------------------------------------------------------

/**
 * Reassigns a course to an active instructor. Admins and the Super Admin only (the existing course
 * assignment policy; not an approval privilege). Returns { ok, courseId, from, to } or a refusal.
 * `notify` (optional) receives the notifications to send; failures there never undo the change.
 */
async function reassignCourse(db, { actor, courseId, instructorId, reason, now = new Date(), notify }) {
  if (!actor || (actor.role !== 'admin' && actor.role !== 'superadmin')) return refuse(403, 'not_authorized', 'Only an admin can reassign a course.');
  if (!isId(courseId)) return refuse(404, 'course_not_found', 'Course not found');
  if (!isId(instructorId)) return refuse(400, 'invalid_instructor', 'Choose an active instructor for this course.');
  const checked = readReason(reason, { required: true });
  if (!checked.ok) return checked;
  const course = await db.collection('courses').findOne({ _id: new ObjectId(courseId) }, { projection: { title: 1, instructorId: 1, status: 1 } });
  if (!course) return refuse(404, 'course_not_found', 'Course not found');
  const target = await db.collection('users').findOne({ _id: new ObjectId(instructorId) }, { projection: { role: 1, status: 1, name: 1 } });
  if (!target || target.role !== 'instructor' || (target.status && target.status !== 'approved')) {
    return refuse(400, 'invalid_instructor', 'Only an active instructor account can be assigned to a course.');
  }
  const from = course.instructorId == null ? null : String(course.instructorId);
  if (from === instructorId) return refuse(409, 'already_assigned', 'This instructor is already assigned to the course.');
  return applyReassignment(db, { course, from, to: instructorId, actor, reason: checked.reason, now, notify });
}

/**
 * The shared write: conditional on the instructor that was read (concurrent changes get 409), then
 * the audit entry and the notifications. Used by reassignCourse and by the course editor's
 * admin reassignment (PUT /api/courses/:id), so both paths are audited the same way.
 */
async function applyReassignment(db, { course, from, to, actor, reason, now, notify, extraSet = {} }) {
  const courseId = String(course._id);
  const historyEntry = { from, to, at: now, by: String(actor.userId), reason };
  const result = await db.collection('courses').updateOne(
    { _id: new ObjectId(courseId), instructorId: course.instructorId === undefined ? { $exists: false } : course.instructorId },
    { $set: { ...extraSet, instructorId: to, instructorAssignedAt: now, updatedAt: now }, $push: { instructorHistory: historyEntry } }
  );
  if (!result.matchedCount) return refuse(409, 'course_changed', 'The course was changed meanwhile. Reload and try again.');
  const audit = {
    entityType: 'course',
    entityId: courseId,
    reference: courseId,
    action: 'course_reassigned',
    reason,
    before: { instructorId: from },
    after: { instructorId: to },
    outcome: 'saved',
    context: { courseId, courseTitle: typeof course.title === 'string' ? course.title : null },
    actor: { userId: String(actor.userId), email: typeof actor.email === 'string' ? actor.email : null, role: actor.role },
    createdAt: now,
  };
  let audited = true;
  try {
    await db.collection(AUDIT_COLLECTION).insertOne(audit);
  } catch {
    audited = false;
    console.error(JSON.stringify({ event: 'courseReassignAudit', result: 'failed', courseId }));
  }
  if (typeof notify === 'function') {
    const title = typeof course.title === 'string' && course.title ? course.title : 'a course';
    const key = `reassign:${courseId}:${now.getTime()}`;
    try {
      await notify([
        { userId: to, title: 'Course assigned to you', message: `You are now the instructor of "${title}".`, dedupeKey: `${key}:to`, relatedId: courseId },
        ...(from && isId(from) ? [{ userId: from, title: 'Course reassigned', message: `"${title}" has been assigned to another instructor.`, dedupeKey: `${key}:from`, relatedId: courseId }] : []),
      ]);
    } catch {
      console.error(JSON.stringify({ event: 'courseReassignNotify', result: 'failed', courseId }));
    }
  }
  return { ok: true, courseId, from, to, audited };
}

/** The course's assignment history (newest first), with names. Staff-only: the route checks. */
async function reassignmentHistory(db, courseId) {
  if (!isId(courseId)) return refuse(404, 'course_not_found', 'Course not found');
  const course = await db.collection('courses').findOne({ _id: new ObjectId(courseId) }, { projection: { title: 1, instructorId: 1, instructorHistory: 1 } });
  if (!course) return refuse(404, 'course_not_found', 'Course not found');
  const history = Array.isArray(course.instructorHistory) ? course.instructorHistory : [];
  const ids = [...new Set([course.instructorId, ...history.flatMap((h) => [h.from, h.to, h.by])].filter((v) => v && isId(String(v))).map(String))];
  const users = ids.length ? await db.collection('users').find({ _id: { $in: ids.map((v) => new ObjectId(v)) } }, { projection: { name: 1, role: 1, status: 1 } }).toArray() : [];
  const nameOf = new Map(users.map((u) => [String(u._id), typeof u.name === 'string' ? u.name : 'User']));
  return {
    ok: true,
    course: { courseId, title: course.title || 'Course', instructorId: course.instructorId ? String(course.instructorId) : null, instructor: course.instructorId ? nameOf.get(String(course.instructorId)) || null : null },
    history: [...history].reverse().map((h) => ({ from: h.from ? nameOf.get(String(h.from)) || 'Instructor' : null, to: nameOf.get(String(h.to)) || 'Instructor', by: nameOf.get(String(h.by)) || 'Admin', at: h.at ? new Date(h.at).toISOString() : null, reason: h.reason || '' })),
  };
}

module.exports = {
  ASSIGNMENT_STATUSES,
  POINTS_MAX,
  REASON_MAX,
  REASON_MIN,
  acceptsSubmissions,
  applyReassignment,
  assignmentStatus,
  decideGradeChange,
  gradeAuditEntry,
  gradeAuditId,
  readAssignmentPatch,
  readDueDate,
  reassignCourse,
  reassignmentHistory,
  repairGradeAudits,
  visibleToStudents,
  writeGradeAudit,
};
