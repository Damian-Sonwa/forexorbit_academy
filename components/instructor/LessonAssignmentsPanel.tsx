/**
 * Assignments of a lesson for its instructor (Phase 9): list them, add one, and open the grading
 * page. The existing assignment API decides who may do this.
 */

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';

type Row = { _id: string; title: string; dueDate: string | null; points: number };
const input = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white';

export default function LessonAssignmentsPanel({ courseId, lessonId }: { courseId: string; lessonId: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [title, setTitle] = useState('');
  const [instructions, setInstructions] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [points, setPoints] = useState('100');
  const [busy, setBusy] = useState(false);
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
        ...(dueDate ? { dueDate: new Date(dueDate).toISOString() } : {}),
      });
      setTitle('');
      setInstructions('');
      setDueDate('');
      await load();
    } catch (err) {
      const ax = err as { response?: { data?: { error?: string } } };
      setError(ax?.response?.data?.error || 'The assignment could not be added.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-3" data-testid="lesson-assignments-admin">
      {rows === null && !error && <p className="text-sm text-gray-500" role="status">Loading assignments…</p>}
      {rows && rows.length === 0 && <p className="text-sm text-gray-600 dark:text-gray-300">No assignments on this lesson yet.</p>}
      {rows && rows.length > 0 && (
        <ul className="divide-y divide-gray-200 text-sm dark:divide-gray-700">
          {rows.map((row) => (
            <li key={row._id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="min-w-0 break-words text-gray-900 dark:text-white">
                {row.title} <span className="text-xs text-gray-500">{row.points} points{row.dueDate ? ` · due ${new Date(row.dueDate).toLocaleString()}` : ''}</span>
              </span>
              <Link href={`/instructor/assignments/analytics/${row._id}`} className="font-semibold text-primary-600 hover:underline">Submissions and grading</Link>
            </li>
          ))}
        </ul>
      )}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="text-sm text-gray-700 dark:text-gray-300">Title
          <input className={input} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="text-sm text-gray-700 dark:text-gray-300">Points
          <input className={input} type="number" min={0} value={points} onChange={(e) => setPoints(e.target.value)} />
        </label>
        <label className="text-sm text-gray-700 sm:col-span-2 dark:text-gray-300">Instructions
          <textarea className={input} rows={3} value={instructions} onChange={(e) => setInstructions(e.target.value)} />
        </label>
        <label className="text-sm text-gray-700 dark:text-gray-300">Due (optional)
          <input className={input} type="datetime-local" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </label>
      </div>
      <button type="button" onClick={() => void add()} disabled={busy || !title.trim() || !instructions.trim()} className="min-h-[44px] w-full rounded-lg bg-primary-600 px-4 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50 sm:w-auto">
        {busy ? 'Adding…' : 'Add assignment'}
      </button>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    </section>
  );
}
