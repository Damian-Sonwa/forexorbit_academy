/**
 * Community Messages API Route
 * GET: Get messages for a room
 * POST: Send a new message
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { canAccessRoom } from '@/lib/learning-level';

async function getMessages(req: AuthRequest, res: NextApiResponse) {
  try {
    const { roomId } = req.query;

    if (!roomId || typeof roomId !== 'string') {
      return res.status(400).json({ error: 'Room ID is required' });
    }

    // Check if roomId is a valid ObjectId (not a placeholder)
    if (!ObjectId.isValid(roomId)) {
      console.warn('Invalid roomId format:', roomId);
      return res.status(400).json({ error: 'Invalid room ID format' });
    }

    const db = await getDb();
    const messages = db.collection('communityMessages');
    const users = db.collection('users');
    const rooms = db.collection('communityRooms');

    // Get room info to check access
    const roomIdObj = new ObjectId(roomId);
    const room = await rooms.findOne({ _id: roomIdObj });
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    // Get user's learning level and onboarding status
    const user = await users.findOne(
      { _id: new ObjectId(req.user!.userId) },
      { projection: { learningLevel: 1, role: 1, studentDetails: 1 } }
    );

    // Check if student has completed onboarding
    const hasCompletedOnboarding = !user || user.role !== 'student' || 
      (user.studentDetails && user.studentDetails.completedAt);

    // Students must complete onboarding before accessing rooms
    if (user?.role === 'student' && !hasCompletedOnboarding) {
      return res.status(403).json({ 
        error: 'Access denied. Please complete the onboarding form to access community rooms.' 
      });
    }

    // Determine user's learning level
    // CRITICAL: Use tradingLevel from onboarding if learningLevel is not set
    let userLevel: 'beginner' | 'intermediate' | 'advanced' = 'beginner';
    if (user?.role !== 'student') {
      userLevel = 'advanced';
    } else {
      userLevel = (user?.learningLevel as 'beginner' | 'intermediate' | 'advanced') || 
                  (user?.studentDetails?.tradingLevel as 'beginner' | 'intermediate' | 'advanced') || 
                  'beginner';
    }

    // Check access for global rooms - students can ONLY access their exact level room
    if (room.type === 'global' && ['Beginner', 'Intermediate', 'Advanced'].includes(room.name)) {
      if (!canAccessRoom(userLevel, room.name, user?.role)) {
        return res.status(403).json({ 
          error: 'Access denied. You can only access the community room for your current level.' 
        });
      }
    }

    // Check access for direct messages
    if (room.type === 'direct' && !room.participants.includes(req.user!.userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const pageNum = parseInt((req.query.page as string) || '1', 10);
    const limitNum = parseInt((req.query.limit as string) || '50', 10);
    const skip = (pageNum - 1) * limitNum;

    // Get messages for the room with pagination
    // Messages are level-specific - only return messages for this specific room
    const messageDocs = await messages
      .find({ 
        $or: [
          { roomId: roomIdObj.toString() }, // String format
          { roomId: roomIdObj } // ObjectId format
        ]
      })
      .sort({ createdAt: -1 }) // Sort descending to get newest first
      .skip(skip)
      .limit(limitNum)
      .toArray();

    // Enrich messages with sender info
    const enrichedMessages = await Promise.all(
      messageDocs.map(async (msg) => {
        const sender = await users.findOne(
          { _id: new ObjectId(msg.senderId) },
          { projection: { name: 1, profilePhoto: 1 } }
        );

        return {
          _id: msg._id.toString(),
          roomId: msg.roomId,
          senderId: msg.senderId,
          senderName: sender?.name || 'Unknown',
          senderPhoto: sender?.profilePhoto || null,
          type: msg.type,
          content: msg.content,
          fileUrl: msg.fileUrl || null,
          fileName: msg.fileName || null,
          fileSize: msg.fileSize || null,
          reactions: msg.reactions || [],
          seenBy: msg.seenBy || [],
          delivered: msg.delivered || false,
          createdAt: msg.createdAt,
        };
      })
    );

    // Reverse to show oldest first (for pagination when loading older messages)
    res.json(enrichedMessages.reverse());
  } catch (error: any) {
    console.error('Get messages error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

async function sendMessage(req: AuthRequest, res: NextApiResponse) {
  try {
    const { roomId, type, content } = req.body;

    if (!roomId || !type || !content) {
      return res.status(400).json({ error: 'Room ID, type, and content are required' });
    }

    // Check if roomId is a valid ObjectId (not a placeholder)
    if (!ObjectId.isValid(roomId)) {
      console.warn('Invalid roomId format:', roomId);
      return res.status(400).json({ error: 'Invalid room ID format. Please select a valid room.' });
    }

    const db = await getDb();
    const messages = db.collection('communityMessages');
    const rooms = db.collection('communityRooms');
    const users = db.collection('users');

    // Verify room exists and user has access
    const roomIdObj = new ObjectId(roomId);
    const room = await rooms.findOne({ _id: roomIdObj });
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    // Get user's learning level and onboarding status
    const user = await users.findOne(
      { _id: new ObjectId(req.user!.userId) },
      { projection: { learningLevel: 1, role: 1, studentDetails: 1 } }
    );

    // Check if student has completed onboarding
    const hasCompletedOnboarding = !user || user.role !== 'student' || 
      (user.studentDetails && user.studentDetails.completedAt);

    // Students must complete onboarding before accessing rooms
    if (user?.role === 'student' && !hasCompletedOnboarding) {
      return res.status(403).json({ 
        error: 'Access denied. Please complete the onboarding form to access community rooms.' 
      });
    }

    // Determine user's learning level
    // CRITICAL: Use tradingLevel from onboarding if learningLevel is not set
    let userLevel: 'beginner' | 'intermediate' | 'advanced' = 'beginner';
    if (user?.role !== 'student') {
      userLevel = 'advanced';
    } else {
      userLevel = (user?.learningLevel as 'beginner' | 'intermediate' | 'advanced') || 
                  (user?.studentDetails?.tradingLevel as 'beginner' | 'intermediate' | 'advanced') || 
                  'beginner';
    }

    // Check access for global rooms - students can ONLY access their exact level room
    if (room.type === 'global' && ['Beginner', 'Intermediate', 'Advanced'].includes(room.name)) {
      if (!canAccessRoom(userLevel, room.name, user?.role)) {
        return res.status(403).json({ 
          error: 'Access denied. You can only access the community room for your current level.' 
        });
      }
    }

    // Check access for direct messages
    if (room.type === 'direct' && !room.participants?.includes(req.user!.userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Get sender info
    const sender = await users.findOne(
      { _id: new ObjectId(req.user!.userId) },
      { projection: { name: 1, profilePhoto: 1 } }
    );

    // Create message - level-specific (tied to this room)
    const message = {
      roomId: roomIdObj.toString(), // Store as string for consistency - level-specific
      senderId: req.user!.userId,
      type,
      content,
      fileUrl: req.body.fileUrl || null,
      fileName: req.body.fileName || null,
      fileSize: req.body.fileSize || null,
      reactions: [],
      seenBy: [req.user!.userId],
      delivered: true,
      createdAt: new Date(),
    };

    const result = await messages.insertOne(message);

    // Update room's updatedAt
    await rooms.updateOne(
      { _id: roomIdObj },
      { $set: { updatedAt: new Date() } }
    );

    // Emit socket event ONLY to users in the specific room (including sender) - full room isolation
    // Each room uses its unique database ID: room:<roomId>
    // Messages are scoped to the specific room only - no cross-room leaks
    if (req.io) {
      const messageToEmit = {
        ...message,
        _id: result.insertedId.toString(),
        senderId: req.user!.userId,
        senderName: sender?.name || 'Unknown',
        senderPhoto: sender?.profilePhoto || null,
        roomId: roomIdObj.toString(), // Room ID for filtering on frontend
      };
      // Broadcast ONLY to the specific room using its unique database ID
      const roomIdStr = roomIdObj.toString();
      req.io.to(`room:${roomIdStr}`).emit('message', messageToEmit);
      // Also emit to ObjectId format if different (for compatibility)
      if (roomId !== roomIdStr) {
        req.io.to(`room:${roomId}`).emit('message', messageToEmit);
      }
      console.log(`Message broadcast to room:${roomIdStr} only (isolated)`);
    }

    res.json({
      success: true,
      message: {
        ...message,
        _id: result.insertedId.toString(),
        senderName: sender?.name || 'Unknown',
        senderPhoto: sender?.profilePhoto || null,
      },
    });
  } catch (error: any) {
    console.error('Send message error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

export default withAuth(async (req: AuthRequest, res: NextApiResponse) => {
  if (req.method === 'GET') {
    return getMessages(req, res);
  } else if (req.method === 'POST') {
    return sendMessage(req, res);
  } else {
    res.setHeader('Allow', ['GET', 'POST']);
    res.status(405).json({ error: `Method ${req.method} not allowed` });
  }
});

