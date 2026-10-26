/**
 * Per-recipient notification rules.
 * Each stored row belongs to one userId. Read flags are never shared.
 * Room membership comes from decideCommunityRoomJoin, not from a client room id.
 */

const { decideCommunityRoomJoin } = require('./account-access');

const NOTIFICATION_NOT_FOUND = { error: 'Notification not found' };

const NOTIFICATION_ERRORS = {
  list: 'Failed to fetch notifications',
  create: 'Failed to create notification',
  read: 'Failed to mark notification as read',
  readAll: 'Failed to mark all as read',
  remove: 'Failed to delete notification',
};

function notificationErrorBody(kind) {
  return { error: NOTIFICATION_ERRORS[kind] || 'Internal server error' };
}

function logNotificationFailure(event) {
  console.error(JSON.stringify({ event, result: 'failed' }));
}

function sameId(left, right) {
  return String(left) === String(right);
}

function cleanId(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function authorizedCommunityRoomIds(member, rooms) {
  const ids = [];
  const list = Array.isArray(rooms) ? rooms : [];
  for (const room of list) {
    if (!room || room._id == null) continue;
    const roomId = String(room._id);
    const decision = decideCommunityRoomJoin({ user: member, roomId, room });
    if (decision.ok && decision.publicRoom !== true) ids.push(decision.roomId);
  }
  return ids;
}

function notificationIsVisible(doc, userId, authorizedRoomIds) {
  if (!doc || doc.userId == null || !sameId(doc.userId, userId)) return false;
  if (doc.type !== 'community_message') return true;
  const roomId = doc.roomId == null ? '' : String(doc.roomId);
  if (!roomId) return true;
  const allowed = Array.isArray(authorizedRoomIds) ? authorizedRoomIds.map((id) => String(id)) : [];
  return allowed.includes(roomId);
}

function ownedNotificationQuery(userId, authorizedRoomIds, options) {
  const rooms = Array.isArray(authorizedRoomIds) ? authorizedRoomIds.map((id) => String(id)) : [];
  const query = {
    userId: String(userId || ''),
    $or: [
      { type: { $ne: 'community_message' } },
      { type: 'community_message', roomId: { $in: rooms } },
      { type: 'community_message', roomId: { $exists: false } },
      { type: 'community_message', roomId: null },
      { type: 'community_message', roomId: '' },
    ],
  };
  if (options && options.unreadOnly) query.read = false;
  return query;
}

function presentNotification(doc) {
  const source = doc && typeof doc === 'object' ? doc : {};
  const view = {
    _id: source._id == null ? '' : String(source._id),
    type: typeof source.type === 'string' ? source.type : '',
    title: typeof source.title === 'string' ? source.title : '',
    message: typeof source.message === 'string' ? source.message : '',
    roleTarget: typeof source.roleTarget === 'string' ? source.roleTarget : undefined,
    userId: source.userId == null ? undefined : String(source.userId),
    read: source.read === true,
    createdAt: source.createdAt == null ? null : source.createdAt,
    metadata: source.metadata && typeof source.metadata === 'object' ? source.metadata : {},
  };
  if (source.roomId != null && String(source.roomId)) view.roomId = String(source.roomId);
  if (source.taskId != null && String(source.taskId)) view.taskId = String(source.taskId);
  if (source.relatedId != null && String(source.relatedId)) view.relatedId = String(source.relatedId);
  return view;
}

function personalCopy(params, userId, dedupeKey, createdAt) {
  const source = params && typeof params === 'object' ? params : {};
  const doc = {
    type: source.type,
    title: source.title,
    message: source.message,
    roleTarget: source.roleTarget || 'all',
    userId: String(userId),
    read: false,
    createdAt: createdAt instanceof Date ? createdAt : new Date(),
    metadata: source.metadata && typeof source.metadata === 'object' ? source.metadata : {},
  };
  if (cleanId(source.roomId)) doc.roomId = cleanId(source.roomId);
  if (cleanId(source.taskId)) doc.taskId = cleanId(source.taskId);
  if (cleanId(source.relatedId)) doc.relatedId = cleanId(source.relatedId);
  if (dedupeKey) doc.dedupeKey = dedupeKey;
  return doc;
}

function prepareRecipientNotifications(params, recipientIds, existing) {
  const source = params && typeof params === 'object' ? params : {};
  const dedupeKey = cleanId(source.dedupeKey);
  const existingByUser = new Map();
  if (dedupeKey) {
    for (const row of Array.isArray(existing) ? existing : []) {
      if (!row || row.userId == null || row.id == null) continue;
      existingByUser.set(String(row.userId), String(row.id));
    }
  }
  const createdAt = new Date();
  const copies = [];
  const retained = [];
  const seen = new Set();
  for (const raw of Array.isArray(recipientIds) ? recipientIds : []) {
    const userId = cleanId(typeof raw === 'string' ? raw : raw == null ? '' : String(raw));
    if (!userId || seen.has(userId)) continue;
    seen.add(userId);
    if (dedupeKey && existingByUser.has(userId)) {
      retained.push({ id: existingByUser.get(userId), userId });
      continue;
    }
    copies.push(personalCopy(source, userId, dedupeKey, createdAt));
  }
  return { copies, retained };
}

function createMemoryNotificationStore() {
  const documents = [];
  let sequence = 0;

  function nextId() {
    sequence += 1;
    return `mem-${sequence}`;
  }

  return {
    documents,
    deliver(params, recipientIds) {
      const dedupeKey = cleanId(params && params.dedupeKey);
      const existing = dedupeKey
        ? documents
          .filter((doc) => doc.dedupeKey === dedupeKey)
          .map((doc) => ({ userId: doc.userId, id: doc._id }))
        : [];
      const prepared = prepareRecipientNotifications(params, recipientIds, existing);
      const inserted = prepared.copies.map((copy) => {
        const doc = { ...copy, _id: nextId() };
        documents.push(doc);
        return { id: doc._id, userId: doc.userId };
      });
      return retainedAndInserted(prepared.retained, inserted);
    },
    list(userId, authorizedRoomIds) {
      return documents
        .filter((doc) => notificationIsVisible(doc, userId, authorizedRoomIds))
        .map((doc) => presentNotification(doc));
    },
    markRead(userId, notificationId, authorizedRoomIds) {
      const doc = documents.find((item) => sameId(item._id, notificationId)
        && notificationIsVisible(item, userId, authorizedRoomIds));
      if (!doc) return { status: 404, body: { ...NOTIFICATION_NOT_FOUND } };
      doc.read = true;
      return { status: 200, body: { success: true } };
    },
    markAll(userId, authorizedRoomIds) {
      let updated = 0;
      for (const doc of documents) {
        if (doc.read === true) continue;
        if (!notificationIsVisible(doc, userId, authorizedRoomIds)) continue;
        doc.read = true;
        updated += 1;
      }
      return updated;
    },
  };
}

function retainedAndInserted(retained, inserted) {
  return [...retained, ...inserted];
}

module.exports = {
  NOTIFICATION_NOT_FOUND,
  NOTIFICATION_ERRORS,
  notificationErrorBody,
  logNotificationFailure,
  authorizedCommunityRoomIds,
  notificationIsVisible,
  ownedNotificationQuery,
  presentNotification,
  prepareRecipientNotifications,
  createMemoryNotificationStore,
};
