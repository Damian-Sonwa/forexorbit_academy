/**
 * Grade one submission (Phase 12). Posts to the existing POST /api/assignments/:id/grade, which
 * decides who may grade and validates the values. Changing an existing grade asks for a reason
 * (5-500 characters), as the server requires; a 409 means the work or grade changed meanwhile.
 * The automated quiz scores are not reachable from here.
 */

import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';

export const REASON_MIN = 5;
export const REASON_MAX = 500;
export const FEEDBACK_MAX = 5000;

/** Pure: what the form needs before it can be sent. */
export function gradeFormState({ grade, feedback, reason, currentGrade }: { grade: string; feedback: string; reason: string; currentGrade: number | null }) {
  const value = grade.trim() === '' ? null : Number(grade);
  const validGrade = value !== null && Number.isInteger(value) && value >= 0 && value <= 100;
  const changing = currentGrade !== null && validGrade && value !== currentGrade;
  const reasonOk = !changing || (reason.trim().length >= REASON_MIN && reason.trim().length <= REASON_MAX);
  const feedbackOk = feedback.length <= FEEDBACK_MAX;
  return { value, validGrade, changing, reasonOk, feedbackOk, canSave: validGrade && reasonOk && feedbackOk };
}

export default function GradeForm({ assignmentId, submissionId, currentGrade, currentFeedback, points, onSaved }: {
  assignmentId: string;
  submissionId: string;
  currentGrade: number | null;
  currentFeedback: string | null;
  points: number;
  onSaved: (message: string) => Promise<void> | void;
}) {
  const [grade, setGrade] = useState(currentGrade === null ? '' : String(currentGrade));
  const [feedback, setFeedback] = useState(currentFeedback || '');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setGrade(currentGrade === null ? '' : String(currentGrade));
    setFeedback(currentFeedback || '');
    setReason('');
    setError(null);
  }, [submissionId, currentGrade, currentFeedback]);

  const state = gradeFormState({ grade, feedback, reason, currentGrade });

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!state.canSave || busy) return;
    setBusy(true);
    setError(null);
    try {
      await apiClient.post(`/assignments/${assignmentId}/grade`, {
        submissionId,
        grade: state.value,
        feedback: feedback.trim(),
        ...(state.changing ? { reason: reason.trim() } : {}),
      });
      await onSaved(state.changing ? 'Grade changed and the student notified.' : 'Grade saved and returned to the student.');
    } catch (err) {
      const ax = err as { response?: { status?: number; data?: { error?: string } } };
      setError(ax?.response?.status === 409 ? 'This submission changed while you were grading it. It has been reloaded: check it and save again.' : ax?.response?.data?.error || 'The grade was not saved.');
      if (ax?.response?.status === 409) await onSaved('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} className="space-y-4" data-testid="grade-form">
      <div className="flex flex-wrap items-end gap-4">
        <label className="block">
          <span className="label">Grade (0-100)</span>
          <input
            className="input mt-1.5 w-32 text-lg font-semibold num"
            inputMode="numeric"
            value={grade}
            onChange={(e) => setGrade(e.target.value.replace(/[^\d]/g, '').slice(0, 3))}
            aria-invalid={grade !== '' && !state.validGrade}
            required
          />
        </label>
        <p className="pb-2 text-xs text-ink-subtle">
          {state.validGrade ? `Awards ${Math.round(((state.value as number) / 100) * points)} of ${points} points.` : 'A whole number from 0 to 100.'}
        </p>
      </div>
      <label className="block">
        <span className="label">Feedback for the student</span>
        <textarea className="input mt-1.5 min-h-[120px] resize-y" maxLength={FEEDBACK_MAX} value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="What went well, what to improve, and what to try next" />
        <span className="mt-1 block text-right text-2xs text-ink-subtle num">{feedback.length}/{FEEDBACK_MAX}</span>
      </label>
      {state.changing && (
        <label className="block" data-testid="grade-reason">
          <span className="label">Reason for changing the grade (required)</span>
          <input className="input mt-1.5" maxLength={REASON_MAX} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={`From ${currentGrade} to ${state.value}: why?`} required />
          <span className="mt-1 block text-2xs text-ink-subtle">Kept in the grading history and the audit log.</span>
        </label>
      )}
      {error && <p className="notice notice-caution text-sm" role="alert">{error}</p>}
      <button type="submit" className="btn btn-primary" disabled={!state.canSave || busy} data-testid="grade-save">
        {busy ? 'Saving…' : currentGrade === null ? 'Save grade and return' : state.changing ? 'Change grade' : 'Update feedback'}
      </button>
    </form>
  );
}
