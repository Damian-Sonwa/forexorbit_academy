/** Admin portal: users and instructors (Phase 13). GET /api/admin/portal/users, server-paginated. */

import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import AdminShell from '@/components/admin/portal/AdminShell';
import { ACCOUNT_STATUS, DataTable, ExportButton, Field, FilterBar, Pager, StatusChip } from '@/components/admin/portal/Views';
import { EmptyState, ErrorState } from '@/components/student/dashboard/Panels';
import { formatDate } from '@/components/student/dashboard/format';
import { TableSkeleton } from '@/components/loading';
import { useAuth } from '@/hooks/useAuth';
import { usePortalResource } from '@/hooks/usePortalResource';
import type { UserList } from '@/lib/admin-portal';

const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : '');

export default function AdminUsersPage() {
  const router = useRouter();
  const { user } = useAuth();
  const role = one(router.query.role);
  const status = one(router.query.status);
  const q = one(router.query.q);
  const page = Number(one(router.query.page)) || 1;
  const [search, setSearch] = useState(q);
  useEffect(() => { setSearch(q); }, [q]);
  const params = new URLSearchParams();
  if (role) params.set('role', role);
  if (status) params.set('status', status);
  if (q) params.set('q', q);
  if (page > 1) params.set('page', String(page));
  const { data, error, loading, reload } = usePortalResource<UserList>(router.isReady ? `/admin/portal/users?${params.toString()}` : null);
  const setQuery = (next: Record<string, string>) => {
    const query: Record<string, string> = { ...(role ? { role } : {}), ...(status ? { status } : {}), ...(q ? { q } : {}) };
    for (const [k, v] of Object.entries(next)) { if (v) query[k] = v; else delete query[k]; }
    if (!('page' in next)) delete query.page;
    void router.push({ pathname: router.pathname, query }, undefined, { shallow: true });
  };
  const exportQuery = new URLSearchParams({ type: 'users', ...(role ? { role } : {}), ...(status ? { status } : {}), ...(q ? { q } : {}) }).toString();

  return (
    <AdminShell
      title={role === 'instructor' ? 'Instructors' : 'Users'}
      lede="Search accounts and open one for its status, enrollments and history."
      actions={user?.role === 'superadmin' ? <ExportButton href={exportQuery} /> : undefined}
    >
      <FilterBar onSubmit={() => setQuery({ q: search.trim() })}>
        <Field label="Search name or email" grow><input className="input w-full" value={search} maxLength={80} onChange={(e) => setSearch(e.target.value)} /></Field>
        <Field label="Role">
          <select className="input w-full sm:!w-40" value={role} onChange={(e) => setQuery({ role: e.target.value })}>
            <option value="">All roles</option><option value="student">Students</option><option value="instructor">Instructors</option><option value="admin">Admins</option><option value="superadmin">Super Admin</option>
          </select>
        </Field>
        <Field label="Status">
          <select className="input w-full sm:!w-44" value={status} onChange={(e) => setQuery({ status: e.target.value })}>
            <option value="">All statuses</option><option value="active">Active</option><option value="pending">Pending approval</option><option value="suspended">Suspended</option><option value="rejected">Rejected</option>
          </select>
        </Field>
        <button type="submit" className="btn btn-secondary w-full sm:w-auto">Search</button>
      </FilterBar>
      {loading && !data && <TableSkeleton rows={8} />}
      {error && <ErrorState text={error} onRetry={() => void reload()} />}
      {data && (
        <>
          <DataTable
            testId="users-table"
            empty={data.rows.length ? undefined : <EmptyState title="No accounts match" />}
            head={<tr><th>Name</th><th className="hidden md:table-cell">Email</th><th>Role</th><th>Status</th><th className="hidden sm:table-cell">Joined</th></tr>}
          >
            {data.rows.map((u) => (
              <tr key={u.id}>
                <td className="font-medium"><Link href={`/admin/users/${u.id}`} className="text-ink hover:underline">{u.name || '(no name)'}</Link><span className="block text-2xs text-ink-subtle md:hidden">{u.email}</span></td>
                <td className="hidden max-w-[16rem] truncate md:table-cell">{u.email}</td>
                <td className="capitalize">{u.role}{u.courses !== null && <span className="block text-2xs normal-case text-ink-subtle">{u.courses} course{u.courses === 1 ? '' : 's'}</span>}</td>
                <td><StatusChip map={ACCOUNT_STATUS} value={u.status} /></td>
                <td className="hidden whitespace-nowrap text-xs text-ink-subtle sm:table-cell">{formatDate(u.createdAt)}</td>
              </tr>
            ))}
          </DataTable>
          <Pager page={data.pagination.page} pages={data.pagination.pages} total={data.pagination.total} onPage={(p) => setQuery({ page: String(p) })} />
          {!data.canDecideApprovals && <p className="mt-3 text-xs text-ink-subtle">Account approval, rejection and suspension are decided by the Super Admin.</p>}
        </>
      )}
    </AdminShell>
  );
}
