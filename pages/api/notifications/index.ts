/**
 * Notifications API Route
 * GET: Get user's notifications (role-aware)
 * POST: Create notification (admin/instructor only)
 * PUT: Mark notification as read
 * DELETE: Delete notification
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

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
  userId?: string; // Target user ID
  roomId?: string; // For room-specific notifications
  taskId?: string; // For task-related notifications
  relatedId?: string; // Generic related entity ID
  read: boolean;
  createdAt: Date;
  metadata?: Record<string, any>;
}

async function getNotifications(req: AuthRequest, res: NextApiResponse) {
  try {
    const db = await getDb();
    const notifications = db.collection('notifications');
    const users = db.collection('users');

    const user = await users.findOne(
      { _id: new ObjectId(req.user!.userId) },
      { projection: { role: 1, learningLevel: 1, studentDetails: 1 } }
    );

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Build query based on user role
    let query: any = {};

    if (user.role === 'superadmin') {
      // Super admin sees all notifications
      query = {};
    } else if (user.role === 'admin') {
      // Admin sees admin and system notifications
      query = {
        $or: [
          { roleTarget: 'admin' },
          { roleTarget: 'all' },
          { userId: req.user!.userId },
          { roleTarget: { $exists: false } } // Legacy notifications
        ]
      };
    } else if (user.role === 'instructor') {
      // Instructors see instructor notifications and their own
      query = {
        $or: [
          { roleTarget: 'instructor' },
          { roleTarget: 'all' },
          { userId: req.user!.userId }
        ]
      };
    } else if (user.role === 'student') {
      // Students see student notifications, their own, and room-specific
      const userLevel = user.learningLevel || user.studentDetails?.tradingLevel || 'beginner';
      const levelRoomMap: Record<string, string> = {
        'beginner': 'Beginner',
        'intermediate': 'Intermediate',
        'advanced': 'Advanced'
      };
      const roomName = levelRoomMap[userLevel.toLowerCase()];

      query = {
        $or: [
          { roleTarget: 'student' },
          { roleTarget: 'all' },
          { userId: req.user!.userId },
          // Room-specific notifications for their level
          { 
            type: 'community_message',
            roomId: { $exists: true }
          }
        ]
      };
    }

    // Get query parameters
    const limit = parseInt((req.query.limit as string) || '50', 10);
    const skip = parseInt((req.query.skip as string) || '0', 10);
    const unreadOnly = req.query.unreadOnly === 'true';

    if (unreadOnly) {
      query.read = false;
    }

    // Fetch notifications
    const notificationDocs = await notifications
      .find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(skip)
      .toArray();

    // For students, filter room-specific messages by their actual room
    let filteredNotifications = notificationDocs;
    if (user.role === 'student' && user.learningLevel) {
      const userLevel = user.learningLevel || user.studentDetails?.tradingLevel || 'beginner';
      const levelRoomMap: Record<string, string> = {
        'beginner': 'Beginner',
        'intermediate': 'Intermediate',
        'advanced': 'Advanced'
      };
      const roomName = levelRoomMap[userLevel.toLowerCase()];

      // Get user's room ID
      const rooms = db.collection('communityRooms');
      const userRoom = await rooms.findOne({ name: roomName, type: 'global' });

      if (userRoom) {
        filteredNotifications = notificationDocs.filter((notif) => {
          // If it's a room message, only show if it's for their room
          if (notif.type === 'community_message' && notif.roomId) {
            return notif.roomId === userRoom._id.toString();
          }
          return true;
        });
      }
    }

    const result = filteredNotifications.map((notif) => ({
      _id: notif._id.toString(),
      type: notif.type,
      title: notif.title,
      message: notif.message,
      roleTarget: notif.roleTarget,
      userId: notif.userId,
      roomId: notif.roomId,
      taskId: notif.taskId,
      relatedId: notif.relatedId,
      read: notif.read || false,
      createdAt: notif.createdAt,
      metadata: notif.metadata || {},
    }));

    const unreadCount = result.filter((n) => !n.read).length;

    res.json({
      notifications: result,
      unreadCount,
      total: result.length,
    });
  } catch (error: unknown) {
    console.error('Get notifications error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    res.status(500).json({ error: 'Failed to fetch notifications', message: errorMessage });
  }
}

async function createNotification(req: AuthRequest, res: NextApiResponse) {
  try {
    // Only admin, instructor, and superadmin can create notifications
    if (!['admin', 'instructor', 'superadmin'].includes(req.user!.role)) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const db = await getDb();
    const notifications = db.collection('notifications');

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
    } = req.body;

    if (!type || !title || !message) {
      return res.status(400).json({ error: 'Missing required fields: type, title, message' });
    }

    const notification: Omit<Notification, '_id'> = {
      type,
      title,
      message,
      roleTarget: roleTarget || 'all',
      userId: userId || undefined,
      roomId: roomId || undefined,
      taskId: taskId || undefined,
      relatedId: relatedId || undefined,
      read: false,
      createdAt: new Date(),
      metadata: metadata || {},
    };

    const result = await notifications.insertOne(notification);

    // Emit socket event for real-time notification
    if (req.io) {
      const io = req.io; // Store in local variable for type narrowing
      // Determine who should receive this notification
      let targetUsers: string[] = [];
      
      if (userId) {
        targetUsers = [userId];
      } else if (roleTarget && roleTarget !== 'all') {
        // Get all users with this role
        const users = db.collection('users');
        const targetUserDocs = await users
          .find({ role: roleTarget })
          .project({ _id: 1 })
          .toArray();
        targetUsers = targetUserDocs.map((u) => u._id.toString());
      } else {
        // Broadcast to all (for 'all' or no roleTarget)
        io.emit('notification', {
          ...notification,
          _id: result.insertedId.toString(),
        });
      }

      // Emit to specific users
      targetUsers.forEach((targetUserId) => {
        io.to(`user:${targetUserId}`).emit('notification', {
          ...notification,
          _id: result.insertedId.toString(),
        });
      });
    }

    res.status(201).json({
      success: true,
      notification: {
        ...notification,
        _id: result.insertedId.toString(),
      },
    });
  } catch (error: unknown) {
    console.error('Create notification error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    res.status(500).json({ error: 'Failed to create notification', message: errorMessage });
  }
}

async function markAsRead(req: AuthRequest, res: NextApiResponse) {
  try {
    const { notificationId } = req.body;

    if (!notificationId) {
      return res.status(400).json({ error: 'Notification ID is required' });
    }

    const db = await getDb();
    const notifications = db.collection('notifications');

    // Verify notification belongs to user or is accessible to them
    const notification = await notifications.findOne({
      _id: new ObjectId(notificationId),
    });

    if (!notification) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    // Update notification
    await notifications.updateOne(
      { _id: new ObjectId(notificationId) },
      { $set: { read: true } }
    );

    res.json({ success: true });
  } catch (error: unknown) {
    console.error('Mark as read error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    res.status(500).json({ error: 'Failed to mark notification as read', message: errorMessage });
  }
}

async function markAllAsRead(req: AuthRequest, res: NextApiResponse) {
  try {
    const db = await getDb();
    const notifications = db.collection('notifications');
    const users = db.collection('users');

    const user = await users.findOne(
      { _id: new ObjectId(req.user!.userId) },
      { projection: { role: 1 } }
    );

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Build query based on role (same as getNotifications)
    let query: any = { read: false };

    if (user.role === 'superadmin') {
      query = { read: false };
    } else if (user.role === 'admin') {
      query = {
        read: false,
        $or: [
          { roleTarget: 'admin' },
          { roleTarget: 'all' },
          { userId: req.user!.userId },
        ]
      };
    } else if (user.role === 'instructor') {
      query = {
        read: false,
        $or: [
          { roleTarget: 'instructor' },
          { roleTarget: 'all' },
          { userId: req.user!.userId },
        ]
      };
    } else if (user.role === 'student') {
      query = {
        read: false,
        $or: [
          { roleTarget: 'student' },
          { roleTarget: 'all' },
          { userId: req.user!.userId },
        ]
      };
    }

    await notifications.updateMany(query, { $set: { read: true } });

    res.json({ success: true });
  } catch (error: unknown) {
    console.error('Mark all as read error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    res.status(500).json({ error: 'Failed to mark all as read', message: errorMessage });
  }
}

async function deleteNotification(req: AuthRequest, res: NextApiResponse) {
  try {
    const { notificationId } = req.body;

    if (!notificationId) {
      return res.status(400).json({ error: 'Notification ID is required' });
    }

    const db = await getDb();
    const notifications = db.collection('notifications');

    // Verify notification belongs to user
    const notification = await notifications.findOne({
      _id: new ObjectId(notificationId),
      userId: req.user!.userId,
    });

    if (!notification) {
      return res.status(404).json({ error: 'Notification not found or unauthorized' });
    }

    await notifications.deleteOne({ _id: new ObjectId(notificationId) });

    res.json({ success: true });
  } catch (error: unknown) {
    console.error('Delete notification error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    res.status(500).json({ error: 'Failed to delete notification', message: errorMessage });
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

