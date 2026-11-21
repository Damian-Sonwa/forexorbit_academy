/**
 * Compact practical-tasks card for the student dashboard overview: open work and the next deadline,
 * from GET /api/practical-tasks?group=todo (the student's own tasks only). Hidden when there is
 * nothing assigned, so it adds no clutter for students without tasks.
 */

import Link from 'next/link';
import { ClipboardCheck } from 'lucide-react';
import { usePortalResource } from '@/hooks/usePortalResource';
import { Deadline } from './Common';
import type { StudentTaskList } from '@/lib/practical-tasks';

export default function PracticalTasksCard() {
  const { data } = usePortalResource<StudentTaskList>('/practical-tasks?group=todo');
  if (!data) return null;
  const total = Object.values(data.counts).reduce((s, n) => s + n, 0);
  if (!total) return null;
  const next = data.tasks[0];
  return (
    <section className="card !p-5" aria-labelledby="overview-practical" data-testid="practical-card-overview">
      <div className="flex items-center justify-between gap-3">
        <h2 id="overview-practical" className="section-title">Practical tasks</h2>
        <ClipboardCheck className="h-5 w-5 text-primary-500" aria-hidden />
      </div>
      <p className="mt-2 text-sm text-ink-muted"><span className="font-semibold text-ink num">{data.counts.todo}</span> to do · <span className="num">{data.counts.waiting}</span> awaiting a grade{data.summary.averagePercent ? ` · average ${data.summary.averagePercent}%` : ''}</p>
      {next && (
        <Link href={`/student-dashboard/practical/${next.id}`} className="mt-3 block rounded-xl border border-line bg-surface-2 p-3 hover:border-primary-500">
          <span className="block truncate text-sm font-medium text-ink">{next.title}</span>
          <span className="mt-1 block"><Deadline iso={next.dueAt} /></span>
        </Link>
      )}
      <Link href="/student-dashboard?section=tasks" className="btn btn-secondary btn-sm mt-3 w-full">All practical tasks</Link>
    </section>
  );
}
