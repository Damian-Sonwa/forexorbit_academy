'use strict';

/**
 * The single way a notification is created (Phase 14). lib/notifications.ts (API routes) and the
 * background worker (server.js) both call deliverToRecipients, so the event contract, the dedupe
 * key, preferences and channel plans are applied the same everywhere.
 *
 * Event contract (the stored per-recipient document): _id (event id), type, category, title,
 * message, userId (recipient), roleTarget, relatedId / taskId / roomId (resource reference),
 * metadata.href (in-app destination; the destination page checks access again), dedupeKey
 * (idempotency per recipient), createdAt, read, inApp, channels.{email,push} (delivery state).
 * Actor details are not copied into the event.
 */

const { ObjectId } = require('mongodb');
const { prepareRecipientNotifications } = require('../notification-access');
const { planChannels, realtimeEvent } = require('./delivery');
const metrics = require('./metrics');

async function deliverToRecipients(db, params, recipientIds, { io = metrics.socketServer(), now = new Date() } = {}) {
  const notifications = db.collection('notifications');
  const ids = [...new Set((recipientIds || []).map(String).filter((id) => id.trim() !== ''))];
  const dedupeKey = typeof params.dedupeKey === 'string' ? params.dedupeKey.trim() : '';
  const existing = dedupeKey && ids.length
    ? await notifications.find({ userId: { $in: ids }, dedupeKey }, { projection: { _id: 1, userId: 1 } }).toArray()
    : [];
  const prepared = prepareRecipientNotifications(params, ids, existing.map((doc) => ({ userId: doc.userId, id: doc._id.toString() })));
  const inserted = [];
  if (prepared.copies.length) {
    const valid = prepared.copies.map((c) => String(c.userId)).filter((id) => /^[a-f0-9]{24}$/i.test(id));
    const people = valid.length
      ? await db.collection('users').find({ _id: { $in: valid.map((id) => new ObjectId(id)) } }, { projection: { email: 1, status: 1, communicationPreferences: 1, emailSuppression: 1, pushDevices: 1 } }).toArray()
      : [];
    // Explicit ids: the event id is known before the insert and is the same in every channel.
    const copies = planChannels(prepared.copies.map((c) => ({ _id: new ObjectId(), ...c, createdAt: c.createdAt || now, ...(params.category ? { category: params.category } : {}) })), new Map(people.map((p) => [String(p._id), p])), now);
    let result;
    try {
      result = await notifications.insertMany(copies, { ordered: false });
    } catch (error) {
      // A concurrent delivery with the same dedupe key may have inserted some copies first.
      metrics.count('notificationFailures');
      throw error;
    }
    copies.forEach((copy, index) => {
      const id = result.insertedIds[index];
      if (!id) return;
      inserted.push({ id: String(id), userId: String(copy.userId), created: true });
      // Real time is a hint, never the record: a minimal event to the recipient's own room only.
      if (io && copy.inApp !== false) {
        io.to(`user:${copy.userId}`).emit('notification:new', realtimeEvent({ ...copy, _id: id }));
        metrics.count('realtimeEmitted');
      }
    });
  }
  return [...prepared.retained.map((item) => ({ ...item, created: false })), ...inserted];
}

module.exports = { deliverToRecipients };
