import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import Header from '@/components/Header';
import Sidebar from '@/components/Sidebar';
import LoadingSpinner from '@/components/LoadingSpinner';
import { useAuth } from '@/hooks/useAuth';
import { apiClient } from '@/lib/api-client';
import { messageFromUnknown } from '@/lib/public-error';
import type { CourseAccessEntry, StudentAccessOverview } from '@/lib/course-access-admin';

type CourseOption = { id: string; title: string; status?: string };

const ENTITLEMENT_LABELS: Record<string, string> = {
  paid_course: 'Paid',
  complimentary: 'Complimentary grant',
  manual_grant: 'Manual grant',
  refunded: 'Refunded (access removed)',
  grant_revoked: 'Grant revoked',
};

function when(value: string | Date | null | undefined): string {
  return value ? new Date(value).toLocaleDateString() : '';
}

function accessLabel(entry: CourseAccessEntry): string {
  const access = entry.access;
  if (!access) return 'No paid access';
  const label = ENTITLEMENT_LABELS[access.entitlementType || ''] || (access.paid ? 'Paid' : 'No paid access');
  return access.entitled ? label : `${label} (no access)`;
}

function enrollmentLabel(entry: CourseAccessEntry): string {
  const e = entry.enrollment;
  if (!e) return 'Not enrolled';
  if (!e.active) return `Withdrawn ${when(e.withdrawnAt)}`;
  if (e.completedAt) return `Completed ${when(e.completedAt)}`;
  return `Enrolled, ${e.progress}%`;
}

function ReasonDialog({ title, busy, onSubmit, onCancel }: { title: string; busy: boolean; onSubmit: (reason: string) => void; onCancel: () => void }) {
  const [reason, setReason] = useState('');
  return (
    <form
      className="mt-3 space-y-2 rounded-lg border border-neutral-200 p-3 dark:border-neutral-700"
      onSubmit={(event) => { event.preventDefault(); onSubmit(reason); }}
    >
      <label className="block text-sm font-semibold" htmlFor="course-access-reason">{title}</label>
      <textarea
        id="course-access-reason"
        className="input min-h-[4rem] w-full"
        value={reason}
        maxLength={500}
        onChange={(event) => setReason(event.target.value)}
        placeholder="Reason (kept in the audit log)"
        required
      />
      <div className="flex gap-2">
        <button type="submit" className="btn btn-primary" disabled={busy || reason.trim().length < 5}>{busy ? 'Saving…' : 'Confirm'}</button>
        <button type="button" className="btn btn-outline" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </form>
  );
}

function CourseAccessPanel() {
  const [query, setQuery] = useState('');
  const [data, setData] = useState<StudentAccessOverview | null>(null);
  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [grantCourse, setGrantCourse] = useState('');
  const [pending, setPending] = useState<{ action: 'grant' | 'revoke'; courseId: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    apiClient.get<CourseOption[]>('/courses').then(
      (list) => setCourses(list.filter((c) => c.status === 'published' || c.status === 'archived')),
      () => setCourses([])
    );
  }, []);

  const load = useCallback(async (lookup: string) => {
    const value = lookup.trim();
    if (!value) return;
    setBusy(true);
    setMessage(null);
    try {
      const param = /^[a-fA-F0-9]{24}$/.test(value) ? `userId=${value}` : `email=${encodeURIComponent(value)}`;
      setData(await apiClient.get<StudentAccessOverview>(`/admin/course-access?${param}`));
    } catch (error) {
      setData(null);
      setMessage({ tone: 'error', text: messageFromUnknown(error) });
    } finally {
      setBusy(false);
    }
  }, []);

  const change = async (action: 'grant' | 'revoke', courseId: string, reason: string) => {
    if (!data) return;
    setBusy(true);
    setMessage(null);
    try {
      await apiClient.post('/admin/course-access', { action, userId: data.student.id, courseId, reason });
      setMessage({ tone: 'ok', text: action === 'grant' ? 'Access granted and the student is enrolled.' : 'The grant was revoked.' });
      setPending(null);
      setGrantCourse('');
      await load(data.student.id);
    } catch (error) {
      setMessage({ tone: 'error', text: messageFromUnknown(error) });
    } finally {
      setBusy(false);
    }
  };

  const onSearch = (event: FormEvent) => {
    event.preventDefault();
    void load(query);
  };

  return (
    <div className="space-y-6">
      <form onSubmit={onSearch} className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="course-access-student" className="sr-only">Student email or account ID</label>
        <input
          id="course-access-student"
          className="input flex-1"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Student email or account ID"
        />
        <button type="submit" className="btn btn-primary" disabled={busy || !query.trim()}>Look up</button>
      </form>

      {message ? (
        <p role={message.tone === 'error' ? 'alert' : 'status'} className={`rounded-lg px-3 py-2 text-sm ${message.tone === 'error' ? 'bg-red-50 text-red-800 dark:bg-red-950/50 dark:text-red-200' : 'bg-green-50 text-green-800 dark:bg-green-950/40 dark:text-green-200'}`}>
          {message.text}
        </p>
      ) : null}

      {data ? (
        <section className="rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-700 dark:bg-neutral-900">
          <h2 className="text-lg font-bold">{data.student.name || 'Student'}</h2>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">{data.student.email} · account {data.student.status}</p>

          {data.courses.length === 0 ? (
            <p className="mt-4 text-sm text-neutral-600 dark:text-neutral-400">No enrollments or course access yet.</p>
          ) : (
            <ul className="mt-4 divide-y divide-neutral-200 dark:divide-neutral-700">
              {data.courses.map((entry) => {
                const revocable = Boolean(entry.access && entry.access.entitled && !entry.access.paid
                  && (entry.access.entitlementType === 'complimentary' || entry.access.entitlementType === 'manual_grant'));
                return (
                  <li key={entry.courseId} className="py-3">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="font-semibold">{entry.title || 'Unknown course'}{entry.courseStatus === 'archived' ? ' (archived)' : ''}</p>
                        <p className="text-sm text-neutral-600 dark:text-neutral-400">{enrollmentLabel(entry)} · {accessLabel(entry)}</p>
                        {entry.access?.grantReason ? <p className="text-xs text-neutral-500">Grant reason: {entry.access.grantReason}</p> : null}
                        {entry.access?.revokedReason ? <p className="text-xs text-neutral-500">Revoked: {entry.access.revokedReason}</p> : null}
                      </div>
                      <div className="flex gap-2">
                        {revocable ? (
                          <button type="button" className="btn btn-outline text-sm" onClick={() => setPending({ action: 'revoke', courseId: entry.courseId })} disabled={busy}>Revoke grant</button>
                        ) : null}
                        {!entry.access?.entitled ? (
                          <button type="button" className="btn btn-outline text-sm" onClick={() => setPending({ action: 'grant', courseId: entry.courseId })} disabled={busy}>Grant access</button>
                        ) : null}
                      </div>
                    </div>
                    {pending && pending.courseId === entry.courseId ? (
                      <ReasonDialog
                        title={pending.action === 'grant' ? 'Grant complimentary access to this course' : 'Revoke this complimentary grant'}
                        busy={busy}
                        onSubmit={(reason) => void change(pending.action, entry.courseId, reason)}
                        onCancel={() => setPending(null)}
                      />
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}

          <div className="mt-6 border-t border-neutral-200 pt-4 dark:border-neutral-700">
            <label htmlFor="course-access-grant" className="block text-sm font-semibold">Grant complimentary access to another course</label>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <select id="course-access-grant" className="input flex-1" value={grantCourse} onChange={(event) => setGrantCourse(event.target.value)}>
                <option value="">Choose a course</option>
                {courses
                  .filter((course) => !data.courses.some((entry) => entry.courseId === course.id && entry.access?.entitled))
                  .map((course) => (
                    <option key={course.id} value={course.id}>{course.title}{course.status === 'archived' ? ' (archived)' : ''}</option>
                  ))}
              </select>
              <button type="button" className="btn btn-outline" disabled={busy || !grantCourse} onClick={() => setPending({ action: 'grant', courseId: grantCourse })}>Grant access</button>
            </div>
            {pending && pending.action === 'grant' && pending.courseId === grantCourse && !data.courses.some((entry) => entry.courseId === grantCourse) ? (
              <ReasonDialog
                title="Grant complimentary access to this course"
                busy={busy}
                onSubmit={(reason) => void change('grant', grantCourse, reason)}
                onCancel={() => setPending(null)}
              />
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}

export default function AdminCourseAccess() {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!authLoading && !isAuthenticated) router.push('/login');
  }, [authLoading, isAuthenticated, router]);

  if (authLoading || !isAuthenticated) return <LoadingSpinner message="Loading course access..." fullScreen />;
  if (!user || user.role !== 'superadmin') return <div className="flex min-h-screen items-center justify-center">Access denied</div>;

  return (
    <div className="flex min-h-screen flex-col bg-gray-50 dark:bg-gray-900">
      <Header />
      <div className="flex flex-1 lg:items-start">
        <Sidebar />
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 pt-16 lg:pt-8">
          <p className="page-kicker">Super admin</p>
          <h1 className="page-title mt-2">Course access</h1>
          <p className="mt-2 max-w-3xl text-sm text-neutral-600 dark:text-neutral-400">
            See a student&apos;s enrollments and course access. You can grant complimentary access, which also enrolls the student, and revoke a complimentary grant. Paid access ends only through a full refund with access removal on the Course purchases page. Every change needs a reason and is kept in the audit trail.
          </p>
          <Link href="/admin" className="mt-3 inline-flex text-sm font-semibold underline">Back to admin panel</Link>
          <div className="mt-6">
            <CourseAccessPanel />
          </div>
        </main>
      </div>
    </div>
  );
}
