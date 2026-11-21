/**
 * Admin portal: overview (Phase 13). GET /api/admin/portal/overview. What needs attention first,
 * then platform figures; payment figures and recent audit actions for the Super Admin only.
 */

import Link from 'next/link';
import { useState } from 'react';
import AdminShell from '@/components/admin/portal/AdminShell';
import { AlertList, AuditTable, FinanceMetrics, OverviewMetrics, StatusChip, ACCOUNT_STATUS } from '@/components/admin/portal/Views';
import { ErrorState, Section } from '@/components/student/dashboard/Panels';
import { relativeTime } from '@/components/student/dashboard/format';
import { MetricSkeleton } from '@/components/loading';
import { usePortalResource } from '@/hooks/usePortalResource';
import type { AdminOverview } from '@/lib/admin-portal';

const WINDOWS = [7, 30, 90, 365];

export default function AdminOverviewPage() {
  const [days, setDays] = useState(30);
  const { data, error, loading, reload } = usePortalResource<AdminOverview>(`/admin/portal/overview?days=${days}`);
  const peak = data ? Math.max(1, ...data.trend.map((t) => t.registrations)) : 1;
  return (
    <AdminShell
      title="Overview"
      lede="What needs attention, and how the platform is doing."
      actions={
        <div className="flex gap-1 rounded-xl border border-line bg-surface-2 p-1" role="group" aria-label="Period">
          {WINDOWS.map((d) => (
            <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)} className={`min-h-[36px] rounded-lg px-3 text-xs font-medium ${days === d ? 'bg-surface-1 text-ink shadow-panel' : 'text-ink-muted hover:text-ink'}`}>{d === 365 ? '1 year' : `${d} days`}</button>
          ))}
        </div>
      }
    >
      {loading && !data && <MetricSkeleton count={6} />}
      {error && !data && <ErrorState text={error} onRetry={() => void reload()} />}
      {data && (
        <div className="space-y-10" aria-busy={loading}>
          <Section title="Needs attention">
            <AlertList alerts={data.alerts} />
          </Section>
          <Section title="Platform">
            <OverviewMetrics m={data.metrics} />
          </Section>
          {data.finance && (
            <Section title="Payments" kicker="Super Admin" action={<Link href="/admin/payments" className="btn btn-ghost btn-sm">All payments</Link>}>
              <FinanceMetrics f={data.finance} days={data.metrics.windowDays} />
            </Section>
          )}
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
            <Section title="New sign-ups" kicker={`Last ${data.metrics.windowDays} days`}>
              <div className="card !p-4">
                <div className="flex h-24 items-end gap-px" role="img" aria-label={`Sign-ups per day: ${data.metrics.newRegistrations} in total`}>
                  {data.trend.slice(-60).map((t) => (
                    <div key={t.day} className="flex-1 rounded-t-sm bg-primary-500/70" style={{ height: `${Math.max(2, (t.registrations / peak) * 100)}%` }} title={`${t.day}: ${t.registrations}`} />
                  ))}
                </div>
                <ul className="mt-4 divide-y divide-[var(--fo-line)]">
                  {data.recentRegistrations.map((u) => (
                    <li key={u.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <Link href={`/admin/users/${u.id}`} className="min-w-0 truncate font-medium text-ink hover:underline">{u.name}</Link>
                      <span className="flex shrink-0 items-center gap-2 text-xs text-ink-subtle"><span className="capitalize">{u.role}</span><StatusChip map={ACCOUNT_STATUS} value={u.status} />{relativeTime(u.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </Section>
            {data.recentActions ? (
              <Section title="Recent administrative actions" kicker="Audit log" action={<Link href="/admin/audit" className="btn btn-ghost btn-sm">Audit log</Link>}>
                <AuditTable rows={data.recentActions} />
              </Section>
            ) : (
              <Section title="Shortcuts">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {[['/admin/courses?status=in_review', 'Courses in review'], ['/admin/users?role=instructor', 'Instructors'], ['/admin/enrollments', 'Enrollments'], ['/admin/reports', 'Reports']].map(([href, label]) => (
                    <Link key={href} href={href} className="card card-interactive !p-4 text-sm font-semibold text-ink">{label} →</Link>
                  ))}
                </div>
              </Section>
            )}
          </div>
        </div>
      )}
    </AdminShell>
  );
}
