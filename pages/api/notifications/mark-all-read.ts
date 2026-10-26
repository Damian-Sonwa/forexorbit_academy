/**
 * Mark the caller's notification copies as read.
 * POST /api/notifications/mark-all-read
 */

import type { NextApiResponse } from 'next';
import { ObjectId } from 'mongodb';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { communityMember } from '@/lib/account-access';
import { getDb } from '@/lib/mongodb';
import {
  authorizedCommunityRoomIds,
  logNotificationFailure,
  notificationErrorBody,
  ownedNotificationQuery,
} from '@/lib/notification-access';

async function markAllAsRead(req: AuthRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const db = await getDb();
    const user = await db.collection('users').findOne(
      { _id: new ObjectId(req.user!.userId) },
      { projection: { role: 1, learningLevel: 1, studentDetails: 1 } }
    );
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const member = communityMember(req.user!.userId, user);
    const rooms = await db.collection('communityRooms')
      .find({}, { projection: { name: 1, type: 1, participants: 1 } })
      .toArray();
    const roomIds = authorizedCommunityRoomIds(member, rooms);
    const result = await db.collection('notifications').updateMany(
      ownedNotificationQuery(req.user!.userId, roomIds, { unreadOnly: true }),
      { $set: { read: true } }
    );

    return res.json({
      success: true,
      updatedCount: result.modifiedCount,
    });
  } catch {
    logNotificationFailure('notification-read-all');
    return res.status(500).json(notificationErrorBody('readAll'));
  }
}

export default withAuth(markAllAsRead);
