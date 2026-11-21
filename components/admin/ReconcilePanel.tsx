/**
 * Run one payment reconciliation pass (Super Admin): POST /api/admin/payments/reconcile
 * (lib/payment-reconciliation.js). It repairs only what Paystack's own answer proves and lists the
 * rest for a person; it never charges or refunds. Each run is audited (Phase 13). Shared by the
 * purchases page and the admin portal's Reconciliation page.
 */

import { useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { messageFromUnknown } from '@/lib/public-error';
import type { ReconciliationReport } from '@/lib/payment-reconciliation';

/** What each report code means (lib/payment-reconciliation.js header). */
export const RECONCILE_CODES: Record<string, { label: string; kind: 'repair' | 'diagnostic' }> = {
  stale_processing: { label: 'Stopped confirmation finished', kind: 'repair' },
  unconfirmed_paid: { label: 'Payment Paystack reports paid, now confirmed', kind: 'repair' },
  refund_status: { label: 'Refund status refreshed from Paystack', kind: 'repair' },
  entitlement_without_enrollment: { label: 'Paid student enrolled', kind: 'repair' },
  payment_without_access: { label: 'Verified payment without access', kind: 'diagnostic' },
  duplicate_reference: { label: 'Same reference recorded twice', kind: 'diagnostic' },
  duplicate_entitlement: { label: 'More than one access row', kind: 'diagnostic' },
  local_success_unverified: { label: 'Local success Paystack does not confirm', kind: 'diagnostic' },
  refund_without_record: { label: 'Refund event without a local record', kind: 'diagnostic' },
  held_payment: { label: 'Verified charge held for review', kind: 'diagnostic' },
  refund_uncertain: { label: 'Refund outcome still unknown', kind: 'diagnostic' },
};

export default function ReconcilePanel({ onRan }: { onRan?: () => void }) {
  const [report, setReport] = useState<ReconciliationReport | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function run() {
    if (!window.confirm('Run a reconciliation pass now? It asks Paystack about recent checkouts and refunds and applies only the repairs Paystack proves. It never charges or refunds. The run is recorded in the audit log.')) return;
    setBusy(true);
    setError('');
    try {
      setReport(await apiClient.post<ReconciliationReport>('/admin/payments/reconcile', { verifySample: 5 }));
      onRan?.();
    } catch (reason) {
      setError(messageFromUnknown(reason) || 'Reconciliation could not run.');
    } finally {
      setBusy(false);
    }
  }

  const counts = report ? Object.entries(report.counts || {}).filter(([, n]) => n > 0) : [];
  return (
    <section className="card mb-6 !p-5" data-testid="reconcile-panel">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="section-title">Reconcile with Paystack</h2>
          <p className="mt-1 text-sm text-ink-muted">Finishes confirmations that stopped, settles checkouts Paystack reports paid, refreshes refunds, and lists anything that needs a person. It never charges or refunds.</p>
        </div>
        <button type="button" onClick={run} disabled={busy} className="btn btn-primary w-full shrink-0 sm:w-auto">{busy ? 'Running…' : 'Run reconciliation'}</button>
      </div>
      {error ? <p className="notice notice-caution mt-3 text-sm" role="alert">{error}</p> : null}
      {report ? (
        <div className="mt-4 space-y-3 text-sm" data-testid="reconcile-report">
          <p className="text-ink-muted">Checked {new Date(report.checkedAt).toLocaleString()}. {report.items.length ? `${report.items.length} item${report.items.length === 1 ? '' : 's'}.` : 'Nothing to report.'}{report.budgetLeft === 0 ? ' The provider-call budget ran out; run again for the rest.' : ''}</p>
          {counts.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {counts.map(([code, n]) => (
                <li key={code} className={`chip ${(RECONCILE_CODES[code] || {}).kind === 'repair' ? 'chip-up' : 'chip-brand'}`}>{(RECONCILE_CODES[code] || { label: code }).label}: {n}</li>
              ))}
            </ul>
          )}
          {report.items.length ? (
            <ul className="max-h-72 space-y-1 overflow-y-auto rounded-lg border border-line p-3">
              {report.items.map((item, i) => (
                <li key={`${item.type}-${item.reference}-${i}`} className="[overflow-wrap:anywhere]">
                  <span className="font-semibold">{(RECONCILE_CODES[item.type] || { label: item.type }).label}</span> · <span className="font-mono text-xs">{item.reference || '—'}</span> · {item.action}{item.detail ? ` (${item.detail})` : ''}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
