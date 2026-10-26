/**
 * Notification writes.
 * Every inserted document has one userId. Role and room targets fan out
 * into personal copies. A dedupeKey skips a second copy for that recipient.
 */

import { ObjectId } from 'mongodb';
import { communityMember, decideCommunityRoomJoin, isStoredId } from '@/lib/account-access';
import { getDb } from './mongodb';
import { prepareRecipientNotifications } from '@/lib/notification-access';
import type { NotificationType } from '@/pages/api/notifications';

const KNOWN_ROLES = ['student', 'instructor', 'admin', 'superadmin'] as const;

export interface CreateNotificationParams {
  type: NotificationType;
  title: string;
  message: string;
  roleTarget?: 'student' | 'instructor' | 'admin' | 'superadmin' | 'all';
  userId?: string;
  roomId?: string;
  taskId?: string;
  relatedId?: string;
  metadata?: Record<string, unknown>;
  dedupeKey?: string;
}

export interface DeliveredNotification {
  id: string;
  userId: string;
  created: boolean;
}

async function recipientIdsFor(
  db: Awaited<ReturnType<typeof getDb>>,
  params: CreateNotificationParams,
  explicit?: string[]
): Promise<string[]> {
  if (explicit) {
    return explicit.map((id) => String(id)).filter((id) => id.trim() !== '');
  }
  if (typeof params.userId === 'string' && params.userId.trim()) {
    return [params.userId.trim()];
  }
  const role = params.roleTarget;
  const filter = role && role !== 'all'
    ? { role }
    : { role: { $in: [...KNOWN_ROLES] } };
  const users = await db.collection('users').find(filter).project({ _id: 1 }).toArray();
  return users.map((user) => user._id.toString());
}

export async function deliverNotification(
  params: CreateNotificationParams,
  explicitRecipientIds?: string[]
): Promise<DeliveredNotification[]> {
  const db = await getDb();
  const notifications = db.collection('notifications');
  const recipientIds = await recipientIdsFor(db, params, explicitRecipientIds);
  const dedupeKey = typeof params.dedupeKey === 'string' ? params.dedupeKey.trim() : '';
  const existing = dedupeKey
    ? await notifications
      .find({ userId: { $in: recipientIds }, dedupeKey }, { projection: { _id: 1, userId: 1 } })
      .toArray()
    : [];
  const prepared = prepareRecipientNotifications(
    params,
    recipientIds,
    existing.map((doc) => ({ userId: doc.userId, id: doc._id.toString() }))
  );
  const inserted: DeliveredNotification[] = [];
  if (prepared.copies.length > 0) {
    const result = await notifications.insertMany(prepared.copies);
    prepared.copies.forEach((copy, index) => {
      const id = result.insertedIds[index];
      if (id) inserted.push({ id: id.toString(), userId: String(copy.userId), created: true });
    });
  }
  return [
    ...prepared.retained.map((item) => ({ ...item, created: false })),
    ...inserted,
  ];
}

/**
 * Create a personal notification, or one copy per resolved recipient.
 * Returns the first id. Callers that need every id should use deliverNotification.
 */
export async function createNotification(params: CreateNotificationParams): Promise<string> {
  const delivered = await deliverNotification(params);
  return delivered[0]?.id || '';
}

/**
 * Create one notification copy per user.
 */
export async function createNotificationsForUsers(
  userIds: string[],
  params: Omit<CreateNotificationParams, 'userId'>
): Promise<string[]> {
  const delivered = await deliverNotification(params, userIds);
  return delivered.map((item) => item.id);
}

/**
 * Create one notification copy for each user with this role.
 */
export async function createNotificationForRole(
  role: 'student' | 'instructor' | 'admin' | 'superadmin',
  params: Omit<CreateNotificationParams, 'roleTarget' | 'userId'>
): Promise<string[]> {
  const db = await getDb();
  const targetUsers = await db.collection('users')
    .find({ role })
    .project({ _id: 1 })
    .toArray();
  const userIds = targetUsers.map((user) => user._id.toString());
  if (userIds.length === 0) return [];
  return createNotificationsForUsers(userIds, {
    ...params,
    roleTarget: role,
  });
}

/**
 * Create one copy for each user the room membership rules allow.
 * A room id alone is not stored as a shared document.
 */
export async function createNotificationForRoom(
  roomId: string,
  params: Omit<CreateNotificationParams, 'roomId'>
): Promise<string[]> {
  if (!isStoredId(roomId)) return [];
  const db = await getDb();
  const room = await db.collection('communityRooms').findOne(
    { _id: new ObjectId(roomId) },
    { projection: { name: 1, type: 1, participants: 1 } }
  );
  if (!room) return [];
  const users = await db.collection('users')
    .find({ role: { $in: [...KNOWN_ROLES] } })
    .project({ role: 1, learningLevel: 1, studentDetails: 1 })
    .toArray();
  const storedRoomId = room._id.toString();
  const recipientIds = users
    .filter((user) => {
      const member = communityMember(user._id.toString(), user);
      return decideCommunityRoomJoin({ user: member, roomId: storedRoomId, room }).ok;
    })
    .map((user) => user._id.toString());
  const delivered = await deliverNotification(
    { ...params, roomId: storedRoomId },
    recipientIds
  );
  return delivered.map((item) => item.id);
}
