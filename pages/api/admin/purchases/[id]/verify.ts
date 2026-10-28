/**
 * POST /api/admin/purchases/:id/verify — read-only Paystack lookup for this purchase's reference.
 * Calls GET /transaction/verify only. Never initializes, charges, or refunds. The comparison is
 * returned to the Super Admin and audited by warning codes; provider customer data is not stored.
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { unexpectedBody } from '@/lib/public-error';
import { decidePaymentEnvironment } from '@/lib/course-payment';
import { checkPurchaseWithProvider } from '@/lib/admin-purchase-ledger';
import { lookupPaystackTransaction } from '@/lib/payment-route';
import { superAdminOnly, withinLedgerLimit } from '@/lib/admin-ledger-route';

async function handler(req: AuthRequest, res: NextApiResponse) {
  if (!superAdminOnly(req, res)) return;
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const environment = decidePaymentEnvironment(process.env);
  if (!environment.enabled) {
    return res.status(503).json({ error: 'Paystack lookups are not available in this environment.', code: environment.reason });
  }
  if (!(await withinLedgerLimit('provider', req, res))) return;
  try {
    const db = await getDb();
    const id = typeof req.query.id === 'string' ? req.query.id : '';
    const outcome = await checkPurchaseWithProvider(db, id, { fetchTransaction: lookupPaystackTransaction, actor: req.user! });
    if (!outcome.ok) return res.status(outcome.status).json({ error: 'Purchase not found.' });
    return res.status(200).json(outcome.result);
  } catch (error: unknown) {
    return res.status(500).json(unexpectedBody('admin provider check', error));
  }
}

export default withAuth(handler, ['superadmin']);
