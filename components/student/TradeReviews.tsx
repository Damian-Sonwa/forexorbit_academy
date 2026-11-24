/**
 * Trade reviews: the practice desk's journal.
 *
 * Every closed simulator trade can be reviewed once (saving again updates it). The trade's figures
 * are shown read-only, exactly as the server recorded them; the student writes only the reflection.
 * The note written on the order ticket is shown beside it. Entries from the old hand-typed journal
 * stay visible, read-only, under "Earlier journal entries".
 */

import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';

type Trade = {
  positionId: string;
  instrument: string;
  side: string;
  units: string;
  entry: string;
  exit: string | null;
  stopLoss: string;
  takeProfit: string | null;
  realizedPl: string | null;
  closeReason: string | null;
  openedAt: string | null;
  closedAt: string | null;
  planNote: string | null;
};
type Feedback = { strengths: string[]; mistakes: string[]; suggestions: string[]; riskReward: string };
type Review = {
  id: string;
  setup: string;
  followedPlan: string;
  confidence: number;
  emotion: string | null;
  reason: string;
  lesson: string;
  screenshot: string | null;
  taskId: string | null;
  aiFeedback: Feedback | null;
  updatedAt: string | null;
};
type Row = { trade: Trade; review: Review | null };
type Listing = { rows: Row[]; counts: { reviewed: number; pending: number }; pagination: { page: number; pages: number; total: number } };
type Filter = 'pending' | 'reviewed' | 'all';

export type LegacyJournalEntry = {
  _id: string;
  pair: string;
  direction: 'buy' | 'sell';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  lotSize: number;
  result: string;
  profitLoss?: number;
  notes?: string;
  createdAt: string;
};

interface Props {
  tasks: Array<{ _id: string; title: string }>;
  legacyEntries?: LegacyJournalEntry[];
  onOpenDesk?: () => void;
}

const SETUPS: Array<[string, string]> = [['trend', 'Trend'], ['breakout', 'Breakout'], ['range', 'Range'], ['reversal', 'Reversal'], ['news', 'News'], ['other', 'Other']];
const PLAN: Array<[string, string]> = [['yes', 'Yes'], ['partly', 'Partly'], ['no', 'No']];
const EMOTIONS = ['calm', 'confident', 'anxious', 'impatient', 'frustrated', 'excited'];
const REASONS: Record<string, string> = { manual: 'Closed by you', stop_loss: 'Stop-loss', take_profit: 'Take-profit', stop_out: 'Stop-out' };
const EMPTY = { setup: '', followedPlan: '', confidence: 0, emotion: '', reason: '', lesson: '', screenshot: '', taskId: '' };

const pair = (id: string) => id.replace('_', '/');
const signTone = (value: string | null) => (!value ? 'text-ink' : value.startsWith('-') ? 'text-down' : /^0(\.0+)?$/.test(value) ? 'text-ink' : 'text-up');
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '-');
const errorText = (err: unknown, fallback: string) =>
  (err as { response?: { data?: { error?: string } } })?.response?.data?.error || (err instanceof Error && err.message) || fallback;
const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function Choice({ name, options, value, onChange }: { name: string; options: Array<[string, string]>; value: string; onChange: (v: string) => void }) {
  return (
    <div role="radiogroup" aria-label={name} className="flex flex-wrap gap-1.5">
      {options.map(([id, label]) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={value === id}
          onClick={() => onChange(id)}
          className={`min-h-[40px] rounded-lg border px-3 text-sm font-medium transition-colors ${value === id ? 'border-primary-500 bg-tint text-ink' : 'border-line text-ink-muted hover:border-line-strong hover:text-ink'}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function TradeFacts({ trade }: { trade: Trade }) {
  const cells: Array<[string, string, string?]> = [
    ['Entry', trade.entry],
    ['Exit', trade.exit ?? '-'],
    ['Stop-loss', trade.stopLoss],
    ['Take-profit', trade.takeProfit ?? 'None'],
    ['Result', trade.realizedPl ? `${trade.realizedPl} USD` : '-', signTone(trade.realizedPl)],
    ['Closed by', REASONS[trade.closeReason || ''] || '-'],
  ];
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-[var(--fo-line)] sm:grid-cols-3">
      {cells.map(([label, value, tone]) => (
        <div key={label} className="bg-surface-2 px-3 py-2.5">
          <dt className="readout-label">{label}</dt>
          <dd className={`mt-0.5 text-sm font-semibold num ${tone || 'text-ink'}`}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function FeedbackPanel({ feedback }: { feedback: Feedback }) {
  const groups: Array<[string, string[]]> = [['What went well', feedback.strengths], ['To improve', feedback.mistakes], ['Next time', feedback.suggestions]];
  return (
    <div className="notice notice-brand !block space-y-3 text-sm" data-testid="review-feedback">
      <p className="readout-label">AI feedback · educational only</p>
      <div className="grid gap-3 sm:grid-cols-3">
        {groups.map(([title, items]) => (
          <div key={title}>
            <p className="font-semibold text-ink">{title}</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-ink-muted">{items.map((item, i) => <li key={i}>{item}</li>)}</ul>
          </div>
        ))}
      </div>
      {feedback.riskReward && <p className="text-ink-muted"><span className="font-semibold text-ink">Stop and target: </span>{feedback.riskReward}</p>}
    </div>
  );
}

export default function TradeReviews({ tasks, legacyEntries = [], onOpenDesk }: Props) {
  const [filter, setFilter] = useState<Filter>('pending');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Listing | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [showLegacy, setShowLegacy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get<Listing>(`/trading/reviews?status=${filter}&page=${page}`);
      setData(res);
      setLoadError(null);
    } catch (err) {
      setLoadError(errorText(err, 'Your trades could not be loaded.'));
    }
  }, [filter, page]);

  useEffect(() => { void load(); }, [load]);

  const open = (row: Row) => {
    if (openId === row.trade.positionId) { setOpenId(null); return; }
    setOpenId(row.trade.positionId);
    setFormError(null);
    setSaved(null);
    const r = row.review;
    setForm(r ? { setup: r.setup, followedPlan: r.followedPlan, confidence: r.confidence, emotion: r.emotion || '', reason: r.reason, lesson: r.lesson, screenshot: r.screenshot || '', taskId: r.taskId || '' } : EMPTY);
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setFormError(null);
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await apiClient.post<{ url: string; imageUrl?: string }>('/demo-trading/journal/upload', body);
      setForm((f) => ({ ...f, screenshot: res.imageUrl || res.url }));
    } catch (err) {
      setFormError(errorText(err, 'The screenshot could not be uploaded.'));
    } finally {
      setUploading(false);
    }
  };

  const save = async (event: React.FormEvent, positionId: string) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setFormError(null);
    try {
      const res = await apiClient.put<{ review: Review; trade: Trade }>(`/trading/reviews/${positionId}`, {
        setup: form.setup,
        followedPlan: form.followedPlan,
        confidence: form.confidence,
        emotion: form.emotion || null,
        reason: form.reason,
        lesson: form.lesson,
        screenshot: form.screenshot || null,
        taskId: form.taskId || null,
      });
      setSaved(positionId);
      setData((d) => d && { ...d, rows: d.rows.map((row) => (row.trade.positionId === positionId ? { trade: res.trade, review: res.review } : row)) });
      // Refresh the counts; a just-reviewed trade leaves the "To review" list on the next load.
      const fresh = await apiClient.get<Listing>(`/trading/reviews?status=${filter}&page=${page}`).catch(() => null);
      if (fresh) setData((d) => (d ? { ...d, counts: fresh.counts } : fresh));
    } catch (err) {
      setFormError(errorText(err, 'The review was not saved.'));
    } finally {
      setSaving(false);
    }
  };

  const counts = data?.counts;
  const tabs: Array<[Filter, string, number | undefined]> = [['pending', 'To review', counts?.pending], ['reviewed', 'Reviewed', counts?.reviewed], ['all', 'All closed trades', counts ? counts.pending + counts.reviewed : undefined]];

  return (
    <div className="space-y-6">
      <div className="card !p-5 sm:!p-7">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="section-title">Review your trades</h2>
          </div>
          {counts && (
            <dl className="flex gap-6">
              <div><dt className="readout-label">To review</dt><dd className="readout-value text-caution num" data-testid="reviews-pending">{counts.pending}</dd></div>
              <div><dt className="readout-label">Reviewed</dt><dd className="readout-value num" data-testid="reviews-done">{counts.reviewed}</dd></div>
            </dl>
          )}
        </div>

        <div className="mt-6 flex gap-1 overflow-x-auto rounded-xl border border-line bg-surface-2 p-1" role="tablist" aria-label="Which trades">
          {tabs.map(([id, label, count]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={filter === id}
              onClick={() => { setFilter(id); setPage(1); setOpenId(null); }}
              className={`min-h-[40px] shrink-0 rounded-lg px-3.5 text-sm font-medium transition-colors ${filter === id ? 'bg-surface-1 text-ink shadow-panel' : 'text-ink-muted hover:text-ink'}`}
            >
              {label}{typeof count === 'number' && <span className="ml-1.5 text-ink-subtle num">{count}</span>}
            </button>
          ))}
        </div>

        {loadError && <p className="notice notice-caution mt-4 text-sm" role="alert">{loadError}</p>}
        {!data && !loadError && <p className="mt-6 text-sm text-ink-subtle">Loading your trades…</p>}

        {data && data.rows.length === 0 && (
          <div className="mt-6 rounded-xl border border-dashed border-line-strong px-6 py-10 text-center" data-testid="reviews-empty">
            <p className="font-display text-base font-semibold text-ink">
              {filter === 'pending' && data.counts.reviewed > 0 ? 'Every closed trade is reviewed.' : 'No closed trades yet.'}
            </p>
            <p className="mx-auto mt-1 max-w-md text-sm text-ink-muted">
              {filter === 'pending' && data.counts.reviewed > 0 ? 'New trades appear here when they close.' : 'Place a trade on the practice desk. When it closes, it appears here for review.'}
            </p>
            {onOpenDesk && <button type="button" onClick={onOpenDesk} className="btn btn-secondary btn-sm mt-4">Open the practice desk →</button>}
          </div>
        )}

        {data && data.rows.length > 0 && (
          <ul className="mt-5 space-y-2" data-testid="reviews-list">
            {data.rows.map((row) => {
              const t = row.trade;
              const isOpen = openId === t.positionId;
              return (
                <li key={t.positionId} className={`rounded-xl border transition-colors ${isOpen ? 'border-line-strong bg-surface-2' : 'border-line hover:border-line-strong'}`}>
                  <button type="button" onClick={() => open(row)} aria-expanded={isOpen} className="flex min-h-[60px] w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left">
                    <span className={`chip ${t.side === 'buy' ? 'chip-up' : 'chip-down'} uppercase`}>{t.side}</span>
                    <span className="font-display font-semibold text-ink">{pair(t.instrument)}</span>
                    <span className="text-xs text-ink-subtle num">{Number(t.units).toLocaleString()} units · {when(t.closedAt)}</span>
                    <span className={`ml-auto text-sm font-semibold num ${signTone(t.realizedPl)}`}>{t.realizedPl ? `${t.realizedPl} USD` : '-'}</span>
                    <span className={`chip ${row.review ? '' : 'chip-brand'}`}>{row.review ? 'Reviewed' : 'Review'}</span>
                  </button>

                  {isOpen && (
                    <form onSubmit={(e) => save(e, t.positionId)} className="animate-fade-in-fast space-y-5 border-t border-line px-4 pb-5 pt-4" data-testid="review-form">
                      <div>
                        <p className="readout-label mb-2">As recorded by the simulator</p>
                        <TradeFacts trade={t} />
                        <p className="mt-2 text-xs text-ink-subtle">Opened {when(t.openedAt)} · closed {when(t.closedAt)}. Simulated figures; they cannot be edited.</p>
                      </div>

                      <div className="rounded-xl border border-line bg-surface-1 px-4 py-3">
                        <p className="readout-label">Your plan before the trade</p>
                        <p className="mt-1 whitespace-pre-wrap text-sm text-ink" data-testid="review-plan-note">{t.planNote || <span className="text-ink-subtle">No note was written on the order ticket.</span>}</p>
                      </div>

                      <fieldset className="space-y-2">
                        <legend className="label">Setup</legend>
                        <Choice name="Setup" options={SETUPS} value={form.setup} onChange={(v) => setForm({ ...form, setup: v })} />
                      </fieldset>

                      <label className="block">
                        <span className="label">Why did you enter?</span>
                        <textarea className="input mt-1.5 min-h-[88px] resize-y" maxLength={1500} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="What you saw on the chart and why it was a reason to trade" required />
                      </label>

                      <div className="grid gap-5 sm:grid-cols-2">
                        <fieldset className="space-y-2">
                          <legend className="label">Did you follow your plan?</legend>
                          <Choice name="Followed plan" options={PLAN} value={form.followedPlan} onChange={(v) => setForm({ ...form, followedPlan: v })} />
                        </fieldset>
                        <fieldset className="space-y-2">
                          <legend className="label">Confidence (1 low, 5 high)</legend>
                          <Choice name="Confidence" options={[1, 2, 3, 4, 5].map((n) => [String(n), String(n)])} value={form.confidence ? String(form.confidence) : ''} onChange={(v) => setForm({ ...form, confidence: Number(v) })} />
                        </fieldset>
                      </div>

                      <fieldset className="space-y-2">
                        <legend className="label">How did you feel? (optional)</legend>
                        <Choice name="Emotion" options={EMOTIONS.map((e) => [e, cap(e)])} value={form.emotion} onChange={(v) => setForm({ ...form, emotion: form.emotion === v ? '' : v })} />
                      </fieldset>

                      <label className="block">
                        <span className="label">What did you learn, or what would you do differently?</span>
                        <textarea className="input mt-1.5 min-h-[88px] resize-y" maxLength={1500} value={form.lesson} onChange={(e) => setForm({ ...form, lesson: e.target.value })} required />
                      </label>

                      <div className="grid gap-5 sm:grid-cols-2">
                        <label className="block">
                          <span className="label">Chart screenshot (optional)</span>
                          <input type="file" accept="image/png,image/jpeg,image/webp" className="input mt-1.5 !py-2 text-sm" disabled={uploading || saving} onChange={(e) => void upload(e.target.files?.[0])} />
                          {uploading && <span className="mt-1 block text-xs text-ink-subtle">Uploading…</span>}
                          {form.screenshot && !uploading && (
                            <span className="mt-2 flex items-center gap-3">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={form.screenshot} alt="Your chart screenshot" className="h-16 w-28 rounded-md border border-line object-cover" />
                              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setForm({ ...form, screenshot: '' })}>Remove</button>
                            </span>
                          )}
                        </label>
                        <label className="block">
                          <span className="label">Link to a task (optional)</span>
                          <select className="input mt-1.5" value={form.taskId} onChange={(e) => setForm({ ...form, taskId: e.target.value })}>
                            <option value="">Not linked</option>
                            {tasks.map((task) => <option key={task._id} value={task._id}>{task.title}</option>)}
                          </select>
                          <span className="mt-1 block text-xs text-ink-subtle">A linked review is shared with the instructor who set the task.</span>
                        </label>
                      </div>

                      {formError && <p className="notice notice-caution text-sm" role="alert">{formError}</p>}
                      {saved === t.positionId && !formError && <p className="text-sm text-up" role="status">Review saved.</p>}

                      <div className="flex flex-wrap gap-2">
                        <button type="submit" className="btn btn-primary" disabled={saving || uploading || !form.setup || !form.followedPlan || !form.confidence}>
                          {saving ? 'Saving…' : row.review ? 'Update review' : 'Save review'}
                        </button>
                        <button type="button" className="btn btn-ghost" onClick={() => setOpenId(null)}>Close</button>
                      </div>

                      {row.review?.aiFeedback && <FeedbackPanel feedback={row.review.aiFeedback} />}
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {data && data.pagination.pages > 1 && (
          <div className="mt-4 flex items-center justify-between text-sm text-ink-muted">
            <button type="button" className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
            <span className="num">Page {data.pagination.page} of {data.pagination.pages}</span>
            <button type="button" className="btn btn-secondary btn-sm" disabled={page >= data.pagination.pages} onClick={() => setPage((p) => p + 1)}>Next</button>
          </div>
        )}
      </div>

      {legacyEntries.length > 0 && (
        <div className="card !p-5 sm:!p-6">
          <button type="button" onClick={() => setShowLegacy((v) => !v)} aria-expanded={showLegacy} className="flex min-h-[44px] w-full items-center justify-between text-left">
            <span>
              <span className="section-title block">Earlier journal entries</span>
              <span className="text-xs text-ink-subtle">{legacyEntries.length} typed by hand before trade reviews. Kept for reference; their figures were not recorded by the simulator.</span>
            </span>
            <span className="text-ink-subtle" aria-hidden>{showLegacy ? '−' : '+'}</span>
          </button>
          {showLegacy && (
            <div className="mt-4 overflow-x-auto">
              <table className="table-orbit w-full text-sm" data-testid="legacy-journal">
                <thead><tr><th>Date</th><th>Pair</th><th>Side</th><th>Entry</th><th>Stop</th><th>Target</th><th>Result</th><th>Notes</th></tr></thead>
                <tbody>
                  {legacyEntries.map((e) => (
                    <tr key={e._id}>
                      <td className="whitespace-nowrap">{when(e.createdAt)}</td>
                      <td>{e.pair}</td>
                      <td className="uppercase">{e.direction}</td>
                      <td className="num">{e.entryPrice}</td>
                      <td className="num">{e.stopLoss}</td>
                      <td className="num">{e.takeProfit}</td>
                      <td>{cap(e.result)}{typeof e.profitLoss === 'number' ? ` (${e.profitLoss})` : ''}</td>
                      <td className="max-w-xs truncate">{e.notes || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
