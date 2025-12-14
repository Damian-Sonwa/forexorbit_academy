/**
 * Admin Users API Route
 * GET: List all users (admin only)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';

// GET all users
async function getUsers(req: AuthRequest, res: NextApiResponse) {
  try {
    const db = await getDb();
    const users = db.collection('users');

    const usersList = await users.find({}, { projection: { password: 0 } }).sort({ createdAt: -1 }).toArray();

    res.json(usersList);
  } catch (error: any) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export default async function(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    return withAuth(getUsers, ['admin'])(req as AuthRequest, res);
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}

