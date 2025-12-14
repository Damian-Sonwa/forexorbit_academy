/**
 * Messages API Route
 * GET: Get messages for a lesson room
 * POST: Send a message
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';

async function getMessages(req: AuthRequest, res: NextApiResponse) {
  try {
    const { lessonId } = req.query;
    if (!lessonId) {
      return res.status(400).json({ error: 'lessonId required' });
    }

    const db = await getDb();
    const messages = db.collection('messages');

    const messagesList = await messages
      .find({ lessonId })
      .sort({ createdAt: 1 })
      .limit(100)
      .toArray();

    res.json(messagesList);
  } catch (error: any) {
    console.error('Get messages error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function sendMessage(req: AuthRequest, res: NextApiResponse) {
  try {
    const { lessonId, text } = req.body;
    const userId = req.user!.userId;

    if (!lessonId || !text) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const db = await getDb();
    const messages = db.collection('messages');
    const users = db.collection('users');

    // Get user info
    const user = await users.findOne(
      { _id: userId },
      { projection: { name: 1, email: 1 } }
    );

    const result = await messages.insertOne({
      lessonId,
      userId,
      senderName: user?.name || 'Anonymous',
      text,
      createdAt: new Date(),
    });

    res.status(201).json({
      id: result.insertedId.toString(),
      lessonId,
      userId,
      senderName: user?.name || 'Anonymous',
      text,
      createdAt: new Date(),
    });
  } catch (error: any) {
    console.error('Send message error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function handler(req: AuthRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    return getMessages(req, res);
  } else if (req.method === 'POST') {
    return sendMessage(req, res);
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}

export default withAuth(handler);

