/**
 * Trade reviews students linked to your tasks (GET /api/trading/reviews/instructor). The trade's
 * figures are the simulator's record; the reasoning is the student's. Read-only.
 */

import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';

type Row = {
  student: string;
  task: string | null;
  trade: { positionId: string; instrument: string; side: string; units: string; entry: string; exit: string | null; stopLoss: string; takeProfit: string | null; realizedPl: string | null; closeReason: string | null; closedAt: string | null; planNote: string | null };
  review: { id: string; setup: string; followedPlan: string; confidence: number; emotion: string | null; reason: string; lesson: string; screenshot: string | null; updatedAt: string | null } | null;
};

const REASONS: Record<string, string> = { manual: 'Closed by student', stop_loss: 'Stop-loss', take_profit: 'Take-profit', stop_out: 'Stop-out' };
const PLAN: Record<string, string> = { yes: 'Followed plan', partly: 'Partly followed plan', no: 'Did not follow plan' };
const tone = (v: string | null) => (!v ? 'text-ink' : v.startsWith('-') ? 'text-down' : /^0(\.0+)?$/.test(v) ? 'text-ink' : 'text-up');
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

export default function TaskTradeReviews() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    apiClient.get<{ rows: Row[] }>('/trading/reviews/instructor')
      .then((res) => setRows(res.rows))
      .catch(() => setError('Trade reviews could not be loaded.'));
  }, []);

  return (
    <section className="card mt-6 !p-5 sm:!p-6" aria-labelledby="task-trade-reviews">
      <p className="page-kicker">Practice desk</p>
      <h2 id="task-trade-reviews" className="section-title mt-2">Trade reviews linked to your tasks</h2>
      <p className="mt-1 text-sm text-ink-muted">Closed simulator trades, with the figures the simulator recorded and the student&apos;s own reasoning. Simulated trades, virtual funds.</p>

      {error && <p className="notice notice-caution mt-4 text-sm" role="alert">{error}</p>}
      {!rows && !error && <p className="mt-4 text-sm text-ink-subtle">Loading…</p>}
      {rows && rows.length === 0 && <p className="mt-4 text-sm text-ink-subtle" data-testid="staff-reviews-empty">No student has linked a trade review to your tasks yet.</p>}

      {rows && rows.length > 0 && (
        <ul className="mt-4 space-y-2" data-testid="staff-reviews">
          {rows.map(({ student, task, trade, review }) => {
            const open = openId === trade.positionId;
            return (
              <li key={trade.positionId} className={`rounded-xl border ${open ? 'border-line-strong bg-surface-2' : 'border-line'}`}>
                <button type="button" aria-expanded={open} onClick={() => setOpenId(open ? null : trade.positionId)} className="flex min-h-[56px] w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left">
                  <span className="font-semibold text-ink">{student}</span>
                  <span className="text-xs text-ink-subtle">{task || 'Task'}</span>
                  <span className={`chip ${trade.side === 'buy' ? 'chip-up' : 'chip-down'} uppercase`}>{trade.side}</span>
                  <span className="text-sm text-ink">{trade.instrument.replace('_', '/')}</span>
                  <span className={`ml-auto text-sm font-semibold num ${tone(trade.realizedPl)}`}>{trade.realizedPl ? `${trade.realizedPl} USD` : '-'}</span>
                </button>
                {open && review && (
                  <div className="space-y-3 border-t border-line px-4 pb-4 pt-3 text-sm">
                    <p className="text-ink-muted num">
                      {Number(trade.units).toLocaleString()} units · entry {trade.entry} · exit {trade.exit ?? '-'} · stop {trade.stopLoss} · target {trade.takeProfit ?? 'none'} · {REASONS[trade.closeReason || ''] || 'Closed'}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      <span className="chip">{cap(review.setup)}</span>
                      <span className="chip">{PLAN[review.followedPlan] || review.followedPlan}</span>
                      <span className="chip">Confidence {review.confidence}/5</span>
                      {review.emotion && <span className="chip">{cap(review.emotion)}</span>}
                    </div>
                    <div><p className="readout-label">Plan before the trade</p><p className="mt-0.5 whitespace-pre-wrap text-ink">{trade.planNote || '-'}</p></div>
                    <div><p className="readout-label">Why they entered</p><p className="mt-0.5 whitespace-pre-wrap text-ink">{review.reason}</p></div>
                    <div><p className="readout-label">Lesson</p><p className="mt-0.5 whitespace-pre-wrap text-ink">{review.lesson}</p></div>
                    {review.screenshot && (
                      <a href={review.screenshot} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm">View chart screenshot</a>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
