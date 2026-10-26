/**
 * Quiz mutation decisions. No database connection.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { decideAccountAccess, decideQuizMutation } = require('../lib/account-access');

const LESSON_ID = '507f1f77bcf86cd799439011';
const COURSE_ID = '507f1f77bcf86cd799439012';
const INSTRUCTOR_ID = '507f1f77bcf86cd799439014';

function lesson() {
  return { _id: LESSON_ID, courseId: COURSE_ID };
}

function course(instructorId) {
  return { _id: COURSE_ID, instructorId };
}

function questions() {
  return [{ question: 'What is a pip?', options: ['A', 'B', 'C', 'D'], correctAnswer: 1, courseId: 'client-course' }];
}

test('an assigned instructor can save a quiz on the stored course', () => {
  const decision = decideQuizMutation({
    member: { userId: INSTRUCTOR_ID, role: 'instructor' },
    lesson: lesson(),
    course: course(INSTRUCTOR_ID),
    questions: questions(),
  });
  assert.equal(decision.ok, true);
  if (decision.ok) {
    assert.equal(decision.courseId, COURSE_ID);
    assert.notEqual(decision.courseId, 'client-course');
    assert.equal(decision.lessonId, LESSON_ID);
    assert.equal(Object.prototype.hasOwnProperty.call(decision.questions[0], 'courseId'), false);
    assert.equal(decision.questions[0].correctAnswer, 1);
  }
});

test('admins and superadmins can save a quiz for any course', () => {
  for (const role of ['admin', 'superadmin']) {
    const decision = decideQuizMutation({
      member: { userId: 'staff-1', role },
      lesson: lesson(),
      course: course(INSTRUCTOR_ID),
      questions: questions(),
    });
    assert.equal(decision.ok, true);
    if (decision.ok) assert.equal(decision.courseId, COURSE_ID);
  }
});

test('an unassigned instructor and a student cannot save a quiz', () => {
  const instructor = decideQuizMutation({
    member: { userId: 'other-instructor', role: 'instructor' },
    lesson: lesson(),
    course: course(INSTRUCTOR_ID),
    questions: questions(),
  });
  const student = decideQuizMutation({
    member: { userId: 'student-1', role: 'student' },
    lesson: lesson(),
    course: course(INSTRUCTOR_ID),
    questions: questions(),
  });
  assert.equal(instructor.ok, false);
  assert.equal(student.ok, false);
  if (!instructor.ok) assert.equal(instructor.status, 403);
  if (!student.ok) assert.equal(student.status, 403);
});

test('missing records, invalid questions, and lookup failures are denied', () => {
  const missing = decideQuizMutation({
    member: { userId: INSTRUCTOR_ID, role: 'instructor' },
    lesson: null,
    course: course(INSTRUCTOR_ID),
    questions: questions(),
  });
  const invalid = decideQuizMutation({
    member: { userId: INSTRUCTOR_ID, role: 'instructor' },
    lesson: lesson(),
    course: course(INSTRUCTOR_ID),
    questions: [{ question: 'Bad', options: ['only-one'], correctAnswer: 0 }],
  });
  const failed = decideQuizMutation({
    member: { userId: INSTRUCTOR_ID, role: 'instructor' },
    lesson: lesson(),
    course: course(INSTRUCTOR_ID),
    questions: questions(),
    lookupError: true,
  });
  const inactive = decideAccountAccess({
    userId: INSTRUCTOR_ID,
    record: { role: 'instructor', status: 'deactivated', email: 'instructor@example.com' },
  });
  const revoked = decideQuizMutation({
    member: inactive.ok ? inactive.user : null,
    lesson: lesson(),
    course: course(INSTRUCTOR_ID),
    questions: questions(),
  });
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.status, 404);
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.equal(invalid.status, 400);
  assert.equal(failed.ok, false);
  if (!failed.ok) {
    assert.equal(failed.status, 500);
    assert.equal(failed.error, 'Internal server error');
    assert.equal(JSON.stringify(failed).includes('Mongo'), false);
  }
  assert.equal(revoked.ok, false);
});

test('the quiz update route uses the stored course and does not log raw errors', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'pages', 'api', 'quizzes', '[lessonId].ts'), 'utf8');
  const start = source.indexOf('async function createQuiz');
  const end = source.indexOf('async function handler');
  const update = source.slice(start, end);
  assert.equal(update.includes('decideQuizMutation'), true);
  assert.equal(update.includes('decideAccountAccess'), true);
  assert.equal(update.includes('courseId: decision.courseId'), true);
  assert.equal(update.includes('req.body.courseId'), false);
  assert.equal(update.includes('Create quiz error:'), false);
  assert.equal(source.includes('withAuth(handler)'), true);
  const lessonDelete = fs.readFileSync(path.join(__dirname, '..', 'pages', 'api', 'lessons', '[id].ts'), 'utf8');
  assert.equal(lessonDelete.includes('decideLessonDelete'), true);
});
