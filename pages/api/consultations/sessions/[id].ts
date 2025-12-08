/**
 * Consultation Session API Route
 * GET: Get session details with messages
 * PUT: Update session (end session, etc.)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

async function getSession(req: AuthRequest, res: NextApiResponse) {
  try {
    const { id } = req.query;

    if (!id || typeof id !== 'string') {
      return res.status(400).json({ error: 'Session ID is required' });
    }

    const db = await getDb();
    const sessions = db.collection('consultationSessions');
    const messages = db.collection('consultationMessages');
    const users = db.collection('users');

    const session = await sessions.findOne({ _id: new ObjectId(id) });

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Verify user has access to this session
    if (req.user!.role === 'student' && session.studentId !== req.user!.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if ((req.user!.role === 'instructor' || req.user!.role === 'admin' || req.user!.role === 'superadmin') 
        && session.expertId !== req.user!.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Get messages for this session
    const sessionMessages = await messages
      .find({ sessionId: id })
      .sort({ createdAt: 1 })
      .toArray();

    // Populate sender info
    const messagesWithSenders = await Promise.all(
      sessionMessages.map(async (msg) => {
        const sender = await users.findOne(
          { _id: new ObjectId(msg.senderId) },
          { projection: { name: 1, email: 1, profilePhoto: 1 } }
        );
        return {
          ...msg,
          _id: msg._id.toString(),
          sender: sender ? {
            _id: sender._id.toString(),
            name: sender.name,
            email: sender.email,
            profilePhoto: sender.profilePhoto,
          } : null,
        };
      })
    );

    // Get student and expert info
    const student = await users.findOne(
      { _id: new ObjectId(session.studentId) },
      { projection: { name: 1, email: 1, profilePhoto: 1 } }
    );
    const expert = await users.findOne(
      { _id: new ObjectId(session.expertId) },
      { projection: { name: 1, email: 1, profilePhoto: 1 } }
    );

    res.json({
      ...session,
      _id: session._id.toString(),
      messages: messagesWithSenders,
      student: student ? {
        _id: student._id.toString(),
        name: student.name,
        email: student.email,
        profilePhoto: student.profilePhoto,
      } : null,
      expert: expert ? {
        _id: expert._id.toString(),
        name: expert.name,
        email: expert.email,
        profilePhoto: expert.profilePhoto,
      } : null,
    });
  } catch (error: any) {
    console.error('Get consultation session error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

async function updateSession(req: AuthRequest, res: NextApiResponse) {
  try {
    const { id } = req.query;
    const { action } = req.body; // 'end' or other actions

    if (!id || typeof id !== 'string') {
      return res.status(400).json({ error: 'Session ID is required' });
    }

    const db = await getDb();
    const sessions = db.collection('consultationSessions');

    const session = await sessions.findOne({ _id: new ObjectId(id) });

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Verify user has access
    if (req.user!.role === 'student' && session.studentId !== req.user!.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if ((req.user!.role === 'instructor' || req.user!.role === 'admin' || req.user!.role === 'superadmin') 
        && session.expertId !== req.user!.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (action === 'end') {
      await sessions.updateOne(
        { _id: new ObjectId(id) },
        { 
          $set: { 
            status: 'completed',
            endedAt: new Date(),
            updatedAt: new Date(),
          } 
        }
      );

      // Update request status
      const requests = db.collection('consultationRequests');
      await requests.updateOne(
        { _id: new ObjectId(session.requestId) },
        { $set: { status: 'completed', updatedAt: new Date() } }
      );

      // Notify both users
      if (req.io) {
        req.io.to(`user:${session.studentId}`).emit('consultationEnded', { sessionId: id });
        req.io.to(`user:${session.expertId}`).emit('consultationEnded', { sessionId: id });
      }

      res.json({ success: true, message: 'Session ended' });
    } else {
      res.status(400).json({ error: 'Invalid action' });
    }
  } catch (error: any) {
    console.error('Update consultation session error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

export default withAuth(async (req: AuthRequest, res: NextApiResponse) => {
  if (req.method === 'GET') {
    return getSession(req, res);
  } else if (req.method === 'PUT') {
    return updateSession(req, res);
  } else {
    res.setHeader('Allow', ['GET', 'PUT']);
    res.status(405).json({ error: `Method ${req.method} not allowed` });
  }
});





