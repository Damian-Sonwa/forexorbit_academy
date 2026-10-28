import { FormEvent, ReactNode, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import Header from '@/components/Header';
import Sidebar from '@/components/Sidebar';
import LoadingSpinner from '@/components/LoadingSpinner';
import { useAuth } from '@/hooks/useAuth';
import { apiClient } from '@/lib/api-client';
import { messageFromUnknown } from '@/lib/public-error';
import { formatNairaFromKobo } from '@/lib/course-price';
import type { LedgerRecord, LedgerWarning } from '@/lib/admin-purchase-ledger';

type Tab = 'ledger' | 'exceptions' | 'audit';
type Paged<T> = { items: T[]; page: number; pageSize: number; total: number; totalPages: number };
type Actor = { userId: string | null; email: string | null } | null;
type AuditEntry = {
  id: string;
  entityType: string;
  entityId: string;
  reference: string | null;
  action: string;
  reason: string;
  before: unknown;
  after: unknown;
  actor: Actor;
  createdAt: string | null;
};
type ExceptionRow = {
  id: string;
  reference: string | null;
  reason: string | null;
  reasonLabel: string;
  source: string | null;
  providerStatus: string | null;
  amountKobo: number | null;
  currency: string | null;
  userId: string | null;
  courseId: string | null;
  occurrences: number | null;
  createdAt: string | null;
  lastSeenAt: string | null;
  status: string;
  outcome: string;
  notes: string;
  reviewedAt: string | null;
  reviewedBy: Actor;
  history: { at: string | null; actor: Actor; reason: string; action?: string; before: unknown; after: unknown }[];
  auditPending?: boolean;
};
type Linked = Record<string, Record<string, unknown> | null>;
type Detail = {
  record: LedgerRecord;
  linked: Linked & { exceptions: ExceptionRow[] };
  notes: { storedMetadata: string; verifiedAt: string | null };
  audit: AuditEntry[];
  redirectTo?: string;
};
type ProviderResult = {
  outcome: 'found' | 'not_found' | 'unavailable' | 'no_reference';
  reason?: string;
  provider?: {
    domain: string | null;
    status: string | null;
    reference: string | null;
    amountKobo: number | null;
    currency: string | null;
    paidAt: string | null;
    channel: string | null;
    metadata: Record<string, string>;
    payerEmail: string | null;
  };
  warnings: LedgerWarning[];
};

const SOURCE_OPTIONS: [string, string][] = [
  ['', 'All sources'],
  ['verified_paystack', 'Verified Paystack purchase'],
  ['historical_backfill', 'Historical / backfill'],
  ['complimentary_grant', 'Complimentary grant'],
  ['manual_grant', 'Manual grant'],
  ['unverified_record', 'Requires review: no verified payment'],
  ['payment_without_access', 'Payment without access'],
  ['unlinked_payment', 'Payment not linked to access'],
  ['no_entitlement', 'No active entitlement'],
];

const OUTCOMES: [string, string][] = [
  ['none', 'No outcome yet'],
  ['owner_confirmed', 'Owner confirmed'],
  ['payer_differs_owner_confirmed', 'Payer differs, owner confirmed'],
  ['wrong_student_or_course', 'Wrong student or course on record'],
  ['duplicate_or_test_payment', 'Duplicate or test payment'],
  ['handled_outside_platform', 'Handled outside the platform'],
  ['other', 'Other'],
];

const EXCEPTION_STATUS_OPTIONS = ['open', 'investigating', 'resolved', 'dismissed'];

function formatAmount(kobo: number | null, currency: string | null): string {
  if (kobo === null || kobo === undefined) return 'Not recorded';
  if (currency === 'NGN') return formatNairaFromKobo(kobo);
  return `${(kobo / 100).toFixed(2)} ${currency || '(currency not recorded)'}`;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not recorded' : date.toLocaleString();
}

function payerLabel(payer: LedgerRecord['payer']): string {
  if (payer.status === 'recorded_at_verification' && payer.email) return payer.email;
  if (payer.status === 'copied_from_student') return "Not recorded (backfill copied the student's email)";
  return 'Not recorded';
}

function verificationLabel(record: LedgerRecord): string {
  switch (record.verification.basis) {
    case 'checkout_intent':
      return 'Verified against a server checkout';
    case 'legacy_server_verification':
      return 'Verified by the earlier server check (no checkout record)';
    case 'none_backfill':
      return 'Not verified (backfill record)';
    default:
      return record.source === 'manual_grant' || record.source === 'complimentary_grant' ? 'Not applicable (grant)' : 'Requires review';
  }
}

function refundLabel(value: LedgerRecord['refundDispute']): string {
  if (value === 'dispute_recorded') return 'Dispute event recorded';
  if (value === 'refund_recorded') return 'Refund event recorded';
  return 'None recorded';
}

function outcomeLabel(value: string): string {
  return OUTCOMES.find(([key]) => key === value)?.[1] || value;
}

const severityStyle: Record<LedgerWarning['severity'], string> = {
  critical: 'border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100',
  warning: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100',
  info: 'border-neutral-300 bg-neutral-50 text-neutral-800 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200',
};

function Warnings({ items }: { items: LedgerWarning[] }) {
  if (!items.length) return <p className="text-sm text-neutral-600 dark:text-neutral-400">No warnings.</p>;
  return (
    <ul className="space-y-2">
      {items.map((w) => (
        <li key={w.code} className={`rounded-lg border px-3 py-2 text-sm ${severityStyle[w.severity]}`}>
          <span className="font-semibold capitalize">{w.severity}: </span>
          {w.message}
        </li>
      ))}
    </ul>
  );
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-neutral-900 dark:text-neutral-100">{value}</dd>
    </div>
  );
}

function Pager({ page, totalPages, total, onPage, lowerBound = false }: { page: number; totalPages: number; total: number; onPage: (p: number) => void; lowerBound?: boolean }) {
  return (
    <div className="mt-4 flex items-center justify-between text-sm">
      <span className="text-neutral-600 dark:text-neutral-400">
        {lowerBound ? <strong className="text-amber-800 dark:text-amber-300">At least {total} records (incomplete)</strong> : <>{total} record{total === 1 ? '' : 's'}</>} · page {page} of {lowerBound ? `at least ${totalPages}` : totalPages}
      </span>
      <div className="flex gap-2">
        <button type="button" className="rounded-lg border border-neutral-300 px-3 py-1.5 disabled:opacity-40" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </button>
        <button type="button" className="rounded-lg border border-neutral-300 px-3 py-1.5 disabled:opacity-40" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
          Next
        </button>
      </div>
    </div>
  );
}

function LinkedRecord({ title, row }: { title: string; row: Record<string, unknown> | null }) {
  return (
    <section className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-700">
      <h4 className="text-sm font-semibold">{title}</h4>
      {row ? (
        <dl className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {Object.entries(row).map(([key, value]) => (
            <Field key={key} label={key} value={value === null || value === undefined || value === '' ? 'Not recorded' : typeof value === 'object' ? JSON.stringify(value) : String(value)} />
          ))}
        </dl>
      ) : (
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">No linked record.</p>
      )}
    </section>
  );
}

function ReviewForm({
  submitLabel,
  withStatus,
  initialStatus,
  initialOutcome,
  initialNotes,
  onSubmit,
}: {
  submitLabel: string;
  withStatus: boolean;
  initialStatus?: string;
  initialOutcome?: string;
  initialNotes?: string;
  onSubmit: (body: { status?: string; outcome: string; notes: string; reason: string }) => Promise<void>;
}) {
  const [status, setStatus] = useState(initialStatus || 'investigating');
  const [outcome, setOutcome] = useState(initialOutcome || 'none');
  const [notes, setNotes] = useState(initialNotes || '');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await onSubmit({ ...(withStatus ? { status } : {}), outcome, notes, reason });
      setReason('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-3 grid gap-3">
      {withStatus ? (
        <label className="text-sm">
          <span className="font-semibold">Resolution status</span>
          <select className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 dark:bg-neutral-900" value={status} onChange={(e) => setStatus(e.target.value)}>
            {EXCEPTION_STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
      ) : null}
      <label className="text-sm">
        <span className="font-semibold">Investigation outcome</span>
        <select className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 dark:bg-neutral-900" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
          {OUTCOMES.map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        <span className="font-semibold">Notes</span>
        <textarea className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 dark:bg-neutral-900" rows={3} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <label className="text-sm">
        <span className="font-semibold">Reason for this change (required, kept in the audit trail)</span>
        <input className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 dark:bg-neutral-900" required minLength={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <button type="submit" disabled={busy} className="justify-self-start rounded-full bg-primary-400 px-5 py-2 text-sm font-semibold text-neutral-900 disabled:opacity-50">
        {busy ? 'Saving…' : submitLabel}
      </button>
      <p className="text-xs text-neutral-600 dark:text-neutral-400">This records an investigation only. It does not grant, revoke, reassign, charge, or refund anything.</p>
    </form>
  );
}

function AuditList({ items }: { items: AuditEntry[] }) {
  if (!items.length) return <p className="text-sm text-neutral-600 dark:text-neutral-400">No audit entries.</p>;
  return (
    <ul className="space-y-2">
      {items.map((entry) => (
        <li key={entry.id} className="rounded-lg border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-700">
          <div className="flex flex-wrap justify-between gap-2">
            <span className="font-semibold">{entry.action.replace(/_/g, ' ')}</span>
            <span className="text-neutral-600 dark:text-neutral-400">{formatDate(entry.createdAt)}</span>
          </div>
          <p className="mt-1">By {entry.actor?.email || entry.actor?.userId || 'Unknown'}{entry.reference ? ` · ${entry.reference}` : ''}</p>
          {entry.reason ? <p className="mt-1">Reason: {entry.reason}</p> : null}
          {entry.before ? <p className="mt-1 break-words text-xs">Before: {JSON.stringify(entry.before)}</p> : null}
          {entry.after ? <p className="mt-1 break-words text-xs">After: {JSON.stringify(entry.after)}</p> : null}
        </li>
      ))}
    </ul>
  );
}

function DetailPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const [detailId, setDetailId] = useState(id);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [provider, setProvider] = useState<ProviderResult | null>(null);
  const [checking, setChecking] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const data = await apiClient.get<Detail>(`/admin/purchases/${encodeURIComponent(detailId)}`);
      if (data.redirectTo) {
        setDetailId(data.redirectTo);
        return;
      }
      setDetail(data);
    } catch (reason) {
      setError(messageFromUnknown(reason) || 'This purchase could not be loaded.');
    }
  }, [detailId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function checkProvider() {
    setChecking(true);
    setError('');
    try {
      setProvider(await apiClient.post<ProviderResult>(`/admin/purchases/${encodeURIComponent(detailId)}/verify`));
      await load();
    } catch (reason) {
      setError(messageFromUnknown(reason) || 'Paystack could not be checked.');
    } finally {
      setChecking(false);
    }
  }

  async function addNote(body: { outcome: string; notes: string; reason: string }) {
    setError('');
    setNotice('');
    try {
      await apiClient.post(`/admin/purchases/${encodeURIComponent(detailId)}`, body);
      setNotice('Investigation note recorded.');
      await load();
    } catch (reason) {
      setError(messageFromUnknown(reason) || 'The note could not be saved.');
    }
  }

  const record = detail?.record;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" role="dialog" aria-modal="true" aria-labelledby="purchase-detail-title">
      <div className="h-full w-full max-w-3xl overflow-y-auto bg-white p-6 shadow-xl dark:bg-neutral-950">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="page-kicker">Purchase detail</p>
            <h2 id="purchase-detail-title" className="mt-1 text-xl font-bold">{record ? record.sourceLabel : 'Loading…'}</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm">Close</button>
        </div>
        {error ? <p className="mt-4 text-sm text-red-700" role="alert">{error}</p> : null}
        {notice ? <p className="mt-4 text-sm font-semibold" role="status">{notice}</p> : null}
        {!record ? (
          <div className="mt-6 h-24 animate-pulse rounded-2xl bg-neutral-200" aria-hidden />
        ) : (
          <div className="mt-6 space-y-6">
            <section>
              <h3 className="text-base font-semibold">Warnings</h3>
              <div className="mt-2"><Warnings items={record.warnings} /></div>
            </section>

            <section>
              <h3 className="text-base font-semibold">Summary</h3>
              <dl className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Student receiving access" value={`${record.student.name || 'Unknown'} · ${record.student.email || 'Unknown'}`} />
                <Field label="Student user ID" value={record.student.userId || 'Unknown'} />
                <Field label="Payer email (from Paystack)" value={payerLabel(record.payer)} />
                <Field label="Course" value={`${record.course.title || 'Unknown'} · ${record.course.courseId || 'Unknown'}`} />
                <Field label="Amount" value={formatAmount(record.amountKobo, record.currency)} />
                <Field label="Access" value={record.accessStatus} />
                <Field label="Payment status" value={record.paymentStatus || 'Not recorded'} />
                <Field label="Purchase status" value={record.purchaseStatus || 'Not recorded'} />
                <Field label="Paystack reference" value={record.paystackReference || 'Not recorded'} />
                <Field label="Checkout reference" value={record.checkoutReference || 'Not recorded'} />
                <Field label="Verification" value={verificationLabel(record)} />
                <Field label="Verified at" value={formatDate(record.verification.at)} />
                <Field label="Refund / dispute" value={refundLabel(record.refundDispute)} />
                <Field label="Created" value={formatDate(record.createdAt)} />
              </dl>
              {detail?.notes.verifiedAt ? <p className="mt-2 text-xs text-neutral-600 dark:text-neutral-400">{detail.notes.verifiedAt}</p> : null}
            </section>

            <section>
              <h3 className="text-base font-semibold">Paystack comparison</h3>
              <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
                Looks up this reference with Paystack (read-only) and compares it with the local records. Provider metadata is evidence to compare, not proof of who should own the purchase. Nothing is saved except an audit entry.
              </p>
              <button type="button" onClick={checkProvider} disabled={checking || !record.paystackReference} className="mt-3 rounded-full border border-neutral-400 px-4 py-2 text-sm font-semibold disabled:opacity-40">
                {checking ? 'Checking…' : 'Check with Paystack'}
              </button>
              {provider ? (
                <div className="mt-3 space-y-3">
                  {provider.outcome === 'unavailable' ? <p className="text-sm">Paystack could not be reached ({provider.reason}). Try again later.</p> : null}
                  {provider.outcome === 'no_reference' ? <p className="text-sm">This record has no payment reference to check.</p> : null}
                  {provider.provider ? (
                    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <Field label="Provider status" value={provider.provider.status || 'Unknown'} />
                      <Field label="Provider amount" value={formatAmount(provider.provider.amountKobo, provider.provider.currency)} />
                      <Field label="Provider paid at" value={formatDate(provider.provider.paidAt)} />
                      <Field label="Mode" value={provider.provider.domain || 'Unknown'} />
                      <Field label="Payer email (Paystack)" value={provider.provider.payerEmail || 'Not provided'} />
                      <Field label="Metadata course ID" value={provider.provider.metadata.courseId || 'Not provided'} />
                      <Field label="Metadata user ID" value={provider.provider.metadata.userId || 'Not provided'} />
                      <Field label="Channel" value={provider.provider.channel || 'Unknown'} />
                    </dl>
                  ) : null}
                  <Warnings items={provider.warnings} />
                </div>
              ) : null}
            </section>

            <section className="space-y-3">
              <h3 className="text-base font-semibold">Linked records</h3>
              <LinkedRecord title="Course access" row={detail.linked.access} />
              <LinkedRecord title="Purchase" row={detail.linked.purchase} />
              <LinkedRecord title="Payment" row={detail.linked.payment} />
              {detail.linked.payment?.storedMetadata ? <p className="text-xs text-neutral-600 dark:text-neutral-400">{detail.notes.storedMetadata}</p> : null}
              <LinkedRecord title="Checkout" row={detail.linked.checkout} />
              <section className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-700">
                <h4 className="text-sm font-semibold">Payment exceptions</h4>
                {detail.linked.exceptions.length ? (
                  <ul className="mt-2 space-y-1 text-sm">
                    {detail.linked.exceptions.map((e) => (
                      <li key={e.id}>{e.reasonLabel} · {e.status} · seen {e.occurrences ?? 1} time(s), last {formatDate(e.lastSeenAt)}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">None recorded.</p>
                )}
              </section>
            </section>

            <section>
              <h3 className="text-base font-semibold">Record an investigation note</h3>
              <ReviewForm submitLabel="Save note" withStatus={false} onSubmit={addNote} />
            </section>

            <section>
              <h3 className="text-base font-semibold">Audit trail</h3>
              <div className="mt-2"><AuditList items={detail.audit} /></div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

function LedgerTab() {
  const [filters, setFilters] = useState({ q: '', source: '', access: '', review: '' });
  const [applied, setApplied] = useState(filters);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<(Paged<LedgerRecord> & { truncated: boolean; totalIsLowerBound?: boolean; scanCap?: number }) | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: '20' });
      for (const [key, value] of Object.entries(applied)) if (value) params.set(key, value);
      setData(await apiClient.get(`/admin/purchases?${params.toString()}`));
    } catch (reason) {
      setError(messageFromUnknown(reason) || 'The purchase ledger could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [applied, page]);

  useEffect(() => {
    load();
  }, [load]);

  function submit(event: FormEvent) {
    event.preventDefault();
    setPage(1);
    setApplied(filters);
  }

  return (
    <section>
      <form onSubmit={submit} className="grid gap-3 rounded-2xl border border-neutral-200 p-4 sm:grid-cols-2 lg:grid-cols-5 dark:border-neutral-700">
        <label className="text-sm lg:col-span-2">
          <span className="font-semibold">Search</span>
          <input className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 dark:bg-neutral-900" placeholder="Student, email, course, reference, or ID" maxLength={100} value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
        </label>
        <label className="text-sm">
          <span className="font-semibold">Source</span>
          <select className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 dark:bg-neutral-900" value={filters.source} onChange={(e) => setFilters({ ...filters, source: e.target.value })}>
            {SOURCE_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="font-semibold">Access</span>
          <select className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 dark:bg-neutral-900" value={filters.access} onChange={(e) => setFilters({ ...filters, access: e.target.value })}>
            <option value="">Any</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive or none</option>
          </select>
        </label>
        <div className="flex items-end gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={filters.review === 'needs_review'} onChange={(e) => setFilters({ ...filters, review: e.target.checked ? 'needs_review' : '' })} />
            Needs review
          </label>
          <button type="submit" className="rounded-full bg-primary-400 px-4 py-2 text-sm font-semibold text-neutral-900">Apply</button>
        </div>
      </form>

      {error ? <p className="mt-4 text-sm text-red-700" role="alert">{error}</p> : null}
      {data?.truncated ? (
        <div className="mt-4 rounded-xl border-2 border-amber-500 bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200" role="alert">
          <p className="font-semibold">Results are incomplete.</p>
          <p className="mt-1">
            Only the most recent {data.scanCap} access and {data.scanCap} payment records were searched, so the total shown is a minimum, not a complete count. Narrow the filters (reference, student, course) to see older records.
          </p>
        </div>
      ) : null}

      <div className="mt-4 overflow-x-auto rounded-2xl border border-neutral-200 dark:border-neutral-700">
        <table className="min-w-full divide-y divide-neutral-200 text-sm dark:divide-neutral-700">
          <thead className="bg-neutral-50 text-left dark:bg-neutral-900">
            <tr>
              <th scope="col" className="px-3 py-2">Created</th>
              <th scope="col" className="px-3 py-2">Student</th>
              <th scope="col" className="px-3 py-2">Course</th>
              <th scope="col" className="px-3 py-2">Amount</th>
              <th scope="col" className="px-3 py-2">Source</th>
              <th scope="col" className="px-3 py-2">Access</th>
              <th scope="col" className="px-3 py-2">Reference</th>
              <th scope="col" className="px-3 py-2">Payer</th>
              <th scope="col" className="px-3 py-2"><span className="sr-only">Open</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
            {loading && !data ? (
              <tr><td colSpan={9} className="px-3 py-6 text-center text-neutral-500">Loading…</td></tr>
            ) : data && data.items.length === 0 ? (
              <tr><td colSpan={9} className="px-3 py-6 text-center text-neutral-500">No records match these filters.</td></tr>
            ) : (
              data?.items.map((r) => (
                <tr key={r.id} className={r.needsReview ? 'bg-amber-50/60 dark:bg-amber-950/20' : ''}>
                  <td className="whitespace-nowrap px-3 py-2">{formatDate(r.createdAt)}</td>
                  <td className="px-3 py-2">
                    <div className="font-semibold">{r.student.name || 'Unknown'}</div>
                    <div className="text-xs text-neutral-600 dark:text-neutral-400">{r.student.email || 'Unknown'}</div>
                  </td>
                  <td className="px-3 py-2">{r.course.title || 'Unknown'}</td>
                  <td className="whitespace-nowrap px-3 py-2">{formatAmount(r.amountKobo, r.currency)}</td>
                  <td className="px-3 py-2">
                    {r.sourceLabel}
                    {r.needsReview ? <span className="ml-1 rounded bg-amber-200 px-1.5 py-0.5 text-xs font-semibold text-amber-900">Review</span> : null}
                  </td>
                  <td className="px-3 py-2">{r.accessStatus}</td>
                  <td className="break-all px-3 py-2 font-mono text-xs">{r.paystackReference || 'Not recorded'}</td>
                  <td className="px-3 py-2 text-xs">{payerLabel(r.payer)}</td>
                  <td className="px-3 py-2">
                    <button type="button" onClick={() => setOpenId(r.id)} className="rounded-lg border border-neutral-300 px-3 py-1 text-xs font-semibold">Details</button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {data ? <Pager page={data.page} totalPages={data.totalPages} total={data.total} onPage={setPage} lowerBound={Boolean(data.totalIsLowerBound ?? data.truncated)} /> : null}
      {openId ? <DetailPanel id={openId} onClose={() => { setOpenId(null); load(); }} /> : null}
    </section>
  );
}

function ExceptionsTab() {
  const [status, setStatus] = useState('open');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<(Paged<ExceptionRow> & { status: string }) | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      setData(await apiClient.get(`/admin/payment-exceptions?status=${encodeURIComponent(status)}&page=${page}&pageSize=20`));
    } catch (reason) {
      setError(messageFromUnknown(reason) || 'Payment exceptions could not be loaded.');
    }
  }, [status, page]);

  useEffect(() => {
    load();
  }, [load]);

  async function save(id: string, body: { status?: string; outcome: string; notes: string; reason: string }) {
    setError('');
    setNotice('');
    try {
      await apiClient.put(`/admin/payment-exceptions/${encodeURIComponent(id)}`, body);
      setNotice('Investigation recorded.');
      setEditing(null);
      await load();
    } catch (reason) {
      const saved = (reason as { response?: { data?: { reviewSaved?: boolean } } })?.response?.data?.reviewSaved === true;
      if (saved) {
        setEditing(null);
        setError('The investigation was saved, but its audit entry could not be written yet. It will be written automatically when the ledger next loads; check the Audit tab before relying on it.');
      } else {
        setError(messageFromUnknown(reason) || 'The investigation could not be saved.');
      }
      await load();
    }
  }

  return (
    <section>
      <div className="flex flex-wrap items-center gap-2">
        {['open', 'investigating', 'resolved', 'dismissed', 'all'].map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => { setStatus(s); setPage(1); }}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold ${status === s ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900' : 'border border-neutral-300'}`}
            aria-pressed={status === s}
          >
            {s}
          </button>
        ))}
      </div>
      {error ? <p className="mt-4 text-sm text-red-700" role="alert">{error}</p> : null}
      {notice ? <p className="mt-4 text-sm font-semibold" role="status">{notice}</p> : null}
      <ul className="mt-4 space-y-3">
        {data && data.items.length === 0 ? <li className="text-sm text-neutral-600 dark:text-neutral-400">No exceptions with this status.</li> : null}
        {data?.items.map((e) => (
          <li key={e.id} className="rounded-2xl border border-neutral-200 p-4 dark:border-neutral-700">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-semibold">{e.reasonLabel}</p>
                <p className="break-all font-mono text-xs">{e.reference || 'No reference'}</p>
              </div>
              <span className="rounded-full border border-neutral-300 px-3 py-1 text-xs font-semibold">{e.status}</span>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Field label="Amount" value={formatAmount(e.amountKobo, e.currency)} />
              <Field label="Provider status" value={e.providerStatus || 'Not recorded'} />
              <Field label="First seen" value={formatDate(e.createdAt)} />
              <Field label="Last seen" value={`${formatDate(e.lastSeenAt)} (${e.occurrences ?? 1}×)`} />
              <Field label="Source" value={e.source || 'Not recorded'} />
              <Field label="User ID" value={e.userId || 'Not recorded'} />
              <Field label="Course ID" value={e.courseId || 'Not recorded'} />
              <Field label="Outcome" value={outcomeLabel(e.outcome)} />
            </dl>
            {e.auditPending ? <p className="mt-2 text-sm font-semibold text-amber-800" role="status">An audit entry for this exception is still being written.</p> : null}
            {e.notes ? <p className="mt-2 text-sm">Notes: {e.notes}</p> : null}
            {e.reviewedBy ? <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">Last reviewed by {e.reviewedBy.email || e.reviewedBy.userId} on {formatDate(e.reviewedAt)}</p> : null}
            {e.history.length ? (
              <details className="mt-2 text-sm">
                <summary className="cursor-pointer font-semibold">History ({e.history.length})</summary>
                <ul className="mt-2 space-y-1">
                  {e.history.map((h, i) => (
                    <li key={i} className="text-xs">
                      {formatDate(h.at)} · {h.actor?.userId === 'system' ? 'System (recurred)' : h.actor?.email || h.actor?.userId || 'Unknown'} · {h.reason} · {JSON.stringify(h.before)} → {JSON.stringify(h.after)}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            {editing === e.id ? (
              <ReviewForm
                submitLabel="Save investigation"
                withStatus
                initialStatus={e.status}
                initialOutcome={e.outcome}
                initialNotes={e.notes}
                onSubmit={(body) => save(e.id, body)}
              />
            ) : (
              <button type="button" onClick={() => setEditing(e.id)} className="mt-3 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-semibold">Record investigation</button>
            )}
          </li>
        ))}
      </ul>
      {data ? <Pager page={data.page} totalPages={data.totalPages} total={data.total} onPage={setPage} /> : null}
    </section>
  );
}

function AuditTab() {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paged<AuditEntry> | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    apiClient
      .get<Paged<AuditEntry>>(`/admin/audit-log?page=${page}&pageSize=20`)
      .then(setData)
      .catch((reason) => setError(messageFromUnknown(reason) || 'The audit trail could not be loaded.'));
  }, [page]);

  return (
    <section>
      {error ? <p className="text-sm text-red-700" role="alert">{error}</p> : null}
      {data ? <AuditList items={data.items} /> : null}
      {data ? <Pager page={data.page} totalPages={data.totalPages} total={data.total} onPage={setPage} /> : null}
    </section>
  );
}

export default function AdminPurchases() {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('ledger');

  useEffect(() => {
    if (!authLoading && !isAuthenticated) router.push('/login');
  }, [authLoading, isAuthenticated, router]);

  if (authLoading || !isAuthenticated) return <LoadingSpinner message="Loading purchase ledger..." fullScreen />;
  if (!user || user.role !== 'superadmin') return <div className="flex min-h-screen items-center justify-center">Access denied</div>;

  const tabs: [Tab, string][] = [
    ['ledger', 'Purchase ledger'],
    ['exceptions', 'Payment exceptions'],
    ['audit', 'Audit trail'],
  ];

  return (
    <div className="flex min-h-screen flex-col bg-gray-50 dark:bg-gray-900">
      <Header />
      <div className="flex flex-1 lg:items-start">
        <Sidebar />
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 pt-16 lg:pt-8">
          <p className="page-kicker">Super admin</p>
          <h1 className="page-title mt-2">Course purchases</h1>
          <p className="mt-2 max-w-3xl text-sm text-neutral-600 dark:text-neutral-400">
            Trace each course purchase from checkout to payment to access. This page is for investigation only: it never grants, revokes, reassigns, charges, or refunds. A payer email that differs from the student&apos;s is a warning, not proof of a problem.
          </p>
          <Link href="/admin" className="mt-3 inline-flex text-sm font-semibold underline">Back to admin panel</Link>
          <div className="mt-6 flex flex-wrap gap-1 rounded-xl bg-neutral-100 p-1 dark:bg-neutral-800" role="tablist">
            {tabs.map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold ${tab === key ? 'bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-white' : 'text-neutral-600 dark:text-neutral-300'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="mt-6">
            {tab === 'ledger' ? <LedgerTab /> : null}
            {tab === 'exceptions' ? <ExceptionsTab /> : null}
            {tab === 'audit' ? <AuditTab /> : null}
          </div>
        </main>
      </div>
    </div>
  );
}
