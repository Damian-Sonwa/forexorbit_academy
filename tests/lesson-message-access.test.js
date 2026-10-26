/**
 * HTTP lesson chat decisions. No database connection.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { decideAccountAccess, decideLessonMessageRead, decideLessonChat } = require('../lib/account-access');

const LESSON_ID = '507f1f77bcf86cd799439011';
const COURSE_ID = '507f1f77bcf86cd799439012';
const STUDENT_ID = '507f1f77bcf86cd799439013';
const INSTRUCTOR_ID = '507f1f77bcf86cd799439014';

function lesson() {
  return { _id: LESSON_ID, courseId: COURSE_ID };
}

function course() {
  return { _id: COURSE_ID, instructorId: INSTRUCTOR_ID, difficulty: 'beginner' };
}

function student() {
  return { userId: STUDENT_ID, role: 'student', email: 'student@example.com', name: 'Student' };
}

function enrollment(progress) {
  return { userId: STUDENT_ID, courseId: COURSE_ID, progress };
}

test('an enrolled student can read and post lesson chat', () => {
  const read = decideLessonMessageRead({
    member: student(),
    lesson: lesson(),
    course: course(),
    enrollment: enrollment(0),
  });
  const post = decideLessonChat({
    member: student(),
    lesson: lesson(),
    course: course(),
    enrollment: enrollment(0),
    text: ' hello ',
    userId: 'forged-user',
    senderName: 'Forged',
    role: 'admin',
  });
  assert.equal(read.ok, true);
  assert.equal(post.ok, true);
  if (read.ok) assert.equal(read.lessonId, LESSON_ID);
  if (post.ok) {
    assert.equal(post.sender.userId, STUDENT_ID);
    assert.equal(post.sender.senderName, 'Student');
    assert.equal(post.text, 'hello');
    assert.equal(post.lessonId, LESSON_ID);
  }
});

test('a non-enrolled student cannot read or post lesson chat', () => {
  const read = decideLessonMessageRead({
    member: student(),
    lesson: lesson(),
    course: course(),
    enrollment: null,
  });
  const post = decideLessonChat({
    member: student(),
    lesson: lesson(),
    course: course(),
    enrollment: null,
    text: 'secret',
  });
  assert.equal(read.ok, false);
  if (!read.ok) assert.equal(read.status, 403);
  assert.equal(post.ok, false);
  assert.equal(Object.prototype.hasOwnProperty.call(post, 'text'), false);
});

test('an assigned instructor and an administrator can read lesson chat', () => {
  const instructor = decideLessonMessageRead({
    member: { userId: INSTRUCTOR_ID, role: 'instructor', email: 'instructor@example.com' },
    lesson: lesson(),
    course: course(),
    enrollment: null,
  });
  const admin = decideLessonMessageRead({
    member: { userId: 'admin-1', role: 'admin', email: 'admin@example.com' },
    lesson: lesson(),
    course: course(),
    enrollment: null,
  });
  assert.equal(instructor.ok, true);
  assert.equal(admin.ok, true);
});

test('an unassigned instructor cannot read lesson chat', () => {
  const decision = decideLessonMessageRead({
    member: { userId: 'other-instructor', role: 'instructor', email: 'other@example.com' },
    lesson: lesson(),
    course: course(),
    enrollment: null,
  });
  assert.equal(decision.ok, false);
  if (!decision.ok) assert.equal(decision.status, 403);
});

test('a prerequisite-locked lesson denies chat', () => {
  const decision = decideLessonMessageRead({
    member: student(),
    lesson: { _id: LESSON_ID, courseId: COURSE_ID, requiredLevel: 'advanced' },
    course: course(),
    enrollment: enrollment(10),
  });
  assert.equal(decision.ok, false);
  if (!decision.ok) assert.equal(decision.status, 403);
});

test('missing records and lookup failures do not echo a database error', () => {
  const missing = decideLessonMessageRead({
    member: student(),
    lesson: null,
    course: course(),
    enrollment: enrollment(0),
  });
  const failed = decideLessonMessageRead({
    member: student(),
    lesson: lesson(),
    course: course(),
    enrollment: enrollment(0),
    lookupError: true,
  });
  const inactive = decideAccountAccess({
    userId: STUDENT_ID,
    record: { role: 'student', status: 'suspended', email: 'student@example.com' },
  });
  const revoked = decideLessonMessageRead({
    member: inactive.ok ? inactive.user : null,
    lesson: lesson(),
    course: course(),
    enrollment: enrollment(0),
  });
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.status, 404);
  assert.equal(failed.ok, false);
  if (!failed.ok) {
    assert.equal(failed.status, 500);
    assert.equal(failed.error, 'Internal server error');
    assert.equal(failed.error.includes('internal-database-host'), false);
  }
  assert.equal(revoked.ok, false);
});

test('the lesson messages route checks read and write and does not log raw errors', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'pages', 'api', 'messages', 'index.ts'), 'utf8');
  assert.equal(source.includes('decideLessonMessageRead'), true);
  assert.equal(source.includes('decideLessonChat'), true);
  assert.equal(source.includes('withAuth(handler)'), true);
  assert.equal(source.includes('req.body.userId'), false);
  assert.equal(source.includes('req.body.senderName'), false);
  assert.equal(source.includes('Get messages error:'), false);
  assert.equal(source.includes('Send message error:'), false);
  assert.equal(source.includes('unexpectedBody'), true);
  assert.equal(source.includes('error.message'), false);
});
