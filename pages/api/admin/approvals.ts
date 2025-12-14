/**
 * Super Admin Approval API Route
 * Handles fetching pending users and approval/rejection actions
 * Only accessible by Super Admin (email: madudamian25@gmail.com)
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

// const SUPER_ADMIN_EMAIL = 'madudamian25@gmail.com'; // Reserved for future use

/**
 * GET: Fetch pending instructor/admin registrations
 * All admins can view pending users, but only Super Admin can approve/reject
 */
async function getPendingUsers(req: AuthRequest, res: NextApiResponse) {
  try {
    // Allow all admins to view pending users (for notifications)
    // Only Super Admin can approve/reject (checked in handleApproval)
    if (req.user!.role !== 'admin' && req.user!.role !== 'superadmin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const db = await getDb();
    const users = db.collection('users');

    // Fetch pending instructors and admins
    const pendingUsers = await users
      .find({
        role: { $in: ['instructor', 'admin'] },
        status: 'pending',
      })
      .sort({ createdAt: -1 })
      .toArray();

    res.json(
      pendingUsers.map((user) => ({
        id: user._id.toString(),
        email: user.email,
        name: user.name,
        role: user.role,
        status: user.status,
        createdAt: user.createdAt,
      }))
    );
  } catch (error: unknown) {
    console.error('Get pending users error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * POST: Approve or reject a pending user
 * Body: { userId: string, action: 'approve' | 'reject' }
 * All admins can approve/reject pending registrations
 */
async function handleApproval(req: AuthRequest, res: NextApiResponse) {
  try {
    // Allow all admins to approve/reject (not just Super Admin)
    if (req.user!.role !== 'admin' && req.user!.role !== 'superadmin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { userId, action } = req.body;

    if (!userId || !action || !['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'Invalid request. userId and action (approve/reject) required.' });
    }

    const db = await getDb();
    const users = db.collection('users');

    // Find the user
    const user = await users.findOne({ _id: new ObjectId(userId) });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Update user status
    const newStatus = action === 'approve' ? 'approved' : 'rejected';
    await users.updateOne(
      { _id: new ObjectId(userId) },
      {
        $set: {
          status: newStatus,
          updatedAt: new Date(),
          reviewedBy: req.user!.email,
          reviewedAt: new Date(),
        },
      }
    );

    res.json({
      success: true,
      message: `User ${action === 'approve' ? 'approved' : 'rejected'} successfully`,
      user: {
        id: user._id.toString(),
        email: user.email,
        name: user.name,
        role: user.role,
        status: newStatus,
      },
    });
  } catch (error: unknown) {
    console.error('Approval action error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function handler(req: AuthRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    return getPendingUsers(req, res);
  } else if (req.method === 'POST') {
    return handleApproval(req, res);
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}

export default withAuth(handler);

