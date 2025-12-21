/**
 * Message Reaction API Route
 * POST: Add reaction to a message
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { canAccessRoom } from '@/lib/learning-level';

async function addReaction(req: AuthRequest, res: NextApiResponse) {
  try {
    const { id } = req.query;
    const { emoji } = req.body as { emoji?: string };

    if (!id || typeof id !== 'string' || !emoji || typeof emoji !== 'string') {
      return res.status(400).json({ error: 'Message ID and emoji are required' });
    }

    const db = await getDb();
    const messages = db.collection('communityMessages');
    const users = db.collection('users');

    // Get user info
    const user = await users.findOne(
      { _id: new ObjectId(req.user!.userId) },
      { projection: { name: 1 } }
    );

    // Check if user already reacted with this emoji
    const message = await messages.findOne({ _id: new ObjectId(id) });
    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    // Get room info to check access
    const rooms = db.collection('communityRooms');
    const room = await rooms.findOne({ _id: new ObjectId(message.roomId) });
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    // Get user's learning level
    const userDoc = await users.findOne(
      { _id: new ObjectId(req.user!.userId) },
      { projection: { learningLevel: 1, role: 1 } }
    );

    // Determine user's learning level
    // CRITICAL: Use tradingLevel from onboarding if learningLevel is not set
    let userLevel: 'beginner' | 'intermediate' | 'advanced' = 'beginner';
    if (userDoc?.role !== 'student') {
      userLevel = 'advanced';
    } else {
      userLevel = (userDoc?.learningLevel as 'beginner' | 'intermediate' | 'advanced') || 
                  (userDoc?.studentDetails?.tradingLevel as 'beginner' | 'intermediate' | 'advanced') || 
                  'beginner';
    }

    // Check access for global rooms - students can ONLY access their exact level room
    if (room.type === 'global' && ['Beginner', 'Intermediate', 'Advanced'].includes(room.name)) {
      if (!canAccessRoom(userLevel, room.name, userDoc?.role)) {
        return res.status(403).json({ 
          error: 'Access denied. You can only access the community room for your current level.' 
        });
      }
    }

    // Check access for direct messages
    if (room.type === 'direct' && !room.participants.includes(req.user!.userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const existingReaction = (message.reactions as Array<{ userId: string; emoji: string }> | undefined)?.find(
      (r) => r.userId === req.user!.userId && r.emoji === emoji
    );

    if (existingReaction) {
      // Remove reaction
      await messages.updateOne(
        { _id: new ObjectId(id) },
        {
          $pull: {
            reactions: { userId: req.user!.userId, emoji: emoji as string },
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
              userId: req.user!.userId,
              userName: (user?.name as string) || 'Unknown',
            },
          },
        } as any
      );
    }

    res.json({ success: true });
  } catch (error: unknown) {
    console.error('Add reaction error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    res.status(500).json({ error: errorMessage });
  }
}

export default withAuth(addReaction);

