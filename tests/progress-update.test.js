/**
 * Socket progress decisions. No database connection.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { decideAccountAccess, decideProgressUpdate } = require('../lib/account-access');

const LESSON_ID = '507f1f77bcf86cd799439011';
const COURSE_ID = '507f1f77bcf86cd799439012';
const OTHER_COURSE_ID = '507f1f77bcf86cd799439013';
const STUDENT_ID = '507f1f77bcf86cd799439014';

function student() {
  return { userId: STUDENT_ID, role: 'student' };
}

test('an enrolled student can update progress for the stored lesson', () => {
  const decision = decideProgressUpdate({
    member: student(),
    course: { _id: COURSE_ID },
    lesson: { _id: LESSON_ID, courseId: COURSE_ID },
    enrollment: { userId: STUDENT_ID, courseId: COURSE_ID, progress: 0 },
  });
  assert.equal(decision.ok, true);
  if (decision.ok) {
    assert.equal(decision.userId, STUDENT_ID);
    assert.equal(decision.courseId, COURSE_ID);
    assert.equal(decision.lessonId, LESSON_ID);
  }
});

test('a student cannot update another enrollment or an arbitrary course', () => {
  const otherStudent = decideProgressUpdate({
    member: student(),
    course: { _id: COURSE_ID },
    lesson: { _id: LESSON_ID, courseId: COURSE_ID },
    enrollment: { userId: 'other-student', courseId: COURSE_ID, progress: 0 },
  });
  const otherCourse = decideProgressUpdate({
    member: student(),
    course: { _id: COURSE_ID },
    lesson: { _id: LESSON_ID, courseId: OTHER_COURSE_ID },
    enrollment: { userId: STUDENT_ID, courseId: COURSE_ID, progress: 0 },
  });
  const missingEnrollment = decideProgressUpdate({
    member: student(),
    course: { _id: COURSE_ID },
    lesson: { _id: LESSON_ID, courseId: COURSE_ID },
    enrollment: null,
  });
  assert.equal(otherStudent.ok, false);
  assert.equal(otherCourse.ok, false);
  if (!otherCourse.ok) assert.equal(otherCourse.status, 403);
  assert.equal(missingEnrollment.ok, false);
  assert.equal(Object.prototype.hasOwnProperty.call(missingEnrollment, 'courseId'), false);
});

test('missing records, inactive accounts, and lookup failures do not update progress', () => {
  const missing = decideProgressUpdate({
    member: student(),
    course: null,
    lesson: { _id: LESSON_ID, courseId: COURSE_ID },
    enrollment: { userId: STUDENT_ID, courseId: COURSE_ID },
  });
  const inactive = decideAccountAccess({
    userId: STUDENT_ID,
    record: { role: 'student', status: 'inactive', email: 'student@example.com' },
  });
  const revoked = decideProgressUpdate({
    member: inactive.ok ? inactive.user : null,
    course: { _id: COURSE_ID },
    lesson: { _id: LESSON_ID, courseId: COURSE_ID },
    enrollment: { userId: STUDENT_ID, courseId: COURSE_ID },
  });
  const failed = decideProgressUpdate({
    member: student(),
    course: { _id: COURSE_ID },
    lesson: { _id: LESSON_ID, courseId: COURSE_ID },
    enrollment: { userId: STUDENT_ID, courseId: COURSE_ID },
    lookupError: true,
  });
  assert.equal(missing.ok, false);
  assert.equal(revoked.ok, false);
  assert.equal(failed.ok, false);
  assert.equal(failed.error, 'Internal server error');
  if (!failed.ok) assert.equal(failed.status, 500);
  assert.equal(JSON.stringify(failed).includes('internal-database-host'), false);
});

test('the live progress handler does not create an enrollment or log the raw error', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const start = source.indexOf("socket.on('progressUpdate'");
  const end = source.indexOf("socket.on('lessonUpdated'");
  const handler = source.slice(start, end);
  assert.equal(handler.includes('decideProgressUpdate'), true);
  assert.equal(handler.includes('decideAccountAccess'), true);
  assert.equal(handler.includes('insertOne'), false);
  assert.equal(handler.includes('courseId: data.courseId'), false);
  assert.equal(handler.includes('userId: decision.userId'), true);
  assert.equal(handler.includes('Progress update error:'), false);
  assert.equal(handler.includes('decision.userId'), true);
  assert.equal(handler.includes('decision.courseId'), true);
  assert.equal(source.includes('dropUnauthorizedLessonMembers'), true);
  const chatStart = source.indexOf("socket.on('chatMessage'");
  const chat = source.slice(chatStart, start);
  assert.equal(chat.indexOf('dropUnauthorizedLessonMembers') < chat.indexOf(".emit('chatMessage'"), true);
  assert.equal(source.includes('initializeSocket'), false);
  assert.equal(source.includes('server/socket'), false);
  const packageJson = fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8');
  assert.equal(packageJson.includes('"dev": "node server.js"'), true);
  assert.equal(packageJson.includes('server/socket'), false);
  const http = fs.readFileSync(path.join(__dirname, '..', 'pages', 'api', 'progress', 'index.ts'), 'utf8');
  const httpStart = http.indexOf('async function updateProgress');
  const httpHandler = http.slice(httpStart);
  assert.equal(httpHandler.includes('decideProgressUpdate'), true);
  assert.equal(httpHandler.includes('insertOne'), false);
  assert.equal(httpHandler.includes('Update progress error:'), false);
});
