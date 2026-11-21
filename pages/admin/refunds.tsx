/**
 * Admin portal: refunds (Phase 13, Super Admin). GET /api/admin/portal/refunds. Monitoring only:
 * starting, refreshing or closing a refund stays in the purchase ledger (POST /api/admin/refunds,
 * idempotent request ids, Paystack's answer decides completion, audited).
 */

import Link from 'next/link';
import { useRouter } from 'next/router';
import AdminShell from '@/components/admin/portal/AdminShell';
import { DataTable, ExportButton, Pager, money, txt } from '@/components/admin/portal/Views';
import { EmptyState, ErrorState } from '@/components/student/dashboard/Panels';
import { formatDate } from '@/components/student/dashboard/format';
import { TableSkeleton } from '@/components/loading';
import { usePortalResource } from '@/hooks/usePortalResource';
import type { RefundList } from '@/lib/admin-portal';

const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : '');
const GROUPS: Array<['' | 'open' | 'processed' | 'failed', string]> = [['', 'All'], ['open', 'Open'], ['processed', 'Processed'], ['failed', 'Failed']];
const STATUS_TONE: Record<string, string> = { processed: 'chip-up', failed: 'chip-down', request_failed: 'chip-down', uncertain: 'chip-down', needs_attention: 'chip-down' };

export default function AdminRefundsPage() {
  const router = useRouter();
  const status = one(router.query.status) as '' | 'open' | 'processed' | 'failed';
  const page = Number(one(router.query.page)) || 1;
  const params = new URLSearchParams({ ...(status ? { status } : {}), ...(page > 1 ? { page: String(page) } : {}) });
  const { data, error, loading, reload } = usePortalResource<RefundList>(router.isReady ? `/admin/portal/refunds?${params.toString()}` : null);
  const go = (next: Record<string, string>) => void router.push({ pathname: router.pathname, query: Object.fromEntries(Object.entries({ status, ...next }).filter(([, v]) => v)) }, undefined, { shallow: true });
  return (
    <AdminShell superOnly title="Refunds" lede="Refunds across all payments. A refund is complete only when Paystack reports it processed." actions={<ExportButton href={new URLSearchParams({ type: 'refunds', ...(status ? { status } : {}) }).toString()} />}>
      <div className="mb-5 flex gap-1 overflow-x-auto rounded-xl border border-line bg-surface-2 p-1" role="tablist" aria-label="Refund status">
        {GROUPS.map(([id, label]) => (
          <button key={id || 'all'} type="button" role="tab" aria-selected={status === id} onClick={() => go({ status: id, page: '' })} className={`min-h-[40px] shrink-0 rounded-lg px-3.5 text-sm font-medium ${status === id ? 'bg-surface-1 text-ink shadow-panel' : 'text-ink-muted hover:text-ink'}`}>
            {label}{data && id && <span className="ml-1.5 text-ink-subtle num">{data.counts[id]}</span>}
          </button>
        ))}
      </div>
      {loading && !data && <TableSkeleton rows={6} />}
      {error && <ErrorState text={error} onRetry={() => void reload()} />}
      {data && (
        <>
          <DataTable
            testId="refunds-table"
            empty={data.rows.length ? undefined : <EmptyState title="No refunds" />}
            head={<tr><th>Payment</th><th className="hidden sm:table-cell">Student</th><th className="text-right">Amount</th><th>Status</th><th className="hidden md:table-cell">Reason</th><th className="hidden lg:table-cell">Requested</th></tr>}
          >
            {data.rows.map((r) => (
              <tr key={r.id}>
                <td className="max-w-[9rem] font-mono text-xs sm:max-w-[14rem]"><Link href={`/admin/purchases?q=${encodeURIComponent(r.reference)}`} className="[overflow-wrap:anywhere] hover:underline">{r.reference}</Link><span className="block font-sans text-2xs text-ink-subtle">{txt(r.course)}</span></td>
                <td className="hidden sm:table-cell">{r.student}</td>
                <td className="whitespace-nowrap text-right num">{money(r.amount)}<span className="block text-2xs text-ink-subtle">{r.full ? 'full' : 'partial'}{r.revokeAccess ? ' · removes access' : ''}</span></td>
                <td><span className={`chip ${STATUS_TONE[r.status] || 'chip-brand'}`}>{r.status.replace('_', ' ')}</span></td>
                <td className="hidden max-w-[16rem] text-xs text-ink-muted md:table-cell">{r.reason || '-'}</td>
                <td className="hidden whitespace-nowrap text-xs text-ink-subtle lg:table-cell">{formatDate(r.requestedAt, true)}{r.requestedBy && <span className="block">{r.requestedBy}</span>}</td>
              </tr>
            ))}
          </DataTable>
          <Pager page={data.pagination.page} pages={data.pagination.pages} total={data.pagination.total} onPage={(p) => go({ page: String(p) })} />
          <p className="mt-3 text-xs text-ink-subtle">To refresh a refund from Paystack or start one, open the payment in the purchase ledger. Refunds move real money and are never issued from this list.</p>
        </>
      )}
    </AdminShell>
  );
}
