/**
 * Practical trading tasks: shared presentational pieces (labels, chips, deadlines, score bars,
 * instructions, rubric, evidence and results). Props in, markup out; figures come from the server
 * (lib/practical-tasks.js). Text is rendered as text, never as HTML.
 */

import type { ReactNode } from 'react';
import { CalendarClock, CheckCircle2, CircleDashed, CircleSlash, Cpu, ShieldCheck, UserCheck, XCircle } from 'lucide-react';
import { formatDate } from '@/components/student/dashboard/format';
import type { AttemptStatus, Block, CriterionResult, Criterion, Difficulty, GradingMode, ResultView, StudentState, TradeEvidence, ExternalEvidence } from '@/lib/practical-tasks';

export const pair = (id: string) => id.replace('_', '/');

export const MODE: Record<GradingMode, { label: string; short: string; help: string; icon: typeof Cpu }> = {
  automatic: { label: 'Automatic system grading', short: 'Automatic', help: 'The system grades the simulator evidence against the rubric as soon as the work is submitted. Deterministic and reproducible.', icon: Cpu },
  assisted: { label: 'System-assisted review', short: 'Assisted', help: 'The system scores what it can check; the instructor reviews, may adjust with a reason, and publishes. The instructor has the final say.', icon: ShieldCheck },
  manual: { label: 'Instructor grading', short: 'Instructor', help: 'The instructor scores every criterion and writes the feedback. Nothing is published until they do.', icon: UserCheck },
};

export const DIFFICULTY: Record<Difficulty, { label: string; dots: number }> = {
  beginner: { label: 'Beginner', dots: 1 },
  intermediate: { label: 'Intermediate', dots: 2 },
  advanced: { label: 'Advanced', dots: 3 },
};

export const STUDENT_STATE: Record<StudentState, { label: string; tone: string }> = {
  not_started: { label: 'New', tone: 'chip-brand' },
  in_progress: { label: 'In progress', tone: 'chip-brand' },
  awaiting_grading: { label: 'Awaiting grade', tone: '' },
  graded: { label: 'Graded', tone: 'chip-up' },
  returned: { label: 'Revise and resubmit', tone: 'chip-down' },
  overdue: { label: 'Overdue', tone: 'chip-down' },
  closed: { label: 'Closed', tone: '' },
};

export const ATTEMPT_STATUS: Record<AttemptStatus, { label: string; tone: string }> = {
  in_progress: { label: 'In progress', tone: 'chip-brand' },
  submitted: { label: 'Processing', tone: '' },
  awaiting_grading: { label: 'Awaiting grade', tone: 'chip-brand' },
  awaiting_review: { label: 'Awaiting review', tone: 'chip-brand' },
  graded: { label: 'Graded', tone: 'chip-up' },
  returned: { label: 'Returned', tone: 'chip-down' },
};

export const TASK_STATUS: Record<string, { label: string; tone: string }> = {
  draft: { label: 'Draft', tone: '' },
  published: { label: 'Open', tone: 'chip-up' },
  closed: { label: 'Closed', tone: '' },
  archived: { label: 'Archived', tone: '' },
};

export function Chip({ map, value }: { map: Record<string, { label: string; tone: string }>; value: string }) {
  const s = map[value] || { label: value, tone: '' };
  return <span className={`chip ${s.tone}`}>{s.label}</span>;
}

export function ModeBadge({ mode, long = false }: { mode: GradingMode; long?: boolean }) {
  const m = MODE[mode] || MODE.automatic;
  const Icon = m.icon;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-muted" title={m.help}>
      <Icon className="h-3.5 w-3.5 text-primary-500" aria-hidden />
      {long ? m.label : m.short}
    </span>
  );
}

export function DifficultyDots({ value }: { value: Difficulty }) {
  const d = DIFFICULTY[value] || DIFFICULTY.beginner;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink-muted" aria-label={`Difficulty: ${d.label}`}>
      <span className="flex gap-0.5" aria-hidden>
        {[1, 2, 3].map((i) => <span key={i} className={`h-1.5 w-1.5 rounded-full ${i <= d.dots ? 'bg-primary-500' : 'bg-[var(--fo-line-strong)]'}`} />)}
      </span>
      {d.label}
    </span>
  );
}

/** "Due in 2 days" / "Overdue by 3 h" / "No deadline". */
export function timeLeft(iso: string | null, now = Date.now()) {
  if (!iso) return { text: 'No deadline', urgent: false, past: false };
  const ms = new Date(iso).getTime() - now;
  const abs = Math.abs(ms);
  const unit = abs >= 86400000 ? `${Math.round(abs / 86400000)} day${Math.round(abs / 86400000) === 1 ? '' : 's'}` : abs >= 3600000 ? `${Math.round(abs / 3600000)} h` : `${Math.max(1, Math.round(abs / 60000))} min`;
  return ms >= 0 ? { text: `Due in ${unit}`, urgent: ms < 86400000, past: false } : { text: `Overdue by ${unit}`, urgent: true, past: true };
}

export function Deadline({ iso, quiet = false }: { iso: string | null; quiet?: boolean }) {
  const t = timeLeft(iso);
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs ${t.urgent && !quiet ? 'font-semibold text-caution' : 'text-ink-muted'}`} title={iso ? formatDate(iso, true) : undefined}>
      <CalendarClock className="h-3.5 w-3.5" aria-hidden />
      {t.text}
    </span>
  );
}

/** A horizontal score bar with the figure. Colour follows the band, not success or failure of a trade. */
export function ScoreBar({ score, max, percent, size = 'md' }: { score: number | null; max: number; percent: string | null; size?: 'md' | 'lg' }) {
  const p = percent ? Math.min(100, Number(percent)) : 0;
  const band = p >= 80 ? 'bg-up' : p >= 50 ? 'bg-primary-500' : 'bg-down';
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className={`font-display font-semibold num text-ink ${size === 'lg' ? 'text-3xl' : 'text-base'}`}>{score === null ? '-' : score}<span className="text-ink-subtle"> / {max}</span></span>
        <span className="num text-sm text-ink-muted">{percent ? `${percent}%` : ''}</span>
      </div>
      <div className="progress-track mt-2" role="progressbar" aria-valuenow={p} aria-valuemin={0} aria-valuemax={100} aria-label="Score">
        <div className={`progress-fill ${band}`} style={{ width: `${p}%` }} />
      </div>
    </div>
  );
}

export function Instructions({ blocks }: { blocks: Block[] }) {
  return (
    <div className="space-y-3 text-sm leading-relaxed text-ink">
      {blocks.map((b, i) => (b.type === 'list'
        ? <ol key={i} className="list-decimal space-y-1.5 pl-5 marker:font-semibold marker:text-primary-500">{b.items.map((item, j) => <li key={j}>{bold(item)}</li>)}</ol>
        : <p key={i} className="whitespace-pre-line">{bold(b.text)}</p>))}
    </div>
  );
}

/** **bold** spans as <strong>; everything else plain text. */
function bold(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) => (p.startsWith('**') && p.endsWith('**') ? <strong key={i}>{p.slice(2, -2)}</strong> : <span key={i}>{p}</span>));
}

export function RubricList({ criteria, maxScore }: { criteria: Criterion[]; maxScore: number }) {
  return (
    <div className="overflow-hidden rounded-panel border border-line">
      <ul className="divide-y divide-[var(--fo-line)]">
        {criteria.map((c) => (
          <li key={c.id} className="flex items-start justify-between gap-3 bg-surface-1 px-4 py-3">
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
                {c.label}
                <span className="text-2xs font-medium uppercase tracking-wide text-ink-subtle">{c.kind === 'auto' ? 'System-checked' : 'Instructor-judged'}</span>
              </p>
              {c.description && <p className="mt-0.5 text-xs text-ink-muted">{c.description}</p>}
            </div>
            <span className="shrink-0 num text-sm font-semibold text-ink">{c.points}</span>
          </li>
        ))}
      </ul>
      <div className="flex justify-between bg-surface-2 px-4 py-2.5 text-sm font-semibold text-ink"><span>Maximum score</span><span className="num">{maxScore}</span></div>
    </div>
  );
}

const STATUS_ICON: Record<string, { icon: typeof CheckCircle2; tone: string; label: string }> = {
  met: { icon: CheckCircle2, tone: 'text-up', label: 'Met' },
  partial: { icon: CircleDashed, tone: 'text-primary-500', label: 'Partly met' },
  not_met: { icon: XCircle, tone: 'text-down', label: 'Not met' },
  not_applicable: { icon: CircleSlash, tone: 'text-ink-subtle', label: 'Not applicable' },
  needs_instructor: { icon: UserCheck, tone: 'text-ink-subtle', label: 'Instructor-judged' },
};

export function CriterionStatus({ status }: { status: string }) {
  const s = STATUS_ICON[status] || STATUS_ICON.needs_instructor;
  const Icon = s.icon;
  return <span className={`inline-flex items-center gap-1 text-xs font-medium ${s.tone}`}><Icon className="h-3.5 w-3.5" aria-hidden />{s.label}</span>;
}

/** The result report: criterion by criterion, automated findings kept apart from the instructor's. */
export function ResultReport({ result, mode }: { result: ResultView; mode: GradingMode }) {
  const statusFor = (c: CriterionResult) => (c.score === null ? 'needs_instructor' : c.score >= c.points ? 'met' : c.score > 0 ? 'partial' : 'not_met');
  return (
    <div className="space-y-5" data-testid="result-report">
      <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
        <ScoreBar score={result.score} max={result.maxScore} percent={result.percent} size="lg" />
        <div className="text-xs text-ink-subtle sm:text-right">
          <ModeBadge mode={mode} long />
          <p className="mt-1">{result.source === 'system' ? 'Graded by the system' : 'Published by your instructor'}{result.publishedAt ? ` · ${formatDate(result.publishedAt, true)}` : ''}</p>
        </div>
      </div>
      <ul className="divide-y divide-[var(--fo-line)] overflow-hidden rounded-panel border border-line">
        {result.criteria.map((c) => (
          <li key={c.id} className="bg-surface-1 px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">{c.label}</p>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <CriterionStatus status={statusFor(c)} />
                  {c.automated && <span className="text-xs text-ink-muted"><span className="font-medium text-ink-subtle">System: </span>{c.automated.detail}</span>}
                </div>
                {c.adjusted && <p className="mt-1 text-xs text-ink-muted">Adjusted by your instructor from {c.automated?.score} points.</p>}
                {c.feedback && <p className="mt-1.5 rounded-lg bg-surface-2 px-3 py-2 text-xs text-ink"><span className="font-semibold">Instructor: </span>{c.feedback}</p>}
              </div>
              <span className="shrink-0 num text-sm font-semibold text-ink">{c.score ?? '-'}<span className="text-ink-subtle">/{c.points}</span></span>
            </div>
          </li>
        ))}
      </ul>
      {(result.strengths.length > 0 || result.recommendations.length > 0) && (
        <div className="grid gap-4 md:grid-cols-2">
          {result.strengths.length > 0 && (
            <div className="rounded-panel border border-line bg-surface-1 p-4">
              <p className="readout-label">What you did well</p>
              <ul className="mt-2 space-y-1.5 text-sm text-ink">{result.strengths.map((s) => <li key={s} className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-up" aria-hidden />{s}</li>)}</ul>
            </div>
          )}
          {result.recommendations.length > 0 && (
            <div className="rounded-panel border border-line bg-surface-1 p-4">
              <p className="readout-label">How to improve</p>
              <ul className="mt-2 space-y-2 text-sm text-ink">{result.recommendations.map((s) => <li key={s} className="flex gap-2"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary-500" aria-hidden />{s}</li>)}</ul>
            </div>
          )}
        </div>
      )}
      {(result.observations.risk.length > 0 || result.observations.execution.length > 0) && (
        <div className="rounded-panel border border-line bg-surface-2 p-4 text-sm">
          <p className="readout-label">System observations</p>
          <ul className="mt-2 space-y-1 text-ink-muted">{[...result.observations.risk, ...result.observations.execution].map((o) => <li key={o}>{o}</li>)}</ul>
          {result.automatedVersion && <p className="mt-2 text-2xs text-ink-subtle">Assessed by {result.automatedVersion}. The same evidence always gives the same result.</p>}
        </div>
      )}
      {result.feedback && (result.feedback.summary || result.feedback.strengths || result.feedback.mistakes || result.feedback.recommendations) && (
        <div className="panel-instrument p-4">
          <p className="readout-label">Instructor feedback</p>
          <dl className="mt-2 space-y-3 text-sm">
            {(['summary', 'strengths', 'mistakes', 'recommendations'] as const).map((k) => result.feedback && result.feedback[k] ? (
              <div key={k}>
                <dt className="text-xs font-semibold capitalize text-ink-subtle">{k === 'summary' ? 'Overall' : k}</dt>
                <dd className="mt-0.5 whitespace-pre-line text-ink">{result.feedback[k]}</dd>
              </div>
            ) : null)}
          </dl>
        </div>
      )}
    </div>
  );
}

const CLOSE: Record<string, string> = { manual: 'Closed manually', stop_loss: 'Stop-loss', take_profit: 'Take-profit', margin_call: 'Margin call', expired: 'Expired' };

/** Simulator trades as frozen evidence (or selectable when `selected`/`onToggle` are given). */
export function TradeTable({ trades, selected, onToggle, empty }: { trades: TradeEvidence[]; selected?: string[]; onToggle?: (id: string) => void; empty?: ReactNode }) {
  if (!trades.length) return <>{empty || <p className="text-sm text-ink-muted">No simulator trades.</p>}</>;
  return (
    <div className="overflow-x-auto rounded-panel border border-line bg-surface-1">
      <table className="table-orbit w-full text-sm">
        <thead>
          <tr>{onToggle && <th className="w-10"><span className="sr-only">Attach</span></th>}<th>Trade</th><th className="hidden sm:table-cell">Order</th><th className="text-right">Entry</th><th className="text-right">Stop</th><th className="hidden text-right sm:table-cell">Target</th><th className="hidden text-right md:table-cell">Planned risk</th><th className="hidden md:table-cell">Status</th></tr>
        </thead>
        <tbody>
          {trades.map((t) => {
            const on = selected ? selected.includes(t.positionId) : false;
            return (
              <tr key={t.positionId} className={on ? 'bg-[color-mix(in_srgb,var(--fo-brand)_8%,transparent)]' : undefined}>
                {onToggle && <td><input type="checkbox" className="h-4 w-4 accent-[var(--fo-brand)]" checked={on} onChange={() => onToggle(t.positionId)} aria-label={`Attach ${pair(t.instrument)} ${t.side} opened ${formatDate(t.openedAt, true)}`} /></td>}
                <td>
                  <span className="font-medium text-ink">{pair(t.instrument)}</span> <span className={`text-xs font-semibold uppercase ${t.side === 'buy' ? 'text-up' : 'text-down'}`}>{t.side}</span>
                  <span className="block text-2xs text-ink-subtle num">{t.units.toLocaleString()} units · {formatDate(t.openedAt, true)}</span>
                </td>
                <td className="hidden capitalize sm:table-cell">{t.orderType || '-'}</td>
                <td className="text-right num">{t.entry || '-'}</td>
                <td className="text-right num">{t.stopLoss || '-'}</td>
                <td className="hidden text-right num sm:table-cell">{t.takeProfit || '-'}</td>
                <td className="hidden text-right num md:table-cell">{t.plannedRisk ? `$${t.plannedRisk}` : '-'}</td>
                <td className="hidden md:table-cell"><span className="text-xs text-ink-muted">{t.status === 'closed' ? `${CLOSE[t.closeReason || ''] || 'Closed'}${t.realizedPl ? ` · ${t.realizedPl.startsWith('-') ? '' : '+'}${t.realizedPl}` : ''}` : 'Open'}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Student-reported external trade details, always labelled unverified. */
export function ExternalDetails({ external }: { external: ExternalEvidence }) {
  const rows: Array<[string, string | undefined]> = [['Platform', external.broker], ['Instrument', external.instrument ? pair(external.instrument) : undefined], ['Direction', external.side], ['Entry', external.entry], ['Exit', external.exit], ['Stop-loss', external.stopLoss], ['Take-profit', external.takeProfit], ['Opened', external.openedAt ? formatDate(external.openedAt, true) : undefined], ['Closed', external.closedAt ? formatDate(external.closedAt, true) : undefined]];
  return (
    <div className="rounded-panel border border-dashed border-line-strong bg-surface-1 p-4">
      <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">External trade details <span className="chip">Student-reported · not verified</span></p>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
        {rows.filter(([, v]) => v).map(([k, v]) => <div key={k}><dt className="text-2xs uppercase tracking-wide text-ink-subtle">{k}</dt><dd className="num capitalize text-ink">{v}</dd></div>)}
      </dl>
      {external.notes && <p className="mt-3 whitespace-pre-line text-sm text-ink-muted">{external.notes}</p>}
    </div>
  );
}

export function SimulatedNote() {
  return <span className="sim-badge">Simulated</span>;
}
