/**
 * Super Admin refunds (lib/payment-refunds.js).
 *
 * GET  /api/admin/refunds?reference=<payment reference>   refunds recorded for one payment
 * POST /api/admin/refunds  { reference, amountKobo?, revokeAccess, reason, requestId }
 *      Starts a Paystack refund (server-side secret key). `amountKobo` omitted = the remaining
 *      amount. `revokeAccess` must be chosen explicitly; it is only allowed for a refund that
 *      completes a full refund and takes effect only once Paystack reports it processed.
 *      `requestId` (client-generated) makes a double submission return the same refund.
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { unexpectedBody } from '@/lib/public-error';
import { decidePaymentEnvironment, REFERENCE_PATTERN } from '@/lib/course-payment';
import { presentRefund, refundSummary, refundsForReference, requestRefund } from '@/lib/payment-refunds';
import { createRefundWithPaystack, logPayment, newSupportId } from '@/lib/payment-route';
import { superAdminOnly, withinLedgerLimit } from '@/lib/admin-ledger-route';

async function handler(req: AuthRequest, res: NextApiResponse) {
  if (!superAdminOnly(req, res)) return;
  try {
    const db = await getDb();
    if (req.method === 'GET') {
      const reference = typeof req.query.reference === 'string' ? req.query.reference.trim() : '';
      if (!REFERENCE_PATTERN.test(reference)) return res.status(400).json({ error: 'A valid payment reference is required.' });
      const payment = await db.collection('paystackPayments').findOne({ reference, kind: 'course' }, { projection: { amountKobo: 1 } });
      const refunds = await refundsForReference(db, reference);
      return res.status(200).json({
        reference,
        summary: refundSummary(refunds, payment ? Number(payment.amountKobo) : 0),
        refunds: refunds.map((r) => presentRefund(r)),
      });
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', ['GET', 'POST']);
      return res.status(405).json({ error: 'Method not allowed' });
    }
    const environment = decidePaymentEnvironment(process.env);
    if (!environment.enabled) {
      return res.status(503).json({ error: 'Refunds are not available in this environment.', code: environment.reason });
    }
    if (!(await withinLedgerLimit('provider', req, res))) return;
    const supportId = newSupportId();
    const body = (req.body || {}) as Record<string, unknown>;
    const result = await requestRefund(db, {
      reference: body.reference,
      amountKobo: body.amountKobo,
      revokeAccess: body.revokeAccess,
      reason: body.reason,
      requestId: body.requestId,
      actor: { userId: req.user!.userId, email: req.user!.email, role: req.user!.role },
      createRefund: createRefundWithPaystack,
    });
    logPayment('refund-request', {
      supportId,
      reference: typeof body.reference === 'string' ? body.reference.slice(0, 100) : null,
      code: result.code,
    });
    if (!result.ok) {
      return res.status(result.status).json({ error: result.message, code: result.code, refund: presentRefund(result.refund || null), supportId });
    }
    return res.status(result.status).json({ code: result.code, refund: presentRefund(result.refund), supportId });
  } catch (error: unknown) {
    return res.status(500).json(unexpectedBody('admin refund', error));
  }
}

export default withAuth(handler, ['superadmin']);
