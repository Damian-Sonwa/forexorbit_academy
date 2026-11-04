/**
 * Performance Metrics API Route
 *
 * Switched off (Phase 10, G0). The previous figures were a mock: entry and exit price were the same
 * value, so every trade computed to zero, yet they were shown as the student's results. No figures
 * are returned until they can be derived from the simulator's ledger
 * (docs/audits/phase-10-practice-trading.md).
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { setPrivateNoStore } from '@/lib/lesson-documents';

async function getPerformance(req: AuthRequest, res: NextApiResponse) {
  setPrivateNoStore(res);
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  return res.status(503).json({
    available: false,
    code: 'performance_unavailable',
    error: 'Performance results are not available yet.',
  });
}

export default withAuth(getPerformance, ['student']);
