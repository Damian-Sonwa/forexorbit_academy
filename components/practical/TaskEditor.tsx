/**
 * The practical task editor (instructor). Used for generated drafts, manual tasks and edits. It
 * holds the definition the server validates (lib/practical-task-spec.js readTaskDefinition); the
 * checks here only guide. Grading defaults to automatic when nothing else is chosen.
 */

import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { AUTO_CHECKS, CATEGORIES, INSTRUMENT_IDS } from '@/lib/practical-task-spec';
import { MODE, pair } from './Common';
import type { AutoCheck, GradingMode, StaffTaskView, TaskDefinitionInput } from '@/lib/practical-tasks';

export type RubricRow = { kind: 'auto'; check: AutoCheck; points: number } | { kind: 'manual'; label: string; description: string; points: number };
export type EditorDraft = { definition: TaskDefinitionInput & { rubric: RubricRow[] }; courseId: string; lessonId: string; resources: Array<{ label: string; url: string }> };

/** Converts a stored task into the editor's draft. */
export function draftFromTask(t: StaffTaskView): EditorDraft {
  const { instruments: _i, dueAt: _d, ...requirements } = t.requirements;
  void _i; void _d;
  return {
    definition: {
      title: t.title, summary: t.summary, instructions: t.instructions, objectives: t.objectives, category: t.category, difficulty: t.difficulty, instruments: t.instruments,
      requirements,
      rubric: t.rubric.criteria.map((c) => (c.kind === 'auto' ? { kind: 'auto', check: c.check as AutoCheck, points: c.points } : { kind: 'manual', label: c.label, description: c.description, points: c.points })),
      gradingMode: t.gradingMode, maxAttempts: t.maxAttempts, dueAt: t.dueAt,
    },
    courseId: t.courseId || '', lessonId: t.lessonId || '', resources: t.resources,
  };
}

export function blankDraft(courseId = ''): EditorDraft {
  return {
    definition: {
      title: '', summary: '', instructions: '', objectives: [''], category: 'risk_reward', difficulty: 'beginner', instruments: ['EUR_USD'],
      requirements: { side: null, orderTypes: ['market', 'limit', 'stop'], minTrades: 1, maxTrades: 1, maxRiskPercent: '1', minRewardRisk: '1.5', minExplanationChars: 150, external: 'none', maxAttachments: 2, requireTakeProfit: true, requireClosed: false, simulator: true },
      rubric: [{ kind: 'auto', check: 'stop_loss_valid', points: 25 }, { kind: 'auto', check: 'risk_within_limit', points: 25 }, { kind: 'auto', check: 'reward_risk_min', points: 25 }, { kind: 'auto', check: 'explanation_given', points: 25 }],
      gradingMode: 'automatic', maxAttempts: 2, dueAt: null,
    },
    courseId, lessonId: '', resources: [],
  };
}

const toLocal = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');
const fromLocal = (v: string) => (v ? new Date(v).toISOString() : null);

function Card({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <fieldset className="card p-5 sm:p-6">
      <legend className="sr-only">{title}</legend>
      <h3 className="font-display text-base font-semibold text-ink">{title}</h3>
      {hint && <p className="mt-1 text-xs text-ink-muted">{hint}</p>}
      <div className="mt-4 space-y-4">{children}</div>
    </fieldset>
  );
}
function Field({ label, children, hint, error }: { label: string; children: React.ReactNode; hint?: string; error?: string | null }) {
  return (
    <label className="block min-w-0">
      <span className="label">{label}</span>
      <div className="mt-1.5">{children}</div>
      {hint && !error && <span className="mt-1 block text-xs text-ink-subtle">{hint}</span>}
      {error && <span className="mt-1 block text-xs font-medium text-down" role="alert">{error}</span>}
    </label>
  );
}

export default function TaskEditor({ draft, onChange, courses, errorField, lockedCourse = false }: { draft: EditorDraft; onChange: (d: EditorDraft) => void; courses: Array<{ id: string; title: string }>; errorField?: { field?: string; error: string } | null; lockedCourse?: boolean }) {
  const def = draft.definition;
  const req = def.requirements;
  const [lessons, setLessons] = useState<Array<{ _id: string; title: string }>>([]);
  const setDef = (patch: Partial<EditorDraft['definition']>) => onChange({ ...draft, definition: { ...def, ...patch } });
  const setReq = (patch: Partial<EditorDraft['definition']['requirements']>) => setDef({ requirements: { ...req, ...patch } });
  const errFor = (prefix: string) => (errorField && errorField.field && errorField.field.startsWith(prefix) ? errorField.error : null);
  const total = def.rubric.reduce((s, c) => s + (Number(c.points) || 0), 0);
  const hasManual = def.rubric.some((c) => c.kind === 'manual');
  const mode: GradingMode = def.gradingMode || 'automatic';

  useEffect(() => {
    let live = true;
    if (!draft.courseId) { setLessons([]); return undefined; }
    apiClient.get<Array<{ _id: string; title: string }>>(`/lessons?courseId=${draft.courseId}`).then((rows) => { if (live) setLessons(Array.isArray(rows) ? rows : []); }).catch(() => { if (live) setLessons([]); });
    return () => { live = false; };
  }, [draft.courseId]);

  const usedChecks = useMemo(() => new Set(def.rubric.filter((c) => c.kind === 'auto').map((c) => (c as { check: string }).check)), [def.rubric]);
  const setRow = (i: number, row: RubricRow) => setDef({ rubric: def.rubric.map((r, j) => (j === i ? row : r)) });

  return (
    <div className="space-y-5" data-testid="task-editor">
      <Card title="Details" hint="What the student reads first.">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Course" error={errFor('courseId')}>
            <select className="input w-full" value={draft.courseId} disabled={lockedCourse} onChange={(e) => onChange({ ...draft, courseId: e.target.value, lessonId: '' })}>
              <option value="">Choose a course</option>
              {courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </Field>
          <Field label="Lesson (optional)" error={errFor('lessonId')}>
            <select className="input w-full" value={draft.lessonId} onChange={(e) => onChange({ ...draft, lessonId: e.target.value })} disabled={!lessons.length}>
              <option value="">Not linked to a lesson</option>
              {lessons.map((l) => <option key={l._id} value={l._id}>{l.title}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Title" error={errFor('title')}><input className="input w-full" maxLength={140} value={def.title} onChange={(e) => setDef({ title: e.target.value })} /></Field>
        <Field label="Short description" error={errFor('summary')}><input className="input w-full" maxLength={400} value={def.summary} onChange={(e) => setDef({ summary: e.target.value })} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Category" error={errFor('category')}>
            <select className="input w-full" value={def.category} onChange={(e) => setDef({ category: e.target.value })}>
              {Object.entries(CATEGORIES).map(([id, c]) => <option key={id} value={id}>{c.label}</option>)}
            </select>
          </Field>
          <Field label="Difficulty">
            <select className="input w-full" value={def.difficulty} onChange={(e) => setDef({ difficulty: e.target.value as EditorDraft['definition']['difficulty'] })}>
              <option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option>
            </select>
          </Field>
        </div>
        <Field label="Instruments" error={errFor('instruments')}>
          <div className="flex flex-wrap gap-2">
            {INSTRUMENT_IDS.map((id) => {
              const on = def.instruments.includes(id);
              return <button key={id} type="button" aria-pressed={on} onClick={() => setDef({ instruments: on ? def.instruments.filter((x) => x !== id) : [...def.instruments, id] })} className={`min-h-[36px] rounded-full border px-3 text-sm font-medium ${on ? 'border-primary-500 bg-tint text-ink' : 'border-line text-ink-muted hover:text-ink'}`}>{pair(id)}</button>;
            })}
          </div>
        </Field>
      </Card>

      <Card title="Objectives and instructions" hint="Measurable objectives, then the steps. Use a blank line between paragraphs, '- ' for steps and **bold** for emphasis.">
        <div className="space-y-2">
          <span className="label">Learning objectives</span>
          {def.objectives.map((o, i) => (
            <div key={i} className="flex gap-2">
              <input className="input w-full" maxLength={240} value={o} onChange={(e) => setDef({ objectives: def.objectives.map((x, j) => (j === i ? e.target.value : x)) })} aria-label={`Objective ${i + 1}`} />
              <button type="button" className="icon-btn" onClick={() => setDef({ objectives: def.objectives.filter((_, j) => j !== i) })} disabled={def.objectives.length <= 1} aria-label={`Remove objective ${i + 1}`}><Trash2 className="h-4 w-4" aria-hidden /></button>
            </div>
          ))}
          {def.objectives.length < 6 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDef({ objectives: [...def.objectives, ''] })}><Plus className="h-4 w-4" aria-hidden />Add objective</button>}
          {errFor('objectives') && <p className="text-xs font-medium text-down">{errFor('objectives')}</p>}
        </div>
        <Field label="Instructions" error={errFor('instructions')}><textarea className="input min-h-[14rem] w-full font-mono text-[13px] leading-relaxed" maxLength={6000} value={def.instructions} onChange={(e) => setDef({ instructions: e.target.value })} /></Field>
      </Card>

      <Card title="Trading requirements" hint="What the student must do on the simulator. These rules are what the automatic checks measure.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Minimum trades" error={errFor('requirements.minTrades')}><input type="number" min={0} max={10} className="input w-full" value={req.minTrades ?? 1} onChange={(e) => setReq({ minTrades: Number(e.target.value) })} /></Field>
          <Field label="Maximum trades"><input type="number" min={0} max={10} className="input w-full" value={req.maxTrades ?? 1} onChange={(e) => setReq({ maxTrades: Number(e.target.value) })} /></Field>
          <Field label="Max risk per trade (%)" hint="0.1 to 2" error={errFor('requirements.maxRiskPercent')}><input className="input w-full" inputMode="decimal" value={req.maxRiskPercent ?? ''} onChange={(e) => setReq({ maxRiskPercent: e.target.value })} /></Field>
          <Field label="Min reward : risk" hint="e.g. 2 for 2 : 1" error={errFor('requirements.minRewardRisk')}><input className="input w-full" inputMode="decimal" value={req.minRewardRisk ?? ''} onChange={(e) => setReq({ minRewardRisk: e.target.value })} /></Field>
          <Field label="Direction">
            <select className="input w-full" value={req.side || ''} onChange={(e) => setReq({ side: (e.target.value || null) as 'buy' | 'sell' | null })}><option value="">Student decides</option><option value="buy">Buy only</option><option value="sell">Sell only</option></select>
          </Field>
          <Field label="Explanation (min characters)" error={errFor('requirements.minExplanationChars')}><input type="number" min={0} max={3000} className="input w-full" value={req.minExplanationChars ?? 150} onChange={(e) => setReq({ minExplanationChars: Number(e.target.value) })} /></Field>
          <Field label="External broker evidence" error={errFor('requirements.maxAttachments')}>
            <select className="input w-full" value={req.external || 'none'} onChange={(e) => setReq({ external: e.target.value as 'none' | 'optional' | 'required' })}><option value="none">Not used</option><option value="optional">Optional</option><option value="required">Required</option></select>
          </Field>
          <Field label="Attachments allowed"><input type="number" min={0} max={6} className="input w-full" value={req.maxAttachments ?? 2} onChange={(e) => setReq({ maxAttachments: Number(e.target.value) })} /></Field>
        </div>
        <div>
          <span className="label">Allowed order types</span>
          <div className="mt-1.5 flex flex-wrap gap-4">
            {(['market', 'limit', 'stop'] as const).map((t) => (
              <label key={t} className="inline-flex items-center gap-2 text-sm capitalize text-ink"><input type="checkbox" className="h-4 w-4 accent-[var(--fo-brand)]" checked={(req.orderTypes || []).includes(t)} onChange={(e) => setReq({ orderTypes: e.target.checked ? [...(req.orderTypes || []), t] : (req.orderTypes || []).filter((x) => x !== t) })} />{t}</label>
            ))}
          </div>
          {errFor('requirements.orderTypes') && <p className="mt-1 text-xs font-medium text-down">{errFor('requirements.orderTypes')}</p>}
        </div>
      </Card>

      <Card title="Rubric" hint="System-checked criteria are scored from the frozen simulator evidence. Instructor-judged criteria need manual or system-assisted grading. Profit is never scored unless you add it deliberately.">
        <ul className="space-y-3">
          {def.rubric.map((row, i) => (
            <li key={i} className="rounded-xl border border-line bg-surface-2 p-3">
              <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)_6rem_auto] sm:items-start">
                <select className="input w-full" value={row.kind} aria-label={`Criterion ${i + 1} type`} onChange={(e) => setRow(i, e.target.value === 'auto' ? { kind: 'auto', check: (Object.keys(AUTO_CHECKS) as AutoCheck[]).find((c) => !usedChecks.has(c)) || 'explanation_given', points: row.points } : { kind: 'manual', label: '', description: '', points: row.points })}>
                  <option value="auto">System-checked</option><option value="manual">Instructor-judged</option>
                </select>
                {row.kind === 'auto' ? (
                  <div className="min-w-0">
                    <select className="input w-full" value={row.check} aria-label={`Criterion ${i + 1} check`} onChange={(e) => setRow(i, { ...row, check: e.target.value as AutoCheck })}>
                      {(Object.keys(AUTO_CHECKS) as AutoCheck[]).map((c) => <option key={c} value={c} disabled={c !== row.check && usedChecks.has(c)}>{AUTO_CHECKS[c].label}{c === 'net_result_positive' ? ' (P&L objectives only)' : ''}</option>)}
                    </select>
                    <p className="mt-1 text-xs text-ink-muted">{AUTO_CHECKS[row.check].describe({ ...req, instruments: def.instruments, dueAt: def.dueAt })}</p>
                  </div>
                ) : (
                  <div className="min-w-0 space-y-2">
                    <input className="input w-full" placeholder="Criterion name" maxLength={120} value={row.label} onChange={(e) => setRow(i, { ...row, label: e.target.value })} aria-label={`Criterion ${i + 1} name`} />
                    <input className="input w-full" placeholder="What earns full marks" maxLength={400} value={row.description} onChange={(e) => setRow(i, { ...row, description: e.target.value })} aria-label={`Criterion ${i + 1} description`} />
                  </div>
                )}
                <input type="number" min={1} max={100} className="input w-full num" value={row.points} onChange={(e) => setRow(i, { ...row, points: Number(e.target.value) })} aria-label={`Criterion ${i + 1} points`} />
                <button type="button" className="icon-btn" onClick={() => setDef({ rubric: def.rubric.filter((_, j) => j !== i) })} disabled={def.rubric.length <= 1} aria-label={`Remove criterion ${i + 1}`}><Trash2 className="h-4 w-4" aria-hidden /></button>
              </div>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center justify-between gap-3">
          {def.rubric.length < 12 && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDef({ rubric: [...def.rubric, { kind: 'manual', label: '', description: '', points: 10 }] })}><Plus className="h-4 w-4" aria-hidden />Add criterion</button>}
          <span className="text-sm font-semibold text-ink num">Maximum score: {total}</span>
        </div>
        {errFor('rubric') && <p className="text-xs font-medium text-down" role="alert">{errFor('rubric')}</p>}
      </Card>

      <Card title="Grading method" hint="Fixed for each attempt when the student starts it: a later change never alters existing attempts or grades.">
        <div className="grid gap-3 md:grid-cols-3" role="radiogroup" aria-label="Grading method">
          {(Object.keys(MODE) as GradingMode[]).map((m) => {
            const Icon = MODE[m].icon;
            const blocked = m === 'automatic' && (hasManual || req.external === 'required');
            const on = mode === m;
            return (
              <button key={m} type="button" role="radio" aria-checked={on} disabled={blocked} onClick={() => setDef({ gradingMode: m })} className={`flex h-full flex-col items-start gap-2 rounded-xl border p-4 text-left transition-colors ${on ? 'border-primary-500 bg-tint' : 'border-line hover:border-line-strong'} ${blocked ? 'cursor-not-allowed opacity-50' : ''}`} data-testid={`mode-${m}`}>
                <span className="flex w-full items-center justify-between gap-2"><span className="inline-flex items-center gap-2 text-sm font-semibold text-ink"><Icon className="h-4 w-4 text-primary-500" aria-hidden />{MODE[m].label}</span>{m === 'automatic' && <span className="chip">Default</span>}</span>
                <span className="text-xs text-ink-muted">{MODE[m].help}</span>
                {blocked && <span className="text-xs font-medium text-caution">{hasManual ? 'Not available: the rubric has instructor-judged criteria.' : 'Not available: external screenshots cannot be verified automatically.'}</span>}
              </button>
            );
          })}
        </div>
        {errFor('gradingMode') && <p className="text-xs font-medium text-down" role="alert">{errFor('gradingMode')}</p>}
      </Card>

      <Card title="Schedule and attempts">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Deadline" hint="Optional. At least 15 minutes from now." error={errFor('dueAt')}><input type="datetime-local" className="input w-full" value={toLocal(def.dueAt)} onChange={(e) => setDef({ dueAt: fromLocal(e.target.value) })} /></Field>
          <Field label="Attempts allowed" hint="1 to 5. Returning work for revision always allows one more." error={errFor('maxAttempts')}><input type="number" min={1} max={5} className="input w-full" value={def.maxAttempts} onChange={(e) => setDef({ maxAttempts: Number(e.target.value) })} /></Field>
        </div>
        <div className="space-y-2">
          <span className="label">Resources (links)</span>
          {draft.resources.map((r, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto]">
              <input className="input w-full" placeholder="Name" value={r.label} onChange={(e) => onChange({ ...draft, resources: draft.resources.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} aria-label={`Resource ${i + 1} name`} />
              <input className="input w-full" placeholder="https://" value={r.url} onChange={(e) => onChange({ ...draft, resources: draft.resources.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) })} aria-label={`Resource ${i + 1} link`} />
              <button type="button" className="icon-btn" onClick={() => onChange({ ...draft, resources: draft.resources.filter((_, j) => j !== i) })} aria-label={`Remove resource ${i + 1}`}><Trash2 className="h-4 w-4" aria-hidden /></button>
            </div>
          ))}
          {draft.resources.length < 8 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange({ ...draft, resources: [...draft.resources, { label: '', url: '' }] })}><Plus className="h-4 w-4" aria-hidden />Add resource</button>}
          {errFor('resources') && <p className="text-xs font-medium text-down">{errFor('resources')}</p>}
        </div>
      </Card>
    </div>
  );
}
