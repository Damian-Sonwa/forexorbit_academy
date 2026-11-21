/**
 * POST /api/admin/payments/reconcile  { verifySample? }  (Super Admin)
 * Runs one bounded reconciliation pass (lib/payment-reconciliation.js) and returns its report:
 * repairs proven by Paystack (stalled confirmations, paid but unconfirmed checkouts, refund
 * statuses) and diagnostics that need a person. Never charges or refunds.
 * Phase 13: every run is written to the admin audit log (actor, counts, repairs applied).
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { unexpectedBody } from '@/lib/public-error';
import { decidePaymentEnvironment } from '@/lib/course-payment';
import { runReconciliation } from '@/lib/payment-reconciliation';
import { listPaystackRefundsFor, logPayment, lookupPaystackRefund, lookupPaystackTransaction } from '@/lib/payment-route';
import { superAdminOnly, withinLedgerLimit } from '@/lib/admin-ledger-route';
import { AUDIT_COLLECTION } from '@/lib/course-payment';

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
    try {
      const db = await getDb();
      await db.collection(AUDIT_COLLECTION).insertOne({
        entityType: 'reconciliation',
        entityId: report.checkedAt,
        reference: null,
        action: 'reconciliation_run',
        reason: '',
        before: null,
        after: { counts: report.counts, items: report.items.length, applied: report.apply === true, budgetLeft: report.budgetLeft },
        outcome: 'saved',
        actor: { userId: req.user!.userId, email: req.user!.email || null, role: req.user!.role },
        createdAt: new Date(),
      });
    } catch {
      // The repairs are already applied and each is idempotent; the report still goes back.
      console.error(JSON.stringify({ event: 'reconcileAudit', result: 'write_failed' }));
    }
    return res.status(200).json(report);
  } catch (error: unknown) {
    return res.status(500).json(unexpectedBody('payment reconciliation', error));
  }
}

export default withAuth(handler, ['superadmin']);
