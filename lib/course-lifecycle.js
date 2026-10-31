'use strict';

/**
 * Course lifecycle (Phase 4, Decision 1): draft -> in_review -> published -> archived.
 *
 * Stored values are lower case, like account statuses (`approved`, `pending`). A course stored
 * before the lifecycle existed has no `status` field; it was already live, so it is treated as
 * published (scripts/phase-4-course-migration.js makes the value explicit). Any other
 * unrecognised value is treated as a draft, so an unknown state is never public.
 *
 * Who sees a course:
 *   published  everyone (catalogue, landing page, enrolment, checkout)
 *   archived   not listed, not enrollable, not purchasable; students with an active enrolment keep
 *              their access; the instructor and admins still see it
 *   draft, in_review  the assigned instructor, admins and the Super Admin only
 *
 * Who changes it (every change is checked here, on the server):
 *   draft -> in_review       assigned instructor, admin, Super Admin (submit for review)
 *   in_review -> draft       assigned instructor (withdraw), admin, Super Admin (return for changes)
 *   in_review -> published   admin, Super Admin
 *   published -> archived    admin, Super Admin
 *   archived -> published    admin, Super Admin (restore)
 *   draft -> published, draft -> archived, in_review -> archived   Super Admin only (override)
 * A published or archived course never goes back to draft or review: that would take a live
 * course away from enrolled students.
 */

// No database driver here: this module is also bundled for the browser (via lib/enrollment-state).
const COURSE_STATUS = Object.freeze({
  DRAFT: 'draft',
  IN_REVIEW: 'in_review',
  PUBLISHED: 'published',
  ARCHIVED: 'archived',
});

const COURSE_STATUSES = Object.freeze(Object.values(COURSE_STATUS));

const TRANSITIONS = Object.freeze({
  'draft>in_review': ['owner', 'admin', 'superadmin'],
  'in_review>draft': ['owner', 'admin', 'superadmin'],
  'in_review>published': ['admin', 'superadmin'],
  'published>archived': ['admin', 'superadmin'],
  'archived>published': ['admin', 'superadmin'],
  'draft>published': ['superadmin'],
  'draft>archived': ['superadmin'],
  'in_review>archived': ['superadmin'],
});

const NOT_EDITABLE = Object.freeze({
  ok: false,
  status: 409,
  code: 'course_not_editable',
  error: 'Only draft courses can be edited by their instructor. Withdraw the course from review, or ask an administrator to make changes to a published course.',
});

function sameId(left, right) {
  if (left == null || right == null) return false;
  return String(left) === String(right);
}

/** The lifecycle state of a stored course. */
function courseStatus(course) {
  if (!course || typeof course !== 'object') return COURSE_STATUS.DRAFT;
  if (course.status === undefined) return COURSE_STATUS.PUBLISHED;
  return COURSE_STATUSES.includes(course.status) ? course.status : COURSE_STATUS.DRAFT;
}

/** MongoDB filter for courses in `status`, including legacy rows without the field for published. */
function statusFilter(status) {
  if (status === COURSE_STATUS.PUBLISHED) {
    return { $or: [{ status: COURSE_STATUS.PUBLISHED }, { status: { $exists: false } }] };
  }
  return { status };
}

/** The public catalogue: published courses only. */
function publicCourseFilter() {
  return statusFilter(COURSE_STATUS.PUBLISHED);
}

function isStaffAdmin(member) {
  return Boolean(member && (member.role === 'admin' || member.role === 'superadmin'));
}

function isAssignedInstructor(member, course) {
  return Boolean(member && member.role === 'instructor' && course && sameId(course.instructorId, member.userId));
}

/**
 * Course list filter for this member (combined with the search filters by the caller).
 * `activeCourseIds` are the ids of the courses a student is actively enrolled in;
 * `instructorIdValues` are the forms an instructor's id may be stored in (string, ObjectId).
 */
function courseVisibilityFilter(member, { activeCourseIds = [], instructorIdValues = [] } = {}) {
  if (isStaffAdmin(member)) return {};
  const visible = [publicCourseFilter()];
  if (member && member.role === 'instructor' && member.userId) {
    visible.push({ instructorId: { $in: instructorIdValues.length ? instructorIdValues : [String(member.userId)] } });
  }
  if (member && member.role === 'student' && activeCourseIds.length) {
    visible.push({ status: COURSE_STATUS.ARCHIVED, _id: { $in: activeCourseIds } });
  }
  return visible.length === 1 ? visible[0] : { $or: visible };
}

/**
 * Whether this member may see the course at all (detail page, outline). Students need an active
 * enrolment for an archived course; drafts and courses in review are staff-only.
 */
function canSeeCourse(member, course, { activeEnrollment = false } = {}) {
  if (!member || !course) return false;
  if (isStaffAdmin(member) || isAssignedInstructor(member, course)) return true;
  const status = courseStatus(course);
  if (status === COURSE_STATUS.PUBLISHED) return true;
  if (status === COURSE_STATUS.ARCHIVED) return member.role === 'student' && Boolean(activeEnrollment);
  return false;
}

/** Whether a student's lesson access (enrolment, entitlement) applies in this state. */
function studentContentOpen(course) {
  const status = courseStatus(course);
  return status === COURSE_STATUS.PUBLISHED || status === COURSE_STATUS.ARCHIVED;
}

/** New enrolments and new checkouts: published courses only. */
function decideCourseOpenForSale(course) {
  if (!course) return { ok: false, status: 404, code: 'course_not_found', error: 'Course not found' };
  const status = courseStatus(course);
  if (status === COURSE_STATUS.PUBLISHED) return { ok: true };
  if (status === COURSE_STATUS.ARCHIVED) {
    return { ok: false, status: 409, code: 'course_archived', error: 'This course has been archived and is no longer open for new enrolments or purchases.' };
  }
  return { ok: false, status: 404, code: 'course_not_found', error: 'Course not found' };
}

/**
 * Content changes (course details, lessons, quizzes, lesson order). Ownership is checked by the
 * caller; this adds the lifecycle rule: an instructor edits only a draft, so live material never
 * changes without review. Admins and the Super Admin may edit in any state.
 */
function decideContentEdit(member, course) {
  if (isStaffAdmin(member)) return { ok: true };
  if (courseStatus(course) === COURSE_STATUS.DRAFT) return { ok: true };
  return NOT_EDITABLE;
}

/** A lifecycle change. Returns the filter that must still match when the change is written. */
function decideCourseTransition({ member, course, to }) {
  if (!member || !member.userId || !['instructor', 'admin', 'superadmin'].includes(member.role)) {
    return { ok: false, status: 403, code: 'not_authorized', error: 'Not authorized' };
  }
  if (!course || course._id == null) {
    return { ok: false, status: 404, code: 'course_not_found', error: 'Course not found' };
  }
  if (member.role === 'instructor' && !isAssignedInstructor(member, course)) {
    return { ok: false, status: 403, code: 'not_authorized', error: 'Not authorized' };
  }
  if (typeof to !== 'string' || !COURSE_STATUSES.includes(to)) {
    return { ok: false, status: 400, code: 'invalid_status', error: `Status must be one of: ${COURSE_STATUSES.join(', ')}` };
  }
  const from = courseStatus(course);
  if (from === to) {
    return { ok: false, status: 409, code: 'status_unchanged', error: `The course is already ${to.replace('_', ' ')}.` };
  }
  const allowed = TRANSITIONS[`${from}>${to}`];
  if (!allowed) {
    return { ok: false, status: 409, code: 'invalid_transition', error: `A course cannot move from ${from.replace('_', ' ')} to ${to.replace('_', ' ')}.` };
  }
  const roleKey = member.role === 'instructor' ? 'owner' : member.role;
  if (!allowed.includes(roleKey)) {
    return { ok: false, status: 403, code: 'transition_not_permitted', error: 'Your role cannot make this change.' };
  }
  return {
    ok: true,
    status: 200,
    courseId: String(course._id),
    from,
    to,
    filter: { ...statusFilter(from), deletionStartedAt: { $exists: false } },
  };
}

/** The changes each role may make from `from`, for showing the right buttons. */
function availableTransitions(member, course) {
  const from = courseStatus(course);
  return COURSE_STATUSES.filter((to) => to !== from && decideCourseTransition({ member, course, to }).ok);
}

module.exports = {
  COURSE_STATUS,
  COURSE_STATUSES,
  TRANSITIONS,
  availableTransitions,
  canSeeCourse,
  courseStatus,
  courseVisibilityFilter,
  decideContentEdit,
  decideCourseOpenForSale,
  decideCourseTransition,
  publicCourseFilter,
  statusFilter,
  studentContentOpen,
};
