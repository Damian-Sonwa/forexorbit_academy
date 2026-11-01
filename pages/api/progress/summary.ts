/**
 * GET /api/progress/summary
 *
 * The signed-in student's own learning summary (Phase 8, lib/progress-summary.js): courses with
 * completion status, Continue learning, in-progress / completed / recent lists, learning time and
 * streak. Only the session's account is ever read; there is no user parameter. Private, never
 * cached.
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { buildProgressSummary } from '@/lib/progress-summary';
import { setPrivateNoStore } from '@/lib/lesson-documents';
import { unexpectedBody } from '@/lib/public-error';

async function handler(req: AuthRequest, res: NextApiResponse) {
  setPrivateNoStore(res);
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const db = await getDb();
    const summary = await buildProgressSummary(db, { userId: req.user!.userId, role: req.user!.role });
    return res.status(200).json(summary);
  } catch {
    console.error(JSON.stringify({ event: 'progressSummary', result: 'failed' }));
    return res.status(500).json(unexpectedBody('api'));
  }
}

export default withAuth(handler);
