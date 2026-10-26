/**
 * Sprint 3 decisions. In-memory only. No database and no browser.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { courseCountsAsLevelProgress, decideStaffCertificate } = require('../lib/enrollment-state');
const { summarizeStaffProgress } = require('../lib/staff-progress');
const { isFeatureApiBlocked, isFeaturePathBlocked, FEATURES } = require('../lib/feature-access');
const { planClassNotification, dueReminderWindow, notificationDestination } = require('../lib/class-notifications');

const COURSE = '507f1f77bcf86cd799439011';
const OTHER = '507f1f77bcf86cd799439012';
const INSTRUCTOR = '507f1f77bcf86cd799439013';
const STUDENT = '507f1f77bcf86cd799439014';

test('withdrawn enrollment does not count as level progress and an active completion does', () => {
  const lessons = ['l1', 'l2'];
  assert.equal(courseCountsAsLevelProgress({
    active: false,
    withdrawnAt: new Date(),
    completedLessons: lessons,
  }, lessons), false);
  assert.equal(courseCountsAsLevelProgress({
    completedLessons: lessons,
    progress: 100,
  }, lessons), true);
  assert.equal(courseCountsAsLevelProgress({ completedLessons: ['l1'] }, lessons), false);
});

test('staff certificate issuance stays an administrative override and does not reactivate enrollment', () => {
  const admin = decideStaffCertificate({ role: 'admin' });
  const instructor = decideStaffCertificate({ role: 'instructor' });
  assert.equal(admin.ok, true);
  assert.equal(admin.reactivatesEnrollment, false);
  assert.equal(instructor.status, 403);
  assert.equal(instructor.issues, false);
});

test('staff progress is an assigned-course aggregate and hides student records from students', () => {
  const courses = [
    { _id: COURSE, title: 'Assigned', difficulty: 'beginner', instructorId: INSTRUCTOR },
    { _id: OTHER, title: 'Other', difficulty: 'beginner', instructorId: STUDENT },
  ];
  const rows = [
    { userId: STUDENT, courseId: COURSE, progress: 100, completedLessons: ['secret'] },
    { userId: 'another', courseId: COURSE, progress: 40, withdrawnAt: new Date() },
    { userId: STUDENT, courseId: OTHER, progress: 100 },
  ];
  const student = summarizeStaffProgress({ role: 'student', userId: STUDENT, courses, rows });
  assert.equal(student.status, 403);
  const instructor = summarizeStaffProgress({ role: 'instructor', userId: INSTRUCTOR, courses, rows });
  assert.equal(instructor.ok, true);
  assert.equal(instructor.courses.length, 1);
  assert.equal(instructor.courses[0].courseId, COURSE);
  assert.equal(instructor.courses[0].completed, 1);
  assert.equal(instructor.courses[0].activeEnrollments, 1);
  assert.equal(JSON.stringify(instructor).includes('secret'), false);
  assert.equal(JSON.stringify(instructor).includes('@'), false);
  const admin = summarizeStaffProgress({ role: 'admin', userId: 'admin', courses, rows });
  assert.equal(admin.courses.length, 2);
});

test('community and expert consultation are open and certificates stay blocked', () => {
  assert.equal(FEATURES.COMMUNITY, true);
  assert.equal(FEATURES.EXPERT_CONSULTATION, true);
  assert.equal(FEATURES.CERTIFICATES, false);
  assert.equal(isFeatureApiBlocked('/api/community/rooms'), false);
  assert.equal(isFeaturePathBlocked('/community'), false);
  assert.equal(isFeatureApiBlocked('/api/consultations/sessions'), false);
  assert.equal(isFeaturePathBlocked('/consultations'), false);
  assert.equal(isFeaturePathBlocked('/consultations/expert'), false);
  assert.equal(isFeatureApiBlocked('/api/certificates'), true);
  assert.equal(isFeaturePathBlocked('/certificates'), true);
  assert.equal(isFeatureApiBlocked('/api/consultations/admin'), false);
  assert.equal(isFeaturePathBlocked('/consultations/admin'), false);
  assert.equal(isFeatureApiBlocked('/api/courses'), false);
  const disabled = { ...FEATURES, COMMUNITY: false, CERTIFICATES: false, EXPERT_CONSULTATION: false };
  assert.equal(isFeatureApiBlocked('/api/community/rooms', disabled), true);
  assert.equal(isFeatureApiBlocked('/api/consultations/sessions', disabled), true);
  assert.equal(isFeatureApiBlocked('/api/consultations/admin', disabled), false);
  assert.equal(isFeatureApiBlocked('/api/progress', disabled), false);
});

test('class notifications use active enrolled students and a class without a course has no audience', () => {
  const missing = planClassNotification({
    action: 'created',
    classId: 'class-1',
    title: 'Workshop',
    activeStudentIds: [STUDENT],
  });
  assert.equal(missing.notify, false);
  const planned = planClassNotification({
    action: 'rescheduled',
    classId: 'class-1',
    courseId: COURSE,
    title: 'Workshop',
    date: '2026-11-01',
    time: '10:00',
    activeStudentIds: [STUDENT, STUDENT],
  });
  assert.equal(planned.notify, true);
  assert.deepEqual(planned.recipients, [STUDENT]);
  assert.equal(planned.dedupeKey, 'class:class-1:schedule:2026-11-01:10:00');
  assert.equal(planned.href, `/courses/${COURSE}`);
});

test('reminder windows are bounded and notification clicks accept only internal paths', () => {
  const window = dueReminderWindow(new Date('2026-10-26T12:00:00.000Z'), 15);
  assert.equal(window.end.getTime() - window.start.getTime(), 15 * 60 * 1000);
  assert.equal(notificationDestination({ metadata: { href: '/courses/abc' } }), '/courses/abc');
  assert.equal(notificationDestination({ metadata: { href: 'https://example.com' } }), null);
  assert.equal(notificationDestination({ metadata: { href: '//example.com' } }), null);
  assert.equal(notificationDestination({}), null);
});

test('class and reminder handlers do not return exception text', () => {
  const classes = fs.readFileSync(path.join(__dirname, '../pages/api/classes/index.ts'), 'utf8');
  const reminders = fs.readFileSync(path.join(__dirname, '../pages/api/reminders/check.ts'), 'utf8');
  assert.equal(classes.includes('error: errorMessage'), false);
  assert.equal(reminders.includes('message: errorMessage'), false);
  assert.equal(classes.includes('planClassNotification'), true);
});
