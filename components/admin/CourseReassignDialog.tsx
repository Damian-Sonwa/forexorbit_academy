/**
 * Reassign a course to another instructor (Phase 12). Admins and the Super Admin.
 * GET/POST /api/admin/courses/:id/reassign. Only active instructors are offered (the server checks
 * again); a reason is required; the move keeps every student record and is audited and notified.
 */

import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';

type Person = { _id: string; name?: string; email?: string };
type History = { course: { instructorId: string | null; instructor: string | null }; history: Array<{ from: string | null; to: string; by: string; at: string | null; reason: string }> };

export default function CourseReassignDialog({ courseId, courseTitle, instructors, onClose, onDone }: {
  courseId: string;
  courseTitle: string;
  instructors: Person[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [info, setInfo] = useState<History | null>(null);
  const [target, setTarget] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient.get<History>(`/admin/courses/${courseId}/reassign`).then(setInfo).catch(() => setError('The current assignment could not be loaded.'));
  }, [courseId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const options = instructors.filter((p) => p._id !== info?.course.instructorId);
  const canSave = Boolean(target) && reason.trim().length >= 5 && reason.trim().length <= 500 && !busy;

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      await apiClient.post(`/admin/courses/${courseId}/reassign`, { instructorId: target, reason: reason.trim() });
      const name = instructors.find((p) => p._id === target);
      onDone(`"${courseTitle}" is now assigned to ${name?.name || name?.email || 'the new instructor'}. Both instructors were notified.`);
    } catch (err) {
      const ax = err as { response?: { data?: { error?: string } } };
      setError(ax?.response?.data?.error || 'The course was not reassigned.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="glass-scrim fixed inset-0 z-50 flex items-center justify-center p-4" role="presentation" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="reassign-title" className="card w-full max-w-lg !p-6" onClick={(e) => e.stopPropagation()} data-testid="reassign-dialog">
        <p className="page-kicker">Instructor handover</p>
        <h2 id="reassign-title" className="mt-2 font-display text-xl font-semibold text-ink">Reassign “{courseTitle}”</h2>
        <p className="mt-2 text-sm text-ink-muted">
          Currently: <span className="font-semibold text-ink">{info ? info.course.instructor || 'no instructor' : '…'}</span>.
          Students keep their enrollment, progress, quiz results, submissions and grades. The previous instructor loses access to this course.
        </p>
        <form onSubmit={save} className="mt-5 space-y-4">
          <label className="block">
            <span className="label">New instructor</span>
            <select className="input mt-1.5 w-full" value={target} onChange={(e) => setTarget(e.target.value)} required>
              <option value="">Choose an active instructor</option>
              {options.map((p) => <option key={p._id} value={p._id}>{p.name || p.email}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="label">Reason (recorded in the audit log)</span>
            <input className="input mt-1.5" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="For example: instructor on leave until March" required />
          </label>
          {error && <p className="notice notice-caution text-sm" role="alert">{error}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={!canSave}>{busy ? 'Reassigning…' : 'Reassign course'}</button>
          </div>
        </form>
        {info && info.history.length > 0 && (
          <details className="mt-5 text-sm">
            <summary className="cursor-pointer font-semibold text-ink">Assignment history ({info.history.length})</summary>
            <ol className="mt-2 space-y-2">
              {info.history.map((h, i) => (
                <li key={i} className="text-xs text-ink-muted">{h.at ? new Date(h.at).toLocaleString() : ''}: {h.from || 'none'} → <span className="text-ink">{h.to}</span> by {h.by}{h.reason ? ` (${h.reason})` : ''}</li>
              ))}
            </ol>
          </details>
        )}
      </div>
    </div>
  );
}
