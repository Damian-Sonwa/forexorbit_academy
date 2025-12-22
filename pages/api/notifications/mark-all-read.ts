/**
 * Mark All Notifications as Read API Route
 * POST /api/notifications/mark-all-read
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

async function markAllAsRead(req: AuthRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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

    const result = await notifications.updateMany(query, { $set: { read: true } });

    res.json({ 
      success: true,
      updatedCount: result.modifiedCount 
    });
  } catch (error: unknown) {
    console.error('Mark all as read error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    res.status(500).json({ error: 'Failed to mark all as read', message: errorMessage });
  }
}

export default withAuth(markAllAsRead);

