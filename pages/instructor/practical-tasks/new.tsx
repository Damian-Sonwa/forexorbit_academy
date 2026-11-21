/**
 * New practical task: a guided wizard (instructors).
 *   1 Method    generate from a template, or build by hand; choose the course.
 *   2 Settings  generator settings (category, level, instruments, direction, grading, evidence).
 *   3 Edit      the full editor; every generated field is editable.
 *   4 Preview   the server's own validation and the student's view; save as draft.
 * Nothing is published here: assigning students happens on the task page, with a confirmation.
 */

import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, PenLine, Sparkles } from 'lucide-react';
import PortalShell from '@/components/instructor/portal/PortalShell';
import TaskEditor, { blankDraft, type EditorDraft, type RubricRow } from '@/components/practical/TaskEditor';
import TaskPreview from '@/components/practical/TaskPreview';
import { MODE, pair } from '@/components/practical/Common';
import { ErrorState } from '@/components/student/dashboard/Panels';
import { usePortalResource } from '@/hooks/usePortalResource';
import { apiClient } from '@/lib/api-client';
import { CATEGORIES, INSTRUMENT_IDS } from '@/lib/practical-task-spec';
import type { Block, GradingMode, StaffTaskList, StaffTaskView, TaskDefinitionInput } from '@/lib/practical-tasks';

type Step = 1 | 2 | 3 | 4;
type Gen = { category: string; difficulty: string; instruments: string[]; side: string; gradingMode: GradingMode; external: string; trades: number; maxRiskPercent: string; minRewardRisk: string; maxAttempts: number; seed: number };
const failure = (err: unknown) => (err as { response?: { data?: { error?: string; field?: string } } })?.response?.data || { error: 'Something went wrong. Try again.' };
const STEPS = ['Method', 'Settings', 'Edit', 'Preview'];

export default function NewPracticalTask() {
  const router = useRouter();
  const scope = usePortalResource<StaffTaskList>('/practical-tasks?limit=1');
  const courses = useMemo(() => scope.data?.courses || [], [scope.data]);
  const [step, setStep] = useState<Step>(1);
  const [method, setMethod] = useState<'generate' | 'manual'>('generate');
  const [courseId, setCourseId] = useState('');
  const [gen, setGen] = useState<Gen>({ category: 'risk_reward', difficulty: 'beginner', instruments: ['EUR_USD'], side: '', gradingMode: 'automatic', external: 'none', trades: 1, maxRiskPercent: '1', minRewardRisk: '2', maxAttempts: 2, seed: 1 });
  const [draft, setDraft] = useState<EditorDraft>(blankDraft());
  const [notice, setNotice] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ field?: string; error: string } | null>(null);
  const [preview, setPreview] = useState<{ task: StaffTaskView; blocks: Block[] } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (!courseId && courses.length === 1) setCourseId(courses[0].id); }, [courses, courseId]);
  useEffect(() => { if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' }); }, [step]);

  const generate = async (seed = gen.seed) => {
    setBusy(true); setProblem(null);
    try {
      const res = await apiClient.post<{ draft: TaskDefinitionInput; notice: string | null; generator: Record<string, unknown> }>('/practical-tasks/generate', { ...gen, seed, side: gen.side || null });
      setDraft({ definition: { ...res.draft, rubric: res.draft.rubric as RubricRow[] }, courseId, lessonId: '', resources: [] });
      setNotice(res.notice);
      setGen({ ...gen, seed });
      setStep(3);
    } catch (err) {
      setProblem(failure(err) as { error: string });
    } finally { setBusy(false); }
  };

  const toPreview = async () => {
    setBusy(true); setProblem(null);
    try {
      const res = await apiClient.post<{ task: StaffTaskView; blocks: Block[] }>('/practical-tasks/preview', { definition: draft.definition });
      setPreview(res);
      setStep(4);
    } catch (err) {
      setProblem(failure(err) as { error: string });
    } finally { setBusy(false); }
  };

  const save = async () => {
    setBusy(true); setProblem(null);
    try {
      const body = { definition: draft.definition, courseId: draft.courseId, lessonId: draft.lessonId || null, resources: draft.resources.filter((r) => r.label || r.url), generator: method === 'generate' ? { category: gen.category, seed: String(gen.seed) } : null };
      const res = await apiClient.post<{ task: StaffTaskView }>('/practical-tasks', body);
      void router.push(`/instructor/practical-tasks/${res.task.id}?created=1`);
    } catch (err) {
      const f = failure(err) as { error: string; field?: string };
      setProblem(f);
      if (f.field) setStep(3);
    } finally { setBusy(false); }
  };

  const next = () => {
    if (step === 1) {
      if (!courseId) { setProblem({ field: 'courseId', error: 'Choose the course this task belongs to.' }); return; }
      setProblem(null);
      if (method === 'manual') { setDraft(blankDraft(courseId)); setNotice(null); setStep(3); } else setStep(2);
    } else if (step === 2) void generate();
    else if (step === 3) void toPreview();
    else void save();
  };
  const back = () => { setProblem(null); setStep(step === 3 && method === 'manual' ? 1 : ((step - 1) as Step)); };

  return (
    <PortalShell title="New practical task" lede="Design a trading assessment: what the student does on the simulator, how it is graded, and what earns the marks.">
      {scope.error && <ErrorState text={scope.error} onRetry={() => void scope.reload()} />}
      <ol className="mb-6 grid grid-cols-4 gap-2" aria-label="Steps">
        {STEPS.map((label, i) => {
          const n = i + 1;
          const skipped = method === 'manual' && n === 2;
          return (
            <li key={label} className={`rounded-xl border px-3 py-2.5 ${n === step ? 'border-primary-500 bg-tint' : 'border-line'} ${skipped ? 'opacity-40' : ''}`} aria-current={n === step ? 'step' : undefined}>
              <span className="block text-2xs font-semibold uppercase tracking-wide text-ink-subtle num">Step {n}</span>
              <span className="block truncate text-sm font-medium text-ink">{label}</span>
            </li>
          );
        })}
      </ol>

      {step === 1 && (
        <div className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2" role="radiogroup" aria-label="Creation method">
            {([['generate', Sparkles, 'Generate from a template', 'Pick a skill, level and instrument. The system writes a specific, measurable task with a rubric, built on the simulated market. You edit everything before saving.'], ['manual', PenLine, 'Build it yourself', 'Start from a blank structured editor: objectives, instructions, trading requirements, rubric and grading method.']] as const).map(([id, Icon, title, text]) => (
              <button key={id} type="button" role="radio" aria-checked={method === id} onClick={() => setMethod(id)} className={`card flex flex-col items-start gap-3 p-5 text-left transition-colors ${method === id ? '!border-primary-500 ring-1 ring-primary-500' : ''}`}>
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-tint text-primary-500"><Icon className="h-5 w-5" aria-hidden /></span>
                <span className="font-display text-base font-semibold text-ink">{title}</span>
                <span className="text-sm text-ink-muted">{text}</span>
              </button>
            ))}
          </div>
          <label className="card block p-5">
            <span className="label">Course</span>
            <select className="input mt-1.5 w-full md:max-w-md" value={courseId} onChange={(e) => setCourseId(e.target.value)}>
              <option value="">Choose a course</option>
              {courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
            <span className="mt-1 block text-xs text-ink-subtle">Only students actively enrolled in this course can receive the task.</span>
          </label>
        </div>
      )}

      {step === 2 && (
        <div className="card space-y-5 p-5 sm:p-6">
          <div>
            <span className="label">Skill to assess</span>
            <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {Object.entries(CATEGORIES).map(([id, c]) => (
                <button key={id} type="button" aria-pressed={gen.category === id} onClick={() => setGen({ ...gen, category: id, trades: ['multi_trade', 'journal_evaluation'].includes(id) ? 3 : 1 })} className={`min-h-[44px] rounded-xl border px-3 py-2 text-left text-sm ${gen.category === id ? 'border-primary-500 bg-tint font-semibold text-ink' : 'border-line text-ink-muted hover:text-ink'}`}>{c.label}</button>
              ))}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block"><span className="label">Level</span><select className="input mt-1.5 w-full" value={gen.difficulty} onChange={(e) => setGen({ ...gen, difficulty: e.target.value })}><option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option></select></label>
            <label className="block"><span className="label">Direction</span><select className="input mt-1.5 w-full" value={gen.side} onChange={(e) => setGen({ ...gen, side: e.target.value })}><option value="">Student decides</option><option value="buy">Buy</option><option value="sell">Sell</option></select></label>
            <label className="block"><span className="label">Trades</span><input type="number" min={1} max={10} className="input mt-1.5 w-full" value={gen.trades} onChange={(e) => setGen({ ...gen, trades: Number(e.target.value) })} /></label>
            <label className="block"><span className="label">Attempts</span><input type="number" min={1} max={5} className="input mt-1.5 w-full" value={gen.maxAttempts} onChange={(e) => setGen({ ...gen, maxAttempts: Number(e.target.value) })} /></label>
            <label className="block"><span className="label">Max risk per trade (%)</span><input className="input mt-1.5 w-full" inputMode="decimal" value={gen.maxRiskPercent} onChange={(e) => setGen({ ...gen, maxRiskPercent: e.target.value })} /></label>
            <label className="block"><span className="label">Min reward : risk</span><input className="input mt-1.5 w-full" inputMode="decimal" value={gen.minRewardRisk} onChange={(e) => setGen({ ...gen, minRewardRisk: e.target.value })} /></label>
            <label className="block"><span className="label">External broker evidence</span><select className="input mt-1.5 w-full" value={gen.external} onChange={(e) => setGen({ ...gen, external: e.target.value })}><option value="none">Not used</option><option value="optional">Optional</option><option value="required">Required</option></select></label>
            <label className="block"><span className="label">Grading</span><select className="input mt-1.5 w-full" value={gen.gradingMode} onChange={(e) => setGen({ ...gen, gradingMode: e.target.value as GradingMode })}>{(Object.keys(MODE) as GradingMode[]).map((m) => <option key={m} value={m}>{MODE[m].label}{m === 'automatic' ? ' (default)' : ''}</option>)}</select></label>
          </div>
          <div>
            <span className="label">Instruments</span>
            <div className="mt-2 flex flex-wrap gap-2">
              {INSTRUMENT_IDS.map((id) => {
                const on = gen.instruments.includes(id);
                return <button key={id} type="button" aria-pressed={on} onClick={() => setGen({ ...gen, instruments: on ? gen.instruments.filter((x) => x !== id) : [...gen.instruments, id] })} className={`min-h-[36px] rounded-full border px-3 text-sm font-medium ${on ? 'border-primary-500 bg-tint text-ink' : 'border-line text-ink-muted hover:text-ink'}`}>{pair(id)}</button>;
              })}
            </div>
          </div>
          <p className="text-xs text-ink-muted">{MODE[gen.gradingMode].help} The generator uses fixed templates (no external AI service) and the simulated market; the same settings always give the same task.</p>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          {notice && <p className="notice notice-brand text-sm">{notice}</p>}
          {method === 'generate' && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm">
              <span className="text-ink-muted">Generated from the <span className="font-medium text-ink">{CATEGORIES[gen.category]?.label}</span> template. Edit anything below.</span>
              <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void generate(gen.seed + 1)}><Sparkles className="h-4 w-4" aria-hidden />Another variant</button>
            </div>
          )}
          <TaskEditor draft={draft} onChange={setDraft} courses={courses} errorField={problem} />
        </div>
      )}

      {step === 4 && preview && (
        <div className="space-y-4">
          <p className="notice notice-brand text-sm">This is what students will see. Saving creates a draft; you assign students from the task page, where the grading method is confirmed before publishing.</p>
          <TaskPreview task={preview.task} blocks={preview.blocks} />
        </div>
      )}

      {problem && <p className="notice notice-caution mt-4 text-sm" role="alert">{problem.error}</p>}

      <div className="sticky bottom-0 z-10 -mx-4 mt-6 flex items-center justify-between gap-3 border-t border-line bg-[var(--fo-bg)]/90 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:border">
        <button type="button" className="btn btn-ghost" onClick={step === 1 ? () => void router.push('/instructor/practical-tasks') : back}><ArrowLeft className="h-4 w-4" aria-hidden />{step === 1 ? 'Cancel' : 'Back'}</button>
        <button type="button" className="btn btn-primary" onClick={next} disabled={busy} data-testid="wizard-next">
          {busy ? 'Working…' : step === 1 ? 'Continue' : step === 2 ? 'Generate task' : step === 3 ? 'Preview' : 'Save draft'}
          {!busy && <ArrowRight className="h-4 w-4" aria-hidden />}
        </button>
      </div>
    </PortalShell>
  );
}
