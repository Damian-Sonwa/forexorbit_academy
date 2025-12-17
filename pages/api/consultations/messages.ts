/**
 * Consultation Messages API Route
 * GET: Get messages for a session
 * POST: Send a message in a consultation session
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

async function getMessages(req: AuthRequest, res: NextApiResponse) {
  try {
    const { sessionId } = req.query;

    if (!sessionId || typeof sessionId !== 'string') {
      return res.status(400).json({ error: 'Session ID is required' });
    }

    const db = await getDb();
    const messages = db.collection('consultationMessages');
    const sessions = db.collection('consultationSessions');
    const users = db.collection('users');

    // Verify session exists and user has access
    const session = await sessions.findOne({ _id: new ObjectId(sessionId) });

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    if (req.user!.role === 'student' && session.studentId !== req.user!.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if ((req.user!.role === 'instructor' || req.user!.role === 'admin' || req.user!.role === 'superadmin') 
        && session.expertId !== req.user!.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Get messages
    const messageDocs = await messages
      .find({ sessionId })
      .sort({ createdAt: 1 })
      .toArray();

    // Populate sender info
    const messagesWithSenders = await Promise.all(
      messageDocs.map(async (msg) => {
        const sender = await users.findOne(
          { _id: new ObjectId(msg.senderId) },
          { projection: { name: 1, email: 1, profilePhoto: 1 } }
        );
        return {
          ...msg,
          _id: msg._id.toString(),
          senderName: sender?.name || 'Unknown',
          senderPhoto: sender?.profilePhoto || null,
        };
      })
    );

    res.json(messagesWithSenders);
  } catch (error: any) {
    console.error('Get consultation messages error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

async function sendMessage(req: AuthRequest, res: NextApiResponse) {
  try {
    const { sessionId, type, content } = req.body;

    if (!sessionId || !type || !content) {
      return res.status(400).json({ error: 'Session ID, type, and content are required' });
    }

    const db = await getDb();
    const messages = db.collection('consultationMessages');
    const sessions = db.collection('consultationSessions');
    const users = db.collection('users');

    // Verify session exists and user has access
    const session = await sessions.findOne({ _id: new ObjectId(sessionId) });

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    if (req.user!.role === 'student' && session.studentId !== req.user!.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if ((req.user!.role === 'instructor' || req.user!.role === 'admin' || req.user!.role === 'superadmin') 
        && session.expertId !== req.user!.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (session.status !== 'active') {
      return res.status(400).json({ error: 'Session is not active' });
    }

    // Get sender info
    const sender = await users.findOne(
      { _id: new ObjectId(req.user!.userId) },
      { projection: { name: 1, profilePhoto: 1 } }
    );

    const message = {
      sessionId,
      senderId: req.user!.userId,
      type,
      content,
      fileUrl: req.body.fileUrl || null,
      fileName: req.body.fileName || null,
      fileSize: req.body.fileSize || null,
      createdAt: new Date(),
    };

    const result = await messages.insertOne(message);

    // Update session
    await sessions.updateOne(
      { _id: new ObjectId(sessionId) },
      { 
        $push: { messages: result.insertedId },
        $set: { updatedAt: new Date() }
      } as any
    );

    // Emit socket event to consultation room - ensures both parties receive message
    // CRITICAL: Broadcast to consultation room instead of individual users
    // This ensures messages are visible to both student and instructor in real-time
    if (req.io) {
      const messageToEmit = {
        ...message,
        _id: result.insertedId.toString(),
        senderName: sender?.name || 'Unknown',
        senderPhoto: sender?.profilePhoto || null,
      };

      // Broadcast to consultation room - both student and instructor receive it
      req.io.to(`consultation:${sessionId}`).emit('consultationMessage', messageToEmit);
      
      // Also emit to individual users as fallback (for users not yet in room)
      req.io.to(`user:${session.studentId}`).emit('consultationMessage', messageToEmit);
      req.io.to(`user:${session.expertId}`).emit('consultationMessage', messageToEmit);
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
    console.error('Send consultation message error:', error);
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








