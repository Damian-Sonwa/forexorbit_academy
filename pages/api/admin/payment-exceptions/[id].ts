/**
 * PUT /api/admin/payment-exceptions/:id — record an investigation outcome.
 * Body: { status, outcome, notes, reason }. Original exception evidence is preserved; the change
 * and its actor are kept on the exception and in the audit log. No access or payment is changed.
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { unexpectedBody } from '@/lib/public-error';
import { updateException } from '@/lib/admin-purchase-ledger';
import { superAdminOnly, withinLedgerLimit } from '@/lib/admin-ledger-route';

async function handler(req: AuthRequest, res: NextApiResponse) {
  if (!superAdminOnly(req, res)) return;
  if (req.method !== 'PUT') {
    res.setHeader('Allow', ['PUT']);
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!withinLedgerLimit('write', req, res)) return;
  try {
    const db = await getDb();
    const id = typeof req.query.id === 'string' ? req.query.id : '';
    const result = await updateException(db, id, req.body, req.user!);
    if (!result.ok) {
      return res.status(result.status).json('reviewSaved' in result && result.reviewSaved ? { error: result.message, reviewSaved: true } : { error: result.message });
    }
    return res.status(200).json({ exception: result.exception });
  } catch (error: unknown) {
    return res.status(500).json(unexpectedBody('admin payment exception update', error));
  }
}

export default withAuth(handler, ['superadmin']);
