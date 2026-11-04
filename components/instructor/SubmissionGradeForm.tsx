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
      {submission.submissionText && <p className="whitespace-pre-wrap break-words text-gray-800 dark:text-gray-200">{submission.submissionText}</p>}
      {file && <a href={file} target="_blank" rel="noreferrer" className="font-semibold text-primary-600 hover:underline">Open the attached file</a>}
      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="text-gray-700 dark:text-gray-300 sm:w-32">Grade %
          <input type="number" min={0} max={100} value={grade} onChange={(e) => setGrade(e.target.value)} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white" />
        </label>
        <label className="flex-1 text-gray-700 dark:text-gray-300">Feedback
          <textarea rows={2} maxLength={5000} value={feedback} onChange={(e) => setFeedback(e.target.value)} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white" />
        </label>
      </div>
      <button type="button" onClick={() => void save()} disabled={busy || grade.trim() === ''} className="min-h-[44px] rounded-lg bg-primary-600 px-4 font-semibold text-white hover:bg-primary-700 disabled:opacity-50">
        {busy ? 'Saving…' : 'Save grade'}
      </button>
      {error && <p role="alert" className="text-red-700">{error}</p>}
      {submission.gradeHistory && submission.gradeHistory.length > 0 && (
        <div data-testid="grade-history">
          <p className="font-semibold text-gray-700 dark:text-gray-300">Grading history</p>
          <ul className="text-xs text-gray-600 dark:text-gray-400">
            {submission.gradeHistory.map((entry, index) => (
              <li key={index}>{new Date(entry.gradedAt).toLocaleString()}: {entry.previousGrade === null ? '' : `${entry.previousGrade}% → `}{entry.grade}%</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
