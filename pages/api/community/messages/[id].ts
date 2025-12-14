/**
 * Community Message Delete API Route
 * DELETE: Delete a message (only by sender)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

async function deleteMessage(req: AuthRequest, res: NextApiResponse) {
  try {
    const { id } = req.query;

    if (!id || typeof id !== 'string') {
      return res.status(400).json({ error: 'Message ID is required' });
    }

    const db = await getDb();
    const messages = db.collection('communityMessages');

    // Find the message
    const message = await messages.findOne({ _id: new ObjectId(id) });
    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    // Verify the user is the sender
    if (message.senderId !== req.user!.userId) {
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
  } catch (error: any) {
    console.error('Delete message error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
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

