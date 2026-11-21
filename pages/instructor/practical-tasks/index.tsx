/**
 * Practical tasks home (instructors; admins read only).
 *   Tasks    GET /api/practical-tasks (scoped to the member's courses; ?status, ?courseId, ?q, ?page)
 *   Grading  GET /api/practical-tasks/queue (?filter, ?taskId, ?courseId, ?mode, ?from, ?to, ?page)
 *   Figures  GET /api/practical-tasks/summary
 * Tabs and filters live in the URL so other pages can link straight to a view.
 */

import Link from 'next/link';
import { useRouter } from 'next/router';
import { Plus } from 'lucide-react';
import PortalShell from '@/components/instructor/portal/PortalShell';
import { EmptyState, ErrorState, Metric, MetricGrid } from '@/components/student/dashboard/Panels';
import { TableSkeleton } from '@/components/loading';
import { formatDate, relativeTime } from '@/components/student/dashboard/format';
import { usePortalResource } from '@/hooks/usePortalResource';
import { ATTEMPT_STATUS, Chip, Deadline, ModeBadge, TASK_STATUS, pair } from '@/components/practical/Common';
import type { StaffQueue, StaffSummary, StaffTaskList } from '@/lib/practical-tasks';

const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : '');
const STATUSES: Array<[string, string]> = [['', 'All'], ['draft', 'Drafts'], ['published', 'Open'], ['closed', 'Closed'], ['archived', 'Archived']];
const QUEUES: Array<[string, string]> = [['pending', 'To grade'], ['graded', 'Graded'], ['returned', 'Returned'], ['all', 'All']];

function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  if (pages <= 1) return null;
  return (
    <div className="mt-4 flex items-center justify-end gap-2 text-sm text-ink-muted">
      <button type="button" className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
      <span className="num">Page {page} of {pages}</span>
      <button type="button" className="btn btn-secondary btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
    </div>
  );
}

function Tabs({ items, value, onChange, counts, label }: { items: Array<[string, string]>; value: string; onChange: (v: string) => void; counts?: Record<string, number>; label: string }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <div className="inline-flex min-w-max gap-1 rounded-xl border border-line bg-surface-2 p-1" role="tablist" aria-label={label}>
        {items.map(([id, text]) => (
          <button key={id || 'all'} type="button" role="tab" aria-selected={value === id} onClick={() => onChange(id)} className={`min-h-[40px] rounded-lg px-3.5 text-sm font-medium ${value === id ? 'bg-surface-1 text-ink shadow-panel' : 'text-ink-muted hover:text-ink'}`}>
            {text}{counts && id && typeof counts[id] === 'number' && counts[id] > 0 && <span className="ml-1.5 text-ink-subtle num">{counts[id]}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function PracticalTasksHome() {
  const router = useRouter();
  const view = one(router.query.view) === 'grading' ? 'grading' : 'tasks';
  const status = one(router.query.status);
  const courseId = one(router.query.courseId);
  const q = one(router.query.q);
  const filter = one(router.query.filter) || 'pending';
  const mode = one(router.query.mode);
  const taskId = one(router.query.taskId);
  const page = Number(one(router.query.page)) || 1;
  const set = (next: Record<string, string>) => {
    const query = Object.fromEntries(Object.entries({ view, status, courseId, q, filter, mode, taskId, page: '', ...next }).filter(([k, v]) => v && !(k === 'view' && v === 'tasks') && !(k === 'filter' && v === 'pending')));
    void router.push({ pathname: router.pathname, query }, undefined, { shallow: true, scroll: false });
  };

  const summary = usePortalResource<StaffSummary>(router.isReady ? '/practical-tasks/summary' : null);
  const taskParams = new URLSearchParams(Object.entries({ status, courseId, q, page: page > 1 ? String(page) : '' }).filter(([, v]) => v));
  const tasks = usePortalResource<StaffTaskList>(router.isReady ? `/practical-tasks?${taskParams.toString()}` : null);
  const queueParams = new URLSearchParams(Object.entries({ filter, courseId, mode, taskId, page: page > 1 ? String(page) : '' }).filter(([, v]) => v));
  const queue = usePortalResource<StaffQueue>(router.isReady && view === 'grading' ? `/practical-tasks/queue?${queueParams.toString()}` : null);
  const s = summary.data;
  const readOnly = tasks.data?.readOnly;

  return (
    <PortalShell
      title="Practical tasks"
      lede="Trading assessments on the simulated market: create, assign, monitor and grade."
      badges={s ? { Grading: s.toGrade } : undefined}
      actions={!readOnly && <Link href="/instructor/practical-tasks/new" className="btn btn-primary" data-testid="new-task"><Plus className="h-4 w-4" aria-hidden />New task</Link>}
    >
      {s && (
        <div className="mb-6">
          <MetricGrid cols="sm:grid-cols-3 lg:grid-cols-6">
            <Metric label="Tasks" value={s.tasks} hint={`${s.published} open`} />
            <Metric label="Students assigned" value={s.assignedStudents} />
            <Metric label="To grade" value={s.toGrade} tone={s.toGrade ? 'text-caution' : 'text-ink'} hint="manual and assisted" />
            <Metric label="Graded attempts" value={s.gradedAttempts} />
            <Metric label="Average score" value={s.averagePercent ? `${s.averagePercent}%` : '-'} hint="graded attempts" />
            <Metric label="Grading methods" value={<span className="text-sm">{s.modes.automatic} auto · {s.modes.assisted} assisted · {s.modes.manual} manual</span>} />
          </MetricGrid>
        </div>
      )}

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Tabs label="View" items={[['tasks', 'Tasks'], ['grading', 'Grading queue']]} value={view} onChange={(v) => set({ view: v, filter: '', status: '' })} counts={s ? { grading: s.toGrade } : undefined} />
        <select className="input w-full sm:w-64" value={courseId} onChange={(e) => set({ courseId: e.target.value })} aria-label="Course">
          <option value="">All courses</option>
          {(tasks.data?.courses || []).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
      </div>

      {view === 'tasks' && (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <Tabs label="Status" items={STATUSES} value={status} onChange={(v) => set({ status: v })} counts={tasks.data?.counts} />
            <form role="search" onSubmit={(e) => { e.preventDefault(); set({ q: String(new FormData(e.currentTarget).get('q') || '') }); }} className="w-full sm:w-auto">
              <input name="q" defaultValue={q} className="input w-full sm:w-64" placeholder="Search titles" aria-label="Search tasks" />
            </form>
          </div>
          {tasks.loading && !tasks.data && <TableSkeleton rows={5} />}
          {tasks.error && <ErrorState text={tasks.error} onRetry={() => void tasks.reload()} />}
          {tasks.data && (tasks.data.tasks.length ? (
            <ul className="space-y-3" data-testid="task-list">
              {tasks.data.tasks.map((t) => (
                <li key={t.id}>
                  <Link href={`/instructor/practical-tasks/${t.id}`} className="card card-interactive grid gap-4 p-4 sm:p-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_auto] lg:items-center">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2"><Chip map={TASK_STATUS} value={t.status} /><span className="text-xs text-ink-subtle">{t.category}</span>{t.source === 'generated' && <span className="text-2xs uppercase tracking-wide text-ink-subtle">Generated</span>}</div>
                      <p className="mt-2 font-display text-base font-semibold text-ink [overflow-wrap:anywhere]">{t.title}</p>
                      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted"><span>{t.course || 'Course'}</span><span>{t.instruments.map(pair).join(' · ')}</span><ModeBadge mode={t.gradingMode} />{t.status === 'published' && <Deadline iso={t.dueAt} quiet />}</p>
                    </div>
                    <dl className="grid grid-cols-4 gap-3 text-center lg:text-left">
                      <div><dt className="readout-label">Assigned</dt><dd className="num font-semibold text-ink">{t.recipients}</dd></div>
                      <div><dt className="readout-label">Submitted</dt><dd className="num font-semibold text-ink">{t.submissionRate ? `${t.submissionRate}%` : '-'}</dd></div>
                      <div><dt className="readout-label">To grade</dt><dd className={`num font-semibold ${t.waiting ? 'text-caution' : 'text-ink'}`}>{t.waiting}</dd></div>
                      <div><dt className="readout-label">Average</dt><dd className="num font-semibold text-ink">{t.averagePercent ? `${t.averagePercent}%` : '-'}</dd></div>
                    </dl>
                    <span className="text-xs text-ink-subtle lg:text-right">Updated {relativeTime(t.updatedAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title={status || q ? 'No tasks match' : 'No practical tasks yet'} text="Generate a task from a template or build one yourself. Students see it once you assign it." action={!readOnly ? <Link href="/instructor/practical-tasks/new" className="btn btn-primary btn-sm">Create a task</Link> : undefined} testId="tasks-empty" />
          ))}
          {tasks.data && <Pager page={tasks.data.pagination.page} pages={tasks.data.pagination.pages} onPage={(p) => set({ page: String(p) })} />}
          <p className="mt-6 text-xs text-ink-subtle">Older free-form demo tasks remain under <Link href="/instructor/demo-tasks" className="underline">Demo tasks</Link>.</p>
        </>
      )}

      {view === 'grading' && (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <Tabs label="Queue" items={QUEUES} value={filter} onChange={(v) => set({ filter: v })} counts={queue.data?.counts} />
            <select className="input w-full sm:w-56" value={mode} onChange={(e) => set({ mode: e.target.value })} aria-label="Grading method">
              <option value="">Every grading method</option><option value="assisted">System-assisted</option><option value="manual">Instructor</option><option value="automatic">Automatic</option>
            </select>
          </div>
          {queue.loading && !queue.data && <TableSkeleton rows={5} />}
          {queue.error && <ErrorState text={queue.error} onRetry={() => void queue.reload()} />}
          {queue.data && (queue.data.rows.length ? (
            <div className="overflow-x-auto rounded-panel border border-line bg-surface-1">
              <table className="table-orbit w-full text-sm" data-testid="queue-table">
                <thead><tr><th>Student</th><th className="hidden md:table-cell">Task</th><th>Status</th><th className="hidden sm:table-cell">Submitted</th><th className="text-right">Score</th><th><span className="sr-only">Open</span></th></tr></thead>
                <tbody>
                  {queue.data.rows.map((r) => (
                    <tr key={r.id}>
                      <td><span className="font-medium text-ink">{r.student}</span><span className="block text-2xs text-ink-subtle md:hidden">{r.task}</span><span className="block text-2xs text-ink-subtle">Attempt {r.attempt}</span></td>
                      <td className="hidden max-w-[16rem] md:table-cell"><span className="block truncate">{r.task}</span><ModeBadge mode={r.gradingMode} /></td>
                      <td><Chip map={ATTEMPT_STATUS} value={r.status} />{r.late && <span className="mt-1 block text-2xs font-semibold text-caution">Late</span>}</td>
                      <td className="hidden whitespace-nowrap text-xs text-ink-muted sm:table-cell" title={formatDate(r.submittedAt, true)}>{relativeTime(r.submittedAt)}</td>
                      <td className="whitespace-nowrap text-right num">{r.score === null ? '-' : `${r.score}/${r.maxScore}`}{r.suggested && <span className="block text-2xs text-ink-subtle">system part</span>}</td>
                      <td className="text-right"><Link href={`/instructor/practical-tasks/review/${encodeURIComponent(r.id)}`} className="btn btn-secondary btn-sm">{r.status === 'graded' ? 'View' : 'Grade'}</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title={filter === 'pending' ? 'Nothing to grade' : 'No submissions here'} text="Automatic tasks are graded on submission. Manual and system-assisted submissions wait here, oldest first." testId="queue-empty" />
          ))}
          {queue.data && <Pager page={queue.data.pagination.page} pages={queue.data.pagination.pages} onPage={(p) => set({ page: String(p) })} />}
        </>
      )}
    </PortalShell>
  );
}
