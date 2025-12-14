/**
 * Mark Messages as Read API Route
 * POST: Mark all messages in a room as read
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { canAccessRoom } from '@/lib/learning-level';

async function markAsRead(req: AuthRequest, res: NextApiResponse) {
  try {
    const { roomId } = req.body;

    if (!roomId) {
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

    // Get user's learning level
    const user = await users.findOne(
      { _id: new ObjectId(req.user!.userId) },
      { projection: { learningLevel: 1, role: 1 } }
    );

    // Determine user's learning level
    let userLevel: 'beginner' | 'intermediate' | 'advanced' = 'beginner';
    if (user?.role !== 'student') {
      userLevel = 'advanced';
    } else {
      userLevel = (user?.learningLevel as 'beginner' | 'intermediate' | 'advanced') || 'beginner';
    }

    // Check access for global rooms
    if (room.type === 'global' && ['Beginner', 'Intermediate', 'Advanced'].includes(room.name)) {
      if (!canAccessRoom(userLevel, room.name)) {
        return res.status(403).json({ 
          error: 'Access denied. Complete the previous level to unlock this group.' 
        });
      }
    }

    // Check access for direct messages
    if (room.type === 'direct' && !room.participants.includes(req.user!.userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Mark all unread messages in the room as read
    await messages.updateMany(
      {
        roomId,
        senderId: { $ne: req.user!.userId },
        seenBy: { $ne: req.user!.userId },
      },
      {
        $addToSet: { seenBy: req.user!.userId },
      }
    );

    res.json({ success: true });
  } catch (error: any) {
    console.error('Mark as read error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

export default withAuth(markAsRead);

