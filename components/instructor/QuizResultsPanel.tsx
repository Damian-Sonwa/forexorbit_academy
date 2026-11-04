/**
 * Finished quiz attempts of a lesson for its instructor or an admin (Phase 9):
 * GET /api/quizzes/:lessonId/attempts, one page at a time (the summary covers all of them), and
 * GET .../attempts/:id to review one attempt against the questions frozen when it started.
 */

import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';

const PAGE_SIZE = 20;

type Row = { attemptId: string; studentName: string; number: number; status: string; submittedAt: string | null; percent: number | null; passed: boolean | null };
type Results = {
  attempts: Row[];
  summary: { attempts: number; students: number; averagePercent: number | null; passed: number };
  pagination: { page: number; pages: number; total: number };
};
type Review = {
  id: string;
  questions: { id: string; question: string; options: string[]; points: number; correctAnswer: number; answer: number | null; correct: boolean }[];
};

export default function QuizResultsPanel({ lessonId }: { lessonId: string }) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Results | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<Review | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    apiClient.get<Results>(`/quizzes/${lessonId}/attempts?page=${page}&limit=${PAGE_SIZE}`)
      .then((r) => { if (!cancelled) setData(r); })
      .catch(() => { if (!cancelled) setError('Results could not be loaded.'); });
    return () => { cancelled = true; };
  }, [lessonId, page]);

  const open = async (attemptId: string) => {
    try {
      const res = await apiClient.get<{ attempt: Review }>(`/quizzes/${lessonId}/attempts/${attemptId}`);
      setReview(res.attempt);
    } catch {
      setError('That attempt could not be loaded.');
    }
  };

  if (error) return <p className="text-sm text-red-700" role="alert">{error}</p>;
  if (!data) return <p className="text-sm text-gray-500" role="status">Loading results…</p>;
  return (
    <section className="space-y-2" data-testid="quiz-results">
      <p className="text-sm text-gray-700 dark:text-gray-300" data-testid="quiz-results-summary">
        {data.summary.attempts} finished attempt{data.summary.attempts === 1 ? '' : 's'} by {data.summary.students} student{data.summary.students === 1 ? '' : 's'}
        {data.summary.averagePercent !== null ? ` · average ${data.summary.averagePercent}%` : ''} · {data.summary.passed} passed
      </p>
      {data.attempts.length > 0 && (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead><tr className="text-gray-500"><th className="py-1 pr-3">Student</th><th className="pr-3">Attempt</th><th className="pr-3">Score</th><th className="pr-3">Result</th><th className="pr-3">Finished</th><th><span className="sr-only">Review</span></th></tr></thead>
            <tbody>
              {data.attempts.map((r) => (
                <tr key={r.attemptId} className="border-t border-gray-200 dark:border-gray-700">
                  <td className="py-1 pr-3">{r.studentName}</td>
                  <td className="pr-3">{r.number}{r.status === 'expired' ? ' (time ran out)' : ''}</td>
                  <td className="pr-3">{r.percent !== null ? `${r.percent}%` : '—'}</td>
                  <td className="pr-3">{r.passed === null ? '—' : r.passed ? 'Passed' : 'Not passed'}</td>
                  <td className="pr-3">{r.submittedAt ? new Date(r.submittedAt).toLocaleString() : '—'}</td>
                  <td><button type="button" className="min-h-[44px] font-semibold text-primary-600 hover:underline" onClick={() => void open(r.attemptId)}>Review</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data.pagination.pages > 1 && (
        <div className="flex items-center justify-between text-sm" data-testid="quiz-results-pager">
          <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="min-h-[44px] px-2 font-semibold text-primary-600 disabled:opacity-40">Newer</button>
          <span>Page {data.pagination.page} of {data.pagination.pages}</span>
          <button type="button" disabled={page >= data.pagination.pages} onClick={() => setPage((p) => p + 1)} className="min-h-[44px] px-2 font-semibold text-primary-600 disabled:opacity-40">Older</button>
        </div>
      )}
      {review && (
        <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700" data-testid="quiz-attempt-review">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-gray-900 dark:text-white">Attempt review</p>
            <button type="button" className="min-h-[44px] px-2 text-sm font-semibold text-primary-600" onClick={() => setReview(null)}>Close</button>
          </div>
          <ol className="mt-2 space-y-2 text-sm">
            {review.questions.map((q, index) => (
              <li key={q.id} className={`rounded-lg border p-2 ${q.correct ? 'border-green-200' : 'border-red-200'}`}>
                <p className="break-words font-medium text-gray-900 dark:text-white">{index + 1}. {q.question} ({q.points} pt)</p>
                <p className="break-words text-gray-700 dark:text-gray-300">Answer: {q.answer === null ? 'not answered' : q.options[q.answer]}</p>
                {!q.correct && <p className="break-words text-green-800 dark:text-green-400">Correct: {q.options[q.correctAnswer]}</p>}
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
