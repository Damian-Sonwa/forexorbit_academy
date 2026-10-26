/**
 * Community presence audience. No database or socket connection.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { decideAccountAccess, decideCommunityPresence, presenceOfflineTargets } = require('../lib/account-access');

const BEGINNER = '507f1f77bcf86cd799439021';
const INTERMEDIATE = '507f1f77bcf86cd799439022';
const ADVANCED = '507f1f77bcf86cd799439023';

function rooms() {
  return [
    { _id: BEGINNER, name: 'Beginner' },
    { _id: INTERMEDIATE, name: 'Intermediate' },
    { _id: ADVANCED, name: 'Advanced' },
    { _id: '507f1f77bcf86cd799439024', name: 'Lobby' },
  ];
}

test('a student sees presence only for the matching learning level', () => {
  const decision = decideCommunityPresence({
    member: { userId: 'student-1', role: 'student', learningLevel: 'beginner' },
    rooms: rooms(),
  });
  assert.equal(decision.ok, true);
  if (!decision.ok) return;
  assert.deepEqual(decision.channels, [`presence:${BEGINNER}`]);
  assert.equal(decision.userId, 'student-1');
  assert.equal(Object.prototype.hasOwnProperty.call(decision, 'email'), false);
  assert.equal(decision.channels.includes(`presence:${ADVANCED}`), false);
  assert.equal(decision.channels.includes('presence:community'), false);
});

test('trading level is used when learning level is absent', () => {
  const decision = decideCommunityPresence({
    member: { userId: 'student-2', role: 'student', tradingLevel: 'Advanced' },
    rooms: rooms(),
  });
  assert.equal(decision.ok, true);
  if (decision.ok) assert.deepEqual(decision.channels, [`presence:${ADVANCED}`]);
});

test('staff see every learning-level room and no unrelated room', () => {
  for (const role of ['instructor', 'admin', 'superadmin']) {
    const decision = decideCommunityPresence({
      member: { userId: `${role}-1`, role, email: 'hidden@example.com' },
      rooms: rooms(),
    });
    assert.equal(decision.ok, true);
    if (!decision.ok) continue;
    assert.deepEqual(decision.channels, [
      `presence:${BEGINNER}`,
      `presence:${INTERMEDIATE}`,
      `presence:${ADVANCED}`,
    ]);
    assert.equal(Object.prototype.hasOwnProperty.call(decision, 'email'), false);
  }
});

test('cross-level, unauthenticated, and failed lookups share nothing', () => {
  const beginner = decideCommunityPresence({
    member: { userId: 'student-1', role: 'student', learningLevel: 'beginner' },
    rooms: rooms(),
  });
  const advanced = decideCommunityPresence({
    member: { userId: 'student-9', role: 'student', learningLevel: 'advanced' },
    rooms: rooms(),
  });
  const anonymous = decideCommunityPresence({ member: null, rooms: rooms() });
  const inactive = decideAccountAccess({
    userId: 'student-1',
    record: { role: 'student', status: 'deactivated', email: 'student@example.com' },
  });
  const revoked = decideCommunityPresence({
    member: inactive.ok ? inactive.user : null,
    rooms: rooms(),
  });
  const failed = decideCommunityPresence({
    member: { userId: 'student-1', role: 'student', learningLevel: 'beginner' },
    rooms: rooms(),
    lookupError: true,
  });
  const noLevel = decideCommunityPresence({
    member: { userId: 'student-1', role: 'student' },
    rooms: rooms(),
  });
  assert.equal(beginner.ok, true);
  assert.equal(advanced.ok, true);
  if (beginner.ok && advanced.ok) {
    assert.equal(beginner.channels.some((channel) => advanced.channels.includes(channel)), false);
  }
  assert.equal(anonymous.ok, false);
  assert.equal(revoked.ok, false);
  assert.equal(failed.ok, false);
  assert.equal(noLevel.ok, false);
  for (const decision of [anonymous, revoked, failed, noLevel]) {
    assert.equal(Object.prototype.hasOwnProperty.call(decision, 'channels'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(decision, 'userId'), false);
  }
});

test('disconnect reports offline only inside authorized presence rooms', () => {
  const targets = presenceOfflineTargets(new Set([
    'socket-id',
    `presence:${BEGINNER}`,
    'presence:community',
    `room:${BEGINNER}`,
    `presence:${ADVANCED}`,
  ]));
  assert.deepEqual(targets, [`presence:${BEGINNER}`, `presence:${ADVANCED}`]);
  assert.equal(targets.includes('presence:community'), false);
});

test('the live server does not join a global presence room', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const online = server.slice(server.indexOf("socket.on('userOnline'"), server.indexOf("socket.on('disconnecting'"));
  const offline = server.slice(server.indexOf("socket.on('disconnecting'"), server.indexOf("socket.on('disconnect'"));
  assert.equal(server.includes('decideCommunityPresence'), true);
  assert.equal(server.includes('presenceOfflineTargets'), true);
  assert.equal(server.includes("socket.join('presence:community')"), false);
  assert.equal(server.includes("socket.broadcast.emit('userOnline'"), false);
  assert.equal(server.includes("socket.broadcast.emit('userOffline'"), false);
  assert.equal(online.includes('user.email'), false);
  assert.equal(online.includes('userId: decision.userId'), true);
  assert.equal(offline.includes('user.email'), false);
  assert.equal(offline.includes('lastSeen:'), true);
});
