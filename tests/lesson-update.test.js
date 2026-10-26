/**
 * Lesson and course edit decisions. No database connection.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  decideAccountAccess,
  decideLessonUpdate,
  decideLessonCreate,
  decideCourseUpdate,
  isStoredId,
} = require('../lib/account-access');

const LESSON_ID = '507f1f77bcf86cd799439011';
const COURSE_ID = '507f1f77bcf86cd799439012';
const OTHER_COURSE_ID = '507f1f77bcf86cd799439013';
const INSTRUCTOR_ID = '507f1f77bcf86cd799439014';

function lesson() {
  return { _id: LESSON_ID, courseId: COURSE_ID };
}

function course(instructorId, id = COURSE_ID) {
  return { _id: id, instructorId };
}

function hostilePatch() {
  return {
    title: 'Price action',
    description: 'How candles form',
    content: '<p>Body</p>',
    order: 2,
    courseId: OTHER_COURSE_ID,
    instructorId: 'attacker',
    role: 'superadmin',
    userId: 'attacker',
    _id: OTHER_COURSE_ID,
    questions: [{ question: 'Q', options: ['a', 'b'], correctAnswer: 0 }],
    correctAnswer: 0,
    published: true,
    status: 'approved',
  };
}

test('the assigned instructor can edit lesson content without moving the lesson', () => {
  const decision = decideLessonUpdate({
    member: { userId: INSTRUCTOR_ID, role: 'instructor' },
    lesson: lesson(),
    course: course(INSTRUCTOR_ID),
    patch: hostilePatch(),
  });
  assert.equal(decision.ok, true);
  if (!decision.ok) return;
  assert.equal(decision.lessonId, LESSON_ID);
  assert.equal(decision.courseId, COURSE_ID);
  assert.equal(decision.patch.title, 'Price action');
  assert.equal(decision.patch.content, '<p>Body</p>');
  assert.equal(decision.patch.lessonSummary.overview, '<p>Body</p>');
  for (const key of ['courseId', 'instructorId', 'role', 'userId', '_id', 'questions', 'correctAnswer', 'published', 'status']) {
    assert.equal(Object.prototype.hasOwnProperty.call(decision.patch, key), false);
  }
});

test('an unassigned instructor and a student cannot edit the lesson', () => {
  const instructor = decideLessonUpdate({
    member: { userId: 'other-instructor', role: 'instructor' },
    lesson: lesson(),
    course: course(INSTRUCTOR_ID),
    patch: hostilePatch(),
  });
  const student = decideLessonUpdate({
    member: { userId: 'student-1', role: 'student' },
    lesson: lesson(),
    course: course(INSTRUCTOR_ID),
    patch: hostilePatch(),
  });
  assert.equal(instructor.ok, false);
  assert.equal(student.ok, false);
  if (!instructor.ok) assert.equal(instructor.status, 403);
  if (!student.ok) assert.equal(student.status, 403);
  assert.equal(Object.prototype.hasOwnProperty.call(instructor, 'patch'), false);
});

test('admins and superadmins can edit a lesson they do not teach', () => {
  for (const role of ['admin', 'superadmin']) {
    const decision = decideLessonUpdate({
      member: { userId: `${role}-1`, role },
      lesson: lesson(),
      course: course(INSTRUCTOR_ID),
      patch: { title: 'Reviewed' },
    });
    assert.equal(decision.ok, true);
    if (decision.ok) assert.equal(decision.courseId, COURSE_ID);
  }
});

test('a swapped course record, a missing lesson, and a lookup failure do not update', () => {
  const swapped = decideLessonUpdate({
    member: { userId: INSTRUCTOR_ID, role: 'instructor' },
    lesson: lesson(),
    course: course(INSTRUCTOR_ID, OTHER_COURSE_ID),
    patch: hostilePatch(),
  });
  const missing = decideLessonUpdate({
    member: { userId: INSTRUCTOR_ID, role: 'instructor' },
    lesson: null,
    course: course(INSTRUCTOR_ID),
    patch: hostilePatch(),
  });
  const failed = decideLessonUpdate({
    member: { userId: INSTRUCTOR_ID, role: 'instructor' },
    lesson: lesson(),
    course: course(INSTRUCTOR_ID),
    patch: hostilePatch(),
    lookupError: true,
  });
  const inactive = decideAccountAccess({
    userId: INSTRUCTOR_ID,
    record: { role: 'instructor', status: 'suspended', email: 'instructor@example.com' },
  });
  const revoked = decideLessonUpdate({
    member: inactive.ok ? inactive.user : null,
    lesson: lesson(),
    course: course(INSTRUCTOR_ID),
    patch: hostilePatch(),
  });
  assert.equal(swapped.ok, false);
  assert.equal(missing.ok, false);
  assert.equal(failed.ok, false);
  assert.equal(revoked.ok, false);
  if (!swapped.ok) assert.equal(swapped.status, 404);
  if (!missing.ok) assert.equal(missing.status, 404);
  if (!failed.ok) assert.equal(failed.status, 500);
  if (!revoked.ok) assert.equal(revoked.status, 403);
});

test('invalid ids are rejected before a stored record is trusted', () => {
  assert.equal(isStoredId(LESSON_ID), true);
  assert.equal(isStoredId('not-an-id'), false);
  assert.equal(isStoredId(''), false);
  assert.equal(isStoredId(LESSON_ID + 'ff'), false);
  assert.equal(isStoredId(null), false);
});

test('creating a lesson keeps the stored course and drops privileged fields', () => {
  const assigned = decideLessonCreate({
    member: { userId: INSTRUCTOR_ID, role: 'instructor' },
    course: course(INSTRUCTOR_ID),
    body: hostilePatch(),
  });
  const outsider = decideLessonCreate({
    member: { userId: 'other-instructor', role: 'instructor' },
    course: course(INSTRUCTOR_ID),
    body: hostilePatch(),
  });
  const untitled = decideLessonCreate({
    member: { userId: INSTRUCTOR_ID, role: 'instructor' },
    course: course(INSTRUCTOR_ID),
    body: { description: 'No title' },
  });
  assert.equal(assigned.ok, true);
  assert.equal(outsider.ok, false);
  assert.equal(untitled.ok, false);
  if (assigned.ok) {
    assert.equal(assigned.document.courseId, COURSE_ID);
    assert.equal(assigned.document.title, 'Price action');
    assert.equal(Object.prototype.hasOwnProperty.call(assigned.document, 'instructorId'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(assigned.document, 'questions'), false);
  }
  if (!outsider.ok) assert.equal(outsider.status, 403);
  if (!untitled.ok) assert.equal(untitled.status, 400);
});

test('an instructor cannot take over another course while saving it', () => {
  const outsider = decideCourseUpdate({
    member: { userId: 'other-instructor', role: 'instructor' },
    course: course(INSTRUCTOR_ID),
    patch: { title: 'Taken', instructorId: 'other-instructor', role: 'admin' },
  });
  const owner = decideCourseUpdate({
    member: { userId: INSTRUCTOR_ID, role: 'instructor' },
    course: course(INSTRUCTOR_ID),
    patch: { title: 'Kept', description: 'Notes', instructorId: 'other-instructor', role: 'admin' },
  });
  const admin = decideCourseUpdate({
    member: { userId: 'admin-1', role: 'admin' },
    course: course(INSTRUCTOR_ID),
    patch: { title: 'Reassigned', instructorId: 'admin-1', role: 'admin' },
  });
  assert.equal(outsider.ok, false);
  assert.equal(owner.ok, true);
  assert.equal(admin.ok, true);
  if (owner.ok) {
    assert.equal(owner.patch.title, 'Kept');
    assert.equal(Object.prototype.hasOwnProperty.call(owner.patch, 'instructorId'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(owner.patch, 'role'), false);
  }
  if (admin.ok) assert.equal(admin.patch.instructorId, 'admin-1');
  if (!outsider.ok) assert.equal(outsider.status, 403);
});

test('lesson and course editors do not copy the request body', () => {
  const root = path.join(__dirname, '..');
  const lessonRoute = fs.readFileSync(path.join(root, 'pages', 'api', 'lessons', '[id].ts'), 'utf8');
  const createRoute = fs.readFileSync(path.join(root, 'pages', 'api', 'lessons', 'index.ts'), 'utf8');
  const summaryRoute = fs.readFileSync(path.join(root, 'pages', 'api', 'lessons', '[id]', 'summary.ts'), 'utf8');
  const courseRoute = fs.readFileSync(path.join(root, 'pages', 'api', 'courses', '[id].ts'), 'utf8');
  assert.equal(lessonRoute.includes('decideLessonUpdate'), true);
  assert.equal(lessonRoute.includes('isStoredId'), true);
  assert.equal(lessonRoute.includes('...req.body'), false);
  assert.equal(createRoute.includes('decideLessonCreate'), true);
  assert.equal(createRoute.includes('...req.body'), false);
  assert.equal(summaryRoute.includes('decideLessonUpdate'), true);
  assert.equal(summaryRoute.includes('error.message'), false);
  assert.equal(courseRoute.includes('decideCourseUpdate'), true);
  assert.equal(courseRoute.includes('...req.body'), false);
});
