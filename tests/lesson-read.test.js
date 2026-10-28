/**
 * Lesson read authorization. No database connection.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  decideAccountAccess,
  decideLessonRead,
  decideLessonCatalog,
  presentLessonRead,
  isStoredId,
} = require('../lib/account-access');

const LESSON_ID = '507f1f77bcf86cd799439011';
const COURSE_ID = '507f1f77bcf86cd799439012';
const INSTRUCTOR_ID = '507f1f77bcf86cd799439014';
const STUDENT_ID = '507f1f77bcf86cd799439015';

function lesson(overrides = {}) {
  return { _id: LESSON_ID, courseId: COURSE_ID, requiredLevel: null, ...overrides };
}

function course(instructorId = INSTRUCTOR_ID) {
  return { _id: COURSE_ID, instructorId, difficulty: 'beginner' };
}

function enrollment(progress = 0, userId = STUDENT_ID) {
  return { userId, courseId: COURSE_ID, progress };
}

function storedLesson() {
  return {
    _id: LESSON_ID,
    courseId: 'client-course',
    title: 'Candles',
    description: 'Short outline',
    summary: 'Outline',
    type: 'video',
    order: 1,
    content: '<p>Full lesson</p>',
    videoUrl: 'https://videos.example/lesson',
    pdfUrl: 'https://files.example/lesson.pdf',
    resources: [{ type: 'link', url: 'https://files.example/notes', title: 'Notes' }],
    lessonSummary: { overview: '<p>Full lesson</p>' },
    quiz: { questions: [{ correctAnswer: 1 }] },
    correctAnswer: 1,
  };
}

test('an enrolled student can read a lesson and a non-enrolled student cannot', () => {
  const enrolled = decideLessonRead({
    member: { userId: STUDENT_ID, role: 'student' },
    lesson: lesson(),
    course: course(),
    enrollment: enrollment(),
  });
  const outsider = decideLessonRead({
    member: { userId: 'other-student', role: 'student' },
    lesson: lesson(),
    course: course(),
    enrollment: enrollment(),
  });
  const catalog = decideLessonCatalog({
    member: { userId: 'other-student', role: 'student' },
    course: course(),
    enrollment: null,
  });
  assert.equal(enrolled.ok, true);
  assert.equal(outsider.ok, false);
  assert.equal(catalog.ok, false);
  if (!outsider.ok) assert.equal(outsider.status, 403);
  if (!catalog.ok) assert.equal(catalog.status, 403);
});

test('a locked prerequisite lesson stays closed for an enrolled student', () => {
  const decision = decideLessonRead({
    member: { userId: STUDENT_ID, role: 'student' },
    lesson: lesson({ requiredLevel: 'advanced' }),
    course: course(),
    enrollment: enrollment(40),
  });
  const unlocked = decideLessonRead({
    member: { userId: STUDENT_ID, role: 'student' },
    lesson: lesson({ requiredLevel: 'advanced' }),
    course: course(),
    enrollment: enrollment(100),
  });
  assert.equal(decision.ok, false);
  assert.equal(unlocked.ok, true);
  if (!decision.ok) assert.equal(decision.status, 403);
});

test('the assigned instructor and administrators can read, and another instructor cannot', () => {
  const assigned = decideLessonRead({
    member: { userId: INSTRUCTOR_ID, role: 'instructor' },
    lesson: lesson(),
    course: course(),
    enrollment: null,
  });
  const other = decideLessonCatalog({
    member: { userId: 'other-instructor', role: 'instructor' },
    course: course(),
    enrollment: null,
  });
  for (const role of ['admin', 'superadmin']) {
    const decision = decideLessonRead({
      member: { userId: `${role}-1`, role },
      lesson: lesson(),
      course: course(),
      enrollment: null,
    });
    assert.equal(decision.ok, true);
  }
  assert.equal(assigned.ok, true);
  assert.equal(other.ok, false);
  if (!other.ok) assert.equal(other.status, 403);
});

test('invalid ids, missing lessons, and lookup failures expose no lesson body', () => {
  assert.equal(isStoredId('not-an-id'), false);
  assert.equal(isStoredId(LESSON_ID), true);
  const missing = decideLessonRead({
    member: { userId: STUDENT_ID, role: 'student' },
    lesson: null,
    course: course(),
    enrollment: enrollment(),
  });
  const failed = decideLessonRead({
    member: { userId: STUDENT_ID, role: 'student' },
    lesson: lesson(),
    course: course(),
    enrollment: enrollment(),
    lookupError: true,
  });
  const inactive = decideAccountAccess({
    userId: STUDENT_ID,
    record: { role: 'student', status: 'deactivated', email: 'student@example.com' },
  });
  const revoked = decideLessonRead({
    member: inactive.ok ? inactive.user : null,
    lesson: lesson(),
    course: course(),
    enrollment: enrollment(),
  });
  assert.equal(missing.ok, false);
  assert.equal(failed.ok, false);
  assert.equal(revoked.ok, false);
  if (!missing.ok) assert.equal(missing.status, 404);
  if (!failed.ok) assert.equal(failed.status, 500);
  if (!revoked.ok) assert.equal(revoked.status, 403);
});

test('protected lesson fields are removed until the read is allowed', () => {
  const hidden = presentLessonRead(storedLesson(), false, COURSE_ID);
  const visible = presentLessonRead(storedLesson(), true, COURSE_ID);
  assert.equal(hidden.title, 'Candles');
  assert.equal(hidden.courseId, COURSE_ID);
  assert.equal(hidden.locked, true);
  for (const key of ['content', 'videoUrl', 'pdfUrl', 'resources', 'lessonSummary', 'quiz', 'correctAnswer']) {
    assert.equal(Object.prototype.hasOwnProperty.call(hidden, key), false);
  }
  assert.equal(visible.content, '<p>Full lesson</p>');
  assert.equal(visible.videoUrl, 'https://videos.example/lesson');
  assert.equal(Object.prototype.hasOwnProperty.call(visible, 'quiz'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(visible, 'correctAnswer'), false);
});

test('lesson and course reads use the stored course and do not return raw errors', () => {
  const root = path.join(__dirname, '..');
  const lessonRoute = fs.readFileSync(path.join(root, 'pages', 'api', 'lessons', '[id].ts'), 'utf8');
  assert.equal(lessonRoute.includes('readLessonDetail(db'), true);
  const lesson = lessonRoute + fs.readFileSync(path.join(root, 'lib', 'course-lesson-list.js'), 'utf8');
  const list = fs.readFileSync(path.join(root, 'pages', 'api', 'lessons', 'index.ts'), 'utf8');
  const course = fs.readFileSync(path.join(root, 'pages', 'api', 'courses', '[id].ts'), 'utf8');
  assert.equal(lesson.includes('decideLessonRead'), true);
  assert.equal(lesson.includes('presentLessonRead'), true);
  assert.equal(list.includes('decideLessonCatalog'), true);
  assert.equal(list.includes('find({ courseId: catalog.courseId })'), true);
  assert.equal(course.includes('presentLessonRead'), true);
  assert.equal(lesson.includes('error.message'), false);
  assert.equal(list.includes('error.message'), false);
});
