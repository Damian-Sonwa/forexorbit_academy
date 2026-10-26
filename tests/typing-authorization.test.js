/**
 * Typing relay decisions. No database or socket server.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { decideCommunityTyping, decideConsultationTyping, decideAccountAccess } = require('../lib/account-access');

const USER_ID = 'student-1';
const BEGINNER_ID = '507f1f77bcf86cd799439011';
const ADVANCED_ID = '507f1f77bcf86cd799439012';
const SESSION_ID = '507f1f77bcf86cd799439013';

function beginner() {
  return { userId: USER_ID, role: 'student', email: 'student@example.com', learningLevel: 'beginner' };
}

test('an authorized beginner can send typing to the Beginner room channel', () => {
  const decision = decideCommunityTyping({
    member: beginner(),
    roomId: 'Beginner',
    room: { _id: BEGINNER_ID, name: 'Beginner' },
  });
  assert.equal(decision.ok, true);
  if (decision.ok) {
    assert.equal(decision.channel, `room:${BEGINNER_ID}`);
    assert.notEqual(decision.channel, 'room:Beginner');
    assert.equal(decision.user.userId, USER_ID);
  }
});

test('a student cannot send typing to another level room', () => {
  const decision = decideCommunityTyping({
    member: beginner(),
    roomId: ADVANCED_ID,
    room: { _id: ADVANCED_ID, name: 'Advanced' },
  });
  assert.equal(decision.ok, false);
  assert.equal(Object.prototype.hasOwnProperty.call(decision, 'channel'), false);
});

test('an arbitrary community room id is not a relay target', () => {
  const decision = decideCommunityTyping({
    member: beginner(),
    roomId: 'room-someone-else-invented',
    room: null,
  });
  assert.equal(decision.ok, false);
});

test('a missing user cannot send community typing', () => {
  const decision = decideCommunityTyping({
    member: null,
    roomId: BEGINNER_ID,
    room: { _id: BEGINNER_ID, name: 'Beginner' },
  });
  assert.equal(decision.ok, false);
});

test('revoked community access is denied from the current record', () => {
  const account = decideAccountAccess({
    userId: USER_ID,
    record: { email: 'student@example.com', role: 'student', status: 'deactivated' },
  });
  assert.equal(account.ok, false);
  const decision = decideCommunityTyping({
    member: account.ok ? account.user : null,
    roomId: BEGINNER_ID,
    room: { _id: BEGINNER_ID, name: 'Beginner' },
  });
  assert.equal(decision.ok, false);
});

test('a community typing lookup failure does not relay or expose the database error', () => {
  const decision = decideCommunityTyping({
    member: beginner(),
    roomId: BEGINNER_ID,
    room: { _id: BEGINNER_ID, name: 'Beginner' },
    lookupError: true,
  });
  assert.equal(decision.ok, false);
  if (!decision.ok) {
    assert.equal(decision.error, 'Unable to send typing indicator');
    assert.equal(decision.error.includes('ECONNREFUSED'), false);
  }
});

test('an active member can still type in the shared public room', () => {
  const decision = decideCommunityTyping({
    member: beginner(),
    roomId: 'community_global',
  });
  assert.equal(decision.ok, true);
  if (decision.ok) assert.equal(decision.channel, 'room:community_global');
});

test('a consultation participant can type on the stored session channel', () => {
  const decision = decideConsultationTyping({
    member: beginner(),
    session: { _id: SESSION_ID, studentId: USER_ID, expertId: 'expert-1' },
  });
  assert.equal(decision.ok, true);
  if (decision.ok) assert.equal(decision.channel, `consultation:${SESSION_ID}`);
});

test('a non-member cannot type in a consultation', () => {
  const decision = decideConsultationTyping({
    member: beginner(),
    session: { _id: SESSION_ID, studentId: 'other-student', expertId: 'expert-1' },
  });
  assert.equal(decision.ok, false);
});

test('an arbitrary consultation id with no session is denied', () => {
  const decision = decideConsultationTyping({
    member: beginner(),
    session: null,
  });
  assert.equal(decision.ok, false);
});

test('a missing consultation user and a lookup failure are denied', () => {
  const missing = decideConsultationTyping({
    member: null,
    session: { _id: SESSION_ID, studentId: USER_ID, expertId: 'expert-1' },
  });
  const failed = decideConsultationTyping({
    member: beginner(),
    session: { _id: SESSION_ID, studentId: USER_ID, expertId: 'expert-1' },
    lookupError: true,
  });
  assert.equal(missing.ok, false);
  assert.equal(failed.ok, false);
  if (!failed.ok) assert.equal(failed.error.includes('Mongo'), false);
});

test('the running socket server does not relay typing to a raw client room id', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(source, /decideCommunityTyping/);
  assert.match(source, /decideConsultationTyping/);
  assert.equal(source.includes('socket.to(`room:${roomId}`)'), false);
  assert.equal(source.includes('socket.to(`consultation:${sessionId}`)'), false);
  const alternate = fs.readFileSync(path.join(__dirname, '..', 'server', 'socket.ts'), 'utf8');
  assert.equal(alternate.includes('typing'), false);
});
