/**
 * Community Messages API Route
 * GET: Get messages for a room
 * POST: Send a new message
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { communityMember, decideCommunityMessageAccess, decideCommunityMessageSend, isStoredId } from '@/lib/account-access';

async function getMessages(req: AuthRequest, res: NextApiResponse) {
  try {
    const { roomId } = req.query;

    if (!isStoredId(roomId)) {
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
  } catch {
    console.error(JSON.stringify({ event: 'communityMessagesRead', result: 'failed' }));
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function sendMessage(req: AuthRequest, res: NextApiResponse) {
  try {
    const roomId = req.body && typeof req.body.roomId === 'string' ? req.body.roomId : '';
    if (!isStoredId(roomId)) {
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

    const user = await users.findOne(
      { _id: new ObjectId(req.user!.userId) },
      { projection: { learningLevel: 1, role: 1, studentDetails: 1, name: 1, profilePhoto: 1 } }
    );
    const decision = decideCommunityMessageSend({
      member: communityMember(req.user!.userId, user),
      room,
      body: req.body,
    });
    if (!decision.ok) {
      return res.status(decision.status).json({ error: decision.error });
    }

    const message = {
      roomId: decision.roomId,
      senderId: decision.message.senderId,
      type: decision.message.type,
      content: decision.message.content,
      fileUrl: decision.message.fileUrl,
      fileName: decision.message.fileName,
      fileSize: decision.message.fileSize,
      reactions: [],
      seenBy: [decision.message.senderId],
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
        senderName: user?.name || 'Unknown',
        senderPhoto: user?.profilePhoto || null,
        roomId: decision.roomId,
      };
      // Broadcast ONLY to the specific room using its unique database ID
      const roomIdStr = roomIdObj.toString();
      req.io.to(`room:${roomIdStr}`).emit('message', messageToEmit);
      // Also emit to ObjectId format if different (for compatibility)
      if (roomId !== roomIdStr) {
        req.io.to(`room:${roomId}`).emit('message', messageToEmit);
      }
    }

    // Create notification for instructors in the room (if message is from a student)
    // Note: This is optional - instructors can choose to monitor rooms
    // For now, we'll skip this to avoid notification spam
    // Uncomment if you want instructors to be notified of all student messages
    /*
    if (req.user!.role === 'student') {
      try {
        const { createNotification } = await import('@/lib/notifications');
        const users = db.collection('users');
        
        // Get all instructors/admins who might be monitoring this room
        const instructors = await users
          .find({ 
            role: { $in: ['instructor', 'admin', 'superadmin'] }
          })
          .project({ _id: 1 })
          .toArray();

        // Create room-level notification that instructors can see
        await createNotification({
          type: 'community_message',
          title: 'New Message in Community',
          message: `${sender?.name || 'A student'} sent a message in ${room.name}`,
          roomId: roomIdStr,
          roleTarget: 'instructor',
          metadata: {
            roomName: room.name,
            senderName: sender?.name || 'Unknown',
            messagePreview: content.substring(0, 100),
          },
        });

        // Emit to instructors in the room
        if (req.io) {
          instructors.forEach((instructor) => {
            req.io.to(`user:${instructor._id.toString()}`).emit('notification', {
              type: 'community_message',
              title: 'New Message in Community',
              message: `${sender?.name || 'A student'} sent a message in ${room.name}`,
              roomId: roomIdStr,
              read: false,
              createdAt: new Date(),
            });
          });
        }
      } catch (notifError) {
        console.error('Failed to create message notification:', notifError);
        // Don't fail the request if notification creation fails
      }
    }
    */

    res.json({
      success: true,
      message: {
        ...message,
        _id: result.insertedId.toString(),
        senderName: user?.name || 'Unknown',
        senderPhoto: user?.profilePhoto || null,
      },
    });
  } catch {
    console.error(JSON.stringify({ event: 'communityMessageSend', result: 'failed' }));
    res.status(500).json({ error: 'Internal server error' });
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

