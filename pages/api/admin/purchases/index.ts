/**
 * GET /api/admin/purchases — Super Admin purchase ledger (read-only).
 * Query: q, source, courseId, access, review, page, pageSize.
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { unexpectedBody } from '@/lib/public-error';
import { listPurchases } from '@/lib/admin-purchase-ledger';
import { firstQueryValues, superAdminOnly } from '@/lib/admin-ledger-route';

async function handler(req: AuthRequest, res: NextApiResponse) {
  if (!superAdminOnly(req, res)) return;
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const db = await getDb();
    return res.status(200).json(await listPurchases(db, firstQueryValues(req.query)));
  } catch (error: unknown) {
    return res.status(500).json(unexpectedBody('admin purchase ledger', error));
  }
}

export default withAuth(handler, ['superadmin']);
