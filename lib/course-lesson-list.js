'use strict';

/**
 * Lesson lists for a course: who may see each lesson's teaching content.
 *
 * Content is included only when the lesson read rule passes (active enrollment, course
 * instructor, or admin) and the lesson is not behind the paywall. Locked lessons are built
 * from the public lesson fields, so protected material never reaches the response.
 *
 * Works against any object exposing `collection(name)` with the MongoDB driver methods used
 * below, so tests can run the real flow on an in-memory store. Reads only.
 */

const { ObjectId } = require('mongodb');
const { ROLES, decideAccountAccess, decideLessonRead, decideQuizRead, isStoredId, presentLessonRead } = require('./account-access');
const { enrollmentDecisionRecord, isActiveEnrollment } = require('./enrollment-state');
const { hasCourseEntitlement, legacyLessonIdsWithAccess } = require('./course-payment');
const { canSeeCourse } = require('./course-lifecycle');
const { COURSE_PRICE_KOBO, COURSE_CURRENCY } = require('./course-price');

const STAFF_ROLES = new Set(['superadmin', 'admin', 'instructor']);

/** Set to null on a locked lesson. `resources` becomes an empty list. */
const WITHHELD_LESSON_FIELDS = Object.freeze(['content', 'description', 'summary', 'lessonSummary', 'videoUrl', 'pdfUrl', 'quiz']);

function isStaffRole(role) {
  return STAFF_ROLES.has(role);
}

function isKnownMember(member) {
  return Boolean(member && member.userId && ROLES.includes(member.role));
}

function sortLessonsByOrder(lessons) {
  return [...lessons].sort((a, b) => {
    const oa = typeof a.order === 'number' ? a.order : 0;
    const ob = typeof b.order === 'number' ? b.order : 0;
    if (oa !== ob) return oa - ob;
    return String(a._id).localeCompare(String(b._id));
  });
}

function withholdLockedContent(view) {
  for (const key of WITHHELD_LESSON_FIELDS) view[key] = null;
  view.resources = [];
  return view;
}

/**
 * Paid access for this member. Only a full-course entitlement (paid or an explicit
 * complimentary/manual grant) opens the course; legacy lesson rows open only their own lesson.
 */
async function loadCourseEntitlement(db, member, courseId, lessonIds) {
  if (member && isStaffRole(member.role)) {
    return { staff: true, coursePaid: true, legacyLessonIds: new Set() };
  }
  if (!isKnownMember(member)) {
    return { staff: false, coursePaid: false, legacyLessonIds: new Set() };
  }
  const coursePaid = await hasCourseEntitlement(db, member.userId, courseId);
  const legacyLessonIds = coursePaid
    ? new Set()
    : await legacyLessonIdsWithAccess(db, member.userId, lessonIds.map(String));
  return { staff: false, coursePaid, legacyLessonIds };
}

/**
 * Whether a lesson is a free preview (Phase 4, Decision 3).
 * Explicit courses (`freePreviewExplicit: true`: every course created from Phase 4 on, and every
 * course after scripts/phase-4-course-migration.js) use the lesson flags only: `isFreePreview`, or
 * the older explicit `isFirstLesson`. Position never matters, so reordering or adding a lesson
 * cannot change which lesson is free. Courses not yet migrated keep the earlier rule (the first
 * lesson by order is also free), so no student loses a free lesson before the migration runs.
 */
function isFreePreviewSlot(lesson, index, explicitPreview) {
  if (lesson.isFreePreview === true || lesson.isFirstLesson === true) return true;
  return !explicitPreview && index === 0;
}

/**
 * Paywall state per lesson id. Free previews (isFreePreviewSlot) and demo lessons are free;
 * everything else needs a course entitlement or a legacy purchase of that lesson. Staff are
 * never locked. `options.explicitPreview` is the course's `freePreviewExplicit` flag.
 */
function priceCourseLessons(lessons, entitlement, env, options = {}) {
  const source = env || process.env;
  const paymentsConfigured = Boolean(String(source.PAYSTACK_SECRET_KEY || '').trim());
  const adsEnabled = source.NEXT_PUBLIC_ADS_ENABLED !== 'false';
  const explicitPreview = options.explicitPreview === true;
  const pricing = new Map();
  sortLessonsByOrder(lessons).forEach((lesson, index) => {
    const id = String(lesson._id);
    const isFirstLesson = lesson.isFirstLesson === true;
    const isDemo = lesson.isDemo === true;
    const isFreePreview = isFreePreviewSlot(lesson, index, explicitPreview);
    if (entitlement.staff) {
      pricing.set(id, {
        locked: false,
        isFirstLesson,
        isFreePreview,
        isDemo,
        monetization: {
          unlocked: true,
          isFreeTier: false,
          isDemo,
          requiresPayment: false,
          showAds: false,
          amountKobo: COURSE_PRICE_KOBO,
          currency: COURSE_CURRENCY,
          paymentsConfigured,
        },
      });
      return;
    }
    const isFirstSlot = isFreePreview;
    const locked = !(isFirstSlot || isDemo || entitlement.coursePaid || entitlement.legacyLessonIds.has(id));
    pricing.set(id, {
      locked,
      isFirstLesson,
      isFreePreview,
      isDemo,
      monetization: {
        unlocked: !locked,
        isFreeTier: isFirstSlot,
        isDemo: isDemo && !isFirstSlot,
        requiresPayment: locked,
        showAds: Boolean((isFirstSlot || isDemo) && adsEnabled),
        amountKobo: COURSE_PRICE_KOBO,
        currency: COURSE_CURRENCY,
        paymentsConfigured,
      },
    });
  });
  return pricing;
}

/**
 * One view per lesson, in the order given. `enrollmentRow` is the raw progress document (or null);
 * `course` needs `_id`, `instructorId`, and `difficulty`.
 */
function presentCourseLessons({ member, course, enrollmentRow, lessons, pricing }) {
  const courseId = String(course._id);
  const enrollment = enrollmentDecisionRecord(enrollmentRow);
  const completed = new Set(
    (enrollmentRow && Array.isArray(enrollmentRow.completedLessons) ? enrollmentRow.completedLessons : []).map(String)
  );
  return lessons.map((lesson) => {
    const read = decideLessonRead({
      member,
      lesson: {
        _id: lesson._id,
        courseId: lesson.courseId,
        requiredLevel: typeof lesson.requiredLevel === 'string' ? lesson.requiredLevel : null,
      },
      course,
      enrollment,
    });
    const price = pricing.get(String(lesson._id));
    const locked = !price || price.locked === true;
    const view = presentLessonRead(lesson, read.ok && !locked, courseId);
    view.accessible = read.ok;
    if (read.ok) view.completed = completed.has(String(lesson._id));
    view.locked = locked;
    if (price) {
      view.isFirstLesson = price.isFirstLesson;
      view.isFreePreview = price.isFreePreview;
      view.isDemo = price.isDemo;
      view.monetization = price.monetization;
    }
    if (locked) withholdLockedContent(view);
    return view;
  });
}

/** Course fields the lesson lists and the single-lesson read need (never the description). */
const LESSON_LIST_COURSE_PROJECTION = Object.freeze({ instructorId: 1, difficulty: 1, status: 1, freePreviewExplicit: 1 });

const OUTLINE_TEXT_HEAD = 2048;

/**
 * Lesson fields for the outline (`?view=outline`): navigation, pricing and the short public
 * blurb. Lesson bodies are not read; only the first characters of the body and overview are, so
 * publicLessonDescription can still tell a real blurb from a copy of the body.
 */
const OUTLINE_LESSON_PROJECTION = Object.freeze({
  _id: 1,
  courseId: 1,
  title: 1,
  type: 1,
  order: 1,
  duration: 1,
  requiredLevel: 1,
  isFirstLesson: 1,
  isFreePreview: 1,
  isDemo: 1,
  description: 1,
  summary: 1,
  outlineContentHead: { $substrCP: [{ $ifNull: ['$content', ''] }, 0, OUTLINE_TEXT_HEAD] },
  outlineOverviewHead: { $substrCP: [{ $ifNull: ['$lessonSummary.overview', ''] }, 0, OUTLINE_TEXT_HEAD] },
});

function courseRecordFor(course) {
  return {
    _id: course._id,
    instructorId: course.instructorId,
    difficulty: typeof course.difficulty === 'string' ? course.difficulty : null,
    status: course.status,
  };
}

/**
 * GET /api/courses/:id/lessons. Any signed-in member who may see the course (lib/course-lifecycle:
 * published, or archived with an active enrolment, or staff of the course) gets the outline
 * (titles, order, lock state) so the course page can offer enrollment and checkout. Teaching
 * content follows presentCourseLessons. `outline: true` reads only the outline fields.
 */
async function listCourseLessons(db, { member, courseId, env, outline = false }) {
  if (!isKnownMember(member)) return { ok: false, status: 403, error: 'Not authorized' };
  if (!isStoredId(courseId)) return { ok: false, status: 400, error: 'Invalid courseId' };
  const course = await db
    .collection('courses')
    .findOne({ _id: new ObjectId(courseId) }, { projection: LESSON_LIST_COURSE_PROJECTION });
  if (!course) return { ok: false, status: 404, error: 'Course not found' };
  const storedCourseId = String(course._id);
  const [enrollmentRow, lessons] = await Promise.all([
    db.collection('progress').findOne({
      userId: member.userId,
      $or: [{ courseId: storedCourseId }, { courseId: course._id }],
    }),
    db.collection('lessons')
      .find({ courseId: storedCourseId }, outline ? { projection: OUTLINE_LESSON_PROJECTION } : undefined)
      .sort({ order: 1 })
      .toArray(),
  ]);
  if (!canSeeCourse(member, course, { activeEnrollment: isActiveEnrollment(enrollmentRow) })) {
    return { ok: false, status: 404, error: 'Course not found' };
  }
  const sorted = sortLessonsByOrder(lessons);
  const entitlement = await loadCourseEntitlement(db, member, storedCourseId, sorted.map((lesson) => String(lesson._id)));
  const views = presentCourseLessons({
    member,
    course: courseRecordFor(course),
    enrollmentRow,
    lessons: sorted,
    pricing: priceCourseLessons(sorted, entitlement, env, { explicitPreview: course.freePreviewExplicit === true }),
  });
  return { ok: true, status: 200, lessons: views };
}

/** Lesson fields priceCourseLessons and sortLessonsByOrder read. */
const SIBLING_PRICING_PROJECTION = Object.freeze({ _id: 1, order: 1, isFirstLesson: 1, isFreePreview: 1, isDemo: 1 });

/** Exact copy for 403 responses from the student paywall; matches lib/lesson-monetization.ts. */
const LESSON_LOCKED_MESSAGE = 'Lesson locked. Please pay to unlock.';

function lockedLessonBody(lesson, monetization) {
  return {
    access: false,
    locked: true,
    message: LESSON_LOCKED_MESSAGE,
    monetization,
    lessonMeta: {
      _id: String(lesson._id),
      courseId: String(lesson.courseId),
      title: typeof lesson.title === 'string' && lesson.title.trim() ? lesson.title : 'Lesson',
    },
  };
}

/**
 * GET /api/lessons/:id. The lesson read rule runs first (enrollment, instructor, or admin), then
 * the paywall for students. Teaching content and the quiz are returned only after both pass.
 * Returns `{ status, body }`; the route applies the visual-aid field strip.
 */
async function readLessonDetail(db, { userId, lessonId, env }) {
  if (!isStoredId(lessonId)) return { status: 400, body: { error: 'Invalid lesson ID' } };
  const record = await db.collection('users').findOne({ _id: new ObjectId(userId) }, { projection: { email: 1, role: 1, status: 1 } });
  const account = decideAccountAccess({ userId, record });
  const lesson = await db.collection('lessons').findOne({ _id: new ObjectId(lessonId) });
  let course = null;
  if (lesson && lesson.courseId != null && isStoredId(String(lesson.courseId))) {
    course = await db.collection('courses').findOne({ _id: new ObjectId(String(lesson.courseId)) }, { projection: LESSON_LIST_COURSE_PROJECTION });
  }
  const courseId = course ? String(course._id) : '';
  const enrollment = account.ok && course
    ? await db.collection('progress').findOne({ userId: account.user.userId, $or: [{ courseId }, { courseId: course._id }] })
    : null;
  const member = account.ok ? { userId: account.user.userId, role: account.user.role, email: account.user.email } : null;
  const lessonRecord = lesson
    ? { _id: lesson._id, courseId: lesson.courseId, requiredLevel: typeof lesson.requiredLevel === 'string' ? lesson.requiredLevel : null }
    : null;
  const courseRecord = course ? courseRecordFor(course) : null;
  const enrollmentRecord = enrollmentDecisionRecord(enrollment);
  const decision = decideLessonRead({ member, lesson: lessonRecord, course: courseRecord, enrollment: enrollmentRecord });
  if (!decision.ok) return { status: decision.status, body: { error: decision.error } };

  let monetization = null;
  let freePreview = false;
  if (lesson && account.ok) {
    // Pricing reads only these fields; the sibling lesson bodies are not needed to price one lesson.
    const siblings = sortLessonsByOrder(
      await db.collection('lessons').find({ courseId: lesson.courseId }, { projection: SIBLING_PRICING_PROJECTION }).toArray()
    );
    const lessonIdStr = String(lesson._id);
    const entitlement = await loadCourseEntitlement(db, member, String(lesson.courseId), [lessonIdStr]);
    const price = priceCourseLessons(siblings, entitlement, env, { explicitPreview: Boolean(course && course.freePreviewExplicit === true) }).get(lessonIdStr);
    if (!price) return { status: 403, body: lockedLessonBody(lesson, null) };
    if (price.locked) return { status: 403, body: lockedLessonBody(lesson, price.monetization) };
    monetization = price.monetization;
    freePreview = price.isFreePreview === true;
  }

  const quiz = await db.collection('quizzes').findOne({ lessonId: decision.lessonId }, { projection: { questions: 1 } });
  const quizDecision = decideQuizRead({
    member,
    lesson: lessonRecord,
    course: courseRecord,
    enrollment: enrollmentRecord,
    quiz: quiz ? { questions: quiz.questions } : null,
  });
  const view = presentLessonRead(lesson, true, courseId);
  if (lesson.summary && !view.lessonSummary) {
    view.lessonSummary = { overview: lesson.summary, updatedAt: lesson.updatedAt || lesson.createdAt || new Date() };
  }
  if (quizDecision.ok) {
    view.quiz = { lessonId: quizDecision.lessonId, courseId: quizDecision.courseId, questions: quizDecision.questions };
  }
  view.completed = Boolean(
    enrollment && Array.isArray(enrollment.completedLessons) && enrollment.completedLessons.map(String).includes(decision.lessonId)
  );
  if (monetization) {
    view.access = true;
    view.locked = false;
    view.monetization = monetization;
    view.isFirstLesson = lesson.isFirstLesson === true;
    view.isFreePreview = freePreview;
    view.isDemo = lesson.isDemo === true;
  }
  return { status: 200, body: view };
}

module.exports = {
  LESSON_LIST_COURSE_PROJECTION,
  LESSON_LOCKED_MESSAGE,
  OUTLINE_LESSON_PROJECTION,
  isFreePreviewSlot,
  WITHHELD_LESSON_FIELDS,
  isStaffRole,
  listCourseLessons,
  readLessonDetail,
  loadCourseEntitlement,
  presentCourseLessons,
  priceCourseLessons,
  sortLessonsByOrder,
  withholdLockedContent,
};
