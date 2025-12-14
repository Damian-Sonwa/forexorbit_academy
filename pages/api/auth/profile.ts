/**
 * Profile Update API Route
 * Updates user profile information
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

async function handler(req: AuthRequest, res: NextApiResponse) {
  if (req.method !== 'PUT') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { name, email } = req.body;

    if (!name || !email) {
      return res.status(400).json({ error: 'Name and email are required' });
    }

    const db = await getDb();
    const users = db.collection('users');

    // Check if email is already taken by another user
    const existingUser = await users.findOne({
      email,
      _id: { $ne: new ObjectId(req.user!.userId) },
    });

    if (existingUser) {
      return res.status(400).json({ error: 'Email is already taken' });
    }

    // Update user
    const result = await users.updateOne(
      { _id: new ObjectId(req.user!.userId) },
      {
        $set: {
          name,
          email,
          updatedAt: new Date(),
        },
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get updated user
    const updatedUser = await users.findOne(
      { _id: new ObjectId(req.user!.userId) },
      { projection: { password: 0 } }
    );

    res.json({
      success: true,
      user: {
        id: updatedUser!._id.toString(),
        email: updatedUser!.email,
        name: updatedUser!.name,
        role: updatedUser!.role,
        points: updatedUser!.points || 0,
      },
    });
  } catch (error: any) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export default withAuth(handler);

