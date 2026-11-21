/**
 * Admin portal: courses (Phase 13). GET /api/admin/portal/courses.
 * Status changes use POST /api/courses/:id/status (existing transitions, audited); reassignment uses
 * the audited handover (components/admin/CourseReassignDialog.tsx). IDs, enrollments, progress,
 * assessments and submissions are never changed by moderation.
 */

import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import AdminShell from '@/components/admin/portal/AdminShell';
import ConfirmDialog from '@/components/admin/portal/ConfirmDialog';
import CourseReassignDialog from '@/components/admin/CourseReassignDialog';
import { COURSE_STATUS, DataTable, ExportButton, Field, FilterBar, Pager, StatusChip, txt } from '@/components/admin/portal/Views';
import { EmptyState, ErrorState } from '@/components/student/dashboard/Panels';
import { TableSkeleton } from '@/components/loading';
import { usePortalResource } from '@/hooks/usePortalResource';
import { apiClient } from '@/lib/api-client';
import type { CourseList, CourseRow, UserList } from '@/lib/admin-portal';

const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : '');
/** The admin's transitions per status (lib/course-lifecycle.js decides; this only offers them). */
const NEXT: Record<string, Array<{ to: string; label: string; consequence: string }>> = {
  in_review: [
    { to: 'published', label: 'Publish', consequence: 'The course becomes visible in the catalogue and open for enrolment and purchase.' },
    { to: 'draft', label: 'Return to draft', consequence: 'The course goes back to its instructor for changes. Students cannot see a draft.' },
  ],
  published: [{ to: 'archived', label: 'Archive', consequence: 'The course leaves the catalogue and takes no new enrolments or purchases. Enrolled students keep access, progress and certificates.' }],
  archived: [{ to: 'published', label: 'Restore', consequence: 'The course returns to the catalogue.' }],
  draft: [],
};

export default function AdminCoursesPage() {
  const router = useRouter();
  const status = one(router.query.status);
  const attention = one(router.query.attention);
  const q = one(router.query.q);
  const page = Number(one(router.query.page)) || 1;
  const [search, setSearch] = useState(q);
  useEffect(() => { setSearch(q); }, [q]);
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (attention) params.set('attention', attention);
  if (q) params.set('q', q);
  if (page > 1) params.set('page', String(page));
  const { data, error, loading, reload } = usePortalResource<CourseList>(router.isReady ? `/admin/portal/courses?${params.toString()}` : null);
  const instructors = usePortalResource<UserList>('/admin/portal/users?role=instructor&status=active&limit=100');
  const [action, setAction] = useState<{ course: CourseRow; to: string; label: string; consequence: string } | null>(null);
  const [reassign, setReassign] = useState<CourseRow | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const setQuery = (next: Record<string, string>) => {
    const query: Record<string, string> = { ...(status ? { status } : {}), ...(attention ? { attention } : {}), ...(q ? { q } : {}) };
    for (const [k, v] of Object.entries(next)) { if (v) query[k] = v; else delete query[k]; }
    if (!('page' in next)) delete query.page;
    void router.push({ pathname: router.pathname, query }, undefined, { shallow: true });
  };
  const changeStatus = async () => {
    if (!action) return null;
    try {
      await apiClient.post(`/courses/${action.course.courseId}/status`, { status: action.to });
      setNotice(`"${txt(action.course.title)}": ${action.label.toLowerCase()} done.`);
      setAction(null);
      await reload();
      return null;
    } catch (err) {
      const ax = err as { response?: { data?: { error?: string } } };
      return ax?.response?.data?.error || 'The status was not changed.';
    }
  };

  return (
    <AdminShell title="Courses" lede="Review, publish and archive courses, and keep every course with an active instructor." actions={<ExportButton href={new URLSearchParams({ type: 'courses', ...(status ? { status } : {}), ...(attention ? { attention } : {}), ...(q ? { q } : {}) }).toString()} />}>
      <FilterBar onSubmit={() => setQuery({ q: search.trim() })}>
        <Field label="Search title" grow><input className="input w-full" value={search} maxLength={80} onChange={(e) => setSearch(e.target.value)} /></Field>
        <Field label="Status">
          <select className="input w-full sm:!w-40" value={status} onChange={(e) => setQuery({ status: e.target.value })}>
            <option value="">All</option><option value="in_review">In review</option><option value="published">Published</option><option value="draft">Draft</option><option value="archived">Archived</option>
          </select>
        </Field>
        <Field label="Attention">
          <select className="input w-full sm:!w-56" value={attention} onChange={(e) => setQuery({ attention: e.target.value })}>
            <option value="">Any</option><option value="instructor">Without an active instructor</option>
          </select>
        </Field>
        <button type="submit" className="btn btn-secondary w-full sm:w-auto">Search</button>
      </FilterBar>
      {notice && <p className="notice notice-brand mb-4 text-sm" role="status">{notice}</p>}
      {loading && !data && <TableSkeleton rows={8} />}
      {error && <ErrorState text={error} onRetry={() => void reload()} />}
      {data && (
        <>
          <DataTable
            testId="courses-table"
            empty={data.rows.length ? undefined : <EmptyState title="No courses match" />}
            head={<tr><th>Course</th><th>Status</th><th className="hidden md:table-cell">Instructor</th><th className="hidden text-right sm:table-cell">Students</th><th className="hidden text-right lg:table-cell">Completion</th><th><span className="sr-only">Actions</span></th></tr>}
          >
            {data.rows.map((c) => (
              <tr key={c.courseId}>
                <td className="max-w-[16rem]">
                  <Link href={`/instructor/courses/${c.courseId}`} className="line-clamp-2 font-medium text-ink hover:underline">{txt(c.title)}</Link>
                  <span className="text-2xs text-ink-subtle">{c.lessons} lesson{c.lessons === 1 ? '' : 's'}{c.reassignments ? ` · ${c.reassignments} handover${c.reassignments === 1 ? '' : 's'}` : ''}</span>
                  <span className="block text-2xs md:hidden">{c.instructor ? c.instructor.name : 'No instructor'}{c.instructorNeedsAttention && <span className="text-down"> · needs an instructor</span>}</span>
                </td>
                <td><StatusChip map={COURSE_STATUS} value={c.status} /></td>
                <td className="hidden md:table-cell">{c.instructor ? c.instructor.name : <span className="text-ink-subtle">None</span>}{c.instructorNeedsAttention && <span className="chip chip-down ml-1">{c.instructor ? c.instructor.status : 'missing'}</span>}</td>
                <td className="hidden text-right num sm:table-cell">{c.enrollments}</td>
                <td className="hidden text-right num lg:table-cell">{c.completionRate === null ? '-' : `${c.completionRate}%`}</td>
                <td>
                  <div className="flex flex-col items-stretch gap-1 sm:flex-row sm:justify-end">
                    {(NEXT[c.status] || []).map((n) => <button key={n.to} type="button" className="btn btn-ghost btn-sm" onClick={() => setAction({ course: c, ...n })}>{n.label}</button>)}
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setReassign(c)}>Reassign</button>
                  </div>
                </td>
              </tr>
            ))}
          </DataTable>
          <Pager page={data.pagination.page} pages={data.pagination.pages} total={data.pagination.total} onPage={(p) => setQuery({ page: String(p) })} />
        </>
      )}
      {action && (
        <ConfirmDialog
          title={`${action.label}: ${txt(action.course.title)}?`}
          consequence={`${action.consequence} The change is recorded in the audit log.`}
          confirmLabel={action.label}
          danger={action.to === 'archived'}
          onConfirm={changeStatus}
          onClose={() => setAction(null)}
        />
      )}
      {reassign && (
        <CourseReassignDialog
          courseId={reassign.courseId}
          courseTitle={txt(reassign.title)}
          instructors={(instructors.data?.rows || []).map((u) => ({ _id: u.id, name: u.name, email: u.email }))}
          onClose={() => setReassign(null)}
          onDone={(message) => { setReassign(null); setNotice(message); void reload(); }}
        />
      )}
    </AdminShell>
  );
}
