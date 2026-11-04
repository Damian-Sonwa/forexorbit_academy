/**
 * Close Position API Route. A GET still changes nothing (405).
 *
 * Retired (Phase 10). The practice desk no longer uses a broker: the owner's decision is an internal
 * simulator, with no broker order execution. See /api/trading/*.
 */
import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { setPrivateNoStore } from '@/lib/lesson-documents';

async function retired(req: AuthRequest, res: NextApiResponse) {
  setPrivateNoStore(res);
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  return res.status(410).json({ error: 'This route has moved.', code: 'moved', use: '/api/trading/positions/:id/close' });
}

export default withAuth(retired, ['student']);
