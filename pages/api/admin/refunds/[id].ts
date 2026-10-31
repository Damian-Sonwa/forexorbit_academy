/**
 * POST /api/admin/refunds/:id  (Super Admin)
 *   { action: 'refresh' }                  re-read the refund from Paystack and apply its status
 *   { action: 'close_uncertain', reason }  the Super Admin confirmed in the Paystack dashboard that
 *                                          an unconfirmed request created no refund
 */

import type { NextApiResponse } from 'next';
import { ObjectId } from 'mongodb';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { unexpectedBody } from '@/lib/public-error';
import { decidePaymentEnvironment } from '@/lib/course-payment';
import { abandonUncertainRefund, presentRefund, refreshRefund } from '@/lib/payment-refunds';
import { listPaystackRefundsFor, logPayment, lookupPaystackRefund, lookupPaystackTransaction } from '@/lib/payment-route';
import { superAdminOnly, withinLedgerLimit } from '@/lib/admin-ledger-route';

async function handler(req: AuthRequest, res: NextApiResponse) {
  if (!superAdminOnly(req, res)) return;
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const id = typeof req.query.id === 'string' && ObjectId.isValid(req.query.id) ? new ObjectId(req.query.id) : null;
  if (!id) return res.status(400).json({ error: 'Invalid refund id.' });
  const body = (req.body || {}) as { action?: unknown; reason?: unknown };
  try {
    const db = await getDb();
    if (body.action === 'close_uncertain') {
      if (!(await withinLedgerLimit('write', req, res))) return;
      const out = await abandonUncertainRefund(db, id, {
        actor: { userId: req.user!.userId, email: req.user!.email, role: req.user!.role },
        reason: body.reason,
      });
      if (!out.ok) return res.status(out.status).json({ error: out.message, code: out.code });
      logPayment('refund-close-uncertain', { refundId: String(id), code: out.code });
      return res.status(200).json({ code: out.code, refund: presentRefund(out.refund) });
    }
    if (body.action !== 'refresh') return res.status(400).json({ error: 'action must be "refresh" or "close_uncertain".' });
    const environment = decidePaymentEnvironment(process.env);
    if (!environment.enabled) {
      return res.status(503).json({ error: 'Paystack lookups are not available in this environment.', code: environment.reason });
    }
    if (!(await withinLedgerLimit('provider', req, res))) return;
    const out = await refreshRefund(db, id, {
      fetchRefund: lookupPaystackRefund,
      listRefunds: listPaystackRefundsFor,
      fetchTransaction: lookupPaystackTransaction,
    });
    logPayment('refund-refresh', { refundId: String(id), code: out.code });
    if (out.code === 'refund_not_found') return res.status(404).json({ error: 'Refund not found.' });
    return res.status(out.ok ? 200 : 503).json({ code: out.code, refund: presentRefund(out.refund || null) });
  } catch (error: unknown) {
    return res.status(500).json(unexpectedBody('admin refund action', error));
  }
}

export default withAuth(handler, ['superadmin']);
