/**
 * Assignments of a lesson for the enrolled student (Phase 9): instructions, submitting and
 * resubmitting, and the grade and feedback once given. Everything comes from the existing
 * assignment API, which decides who may see and submit; shows nothing when there are none.
 */

import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';

type Submission = {
  status: string;
  grade: number | null;
  feedback: string | null;
  submissionText: string;
  submittedAt: string | null;
  late: boolean;
};
type Assignment = {
  _id: string;
  title: string;
  description: string;
  instructions: string;
  dueDate: string | null;
  points: number;
  submission: Submission | null;
};

function AssignmentCard({ assignment, onSaved }: { assignment: Assignment; onSaved: () => Promise<void> }) {
  const mine = assignment.submission;
  const [text, setText] = useState(mine?.submissionText || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const graded = mine?.status === 'graded' && mine.grade !== null;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiClient.post(`/assignments/${assignment._id}/submit`, { submissionText: text });
      await onSaved();
    } catch (err) {
      const ax = err as { response?: { data?: { error?: string } } };
      setError(`Not submitted. ${ax?.response?.data?.error || 'Please try again.'}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="rounded-xl border border-gray-200 p-4 dark:border-gray-700" data-testid="assignment-card">
      <p className="font-semibold text-ink">{assignment.title}</p>
      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-ink-muted">{assignment.instructions}</p>
      <p className="mt-1 text-xs text-ink-muted">
        {assignment.points} points{assignment.dueDate ? ` · due ${new Date(assignment.dueDate).toLocaleString()}` : ''}
      </p>
      {mine && (
        <div className="mt-3 rounded-lg bg-gray-50 p-3 text-sm dark:bg-gray-900/40" data-testid="assignment-status">
          <p className="font-medium text-ink">
            {graded ? `Graded: ${mine.grade}%` : 'Submitted, waiting for grading'}
            {mine.late ? ' · submitted late' : ''}
          </p>
          {mine.feedback && <p className="mt-1 whitespace-pre-wrap break-words text-ink-muted" data-testid="assignment-feedback">{mine.feedback}</p>}
        </div>
      )}
      <label className="mt-3 block text-sm font-medium text-ink-muted">
        Your work
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          className="input mt-1 w-full text-sm"
        />
      </label>
      {graded && <p className="mt-1 text-xs text-ink-muted">Submitting again replaces this grade until your new work is graded. Your earlier grade stays on record.</p>}
      <button
        type="button"
        onClick={() => void submit()}
        disabled={busy || !text.trim()}
        className="btn btn-primary mt-2 min-h-[44px] w-full px-5 text-sm sm:w-auto"
      >
        {busy ? 'Submitting…' : mine ? 'Submit again' : 'Submit'}
      </button>
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    </li>
  );
}

export default function LessonAssignments({ lessonId }: { lessonId: string }) {
  const [items, setItems] = useState<Assignment[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems(await apiClient.get<Assignment[]>(`/assignments?lessonId=${lessonId}`));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [lessonId]);

  useEffect(() => { void load(); }, [load]);

  if (failed) return <p className="text-sm text-ink-muted" role="alert">Assignments could not be loaded.</p>;
  if (!items || items.length === 0) return null;
  return (
    <section className="card rounded-xl p-4 sm:rounded-2xl sm:p-6" data-testid="lesson-assignments">
      <h2 className="mb-3 text-xl font-bold sm:text-2xl text-ink">Assignments</h2>
      <ul className="space-y-3">
        {items.map((assignment) => <AssignmentCard key={assignment._id} assignment={assignment} onSaved={load} />)}
      </ul>
    </section>
  );
}
