/**
 * Admin portal views (Phase 13). Presentational: props in, markup out. Figures are the server's
 * (lib/admin-portal.js). Money arrives as exact decimal strings and is shown as-is.
 */

import Link from 'next/link';
import type { ReactNode } from 'react';
import { previewText } from '@/lib/plain-text';
import { EmptyState, Metric, MetricGrid } from '@/components/student/dashboard/Panels';
import { formatDate, relativeTime } from '@/components/student/dashboard/format';
import type { AdminOverview, Alert, AuditView, CheckoutState } from '@/lib/admin-portal';

export const txt = (v: string | null | undefined) => previewText(v);
/** '12500.00' -> '₦12,500.00'. String formatting only: money never becomes a float. */
export function money(amount: string, currency = 'NGN') {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(amount));
  if (!m) return String(amount);
  const whole = m[2].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${m[1]}${currency === 'NGN' ? '₦' : `${currency} `}${whole}.${(m[3] || '00').padEnd(2, '0').slice(0, 2)}`;
}

export const ACCOUNT_STATUS: Record<string, { label: string; tone: string }> = {
  active: { label: 'Active', tone: 'chip-up' },
  pending: { label: 'Pending approval', tone: 'chip-brand' },
  suspended: { label: 'Suspended', tone: 'chip-down' },
  rejected: { label: 'Rejected', tone: '' },
};
export const COURSE_STATUS: Record<string, { label: string; tone: string }> = {
  draft: { label: 'Draft', tone: '' },
  in_review: { label: 'In review', tone: 'chip-brand' },
  published: { label: 'Published', tone: 'chip-up' },
  archived: { label: 'Archived', tone: '' },
};
/** Each checkout state with its meaning: uncertain states are never shown as success or failure. */
export const CHECKOUT_STATE: Record<CheckoutState | string, { label: string; tone: string; help: string }> = {
  paid: { label: 'Paid', tone: 'chip-up', help: 'Verified by the server or the signed webhook and applied.' },
  held: { label: 'Held for review', tone: 'chip-brand', help: 'A verified charge kept for review (duplicate or superseded checkout); not applied.' },
  confirming: { label: 'Confirming', tone: 'chip-brand', help: 'A confirmation is in progress.' },
  stalled: { label: 'Stalled', tone: 'chip-down', help: 'A confirmation stopped; reconciliation finishes it.' },
  pending: { label: 'Pending', tone: '', help: 'Checkout created; no payment reported yet.' },
  abandoned: { label: 'No payment reported', tone: '', help: 'Pending for over 24 hours or expired. Not a provider failure; a late payment is still found by reconciliation.' },
  closed: { label: 'Replaced', tone: '', help: 'Replaced by a newer checkout.' },
  unknown: { label: 'Unknown', tone: 'chip-down', help: 'Not a recognised state.' },
};
export const REFUND_STATE: Record<string, string> = { refunded: 'Refunded', partially_refunded: 'Partly refunded', refund_pending: 'Refund pending' };

export function StatusChip({ map, value }: { map: Record<string, { label: string; tone: string; help?: string }>; value: string }) {
  const s = map[value] || { label: value, tone: '' };
  return <span className={`chip ${s.tone}`} title={s.help}>{s.label}</span>;
}

export function Pager({ page, pages, total, onPage }: { page: number; pages: number; total?: number; onPage: (p: number) => void }) {
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm text-ink-muted">
      <span className="num">{typeof total === 'number' ? `${total.toLocaleString()} result${total === 1 ? '' : 's'}` : ''}</span>
      {pages > 1 && (
        <span className="flex items-center gap-2">
          <button type="button" className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
          <span className="num">Page {page} of {pages}</span>
          <button type="button" className="btn btn-secondary btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
        </span>
      )}
    </div>
  );
}

/** A responsive data table: scrolls horizontally inside its own box on narrow screens. */
export function DataTable({ head, children, testId, empty }: { head: ReactNode; children: ReactNode; testId?: string; empty?: ReactNode }) {
  if (empty) return <>{empty}</>;
  return (
    <div className="overflow-x-auto rounded-panel border border-line bg-surface-1">
      <table className="table-orbit w-full text-sm" data-testid={testId}>
        <thead>{head}</thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function AlertList({ alerts }: { alerts: Alert[] }) {
  if (!alerts.length) return <p className="notice text-sm" data-testid="alerts-clear">Nothing needs attention right now.</p>;
  return (
    <ul className="space-y-2" data-testid="alerts">
      {alerts.map((a) => (
        <li key={a.id} className={`notice ${a.severity === 'action' ? 'notice-brand' : 'notice-caution'} flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between`}>
          <span className="text-sm font-medium text-ink">{a.title}</span>
          <Link href={a.href} className="btn btn-secondary btn-sm w-full shrink-0 sm:w-auto">Review</Link>
        </li>
      ))}
    </ul>
  );
}

export function OverviewMetrics({ m }: { m: AdminOverview['metrics'] }) {
  return (
    <MetricGrid cols="sm:grid-cols-3 lg:grid-cols-6">
      <Metric label="Students" value={m.students.toLocaleString()} hint={`${m.activeLearners.toLocaleString()} learned in ${m.windowDays} days`} testId="am-students" />
      <Metric label="New sign-ups" value={m.newRegistrations.toLocaleString()} hint={`last ${m.windowDays} days`} testId="am-registrations" />
      <Metric label="Instructors" value={m.instructors.toLocaleString()} hint={`${m.activeInstructors} active`} testId="am-instructors" />
      <Metric label="Published courses" value={m.coursesByStatus.published} hint={`${m.coursesByStatus.draft} draft · ${m.coursesByStatus.in_review} in review`} testId="am-courses" />
      <Metric label="Enrollments" value={m.enrollments.toLocaleString()} hint={`${m.newEnrollments} new · ${m.completions} completed`} testId="am-enrollments" />
      <Metric label="Suspended" value={m.suspended} tone={m.suspended ? 'text-caution' : 'text-ink'} hint="accounts" testId="am-suspended" />
    </MetricGrid>
  );
}

export function FinanceMetrics({ f, days }: { f: NonNullable<AdminOverview['finance']>; days: number }) {
  return (
    <div className="space-y-3" data-testid="finance-metrics">
      <MetricGrid cols="sm:grid-cols-3 lg:grid-cols-6">
        <Metric label="Gross payments" value={money(f.gross, f.currency)} hint={`${f.paidCount} paid · ${days} days`} testId="fm-gross" />
        <Metric label="Refunds" value={money(f.refunds, f.currency)} hint={`${f.refundCount} processed`} testId="fm-refunds" />
        <Metric label="Net" value={money(f.net, f.currency)} hint="gross minus refunds" testId="fm-net" />
        <Metric label="Pending" value={f.states.pending} hint="checkouts awaiting payment" testId="fm-pending" />
        <Metric label="Needs attention" value={f.states.stalled + f.held + f.openExceptions} tone={f.states.stalled + f.held + f.openExceptions ? 'text-caution' : 'text-ink'} hint={`${f.states.stalled} stalled · ${f.held} held · ${f.openExceptions} exceptions`} testId="fm-attention" />
        <Metric label="No payment reported" value={f.states.abandoned} hint="checkouts over 24 h old" testId="fm-abandoned" />
      </MetricGrid>
      <p className="text-xs text-ink-subtle">Pending checkouts are never counted as revenue. Gross is verified payments by payment date; refunds are those Paystack processed in the period.</p>
    </div>
  );
}

const AUDIT_LABEL: Record<string, string> = {
  account_approved: 'Approved an account',
  account_rejected: 'Rejected an account',
  account_suspended: 'Suspended an account',
  account_reactivated: 'Reactivated an account',
  account_role_changed: 'Changed a role',
  course_reassigned: 'Reassigned a course',
  course_published: 'Published a course',
  course_archived: 'Archived a course',
  course_draft: 'Returned a course to draft',
  course_in_review: 'Submitted a course for review',
  assignment_graded: 'Graded a submission',
  assignment_regraded: 'Changed a grade',
  data_exported: 'Exported data',
  reconciliation_run: 'Ran payment reconciliation',
};
export const auditLabel = (action: string) => AUDIT_LABEL[action] || action.replace(/_/g, ' ');

export function AuditTable({ rows }: { rows: AuditView[] }) {
  return (
    <DataTable
      testId="audit-table"
      empty={rows.length ? undefined : <EmptyState title="No audit entries" text="Recorded administrative actions appear here." testId="audit-empty" />}
      head={<tr><th>When</th><th className="hidden sm:table-cell">Actor</th><th>Action</th><th className="hidden md:table-cell">Target</th><th className="hidden lg:table-cell">Reason</th></tr>}
    >
      {rows.map((a) => (
        <tr key={a.id}>
          <td className="whitespace-nowrap text-xs text-ink-subtle" title={formatDate(a.createdAt, true)}>{relativeTime(a.createdAt)}</td>
          <td className="hidden max-w-[12rem] sm:table-cell"><span className="block truncate">{a.actor ? a.actor.email || a.actor.userId || 'system' : 'system'}</span>{a.actor?.role && <span className="text-2xs capitalize text-ink-subtle">{a.actor.role}</span>}</td>
          <td><span className="text-ink">{auditLabel(a.action)}</span><span className="block text-2xs text-ink-subtle">{a.entityType}{a.outcome ? ` · ${a.outcome}` : ''}</span><span className="block truncate text-2xs text-ink-subtle sm:hidden">{a.actor ? a.actor.email || a.actor.userId || 'system' : 'system'}</span></td>
          <td className="hidden max-w-[14rem] truncate text-xs md:table-cell">{a.reference || a.entityId || '-'}</td>
          <td className="hidden max-w-[18rem] text-xs text-ink-muted lg:table-cell">{a.reason || '-'}</td>
        </tr>
      ))}
    </DataTable>
  );
}

/** A small filter bar: label + control pairs that wrap, full width on phones. */
export function FilterBar({ children, onSubmit }: { children: ReactNode; onSubmit?: () => void }) {
  return (
    <form className="mb-5 grid grid-cols-1 gap-3 sm:flex sm:flex-wrap sm:items-end" role="search" onSubmit={(e) => { e.preventDefault(); onSubmit?.(); }}>
      {children}
    </form>
  );
}
export function Field({ label, children, grow = false }: { label: string; children: ReactNode; grow?: boolean }) {
  return (
    <label className={`block ${grow ? 'sm:min-w-[14rem] sm:flex-1' : ''}`}>
      <span className="label">{label}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

/** Download a CSV through the authenticated export API (same filters as the screen). */
export function ExportButton({ href, label = 'Export CSV' }: { href: string; label?: string }) {
  return <a href={`/api/admin/portal/export?${href}`} className="btn btn-secondary btn-sm" data-testid="export-link">{label}</a>;
}
