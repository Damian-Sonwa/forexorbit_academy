/**
 * Get Current User API Route
 * Returns authenticated user information
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';

async function handler(req: AuthRequest, res: NextApiResponse) {
  try {
    const db = await getDb();
    const users = db.collection('users');

    const user = await users.findOne(
      { _id: req.user!.userId },
      { projection: { password: 0 } }
    );

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      id: user._id.toString(),
      email: user.email,
      name: user.name,
      role: user.role,
      points: user.points || 0, // Include points for gamification
    });
  } catch (error: any) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export default withAuth(handler);

