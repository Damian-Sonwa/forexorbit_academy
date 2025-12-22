/**
 * Notification Utility Functions
 * Helper functions for creating and managing notifications
 */

import { getDb } from './mongodb';
import type { NotificationType } from '@/pages/api/notifications';

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
}

/**
 * Create a notification in the database
 * This should be called from API routes or server-side code
 */
export async function createNotification(params: CreateNotificationParams): Promise<string> {
  const db = await getDb();
  const notifications = db.collection('notifications');

  const notification = {
    type: params.type,
    title: params.title,
    message: params.message,
    roleTarget: params.roleTarget || 'all',
    userId: params.userId || undefined,
    roomId: params.roomId || undefined,
    taskId: params.taskId || undefined,
    relatedId: params.relatedId || undefined,
    read: false,
    createdAt: new Date(),
    metadata: params.metadata || {},
  };

  const result = await notifications.insertOne(notification);
  return result.insertedId.toString();
}

/**
 * Create notifications for multiple users
 */
export async function createNotificationsForUsers(
  userIds: string[],
  params: Omit<CreateNotificationParams, 'userId'>
): Promise<string[]> {
  const db = await getDb();
  const notifications = db.collection('notifications');

  const notificationDocs = userIds.map((userId) => ({
    ...params,
    userId,
    roleTarget: params.roleTarget || 'all',
    read: false,
    createdAt: new Date(),
    metadata: params.metadata || {},
  }));

  const result = await notifications.insertMany(notificationDocs);
  return Object.values(result.insertedIds).map((id) => id.toString());
}

/**
 * Create notification for all users with a specific role
 */
export async function createNotificationForRole(
  role: 'student' | 'instructor' | 'admin' | 'superadmin',
  params: Omit<CreateNotificationParams, 'roleTarget' | 'userId'>
): Promise<string[]> {
  const db = await getDb();
  const users = db.collection('users');

  // Get all users with this role
  const targetUsers = await users
    .find({ role })
    .project({ _id: 1 })
    .toArray();

  const userIds = targetUsers.map((u) => u._id.toString());

  if (userIds.length === 0) {
    return [];
  }

  return createNotificationsForUsers(userIds, {
    ...params,
    roleTarget: role,
  });
}

/**
 * Create notification for users in a specific room
 */
export async function createNotificationForRoom(
  roomId: string,
  params: Omit<CreateNotificationParams, 'roomId'>
): Promise<string> {
  return createNotification({
    ...params,
    roomId,
  });
}

