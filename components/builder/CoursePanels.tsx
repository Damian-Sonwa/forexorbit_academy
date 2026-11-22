/**
 * Course-level panels of the builder: details (autosaved, refused if someone else saved first),
 * the course's file library, and publishing (readiness checks and the lifecycle actions this
 * member may take; the server decides every change again).
 */

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, CircleDashed, ImagePlus, Plus, Trash2, X } from 'lucide-react';
import RichTextEditor from '@/components/RichTextEditor';
import { SaveIndicator } from '@/components/builder/LessonEditor';
import type { SaveStatus } from '@/components/builder/useLessonAutosave';
import { uploadWithProgress } from '@/components/builder/upload';
import { formatBytes } from '@/components/course/LessonBlocks';
import { apiClient } from '@/lib/api-client';
import type { BuilderAsset, BuilderCourse } from '@/lib/course-curriculum';
import type { ReadinessIssue } from '@/lib/course-content';

export const CATEGORIES = [
  ['basics', 'Basics'],
  ['technical', 'Technical Analysis'],
  ['trading', 'Trading Strategies'],
  ['fundamental', 'Fundamental Analysis'],
  ['risk', 'Risk Management'],
] as const;

export const STATUS_LABEL: Record<string, { label: string; tone: string; help: string }> = {
  draft: { label: 'Draft', tone: 'bg-surface-2 text-ink-muted', help: 'Only you and administrators can see it.' },
  in_review: { label: 'In review', tone: 'bg-sky-500/10 text-sky-700 dark:text-sky-300', help: 'Waiting for an administrator to publish it.' },
  published: { label: 'Published', tone: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300', help: 'In the catalogue and open for enrolment.' },
  archived: { label: 'Archived', tone: 'bg-amber-500/10 text-amber-700 dark:text-amber-300', help: 'Out of the catalogue; enrolled students keep access.' },
};

function errorText(err: unknown, fallback: string) {
  return (err as { response?: { data?: { error?: string } } })?.response?.data?.error || fallback;
}

type Details = Pick<BuilderCourse['course'], 'title' | 'summary' | 'description' | 'category' | 'difficulty' | 'thumbnail' | 'objectives' | 'prerequisites' | 'estimatedHours'>;

export function DetailsPanel({ course, editable, issues, onSaved, onConflict }: { course: BuilderCourse['course']; editable: boolean; issues: ReadinessIssue[]; onSaved: (d: Details, updatedAt: string) => void; onConflict: () => void }) {
  const pick = (c: BuilderCourse['course']): Details => ({ title: c.title, summary: c.summary, description: c.description, category: c.category, difficulty: c.difficulty, thumbnail: c.thumbnail, objectives: c.objectives.length ? c.objectives : [''], prerequisites: c.prerequisites, estimatedHours: c.estimatedHours });
  const [form, setForm] = useState<Details>(pick(course));
  const [status, setStatus] = useState<SaveStatus>('saved');
  const [message, setMessage] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const base = useRef<string | null>(course.updatedAt ? new Date(course.updatedAt).toISOString() : null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const formRef = useRef(form);
  const [cover, setCover] = useState<{ fraction: number; error?: string } | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const save = async () => {
    const snapshot = formRef.current;
    setStatus('saving');
    try {
      const body: Record<string, unknown> = { ...snapshot, objectives: snapshot.objectives.map((o) => o.trim()).filter(Boolean) };
      if (!body.category) delete body.category;
      if (!body.difficulty) delete body.difficulty;
      if (base.current) body.baseUpdatedAt = base.current;
      const res = await apiClient.put<{ updatedAt: string }>(`/courses/${course.id}`, body);
      base.current = res.updatedAt;
      setSavedAt(new Date());
      setMessage(null);
      onSaved(snapshot, res.updatedAt);
      setStatus(JSON.stringify(formRef.current) === JSON.stringify(snapshot) ? 'saved' : 'dirty');
    } catch (err) {
      const r = (err as { response?: { status?: number; data?: { code?: string } } })?.response;
      if (r?.status === 409 && r.data?.code === 'stale_course') { setStatus('conflict'); setMessage(errorText(err, 'Someone else saved the course details.')); }
      else if (r?.status && r.status < 500) { setStatus('invalid'); setMessage(errorText(err, 'This change could not be saved.')); }
      else { setStatus('retrying'); setMessage('Not saved yet. Retrying shortly.'); timer.current = setTimeout(() => void save(), 5000); }
    }
  };

  const change = (patch: Partial<Details>) => {
    const next = { ...formRef.current, ...patch };
    formRef.current = next;
    setForm(next);
    if (!editable) return;
    setStatus('dirty');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), 1500);
  };

  const uploadCover = (file: File) => {
    if (!file.type.startsWith('image/')) { setCover({ fraction: 0, error: 'Choose an image file.' }); return; }
    setCover({ fraction: 0 });
    uploadWithProgress('/api/upload/instructor', 'image', file, (fraction) => setCover({ fraction }))
      .promise.then((body) => { setCover(null); change({ thumbnail: String(body.url || body.imageUrl || body.secureUrl || '') }); })
      .catch((err: Error) => setCover({ fraction: 0, error: err.message }));
  };

  const issue = (field: string) => issues.find((i) => i.field === field);
  const FieldIssue = ({ field }: { field: string }) => { const i = issue(field); return i ? <span className={`mt-1 flex items-center gap-1 text-xs ${i.level === 'error' ? 'text-red-600' : 'text-amber-700 dark:text-amber-300'}`}><AlertTriangle className="h-3 w-3" aria-hidden />{i.message}</span> : null; };

  return (
    <div className="mx-auto max-w-3xl space-y-8" data-testid="details-panel">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-semibold text-ink">Course details</h2>
          <p className="text-sm text-ink-muted">What students see on the course page and in the catalogue. Only the title is needed to start; the rest is checked before review.</p>
        </div>
        <SaveIndicator status={status} savedAt={savedAt} onSave={() => void save()} />
      </div>
      {message && <div className={`notice ${status === 'conflict' || status === 'invalid' ? 'notice-caution' : 'notice-brand'} flex flex-wrap items-center gap-3 text-sm`} role="alert"><span className="flex-1">{message}</span>{status === 'conflict' && <button type="button" className="btn btn-secondary btn-sm" onClick={onConflict}>Load their changes</button>}</div>}

      <section className="space-y-4">
        <label className="block"><span className="label">Title</span>
          <input className="input mt-1.5 w-full" maxLength={200} value={form.title} readOnly={!editable} onChange={(e) => change({ title: e.target.value })} data-testid="course-title" />
          <FieldIssue field="title" />
        </label>
        <label className="block"><span className="label">Short description</span>
          <textarea className="input mt-1.5 min-h-[4rem] w-full" maxLength={300} placeholder="One or two sentences for the catalogue card." value={form.summary} readOnly={!editable} onChange={(e) => change({ summary: e.target.value })} data-testid="course-summary" />
          <span className="mt-1 block text-right text-xs text-ink-subtle num">{form.summary.length}/300</span>
          <FieldIssue field="summary" />
        </label>
        <div><span className="label">Full description</span>
          <div className="mt-1.5"><RichTextEditor value={form.description} onChange={(v) => change({ description: v })} disabled={!editable} height={220} placeholder="What the course covers and who it is for." /></div>
          <FieldIssue field="description" />
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        <label className="block"><span className="label">Category</span>
          <select className="input mt-1.5 w-full" value={form.category} disabled={!editable} onChange={(e) => change({ category: e.target.value })} data-testid="course-category">
            <option value="">Choose…</option>
            {CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            {form.category && !CATEGORIES.some(([v]) => v === form.category) && <option value={form.category}>{form.category}</option>}
          </select>
          <FieldIssue field="category" />
        </label>
        <label className="block"><span className="label">Difficulty</span>
          <select className="input mt-1.5 w-full" value={form.difficulty} disabled={!editable} onChange={(e) => change({ difficulty: e.target.value })} data-testid="course-difficulty">
            <option value="">Choose…</option><option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option>
          </select>
          <FieldIssue field="difficulty" />
        </label>
        <label className="block"><span className="label">Estimated hours</span>
          <input type="number" min={0} max={1000} step={0.5} className="input mt-1.5 w-full" value={form.estimatedHours ?? ''} readOnly={!editable} onChange={(e) => change({ estimatedHours: e.target.value === '' ? null : Number(e.target.value) })} />
        </label>
      </section>

      <section>
        <span className="label">Cover image</span>
        <div className="mt-1.5 flex flex-wrap items-center gap-4">
          <div className="flex aspect-[16/9] w-56 items-center justify-center overflow-hidden rounded-xl border border-line bg-surface-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {form.thumbnail ? <img src={form.thumbnail} alt="Course cover" className="h-full w-full object-cover" /> : <ImagePlus className="h-6 w-6 text-ink-subtle" aria-hidden />}
          </div>
          {editable && (
            <div className="space-y-2">
              <label className="btn btn-secondary btn-sm cursor-pointer">{form.thumbnail ? 'Replace image' : 'Upload image'}<input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) uploadCover(f); }} /></label>
              {form.thumbnail && <button type="button" className="btn btn-ghost btn-sm" onClick={() => change({ thumbnail: '' })}>Remove</button>}
              {cover && <p className={`text-xs ${cover.error ? 'text-red-600' : 'text-ink-subtle'}`} role={cover.error ? 'alert' : 'status'}>{cover.error || `Uploading… ${Math.round(cover.fraction * 100)}%`}</p>}
              <p className="text-xs text-ink-subtle">16:9, at least 1280×720. JPEG, PNG or WebP, up to 10 MB.</p>
            </div>
          )}
        </div>
        <FieldIssue field="thumbnail" />
      </section>

      <section>
        <span className="label">What students will learn</span>
        <ul className="mt-1.5 space-y-2" data-testid="objectives">
          {form.objectives.map((o, i) => (
            <li key={i} className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-primary-500" aria-hidden />
              <input className="input min-h-0 flex-1 py-2" maxLength={200} value={o} placeholder="e.g. Size a position from a fixed risk per trade" readOnly={!editable} onChange={(e) => change({ objectives: form.objectives.map((x, j) => (j === i ? e.target.value : x)) })} aria-label={`Objective ${i + 1}`} />
              {editable && <button type="button" className="p-1.5 text-ink-subtle hover:text-ink" aria-label={`Remove objective ${i + 1}`} onClick={() => change({ objectives: form.objectives.length > 1 ? form.objectives.filter((_, j) => j !== i) : [''] })}><X className="h-4 w-4" aria-hidden /></button>}
            </li>
          ))}
        </ul>
        {editable && form.objectives.length < 12 && <button type="button" className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-primary-600 hover:underline dark:text-primary-400" onClick={() => change({ objectives: [...form.objectives, ''] })}><Plus className="h-4 w-4" aria-hidden />Add objective</button>}
        <FieldIssue field="objectives" />
      </section>

      <label className="block"><span className="label">Prerequisites (optional)</span>
        <textarea className="input mt-1.5 min-h-[4rem] w-full" maxLength={1500} placeholder="What students should know first." value={form.prerequisites} readOnly={!editable} onChange={(e) => change({ prerequisites: e.target.value })} />
      </label>
    </div>
  );
}

export function FilesPanel({ courseId, assets, editable, onAdded, onRemoved }: { courseId: string; assets: BuilderAsset[]; editable: boolean; onAdded: (a: BuilderAsset) => void; onRemoved: (id: string) => void }) {
  const [upload, setUpload] = useState<{ name: string; fraction: number; error?: string; file?: File } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const start = (file: File) => {
    setUpload({ name: file.name, fraction: 0, file });
    uploadWithProgress(`/api/courses/${courseId}/assets`, 'file', file, (fraction) => setUpload((u) => (u ? { ...u, fraction } : u)))
      .promise.then((body) => { setUpload(null); onAdded(body.asset as BuilderAsset); })
      .catch((err: Error & { status?: number }) => setUpload(err.status === -1 ? null : { name: file.name, fraction: 0, error: err.message, file }));
  };
  const remove = async (a: BuilderAsset) => {
    if (!window.confirm(`Remove "${a.name}" from this course? It is deleted from storage and cannot be recovered.`)) return;
    setError(null);
    try { await apiClient.delete(`/courses/${courseId}/assets?assetId=${a.id}`); onRemoved(a.id); }
    catch (err) { setError(errorText(err, 'The file could not be removed.')); }
  };
  return (
    <div className="mx-auto max-w-3xl space-y-5" data-testid="files-panel">
      <div>
        <h2 className="font-display text-xl font-semibold text-ink">Course files</h2>
        <p className="text-sm text-ink-muted">Documents and videos uploaded to this course. They are stored privately: only people who can open the lesson that uses a file can download it. Add files to lessons with a File or Video block.</p>
      </div>
      {editable && (
        <label className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-line px-4 py-6 text-center hover:border-primary-500">
          <span className="text-sm font-semibold text-primary-600 dark:text-primary-400">Upload a file</span>
          <span className="text-xs text-ink-subtle">PDF, Word, Excel, PowerPoint, OpenDocument, CSV, text, ZIP (25 MB) or MP4/MOV/WebM video (100 MB)</span>
          <input type="file" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) start(f); }} />
        </label>
      )}
      {upload && (
        <div className={`rounded-xl border px-3 py-2.5 text-sm ${upload.error ? 'border-red-500/40' : 'border-line'}`} role={upload.error ? 'alert' : 'status'}>
          <div className="flex items-center justify-between gap-2"><span className="truncate">{upload.error || `Uploading ${upload.name}… ${Math.round(upload.fraction * 100)}%`}</span>
            {upload.error && <span className="flex gap-2"><button type="button" className="btn btn-secondary btn-sm" onClick={() => upload.file && start(upload.file)}>Retry</button><button type="button" className="btn btn-ghost btn-sm" onClick={() => setUpload(null)}>Dismiss</button></span>}</div>
        </div>
      )}
      {error && <p className="notice notice-caution text-sm" role="alert">{error}</p>}
      {assets.length === 0 ? <p className="text-sm text-ink-subtle">No files uploaded yet.</p> : (
        <ul className="divide-y divide-[var(--fo-line)] rounded-2xl border border-line bg-surface-1">
          {assets.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-ink">{a.name}</span><span className="text-xs text-ink-subtle">{a.kind} · {formatBytes(a.bytes)}{a.uploadedAt ? ` · ${new Date(a.uploadedAt).toLocaleDateString()}` : ''}</span></span>
              <a className="btn btn-ghost btn-sm" href={`/api/courses/${courseId}/assets?assetId=${a.id}`} target="_blank" rel="noopener noreferrer">Open</a>
              {editable && <button type="button" className="btn btn-ghost btn-sm text-red-600" onClick={() => void remove(a)} aria-label={`Remove ${a.name}`}><Trash2 className="h-4 w-4" aria-hidden /></button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const ACTIONS: Record<string, { label: string; question: string; primary?: boolean }> = {
  in_review: { label: 'Submit for review', question: 'Submit this course for review? You will not be able to edit it until an administrator returns it or you withdraw it.', primary: true },
  published: { label: 'Publish', question: 'Publish this course? It appears in the catalogue and students can enrol and buy it.', primary: true },
  draft: { label: 'Return to draft', question: 'Move the course back to draft? Students cannot see a draft.' },
  archived: { label: 'Archive', question: 'Archive this course? It leaves the catalogue and takes no new enrolments. Enrolled students keep their access, progress and certificates.' },
};

export function PublishPanel({ data, onIssue, onChanged }: { data: BuilderCourse; onIssue: (i: ReadinessIssue) => void; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const status = data.course.status;
  const r = data.readiness;
  const go = async (to: string) => {
    const action = ACTIONS[to];
    const label = data.course.status === 'in_review' && to === 'draft' ? 'Withdraw from review' : action.label;
    if (!window.confirm(action.question)) return;
    setBusy(to); setError(null);
    try { await apiClient.post(`/courses/${data.course.id}/status`, { status: to }); onChanged(); }
    catch (err) { setError(errorText(err, `${label} failed.`)); }
    finally { setBusy(null); }
  };
  const errors = r.issues.filter((i) => i.level === 'error');
  const warnings = r.issues.filter((i) => i.level === 'warning');
  return (
    <div className="mx-auto max-w-3xl space-y-6" data-testid="publish-panel">
      <div>
        <h2 className="font-display text-xl font-semibold text-ink">Publishing</h2>
        <p className="text-sm text-ink-muted">{STATUS_LABEL[status]?.help}</p>
      </div>
      <ol className="grid grid-cols-4 gap-2 text-center text-xs" aria-label="Course status">
        {['draft', 'in_review', 'published', 'archived'].map((s) => (
          <li key={s} className={`rounded-xl border px-2 py-2.5 font-semibold ${s === status ? 'border-primary-500 bg-primary-500/10 text-ink' : 'border-line text-ink-subtle'}`} aria-current={s === status ? 'step' : undefined}>{STATUS_LABEL[s].label}</li>
        ))}
      </ol>

      <section className="rounded-2xl border border-line bg-surface-1">
        <header className="flex items-center gap-3 border-b border-line px-4 py-3">
          {r.ready ? <CheckCircle2 className="h-5 w-5 text-emerald-600" aria-hidden /> : <CircleDashed className="h-5 w-5 text-amber-600" aria-hidden />}
          <span className="flex-1 text-sm font-semibold text-ink" data-testid="readiness-summary">{r.ready ? 'Ready for review and publishing' : `${errors.length} thing${errors.length === 1 ? '' : 's'} to fix before review`}</span>
          {warnings.length > 0 && <span className="text-xs text-ink-subtle">{warnings.length} suggestion{warnings.length === 1 ? '' : 's'}</span>}
        </header>
        {r.issues.length === 0 ? <p className="px-4 py-4 text-sm text-ink-muted">Everything students need is in place.</p> : (
          <ul className="divide-y divide-[var(--fo-line)]" data-testid="readiness-issues">
            {[...errors, ...warnings].map((i, n) => (
              <li key={n}>
                <button type="button" onClick={() => onIssue(i)} className="flex w-full items-start gap-3 px-4 py-3 text-left text-sm hover:bg-tint">
                  <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${i.level === 'error' ? 'text-red-600' : 'text-amber-600'}`} aria-hidden />
                  <span className="flex-1 text-ink">{i.message}</span>
                  <span className="text-xs font-semibold text-primary-600 dark:text-primary-400">Fix</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {error && <p className="notice notice-caution text-sm" role="alert">{error}</p>}
      <div className="flex flex-wrap gap-3">
        {data.permissions.transitions.length === 0 && <p className="text-sm text-ink-muted">{status === 'in_review' ? 'An administrator reviews and publishes the course.' : 'No status change is available to you here.'}</p>}
        {data.permissions.transitions.map((to) => {
          const a = ACTIONS[to];
          if (!a) return null;
          const needsReady = to === 'in_review' || (to === 'published' && status !== 'archived');
          const label = status === 'in_review' && to === 'draft' ? 'Withdraw from review' : status === 'archived' && to === 'published' ? 'Restore to catalogue' : a.label;
          return (
            <button key={to} type="button" className={`btn ${a.primary ? 'btn-primary' : 'btn-secondary'}`} disabled={busy !== null || (needsReady && !r.ready)} onClick={() => void go(to)} data-testid={`transition-${to}`} title={needsReady && !r.ready ? 'Fix the items above first' : undefined}>
              {busy === to ? 'Working…' : label}
            </button>
          );
        })}
      </div>
      {data.permissions.delete && (
        <section className="rounded-2xl border border-red-500/30 p-4" data-testid="delete-course">
          <h3 className="text-sm font-semibold text-ink">Delete permanently (Super Admin)</h3>
          <p className="mt-1 text-sm text-ink-muted">Only a course with no students, payments or certificates can be deleted, and it cannot be undone. To retire a live course, archive it instead.</p>
          <button type="button" className="btn btn-secondary btn-sm mt-3 text-red-600" disabled={busy !== null} onClick={async () => {
            if (window.prompt('Type the course title to delete it permanently.') !== data.course.title) return;
            setBusy('delete'); setError(null);
            try { await apiClient.delete(`/courses/${data.course.id}`); window.location.assign('/admin/courses'); }
            catch (err) { setError(errorText(err, 'The course could not be deleted.')); setBusy(null); }
          }}>Delete course</button>
        </section>
      )}
      <p className="text-xs text-ink-subtle">Editing a published course changes it for enrolled students straight away. Their progress, quiz attempts, submissions, grades and certificates are kept: they refer to lessons, which keep their identity when moved or edited.</p>
    </div>
  );
}
