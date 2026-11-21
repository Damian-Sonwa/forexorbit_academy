/**
 * Assignments of a lesson for its instructor (Phase 9): list them, add one, and open the grading
 * page. The existing assignment API decides who may do this.
 *
 * Phase 12: each assignment has a status. Draft is hidden from students; published accepts work;
 * closed stays visible but takes no new submissions. Status changes go through
 * PUT /api/assignments/:id (validated on the server); submissions and grades are never touched.
 */

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';

type Status = 'draft' | 'published' | 'closed';
type Row = { _id: string; title: string; dueDate: string | null; points: number; status?: Status };
const input = 'input';

const STATUS: Record<Status, { label: string; tone: string }> = {
  draft: { label: 'Draft', tone: '' },
  published: { label: 'Published', tone: 'chip-up' },
  closed: { label: 'Closed', tone: 'chip-down' },
};
/** The status changes offered from each status. */
export const NEXT_STATUS: Record<Status, Array<{ to: Status; label: string }>> = {
  draft: [{ to: 'published', label: 'Publish' }],
  published: [{ to: 'closed', label: 'Close' }, { to: 'draft', label: 'Back to draft' }],
  closed: [{ to: 'published', label: 'Reopen' }],
};

const errorText = (err: unknown, fallback: string) => {
  const ax = err as { response?: { data?: { error?: string } } };
  return ax?.response?.data?.error || fallback;
};

export default function LessonAssignmentsPanel({ courseId, lessonId }: { courseId: string; lessonId: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [title, setTitle] = useState('');
  const [instructions, setInstructions] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [points, setPoints] = useState('100');
  const [status, setStatus] = useState<Status>('published');
  const [busy, setBusy] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await apiClient.get<Row[]>(`/assignments?lessonId=${lessonId}`));
    } catch {
      setError('Assignments could not be loaded.');
    }
  }, [lessonId]);

  useEffect(() => { void load(); }, [load]);

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiClient.post('/assignments', {
        courseId,
        lessonId,
        title,
        instructions,
        points: Number(points),
        status,
        ...(dueDate ? { dueDate: new Date(dueDate).toISOString() } : {}),
      });
      setTitle('');
      setInstructions('');
      setDueDate('');
      await load();
    } catch (err) {
      setError(errorText(err, 'The assignment could not be added.'));
    } finally {
      setBusy(false);
    }
  };

  const changeStatus = async (row: Row, to: Status) => {
    setRowBusy(row._id);
    setError(null);
    try {
      await apiClient.put(`/assignments/${row._id}`, { status: to });
      await load();
    } catch (err) {
      setError(errorText(err, 'The status could not be changed.'));
    } finally {
      setRowBusy(null);
    }
  };

  return (
    <section className="space-y-3" data-testid="lesson-assignments-admin">
      {rows === null && !error && <p className="text-sm text-ink-muted" role="status">Loading assignments…</p>}
      {rows && rows.length === 0 && <p className="text-sm text-ink-muted">No assignments on this lesson yet.</p>}
      {rows && rows.length > 0 && (
        <ul className="divide-y divide-[var(--fo-line)] text-sm">
          {rows.map((row) => {
            const st: Status = row.status && row.status in STATUS ? row.status : 'published';
            return (
              <li key={row._id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <span className="min-w-0 break-words text-ink">
                  {row.title} <span className={`chip ml-1 ${STATUS[st].tone}`}>{STATUS[st].label}</span>
                  <span className="block text-xs text-ink-muted">{row.points} points{row.dueDate ? ` · due ${new Date(row.dueDate).toLocaleString()}` : ''}</span>
                </span>
                <span className="flex flex-wrap items-center gap-1.5">
                  {NEXT_STATUS[st].map((next) => (
                    <button key={next.to} type="button" className="btn btn-ghost btn-sm" disabled={rowBusy === row._id} onClick={() => void changeStatus(row, next.to)}>{next.label}</button>
                  ))}
                  <Link href={`/instructor/grading?assignmentId=${row._id}&courseId=${courseId}&status=all`} className="btn btn-secondary btn-sm">Submissions</Link>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="text-sm text-ink-muted">Title
          <input className={input} maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="text-sm text-ink-muted">Points
          <input className={input} type="number" min={0} max={1000} step={1} value={points} onChange={(e) => setPoints(e.target.value)} />
        </label>
        <label className="text-sm sm:col-span-2 text-ink-muted">Instructions
          <textarea className={input} rows={3} maxLength={10000} value={instructions} onChange={(e) => setInstructions(e.target.value)} />
        </label>
        <label className="text-sm text-ink-muted">Due (optional)
          <input className={input} type="datetime-local" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </label>
        <label className="text-sm text-ink-muted">Status
          <select className={input} value={status} onChange={(e) => setStatus(e.target.value as Status)}>
            <option value="published">Published: students can submit</option>
            <option value="draft">Draft: hidden from students</option>
          </select>
        </label>
      </div>
      <button type="button" onClick={() => void add()} disabled={busy || !title.trim() || !instructions.trim()} className="btn btn-primary min-h-[44px] w-full px-4 text-sm sm:w-auto">
        {busy ? 'Adding…' : 'Add assignment'}
      </button>
      {error && <p role="alert" className="text-sm text-down">{error}</p>}
    </section>
  );
}
