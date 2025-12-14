/**
 * Super Admin Consultation Controls API Route
 * GET: Get consultation settings and logs
 * PUT: Update consultation settings (enable/disable, approve experts, etc.)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

async function getSettings(req: AuthRequest, res: NextApiResponse) {
  try {
    // Only super admin can access (check by email)
    if (req.user!.email !== 'madudamian25@gmail.com' || req.user!.role !== 'admin') {
      return res.status(403).json({ error: 'Only super admin can access these settings' });
    }

    const db = await getDb();
    const users = db.collection('users');
    const requests = db.collection('consultationRequests');
    const sessions = db.collection('consultationSessions');

    // Get super admin settings
    const superAdmin = await users.findOne(
      { email: 'madudamian25@gmail.com' },
      { projection: { consultationEnabled: 1 } }
    );

    // Get all experts
    const experts = await users
      .find({ isExpert: true })
      .project({ _id: 1, name: 1, email: 1, isExpert: 1, expertAvailable: 1, role: 1 })
      .toArray();

    // Get consultation stats
    const totalRequests = await requests.countDocuments({});
    const pendingRequests = await requests.countDocuments({ status: 'pending' });
    const activeSessions = await sessions.countDocuments({ status: 'active' });
    const completedSessions = await sessions.countDocuments({ status: 'completed' });

    res.json({
      consultationEnabled: superAdmin?.consultationEnabled !== false, // Default to true
      experts: experts.map((expert) => ({
        _id: expert._id.toString(),
        name: expert.name,
        email: expert.email,
        isExpert: expert.isExpert,
        expertAvailable: expert.expertAvailable !== false,
        role: expert.role,
      })),
      stats: {
        totalRequests,
        pendingRequests,
        activeSessions,
        completedSessions,
      },
    });
  } catch (error: any) {
    console.error('Get consultation settings error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

async function updateSettings(req: AuthRequest, res: NextApiResponse) {
  try {
    // Only super admin can update
    if (req.user!.email !== 'madudamian25@gmail.com' || req.user!.role !== 'admin') {
      return res.status(403).json({ error: 'Only super admin can update these settings' });
    }

    const { action, data } = req.body;

    const db = await getDb();
    const users = db.collection('users');

    if (action === 'toggleFeature') {
      // Enable/disable consultation feature
      const enabled = data.enabled;
      await users.updateOne(
        { email: 'madudamian25@gmail.com' },
        { $set: { consultationEnabled: enabled } }
      );
      res.json({ success: true, message: `Consultation feature ${enabled ? 'enabled' : 'disabled'}` });
    } else if (action === 'approveExpert') {
      // Approve/remove expert status
      const { userId, isExpert } = data;
      await users.updateOne(
        { _id: new ObjectId(userId) },
        { $set: { isExpert: isExpert } }
      );
      res.json({ success: true, message: `Expert status ${isExpert ? 'approved' : 'removed'}` });
    } else if (action === 'suspendUser') {
      // Suspend user (placeholder - add suspended field to user model)
      const { userId, suspended } = data;
      await users.updateOne(
        { _id: new ObjectId(userId) },
        { $set: { consultationSuspended: suspended } }
      );
      res.json({ success: true, message: `User ${suspended ? 'suspended' : 'unsuspended'} from consultations` });
    } else {
      res.status(400).json({ error: 'Invalid action' });
    }
  } catch (error: any) {
    console.error('Update consultation settings error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

async function getLogs(req: AuthRequest, res: NextApiResponse) {
  try {
    // Only super admin can access
    if (req.user!.email !== 'madudamian25@gmail.com' || req.user!.role !== 'admin') {
      return res.status(403).json({ error: 'Only super admin can access logs' });
    }

    const db = await getDb();
    const requests = db.collection('consultationRequests');
    const sessions = db.collection('consultationSessions');
    const users = db.collection('users');

    const { page = 1, limit = 50 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    // Get all consultation requests
    const allRequests = await requests
      .find({})
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .toArray();

    // Get all sessions
    const allSessions = await sessions
      .find({})
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .toArray();

    // Populate user info
    const requestsWithUsers = await Promise.all(
      allRequests.map(async (request) => {
        const student = await users.findOne(
          { _id: new ObjectId(request.studentId) },
          { projection: { name: 1, email: 1 } }
        );
        const expert = await users.findOne(
          { _id: new ObjectId(request.expertId) },
          { projection: { name: 1, email: 1 } }
        );
        return {
          ...request,
          _id: request._id.toString(),
          student: student ? { name: student.name, email: student.email } : null,
          expert: expert ? { name: expert.name, email: expert.email } : null,
        };
      })
    );

    const sessionsWithUsers = await Promise.all(
      allSessions.map(async (session) => {
        const student = await users.findOne(
          { _id: new ObjectId(session.studentId) },
          { projection: { name: 1, email: 1 } }
        );
        const expert = await users.findOne(
          { _id: new ObjectId(session.expertId) },
          { projection: { name: 1, email: 1 } }
        );
        return {
          ...session,
          _id: session._id.toString(),
          student: student ? { name: student.name, email: student.email } : null,
          expert: expert ? { name: expert.name, email: expert.email } : null,
        };
      })
    );

    res.json({
      requests: requestsWithUsers,
      sessions: sessionsWithUsers,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        totalRequests: await requests.countDocuments({}),
        totalSessions: await sessions.countDocuments({}),
      },
    });
  } catch (error: any) {
    console.error('Get consultation logs error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

export default withAuth(async (req: AuthRequest, res: NextApiResponse) => {
  if (req.method === 'GET') {
    if (req.query.logs === 'true') {
      return getLogs(req, res);
    } else {
      return getSettings(req, res);
    }
  } else if (req.method === 'PUT') {
    return updateSettings(req, res);
  } else {
    res.setHeader('Allow', ['GET', 'PUT']);
    res.status(405).json({ error: `Method ${req.method} not allowed` });
  }
});








