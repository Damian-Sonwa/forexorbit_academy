import { unexpectedBody } from '@/lib/public-error';
/**
 * Admin Users API Route
 * GET: List all users (admin and Super Admin). Each row carries only the fields the admin pages
 * use (lib/admin-user-view.js); personal details stay out of the list.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ADMIN_USER_LIST_PROJECTION, toAdminUserRow } from '@/lib/admin-user-view';

// GET all users
async function getUsers(req: AuthRequest, res: NextApiResponse) {
  try {
    const db = await getDb();
    const users = db.collection('users');

    const usersList = await users.find({}, { projection: ADMIN_USER_LIST_PROJECTION }).sort({ createdAt: -1 }).toArray();

    res.setHeader('Cache-Control', 'no-store');
    res.json(usersList.map(toAdminUserRow));
  } catch (error: unknown) {
    console.error('Get users error:');
    res.status(500).json(unexpectedBody('api', error));
  }
}

export default async function(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    return withAuth(getUsers, ['admin', 'superadmin'])(req as AuthRequest, res);
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}
