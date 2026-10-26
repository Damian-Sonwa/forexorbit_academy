/**
 * Assignment ownership. No database connection.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  decideAssignmentRead,
  decideAssignmentCreate,
  decideAssignmentMutation,
  decideAssignmentSubmit,
  decideAssignmentGrade,
  presentAssignment,
} = require('../lib/account-access');

const COURSE_ID = '507f1f77bcf86cd799439011';
const LESSON_ID = '507f1f77bcf86cd799439012';
const ASSIGNMENT_ID = '507f1f77bcf86cd799439013';
const INSTRUCTOR_ID = '507f1f77bcf86cd799439014';
const STUDENT_ID = '507f1f77bcf86cd799439015';

function course(instructorId = INSTRUCTOR_ID) {
  return { _id: COURSE_ID, instructorId };
}

function enrollment(userId = STUDENT_ID) {
  return { userId, courseId: COURSE_ID, progress: 10 };
}

function assignment(courseId = COURSE_ID) {
  return { _id: ASSIGNMENT_ID, courseId, lessonId: LESSON_ID, points: 50, title: 'Journal' };
}

test('the assigned instructor can create on the stored course and another instructor cannot', () => {
  const assigned = decideAssignmentCreate({
    member: { userId: INSTRUCTOR_ID, role: 'instructor' },
    course: course(),
    lesson: { _id: LESSON_ID, courseId: COURSE_ID },
    body: { courseId: 'client-course', lessonId: LESSON_ID, title: 'Journal', instructions: 'Write', userId: 'forged' },
  });
  const other = decideAssignmentCreate({
    member: { userId: 'other-instructor', role: 'instructor' },
    course: course(),
    body: { title: 'Journal', instructions: 'Write' },
  });
  assert.equal(assigned.ok, true);
  assert.equal(other.ok, false);
  if (assigned.ok) {
    assert.equal(assigned.document.courseId, COURSE_ID);
    assert.equal(assigned.document.createdBy, INSTRUCTOR_ID);
    assert.equal(Object.prototype.hasOwnProperty.call(assigned.document, 'userId'), false);
  }
  if (!other.ok) assert.equal(other.status, 403);
});

test('admins and superadmins can manage an assignment they do not teach', () => {
  for (const role of ['admin', 'superadmin']) {
    const decision = decideAssignmentMutation({
      member: { userId: `${role}-1`, role },
      course: course(),
      assignment: assignment(),
    });
    assert.equal(decision.ok, true);
  }
});

test('an enrolled student can read and submit only as themselves', () => {
  const read = decideAssignmentRead({
    member: { userId: STUDENT_ID, role: 'student' },
    course: course(),
    enrollment: enrollment(),
  });
  const outsider = decideAssignmentRead({
    member: { userId: 'other-student', role: 'student' },
    course: course(),
    enrollment: enrollment(),
  });
  const submit = decideAssignmentSubmit({
    member: { userId: STUDENT_ID, role: 'student' },
    course: course(),
    enrollment: enrollment(),
    assignment: assignment(),
    body: { submissionText: 'My work', userId: 'other-student', courseId: 'forged' },
  });
  const staffSubmit = decideAssignmentSubmit({
    member: { userId: INSTRUCTOR_ID, role: 'instructor' },
    course: course(),
    assignment: assignment(),
    body: { submissionText: 'My work' },
  });
  assert.equal(read.ok, true);
  assert.equal(outsider.ok, false);
  assert.equal(submit.ok, true);
  assert.equal(staffSubmit.ok, false);
  if (read.ok) assert.equal(read.staff, false);
  if (submit.ok) {
    assert.equal(submit.userId, STUDENT_ID);
    assert.equal(submit.courseId, COURSE_ID);
  }
});

test('a student view hides other submissions and a staff view does not attach a student submission', () => {
  const view = presentAssignment(
    { ...assignment(), title: 'Journal', instructions: 'Write', description: 'Notes' },
    false,
    { _id: 'sub-1', userId: STUDENT_ID, assignmentId: ASSIGNMENT_ID, submissionText: 'My work', grade: 10 }
  );
  const staff = presentAssignment(
    { ...assignment(), title: 'Journal', instructions: 'Write' },
    true,
    { userId: 'someone-else', submissionText: 'Hidden' }
  );
  assert.equal(view.submission.userId, STUDENT_ID);
  assert.equal(Object.prototype.hasOwnProperty.call(staff, 'submission'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(staff, 'submissions'), false);
});

test('forged course links, missing records, and lookup failures do not change assignments', () => {
  const wrongLesson = decideAssignmentCreate({
    member: { userId: INSTRUCTOR_ID, role: 'instructor' },
    course: course(),
    lesson: { _id: LESSON_ID, courseId: 'other-course' },
    body: { lessonId: LESSON_ID, title: 'Journal', instructions: 'Write' },
  });
  const missing = decideAssignmentMutation({
    member: { userId: INSTRUCTOR_ID, role: 'instructor' },
    course: course(),
    assignment: null,
  });
  const failed = decideAssignmentRead({
    member: { userId: STUDENT_ID, role: 'student' },
    course: course(),
    enrollment: enrollment(),
    lookupError: true,
  });
  const graded = decideAssignmentGrade({
    member: { userId: INSTRUCTOR_ID, role: 'instructor' },
    course: course(),
    assignment: assignment(),
    submission: { _id: 'sub-1', assignmentId: 'other-assignment', userId: 'victim' },
    grade: 90,
  });
  const invalid = decideAssignmentCreate({
    member: { userId: INSTRUCTOR_ID, role: 'instructor' },
    course: course(),
    body: { title: '' },
  });
  assert.equal(wrongLesson.ok, false);
  assert.equal(missing.ok, false);
  assert.equal(failed.ok, false);
  assert.equal(graded.ok, false);
  assert.equal(invalid.ok, false);
  if (!missing.ok) assert.equal(missing.status, 404);
  if (!failed.ok) assert.equal(failed.status, 500);
  if (!graded.ok) assert.equal(graded.status, 404);
});

test('assignment routes authorize from the stored course and do not return raw errors', () => {
  const root = path.join(__dirname, '..', 'pages', 'api', 'assignments');
  const list = fs.readFileSync(path.join(root, 'index.ts'), 'utf8');
  const detail = fs.readFileSync(path.join(root, '[id].ts'), 'utf8');
  const submit = fs.readFileSync(path.join(root, '[id]', 'submit.ts'), 'utf8');
  const grade = fs.readFileSync(path.join(root, '[id]', 'grade.ts'), 'utf8');
  assert.equal(list.includes('decideAssignmentRead'), true);
  assert.equal(list.includes('...req.body'), false);
  assert.equal(detail.includes('decideAssignmentMutation'), true);
  assert.equal(submit.includes('decision.userId'), true);
  assert.equal(submit.includes('req.body.userId'), false);
  assert.equal(grade.includes('decideAssignmentGrade'), true);
  assert.equal(grade.includes('error.message'), false);
  assert.equal(list.includes('error.message'), false);
});
