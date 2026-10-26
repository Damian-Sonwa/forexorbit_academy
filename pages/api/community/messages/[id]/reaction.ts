/**
 * Message Reaction API Route
 * POST: Add reaction to a message
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { communityMember, decideCommunityMessageAccess, isStoredId } from '@/lib/account-access';

async function addReaction(req: AuthRequest, res: NextApiResponse) {
  try {
    const { id } = req.query;
    const { emoji } = req.body as { emoji?: string };

    if (!isStoredId(id) || !emoji || typeof emoji !== 'string') {
      return res.status(400).json({ error: 'Message ID and emoji are required' });
    }

    const db = await getDb();
    const messages = db.collection('communityMessages');
    const users = db.collection('users');

    const message = await messages.findOne({ _id: new ObjectId(id) });
    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    // Get room info to check access
    if (!isStoredId(String(message.roomId))) {
      return res.status(404).json({ error: 'Room not found' });
    }
    const rooms = db.collection('communityRooms');
    const room = await rooms.findOne({ _id: new ObjectId(String(message.roomId)) });
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    const userDoc = await users.findOne(
      { _id: new ObjectId(req.user!.userId) },
      { projection: { learningLevel: 1, role: 1, studentDetails: 1, name: 1 } }
    );
    const access = decideCommunityMessageAccess({
      member: communityMember(req.user!.userId, userDoc),
      room,
    });
    if (!access.ok) {
      return res.status(access.status).json({ error: access.error });
    }

    const existingReaction = (message.reactions as Array<{ userId: string; emoji: string }> | undefined)?.find(
      (r) => r.userId === access.senderId && r.emoji === emoji
    );

    if (existingReaction) {
      // Remove reaction
      await messages.updateOne(
        { _id: new ObjectId(id) },
        {
          $pull: {
            reactions: { userId: access.senderId, emoji: emoji as string },
          },
        } as any
      );
    } else {
      // Add reaction
      await messages.updateOne(
        { _id: new ObjectId(id) },
        {
          $push: {
            reactions: {
              emoji: emoji as string,
              userId: access.senderId,
              userName: (userDoc?.name as string) || 'Unknown',
            },
          },
        } as any
      );
    }

    res.json({ success: true });
  } catch {
    console.error(JSON.stringify({ event: 'communityReaction', result: 'failed' }));
    res.status(500).json({ error: 'Internal server error' });
  }
}

export default withAuth(addReaction);

