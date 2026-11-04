/**
 * /api/admin/market  (Phase 10)
 * GET   Admin and Super Admin: market health and incidents. The seed is never returned.
 * POST  Super Admin: { action: 'suspend', reason } or { action: 'resume' }. Recorded as an incident.
 */
import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { setPrivateNoStore } from '@/lib/lesson-documents';
import { unexpectedBody } from '@/lib/public-error';
import { healthReport, incident, resumeMarket, suspendMarket } from '@/lib/market/health';
import { COLLECTIONS, simulatedTime } from '@/lib/trading/market-data';

const MAX_REASON_LENGTH = 200;

async function handler(req: AuthRequest, res: NextApiResponse) {
  setPrivateNoStore(res);
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const db = await getDb();
    const market = await db.collection(COLLECTIONS.datasets).findOne({ active: true, kind: 'synthetic' });
    if (!market) return res.status(404).json({ error: 'No simulated market is active.', code: 'no_market' });
    if (req.method === 'GET') return res.json(await healthReport(db, market));

    if (req.user!.role !== 'superadmin') return res.status(403).json({ error: 'Only the Super Admin can change the market.' });
    const { action, reason } = (req.body || {}) as { action?: unknown; reason?: unknown };
    const now = new Date();
    if (action === 'suspend') {
      const text = typeof reason === 'string' ? reason.slice(0, MAX_REASON_LENGTH) : 'admin';
      await suspendMarket(db, market, { reason: text, now });
    } else if (action === 'resume') {
      const result = await resumeMarket(db, market, { now, simTime: simulatedTime(market, now) });
      if (!result.ok) return res.status(409).json({ error: 'The market failed its history check and stays suspended.', code: 'history_mismatch' });
    } else {
      return res.status(400).json({ error: 'Action must be suspend or resume.' });
    }
    await incident(db, market, { kind: 'admin_action', detail: { action, actorId: req.user!.userId }, now });
    return res.json(await healthReport(db, market));
  } catch (error: unknown) {
    return res.status(500).json(unexpectedBody('admin market', error));
  }
}

export default withAuth(handler, ['admin', 'superadmin']);
