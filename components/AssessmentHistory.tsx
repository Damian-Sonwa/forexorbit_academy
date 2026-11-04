/**
 * A student's quiz results across all courses, newest first (Phase 9):
 * GET /api/quizzes/history. Summaries only; answers stay behind each quiz's review policy.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';

type Row = {
  id: string;
  lessonId: string;
  courseId: string;
  lessonTitle: string | null;
  courseTitle: string | null;
  attemptNumber: number | null;
  percent: number;
  passed: boolean | null;
  status: string;
  finishedAt: string | null;
};
type History = { results: Row[]; pagination: { page: number; pages: number; total: number } };

export default function AssessmentHistory() {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<History | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    apiClient.get<History>(`/quizzes/history?page=${page}&limit=10`)
      .then((r) => { if (!cancelled) setData(r); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [page]);

  if (failed) return <p className="text-sm text-gray-600 dark:text-gray-300" role="alert">Your quiz results could not be loaded.</p>;
  if (!data) return <p className="text-sm text-gray-500" role="status">Loading quiz results…</p>;
  if (data.pagination.total === 0) return null;
  return (
    <section className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm sm:p-6 dark:border-gray-700 dark:bg-gray-800" data-testid="assessment-history">
      <h2 className="text-lg font-bold text-gray-900 dark:text-white">Quiz results</h2>
      <ul className="mt-2 divide-y divide-gray-200 dark:divide-gray-700">
        {data.results.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <span className="min-w-0 break-words">
              {r.lessonTitle
                ? <Link href={`/courses/${r.courseId}/lessons/${r.lessonId}`} className="font-medium text-primary-600 hover:underline">{r.lessonTitle}</Link>
                : <span className="font-medium text-gray-700 dark:text-gray-300">Lesson no longer available</span>}
              <span className="block text-xs text-gray-500 dark:text-gray-400">
                {r.courseTitle || 'Course'}{r.attemptNumber ? ` · attempt ${r.attemptNumber}` : ''}{r.finishedAt ? ` · ${new Date(r.finishedAt).toLocaleDateString()}` : ''}
              </span>
            </span>
            <span className="font-semibold text-gray-900 dark:text-white">
              {r.percent}%{r.passed === true ? ' · passed' : r.passed === false ? ' · not passed' : ''}{r.status === 'expired' ? ' · time ran out' : ''}
            </span>
          </li>
        ))}
      </ul>
      {data.pagination.pages > 1 && (
        <div className="mt-2 flex items-center justify-between text-sm">
          <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="min-h-[44px] px-2 font-semibold text-primary-600 disabled:opacity-40">Newer</button>
          <span className="text-gray-600 dark:text-gray-300">Page {data.pagination.page} of {data.pagination.pages}</span>
          <button type="button" disabled={page >= data.pagination.pages} onClick={() => setPage((p) => p + 1)} className="min-h-[44px] px-2 font-semibold text-primary-600 disabled:opacity-40">Older</button>
        </div>
      )}
    </section>
  );
}
