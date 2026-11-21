/**
 * Grade one assignment submission (Phase 9): the student's work, the grade and feedback, and the
 * grading history. POST /api/assignments/:id/grade decides who may grade and validates the values;
 * a 409 means the work changed since this page loaded.
 */

import { useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { safeLinkUrl } from '@/lib/safe-url';

export type GradeHistoryEntry = { grade: number; feedback: string | null; gradedAt: string; previousGrade: number | null };
export type GradableSubmission = {
  _id: string;
  grade: number | null;
  feedback: string | null;
  late?: boolean;
  submissionText?: string;
  submissionFile?: string | null;
  gradeHistory?: GradeHistoryEntry[];
};

export default function SubmissionGradeForm({ assignmentId, submission, onSaved }: { assignmentId: string; submission: GradableSubmission; onSaved: () => Promise<void> }) {
  const [grade, setGrade] = useState(submission.grade === null ? '' : String(submission.grade));
  const [feedback, setFeedback] = useState(submission.feedback || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const file = submission.submissionFile ? safeLinkUrl(submission.submissionFile) : null;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiClient.post(`/assignments/${assignmentId}/grade`, { submissionId: submission._id, grade: Number(grade), feedback });
      await onSaved();
    } catch (err) {
      const ax = err as { response?: { data?: { error?: string } } };
      setError(`Not saved. ${ax?.response?.data?.error || 'Please try again.'}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 text-sm" data-testid="grade-form">
      {submission.late && <p className="font-semibold text-amber-700 dark:text-amber-400">Submitted after the due date</p>}
      {submission.submissionText && <p className="whitespace-pre-wrap break-words dark:text-gray-200 text-ink">{submission.submissionText}</p>}
      {file && <a href={file} target="_blank" rel="noreferrer" className="font-semibold text-primary-600 hover:underline">Open the attached file</a>}
      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="sm:w-32 text-ink-muted">Grade %
          <input type="number" min={0} max={100} value={grade} onChange={(e) => setGrade(e.target.value)} className="input w-full" />
        </label>
        <label className="flex-1 text-ink-muted">Feedback
          <textarea rows={2} maxLength={5000} value={feedback} onChange={(e) => setFeedback(e.target.value)} className="input w-full" />
        </label>
      </div>
      <button type="button" onClick={() => void save()} disabled={busy || grade.trim() === ''} className="btn btn-primary min-h-[44px] px-4">
        {busy ? 'Saving…' : 'Save grade'}
      </button>
      {error && <p role="alert" className="text-red-700">{error}</p>}
      {submission.gradeHistory && submission.gradeHistory.length > 0 && (
        <div data-testid="grade-history">
          <p className="font-semibold text-ink-muted">Grading history</p>
          <ul className="text-xs text-ink-muted">
            {submission.gradeHistory.map((entry, index) => (
              <li key={index}>{new Date(entry.gradedAt).toLocaleString()}: {entry.previousGrade === null ? '' : `${entry.previousGrade}% → `}{entry.grade}%</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
