/**
 * A practical trading task for the student: the brief, the workspace (simulator trades, explanation,
 * external evidence, review and submit) and results.
 *   GET  /api/practical-tasks/:id            task, state, attempts, eligible trades (own, this attempt)
 *   POST /api/practical-tasks/:id/attempt     start (idempotent);  PUT saves work in progress
 *   POST /api/practical-tasks/:id/evidence    upload a screenshot (private);  DELETE removes one
 *   POST /api/practical-tasks/:id/submit      submit (evidence frozen from the server's records)
 * The server decides everything (visibility, deadlines, attempts, evidence, grades); this page only
 * presents it. A 404 means the task is not assigned to this student.
 */

import Link from 'next/link';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ExternalLink, ImagePlus, LineChart, RefreshCw, Send, Trash2 } from 'lucide-react';
import Header from '@/components/Header';
import Sidebar from '@/components/Sidebar';
import Footer from '@/components/Footer';
import LoadingSpinner from '@/components/LoadingSpinner';
import { Disclosure, EmptyState, ErrorState } from '@/components/student/dashboard/Panels';
import { LessonSkeleton } from '@/components/loading';
import { formatDate } from '@/components/student/dashboard/format';
import { useAuth } from '@/hooks/useAuth';
import { usePortalResource } from '@/hooks/usePortalResource';
import { apiClient } from '@/lib/api-client';
import { ATTEMPT_STATUS, Chip, Deadline, DifficultyDots, ExternalDetails, Instructions, MODE, ModeBadge, ResultReport, RubricList, STUDENT_STATE, SimulatedNote, TradeTable, pair } from '@/components/practical/Common';
import type { AttemptView, ExternalEvidence, StudentTaskDetail } from '@/lib/practical-tasks';

const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : '');
const errorText = (err: unknown, fallback: string) => (err as { response?: { data?: { error?: string } } })?.response?.data?.error || fallback;
type ExternalForm = { broker: string; instrument: string; side: string; entry: string; exit: string; stopLoss: string; takeProfit: string; openedAt: string; closedAt: string; notes: string };
const EMPTY_EXTERNAL: ExternalForm = { broker: '', instrument: '', side: '', entry: '', exit: '', stopLoss: '', takeProfit: '', openedAt: '', closedAt: '', notes: '' };

function externalFrom(e: ExternalEvidence | null | undefined): ExternalForm {
  if (!e) return EMPTY_EXTERNAL;
  return { ...EMPTY_EXTERNAL, ...Object.fromEntries(Object.entries(e).filter(([k]) => k !== 'verified').map(([k, v]) => [k, k.endsWith('At') && v ? String(v).slice(0, 16) : String(v ?? '')])) } as ExternalForm;
}
function externalBody(f: ExternalForm) {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(f)) if (v.trim()) out[k] = k.endsWith('At') ? new Date(v).toISOString() : v.trim();
  return Object.keys(out).length ? out : null;
}

function Step({ n, title, done, children, hint }: { n: number; title: string; done?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <li className="relative pl-11">
      <span className={`absolute left-0 top-0 flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold num ${done ? 'bg-primary-500 text-neutral-950' : 'border border-line-strong bg-surface-1 text-ink-muted'}`} aria-hidden>{n}</span>
      <h3 className="pt-1 text-sm font-semibold text-ink">{title}</h3>
      {hint && <p className="mt-0.5 text-xs text-ink-muted">{hint}</p>}
      <div className="mt-3">{children}</div>
    </li>
  );
}

function Workspace({ detail, attempt, reload }: { detail: StudentTaskDetail; attempt: AttemptView; reload: () => Promise<void> }) {
  const task = detail.task;
  const req = task.requirements;
  const [selected, setSelected] = useState<string[]>(attempt.draft?.positionIds || []);
  const [explanation, setExplanation] = useState(attempt.draft?.explanation || '');
  const [external, setExternal] = useState<ExternalForm>(externalFrom(attempt.draft?.external));
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const first = useRef(true);

  // Saves the work in progress a moment after the student stops typing.
  useEffect(() => {
    if (first.current) { first.current = false; return undefined; }
    const timer = setTimeout(async () => {
      try {
        const res = await apiClient.put<{ savedAt: string }>(`/practical-tasks/${task.id}/attempt`, { positionIds: selected, explanation, external: externalBody(external) });
        setSaved(res.savedAt);
      } catch (err) {
        setError(errorText(err, 'Your work could not be saved. It is still on this page.'));
      }
    }, 900);
    return () => clearTimeout(timer);
  }, [selected, explanation, external, task.id]);

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= req.maxTrades ? s : [...s, id]));
  const upload = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const body = new FormData();
      body.append('file', file);
      body.append('name', file.name.slice(0, 120));
      await apiClient.post(`/practical-tasks/${task.id}/evidence`, body);
      await reload();
    } catch (err) {
      setError(errorText(err, 'The file could not be uploaded.'));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };
  const remove = async (fileId: string) => {
    try {
      await apiClient.delete(`/practical-tasks/${task.id}/evidence?file=${encodeURIComponent(fileId)}`);
      await reload();
    } catch (err) {
      setError(errorText(err, 'The file could not be removed.'));
    }
  };
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiClient.post(`/practical-tasks/${task.id}/submit`, { positionIds: selected, explanation, external: externalBody(external), confirm: true });
      await reload();
      if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setError(errorText(err, 'The submission was not accepted.'));
    } finally {
      setBusy(false);
    }
  };

  const tradesOk = !req.simulator || (selected.length >= req.minTrades && selected.length <= req.maxTrades);
  const explainOk = explanation.trim().length >= req.minExplanationChars;
  const filesOk = req.external !== 'required' || attempt.attachments.length > 0;
  const deskHref = `/student-dashboard?section=live&instrument=${encodeURIComponent(task.instruments[0] || 'EUR_USD')}&task=${task.id}`;
  let n = 0;

  return (
    <section className="card p-5 sm:p-6" aria-labelledby="workspace-title" data-testid="workspace">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="page-kicker">Attempt {attempt.attempt}{attempt.resubmission ? ' · resubmission' : ''}</p>
          <h2 id="workspace-title" className="section-title mt-2">Your workspace</h2>
        </div>
        <span className="text-xs text-ink-subtle" aria-live="polite">{saved ? `Saved ${formatDate(saved, true)}` : 'Your work saves as you go'}</span>
      </div>
      <ol className="space-y-7">
        {req.simulator && (
          <Step n={++n} title="Trade on the simulated desk" hint={`Only trades you open after starting this attempt (${formatDate(attempt.startedAt, true)}) can be attached.`} done={detail.eligibleTrades.length > 0}>
            <div className="flex flex-wrap items-center gap-3">
              <Link href={deskHref} className="btn btn-primary"><LineChart className="h-4 w-4" aria-hidden />Open trading desk on {pair(task.instruments[0] || 'EUR_USD')}</Link>
              <SimulatedNote />
            </div>
          </Step>
        )}
        {req.simulator && (
          <Step n={++n} title={`Attach your trade${req.maxTrades === 1 ? '' : 's'}`} hint={req.minTrades === req.maxTrades ? `Select exactly ${req.minTrades}.` : `Select ${req.minTrades} to ${req.maxTrades}.`} done={tradesOk && selected.length > 0}>
            <div className="mb-2 flex justify-end">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void reload()}><RefreshCw className="h-4 w-4" aria-hidden />Refresh trades</button>
            </div>
            <TradeTable
              trades={detail.eligibleTrades}
              selected={selected}
              onToggle={toggle}
              empty={<EmptyState title="No trades yet for this attempt" text="Place the trade on the desk, then come back and refresh. Figures are read from the simulator, so there is nothing to type." />}
            />
          </Step>
        )}
        <Step n={++n} title="Explain your decisions" hint={`At least ${req.minExplanationChars} characters. Explain what you saw, why you entered, and why your stop and target are where they are.`} done={explainOk}>
          <textarea className="input min-h-[10rem] w-full" value={explanation} maxLength={6000} onChange={(e) => setExplanation(e.target.value)} aria-label="Explanation" placeholder="The market was making higher lows on M15. I entered with a limit at the retest of 1.0850..." />
          <p className={`mt-1 text-right text-xs num ${explainOk ? 'text-ink-subtle' : 'text-caution'}`}>{explanation.trim().length} / {req.minExplanationChars}</p>
        </Step>
        {req.external !== 'none' && (
          <Step n={++n} title={`External platform evidence${req.external === 'required' ? '' : ' (optional)'}`} hint="Screenshots and figures from a demo account on another platform, such as OANDA. Never share login details. They are reviewed as your evidence; they are not verified records." done={attempt.attachments.length > 0}>
            <div className="space-y-4">
              <div className="flex flex-wrap gap-3">
                {attempt.attachments.map((f) => (
                  <figure key={f.id} className="group relative h-24 w-32 overflow-hidden rounded-lg border border-line bg-surface-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={f.url} alt={f.name} className="h-full w-full object-cover" />
                    <figcaption className="absolute inset-x-0 bottom-0 truncate bg-black/55 px-2 py-1 text-2xs text-white">{f.name}</figcaption>
                    <button type="button" onClick={() => void remove(f.id)} className="icon-btn absolute right-1 top-1 h-7 w-7 bg-surface-1/90" aria-label={`Remove ${f.name}`}><Trash2 className="h-3.5 w-3.5" aria-hidden /></button>
                  </figure>
                ))}
                {attempt.attachments.length < req.maxAttachments && (
                  <label className={`flex h-24 w-32 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line-strong text-xs text-ink-muted hover:border-primary-500 hover:text-ink ${uploading ? 'pointer-events-none opacity-60' : ''}`}>
                    <ImagePlus className="h-5 w-5" aria-hidden />
                    {uploading ? 'Uploading…' : 'Add screenshot'}
                    <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
                  </label>
                )}
              </div>
              <p className="text-xs text-ink-subtle">PNG, JPEG or WebP, up to 8 MB, {req.maxAttachments} at most. Stored privately: only you and your instructor can open them.</p>
              <Disclosure title="Trade details from the external platform" hint="optional">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {([['broker', 'Platform'], ['instrument', 'Instrument (e.g. EUR/USD)'], ['entry', 'Entry price'], ['exit', 'Exit price'], ['stopLoss', 'Stop-loss'], ['takeProfit', 'Take-profit']] as Array<[keyof ExternalForm, string]>).map(([k, label]) => (
                    <label key={k} className="block"><span className="label">{label}</span><input className="input mt-1.5 w-full" value={external[k]} onChange={(e) => setExternal({ ...external, [k]: e.target.value })} inputMode={['entry', 'exit', 'stopLoss', 'takeProfit'].includes(k) ? 'decimal' : undefined} /></label>
                  ))}
                  <label className="block"><span className="label">Direction</span><select className="input mt-1.5 w-full" value={external.side} onChange={(e) => setExternal({ ...external, side: e.target.value })}><option value="">-</option><option value="buy">Buy</option><option value="sell">Sell</option></select></label>
                  <label className="block"><span className="label">Opened</span><input type="datetime-local" className="input mt-1.5 w-full" value={external.openedAt} onChange={(e) => setExternal({ ...external, openedAt: e.target.value })} /></label>
                  <label className="block"><span className="label">Closed</span><input type="datetime-local" className="input mt-1.5 w-full" value={external.closedAt} onChange={(e) => setExternal({ ...external, closedAt: e.target.value })} /></label>
                  <label className="block sm:col-span-2 lg:col-span-3"><span className="label">Notes</span><textarea className="input mt-1.5 min-h-[5rem] w-full" maxLength={1000} value={external.notes} onChange={(e) => setExternal({ ...external, notes: e.target.value })} /></label>
                </div>
              </Disclosure>
            </div>
          </Step>
        )}
        <Step n={++n} title="Review and submit" hint={`${MODE[attempt.gradingMode].help}`} done={false}>
          <ul className="space-y-1.5 text-sm" data-testid="checklist">
            {req.simulator && <li className={tradesOk ? 'text-ink' : 'text-caution'}>{tradesOk ? '✓' : '•'} {selected.length} trade{selected.length === 1 ? '' : 's'} attached</li>}
            <li className={explainOk ? 'text-ink' : 'text-caution'}>{explainOk ? '✓' : '•'} Explanation {explainOk ? 'written' : `needs ${req.minExplanationChars - explanation.trim().length} more characters`}</li>
            {req.external !== 'none' && <li className={filesOk ? 'text-ink' : 'text-caution'}>{filesOk ? '✓' : '•'} {attempt.attachments.length} screenshot{attempt.attachments.length === 1 ? '' : 's'}{req.external === 'required' ? ' (required)' : ''}</li>}
          </ul>
          <label className="mt-4 flex items-start gap-2.5 text-sm text-ink">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--fo-brand)]" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
            <span>This is my own work. I understand the attached trades are read from my simulator records and cannot be changed after I submit.</span>
          </label>
          {error && <p className="notice notice-caution mt-4 text-sm" role="alert">{error}</p>}
          <button type="button" className="btn btn-primary mt-4 w-full sm:w-auto" disabled={!confirm || busy || !tradesOk || !filesOk} onClick={() => void submit()} data-testid="submit-task">
            <Send className="h-4 w-4" aria-hidden />{busy ? 'Submitting…' : 'Submit task'}
          </button>
        </Step>
      </ol>
    </section>
  );
}

function AttemptHistory({ attempts }: { attempts: AttemptView[] }) {
  const done = attempts.filter((a) => a.status !== 'in_progress');
  if (!done.length) return null;
  return (
    <section aria-labelledby="history-title" className="space-y-3">
      <h2 id="history-title" className="section-title">Submissions</h2>
      {done.map((a, i) => (
        <Disclosure key={a.id} defaultOpen={i === 0 && !a.result} title={`Attempt ${a.attempt}`} hint={`${ATTEMPT_STATUS[a.status]?.label || a.status} · ${formatDate(a.submittedAt, true)}${a.result && a.result.score !== null ? ` · ${a.result.score}/${a.result.maxScore}` : ''}`}>
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3 text-xs text-ink-muted"><Chip map={ATTEMPT_STATUS} value={a.status} /><ModeBadge mode={a.gradingMode} long /><span>Rubric version {a.rubricVersion}</span></div>
            {a.trades.length > 0 && <TradeTable trades={a.trades} />}
            {a.explanation && <p className="whitespace-pre-line rounded-lg bg-surface-2 p-3 text-sm text-ink">{a.explanation}</p>}
            {a.external && <ExternalDetails external={a.external} />}
            {a.attachments.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {a.attachments.map((f) => <a key={f.id} href={f.url} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm"><ExternalLink className="h-3.5 w-3.5" aria-hidden />{f.name}</a>)}
              </div>
            )}
            {a.status === 'returned' && a.result && <ResultReport result={a.result} mode={a.gradingMode} />}
          </div>
        </Disclosure>
      ))}
    </section>
  );
}

export default function PracticalTaskPage() {
  const router = useRouter();
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const id = one(router.query.id);
  const { data, error, loading, reload } = usePortalResource<StudentTaskDetail>(router.isReady && id && user?.role === 'student' ? `/practical-tasks/${id}` : null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) router.replace('/login');
    else if (user && user.role !== 'student') router.replace('/dashboard');
  }, [authLoading, isAuthenticated, user, router]);

  const start = useCallback(async () => {
    setStarting(true);
    setStartError(null);
    try {
      await apiClient.post(`/practical-tasks/${id}/attempt`, {});
      await reload();
    } catch (err) {
      setStartError(errorText(err, 'The task could not be started.'));
    } finally {
      setStarting(false);
    }
  }, [id, reload]);

  const current = useMemo(() => data?.attempts.find((a) => a.status === 'in_progress') || null, [data]);
  const latestResult = useMemo(() => data?.attempts.find((a) => a.status === 'graded' && a.result) || null, [data]);

  if (authLoading || !user) return <LoadingSpinner message="Checking your session" fullScreen />;
  const t = data?.task;
  const st = data?.state;

  return (
    <div className="min-h-screen flex flex-col overflow-hidden">
      <Header />
      <div className="relative flex flex-1 overflow-hidden lg:items-start">
        <Sidebar />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-12 pt-20 sm:px-6 lg:px-10 lg:pt-10">
          <Link href="/student-dashboard?section=tasks" className="mb-5 inline-flex items-center gap-1.5 text-sm font-medium text-ink-muted hover:text-ink"><ArrowLeft className="h-4 w-4" aria-hidden />Practical tasks</Link>
          {loading && !data && <LessonSkeleton />}
          {error && <ErrorState text={error.startsWith('Not found') ? 'This task is not assigned to you, or it no longer exists.' : error} onRetry={() => void reload()} />}
          {t && st && (
            <div className="space-y-6">
              <header className="panel-hero p-5 sm:p-7">
                <div className="flex flex-wrap items-center gap-2">
                  <Chip map={STUDENT_STATE} value={st.state} />
                  <span className="chip">{t.categoryLabel}</span>
                  {t.requirements.simulator && <SimulatedNote />}
                </div>
                <h1 className="page-title mt-4 [overflow-wrap:anywhere]">{t.title}</h1>
                {t.summary && <p className="page-lede">{t.summary}</p>}
                <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-ink-muted">
                  <span>{t.instructor}{t.course ? ` · ${t.course}` : ''}</span>
                  <DifficultyDots value={t.difficulty} />
                  <ModeBadge mode={t.gradingMode} long />
                  <span>{t.instruments.map(pair).join(' · ')}</span>
                  <Deadline iso={st.deadline} />
                  <span className="num">{t.rubric.maxScore} points · {st.attemptsLeft} of {t.maxAttempts} attempt{t.maxAttempts === 1 ? '' : 's'} left</span>
                </div>
              </header>

              <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
                <div className="min-w-0 space-y-6">
                  {latestResult && latestResult.result && !current && (
                    <section className="card p-5 sm:p-6" aria-labelledby="result-title">
                      <p className="page-kicker">Attempt {latestResult.attempt}</p>
                      <h2 id="result-title" className="section-title mb-5 mt-2">Your result</h2>
                      <ResultReport result={latestResult.result} mode={latestResult.gradingMode} />
                    </section>
                  )}
                  {current && <Workspace key={current.id} detail={data} attempt={current} reload={reload} />}
                  {!current && st.state === 'awaiting_grading' && (
                    <div className="notice notice-brand text-sm" data-testid="awaiting">Submitted. {data.attempts[0]?.status === 'awaiting_review' ? 'The system has assessed what it can; your instructor reviews it and publishes the result.' : 'Your instructor grades it and you are notified when the result is published.'}</div>
                  )}
                  <Disclosure title="Task brief" hint={current ? 'instructions, objectives, rubric' : undefined} defaultOpen={!current}>
                    <div className="space-y-6">
                      <div>
                        <p className="readout-label">Learning objectives</p>
                        <ul className="mt-2 space-y-1.5 text-sm text-ink">{t.objectives.map((o) => <li key={o} className="flex gap-2"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary-500" aria-hidden />{o}</li>)}</ul>
                      </div>
                      <div>
                        <p className="readout-label mb-2">Instructions</p>
                        <Instructions blocks={t.blocks} />
                      </div>
                      <div>
                        <p className="readout-label mb-2">How it is graded</p>
                        <RubricList criteria={t.rubric.criteria} maxScore={t.rubric.maxScore} />
                      </div>
                      {t.resources.length > 0 && (
                        <div>
                          <p className="readout-label mb-2">Resources</p>
                          <ul className="space-y-1.5">{t.resources.map((r) => <li key={r.url}><a href={r.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-600 hover:underline dark:text-primary-400"><ExternalLink className="h-3.5 w-3.5" aria-hidden />{r.label}</a></li>)}</ul>
                        </div>
                      )}
                    </div>
                  </Disclosure>
                  <AttemptHistory attempts={data.attempts} />
                </div>

                <aside className="space-y-4 lg:sticky lg:top-6">
                  <div className="card p-5">
                    <p className="readout-label">Task rules</p>
                    <dl className="mt-3 space-y-2.5 text-sm">
                      {t.requirements.simulator && <div className="flex justify-between gap-3"><dt className="text-ink-muted">Trades</dt><dd className="num text-ink">{t.requirements.minTrades === t.requirements.maxTrades ? t.requirements.minTrades : `${t.requirements.minTrades}-${t.requirements.maxTrades}`}</dd></div>}
                      <div className="flex justify-between gap-3"><dt className="text-ink-muted">Max risk per trade</dt><dd className="num text-ink">{t.requirements.maxRiskPercent}%</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-ink-muted">Min reward : risk</dt><dd className="num text-ink">{t.requirements.minRewardRisk} : 1</dd></div>
                      {t.requirements.side && <div className="flex justify-between gap-3"><dt className="text-ink-muted">Direction</dt><dd className="capitalize text-ink">{t.requirements.side}</dd></div>}
                      <div className="flex justify-between gap-3"><dt className="text-ink-muted">Order types</dt><dd className="text-right capitalize text-ink">{t.requirements.orderTypes.join(', ')}</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-ink-muted">External evidence</dt><dd className="capitalize text-ink">{t.requirements.external === 'none' ? 'Not used' : t.requirements.external}</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-ink-muted">Deadline</dt><dd className="text-right text-ink">{st.deadline ? formatDate(st.deadline, true) : 'None'}</dd></div>
                    </dl>
                    {st.canStart && !current && (
                      <>
                        <button type="button" className="btn btn-primary mt-5 w-full" onClick={() => void start()} disabled={starting} data-testid="start-task">{starting ? 'Starting…' : st.state === 'returned' ? 'Start revision' : data.attempts.length ? 'Try again' : 'Start task'}</button>
                        {data.attempts.length > 0 && st.state === 'graded' && <p className="mt-2 text-xs text-ink-subtle">Another attempt replaces this result when it is graded. Earlier attempts are kept.</p>}
                      </>
                    )}
                    {startError && <p className="notice notice-caution mt-3 text-sm" role="alert">{startError}</p>}
                  </div>
                  <div className="rounded-panel border border-line bg-surface-2 p-4 text-xs text-ink-muted">
                    <p className="font-semibold text-ink">{MODE[t.gradingMode].label}</p>
                    <p className="mt-1">{MODE[t.gradingMode].help}</p>
                    <p className="mt-2">The outcome of a trade does not decide the grade: the quality of your decisions and your risk management does.</p>
                  </div>
                </aside>
              </div>
            </div>
          )}
        </main>
      </div>
      <Footer />
    </div>
  );
}
