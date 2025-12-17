/**
 * Consultation Sessions API Route
 * GET: Get consultation sessions (for students: their sessions, for experts: their sessions)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

async function getSessions(req: AuthRequest, res: NextApiResponse) {
  try {
    const db = await getDb();
    const sessions = db.collection('consultationSessions');
    const users = db.collection('users');

    let userSessions;

    if (req.user!.role === 'student') {
      // Students see their own sessions
      userSessions = await sessions
        .find({ studentId: req.user!.userId })
        .sort({ createdAt: -1 })
        .toArray();
    } else if (req.user!.role === 'instructor') {
      // Instructors see their assigned sessions
      userSessions = await sessions
        .find({ expertId: req.user!.userId })
        .sort({ createdAt: -1 })
        .toArray();
    } else if (req.user!.role === 'admin' || req.user!.role === 'superadmin') {
      // Admins and Super Admins see ALL sessions for monitoring
      userSessions = await sessions
        .find({})
        .sort({ createdAt: -1 })
        .toArray();
    } else {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Populate user info
    const sessionsWithUsers = await Promise.all(
      userSessions.map(async (session) => {
        const student = await users.findOne(
          { _id: new ObjectId(session.studentId) },
          { projection: { name: 1, email: 1, profilePhoto: 1 } }
        );
        const expert = await users.findOne(
          { _id: new ObjectId(session.expertId) },
          { projection: { name: 1, email: 1, profilePhoto: 1 } }
        );

        return {
          ...session,
          _id: session._id.toString(),
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
          messageCount: session.messages?.length || 0,
        };
      })
    );

    res.json(sessionsWithUsers);
  } catch (error: any) {
    console.error('Get consultation sessions error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

export default withAuth(async (req: AuthRequest, res: NextApiResponse) => {
  if (req.method === 'GET') {
    return getSessions(req, res);
  } else {
    res.setHeader('Allow', ['GET']);
    res.status(405).json({ error: `Method ${req.method} not allowed` });
  }
});








