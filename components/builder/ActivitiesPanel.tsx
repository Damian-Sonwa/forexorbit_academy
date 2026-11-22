/**
 * Learning activities attached to a lesson, configured through their own services:
 *   quiz             PUT /api/quizzes/:lessonId (Phase 9 validation, versions, attempt rules)
 *   assignments      POST /api/assignments (Phase 12 rules); grading stays in the instructor portal
 *   practical tasks  the existing task creator and review pages (never duplicated here)
 * Nothing here creates attempts, submissions, progress or notifications.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ClipboardCheck, ExternalLink, LineChart, ListChecks, Plus, Trash2 } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import type { BuilderLesson } from '@/lib/course-curriculum';

type Question = { id?: string; question: string; options: string[]; correctAnswer: number; points: number; explanation?: string };
type QuizSettings = { status: 'draft' | 'published'; maxAttempts: number | null; passingPercent: number | null; timeLimitMinutes: number | null };

function errorText(err: unknown, fallback: string) {
  return (err as { response?: { data?: { error?: string } } })?.response?.data?.error || fallback;
}

function Section({ Icon, title, hint, children, action }: { Icon: typeof ListChecks; title: string; hint: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-surface-1">
      <header className="flex flex-wrap items-center gap-3 px-4 py-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-500/10 text-primary-600 dark:text-primary-400"><Icon className="h-4 w-4" aria-hidden /></span>
        <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-ink">{title}</span><span className="block text-xs text-ink-subtle">{hint}</span></span>
        {action}
      </header>
      {children && <div className="border-t border-line px-4 py-4">{children}</div>}
    </section>
  );
}

function QuizEditor({ lessonId, editable, onSaved }: { lessonId: string; editable: boolean; onSaved: (summary: { questions: number; status: string }) => void }) {
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [settings, setSettings] = useState<QuizSettings>({ status: 'draft', maxAttempts: null, passingPercent: 70, timeLimitMinutes: null });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let alive = true;
    apiClient.get<{ questions: Question[]; settings: QuizSettings }>(`/quizzes/${lessonId}`)
      .then((q) => { if (!alive) return; setQuestions(q.questions && q.questions.length ? q.questions : []); if (q.settings) setSettings({ status: q.settings.status, maxAttempts: q.settings.maxAttempts ?? null, passingPercent: q.settings.passingPercent ?? null, timeLimitMinutes: q.settings.timeLimitMinutes ?? null }); })
      .catch(() => { if (alive) setQuestions([]); });
    return () => { alive = false; };
  }, [lessonId]);

  if (questions === null) return <div className="h-24 animate-pulse rounded-xl bg-surface-2" />;
  const set = (i: number, q: Partial<Question>) => setQuestions(questions.map((x, j) => (j === i ? { ...x, ...q } : x)));
  const save = async () => {
    setBusy(true); setNote(null);
    try {
      await apiClient.put(`/quizzes/${lessonId}`, { questions, settings: { status: settings.status, maxAttempts: settings.maxAttempts, passingPercent: settings.passingPercent, timeLimitMinutes: settings.timeLimitMinutes } });
      setNote({ ok: true, text: settings.status === 'published' ? 'Quiz saved. Students can take it.' : 'Quiz saved as a draft. Students cannot see it yet.' });
      onSaved({ questions: questions.length, status: settings.status });
    } catch (err) {
      setNote({ ok: false, text: errorText(err, 'The quiz could not be saved.') });
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4" data-testid="quiz-editor">
      {questions.length === 0 && <p className="text-sm text-ink-muted">No questions yet. Add a multiple-choice question to start.</p>}
      <ol className="space-y-4">
        {questions.map((q, i) => (
          <li key={q.id || i} className="rounded-xl border border-line p-3">
            <div className="flex items-start gap-2">
              <span className="mt-2 text-xs font-semibold text-ink-subtle num">{i + 1}.</span>
              <textarea className="input min-h-[3rem] flex-1" placeholder="Question" maxLength={1000} value={q.question} readOnly={!editable} onChange={(e) => set(i, { question: e.target.value })} aria-label={`Question ${i + 1}`} />
              {editable && <button type="button" className="rounded-lg p-2 text-ink-subtle hover:text-red-600" aria-label={`Delete question ${i + 1}`} onClick={() => setQuestions(questions.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" aria-hidden /></button>}
            </div>
            <fieldset className="mt-3 space-y-2 pl-5">
              <legend className="sr-only">Options for question {i + 1}; choose the correct one</legend>
              {q.options.map((o, oi) => (
                <div key={oi} className="flex items-center gap-2">
                  <input type="radio" name={`correct-${i}`} checked={q.correctAnswer === oi} disabled={!editable} onChange={() => set(i, { correctAnswer: oi })} aria-label={`Option ${oi + 1} is correct`} className="h-4 w-4 accent-[var(--fo-brand)]" />
                  <input className="input min-h-0 flex-1 py-1.5 text-sm" placeholder={`Option ${oi + 1}`} maxLength={300} value={o} readOnly={!editable} onChange={(e) => set(i, { options: q.options.map((x, k) => (k === oi ? e.target.value : x)) })} />
                  {editable && q.options.length > 2 && <button type="button" className="p-1 text-ink-subtle hover:text-ink" aria-label={`Remove option ${oi + 1}`} onClick={() => set(i, { options: q.options.filter((_, k) => k !== oi), correctAnswer: q.correctAnswer >= oi && q.correctAnswer > 0 ? q.correctAnswer - (q.correctAnswer === oi ? 0 : 1) : q.correctAnswer })}>×</button>}
                </div>
              ))}
              {editable && q.options.length < 6 && <button type="button" className="text-xs font-semibold text-primary-600 hover:underline dark:text-primary-400" onClick={() => set(i, { options: [...q.options, ''] })}>Add option</button>}
            </fieldset>
            <div className="mt-3 grid gap-2 pl-5 sm:grid-cols-[6rem_1fr]">
              <label className="text-xs text-ink-muted">Points<input type="number" min={1} max={100} className="input mt-1 min-h-0 w-full py-1.5" value={q.points} readOnly={!editable} onChange={(e) => set(i, { points: Math.max(1, Math.min(100, Math.round(Number(e.target.value) || 1))) })} /></label>
              <label className="text-xs text-ink-muted">Explanation shown at review (optional)<input className="input mt-1 min-h-0 w-full py-1.5" maxLength={2000} value={q.explanation || ''} readOnly={!editable} onChange={(e) => set(i, { explanation: e.target.value })} /></label>
            </div>
          </li>
        ))}
      </ol>
      {editable && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setQuestions([...questions, { question: '', options: ['', '', '', ''], correctAnswer: 0, points: 1 }])} data-testid="add-question"><Plus className="h-4 w-4" aria-hidden />Add question</button>}
      <div className="grid gap-3 border-t border-line pt-4 sm:grid-cols-3">
        <label className="text-xs text-ink-muted">Visibility
          <select className="input mt-1 w-full" value={settings.status} disabled={!editable} onChange={(e) => setSettings({ ...settings, status: e.target.value === 'published' ? 'published' : 'draft' })}>
            <option value="draft">Draft (hidden from students)</option>
            <option value="published">Published</option>
          </select>
        </label>
        <label className="text-xs text-ink-muted">Pass mark (%)
          <input type="number" min={0} max={100} className="input mt-1 w-full" value={settings.passingPercent ?? ''} readOnly={!editable} onChange={(e) => setSettings({ ...settings, passingPercent: e.target.value === '' ? null : Math.max(0, Math.min(100, Math.round(Number(e.target.value)))) })} />
        </label>
        <label className="text-xs text-ink-muted">Attempts allowed
          <input type="number" min={1} max={20} placeholder="Unlimited" className="input mt-1 w-full" value={settings.maxAttempts ?? ''} readOnly={!editable} onChange={(e) => setSettings({ ...settings, maxAttempts: e.target.value === '' ? null : Math.max(1, Math.min(20, Math.round(Number(e.target.value)))) })} />
        </label>
      </div>
      {note && <p className={`text-sm ${note.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-600'}`} role={note.ok ? 'status' : 'alert'}>{note.text}</p>}
      {editable && <button type="button" className="btn btn-primary btn-sm" onClick={() => void save()} disabled={busy || questions.length === 0} data-testid="save-quiz">{busy ? 'Saving…' : 'Save quiz'}</button>}
    </div>
  );
}

function AssignmentForm({ courseId, lessonId, onCreated, onCancel }: { courseId: string; lessonId: string; onCreated: () => void; onCancel: () => void }) {
  const [form, setForm] = useState({ title: '', instructions: '', points: 100, dueDate: '', status: 'published' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await apiClient.post('/assignments', { courseId, lessonId, title: form.title, instructions: form.instructions, description: form.instructions, points: form.points, dueDate: form.dueDate ? new Date(form.dueDate).toISOString() : null, status: form.status });
      onCreated();
    } catch (err) {
      setError(errorText(err, 'The assignment could not be created.'));
    } finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="space-y-3" data-testid="assignment-form">
      <input className="input w-full" placeholder="Assignment title" required maxLength={200} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} aria-label="Assignment title" />
      <textarea className="input min-h-[5rem] w-full" placeholder="What students must submit" required maxLength={5000} value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} aria-label="Instructions" />
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-xs text-ink-muted">Points<input type="number" min={0} max={1000} className="input mt-1 w-full" value={form.points} onChange={(e) => setForm({ ...form, points: Math.max(0, Number(e.target.value) || 0) })} /></label>
        <label className="text-xs text-ink-muted">Due (optional)<input type="datetime-local" className="input mt-1 w-full" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} /></label>
        <label className="text-xs text-ink-muted">Visibility<select className="input mt-1 w-full" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}><option value="published">Published</option><option value="draft">Draft</option></select></label>
      </div>
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      <div className="flex gap-2"><button type="submit" className="btn btn-primary btn-sm" disabled={busy}>{busy ? 'Creating…' : 'Create assignment'}</button><button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button></div>
    </form>
  );
}

export default function ActivitiesPanel({ courseId, lesson, editable, onChanged, onQuizSaved }: { courseId: string; lesson: BuilderLesson; editable: boolean; onChanged: () => void; onQuizSaved: (s: { questions: number; status: string }) => void }) {
  const [quizOpen, setQuizOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  useEffect(() => { setQuizOpen(false); setAdding(false); }, [lesson.id]);
  const quizHint = lesson.quiz ? `${lesson.quiz.questions} question${lesson.quiz.questions === 1 ? '' : 's'} · ${lesson.quiz.status === 'published' ? 'published' : 'draft, hidden from students'}` : 'Optional. Students take it after reading; attempts and scores are recorded.';
  return (
    <div className="space-y-3" data-testid="activities-panel">
      <Section Icon={ListChecks} title="Quiz" hint={quizHint} action={<button type="button" className="btn btn-secondary btn-sm" onClick={() => setQuizOpen((v) => !v)} data-testid="toggle-quiz">{quizOpen ? 'Close' : lesson.quiz ? 'Edit quiz' : editable ? 'Add quiz' : 'View quiz'}</button>}>
        {quizOpen && <QuizEditor lessonId={lesson.id} editable={editable} onSaved={onQuizSaved} />}
      </Section>
      <Section Icon={ClipboardCheck} title="Assignments" hint={lesson.assignments.length ? `${lesson.assignments.length} attached to this lesson` : 'Written work students submit for grading.'}
        action={editable && !adding ? <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAdding(true)}><Plus className="h-4 w-4" aria-hidden />Add</button> : undefined}>
        {(lesson.assignments.length > 0 || adding) && (
          <div className="space-y-3">
            {lesson.assignments.length > 0 && (
              <ul className="divide-y divide-[var(--fo-line)]">
                {lesson.assignments.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-0 last:pb-0 text-sm">
                    <span className="text-ink">{a.title}</span>
                    <span className="text-xs text-ink-subtle">{a.points} pts · {a.status}</span>
                  </li>
                ))}
              </ul>
            )}
            {adding && <AssignmentForm courseId={courseId} lessonId={lesson.id} onCancel={() => setAdding(false)} onCreated={() => { setAdding(false); onChanged(); }} />}
            {lesson.assignments.length > 0 && <Link href="/instructor/grading" className="inline-flex items-center gap-1 text-xs font-semibold text-primary-600 hover:underline dark:text-primary-400">Grade submissions <ExternalLink className="h-3 w-3" aria-hidden /></Link>}
          </div>
        )}
      </Section>
      <Section Icon={LineChart} title="Practical trading tasks" hint={lesson.practicalTasks.length ? `${lesson.practicalTasks.length} linked to this lesson` : 'Simulated-market tasks graded by the system and/or you.'}
        action={<Link href={`/instructor/practical-tasks/new?courseId=${courseId}&lessonId=${lesson.id}`} className="btn btn-secondary btn-sm" target="_blank" rel="noopener noreferrer"><Plus className="h-4 w-4" aria-hidden />Create</Link>}>
        {lesson.practicalTasks.length > 0 && (
          <ul className="divide-y divide-[var(--fo-line)]">
            {lesson.practicalTasks.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-0 last:pb-0 text-sm">
                <Link href={`/instructor/practical-tasks/${t.id}`} className="text-ink hover:underline" target="_blank" rel="noopener noreferrer">{t.title}</Link>
                <span className="text-xs text-ink-subtle">{t.status}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
