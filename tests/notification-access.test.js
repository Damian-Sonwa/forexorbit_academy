/**
 * Notification recipient isolation. Writes stay in an in-memory store.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  NOTIFICATION_NOT_FOUND,
  notificationErrorBody,
  authorizedCommunityRoomIds,
  notificationIsVisible,
  ownedNotificationQuery,
  presentNotification,
  prepareRecipientNotifications,
  createMemoryNotificationStore,
} = require('../lib/notification-access');

const USER_A = '507f1f77bcf86cd799439011';
const USER_B = '507f1f77bcf86cd799439012';
const INSTRUCTOR = '507f1f77bcf86cd799439013';
const ADMIN = '507f1f77bcf86cd799439014';
const SUPERADMIN = '507f1f77bcf86cd799439015';
const BEGINNER_ROOM = '507f1f77bcf86cd7994390a1';
const ADVANCED_ROOM = '507f1f77bcf86cd7994390a2';
const MISSING_ID = '507f1f77bcf86cd7994390ff';

const ROOMS = [
  { _id: BEGINNER_ROOM, name: 'Beginner', type: 'global', participants: [] },
  { _id: ADVANCED_ROOM, name: 'Advanced', type: 'global', participants: [] },
];

function student(userId, learningLevel) {
  return { userId, role: 'student', learningLevel };
}

function notice(extra) {
  return {
    type: 'system_alert',
    title: 'Notice',
    message: 'Fixture',
    roleTarget: 'all',
    ...extra,
  };
}

const ROUTES = [
  'pages/api/notifications/index.ts',
  'pages/api/notifications/mark-all-read.ts',
];

test('user A cannot mark user B notification as read', () => {
  const store = createMemoryNotificationStore();
  const delivered = store.deliver(notice(), [USER_B]);
  const result = store.markRead(USER_A, delivered[0].id, []);
  assert.equal(result.status, 404);
  assert.deepEqual(result.body, NOTIFICATION_NOT_FOUND);
  assert.equal(store.documents[0].read, false);
  assert.equal(store.list(USER_A, []).length, 0);
  assert.equal(store.list(USER_B, [])[0].read, false);
});

test('a foreign notification id returns the same result as a missing id', () => {
  const store = createMemoryNotificationStore();
  const delivered = store.deliver(notice(), [USER_B]);
  const foreign = store.markRead(USER_A, delivered[0].id, []);
  const missing = store.markRead(USER_A, MISSING_ID, []);
  assert.deepEqual(foreign, missing);
  assert.equal(foreign.status, 404);
  assert.deepEqual(foreign.body, { error: 'Notification not found' });
});

test('mark-all-read updates only the caller, including a superadmin', () => {
  const store = createMemoryNotificationStore();
  store.deliver(notice(), [SUPERADMIN, USER_A, USER_B]);
  store.documents.push({
    _id: 'shared-legacy',
    type: 'system_alert',
    title: 'Notice',
    message: 'Fixture',
    roleTarget: 'all',
    read: false,
  });
  const updated = store.markAll(SUPERADMIN, []);
  assert.equal(updated, 1);
  const byUser = Object.fromEntries(store.documents.map((doc) => [doc.userId || 'shared', doc.read]));
  assert.equal(byUser[SUPERADMIN], true);
  assert.equal(byUser[USER_A], false);
  assert.equal(byUser[USER_B], false);
  assert.equal(byUser.shared, false);
  const query = ownedNotificationQuery(SUPERADMIN, [], { unreadOnly: true });
  assert.equal(query.userId, SUPERADMIN);
  assert.equal(query.read, false);
  assert.equal(JSON.stringify(query) === JSON.stringify({ read: false }), false);
});

test('two recipients of one announcement keep independent unread state', () => {
  const store = createMemoryNotificationStore();
  const delivered = store.deliver(notice({ roleTarget: 'student' }), [USER_A, USER_B]);
  assert.equal(delivered.length, 2);
  assert.equal(delivered[0].id === delivered[1].id, false);
  assert.equal(store.documents.length, 2);
  assert.equal(store.documents.every((doc) => doc.read === false), true);
  store.markRead(USER_A, delivered[0].id, []);
  assert.equal(store.list(USER_A, [])[0].read, true);
  assert.equal(store.list(USER_B, [])[0].read, false);
});

test('reading as one student does not change the other student', () => {
  const prepared = prepareRecipientNotifications(notice(), [USER_A, USER_B], []);
  assert.equal(prepared.copies.length, 2);
  assert.equal(prepared.copies[0].userId, USER_A);
  assert.equal(prepared.copies[1].userId, USER_B);
  assert.equal(prepared.copies[0].read, false);
  assert.equal(prepared.copies[1].read, false);
  const store = createMemoryNotificationStore();
  const delivered = store.deliver(notice(), [USER_A, USER_B]);
  store.markRead(USER_A, delivered.find((item) => item.userId === USER_A).id, []);
  const other = store.documents.find((doc) => doc.userId === USER_B);
  assert.equal(other.read, false);
});

test('a student cannot retrieve community messages for another room', () => {
  const member = student(USER_A, 'beginner');
  const roomIds = authorizedCommunityRoomIds(member, ROOMS);
  assert.deepEqual(roomIds, [BEGINNER_ROOM]);
  const store = createMemoryNotificationStore();
  store.deliver(notice({
    type: 'community_message',
    roomId: BEGINNER_ROOM,
    roleTarget: 'student',
  }), [USER_A]);
  store.deliver(notice({
    type: 'community_message',
    roomId: ADVANCED_ROOM,
    roleTarget: 'student',
  }), [USER_A, USER_B]);
  const visible = store.list(USER_A, roomIds);
  assert.equal(visible.length, 1);
  assert.equal(visible[0].roomId, BEGINNER_ROOM);
  assert.equal(visible.some((item) => item.roomId === ADVANCED_ROOM), false);
  assert.equal(visible.some((item) => item.userId === USER_B), false);
  assert.equal(notificationIsVisible({
    userId: USER_B,
    type: 'community_message',
    roomId: BEGINNER_ROOM,
  }, USER_A, roomIds), false);
});

test('student, instructor, admin, and superadmin each see only their own copy', () => {
  const store = createMemoryNotificationStore();
  const roles = [
    [USER_A, 'student'],
    [INSTRUCTOR, 'instructor'],
    [ADMIN, 'admin'],
    [SUPERADMIN, 'superadmin'],
  ];
  store.deliver(notice(), roles.map(([userId]) => userId));
  for (const [userId] of roles) {
    const rows = store.list(userId, []);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].userId, userId);
    assert.equal(rows[0].read, false);
  }
});

test('notification errors omit exception text', () => {
  const thrown = 'E11000 duplicate key on notifications';
  for (const kind of ['list', 'create', 'read', 'readAll', 'remove']) {
    const body = notificationErrorBody(kind);
    assert.equal(Object.prototype.hasOwnProperty.call(body, 'message'), false);
    assert.equal(JSON.stringify(body).includes(thrown), false);
    assert.equal(typeof body.error, 'string');
    assert.equal(body.error.length > 0, true);
  }
  for (const relativePath of ROUTES) {
    const source = fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
    assert.equal(source.includes('error.message'), false, relativePath);
    assert.equal(source.includes('message: errorMessage'), false, relativePath);
    assert.equal(source.includes('ownedNotificationQuery'), true, relativePath);
    assert.equal(source.includes('roomId: { $exists: true }'), false, relativePath);
    assert.equal(source.includes('query = { read: false }'), false, relativePath);
    assert.equal(source.includes('query = {}'), false, relativePath);
  }
});

test('a shared document is not marked read and a retry does not duplicate a personal copy', () => {
  const store = createMemoryNotificationStore();
  store.documents.push({
    _id: 'shared-legacy',
    type: 'instructor_announcement',
    title: 'Notice',
    message: 'Fixture',
    roleTarget: 'all',
    read: false,
    readBy: [USER_A, USER_B],
  });
  const marked = store.markRead(USER_A, 'shared-legacy', []);
  assert.equal(marked.status, 404);
  assert.equal(store.documents[0].read, false);
  const view = presentNotification(store.documents[0]);
  assert.equal(Object.prototype.hasOwnProperty.call(view, 'readBy'), false);
  assert.equal(JSON.stringify(view).includes(USER_B), false);

  const first = store.deliver(notice({ dedupeKey: 'event-1' }), [USER_A]);
  const second = store.deliver(notice({ dedupeKey: 'event-1' }), [USER_A]);
  assert.equal(second[0].id, first[0].id);
  assert.equal(store.documents.filter((doc) => doc.userId === USER_A && doc.dedupeKey === 'event-1').length, 1);
});

test('notification routes do not emit one shared payload to every socket', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'pages/api/notifications/index.ts'), 'utf8');
  assert.equal(source.includes('io.emit('), false);
  assert.equal(source.includes('updateMany({ read: false }'), false);
  assert.equal(source.includes('updateOne(\n      { _id:'), false);
});
