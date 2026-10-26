/**
 * Lesson and course socket decisions. No database or socket server.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  decideAccountAccess,
  decideLessonRoomAccess,
  decideLessonChat,
  decideLessonStaffNotify,
} = require('../lib/account-access');

const LESSON_ID = '507f1f77bcf86cd799439011';
const COURSE_ID = '507f1f77bcf86cd799439012';
const STUDENT_ID = '507f1f77bcf86cd799439013';
const INSTRUCTOR_ID = '507f1f77bcf86cd799439014';

function lesson() {
  return { _id: LESSON_ID, courseId: COURSE_ID };
}

function course(instructorId) {
  return { _id: COURSE_ID, instructorId, difficulty: 'beginner' };
}

function student() {
  return { userId: STUDENT_ID, role: 'student', email: 'student@example.com', name: 'Student' };
}

function enrollment(progress) {
  return { userId: STUDENT_ID, courseId: COURSE_ID, progress };
}

test('an enrolled student can join a permitted lesson', () => {
  const decision = decideLessonRoomAccess({
    member: student(),
    lesson: lesson(),
    course: course(INSTRUCTOR_ID),
    enrollment: enrollment(0),
  });
  assert.equal(decision.ok, true);
  if (decision.ok) {
    assert.equal(decision.lessonChannel, `lesson:${LESSON_ID}`);
    assert.equal(decision.courseChannel, `course:${COURSE_ID}`);
    assert.equal(decision.user.userId, STUDENT_ID);
  }
});

test('a non-enrolled student cannot join a lesson', () => {
  const decision = decideLessonRoomAccess({
    member: student(),
    lesson: lesson(),
    course: course(INSTRUCTOR_ID),
    enrollment: null,
  });
  assert.equal(decision.ok, false);
  assert.equal(Object.prototype.hasOwnProperty.call(decision, 'lessonChannel'), false);
});

test('an assigned instructor can join without an enrollment', () => {
  const decision = decideLessonRoomAccess({
    member: { userId: INSTRUCTOR_ID, role: 'instructor', email: 'instructor@example.com' },
    lesson: lesson(),
    course: course(INSTRUCTOR_ID),
    enrollment: null,
  });
  assert.equal(decision.ok, true);
  if (decision.ok) assert.equal(decision.lessonChannel, `lesson:${LESSON_ID}`);
});

test('an instructor who is not assigned to the course cannot join or chat', () => {
  const member = { userId: 'other-instructor', role: 'instructor', email: 'other@example.com', name: 'Other' };
  const join = decideLessonRoomAccess({
    member,
    lesson: lesson(),
    course: course(INSTRUCTOR_ID),
    enrollment: null,
  });
  const chat = decideLessonChat({
    member,
    lesson: lesson(),
    course: course(INSTRUCTOR_ID),
    enrollment: null,
    text: 'hello',
  });
  assert.equal(join.ok, false);
  assert.equal(chat.ok, false);
});

test('admins and superadmins can access a lesson without enrollment', () => {
  for (const role of ['admin', 'superadmin']) {
    const decision = decideLessonRoomAccess({
      member: { userId: 'staff-1', role, email: 'staff@example.com' },
      lesson: lesson(),
      course: course(INSTRUCTOR_ID),
      enrollment: null,
    });
    assert.equal(decision.ok, true);
  }
});

test('invalid and missing lesson or course records are denied', () => {
  const member = student();
  const missingLesson = decideLessonRoomAccess({
    member,
    lesson: null,
    course: course(INSTRUCTOR_ID),
    enrollment: enrollment(0),
  });
  const missingCourse = decideLessonRoomAccess({
    member,
    lesson: lesson(),
    course: null,
    enrollment: enrollment(0),
  });
  const mismatched = decideLessonRoomAccess({
    member,
    lesson: { _id: LESSON_ID, courseId: 'some-other-course' },
    course: course(INSTRUCTOR_ID),
    enrollment: enrollment(0),
  });
  assert.equal(missingLesson.ok, false);
  assert.equal(missingCourse.ok, false);
  assert.equal(mismatched.ok, false);
  assert.equal(missingLesson.error, 'Unable to access lesson');
});

test('a locked prerequisite lesson stays closed for an enrolled student', () => {
  const blocked = decideLessonRoomAccess({
    member: student(),
    lesson: { _id: LESSON_ID, courseId: COURSE_ID, requiredLevel: 'advanced' },
    course: course(INSTRUCTOR_ID),
    enrollment: enrollment(40),
  });
  const completed = decideLessonRoomAccess({
    member: student(),
    lesson: { _id: LESSON_ID, courseId: COURSE_ID, requiredLevel: 'advanced' },
    course: course(INSTRUCTOR_ID),
    enrollment: enrollment(100),
  });
  assert.equal(blocked.ok, false);
  assert.equal(completed.ok, true);
});

test('chat uses the account identity and rejects forged or empty payloads', () => {
  const allowed = decideLessonChat({
    member: student(),
    lesson: lesson(),
    course: course(INSTRUCTOR_ID),
    enrollment: enrollment(0),
    text: '  hello class  ',
    claimedUserId: 'forged-user',
    senderName: 'Forged Name',
  });
  assert.equal(allowed.ok, true);
  if (allowed.ok) {
    assert.equal(allowed.channel, `lesson:${LESSON_ID}`);
    assert.equal(allowed.sender.userId, STUDENT_ID);
    assert.equal(allowed.sender.senderName, 'Student');
    assert.equal(allowed.text, 'hello class');
    assert.equal(Object.prototype.hasOwnProperty.call(allowed, 'claimedUserId'), false);
  }

  const outsider = decideLessonChat({
    member: student(),
    lesson: lesson(),
    course: course(INSTRUCTOR_ID),
    enrollment: null,
    text: 'private note',
  });
  assert.equal(outsider.ok, false);
  assert.equal(Object.prototype.hasOwnProperty.call(outsider, 'channel'), false);

  for (const text of ['', '   ', 12, null]) {
    const decision = decideLessonChat({
      member: student(),
      lesson: lesson(),
      course: course(INSTRUCTOR_ID),
      enrollment: enrollment(0),
      text,
    });
    assert.equal(decision.ok, false);
  }
});

test('students cannot forge lesson or quiz update notices', () => {
  const decision = decideLessonStaffNotify({
    member: student(),
    lesson: lesson(),
    course: course(INSTRUCTOR_ID),
  });
  assert.equal(decision.ok, false);
  assert.equal(Object.prototype.hasOwnProperty.call(decision, 'lessonChannel'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(decision, 'courseChannel'), false);
});

test('assigned instructors and administrators can notify the stored rooms', () => {
  const instructor = decideLessonStaffNotify({
    member: { userId: INSTRUCTOR_ID, role: 'instructor', email: 'instructor@example.com' },
    lesson: lesson(),
    course: course(INSTRUCTOR_ID),
  });
  const admin = decideLessonStaffNotify({
    member: { userId: 'admin-1', role: 'admin', email: 'admin@example.com' },
    lesson: lesson(),
    course: course('someone-else'),
  });
  const otherInstructor = decideLessonStaffNotify({
    member: { userId: 'other-instructor', role: 'instructor', email: 'other@example.com' },
    lesson: lesson(),
    course: course(INSTRUCTOR_ID),
  });
  const superadmin = decideLessonStaffNotify({
    member: { userId: 'superadmin-1', role: 'superadmin', email: 'super@example.com' },
    lesson: lesson(),
    course: course('someone-else'),
  });
  assert.equal(instructor.ok, true);
  assert.equal(admin.ok, true);
  assert.equal(superadmin.ok, true);
  assert.equal(otherInstructor.ok, false);
  if (instructor.ok) {
    assert.equal(instructor.lessonChannel, `lesson:${LESSON_ID}`);
    assert.equal(instructor.courseChannel, `course:${COURSE_ID}`);
    assert.notEqual(instructor.courseChannel, 'course:client-supplied-room');
  }
});

test('a missing user and a lookup failure do not reveal a database error', () => {
  const revoked = decideAccountAccess({
    userId: STUDENT_ID,
    record: { email: 'student@example.com', role: 'student', status: 'deactivated' },
  });
  assert.equal(revoked.ok, false);
  const missing = decideLessonRoomAccess({
    member: revoked.ok ? revoked.user : null,
    lesson: lesson(),
    course: course(INSTRUCTOR_ID),
    enrollment: enrollment(0),
  });
  const failed = decideLessonChat({
    member: student(),
    lesson: lesson(),
    course: course(INSTRUCTOR_ID),
    enrollment: enrollment(0),
    text: 'hello',
    lookupError: true,
  });
  const internal = 'ECONNREFUSED internal-database-host';
  assert.equal(missing.ok, false);
  assert.equal(failed.ok, false);
  assert.equal(failed.error, 'Unable to send message');
  assert.equal(failed.error.includes(internal), false);
  assert.equal(JSON.stringify(failed).includes('Mongo'), false);
});

test('the live socket server authorizes lesson rooms and the unused socket module does not', () => {
  const live = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const unused = fs.readFileSync(path.join(__dirname, '..', 'server', 'socket.ts'), 'utf8');
  assert.equal(live.includes('decideLessonRoomAccess'), true);
  assert.equal(live.includes('decideLessonChat'), true);
  assert.equal(live.includes('decideLessonStaffNotify'), true);
  assert.equal(live.includes('socket.join(`lesson:${lessonId}`)'), false);
  assert.equal(live.includes('io.to(`lesson:${data.lessonId}`)'), false);
  assert.equal(live.includes('io.to(`course:${data.courseId}`)'), false);
  const noticeStart = live.indexOf("socket.on('lessonUpdated'");
  const noticeEnd = live.indexOf("socket.on('joinRoom'");
  const notices = live.slice(noticeStart, noticeEnd);
  assert.equal(notices.includes('content:'), false);
  assert.equal(notices.includes('videoUrl'), false);
  assert.equal(notices.includes('questions'), false);
  assert.equal(live.includes('Chat message error:'), false);

  const chatStart = live.indexOf("socket.on('chatMessage'");
  const chatEnd = live.indexOf("socket.on('progressUpdate'");
  const chat = live.slice(chatStart, chatEnd);
  assert.equal(chat.includes('data.userId'), false);
  assert.equal(chat.includes('data.senderName'), false);
  assert.equal(chat.includes('decision.sender.userId'), true);
  assert.equal(chat.includes('decision.channel'), true);

  assert.equal(unused.includes('export function initializeSocket'), true);
  assert.equal(unused.includes('new SocketIOServer'), false);
  assert.equal(unused.includes('socket.join(`lesson:${lessonId}`)'), false);
  const packageJson = fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8');
  assert.equal(packageJson.includes('server/socket'), false);
});
