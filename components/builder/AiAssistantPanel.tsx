/**
 * AI lesson assistant inside the lesson editor. It proposes; the instructor decides.
 *
 * Ready -> Generating -> Generated (a saved draft proposal) -> Accept / Reject, or Failed with the
 * reason. Proposals are shown through the student renderer (components/course/LessonBlocks), side
 * by side with the current lesson, with the quality checklist and any knowledge-check questions.
 * Accepting replaces the lesson body only after the editor's changes are saved, keeps the previous
 * version in history (restorable), and asks again for a live course. Manual editing never depends on
 * any of this: when AI is not set up the panel says so and everything else works.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, History, Loader2, RotateCcw, Sparkles, X, XCircle } from 'lucide-react';
import LessonBlocks from '@/components/course/LessonBlocks';
import { apiClient } from '@/lib/api-client';
import type { Block } from '@/lib/course-content';
import type { Proposal, ProposalSummary } from '@/lib/lesson-ai';
import type { SaveStatus } from '@/components/builder/useLessonAutosave';

const SECTION_KINDS: Array<[string, string]> = [
  ['introduction', 'Introduction'], ['explanation', 'Detailed explanation'], ['key_concepts', 'Key concepts'], ['terminology', 'Terminology'],
  ['example', 'Practical example'], ['steps', 'Step-by-step demonstration'], ['calculation', 'Worked calculation'], ['misconceptions', 'Common misconceptions'],
  ['mistakes', 'Common mistakes'], ['application', 'Practical application'], ['summary', 'Summary'], ['further_learning', 'Further learning'],
];
const MODE_LABEL: Record<string, string> = { generate: 'Generate lesson', improve: 'Improve', expand: 'Expand', rewrite: 'Rewrite', section: 'Section', simplify: 'Simplify', examples: 'Practical examples', checks: 'Knowledge checks' };
const MODE_HINT: Record<string, string> = {
  generate: 'A complete lesson for this topic, written from the course, module and earlier lessons.',
  improve: 'Clearer, better organised and more accurate, keeping what already works.',
  expand: 'Keeps the existing material and adds missing explanations, examples and applications.',
  rewrite: 'A completely new version. The current one is kept in history if you accept.',
  section: 'One section, inserted after the block you choose.',
  simplify: 'Plain language for students who find the topic hard.',
  examples: 'Forex scenarios and worked calculations, added to the lesson.',
  checks: 'Multiple-choice questions; accepting adds them to the lesson quiz as a draft.',
};

type Status = { provider: { configured: boolean; provider: string | null; model: string | null; reason?: string }; proposals: ProposalSummary[]; history: Array<{ id: string; at: string; reason: string; revision: number; blocks: number }>; running: boolean; revision: number };

function errorOf(err: unknown) {
  const r = (err as { response?: { status?: number; data?: { error?: string; code?: string } } })?.response;
  return { status: r?.status || 0, code: r?.data?.code || '', message: r?.data?.error || 'The request failed. Check your connection and try again.' };
}

export default function AiAssistantPanel({ courseId, lessonId, lessonTitle, words, currentBlocks, legacy, revision, saveStatus, editable, live, resolveAsset, assetNames, onApplied }: {
  courseId: string;
  lessonId: string;
  lessonTitle: string;
  words: number;
  currentBlocks: Block[];
  legacy: { description: string; content: string };
  revision: number;
  saveStatus: SaveStatus;
  editable: boolean;
  live: boolean;
  resolveAsset: (id: string) => string | null;
  assetNames: Record<string, { name: string; bytes: number | null }>;
  onApplied: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [mode, setMode] = useState<string>(words < 40 ? 'generate' : 'improve');
  const [sectionKind, setSectionKind] = useState('example');
  const [insertAfter, setInsertAfter] = useState('');
  const [instructions, setInstructions] = useState('');
  const [phase, setPhase] = useState<'ready' | 'generating' | 'failed'>('ready');
  const [failure, setFailure] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [tab, setTab] = useState<'proposed' | 'compare' | 'quality' | 'questions'>('proposed');
  const [createQuiz, setCreateQuiz] = useState(true);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try { setStatus(await apiClient.get<Status>(`/lessons/${lessonId}/ai`)); } catch { setStatus(null); }
  }, [lessonId]);
  useEffect(() => { if (open) void refresh(); }, [open, refresh]);
  useEffect(() => { setProposal(null); setPhase('ready'); setFailure(null); setNote(null); setMode(words < 40 ? 'generate' : 'improve'); }, [lessonId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  const openProposal = async (id: string) => {
    setNote(null);
    try {
      const res = await apiClient.get<{ proposal: Proposal | null }>(`/lessons/${lessonId}/ai?proposal=${id}`);
      if (res.proposal) { setProposal(res.proposal); setTab('proposed'); }
    } catch (err) { setNote(errorOf(err).message); }
  };

  const generate = async (regenerate = false) => {
    setPhase('generating'); setFailure(null); setNote(null); setElapsed(0);
    const started = Date.now();
    timer.current = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    try {
      const res = await apiClient.post<{ proposal: Proposal; reused: boolean }>(`/lessons/${lessonId}/ai`, { action: 'generate', mode, sectionKind: mode === 'section' ? sectionKind : undefined, insertAfter: insertAfter || undefined, instructions, regenerate });
      setProposal(res.proposal);
      setTab(res.proposal.mode === 'checks' ? 'questions' : 'proposed');
      setPhase('ready');
      if (res.reused) setNote('This is the draft already generated for the same request. Use "Generate again" for a new one.');
      void refresh();
    } catch (err) {
      setPhase('failed');
      setFailure(errorOf(err).message);
    } finally {
      if (timer.current) clearInterval(timer.current);
    }
  };

  const decide = async (action: 'accept' | 'reject', extra: Record<string, unknown> = {}) => {
    if (!proposal) return;
    setBusy(true); setNote(null);
    try {
      const res = await apiClient.post<{ quiz?: { added: number; note: string } | null }>(`/lessons/${lessonId}/ai`, { action, proposalId: proposal.id, baseRevision: revision, createQuiz: createQuiz && proposal.knowledgeChecks.length > 0, ...extra });
      if (action === 'reject') { setProposal(null); setNote('Proposal rejected. The lesson is unchanged.'); void refresh(); }
      else { setProposal(null); onApplied(`AI proposal accepted. The previous version is kept in history.${res.quiz ? ` ${res.quiz.note}` : ''}`); }
    } catch (err) {
      const e = errorOf(err);
      if (e.code === 'confirm_live' && window.confirm(`${e.message}\n\nAccept the proposal now?`)) { setBusy(false); return decide(action, { ...extra, confirmLive: true }); }
      if (e.code === 'proposal_stale' && window.confirm(`${e.message}\n\nAccept it anyway?`)) { setBusy(false); return decide(action, { ...extra, acceptStale: true }); }
      setNote(e.message);
    } finally { setBusy(false); }
  };

  const restore = async (historyId: string) => {
    if (!window.confirm('Restore this earlier version? The current version is kept in history, so you can switch back.')) return;
    setBusy(true); setNote(null);
    const send = async (confirmLive: boolean): Promise<void> => {
      try { await apiClient.post(`/lessons/${lessonId}/ai`, { action: 'restore', historyId, baseRevision: revision, confirmLive }); onApplied('Earlier version restored. The replaced version is kept in history.'); }
      catch (err) { const e = errorOf(err); if (e.code === 'confirm_live' && !confirmLive && window.confirm(`${e.message}\n\nRestore now?`)) return send(true); setNote(e.message); }
    };
    await send(false);
    setBusy(false);
  };

  const unsaved = saveStatus !== 'saved';
  const configured = status?.provider.configured;
  const pending = (status?.proposals || []).filter((p) => p.status === 'pending');
  const legacyLesson = { _id: lessonId, description: legacy.description, content: legacy.content };
  const failedChecks = proposal ? proposal.quality.checks.filter((c) => c.status === 'fail').length : 0;

  return (
    <section className="rounded-2xl border border-primary-500/30 bg-[color-mix(in_srgb,var(--fo-brand)_4%,var(--fo-surface-1))]" data-testid="ai-panel">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center gap-3 px-4 py-3 text-left" data-testid="ai-toggle">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-500/15 text-primary-600 dark:text-primary-400"><Sparkles className="h-4 w-4" aria-hidden /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-ink">AI lesson assistant</span>
          <span className="block text-xs text-ink-subtle">Develop this topic with AI. You review every change; nothing is published automatically.</span>
        </span>
        {pending.length > 0 && <span className="rounded-full bg-primary-500/15 px-2 py-0.5 text-2xs font-semibold text-primary-700 dark:text-primary-300">{pending.length} draft{pending.length === 1 ? '' : 's'}</span>}
        <ChevronDown className={`h-4 w-4 text-ink-subtle transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>

      {open && (
        <div className="space-y-4 border-t border-line px-4 py-4">
          {!status ? <div className="h-16 animate-pulse rounded-xl bg-surface-2" /> : !configured ? (
            <p className="notice notice-brand text-sm" data-testid="ai-not-configured">{status.provider.reason || 'AI is not set up on this server.'} You can keep writing, uploading and editing lessons by hand.</p>
          ) : (
            <>
              {!proposal && (
                <div className="space-y-3" data-testid="ai-request">
                  <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="What should the AI do?">
                    {(words < 40 ? ['generate', 'section', 'examples', 'checks'] : ['improve', 'expand', 'rewrite', 'simplify', 'section', 'examples', 'checks']).map((m) => (
                      <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)} disabled={!editable || phase === 'generating'} className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${mode === m ? 'border-primary-500 bg-primary-500/10 text-primary-700 dark:text-primary-300' : 'border-line text-ink-muted hover:text-ink'}`} data-testid={`ai-mode-${m}`}>{MODE_LABEL[m]}</button>
                    ))}
                  </div>
                  <p className="text-xs text-ink-muted">{MODE_HINT[mode]} The AI is given this course, its module, the earlier lessons{words ? ` and the lesson's current ${words} words` : ''}; the topic “{lessonTitle || 'Untitled lesson'}” and its place in the curriculum do not change.</p>
                  {mode === 'section' && (
                    <div className="grid gap-2 sm:grid-cols-2">
                      <label className="text-xs text-ink-muted">Section<select className="input mt-1 w-full" value={sectionKind} onChange={(e) => setSectionKind(e.target.value)}>{SECTION_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
                      <label className="text-xs text-ink-muted">Insert after<select className="input mt-1 w-full" value={insertAfter} onChange={(e) => setInsertAfter(e.target.value)}><option value="">The end of the lesson</option>{currentBlocks.map((b, i) => <option key={b.id} value={b.id}>{i + 1}. {b.type === 'heading' ? b.text || 'Heading' : b.type}</option>)}</select></label>
                    </div>
                  )}
                  {(mode === 'examples' || mode === 'checks') && (
                    <label className="text-xs text-ink-muted">Insert after<select className="input mt-1 w-full sm:w-80" value={insertAfter} onChange={(e) => setInsertAfter(e.target.value)} disabled={mode === 'checks'}><option value="">The end of the lesson</option>{currentBlocks.map((b, i) => <option key={b.id} value={b.id}>{i + 1}. {b.type === 'heading' ? b.text || 'Heading' : b.type}</option>)}</select></label>
                  )}
                  <label className="block text-xs text-ink-muted">Guidance for the AI (optional)
                    <textarea className="input mt-1 min-h-[3.5rem] w-full text-sm" maxLength={600} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="e.g. Use GBP/USD in the examples; students often confuse pips with pipettes." data-testid="ai-instructions" />
                  </label>
                  <div className="flex flex-wrap items-center gap-3">
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => void generate()} disabled={!editable || phase === 'generating'} data-testid="ai-generate">
                      {phase === 'generating' ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden />Generating… {elapsed}s</> : <><Sparkles className="h-4 w-4" aria-hidden />{MODE_LABEL[mode]}</>}
                    </button>
                    <span className="text-xs text-ink-subtle">{status.provider.provider} · {status.provider.model}. Usually 10-60 seconds.</span>
                  </div>
                  {phase === 'generating' && <p className="text-xs text-ink-muted" role="status" data-testid="ai-generating">Writing a draft from the course context. You can keep editing; the draft does not change the lesson.</p>}
                  {phase === 'failed' && failure && <p className="notice notice-caution flex items-start gap-2 text-sm" role="alert" data-testid="ai-failed"><XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{failure}</p>}
                  {!editable && <p className="text-xs text-ink-subtle">This course is in review or live, so only an administrator can apply changes.</p>}
                </div>
              )}

              {proposal && (
                <div className="space-y-3" data-testid="ai-proposal">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden />Generated · saved as a draft</span>
                    <span className="text-xs text-ink-subtle">{MODE_LABEL[proposal.mode]}{proposal.sectionKind ? ` (${SECTION_KINDS.find(([v]) => v === proposal.sectionKind)?.[1]})` : ''} · {proposal.model}{proposal.usage ? ` · ${proposal.usage.promptTokens + proposal.usage.completionTokens} tokens` : ''}</span>
                    <button type="button" className="ml-auto rounded p-1 text-ink-subtle hover:text-ink" aria-label="Close the proposal (it stays as a draft)" onClick={() => setProposal(null)}><X className="h-4 w-4" aria-hidden /></button>
                  </div>
                  <div className="inline-flex flex-wrap rounded-xl border border-line p-0.5 text-xs font-semibold" role="tablist">
                    {(['proposed', 'compare', 'quality', 'questions'] as const).filter((t) => t !== 'questions' || proposal.knowledgeChecks.length).filter((t) => proposal.mode !== 'checks' || t === 'questions' || t === 'quality').map((t) => (
                      <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`rounded-lg px-3 py-1.5 ${tab === t ? 'bg-tint text-ink' : 'text-ink-subtle hover:text-ink'}`} data-testid={`ai-tab-${t}`}>
                        {t === 'proposed' ? 'Student preview' : t === 'compare' ? 'Compare' : t === 'quality' ? `Quality checklist${proposal.quality.checks.some((c) => c.status !== 'pass') ? ` (${proposal.quality.checks.filter((c) => c.status !== 'pass').length})` : ''}` : `Questions (${proposal.knowledgeChecks.length})`}
                      </button>
                    ))}
                  </div>

                  {tab === 'proposed' && (
                    <div className="max-h-[70vh] overflow-y-auto rounded-xl border border-line bg-[var(--fo-bg)] p-4 sm:p-6" data-testid="ai-preview">
                      <LessonBlocks lesson={legacyLesson} blocks={proposal.blocks} mode="preview" resolveAsset={resolveAsset} assetNames={assetNames} />
                    </div>
                  )}
                  {tab === 'compare' && (
                    <div className="grid gap-3 lg:grid-cols-2" data-testid="ai-compare">
                      {[['Current lesson', currentBlocks], ['Proposed', proposal.blocks]].map(([label, blocks]) => (
                        <div key={label as string} className="min-w-0">
                          <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.1em] text-ink-subtle">{label as string} · {(blocks as Block[]).length} blocks</p>
                          <div className="max-h-[60vh] overflow-y-auto rounded-xl border border-line bg-[var(--fo-bg)] p-4">
                            <LessonBlocks lesson={legacyLesson} blocks={blocks as Block[]} mode="preview" resolveAsset={resolveAsset} assetNames={assetNames} />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {tab === 'quality' && (
                    <ul className="divide-y divide-[var(--fo-line)] rounded-xl border border-line" data-testid="ai-quality">
                      {proposal.quality.checks.map((c) => (
                        <li key={c.id} className="flex items-start gap-3 px-3 py-2.5 text-sm">
                          {c.status === 'pass' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-label="pass" /> : c.status === 'fail' ? <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-label="fail" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-label="check" />}
                          <span className="min-w-0"><span className="block text-ink">{c.label}</span>{c.detail && <span className="block text-xs text-ink-muted">{c.detail}</span>}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {tab === 'questions' && (
                    <ol className="space-y-3" data-testid="ai-questions">
                      {proposal.knowledgeChecks.map((q, i) => (
                        <li key={i} className="rounded-xl border border-line p-3 text-sm">
                          <p className="font-medium text-ink">{i + 1}. {q.question}</p>
                          <ul className="mt-2 space-y-1">{q.options.map((o, j) => <li key={j} className={j === q.correctIndex ? 'font-semibold text-emerald-700 dark:text-emerald-300' : 'text-ink-muted'}>{j === q.correctIndex ? '✓ ' : '• '}{o}</li>)}</ul>
                          {q.explanation && <p className="mt-2 text-xs text-ink-subtle">{q.explanation}</p>}
                        </li>
                      ))}
                    </ol>
                  )}
                  {proposal.suggestions.length > 0 && (
                    <div className="rounded-xl border border-line px-3 py-2 text-xs text-ink-muted"><p className="font-semibold text-ink">Notes for you (not applied)</p><ul className="mt-1 list-disc pl-4">{proposal.suggestions.map((s, i) => <li key={i}>{s}</li>)}</ul></div>
                  )}

                  {note && <p className="text-sm text-ink-muted" role="status">{note}</p>}
                  {proposal.status === 'pending' && editable && (
                    <div className="space-y-2 border-t border-line pt-3">
                      {proposal.knowledgeChecks.length > 0 && proposal.mode !== 'checks' && (
                        <label className="flex items-center gap-2 text-sm text-ink-muted"><input type="checkbox" className="h-4 w-4 accent-[var(--fo-brand)]" checked={createQuiz} onChange={(e) => setCreateQuiz(e.target.checked)} />Also add the {proposal.knowledgeChecks.length} questions to the lesson quiz (as a draft)</label>
                      )}
                      {unsaved && <p className="text-xs text-amber-700 dark:text-amber-300">Your latest edits are still saving. Accept becomes available once they are saved.</p>}
                      {failedChecks > 0 && <p className="text-xs text-red-600">The checklist found a problem. Review it before accepting.</p>}
                      <div className="flex flex-wrap gap-2">
                        <button type="button" className="btn btn-primary btn-sm" disabled={busy || unsaved} onClick={() => void decide('accept')} data-testid="ai-accept">{proposal.mode === 'checks' ? 'Add to quiz as draft' : live ? 'Accept and update the live lesson' : 'Accept into the lesson'}</button>
                        <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void decide('reject')} data-testid="ai-reject">Reject</button>
                        <button type="button" className="btn btn-ghost btn-sm" disabled={busy || phase === 'generating'} onClick={() => { setProposal(null); void generate(true); }}>Generate again</button>
                      </div>
                      <p className="text-xs text-ink-subtle">Accepting puts this into the lesson editor, where you can change anything. {live ? 'This course is live: students see accepted changes straight away.' : 'Students see it only once the course is published.'}</p>
                    </div>
                  )}
                </div>
              )}

              {!proposal && pending.length > 0 && (
                <div data-testid="ai-drafts">
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.1em] text-ink-subtle">Draft proposals</p>
                  <ul className="divide-y divide-[var(--fo-line)] rounded-xl border border-line text-sm">
                    {pending.map((p) => (
                      <li key={p.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                        <span className="flex-1 text-ink">{MODE_LABEL[p.mode]}{p.instructions ? ` · “${p.instructions.slice(0, 40)}${p.instructions.length > 40 ? '…' : ''}”` : ''}</span>
                        <span className="text-xs text-ink-subtle">{new Date(p.createdAt).toLocaleString()}{p.baseRevision !== revision ? ' · lesson changed since' : ''}</span>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void openProposal(p.id)}>Review</button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}

          {status && status.history.length > 0 && !proposal && (
            <details className="text-sm" data-testid="ai-history">
              <summary className="flex cursor-pointer items-center gap-2 text-xs font-semibold uppercase tracking-[0.1em] text-ink-subtle"><History className="h-3.5 w-3.5" aria-hidden />Earlier versions ({status.history.length})</summary>
              <ul className="mt-2 divide-y divide-[var(--fo-line)] rounded-xl border border-line">
                {status.history.map((h) => (
                  <li key={h.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                    <span className="flex-1 text-ink">{new Date(h.at).toLocaleString()} · replaced by {h.reason === 'restore' ? 'a restore' : MODE_LABEL[h.reason.replace('ai_', '')] || 'an AI proposal'}</span>
                    <span className="text-xs text-ink-subtle">{h.blocks} blocks</span>
                    {editable && <button type="button" className="btn btn-ghost btn-sm" disabled={busy || unsaved} onClick={() => void restore(h.id)} data-testid="ai-restore"><RotateCcw className="h-3.5 w-3.5" aria-hidden />Restore</button>}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {note && !proposal && <p className="text-sm text-ink-muted" role="status" data-testid="ai-note">{note}</p>}
        </div>
      )}
    </section>
  );
}
