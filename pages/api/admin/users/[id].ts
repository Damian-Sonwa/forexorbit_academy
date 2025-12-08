/**
 * Admin User API Route (Single User)
 * PUT: Update user role
 * DELETE: Delete user
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

// PUT update user role
async function updateUser(req: AuthRequest, res: NextApiResponse) {
  try {
    const { id } = req.query;
    const { role } = req.body;

    if (!id || typeof id !== 'string') {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    // Validate ObjectId format
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid user ID format' });
    }

    if (!['admin', 'instructor', 'student'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role. Must be admin, instructor, or student' });
    }

    const db = await getDb();
    const users = db.collection('users');

    // Check if user exists and prevent changing Super Admin role
    const userToUpdate = await users.findOne({ _id: new ObjectId(id) });
    if (!userToUpdate) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Prevent changing Super Admin role
    if (userToUpdate.email === 'madudamian25@gmail.com' || userToUpdate.role === 'superadmin') {
      return res.status(403).json({ error: 'Cannot change Super Admin role' });
    }

    // Update user role
    const result = await users.updateOne(
      { _id: new ObjectId(id) },
      { $set: { role, updatedAt: new Date() } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ success: true, message: `User role updated to ${role} successfully` });
  } catch (error: any) {
    console.error('Update user error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

// DELETE user
async function deleteUser(req: AuthRequest, res: NextApiResponse) {
  try {
    const { id } = req.query;

    if (!id || typeof id !== 'string') {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    // Validate ObjectId format
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid user ID format' });
    }

    const db = await getDb();
    const users = db.collection('users');

    // Check if user exists before attempting to delete
    const userToDelete = await users.findOne({ _id: new ObjectId(id) });
    if (!userToDelete) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Prevent deleting yourself
    if (id === req.user!.userId) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    // Prevent deleting Super Admin
    if (userToDelete.email === 'madudamian25@gmail.com' || userToDelete.role === 'superadmin') {
      return res.status(403).json({ error: 'Cannot delete Super Admin account' });
    }

    const result = await users.deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ success: true, message: 'User deleted successfully' });
  } catch (error: any) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

async function handler(req: AuthRequest, res: NextApiResponse) {
  if (req.method === 'PUT') {
    return updateUser(req, res);
  } else if (req.method === 'DELETE') {
    return deleteUser(req, res);
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}

export default withAuth(handler, ['admin', 'superadmin']);

