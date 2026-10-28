/**
 * GET  /api/admin/purchases/:id — purchase detail with linked records and audit history.
 * POST /api/admin/purchases/:id — add an investigation note { outcome, notes, reason }.
 * Notes are written to the audit log only. Purchase, payment, and access records are not changed.
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { unexpectedBody } from '@/lib/public-error';
import { addPurchaseNote, getPurchaseDetail } from '@/lib/admin-purchase-ledger';
import { superAdminOnly, withinLedgerLimit } from '@/lib/admin-ledger-route';

async function handler(req: AuthRequest, res: NextApiResponse) {
  if (!superAdminOnly(req, res)) return;
  const id = typeof req.query.id === 'string' ? req.query.id : '';
  try {
    if (req.method === 'GET') {
      const db = await getDb();
      const detail = await getPurchaseDetail(db, id);
      if (!detail) return res.status(404).json({ error: 'Purchase not found.' });
      return res.status(200).json(detail);
    }
    if (req.method === 'POST') {
      if (!(await withinLedgerLimit('write', req, res))) return;
      const db = await getDb();
      const result = await addPurchaseNote(db, id, req.body, req.user!);
      if (!result.ok) return res.status(result.status).json({ error: result.message });
      return res.status(201).json({ success: true });
    }
    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error: unknown) {
    return res.status(500).json(unexpectedBody('admin purchase detail', error));
  }
}

export default withAuth(handler, ['superadmin']);
