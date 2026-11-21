/** Admin portal: audit log (Phase 13, Super Admin). GET /api/admin/portal/audit; the log is append-only for the app. */

import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import AdminShell from '@/components/admin/portal/AdminShell';
import { AuditTable, ExportButton, Field, FilterBar, Pager } from '@/components/admin/portal/Views';
import { ErrorState } from '@/components/student/dashboard/Panels';
import { TableSkeleton } from '@/components/loading';
import { usePortalResource } from '@/hooks/usePortalResource';
import type { AuditPage } from '@/lib/admin-portal';

const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : '');
const TYPES: Array<[string, string]> = [['', 'All'], ['account', 'Accounts'], ['course', 'Courses'], ['grade', 'Grades'], ['course_access', 'Course access'], ['purchase', 'Purchases'], ['payment_exception', 'Payment exceptions'], ['reconciliation', 'Reconciliation'], ['export', 'Exports']];

export default function AdminAuditPage() {
  const router = useRouter();
  const entityType = one(router.query.entityType);
  const actor = one(router.query.actor);
  const from = one(router.query.from);
  const to = one(router.query.to);
  const q = one(router.query.q);
  const page = Number(one(router.query.page)) || 1;
  const [actorText, setActorText] = useState(actor);
  const [qText, setQText] = useState(q);
  useEffect(() => { setActorText(actor); setQText(q); }, [actor, q]);
  const filters: Record<string, string> = Object.fromEntries(Object.entries({ entityType, actor, from, to, q }).filter(([, v]) => v));
  const params = new URLSearchParams({ ...filters, ...(page > 1 ? { page: String(page) } : {}) });
  const { data, error, loading, reload } = usePortalResource<AuditPage>(router.isReady ? `/admin/portal/audit?${params.toString()}` : null);
  const setQuery = (next: Record<string, string>) => {
    const query: Record<string, string> = { ...filters };
    for (const [k, v] of Object.entries(next)) { if (v) query[k] = v; else delete query[k]; }
    if (!('page' in next)) delete query.page;
    void router.push({ pathname: router.pathname, query }, undefined, { shallow: true });
  };
  return (
    <AdminShell superOnly title="Audit log" lede="Every recorded administrative and academic action. Entries cannot be changed or deleted by the application." actions={<ExportButton href={new URLSearchParams({ type: 'audit', ...filters }).toString()} />}>
      <FilterBar onSubmit={() => setQuery({ actor: actorText.trim(), q: qText.trim() })}>
        <Field label="Type">
          <select className="input w-full sm:!w-44" value={entityType} onChange={(e) => setQuery({ entityType: e.target.value })}>
            {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <Field label="Actor email starts with"><input className="input w-full sm:!w-52" value={actorText} maxLength={80} onChange={(e) => setActorText(e.target.value)} /></Field>
        <Field label="Reference or target"><input className="input w-full sm:!w-44" value={qText} maxLength={80} onChange={(e) => setQText(e.target.value)} /></Field>
        <Field label="From"><input type="date" className="input w-full sm:!w-40" value={from} onChange={(e) => setQuery({ from: e.target.value })} /></Field>
        <Field label="To"><input type="date" className="input w-full sm:!w-40" value={to} onChange={(e) => setQuery({ to: e.target.value })} /></Field>
        <button type="submit" className="btn btn-secondary w-full sm:w-auto">Filter</button>
      </FilterBar>
      {loading && !data && <TableSkeleton rows={10} />}
      {error && <ErrorState text={error} onRetry={() => void reload()} />}
      {data && (
        <>
          <AuditTable rows={data.rows} />
          <Pager page={data.pagination.page} pages={data.pagination.pages} total={data.pagination.total} onPage={(p) => setQuery({ page: String(p) })} />
        </>
      )}
    </AdminShell>
  );
}
