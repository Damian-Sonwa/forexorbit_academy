/**
 * Sign out everywhere
 * POST /api/auth/logout-all
 *
 * Raises the account's sessionGeneration and revokes every stored session, which ends every
 * session on every device (including this one) and disconnects their sockets. This browser's
 * cookie is cleared. Signing out of one device is POST /api/auth/logout.
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { unexpectedBody } from '@/lib/public-error';
import { clientAddress } from '@/lib/client-ip';
import { signOutEverywhere } from '@/lib/account-security';
import { clearSessionCookie, endAllSessions } from '@/lib/session-auth';

async function handler(req: AuthRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const db = await getDb();
    const result = await signOutEverywhere(db, { userId: req.user!.userId, ip: clientAddress(req) });
    if (!result.ok) return res.status(result.status).json({ error: result.error, code: result.code });
    await endAllSessions(db, req.user!.userId, 'logout_all');
    clearSessionCookie(res);
    return res.status(200).json({ message: 'You have been signed out on every device.' });
  } catch (error: unknown) {
    return res.status(500).json(unexpectedBody('logout-all', error));
  }
}

export default withAuth(handler);
