/**
 * Admin portal: payments (Phase 13, Super Admin). GET /api/admin/portal/payments: every checkout with
 * its state (see components/admin/portal/Views CHECKOUT_STATE) and refunds. Read-only: details,
 * provider verification and refunds stay in the purchase ledger.
 */

import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import AdminShell from '@/components/admin/portal/AdminShell';
import { CHECKOUT_STATE, DataTable, ExportButton, Field, FilterBar, Pager, REFUND_STATE, StatusChip, money, txt } from '@/components/admin/portal/Views';
import { Disclosure, EmptyState, ErrorState } from '@/components/student/dashboard/Panels';
import { formatDate } from '@/components/student/dashboard/format';
import { TableSkeleton } from '@/components/loading';
import { usePortalResource } from '@/hooks/usePortalResource';
import type { PaymentList } from '@/lib/admin-portal';

const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : '');
const STATES = ['paid', 'pending', 'confirming', 'stalled', 'held', 'abandoned', 'closed', 'refunded'];

export default function AdminPaymentsPage() {
  const router = useRouter();
  const state = one(router.query.state);
  const from = one(router.query.from);
  const to = one(router.query.to);
  const q = one(router.query.q);
  const page = Number(one(router.query.page)) || 1;
  const [search, setSearch] = useState(q);
  useEffect(() => { setSearch(q); }, [q]);
  const filters: Record<string, string> = { ...(state ? { state } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}), ...(q ? { q } : {}) };
  const params = new URLSearchParams({ ...filters, ...(page > 1 ? { page: String(page) } : {}) });
  const { data, error, loading, reload } = usePortalResource<PaymentList>(router.isReady ? `/admin/portal/payments?${params.toString()}` : null);
  const setQuery = (next: Record<string, string>) => {
    const query: Record<string, string> = { ...filters };
    for (const [k, v] of Object.entries(next)) { if (v) query[k] = v; else delete query[k]; }
    if (!('page' in next)) delete query.page;
    void router.push({ pathname: router.pathname, query }, undefined, { shallow: true });
  };
  return (
    <AdminShell superOnly title="Payments" lede="Every checkout and what happened to it. Only verified payments count as paid." actions={<div className="flex gap-2"><Link href="/admin/purchases" className="btn btn-ghost btn-sm">Purchase ledger</Link><ExportButton href={new URLSearchParams({ type: 'payments', ...filters }).toString()} /></div>}>
      <FilterBar onSubmit={() => setQuery({ q: search.trim() })}>
        <Field label="Reference or email" grow><input className="input w-full" value={search} maxLength={80} onChange={(e) => setSearch(e.target.value)} /></Field>
        <Field label="State">
          <select className="input w-full sm:!w-48" value={state} onChange={(e) => setQuery({ state: e.target.value })}>
            <option value="">All states</option>
            {STATES.map((s) => <option key={s} value={s}>{s === 'refunded' ? 'Refunded' : CHECKOUT_STATE[s].label}</option>)}
          </select>
        </Field>
        <Field label="From"><input type="date" className="input w-full sm:!w-40" value={from} onChange={(e) => setQuery({ from: e.target.value })} /></Field>
        <Field label="To"><input type="date" className="input w-full sm:!w-40" value={to} onChange={(e) => setQuery({ to: e.target.value })} /></Field>
        <button type="submit" className="btn btn-secondary w-full sm:w-auto">Search</button>
      </FilterBar>
      <div className="mb-4">
        <Disclosure title="What the states mean" testId="state-legend">
          <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            {Object.entries(CHECKOUT_STATE).filter(([k]) => k !== 'unknown').map(([k, v]) => (
              <div key={k}><dt><StatusChip map={CHECKOUT_STATE} value={k} /></dt><dd className="mt-1 text-xs text-ink-muted">{v.help}</dd></div>
            ))}
          </dl>
        </Disclosure>
      </div>
      {loading && !data && <TableSkeleton rows={8} />}
      {error && <ErrorState text={error} onRetry={() => void reload()} />}
      {data && (
        <>
          <DataTable
            testId="payments-table"
            empty={data.rows.length ? undefined : <EmptyState title="No checkouts match" />}
            head={<tr><th>Reference</th><th className="hidden sm:table-cell">Student</th><th className="hidden md:table-cell">Course</th><th className="text-right">Amount</th><th>State</th><th className="hidden lg:table-cell">Created</th></tr>}
          >
            {data.rows.map((p) => (
              <tr key={p.reference}>
                <td className="max-w-[9rem] font-mono text-xs sm:max-w-[14rem]"><Link href={`/admin/purchases?q=${encodeURIComponent(p.reference)}`} className="[overflow-wrap:anywhere] hover:underline">{p.reference}</Link><span className="mt-1 block font-sans text-2xs text-ink-subtle sm:hidden">{p.student}</span></td>
                <td className="hidden max-w-[12rem] sm:table-cell"><Link href={`/admin/users/${p.studentId}`} className="text-ink hover:underline">{p.student}</Link><span className="block truncate text-2xs text-ink-subtle">{p.email}</span></td>
                <td className="hidden max-w-[14rem] md:table-cell"><span className="line-clamp-2">{txt(p.course)}</span></td>
                <td className="whitespace-nowrap text-right num">{money(p.amount, p.currency)}{p.refunded !== '0.00' && <span className="block text-2xs text-ink-subtle">refunded {money(p.refunded, p.currency)}</span>}</td>
                <td><StatusChip map={CHECKOUT_STATE} value={p.state} />{p.refund && <span className="block text-2xs text-ink-subtle">{REFUND_STATE[p.refund]}</span>}</td>
                <td className="hidden whitespace-nowrap text-xs text-ink-subtle lg:table-cell">{formatDate(p.createdAt, true)}{p.paidAt && <span className="block">paid {formatDate(p.paidAt, true)}</span>}</td>
              </tr>
            ))}
          </DataTable>
          <Pager page={data.pagination.page} pages={data.pagination.pages} total={data.pagination.total} onPage={(p) => setQuery({ page: String(p) })} />
        </>
      )}
    </AdminShell>
  );
}
