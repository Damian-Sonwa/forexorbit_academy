/**
 * POST /api/admin/payments/reconcile  { verifySample? }  (Super Admin)
 * Runs one bounded reconciliation pass (lib/payment-reconciliation.js) and returns its report:
 * repairs proven by Paystack (stalled confirmations, paid but unconfirmed checkouts, refund
 * statuses) and diagnostics that need a person. Never charges or refunds.
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { unexpectedBody } from '@/lib/public-error';
import { decidePaymentEnvironment } from '@/lib/course-payment';
import { runReconciliation } from '@/lib/payment-reconciliation';
import { listPaystackRefundsFor, logPayment, lookupPaystackRefund, lookupPaystackTransaction } from '@/lib/payment-route';
import { superAdminOnly, withinLedgerLimit } from '@/lib/admin-ledger-route';

async function handler(req: AuthRequest, res: NextApiResponse) {
  if (!superAdminOnly(req, res)) return;
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const environment = decidePaymentEnvironment(process.env);
  if (!environment.enabled) {
    return res.status(503).json({ error: 'Reconciliation needs Paystack, which is not available in this environment.', code: environment.reason });
  }
  if (!(await withinLedgerLimit('provider', req, res))) return;
  const sample = Number(((req.body || {}) as { verifySample?: unknown }).verifySample);
  try {
    const report = await runReconciliation(await getDb(), {
      apply: true,
      limit: 25,
      verifySample: Number.isInteger(sample) && sample > 0 ? Math.min(sample, 10) : 0,
      fetchTransaction: lookupPaystackTransaction,
      fetchRefund: lookupPaystackRefund,
      listRefunds: listPaystackRefundsFor,
    });
    logPayment('reconcile-admin', { items: report.items.length, budgetLeft: report.budgetLeft });
    return res.status(200).json(report);
  } catch (error: unknown) {
    return res.status(500).json(unexpectedBody('payment reconciliation', error));
  }
}

export default withAuth(handler, ['superadmin']);
