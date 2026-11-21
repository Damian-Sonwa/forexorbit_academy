/**
 * GET /api/trading/reviews/instructor  (practice desk journal, staff view)
 * Trade reviews that students linked to a task: an instructor sees reviews for tasks they assigned;
 * admins see every task-linked review. Read-only; private; rate-limited.
 */
import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { setPrivateNoStore } from '@/lib/lesson-documents';
import { allowRequest, tradingReadLimiter } from '@/lib/content-rate-limit';
import { unexpectedBody } from '@/lib/public-error';
import { instructorReviews } from '@/lib/trading/reviews';

async function handler(req: AuthRequest, res: NextApiResponse) {
  setPrivateNoStore(res);
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    if (!(await allowRequest(tradingReadLimiter, { userId: req.user!.userId, res, getDb }))) return;
    const db = await getDb();
    return res.json(await instructorReviews(db, { viewerId: req.user!.userId, role: req.user!.role }));
  } catch (error: unknown) {
    console.error(JSON.stringify({ event: 'tradeReviewsStaff', result: 'failed' }));
    return res.status(500).json(unexpectedBody('api', error));
  }
}

export default withAuth(handler, ['instructor', 'admin', 'superadmin']);
