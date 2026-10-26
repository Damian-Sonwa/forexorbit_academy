/**
 * Community room join decisions. No database or socket server.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { decideCommunityRoomJoin, clientSafeAuthError } = require('../lib/account-access');

const BEGINNER_ID = '507f1f77bcf86cd799439011';
const ADVANCED_ID = '507f1f77bcf86cd799439012';

function student(level) {
  return { userId: 'student-1', role: 'student', learningLevel: level };
}

test('a beginner student can join the Beginner room', () => {
  const decision = decideCommunityRoomJoin({
    user: student('beginner'),
    roomId: 'Beginner',
    room: { _id: BEGINNER_ID, name: 'Beginner' },
  });
  assert.equal(decision.ok, true);
  if (decision.ok) {
    assert.equal(decision.roomId, BEGINNER_ID);
    assert.equal(decision.publicRoom, false);
  }
});

test('a student cannot join another learning-level room', () => {
  const decision = decideCommunityRoomJoin({
    user: student('beginner'),
    roomId: ADVANCED_ID,
    room: { _id: ADVANCED_ID, name: 'Advanced' },
  });
  assert.equal(decision.ok, false);
  if (!decision.ok) assert.equal(decision.error, 'Access restricted to your learning level');
});

test('an instructor can join any existing community room', () => {
  const decision = decideCommunityRoomJoin({
    user: { userId: 'instructor-1', role: 'instructor' },
    roomId: ADVANCED_ID,
    room: { _id: ADVANCED_ID, name: 'Advanced' },
  });
  assert.equal(decision.ok, true);
});

test('a missing room is denied and does not echo the requested id', () => {
  const decision = decideCommunityRoomJoin({
    user: student('beginner'),
    roomId: 'private-room-id',
    room: null,
  });
  assert.equal(decision.ok, false);
  assert.equal(Object.prototype.hasOwnProperty.call(decision, 'roomId'), false);
});

test('a lookup error denies the join without exposing the database error', () => {
  const decision = decideCommunityRoomJoin({
    user: student('advanced'),
    roomId: ADVANCED_ID,
    lookupError: true,
  });
  assert.equal(decision.ok, false);
  if (!decision.ok) {
    assert.equal(decision.error, 'Unable to join room');
    assert.equal(decision.error.includes('Mongo'), false);
  }
});

test('the shared public socket room does not require a community room record', () => {
  const decision = decideCommunityRoomJoin({
    user: student('beginner'),
    roomId: 'community_global',
  });
  assert.equal(decision.ok, true);
  if (decision.ok) assert.equal(decision.publicRoom, true);
});

test('a student without a learning level cannot join a gated room', () => {
  const decision = decideCommunityRoomJoin({
    user: { userId: 'student-1', role: 'student' },
    roomId: BEGINNER_ID,
    room: { _id: BEGINNER_ID, name: 'Beginner' },
  });
  assert.equal(decision.ok, false);
});

test('database failures become a generic authorization error', () => {
  const safe = clientSafeAuthError(new Error('connect ECONNREFUSED internal-database-host'));
  assert.equal(safe.status, 500);
  assert.equal(safe.error, 'Internal server error');
  assert.equal(safe.error.includes('internal-database-host'), false);

  const expired = clientSafeAuthError(new Error('Invalid or expired token'));
  assert.equal(expired.status, 401);
  assert.equal(expired.error, 'Invalid or expired token');
});

test('the socket server no longer joins a community room when lookup fails', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.equal(source.includes('Allowing room join without validation'), false);
  assert.match(source, /lookupError: true/);
  assert.match(source, /decideCommunityRoomJoin/);
});
