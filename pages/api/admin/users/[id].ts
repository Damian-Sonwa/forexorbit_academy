import { unexpectedBody } from '@/lib/public-error';
/**
 * Admin User API Route (Single User)
 * PUT: Update user role (granting or removing instructor or admin needs the Super Admin)
 * PATCH: Suspend or reactivate (Super Admin only)
 * DELETE: Delete user (Super Admin only)
 * All are applied and audited in lib/account-approval. A change saved without its audit entry is
 * reported with 500 and decisionSaved: true, never as a success.
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { changeAccountRole, changeAccountStatus, deleteAccount } from '@/lib/account-approval';

type Failure = { ok: false; status: number; error: string; code: string; decisionSaved?: true; user?: { id: string } };

/** Sends a refusal, or the report of a change that was saved without its audit entry. */
function sendFailure(res: NextApiResponse, failure: Failure, event: string) {
  if (failure.decisionSaved) {
    console.error(JSON.stringify({ event, result: 'audit_write_failed', userId: failure.user?.id }));
    return res.status(failure.status).json({ error: failure.error, code: failure.code, decisionSaved: true, user: failure.user });
  }
  return res.status(failure.status).json({ error: failure.error, code: failure.code });
}

// PUT update user role
async function updateUser(req: AuthRequest, res: NextApiResponse) {
  try {
    const { id } = req.query;
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const db = await getDb();
    const result = await changeAccountRole(db, {
      actor: { userId: req.user!.userId, email: req.user!.email, role: req.user!.role },
      userId: id,
      role: (body as { role?: unknown }).role,
    });
    if (!result.ok) return sendFailure(res, result, 'accountRoleChange');
    res.json({ success: true, message: `User role updated to ${result.user.role} successfully` });
  } catch (error: unknown) {
    console.error('Update user error:');
    res.status(500).json(unexpectedBody('api', error));
  }
}

// DELETE user
async function deleteUser(req: AuthRequest, res: NextApiResponse) {
  try {
    const { id } = req.query;
    const db = await getDb();
    const result = await deleteAccount(db, {
      actor: { userId: req.user!.userId, email: req.user!.email, role: req.user!.role },
      userId: id,
    });
    if (!result.ok) return sendFailure(res, result, 'accountDeletion');
    res.json({ success: true, message: 'User deleted successfully' });
  } catch (error: unknown) {
    console.error('Delete user error:');
    res.status(500).json(unexpectedBody('api', error));
  }
}

// PATCH suspend or reactivate: { action: 'suspend' | 'reactivate', reason }
async function changeStatus(req: AuthRequest, res: NextApiResponse) {
  try {
    const { id } = req.query;
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const db = await getDb();
    const result = await changeAccountStatus(db, {
      actor: { userId: req.user!.userId, email: req.user!.email, role: req.user!.role },
      userId: id,
      action: (body as { action?: unknown }).action,
      reason: (body as { reason?: unknown }).reason,
    });
    if (!result.ok) return sendFailure(res, result, 'accountStatusChange');
    res.json({
      success: true,
      message: result.user.status === 'suspended' ? 'Account suspended; all of its sessions have ended.' : 'Account reactivated.',
      user: result.user,
    });
  } catch (error: unknown) {
    console.error('Change user status error:');
    res.status(500).json(unexpectedBody('api', error));
  }
}

async function handler(req: AuthRequest, res: NextApiResponse) {
  if (req.method === 'PUT') {
    return updateUser(req, res);
  } else if (req.method === 'PATCH') {
    return changeStatus(req, res);
  } else if (req.method === 'DELETE') {
    return deleteUser(req, res);
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}

// Ordinary admins still reach PUT for changes that grant nothing; deletion, suspension and
// reactivation are refused for them in lib/account-approval.
export default withAuth(handler, ['admin', 'superadmin']);
