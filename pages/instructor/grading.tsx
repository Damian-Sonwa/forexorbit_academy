/**
 * Instructor portal: grading (Phase 12).
 *   Queue   GET /api/instructor/submissions (scoped to the member's courses; pending oldest first).
 *   Review  GET /api/instructor/submissions/:id (full work, brief, grade history; 404 outside scope).
 *   Grade   POST /api/assignments/:id/grade (who may grade, validation, history, audit, notification).
 * The selected submission is in the URL (?submission=), so other pages can link straight to it.
 * After a grade is saved the next ungraded submission opens.
 */

import { useRouter } from 'next/router';
import { useEffect, useRef, useState } from 'react';
import PortalShell from '@/components/instructor/portal/PortalShell';
import { Pager, QueueList, ReviewBody } from '@/components/instructor/portal/Views';
import GradeForm from '@/components/instructor/portal/GradeForm';
import { EmptyState, ErrorState } from '@/components/student/dashboard/Panels';
import { LessonSkeleton, TableSkeleton } from '@/components/loading';
import { usePortalResource } from '@/hooks/usePortalResource';
import { previewText } from '@/lib/plain-text';
import type { SubmissionQueue, SubmissionReview } from '@/lib/instructor-portal';

const FILTERS: Array<['pending' | 'late' | 'graded' | 'all', string]> = [['pending', 'To grade'], ['late', 'Late'], ['graded', 'Graded'], ['all', 'All']];
const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : '');

export default function GradingPage() {
  const router = useRouter();
  const status = (one(router.query.status) || 'pending') as 'pending' | 'late' | 'graded' | 'all';
  const courseId = one(router.query.courseId);
  const assignmentId = one(router.query.assignmentId);
  const selected = one(router.query.submission) || null;
  const page = Number(one(router.query.page)) || 1;
  const [notice, setNotice] = useState<string | null>(null);
  const reviewRef = useRef<HTMLDivElement>(null);

  const params = new URLSearchParams({ status });
  if (courseId) params.set('courseId', courseId);
  if (assignmentId) params.set('assignmentId', assignmentId);
  if (page > 1) params.set('page', String(page));
  const queue = usePortalResource<SubmissionQueue>(router.isReady ? `/instructor/submissions?${params.toString()}` : null);
  const review = usePortalResource<SubmissionReview>(router.isReady && selected ? `/instructor/submissions/${selected}` : null);

  const setQuery = (next: Record<string, string | null>, opts: { keepPage?: boolean } = {}) => {
    const query: Record<string, string> = {};
    for (const [k, v] of Object.entries({ status, courseId, assignmentId, submission: selected || '', page: opts.keepPage ? String(page) : '', ...next })) if (v) query[k] = v;
    if (query.status === 'pending') delete query.status;
    void router.push({ pathname: router.pathname, query }, undefined, { shallow: true, scroll: false });
  };

  const open = (id: string) => {
    setNotice(null);
    setQuery({ submission: id }, { keepPage: true });
    // On phones the review panel is below the queue.
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches) setTimeout(() => reviewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  // Open the first item when nothing is selected.
  useEffect(() => {
    if (!selected && queue.data && queue.data.rows.length && typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches) {
      setQuery({ submission: queue.data.rows[0].submissionId }, { keepPage: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue.data, selected]);

  const afterSave = async (message: string) => {
    await Promise.all([queue.reload(), review.reload()]);
    if (!message) return;
    setNotice(message);
    if (status === 'pending' || status === 'late') {
      const next = queue.data?.rows.find((r) => r.submissionId !== selected && r.status === 'pending');
      if (next) setQuery({ submission: next.submissionId }, { keepPage: true });
    }
  };

  const counts = queue.data?.counts;
  return (
    <PortalShell title="Grading" lede="Review submitted work, give a grade and feedback, and return it to the student." badges={counts ? { Grading: counts.pending } : undefined}>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="flex gap-1 overflow-x-auto rounded-xl border border-line bg-surface-2 p-1" role="tablist" aria-label="Submissions">
          {FILTERS.map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={status === id} onClick={() => setQuery({ status: id, submission: null })} className={`min-h-[40px] shrink-0 rounded-lg px-3.5 text-sm font-medium ${status === id ? 'bg-surface-1 text-ink shadow-panel' : 'text-ink-muted hover:text-ink'}`}>
              {label}{counts && id !== 'all' && <span className="ml-1.5 text-ink-subtle num">{counts[id]}</span>}
            </button>
          ))}
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <select className="input w-full sm:!w-56" aria-label="Course" value={courseId} onChange={(e) => setQuery({ courseId: e.target.value, assignmentId: null, submission: null })}>
            <option value="">All courses</option>
            {(queue.data?.courses || []).map((c) => <option key={c.courseId} value={c.courseId}>{previewText(c.title)}</option>)}
          </select>
          <select className="input w-full sm:!w-56" aria-label="Assignment" value={assignmentId} onChange={(e) => setQuery({ assignmentId: e.target.value, submission: null })}>
            <option value="">All assignments</option>
            {(queue.data?.assignments || []).filter((a) => !courseId || a.courseId === courseId).map((a) => <option key={a.assignmentId} value={a.assignmentId}>{previewText(a.title)}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <div className="min-w-0">
          {queue.loading && !queue.data && <TableSkeleton rows={5} />}
          {queue.error && <ErrorState text={queue.error} onRetry={() => void queue.reload()} />}
          {queue.data && (
            <>
              <QueueList rows={queue.data.rows} selectedId={selected} onSelect={open} />
              <Pager page={queue.data.pagination.page} pages={queue.data.pagination.pages} onPage={(p) => setQuery({ page: String(p), submission: null })} />
            </>
          )}
        </div>

        <div ref={reviewRef} className="min-w-0 scroll-mt-24" aria-live="polite">
          {notice && <p className="notice notice-brand mb-4 text-sm" role="status" data-testid="grade-notice">{notice}</p>}
          {!selected && <EmptyState title="Choose a submission" text="Pick work from the list to review and grade it." testId="review-none" />}
          {selected && review.loading && !review.data && <LessonSkeleton />}
          {selected && review.error && <ErrorState text={review.error} onRetry={() => void review.reload()} />}
          {selected && review.data && review.data.submission.submissionId === selected && (
            <div className="card space-y-6 !p-5 sm:!p-6">
              <ReviewBody review={review.data} />
              <div className="border-t border-line pt-5">
                <GradeForm
                  assignmentId={review.data.assignment.assignmentId}
                  submissionId={review.data.submission.submissionId}
                  currentGrade={review.data.submission.grade}
                  currentFeedback={review.data.submission.feedback}
                  points={review.data.assignment.points}
                  onSaved={afterSave}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </PortalShell>
  );
}
