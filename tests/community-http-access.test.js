/**
 * Community HTTP membership. No database connection.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  decideCommunityRoomJoin,
  decideCommunityMessageAccess,
  decideCommunityMessageSend,
  communityMember,
} = require('../lib/account-access');

const BEGINNER_ID = '507f1f77bcf86cd799439011';
const DIRECT_ID = '507f1f77bcf86cd799439012';
const GROUP_ID = '507f1f77bcf86cd799439013';
const STUDENT_ID = '507f1f77bcf86cd799439014';

function levelRoom(name) {
  return { _id: BEGINNER_ID, name, type: 'global' };
}

test('global rooms follow the socket learning-level rule', () => {
  const beginner = decideCommunityMessageAccess({
    member: { userId: STUDENT_ID, role: 'student', learningLevel: 'beginner' },
    room: levelRoom('Beginner'),
  });
  const cross = decideCommunityMessageAccess({
    member: { userId: STUDENT_ID, role: 'student', tradingLevel: 'intermediate' },
    room: levelRoom('Beginner'),
  });
  const staff = decideCommunityRoomJoin({
    user: { userId: 'instructor-1', role: 'instructor' },
    roomId: BEGINNER_ID,
    room: levelRoom('Advanced'),
  });
  assert.equal(beginner.ok, true);
  assert.equal(cross.ok, false);
  assert.equal(staff.ok, true);
  if (beginner.ok) assert.equal(beginner.senderId, STUDENT_ID);
  if (!cross.ok) assert.equal(cross.error, 'Access restricted to your learning level');
});

test('a student with no learning level is not placed in Beginner', () => {
  const record = communityMember(STUDENT_ID, { role: 'student', studentDetails: {} });
  const decision = decideCommunityMessageAccess({
    member: record,
    room: levelRoom('Beginner'),
  });
  assert.equal(record.learningLevel, undefined);
  assert.equal(record.tradingLevel, undefined);
  assert.equal(decision.ok, false);
  if (!decision.ok) assert.equal(decision.error, 'Please complete onboarding to access community rooms');
});

test('direct and other room types require stored membership', () => {
  const direct = { _id: DIRECT_ID, name: 'Private', type: 'direct', participants: [STUDENT_ID, 'instructor-1'] };
  const group = { _id: GROUP_ID, name: 'Study', type: 'group', participants: [STUDENT_ID] };
  const member = decideCommunityMessageAccess({
    member: { userId: STUDENT_ID, role: 'student', learningLevel: 'advanced' },
    room: direct,
  });
  const stranger = decideCommunityMessageAccess({
    member: { userId: 'other-student', role: 'student', learningLevel: 'beginner' },
    room: direct,
  });
  const staff = decideCommunityRoomJoin({
    user: { userId: 'admin-1', role: 'admin' },
    roomId: DIRECT_ID,
    room: direct,
  });
  const groupMember = decideCommunityMessageAccess({
    member: { userId: STUDENT_ID, role: 'student' },
    room: group,
  });
  const groupOutsider = decideCommunityMessageAccess({
    member: { userId: 'instructor-1', role: 'instructor' },
    room: group,
  });
  assert.equal(member.ok, true);
  assert.equal(stranger.ok, false);
  assert.equal(staff.ok, false);
  assert.equal(groupMember.ok, true);
  assert.equal(groupOutsider.ok, false);
});

test('the sender is the authenticated account and lookup failures stay closed', () => {
  const sent = decideCommunityMessageSend({
    member: { userId: STUDENT_ID, role: 'student', learningLevel: 'beginner' },
    room: levelRoom('Beginner'),
    body: { senderId: 'forged-user', senderName: 'Admin', type: 'text', content: ' hello ' },
  });
  const missing = decideCommunityMessageAccess({
    member: { userId: STUDENT_ID, role: 'student', learningLevel: 'beginner' },
    room: null,
  });
  const failed = decideCommunityMessageAccess({
    member: { userId: STUDENT_ID, role: 'student', learningLevel: 'beginner' },
    room: levelRoom('Beginner'),
    lookupError: true,
  });
  assert.equal(sent.ok, true);
  assert.equal(missing.ok, false);
  assert.equal(failed.ok, false);
  if (sent.ok) {
    assert.equal(sent.message.senderId, STUDENT_ID);
    assert.equal(sent.message.content, 'hello');
    assert.equal(Object.prototype.hasOwnProperty.call(sent.message, 'senderName'), false);
  }
  if (!missing.ok) assert.equal(missing.status, 404);
  if (!failed.ok) assert.equal(failed.status, 500);
});

test('community HTTP routes use the shared membership decision', () => {
  const root = path.join(__dirname, '..', 'pages', 'api', 'community');
  const messages = fs.readFileSync(path.join(root, 'messages.ts'), 'utf8');
  const rooms = fs.readFileSync(path.join(root, 'rooms.ts'), 'utf8');
  const read = fs.readFileSync(path.join(root, 'messages', 'read.ts'), 'utf8');
  assert.equal(messages.includes('decideCommunityMessageSend'), true);
  assert.equal(messages.includes("userLevel = 'beginner'"), false);
  assert.equal(messages.includes('decision.message.senderId'), true);
  assert.equal(messages.includes('error.message'), false);
  assert.equal(rooms.includes('decideCommunityRoomJoin'), true);
  assert.equal(rooms.includes("userLevel = 'beginner'"), false);
  assert.equal(read.includes('decideCommunityMessageAccess'), true);
});
