/**
 * Admin portal: reports (Phase 13). GET /api/admin/portal/reports?from&to. Daily platform figures;
 * payments (gross, refunds, net) and grading activity for the Super Admin only.
 */

import { useRouter } from 'next/router';
import AdminShell from '@/components/admin/portal/AdminShell';
import { DataTable, ExportButton, Field, FilterBar, money, txt } from '@/components/admin/portal/Views';
import { ErrorState, Metric, MetricGrid, Section } from '@/components/student/dashboard/Panels';
import { minutesLabel } from '@/components/student/dashboard/format';
import { TableSkeleton } from '@/components/loading';
import { useAuth } from '@/hooks/useAuth';
import { usePortalResource } from '@/hooks/usePortalResource';
import type { AdminReport } from '@/lib/admin-portal';

const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : '');

export default function AdminReportsPage() {
  const router = useRouter();
  const { user } = useAuth();
  const from = one(router.query.from);
  const to = one(router.query.to);
  const params = new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) });
  const { data, error, loading, reload } = usePortalResource<AdminReport>(router.isReady ? `/admin/portal/reports?${params.toString()}` : null);
  const setQuery = (next: Record<string, string>) => void router.push({ pathname: router.pathname, query: Object.fromEntries(Object.entries({ from, to, ...next }).filter(([, v]) => v)) }, undefined, { shallow: true });
  const superAdmin = user?.role === 'superadmin';
  return (
    <AdminShell title="Reports" lede={data ? `${data.range.from} to ${data.range.to} (${data.range.days} days, ${data.range.timezone} time)` : 'Platform figures by day.'} actions={<div className="flex flex-wrap gap-2"><ExportButton href="type=enrollments" label="Enrollments CSV" />{superAdmin && <ExportButton href={new URLSearchParams({ type: 'payments', ...(from ? { from } : {}), ...(to ? { to } : {}) }).toString()} label="Payments CSV" />}</div>}>
      <FilterBar>
        <Field label="From"><input type="date" className="input w-full sm:!w-40" value={from} onChange={(e) => setQuery({ from: e.target.value })} /></Field>
        <Field label="To"><input type="date" className="input w-full sm:!w-40" value={to} onChange={(e) => setQuery({ to: e.target.value })} /></Field>
      </FilterBar>
      {loading && !data && <TableSkeleton rows={8} />}
      {error && <ErrorState text={error} onRetry={() => void reload()} />}
      {data && (
        <div className="space-y-10" aria-busy={loading}>
          <MetricGrid cols="sm:grid-cols-3 lg:grid-cols-6">
            <Metric label="Sign-ups" value={data.totals.registrations} hint={`${data.totals.studentRegistrations} students`} testId="rp-registrations" />
            <Metric label="Enrollments" value={data.totals.enrollments} testId="rp-enrollments" />
            <Metric label="Completions" value={data.totals.completions} testId="rp-completions" />
            <Metric label="Learning time" value={minutesLabel(data.totals.learningMinutes)} testId="rp-minutes" />
            <Metric label="Active learners" value={data.totals.activeLearners} testId="rp-learners" />
            <Metric label="Days" value={data.range.days} />
          </MetricGrid>

          {data.finance && (
            <Section title="Payments" kicker="Super Admin">
              <MetricGrid cols="sm:grid-cols-3 lg:grid-cols-5">
                <Metric label="Gross" value={money(data.finance.gross, data.finance.currency)} hint={`${data.finance.paidCount} verified payments`} testId="rp-gross" />
                <Metric label="Refunds" value={money(data.finance.refunds, data.finance.currency)} hint={`${data.finance.refundCount} processed`} testId="rp-refunds" />
                <Metric label="Net" value={money(data.finance.net, data.finance.currency)} hint="gross minus refunds" testId="rp-net" />
                <Metric label="Checkouts" value={Object.values(data.finance.statusDistribution).reduce((a, b) => a + b, 0)} hint={Object.entries(data.finance.statusDistribution).map(([k, v]) => `${v} ${k}`).join(' · ')} />
              </MetricGrid>
              <p className="mt-2 text-xs text-ink-subtle">Gross counts verified payments by payment date; pending checkouts are never revenue. Refunds count those Paystack processed in the period.</p>
            </Section>
          )}

          <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
            <Section title="Top courses" kicker="By enrollments in the period">
              <DataTable head={<tr><th>Course</th><th className="text-right">Enrollments</th><th className="text-right">Completions</th></tr>} empty={data.topCourses.length ? undefined : <p className="text-sm text-ink-subtle">No enrollments in this period.</p>}>
                {data.topCourses.map((c) => <tr key={c.courseId}><td className="max-w-[16rem]"><span className="line-clamp-2">{txt(c.title)}</span></td><td className="text-right num">{c.enrollments}</td><td className="text-right num">{c.completions}</td></tr>)}
              </DataTable>
            </Section>
            {data.grading && (
              <Section title="Grading activity" kicker="Instructors, from the audit log">
                <DataTable head={<tr><th>Instructor</th><th className="text-right">Graded</th><th className="text-right">Changed</th></tr>} empty={data.grading.length ? undefined : <p className="text-sm text-ink-subtle">No grading in this period.</p>}>
                  {data.grading.map((g) => <tr key={g.userId}><td>{g.name}</td><td className="text-right num">{g.graded}</td><td className="text-right num">{g.regraded}</td></tr>)}
                </DataTable>
              </Section>
            )}
          </div>

          <Section title="By day">
            <DataTable testId="report-daily" head={<tr><th>Day</th><th className="text-right">Sign-ups</th><th className="text-right">Enrollments</th><th className="hidden text-right sm:table-cell">Completions</th><th className="hidden text-right md:table-cell">Learners</th>{data.finance && <th className="hidden text-right lg:table-cell">Net</th>}</tr>}>
              {[...data.daily].reverse().map((d, i) => (
                <tr key={d.day}>
                  <td className="whitespace-nowrap">{d.day}</td>
                  <td className="text-right num">{d.registrations}</td>
                  <td className="text-right num">{d.enrollments}</td>
                  <td className="hidden text-right num sm:table-cell">{d.completions}</td>
                  <td className="hidden text-right num md:table-cell">{d.activeLearners}</td>
                  {data.finance && <td className="hidden text-right num lg:table-cell">{money(data.finance.daily[data.finance.daily.length - 1 - i].net, data.finance.currency)}</td>}
                </tr>
              ))}
            </DataTable>
          </Section>
        </div>
      )}
    </AdminShell>
  );
}
