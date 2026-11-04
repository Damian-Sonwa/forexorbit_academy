/**
 * Demo Trading Account API Route
 *
 * Retired (Phase 10). The practice desk no longer uses a broker: the owner's decision is an internal
 * simulator, with no broker order execution. See /api/trading/*.
 */
import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { setPrivateNoStore } from '@/lib/lesson-documents';

async function retired(_req: AuthRequest, res: NextApiResponse) {
  setPrivateNoStore(res);
  return res.status(410).json({ error: 'This route has moved.', code: 'moved', use: '/api/trading/account' });
}

export default withAuth(retired, ['student']);
