/**
 * Admin portal: reconciliation (Phase 13, Super Admin). Runs the existing reconciliation pass
 * (components/admin/ReconcilePanel.tsx) and shows past runs from the audit log. Records are never
 * rewritten to force agreement: only repairs Paystack proves are applied.
 */

import AdminShell from '@/components/admin/portal/AdminShell';
import ReconcilePanel, { RECONCILE_CODES } from '@/components/admin/ReconcilePanel';
import { AuditTable } from '@/components/admin/portal/Views';
import { Disclosure, ErrorState, Section } from '@/components/student/dashboard/Panels';
import { TableSkeleton } from '@/components/loading';
import { usePortalResource } from '@/hooks/usePortalResource';
import type { AuditPage } from '@/lib/admin-portal';

export default function AdminReconciliationPage() {
  const runs = usePortalResource<AuditPage>('/admin/portal/audit?entityType=reconciliation&limit=10');
  return (
    <AdminShell superOnly title="Reconciliation" lede="Compare local payment records with Paystack. Proven repairs are applied; everything else is listed for a person.">
      <ReconcilePanel onRan={() => void runs.reload()} />
      <div className="mb-8">
        <Disclosure title="What a run checks" testId="reconcile-legend">
          <ul className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            {Object.entries(RECONCILE_CODES).map(([code, v]) => (
              <li key={code}><span className={`chip ${v.kind === 'repair' ? 'chip-up' : 'chip-brand'}`}>{v.kind === 'repair' ? 'Repair' : 'Needs a person'}</span> <span className="text-ink-muted">{v.label}</span></li>
            ))}
          </ul>
        </Disclosure>
      </div>
      <Section title="Past runs" kicker="Audit log">
        {runs.loading && !runs.data && <TableSkeleton rows={4} />}
        {runs.error && <ErrorState text={runs.error} onRetry={() => void runs.reload()} />}
        {runs.data && <AuditTable rows={runs.data.rows} />}
      </Section>
    </AdminShell>
  );
}
