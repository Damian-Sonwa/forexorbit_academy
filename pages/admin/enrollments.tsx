/**
 * Admin portal: enrollments and entitlements (Phase 13). GET /api/admin/portal/enrollments, read-only.
 * Grants and revocations stay on Course access (Super Admin, reason required, audited); paid access
 * ends only through a refund. Nothing here can grant access.
 */

import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import AdminShell from '@/components/admin/portal/AdminShell';
import { DataTable, ExportButton, Field, FilterBar, Pager, txt } from '@/components/admin/portal/Views';
import { EmptyState, ErrorState } from '@/components/student/dashboard/Panels';
import { formatDate } from '@/components/student/dashboard/format';
import { TableSkeleton } from '@/components/loading';
import { usePortalResource } from '@/hooks/usePortalResource';
import type { EnrollmentList } from '@/lib/admin-portal';

const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : '');
const ACCESS_LABEL: Record<string, string> = { paid_course: 'Paid', complimentary: 'Complimentary', manual_grant: 'Manual grant' };

export default function AdminEnrollmentsPage() {
  const router = useRouter();
  const status = one(router.query.status);
  const access = one(router.query.access);
  const q = one(router.query.q);
  const page = Number(one(router.query.page)) || 1;
  const [search, setSearch] = useState(q);
  useEffect(() => { setSearch(q); }, [q]);
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (access) params.set('access', access);
  if (q) params.set('q', q);
  if (page > 1) params.set('page', String(page));
  const { data, error, loading, reload } = usePortalResource<EnrollmentList>(router.isReady ? `/admin/portal/enrollments?${params.toString()}` : null);
  const setQuery = (next: Record<string, string>) => {
    const query: Record<string, string> = { ...(status ? { status } : {}), ...(access ? { access } : {}), ...(q ? { q } : {}) };
    for (const [k, v] of Object.entries(next)) { if (v) query[k] = v; else delete query[k]; }
    if (!('page' in next)) delete query.page;
    void router.push({ pathname: router.pathname, query }, undefined, { shallow: true });
  };
  return (
    <AdminShell
      title="Enrollments"
      lede="Who is enrolled where, and the course access each enrollment rests on."
      actions={<div className="flex gap-2">{data?.canGrant && <Link href="/admin/course-access" className="btn btn-ghost btn-sm">Course access</Link>}<ExportButton href={new URLSearchParams({ type: 'enrollments', ...(status ? { status } : {}), ...(access ? { access } : {}), ...(q ? { q } : {}) }).toString()} /></div>}
    >
      <FilterBar onSubmit={() => setQuery({ q: search.trim() })}>
        <Field label="Student name or email" grow><input className="input w-full" value={search} maxLength={80} onChange={(e) => setSearch(e.target.value)} /></Field>
        <Field label="Status">
          <select className="input w-full sm:!w-36" value={status} onChange={(e) => setQuery({ status: e.target.value })}>
            <option value="">All</option><option value="active">Active</option><option value="withdrawn">Withdrawn</option>
          </select>
        </Field>
        <Field label="Access">
          <select className="input w-full sm:!w-44" value={access} onChange={(e) => setQuery({ access: e.target.value })}>
            <option value="">Any</option><option value="paid">Paid</option><option value="granted">Complimentary or manual</option>
          </select>
        </Field>
        <button type="submit" className="btn btn-secondary w-full sm:w-auto">Search</button>
      </FilterBar>
      {loading && !data && <TableSkeleton rows={8} />}
      {error && <ErrorState text={error} onRetry={() => void reload()} />}
      {data && (
        <>
          <DataTable
            testId="enrollments-table"
            empty={data.rows.length ? undefined : <EmptyState title="No enrollments match" />}
            head={<tr><th>Student</th><th>Course</th><th>Status</th><th className="hidden sm:table-cell">Progress</th><th className="hidden md:table-cell">Access</th><th className="hidden lg:table-cell">Enrolled</th></tr>}
          >
            {data.rows.map((e) => (
              <tr key={e.id}>
                <td className="max-w-[12rem]"><Link href={`/admin/users/${e.studentId}`} className="font-medium text-ink hover:underline">{e.student}</Link>{e.email && <span className="block truncate text-2xs text-ink-subtle">{e.email}</span>}</td>
                <td className="max-w-[14rem]"><span className="line-clamp-2">{txt(e.course)}</span></td>
                <td className="capitalize">{e.status}</td>
                <td className="hidden num sm:table-cell">{Math.round(e.progress)}%{e.completedAt ? ' · done' : ''}</td>
                <td className="hidden text-xs md:table-cell">{e.access ? `${ACCESS_LABEL[e.access.type || ''] || e.access.type || 'Access'}${e.access.entitled ? '' : ' (ended)'}` : <span className="text-ink-subtle">Free preview only</span>}{e.access?.reference && <span className="block font-mono text-2xs text-ink-subtle">{e.access.reference}</span>}</td>
                <td className="hidden text-xs text-ink-subtle lg:table-cell">{formatDate(e.enrolledAt)}</td>
              </tr>
            ))}
          </DataTable>
          <Pager page={data.pagination.page} pages={data.pagination.pages} total={data.pagination.total} onPage={(p) => setQuery({ page: String(p) })} />
          <p className="mt-3 text-xs text-ink-subtle">Access is decided by the server from verified payments and recorded grants. This page cannot grant or remove access.</p>
        </>
      )}
    </AdminShell>
  );
}
