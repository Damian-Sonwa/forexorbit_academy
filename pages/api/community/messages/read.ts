/**
 * Mark Messages as Read API Route
 * POST: Mark all messages in a room as read
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { communityMember, decideCommunityMessageAccess, isStoredId } from '@/lib/account-access';

async function markAsRead(req: AuthRequest, res: NextApiResponse) {
  try {
    const roomId = req.body && typeof req.body.roomId === 'string' ? req.body.roomId : '';
    if (!isStoredId(roomId)) {
      return res.status(400).json({ error: 'Room ID is required' });
    }

    const db = await getDb();
    const messages = db.collection('communityMessages');
    const rooms = db.collection('communityRooms');
    const users = db.collection('users');

    // Get room info to check access
    const room = await rooms.findOne({ _id: new ObjectId(roomId) });
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    const user = await users.findOne(
      { _id: new ObjectId(req.user!.userId) },
      { projection: { learningLevel: 1, role: 1, studentDetails: 1 } }
    );
    const access = decideCommunityMessageAccess({
      member: communityMember(req.user!.userId, user),
      room,
    });
    if (!access.ok) {
      return res.status(access.status).json({ error: access.error });
    }

    // Mark all unread messages in the room as read
    await messages.updateMany(
      {
        roomId: access.roomId,
        senderId: { $ne: req.user!.userId },
        seenBy: { $ne: req.user!.userId },
      },
      {
        $addToSet: { seenBy: req.user!.userId },
      }
    );

    res.json({ success: true });
  } catch {
    console.error(JSON.stringify({ event: 'communityMessagesReadState', result: 'failed' }));
    res.status(500).json({ error: 'Internal server error' });
  }
}

export default withAuth(markAsRead);

