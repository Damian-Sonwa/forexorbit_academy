/**
 * Notifications API Route
 * GET: the caller's own notification copies
 * POST: create one copy per recipient (admin, instructor, superadmin)
 * PUT: mark one owned copy as read
 * DELETE: delete one owned copy
 */

import type { NextApiResponse } from 'next';
import { ObjectId } from 'mongodb';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { communityMember, isStoredId } from '@/lib/account-access';
import { getDb } from '@/lib/mongodb';
import { deliverNotification } from '@/lib/notifications';
import {
  NOTIFICATION_NOT_FOUND,
  authorizedCommunityRoomIds,
  logNotificationFailure,
  notificationErrorBody,
  ownedNotificationQuery,
  presentNotification,
} from '@/lib/notification-access';

export type NotificationType =
  | 'community_message'
  | 'instructor_announcement'
  | 'task_created'
  | 'task_updated'
  | 'task_submission'
  | 'task_feedback'
  | 'task_assignment'
  | 'live_class_reminder'
  | 'consultation_reminder'
  | 'system_alert';

export interface Notification {
  _id?: string;
  type: NotificationType;
  title: string;
  message: string;
  roleTarget?: 'student' | 'instructor' | 'admin' | 'superadmin' | 'all';
  userId?: string;
  roomId?: string;
  taskId?: string;
  relatedId?: string;
  read: boolean;
  createdAt: Date;
  metadata?: Record<string, any>;
}

async function viewerScope(db: Awaited<ReturnType<typeof getDb>>, userId: string) {
  const user = await db.collection('users').findOne(
    { _id: new ObjectId(userId) },
    { projection: { role: 1, learningLevel: 1, studentDetails: 1 } }
  );
  if (!user) return null;
  const member = communityMember(userId, user);
  const rooms = await db.collection('communityRooms')
    .find({}, { projection: { name: 1, type: 1, participants: 1 } })
    .toArray();
  return {
    member,
    roomIds: authorizedCommunityRoomIds(member, rooms),
  };
}

function ownedFilter(userId: string, roomIds: string[], unreadOnly = false) {
  return ownedNotificationQuery(userId, roomIds, { unreadOnly });
}

async function getNotifications(req: AuthRequest, res: NextApiResponse) {
  try {
    const db = await getDb();
    const scope = await viewerScope(db, req.user!.userId);
    if (!scope) {
      return res.status(404).json({ error: 'User not found' });
    }

    const limit = parseInt((req.query.limit as string) || '50', 10);
    const skip = parseInt((req.query.skip as string) || '0', 10);
    const unreadOnly = req.query.unreadOnly === 'true';
    const notificationDocs = await db.collection('notifications')
      .find(ownedFilter(req.user!.userId, scope.roomIds, unreadOnly))
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(skip)
      .toArray();

    const result = notificationDocs.map((doc) => presentNotification(doc));
    const unreadCount = result.filter((item) => !item.read).length;

    return res.json({
      notifications: result,
      unreadCount,
      total: result.length,
    });
  } catch {
    logNotificationFailure('notification-list');
    return res.status(500).json(notificationErrorBody('list'));
  }
}

async function createNotification(req: AuthRequest, res: NextApiResponse) {
  try {
    if (!['admin', 'instructor', 'superadmin'].includes(req.user!.role)) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const {
      type,
      title,
      message,
      roleTarget,
      userId,
      roomId,
      taskId,
      relatedId,
      metadata,
      dedupeKey,
    } = req.body || {};

    if (!type || !title || !message) {
      return res.status(400).json({ error: 'Missing required fields: type, title, message' });
    }

    const delivered = await deliverNotification({
      type,
      title,
      message,
      roleTarget: roleTarget || 'all',
      userId: typeof userId === 'string' ? userId : undefined,
      roomId: typeof roomId === 'string' ? roomId : undefined,
      taskId: typeof taskId === 'string' ? taskId : undefined,
      relatedId: typeof relatedId === 'string' ? relatedId : undefined,
      metadata: metadata && typeof metadata === 'object' ? metadata : {},
      dedupeKey: typeof dedupeKey === 'string' ? dedupeKey : undefined,
    });

    const io = req.io;
    if (io) {
      for (const item of delivered) {
        if (!item.created) continue;
        io.to(`user:${item.userId}`).emit('notification', {
          _id: item.id,
          type,
          title,
          message,
          roleTarget: roleTarget || 'all',
          userId: item.userId,
          roomId: typeof roomId === 'string' ? roomId : undefined,
          taskId: typeof taskId === 'string' ? taskId : undefined,
          relatedId: typeof relatedId === 'string' ? relatedId : undefined,
          read: false,
        });
      }
    }

    return res.status(201).json({
      success: true,
      delivered: delivered.length,
    });
  } catch {
    logNotificationFailure('notification-create');
    return res.status(500).json(notificationErrorBody('create'));
  }
}

async function markAsRead(req: AuthRequest, res: NextApiResponse) {
  try {
    const notificationId = req.body && typeof req.body.notificationId === 'string'
      ? req.body.notificationId
      : '';
    if (!isStoredId(notificationId)) {
      return res.status(404).json(NOTIFICATION_NOT_FOUND);
    }

    const db = await getDb();
    const scope = await viewerScope(db, req.user!.userId);
    if (!scope) {
      return res.status(404).json({ error: 'User not found' });
    }

    const result = await db.collection('notifications').updateOne(
      { ...ownedFilter(req.user!.userId, scope.roomIds), _id: new ObjectId(notificationId) },
      { $set: { read: true } }
    );
    if (result.matchedCount === 0) {
      return res.status(404).json(NOTIFICATION_NOT_FOUND);
    }
    return res.json({ success: true });
  } catch {
    logNotificationFailure('notification-read');
    return res.status(500).json(notificationErrorBody('read'));
  }
}

async function deleteNotification(req: AuthRequest, res: NextApiResponse) {
  try {
    const notificationId = req.body && typeof req.body.notificationId === 'string'
      ? req.body.notificationId
      : '';
    if (!isStoredId(notificationId)) {
      return res.status(404).json(NOTIFICATION_NOT_FOUND);
    }

    const db = await getDb();
    const scope = await viewerScope(db, req.user!.userId);
    if (!scope) {
      return res.status(404).json({ error: 'User not found' });
    }

    const result = await db.collection('notifications').deleteOne({
      ...ownedFilter(req.user!.userId, scope.roomIds),
      _id: new ObjectId(notificationId),
    });
    if (result.deletedCount === 0) {
      return res.status(404).json(NOTIFICATION_NOT_FOUND);
    }
    return res.json({ success: true });
  } catch {
    logNotificationFailure('notification-delete');
    return res.status(500).json(notificationErrorBody('remove'));
  }
}

async function handler(req: AuthRequest, res: NextApiResponse) {
  switch (req.method) {
    case 'GET':
      return getNotifications(req, res);
    case 'POST':
      return createNotification(req, res);
    case 'PUT':
      return markAsRead(req, res);
    case 'DELETE':
      return deleteNotification(req, res);
    default:
      return res.status(405).json({ error: 'Method not allowed' });
  }
}

export default withAuth(handler);
