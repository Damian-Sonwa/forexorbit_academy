/**
 * Enrollment and progress decisions. No database connection.
 * Withdrawn enrollment was approved by the product owner on 26 October 2026.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { decideLessonCatalog, decideProgressUpdate } = require('../lib/account-access');
const {
  decideEnroll,
  decideUnenroll,
  enrollDuplicateStatus,
  presentEnrollmentProgress,
  sumActiveCompletedLessons,
  quizHistoryQuery,
  enrollmentDecisionRecord,
  isActiveEnrollment,
  activeEnrollmentFilter,
  createEnrollmentRepository,
} = require('../lib/enrollment-state');

const COURSE = '507f1f77bcf86cd799439011';
const STUDENT = '507f1f77bcf86cd799439012';
const OTHER = '507f1f77bcf86cd799439013';
const LESSON = '507f1f77bcf86cd799439014';

function course() {
  return { _id: COURSE, title: 'Price Action' };
}

function enroll(existing) {
  return decideEnroll({
    role: 'student',
    userId: STUDENT,
    courseId: COURSE,
    course: course(),
    existing: existing || null,
  });
}

test('an authorized student can enroll in a stored course', () => {
  const decision = enroll(null);
  assert.equal(decision.ok, true);
  assert.equal(decision.action, 'insert');
  assert.equal(decision.writes, true);
  const repo = createEnrollmentRepository();
  const result = repo.commit(decision, STUDENT);
  assert.equal(result.status, 200);
  assert.equal(result.body.enrolled, true);
  assert.equal(repo.rows.length, 1);
  assert.equal(repo.rows[0].active, true);
  assert.equal(repo.rows[0].withdrawnAt, undefined);
  assert.deepEqual(repo.rows[0].completedLessons, []);
});

test('a missing course is rejected and creates no progress row', () => {
  const decision = decideEnroll({
    role: 'student',
    userId: STUDENT,
    courseId: COURSE,
    course: null,
    existing: null,
  });
  assert.equal(decision.status, 404);
  assert.equal(decision.error, 'Course not found');
  assert.equal(decision.writes, false);
  const repo = createEnrollmentRepository();
  const result = repo.commit(decision, STUDENT);
  assert.equal(result.status, 404);
  assert.equal(repo.rows.length, 0);
});

test('a malformed course id is a client error and creates no progress row', () => {
  for (const courseId of ['not-an-id', '123', '', null]) {
    const decision = decideEnroll({
      role: 'student',
      userId: STUDENT,
      courseId,
      course: course(),
      existing: null,
    });
    assert.equal(decision.status, 400);
    assert.equal(decision.error, 'Invalid course ID');
    assert.equal(decision.writes, false);
  }
});

test('a non-student cannot enroll', () => {
  for (const role of ['instructor', 'admin', 'superadmin', undefined]) {
    const decision = decideEnroll({
      role,
      userId: STUDENT,
      courseId: COURSE,
      course: course(),
      existing: null,
    });
    assert.equal(decision.status, 403);
    assert.equal(decision.error, 'Unauthorized');
  }
});

test('a second active enrollment returns already enrolled', () => {
  const decision = enroll({ userId: STUDENT, courseId: COURSE, active: true, completedLessons: ['kept'] });
  assert.equal(decision.status, 400);
  assert.equal(decision.error, 'Already enrolled');
  assert.equal(decision.writes, false);
});

test('withdrawal keeps the same progress row and a later enroll reactivates it', () => {
  const repo = createEnrollmentRepository();
  repo.commit(enroll(null), STUDENT);
  repo.rows[0].completedLessons = [LESSON];
  repo.rows[0].progress = 40;
  const withdrawal = decideUnenroll({
    role: 'student',
    userId: STUDENT,
    courseId: COURSE,
    existing: repo.rows[0],
  });
  assert.equal(withdrawal.action, 'withdraw');
  assert.equal(withdrawal.writes, true);
  const withdrawn = repo.commit(withdrawal, STUDENT);
  assert.equal(withdrawn.body.enrolled, false);
  assert.equal(repo.rows.length, 1);
  assert.equal(repo.rows[0].active, false);
  assert.ok(repo.rows[0].withdrawnAt);
  assert.deepEqual(repo.rows[0].completedLessons, [LESSON]);
  assert.equal(repo.rows[0].progress, 40);

  const again = enroll(repo.rows[0]);
  assert.equal(again.action, 'reactivate');
  repo.commit(again, STUDENT);
  assert.equal(repo.rows.length, 1);
  assert.equal(repo.rows[0].active, true);
  assert.equal(repo.rows[0].withdrawnAt, undefined);
  assert.deepEqual(repo.rows[0].completedLessons, [LESSON]);
});

test('concurrent enroll decisions that both saw no row produce one row and a duplicate-key response', () => {
  const repo = createEnrollmentRepository();
  const first = enroll(null);
  const second = enroll(null);
  assert.equal(first.action, 'insert');
  assert.equal(second.action, 'insert');
  const committed = repo.commit(first, STUDENT);
  assert.equal(committed.status, 200);
  let duplicate = null;
  try {
    repo.commit(second, STUDENT);
  } catch (error) {
    duplicate = enrollDuplicateStatus(error);
  }
  assert.equal(duplicate.status, 400);
  assert.equal(duplicate.body.error, 'Already enrolled');
  assert.equal(repo.rows.length, 1);
  assert.equal(enrollDuplicateStatus({ codeName: 'DuplicateKey' }).status, 400);
  assert.equal(enrollDuplicateStatus({ code: 50 }).status, 500);
  assert.equal(enrollDuplicateStatus({ code: 50 }).body.error, 'Internal server error');
});

test('withdrawn quiz history stays visible and is excluded from active totals', () => {
  const withdrawn = presentEnrollmentProgress({
    _id: 'row-1',
    userId: STUDENT,
    courseId: COURSE,
    progress: 80,
    completedLessons: [LESSON, 'another'],
    active: false,
    withdrawnAt: new Date('2026-10-01T00:00:00.000Z'),
  }, {
    course: { id: COURSE, title: 'Price Action' },
    totalLessons: 4,
    quizScores: [{ lessonId: LESSON, score: 3, totalQuestions: 4 }],
  });
  const orphan = presentEnrollmentProgress({
    _id: 'row-2',
    userId: STUDENT,
    courseId: OTHER,
    progress: 100,
    completedLessons: ['gone'],
    active: true,
  }, {
    course: null,
    totalLessons: 0,
    quizScores: [{ lessonId: 'old', score: 1, totalQuestions: 1 }],
  });
  const active = presentEnrollmentProgress({
    _id: 'row-3',
    userId: STUDENT,
    courseId: COURSE,
    progress: 25,
    completedLessons: ['live'],
  }, {
    course: { id: COURSE, title: 'Live Course' },
    totalLessons: 2,
    quizScores: [],
  });

  assert.equal(withdrawn.active, false);
  assert.equal(withdrawn.countsTowardActiveTotals, false);
  assert.equal(withdrawn.quizScores.length, 1);
  assert.equal(withdrawn.quizScores[0].percentage, 75);
  assert.equal(withdrawn.completedLessons.length, 2);
  assert.equal(orphan.course, null);
  assert.equal(orphan.countsTowardActiveTotals, false);
  assert.equal(orphan.quizScores.length, 1);
  assert.equal(active.countsTowardActiveTotals, true);
  assert.equal(sumActiveCompletedLessons([withdrawn, orphan, active]), 1);
});

test('quiz history is queried for the authenticated student only', () => {
  const query = quizHistoryQuery(STUDENT, COURSE);
  assert.deepEqual(query, { userId: STUDENT, courseId: COURSE });
  assert.notEqual(query.userId, OTHER);
});

test('a withdrawn enrollment does not grant lesson or progress access', () => {
  const member = { userId: STUDENT, role: 'student' };
  const courseRecord = { _id: COURSE, instructorId: OTHER };
  const withdrawn = {
    userId: STUDENT,
    courseId: COURSE,
    progress: 100,
    withdrawnAt: new Date('2026-10-01T00:00:00.000Z'),
  };
  const legacy = { userId: STUDENT, courseId: COURSE, progress: 100 };
  assert.equal(isActiveEnrollment(legacy), true);
  assert.equal(isActiveEnrollment(withdrawn), false);
  assert.equal(decideLessonCatalog({
    member,
    course: courseRecord,
    enrollment: enrollmentDecisionRecord(withdrawn),
  }).ok, false);
  assert.equal(decideLessonCatalog({
    member,
    course: courseRecord,
    enrollment: enrollmentDecisionRecord(legacy),
  }).ok, true);
  assert.equal(decideProgressUpdate({
    member,
    course: { _id: COURSE },
    lesson: { _id: LESSON, courseId: COURSE },
    enrollment: enrollmentDecisionRecord(withdrawn),
  }).ok, false);
  assert.equal(decideProgressUpdate({
    member,
    course: { _id: COURSE },
    lesson: { _id: LESSON, courseId: COURSE },
    enrollment: { userId: OTHER, courseId: COURSE, progress: 100 },
  }).ok, false);
});

test('active enrollment queries exclude withdrawn rows and the route does not delete progress', () => {
  assert.deepEqual(activeEnrollmentFilter(), {
    active: { $ne: false },
    withdrawnAt: { $exists: false },
  });
  const enrollSource = fs.readFileSync(
    path.join(__dirname, '../pages/api/courses/[id]/enroll.ts'),
    'utf8'
  );
  assert.equal(enrollSource.includes('deleteOne'), false);
  assert.equal(enrollSource.includes('createIndex'), false);
  assert.equal(enrollSource.includes('withdrawnAt'), true);
  assert.equal(enrollSource.includes('completedLessons'), false);
  const dashboard = fs.readFileSync(path.join(__dirname, '../pages/dashboard.tsx'), 'utf8');
  assert.equal(dashboard.includes('sumActiveCompletedLessons'), true);
  assert.equal(dashboard.includes('Progress could not be loaded'), true);
});
