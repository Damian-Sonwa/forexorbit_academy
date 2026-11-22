/**
 * Admin portal: one account (Phase 13). GET /api/admin/portal/users/:id.
 * Suspend / reactivate: PATCH /api/admin/users/:id (Super Admin only, reason required, audited, ends
 * the account's sessions). Approval decisions stay on the approvals screen (Super Admin only).
 */

import Link from 'next/link';
import { useRouter } from 'next/router';
import { useState } from 'react';
import AdminShell from '@/components/admin/portal/AdminShell';
import ConfirmDialog from '@/components/admin/portal/ConfirmDialog';
import { ACCOUNT_STATUS, AuditTable, CHECKOUT_STATE, DataTable, REFUND_STATE, StatusChip, money, txt } from '@/components/admin/portal/Views';
import { EmptyState, ErrorState, Metric, MetricGrid, Section } from '@/components/student/dashboard/Panels';
import { formatDate, minutesLabel } from '@/components/student/dashboard/format';
import { LessonSkeleton } from '@/components/loading';
import { usePortalResource } from '@/hooks/usePortalResource';
import { apiClient } from '@/lib/api-client';
import type { UserDetail } from '@/lib/admin-portal';

const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : '');

export default function AdminUserPage() {
  const router = useRouter();
  const id = one(router.query.id);
  const { data, error, loading, reload } = usePortalResource<UserDetail>(router.isReady && id ? `/admin/portal/users/${id}` : null);
  const [confirm, setConfirm] = useState<'suspend' | 'reactivate' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const changeStatus = async (action: 'suspend' | 'reactivate', reason: string) => {
    try {
      await apiClient.patch(`/admin/users/${id}`, { action, reason });
      setConfirm(null);
      setNotice(action === 'suspend' ? 'Account suspended. All of its sessions have ended.' : 'Account reactivated.');
      await reload();
      return null;
    } catch (err) {
      const ax = err as { response?: { data?: { error?: string } } };
      return ax?.response?.data?.error || 'The status was not changed.';
    }
  };

  const u = data?.user;
  return (
    <AdminShell title={u ? u.name || u.email : 'Account'} lede={u ? `${u.role} · ${u.email}` : undefined} actions={<Link href="/admin/users" className="btn btn-ghost btn-sm">← All users</Link>}>
      {loading && !data && <LessonSkeleton />}
      {error && <ErrorState text={error} onRetry={() => void reload()} />}
      {notice && <p className="notice notice-brand mb-4 text-sm" role="status">{notice}</p>}
      {data && u && (
        <div className="space-y-10">
          <div className="card flex flex-col gap-4 !p-5 sm:flex-row sm:items-center sm:justify-between" data-testid="account-status">
            <div>
              <p className="readout-label">Account status</p>
              <div className="mt-1 flex flex-wrap items-center gap-2"><StatusChip map={ACCOUNT_STATUS} value={u.status} /><span className="text-xs text-ink-subtle">{u.activeSessions} active session{u.activeSessions === 1 ? '' : 's'}</span></div>
              {u.statusReason && <p className="mt-1 text-xs text-ink-muted">Reason: {u.statusReason}</p>}
            </div>
            <div className="flex flex-wrap gap-2">
              {data.permissions.canDecideApproval && <Link href="/admin?tab=approvals" className="btn btn-primary btn-sm">Review approval</Link>}
              {data.permissions.canChangeStatus && u.role !== 'superadmin' && u.status === 'active' && <button type="button" className="btn btn-danger-quiet btn-sm" onClick={() => setConfirm('suspend')}>Suspend</button>}
              {data.permissions.canChangeStatus && u.status === 'suspended' && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setConfirm('reactivate')}>Reactivate</button>}
              {data.permissions.canGrantAccess && u.role === 'student' && <Link href={`/admin/course-access?userId=${u.id}`} className="btn btn-ghost btn-sm">Course access</Link>}
              {!data.permissions.canChangeStatus && <p className="text-xs text-ink-subtle">Status changes are made by the Super Admin.</p>}
            </div>
          </div>

          <MetricGrid cols="sm:grid-cols-4">
            <Metric label="Joined" value={formatDate(u.createdAt)} />
            <Metric label="Learning time" value={minutesLabel(data.learning.totalMinutes)} hint={`${data.learning.learningDays} learning days`} />
            <Metric label="Last learned" value={data.learning.lastLearningDay || '-'} />
            <Metric label={u.role === 'instructor' ? 'Courses taught' : 'Enrollments'} value={u.role === 'instructor' ? data.courses.length : data.enrollments.length} hint={u.phone ? `Phone: ${u.phone}` : undefined} />
          </MetricGrid>

          {data.courses.length > 0 && (
            <Section title="Courses taught">
              <DataTable head={<tr><th>Course</th><th>Status</th><th className="hidden sm:table-cell">Updated</th></tr>}>
                {data.courses.map((c) => (
                  <tr key={c.courseId}><td><Link href={`/builder/${c.courseId}`} className="text-ink hover:underline">{txt(c.title)}</Link></td><td className="capitalize">{c.status.replace('_', ' ')}</td><td className="hidden text-xs text-ink-subtle sm:table-cell">{formatDate(c.updatedAt)}</td></tr>
                ))}
              </DataTable>
            </Section>
          )}

          <Section title="Enrollments">
            <DataTable
              testId="user-enrollments"
              empty={data.enrollments.length ? undefined : <EmptyState title="No enrollments" />}
              head={<tr><th>Course</th><th>Status</th><th>Progress</th><th className="hidden sm:table-cell">Access</th><th className="hidden md:table-cell">Enrolled</th></tr>}
            >
              {data.enrollments.map((e) => (
                <tr key={e.courseId}>
                  <td className="max-w-[14rem]"><span className="line-clamp-2">{txt(e.course)}</span></td>
                  <td className="capitalize">{e.status}</td>
                  <td className="num">{Math.round(e.progress)}%{e.completedAt ? ' · done' : ''}</td>
                  <td className="hidden text-xs sm:table-cell">{e.access ? `${(e.access.type || '').replace('_', ' ')}${e.access.entitled ? '' : ' (not entitled)'}` : 'none'}{e.access?.reference ? <span className="block font-mono text-2xs text-ink-subtle">{e.access.reference}</span> : null}</td>
                  <td className="hidden text-xs text-ink-subtle md:table-cell">{formatDate(e.enrolledAt)}</td>
                </tr>
              ))}
            </DataTable>
          </Section>

          {data.payments && (
            <Section title="Payments" kicker="Super Admin">
              <DataTable
                empty={data.payments.length ? undefined : <EmptyState title="No checkouts" />}
                head={<tr><th>Reference</th><th className="hidden sm:table-cell">Course</th><th>Amount</th><th>State</th><th className="hidden md:table-cell">Created</th></tr>}
              >
                {data.payments.map((p) => (
                  <tr key={p.reference}>
                    <td className="font-mono text-xs"><Link href={`/admin/purchases?q=${encodeURIComponent(p.reference)}`} className="hover:underline">{p.reference}</Link></td>
                    <td className="hidden max-w-[12rem] truncate sm:table-cell">{txt(p.course)}</td>
                    <td className="num">{money(p.amount)}</td>
                    <td><StatusChip map={CHECKOUT_STATE} value={p.state} />{p.refund && <span className="block text-2xs text-ink-subtle">{REFUND_STATE[p.refund]}</span>}</td>
                    <td className="hidden text-xs text-ink-subtle md:table-cell">{formatDate(p.createdAt, true)}</td>
                  </tr>
                ))}
              </DataTable>
            </Section>
          )}

          {data.history && (
            <Section title="Account history" kicker="Audit log">
              <AuditTable rows={data.history} />
            </Section>
          )}
        </div>
      )}
      {confirm && (
        <ConfirmDialog
          title={confirm === 'suspend' ? 'Suspend this account?' : 'Reactivate this account?'}
          consequence={confirm === 'suspend' ? 'The account is signed out everywhere at once and cannot sign in, reset its password or use any API until reactivated. Its records are kept.' : 'The account can sign in again with its existing password.'}
          confirmLabel={confirm === 'suspend' ? 'Suspend account' : 'Reactivate account'}
          requireReason
          danger={confirm === 'suspend'}
          onConfirm={(reason) => changeStatus(confirm, reason)}
          onClose={() => setConfirm(null)}
        />
      )}
    </AdminShell>
  );
}
