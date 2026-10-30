import { unexpectedBody } from '@/lib/public-error';
/**
 * Account Approval API Route
 * GET: pending registrations. POST: approve or reject one pending account.
 * Approving and rejecting accounts is reserved for the Super Admin (lib/account-approval).
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { decideAccountApproval } from '@/lib/account-approval';

/** GET: pending registrations awaiting the Super Admin's decision. */
async function getPendingUsers(req: AuthRequest, res: NextApiResponse) {
  try {
    const db = await getDb();
    const users = db.collection('users');

    const pendingUsers = await users
      .find(
        { status: 'pending', role: { $in: ['student', 'instructor', 'admin'] } },
        { projection: { email: 1, name: 1, role: 1, status: 1, createdAt: 1 } }
      )
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
    console.error('Get pending users error:');
    res.status(500).json(unexpectedBody('api', error));
  }
}

/**
 * POST: approve or reject a pending account.
 * Body: { userId: string, action: 'approve' | 'reject' }
 * 400 invalid id or action, 403 not the Super Admin / own account / Super Admin target,
 * 404 unknown account, 409 already processed.
 */
async function handleApproval(req: AuthRequest, res: NextApiResponse) {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const { userId, action } = body as { userId?: unknown; action?: unknown };
    const db = await getDb();
    const result = await decideAccountApproval(db, {
      actor: { userId: req.user!.userId, email: req.user!.email, role: req.user!.role },
      userId,
      action,
    });
    if (!result.ok) {
      if ('decisionSaved' in result) {
        console.error(JSON.stringify({ event: 'accountApproval', result: 'audit_write_failed', userId: result.user.id }));
        return res.status(result.status).json({ error: result.error, code: result.code, decisionSaved: true, user: result.user });
      }
      return res.status(result.status).json({ error: result.error, code: result.code });
    }
    res.json({
      success: true,
      message: `User ${result.user.status === 'approved' ? 'approved' : 'rejected'} successfully`,
      user: result.user,
    });
  } catch (error: unknown) {
    console.error('Approval action error:');
    res.status(500).json(unexpectedBody('api', error));
  }
}

async function handler(req: AuthRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET') {
    return getPendingUsers(req, res);
  } else if (req.method === 'POST') {
    return handleApproval(req, res);
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}

export default withAuth(handler, ['superadmin']);
