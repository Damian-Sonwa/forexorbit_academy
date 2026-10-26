import { unexpectedBody } from '@/lib/public-error';
/**
 * Community Message Delete API Route
 * DELETE: Delete a message (only by sender)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { communityMember, decideCommunityMessageAccess, isStoredId } from '@/lib/account-access';

async function deleteMessage(req: AuthRequest, res: NextApiResponse) {
  try {
    const { id } = req.query;

    if (!isStoredId(id)) {
      return res.status(400).json({ error: 'Message ID is required' });
    }

    const db = await getDb();
    const messages = db.collection('communityMessages');
    const rooms = db.collection('communityRooms');
    const users = db.collection('users');

    const message = await messages.findOne({ _id: new ObjectId(id) });
    if (!message || !isStoredId(String(message.roomId))) {
      return res.status(404).json({ error: 'Message not found' });
    }
    const room = await rooms.findOne({ _id: new ObjectId(String(message.roomId)) });
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
    if (message.senderId !== access.senderId) {
      return res.status(403).json({ error: 'You can only delete your own messages' });
    }

    // Delete the message
    await messages.deleteOne({ _id: new ObjectId(id) });

    // Broadcast deletion via Socket.io
    if (req.io) {
      const roomIdStr = message.roomId?.toString() || message.roomId;
      req.io.to(`room:${roomIdStr}`).emit('messageDeleted', {
        messageId: id,
        roomId: roomIdStr,
      });
      // Also try ObjectId format if different
      if (roomIdStr !== message.roomId) {
        req.io.to(`room:${message.roomId}`).emit('messageDeleted', {
          messageId: id,
          roomId: roomIdStr,
        });
      }
    }

    res.json({ success: true, messageId: id });
  } catch {
    console.error(JSON.stringify({ event: 'communityMessageDelete', result: 'failed' }));
    res.status(500).json(unexpectedBody('api'));
  }
}

export default withAuth(async (req: AuthRequest, res: NextApiResponse) => {
  if (req.method === 'DELETE') {
    return deleteMessage(req, res);
  } else {
    res.setHeader('Allow', ['DELETE']);
    res.status(405).json({ error: `Method ${req.method} not allowed` });
  }
});

