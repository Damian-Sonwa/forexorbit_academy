/**
 * Sign out of this device
 * POST /api/auth/logout
 *
 * Revokes the session this browser carries (with its rotation chain), disconnects its sockets and
 * clears the cookie. Other devices stay signed in (POST /api/auth/logout-all ends those too).
 * Answers 200 even when the session had already ended, so signing out always succeeds. The Origin
 * and CSRF-header check in middleware.ts applies, so another site cannot sign the user out.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getDb } from '@/lib/mongodb';
import { unexpectedBody } from '@/lib/public-error';
import { checkRequestOrigin, clearSessionCookie, endCurrentSession } from '@/lib/session-auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const origin = checkRequestOrigin(req);
  if (!origin.ok) return res.status(origin.status).json({ error: origin.error, code: origin.code });
  try {
    const db = await getDb();
    await endCurrentSession(req, res, db, 'logout');
    return res.status(200).json({ message: 'Signed out.' });
  } catch (error: unknown) {
    clearSessionCookie(res);
    return res.status(500).json(unexpectedBody('logout', error));
  }
}
