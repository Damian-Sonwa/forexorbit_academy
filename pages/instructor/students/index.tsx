/**
 * Instructor portal: students (Phase 12). GET /api/instructor/students, paginated and scoped on the
 * server to the member's courses. Filters live in the URL so a filtered list can be linked.
 */

import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import PortalShell from '@/components/instructor/portal/PortalShell';
import { Pager, StudentTable } from '@/components/instructor/portal/Views';
import { ErrorState } from '@/components/student/dashboard/Panels';
import { TableSkeleton } from '@/components/loading';
import { usePortalResource } from '@/hooks/usePortalResource';
import { previewText } from '@/lib/plain-text';
import type { StudentList } from '@/lib/instructor-portal';

const STATUSES: Array<[string, string]> = [['', 'All statuses'], ['in_progress', 'In progress'], ['completed', 'Completed'], ['not_started', 'Not started']];
const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : '');

export default function InstructorStudentsPage() {
  const router = useRouter();
  const courseId = one(router.query.courseId);
  const status = one(router.query.status);
  const q = one(router.query.q);
  const page = Number(one(router.query.page)) || 1;
  const [search, setSearch] = useState(q);
  useEffect(() => { setSearch(q); }, [q]);

  const params = new URLSearchParams();
  if (courseId) params.set('courseId', courseId);
  if (status) params.set('status', status);
  if (q) params.set('q', q);
  if (page > 1) params.set('page', String(page));
  const { data, error, loading, reload } = usePortalResource<StudentList>(router.isReady ? `/instructor/students?${params.toString()}` : null);

  const setQuery = (next: Record<string, string>) => {
    const query: Record<string, string> = { ...(courseId ? { courseId } : {}), ...(status ? { status } : {}), ...(q ? { q } : {}) };
    for (const [k, v] of Object.entries(next)) { if (v) query[k] = v; else delete query[k]; }
    if (!('page' in next)) delete query.page;
    void router.push({ pathname: router.pathname, query }, undefined, { shallow: true });
  };

  return (
    <PortalShell title="Students" lede="Students enrolled in your courses, with their progress, quizzes and submitted work.">
      <form
        className="mb-5 flex flex-wrap items-end gap-3"
        role="search"
        onSubmit={(e) => { e.preventDefault(); setQuery({ q: search.trim() }); }}
      >
        <label className="block min-w-[12rem] flex-1">
          <span className="label">Search by name</span>
          <input className="input mt-1.5" value={search} maxLength={80} onChange={(e) => setSearch(e.target.value)} placeholder="Student name" />
        </label>
        <label className="block w-full sm:w-auto">
          <span className="label">Course</span>
          <select className="input mt-1.5 w-full sm:!w-56" value={courseId} onChange={(e) => setQuery({ courseId: e.target.value })}>
            <option value="">All my courses</option>
            {(data?.courses || []).map((c) => <option key={c.courseId} value={c.courseId}>{previewText(c.title)}</option>)}
          </select>
        </label>
        <label className="block w-full sm:w-auto">
          <span className="label">Status</span>
          <select className="input mt-1.5 w-full sm:!w-44" value={status} onChange={(e) => setQuery({ status: e.target.value })}>
            {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <button type="submit" className="btn btn-secondary w-full sm:w-auto">Search</button>
      </form>

      {loading && !data && <TableSkeleton rows={6} />}
      {error && <ErrorState text={error} onRetry={() => void reload()} />}
      {data && (
        <div aria-busy={loading}>
          <p className="mb-3 text-sm text-ink-muted"><span className="font-semibold text-ink num">{data.pagination.total}</span> enrollment{data.pagination.total === 1 ? '' : 's'}</p>
          <StudentTable rows={data.rows} />
          <Pager page={data.pagination.page} pages={data.pagination.pages} onPage={(p) => setQuery({ page: String(p) })} />
        </div>
      )}
    </PortalShell>
  );
}
