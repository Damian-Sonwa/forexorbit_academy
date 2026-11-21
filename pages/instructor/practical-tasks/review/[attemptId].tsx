/**
 * Grading workspace for one practical task attempt (instructors; admins read only).
 *   GET  /api/practical-tasks/attempts/:id   task, student, frozen evidence, automated assessment,
 *                                            grade, history, previous attempts (404 outside scope)
 *   POST /api/practical-tasks/attempts/:id   publish a grade, return for revision, or change a grade.
 * The revision read here is sent back: if another grader saved in between, the server refuses (409)
 * and the page reloads their work instead of overwriting it.
 */

import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ExternalLink, RotateCcw, Send } from 'lucide-react';
import PortalShell from '@/components/instructor/portal/PortalShell';
import { ATTEMPT_STATUS, Chip, CriterionStatus, ExternalDetails, Instructions, ModeBadge, ResultReport, ScoreBar, TradeTable } from '@/components/practical/Common';
import { Disclosure, ErrorState } from '@/components/student/dashboard/Panels';
import { LessonSkeleton } from '@/components/loading';
import { formatDate } from '@/components/student/dashboard/format';
import { usePortalResource } from '@/hooks/usePortalResource';
import { apiClient } from '@/lib/api-client';
import { formatBlocks } from '@/lib/practical-task-spec';
import type { Feedback, StaffAttempt } from '@/lib/practical-tasks';

const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : '');
const failure = (err: unknown) => ((err as { response?: { status?: number; data?: { error?: string; field?: string } } })?.response) || {};
const ACTION: Record<string, string> = { auto_graded: 'Graded by the system', auto_assessed: 'Assessed by the system', graded: 'Graded', reviewed: 'Reviewed and published', regraded: 'Grade changed', override: 'System grade overridden', returned: 'Returned for revision' };
/** score / max as a one-decimal percentage (display only; the server computes the stored figure). */
const percentText = (score: number, max: number) => (max ? (Math.round((score / max) * 1000) / 10).toFixed(1) : '0.0');
const EMPTY_FEEDBACK: Feedback = { summary: '', strengths: '', mistakes: '', recommendations: '' };

export default function ReviewAttempt() {
  const router = useRouter();
  const attemptId = one(router.query.attemptId);
  const { data, error, loading, reload } = usePortalResource<StaffAttempt>(router.isReady && attemptId ? `/practical-tasks/attempts/${encodeURIComponent(attemptId)}` : null);
  const [scores, setScores] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<Feedback>(EMPTY_FEEDBACK);
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState<null | 'publish' | 'return'>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ error: string; field?: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Start from the current grade, else the system's scores.
  useEffect(() => {
    if (!data) return;
    const a = data.attempt;
    const next: Record<string, string> = {};
    const nextNotes: Record<string, string> = {};
    for (const c of a.rubric.criteria) {
      const g = a.grade?.criteria?.find((x) => x.id === c.id);
      const auto = a.autoResult?.criteria.find((x) => x.id === c.id);
      next[c.id] = typeof g?.score === 'number' ? String(g.score) : typeof auto?.score === 'number' ? String(auto.score) : '';
      nextNotes[c.id] = g?.feedback || '';
    }
    setScores(next);
    setNotes(nextNotes);
    setFeedback({ ...EMPTY_FEEDBACK, ...(a.grade?.feedback || {}) });
    setReason('');
  }, [data]);

  const a = data?.attempt;
  const total = useMemo(() => (a ? a.rubric.criteria.reduce((s, c) => s + (Number(scores[c.id]) || 0), 0) : 0), [a, scores]);
  const complete = a ? a.rubric.criteria.every((c) => scores[c.id] !== '' && Number.isInteger(Number(scores[c.id])) && Number(scores[c.id]) >= 0 && Number(scores[c.id]) <= c.points) : false;
  const adjusted = a ? a.rubric.criteria.some((c) => { const auto = a.autoResult?.criteria.find((x) => x.id === c.id); return auto && typeof auto.score === 'number' && scores[c.id] !== '' && Number(scores[c.id]) !== auto.score; }) : false;
  const changing = a?.status === 'graded';
  const needsReason = changing || adjusted;
  const canGrade = a && !data?.readOnly && ['awaiting_grading', 'awaiting_review', 'graded'].includes(a.status);

  const send = async (decision: 'publish' | 'return') => {
    if (!a) return;
    setBusy(true); setProblem(null);
    try {
      await apiClient.post(`/practical-tasks/attempts/${encodeURIComponent(a.id)}`, {
        decision,
        expectedRevision: a.revision,
        scores: Object.fromEntries(Object.entries(scores).filter(([, v]) => v !== '').map(([k, v]) => [k, Number(v)])),
        criterionFeedback: notes,
        feedback,
        reason: reason || undefined,
      });
      setConfirm(null);
      setNotice(decision === 'return' ? 'Returned to the student with your feedback. They were notified.' : 'Grade published. The student was notified.');
      await reload();
    } catch (err) {
      const f = failure(err);
      setConfirm(null);
      if (f.status === 409) {
        setProblem({ error: `${f.data?.error || 'This submission changed.'} The latest version has been loaded.` });
        await reload();
      } else setProblem({ error: f.data?.error || 'The grade was not saved.', field: f.data?.field });
    } finally { setBusy(false); }
  };

  return (
    <PortalShell title={data ? `${data.student.name} · ${data.task.title}` : 'Grade submission'} lede={a ? `Attempt ${a.attempt} · submitted ${formatDate(a.submittedAt, true)}` : undefined}>
      <Link href="/instructor/practical-tasks?view=grading" className="mb-5 inline-flex items-center gap-1.5 text-sm font-medium text-ink-muted hover:text-ink"><ArrowLeft className="h-4 w-4" aria-hidden />Grading queue</Link>
      {loading && !data && <LessonSkeleton />}
      {error && <ErrorState text={error} onRetry={() => void reload()} />}
      {notice && <p className="notice notice-brand mb-4 text-sm" role="status">{notice}</p>}
      {problem && <p className="notice notice-caution mb-4 text-sm" role="alert">{problem.error}</p>}
      {data && a && (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_26rem]">
          <div className="min-w-0 space-y-5">
            <div className="flex flex-wrap items-center gap-3 text-xs text-ink-muted">
              <Chip map={ATTEMPT_STATUS} value={a.status} />
              <ModeBadge mode={a.gradingMode} long />
              <span>Rubric v{a.rubricVersion}</span>
              {a.resubmission && <span className="chip">Resubmission</span>}
              {data.student.level && <span className="capitalize">{data.student.level} learner</span>}
            </div>
            <section className="card p-5">
              <h2 className="section-title">Simulator evidence</h2>
              <p className="mt-1 text-xs text-ink-muted">Frozen from the server&apos;s own position and order records when the work was submitted. The student could not type these figures.</p>
              <div className="mt-4"><TradeTable trades={a.trades} empty={<p className="text-sm text-ink-muted">No simulator trades were attached.</p>} /></div>
            </section>
            <section className="card p-5">
              <h2 className="section-title">Student explanation</h2>
              <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-ink">{a.explanation || 'No explanation.'}</p>
            </section>
            {(a.external || a.attachments.length > 0) && (
              <section className="card space-y-4 p-5">
                <h2 className="section-title">External evidence</h2>
                <p className="text-xs text-ink-muted">Submitted by the student. Screenshots and figures are not verified records of a real trade; judge them as evidence.</p>
                {a.attachments.length > 0 && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {a.attachments.map((f) => (
                      <a key={f.id} href={f.url} target="_blank" rel="noopener noreferrer" className="group block overflow-hidden rounded-xl border border-line bg-surface-2">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={f.url} alt={f.name} className="max-h-72 w-full object-contain" />
                        <span className="flex items-center gap-1.5 px-3 py-2 text-xs text-ink-muted"><ExternalLink className="h-3.5 w-3.5" aria-hidden />{f.name}</span>
                      </a>
                    ))}
                  </div>
                )}
                {a.external && <ExternalDetails external={a.external} />}
              </section>
            )}
            {a.autoResult && (
              <section className="card p-5">
                <h2 className="section-title">System assessment</h2>
                <p className="mt-1 text-xs text-ink-muted">{a.autoResult.engine} {a.autoResult.version} · fingerprint {a.autoResult.fingerprint.slice(0, 12)}. Deterministic: the same evidence always gives this result.</p>
                <ul className="mt-4 divide-y divide-[var(--fo-line)] rounded-xl border border-line">
                  {a.autoResult.criteria.map((c) => (
                    <li key={c.id} className="flex items-start justify-between gap-3 px-4 py-3">
                      <div className="min-w-0"><p className="text-sm font-medium text-ink">{c.label}</p><div className="mt-1 flex flex-wrap items-center gap-3"><CriterionStatus status={c.status} /><span className="text-xs text-ink-muted">{c.detail}</span></div></div>
                      <span className="shrink-0 num text-sm font-semibold">{c.score ?? '-'}<span className="text-ink-subtle">/{c.points}</span></span>
                    </li>
                  ))}
                </ul>
                {[...a.autoResult.observations.risk, ...a.autoResult.observations.execution].length > 0 && <ul className="mt-3 space-y-1 text-xs text-ink-muted">{[...a.autoResult.observations.risk, ...a.autoResult.observations.execution].map((o) => <li key={o}>{o}</li>)}</ul>}
              </section>
            )}
            <Disclosure title="Task brief" hint={`rubric v${a.rubricVersion}`}>
              <Instructions blocks={formatBlocks(data.task.instructions)} />
            </Disclosure>
            {(a.history.length > 0 || data.previous.length > 0) && (
              <Disclosure title="Grade history and earlier attempts" defaultOpen={a.history.length > 1}>
                <ol className="space-y-2 text-sm">
                  {a.history.map((h, i) => (
                    <li key={i} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line pb-2 last:border-0">
                      <span><span className="font-medium text-ink">{ACTION[h.action] || h.action}</span> <span className="text-ink-muted">by {h.by}</span>{h.reason && <span className="block text-xs text-ink-muted">Reason: {h.reason}</span>}</span>
                      <span className="text-xs text-ink-subtle num">{h.score !== null ? `${h.score}/${h.maxScore} · ` : ''}{formatDate(h.at, true)}</span>
                    </li>
                  ))}
                </ol>
                {data.previous.length > 0 && (
                  <ul className="mt-4 space-y-2">
                    {data.previous.map((p) => <li key={p.id}><Link className="text-sm font-medium text-primary-600 hover:underline dark:text-primary-400" href={`/instructor/practical-tasks/review/${encodeURIComponent(p.id)}`}>Attempt {p.attempt} · {ATTEMPT_STATUS[p.status]?.label}{p.score !== null ? ` · ${p.score}/${p.maxScore}` : ''}</Link></li>)}
                  </ul>
                )}
              </Disclosure>
            )}
          </div>

          <aside className="space-y-4 xl:sticky xl:top-6 xl:self-start">
            {a.status === 'returned' && a.result && <div className="card p-5"><h2 className="section-title mb-4">Returned</h2><ResultReport result={a.result} mode={a.gradingMode} /></div>}
            {canGrade ? (
              <form className="card space-y-4 p-5" onSubmit={(e) => { e.preventDefault(); setConfirm('publish'); }} data-testid="grade-form">
                <div>
                  <h2 className="section-title">{changing ? 'Change the grade' : 'Score the rubric'}</h2>
                  {a.gradingMode !== 'manual' && !changing && <p className="mt-1 text-xs text-ink-muted">System scores are filled in. Changing one needs a reason, recorded in the history.</p>}
                </div>
                <ScoreBar score={total} max={a.rubric.maxScore} percent={percentText(total, a.rubric.maxScore)} />
                <ul className="space-y-3">
                  {a.rubric.criteria.map((c) => {
                    const auto = a.autoResult?.criteria.find((x) => x.id === c.id);
                    return (
                      <li key={c.id} className="rounded-xl border border-line p-3">
                        <div className="flex items-start justify-between gap-3">
                          <label htmlFor={`score-${c.id}`} className="min-w-0 text-sm font-medium text-ink">{c.label}<span className="block text-2xs font-normal text-ink-subtle">{c.kind === 'auto' ? `System: ${auto?.score ?? '-'} / ${c.points}` : 'Instructor-judged'}</span></label>
                          <span className="flex shrink-0 items-center gap-1 text-sm"><input id={`score-${c.id}`} type="number" min={0} max={c.points} className={`input w-20 text-right num ${problem?.field === `scores.${c.id}` ? '!border-down' : ''}`} value={scores[c.id] ?? ''} onChange={(e) => setScores({ ...scores, [c.id]: e.target.value })} required /><span className="text-ink-subtle num">/ {c.points}</span></span>
                        </div>
                        <input className="input mt-2 w-full text-xs" placeholder="Feedback on this criterion (optional)" maxLength={600} value={notes[c.id] || ''} onChange={(e) => setNotes({ ...notes, [c.id]: e.target.value })} aria-label={`Feedback on ${c.label}`} />
                      </li>
                    );
                  })}
                </ul>
                {(['summary', 'strengths', 'mistakes', 'recommendations'] as const).map((k) => (
                  <label key={k} className="block"><span className="label">{k === 'summary' ? 'Overall feedback' : k === 'recommendations' ? 'How to improve' : k[0].toUpperCase() + k.slice(1)}</span><textarea className="input mt-1.5 min-h-[4.5rem] w-full" maxLength={3000} value={feedback[k]} onChange={(e) => setFeedback({ ...feedback, [k]: e.target.value })} /></label>
                ))}
                {needsReason && <label className="block"><span className="label">Reason for the change (recorded)</span><textarea className="input mt-1.5 min-h-[4rem] w-full" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} required minLength={10} /></label>}
                <div className="flex flex-col gap-2 sm:flex-row">
                  <button type="submit" className="btn btn-primary flex-1" disabled={busy || !complete || (needsReason && reason.trim().length < 10)} data-testid="publish-grade"><Send className="h-4 w-4" aria-hidden />{changing ? 'Save new grade' : 'Publish grade'}</button>
                  {!changing && <button type="button" className="btn btn-secondary" disabled={busy || !(feedback.summary || feedback.mistakes || feedback.recommendations)} onClick={() => setConfirm('return')}><RotateCcw className="h-4 w-4" aria-hidden />Return for revision</button>}
                </div>
              </form>
            ) : a.result && a.status === 'graded' ? (
              <div className="card p-5"><ResultReport result={a.result} mode={a.gradingMode} /></div>
            ) : null}
          </aside>
        </div>
      )}

      {confirm && a && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="grade-confirm">
          <div className="card w-full max-w-md p-5 sm:p-6">
            <h2 id="grade-confirm" className="font-display text-lg font-semibold text-ink">{confirm === 'return' ? 'Return for revision?' : changing ? 'Save the new grade?' : 'Publish this grade?'}</h2>
            <p className="mt-3 text-sm text-ink-muted">{confirm === 'return' ? 'The student sees your feedback and can submit one more attempt (until the deadline or 72 hours from now, whichever is later). This attempt is kept.' : `${total} / ${a.rubric.maxScore} (${percentText(total, a.rubric.maxScore)}%) is shown to the student with your feedback, and they are notified once.`}</p>
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" className="btn btn-ghost" onClick={() => setConfirm(null)} disabled={busy}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={() => void send(confirm)} disabled={busy} data-testid="confirm-grade">{busy ? 'Saving…' : confirm === 'return' ? 'Return' : 'Publish'}</button>
            </div>
          </div>
        </div>
      )}
    </PortalShell>
  );
}
