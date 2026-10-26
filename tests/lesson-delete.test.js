/**
 * Lesson deletion decisions. No database connection.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { decideAccountAccess, decideLessonDelete } = require('../lib/account-access');

const LESSON_ID = '507f1f77bcf86cd799439011';
const COURSE_ID = '507f1f77bcf86cd799439012';
const INSTRUCTOR_ID = '507f1f77bcf86cd799439014';

function lesson() {
  return { _id: LESSON_ID, courseId: COURSE_ID };
}

function course(instructorId) {
  return { _id: COURSE_ID, instructorId };
}

test('an assigned instructor can delete the stored lesson', () => {
  const decision = decideLessonDelete({
    member: { userId: INSTRUCTOR_ID, role: 'instructor' },
    lesson: lesson(),
    course: course(INSTRUCTOR_ID),
  });
  assert.equal(decision.ok, true);
  if (decision.ok) assert.equal(decision.lessonId, LESSON_ID);
});

test('an administrator can delete a lesson without being the instructor', () => {
  const decision = decideLessonDelete({
    member: { userId: 'admin-1', role: 'admin' },
    lesson: lesson(),
    course: course(INSTRUCTOR_ID),
  });
  assert.equal(decision.ok, true);
});

test('an unassigned instructor and a student cannot delete a lesson', () => {
  const instructor = decideLessonDelete({
    member: { userId: 'other-instructor', role: 'instructor' },
    lesson: lesson(),
    course: course(INSTRUCTOR_ID),
  });
  const student = decideLessonDelete({
    member: { userId: 'student-1', role: 'student' },
    lesson: lesson(),
    course: course(INSTRUCTOR_ID),
  });
  assert.equal(instructor.ok, false);
  assert.equal(student.ok, false);
  if (!instructor.ok) assert.equal(instructor.status, 403);
  if (!student.ok) assert.equal(student.status, 403);
});

test('a missing lesson and a lookup failure do not delete anything', () => {
  const missing = decideLessonDelete({
    member: { userId: INSTRUCTOR_ID, role: 'instructor' },
    lesson: null,
    course: course(INSTRUCTOR_ID),
  });
  const failed = decideLessonDelete({
    member: { userId: INSTRUCTOR_ID, role: 'instructor' },
    lesson: lesson(),
    course: course(INSTRUCTOR_ID),
    lookupError: true,
  });
  const inactive = decideAccountAccess({
    userId: INSTRUCTOR_ID,
    record: { role: 'instructor', status: 'deactivated', email: 'instructor@example.com' },
  });
  const revoked = decideLessonDelete({
    member: inactive.ok ? inactive.user : null,
    lesson: lesson(),
    course: course(INSTRUCTOR_ID),
  });
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.status, 404);
  assert.equal(failed.ok, false);
  if (!failed.ok) {
    assert.equal(failed.status, 500);
    assert.equal(failed.error, 'Internal server error');
    assert.equal(JSON.stringify(failed).includes('internal-database-host'), false);
  }
  assert.equal(revoked.ok, false);
});

test('the delete route removes only the stored lesson and its quiz', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'pages', 'api', 'lessons', '[id].ts'), 'utf8');
  const start = source.indexOf('async function deleteLesson');
  const end = source.indexOf('async function handler');
  const handler = source.slice(start, end);
  assert.equal(handler.includes('decideLessonDelete'), true);
  assert.equal(handler.includes('decideAccountAccess'), true);
  assert.equal(handler.includes('deleteOne({ _id: new ObjectId(decision.lessonId) })'), true);
  assert.equal(handler.includes('deleteOne({ lessonId: decision.lessonId })'), true);
  assert.equal(handler.includes('progress.delete'), false);
  assert.equal(handler.includes('messages.delete'), false);
  assert.equal(handler.includes('Delete lesson error:'), false);
});
