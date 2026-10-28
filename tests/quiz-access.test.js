/**
 * Quiz read and submit decisions. No database connection.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { decideAccountAccess, decideQuizRead, decideQuizSubmit } = require('../lib/account-access');

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
  return { userId: STUDENT_ID, role: 'student', email: 'student@example.com' };
}

function enrollment() {
  return { userId: STUDENT_ID, courseId: COURSE_ID, progress: 0 };
}

function quiz() {
  return {
    questions: [
      { question: 'One', options: ['A', 'B'], correctAnswer: 1 },
      { question: 'Two', options: ['C', 'D'], correctAnswer: 0 },
    ],
  };
}

test('an enrolled student can read a quiz without the answer key', () => {
  const decision = decideQuizRead({
    member: student(),
    lesson: lesson(),
    course: course(),
    enrollment: enrollment(),
    quiz: quiz(),
  });
  assert.equal(decision.ok, true);
  if (decision.ok) {
    assert.equal(decision.revealAnswers, false);
    assert.equal(Object.prototype.hasOwnProperty.call(decision.questions[0], 'correctAnswer'), false);
    assert.equal(decision.questions[0].question, 'One');
  }
});

test('a non-enrolled student cannot read or submit a quiz', () => {
  const read = decideQuizRead({
    member: student(),
    lesson: lesson(),
    course: course(),
    enrollment: null,
    quiz: quiz(),
  });
  const submit = decideQuizSubmit({
    member: student(),
    lesson: lesson(),
    course: course(),
    enrollment: null,
    quiz: quiz(),
    answers: [1, 0],
  });
  assert.equal(read.ok, false);
  assert.equal(submit.ok, false);
  if (!read.ok) assert.equal(read.status, 403);
  assert.equal(Object.prototype.hasOwnProperty.call(read, 'questions'), false);
});

test('an assigned instructor and an administrator receive the answer key', () => {
  const instructor = decideQuizRead({
    member: { userId: INSTRUCTOR_ID, role: 'instructor', email: 'instructor@example.com' },
    lesson: lesson(),
    course: course(),
    enrollment: null,
    quiz: quiz(),
  });
  const admin = decideQuizRead({
    member: { userId: 'admin-1', role: 'superadmin', email: 'admin@example.com' },
    lesson: lesson(),
    course: course(),
    enrollment: null,
    quiz: quiz(),
  });
  assert.equal(instructor.ok, true);
  assert.equal(admin.ok, true);
  if (instructor.ok) assert.equal(instructor.questions[0].correctAnswer, 1);
});

test('an unassigned instructor cannot read a quiz', () => {
  const decision = decideQuizRead({
    member: { userId: 'other-instructor', role: 'instructor', email: 'other@example.com' },
    lesson: lesson(),
    course: course(),
    enrollment: null,
    quiz: quiz(),
  });
  assert.equal(decision.ok, false);
  if (!decision.ok) assert.equal(decision.status, 403);
});

test('a submission is graded from the stored key and ignores a forged score or user', () => {
  const decision = decideQuizSubmit({
    member: student(),
    lesson: lesson(),
    course: course(),
    enrollment: enrollment(),
    quiz: quiz(),
    answers: [1, 1],
    userId: 'forged-user',
    score: 100,
  });
  assert.equal(decision.ok, true);
  if (decision.ok) {
    assert.equal(decision.userId, STUDENT_ID);
    assert.equal(decision.score, 50);
    assert.equal(decision.correct, 1);
    assert.equal(decision.courseId, COURSE_ID);
  }
});

test('invalid answers, missing records, inactive accounts, and lookup failures are denied', () => {
  const invalid = decideQuizSubmit({
    member: student(),
    lesson: lesson(),
    course: course(),
    enrollment: enrollment(),
    quiz: quiz(),
    answers: '1,0',
  });
  const missing = decideQuizRead({
    member: student(),
    lesson: null,
    course: course(),
    enrollment: enrollment(),
    quiz: quiz(),
  });
  const inactive = decideAccountAccess({
    userId: STUDENT_ID,
    record: { role: 'student', status: 'suspended', email: 'student@example.com' },
  });
  const revoked = decideQuizRead({
    member: inactive.ok ? inactive.user : null,
    lesson: lesson(),
    course: course(),
    enrollment: enrollment(),
    quiz: quiz(),
  });
  const failed = decideQuizSubmit({
    member: student(),
    lesson: lesson(),
    course: course(),
    enrollment: enrollment(),
    quiz: quiz(),
    answers: [1, 0],
    lookupError: true,
  });
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.equal(invalid.status, 400);
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.status, 404);
  assert.equal(revoked.ok, false);
  assert.equal(failed.ok, false);
  if (!failed.ok) {
    assert.equal(failed.status, 500);
    assert.equal(failed.error, 'Internal server error');
    assert.equal(JSON.stringify(failed).includes('Mongo'), false);
  }
});

test('the quiz routes grade on the server and the lesson payload does not copy the raw quiz', () => {
  const quizRoute = fs.readFileSync(path.join(__dirname, '..', 'pages', 'api', 'quizzes', '[lessonId].ts'), 'utf8');
  assert.equal(quizRoute.includes('decideQuizRead'), true);
  assert.equal(quizRoute.includes('decideQuizSubmit'), true);
  assert.equal(quizRoute.includes('req.body.userId'), false);
  assert.equal(quizRoute.includes('req.body.score'), false);
  assert.equal(quizRoute.includes('Get quiz error:'), false);
  assert.equal(quizRoute.includes('Submit quiz error:'), false);
  const lessonRoute = fs.readFileSync(path.join(__dirname, '..', 'pages', 'api', 'lessons', '[id].ts'), 'utf8')
    + fs.readFileSync(path.join(__dirname, '..', 'lib', 'course-lesson-list.js'), 'utf8');
  assert.equal(lessonRoute.includes('readLessonDetail'), true);
  assert.equal(lessonRoute.includes('decideQuizRead'), true);
  assert.equal(lessonRoute.includes('lesson.quiz = quiz;'), false);
});
