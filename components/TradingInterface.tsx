/**
 * Practice trading desk (Phase 10). This component only presents what the server decides: every
 * balance, price, margin and result arrives as a finished decimal string and is shown as it is.
 * Nothing financial is computed in the browser. An order key is kept across a network failure, so
 * retrying cannot trade twice, and a new key is used only after the server has answered.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, Plus } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import CandleChart from '@/components/trading/CandleChart';

type Instrument = { id: string; label: string; bid: string | null; ask: string | null; spreadPips: string | null; time: string | null; unavailable: string | null };
type Market = { open: boolean; reason: string | null; label: string; message: string | null; simulatedTime: string | null; sessions: string[]; nextOpen: string | null; dataset: { name: string; source: string; testFixture: boolean } | null; instruments: Instrument[] };
type Account = { virtual: true; currency: string; generation: number; startingBalance: string; balance: string; equity: string | null; usedMargin: string; freeMargin: string | null; marginLevel: string | null; unrealizedPl: string | null; marginCall: boolean; leverage: string; lastResetAt: string | null; nextResetAt: string | null; leaderboardOptIn: boolean };
type Position = { id: string; instrument: string; side: string; units: string; entry: string; stopLoss: string; takeProfit: string | null; margin: string; currentPrice: string | null; unrealizedPl: string | null; exit: string | null; realizedPl: string | null; closeReason: string | null; closedAt: string | null };
type Order = { id: string; type: string; instrument: string; side: string; units: string; price: string | null; stopLoss: string | null; status: string; rejectMessage: string | null; fillPrice: string | null; expiresAt: string | null; createdAt: string };
type View = { account: Account | null; market: Market; positions: Position[]; pendingOrders: Order[] };
type Performance = { closedTrades: number; wins: number; losses: number; winRate: string | null; netResult: string; returnPercent: string | null; maxDrawdownPercent: string | null };
type Board = { minimumTrades: number; rows: { rank: number; alias: string; returnPercent: string; maxDrawdownPercent: string | null; closedTrades: number; you: boolean }[] };
type Paged<T> = { rows: T[]; pagination: { page: number; pages: number; total: number } };
type Execution = { id: string; kind: string; instrument: string | null; side: string | null; units: string | null; price: string | null; realizedPl: string | null; reason: string | null; simulatedAt: string | null };
type Generation = { id: string; generation: number; status: string; startingBalance: string; balance: string; closedTrades: number; openedAt: string | null; archivedAt: string | null };
type Preview = { entry: string; margin: string; plannedRisk: string; riskPercent: string | null; allowed: boolean; reason: string | null };
type Candle = { time: string; open: string; high: string; low: string; close: string; complete: boolean };
type LedgerRow = { id: string; seq: number; type: string; amount: string; balanceAfter: string; reference: string; createdAt: string };

const EMPTY_FORM = { type: 'market', instrument: 'EUR_USD', side: 'buy', units: '1000', price: '', stopLoss: '', takeProfit: '', expiryHours: '24', note: '' };
const TIMEFRAMES = ['M1', 'M5', 'M15', 'H1', 'H4', 'D1'];
const HISTORY_TABS: { id: HistoryTab; label: string }[] = [
  { id: 'positions', label: 'Closed trades' },
  { id: 'orders', label: 'Orders' },
  { id: 'executions', label: 'Executions' },
  { id: 'ledger', label: 'Ledger' },
  { id: 'resets', label: 'Accounts' },
];
type ActivityView = 'positions' | 'pending' | 'history';
type HistoryTab = 'orders' | 'positions' | 'ledger' | 'executions' | 'resets';
const REASONS: Record<string, string> = { manual: 'Closed by you', stop_loss: 'Stop-loss', take_profit: 'Take-profit', stop_out: 'Stop-out' };
// Orbit Instrument styles (styles/globals.css). Every control is at least 44 px tall.
const card = 'card !p-5';
const input = 'input mt-1.5 !text-ink num';
const field = 'block text-xs font-medium text-ink-muted';
const small = 'btn btn-secondary min-h-[44px] px-4';

function messageOf(err: unknown, fallback: string) {
  const ax = err as { response?: { data?: { error?: string; order?: { rejectMessage?: string } } } };
  if (!ax?.response) return 'Could not reach the server. Nothing is confirmed yet: check your orders, then try again.';
  return ax.response.data?.order?.rejectMessage || ax.response.data?.error || fallback;
}

function Figure({ label, value, id, tone = 'text-ink' }: { label: string; value: string; id?: string; tone?: string }) {
  return (
    <div data-testid={id} className="bg-surface-1 px-4 py-3">
      <p className="readout-label">{label}</p>
      <p className={`mt-0.5 break-words font-display text-base font-semibold tracking-tight num ${tone}`}>{value}</p>
    </div>
  );
}

/** `panel` shows the trading desk or the results; both keep their state. `initialInstrument` preselects the order ticket's instrument (a practical task opens the desk on its pair). */
export default function TradingInterface({ initialInstrument, panel = 'trade' }: { initialInstrument?: string; panel?: 'trade' | 'results' } = {}) {
  const [view, setView] = useState<View | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [form, setForm] = useState(() => (initialInstrument && /^[A-Z]{3}_[A-Z]{3}$/.test(initialInstrument) ? { ...EMPTY_FORM, instrument: initialInstrument } : EMPTY_FORM));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [tab, setTab] = useState<HistoryTab>('positions');
  const [records, setRecords] = useState<Paged<Order | Position | LedgerRow | Execution | Generation> | null>(null);
  const [timeframe, setTimeframe] = useState('M5');
  const [candles, setCandles] = useState<Candle[]>([]);
  const [preview, setPreview] = useState<{ figures: Preview | null; message: string | null }>({ figures: null, message: null });
  const [page, setPage] = useState(1);
  const [performance, setPerformance] = useState<Performance | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [activity, setActivity] = useState<ActivityView>('positions');
  const [showRules, setShowRules] = useState(false);
  const [showNote, setShowNote] = useState(false);
  const orderKey = useRef<string | null>(null);
  // The query string arrives after the first render (static page), so follow it once it does.
  useEffect(() => {
    if (initialInstrument && /^[A-Z]{3}_[A-Z]{3}$/.test(initialInstrument)) setForm((f) => ({ ...f, instrument: initialInstrument }));
  }, [initialInstrument]);

  const load = useCallback(async () => {
    try {
      setView(await apiClient.get<View>('/trading/account'));
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, []);

  const loadRecords = useCallback(async () => {
    try {
      const url = tab === 'orders' ? `/trading/orders?page=${page}&limit=10` : `/trading/history?kind=${tab}&page=${page}&limit=10`;
      const [list, stats, ranks] = await Promise.all([
        apiClient.get<Paged<Order | Position | LedgerRow | Execution | Generation>>(url),
        apiClient.get<Performance>('/trading/performance'),
        apiClient.get<Board>('/trading/leaderboard'),
      ]);
      setRecords(list);
      setPerformance(stats);
      setBoard(ranks);
    } catch {
      setRecords(null);
    }
  }, [tab, page]);

  useEffect(() => { void load(); }, [load]);

  const hasMarket = Boolean(view?.market.simulatedTime);
  useEffect(() => {
    if (!hasMarket) { setCandles([]); return undefined; }
    let live = true;
    const read = () => apiClient.get<{ candles: Candle[] }>(`/trading/candles?instrument=${form.instrument}&timeframe=${timeframe}&count=120`)
      .then((res) => { if (live) setCandles(res.candles); })
      .catch(() => { if (live) setCandles([]); });
    void read();
    const timer = window.setInterval(() => void read(), 30000);
    return () => { live = false; window.clearInterval(timer); };
  }, [hasMarket, form.instrument, timeframe]);

  // Risk preview: the server works out the figures, from the same rules that place the order.
  useEffect(() => {
    if (!form.stopLoss.trim() || !form.units.trim()) { setPreview({ figures: null, message: null }); return undefined; }
    const timer = window.setTimeout(() => {
      const query = new URLSearchParams({ type: form.type, instrument: form.instrument, side: form.side, units: form.units.trim(), stopLoss: form.stopLoss.trim() });
      if (form.takeProfit.trim()) query.set('takeProfit', form.takeProfit.trim());
      if (form.type !== 'market' && form.price.trim()) query.set('price', form.price.trim());
      apiClient.get<{ preview: Preview }>(`/trading/preview?${query.toString()}`)
        .then((res) => setPreview({ figures: res.preview, message: null }))
        .catch((err) => setPreview({ figures: null, message: messageOf(err, 'No preview is available.') }));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [form.type, form.instrument, form.side, form.units, form.stopLoss, form.takeProfit, form.price]);
  useEffect(() => {
    const timer = window.setInterval(() => void load(), 15000);
    return () => window.clearInterval(timer);
  }, [load]);
  const hasAccount = Boolean(view?.account);
  useEffect(() => { if (hasAccount) void loadRecords(); }, [hasAccount, loadRecords]);

  const refresh = async () => {
    await load();
    await loadRecords();
  };

  const act = async (work: () => Promise<unknown>, done: string, fallback: string) => {
    setBusy(true);
    setNotice(null);
    try {
      await work();
      setNotice({ kind: 'ok', text: done });
    } catch (err) {
      setNotice({ kind: 'error', text: messageOf(err, fallback) });
    } finally {
      await refresh();
      setBusy(false);
    }
  };

  const placeOrder = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!orderKey.current) orderKey.current = crypto.randomUUID();
    setBusy(true);
    setNotice(null);
    try {
      const pending = form.type !== 'market';
      const res = await apiClient.post<{ order: Order }>('/trading/orders', {
        clientOrderId: orderKey.current,
        type: form.type,
        instrument: form.instrument,
        side: form.side,
        units: form.units.trim(),
        stopLoss: form.stopLoss.trim(),
        takeProfit: form.takeProfit.trim() || undefined,
        ...(pending ? { price: form.price.trim(), expiryHours: Number(form.expiryHours) } : {}),
        ...(form.note.trim() ? { note: form.note.trim() } : {}),
      });
      orderKey.current = null;
      setNotice({ kind: 'ok', text: res.order.status === 'pending' ? 'Pending order placed. Simulated, virtual funds.' : `Filled at ${res.order.fillPrice}. Simulated execution, virtual funds.` });
      setForm({ ...EMPTY_FORM, instrument: form.instrument });
      setShowNote(false);
      setActivity(res.order.status === 'pending' ? 'pending' : 'positions');
    } catch (err) {
      // The server answered, so this attempt is finished; only a lost connection keeps the key.
      if ((err as { response?: unknown })?.response) orderKey.current = null;
      setNotice({ kind: 'error', text: messageOf(err, 'The order was not placed.') });
    } finally {
      await refresh();
      setBusy(false);
    }
  };

  if (!view) {
    return loadFailed
      ? <div role="alert" className={card}><p className="text-sm text-ink">The practice desk could not be loaded.</p><button type="button" className={`${small} mt-3`} onClick={() => void load()}>Try again</button></div>
      : (
        <div role="status" className="space-y-4" aria-label="Loading the practice desk">
          <span className="sr-only">Loading the practice desk…</span>
          <div className="orbit-skeleton h-10 w-72 rounded-full" />
          <div className="grid gap-3 sm:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="orbit-skeleton h-24 rounded-panel" />)}</div>
          <div className="orbit-skeleton h-72 rounded-panel" />
        </div>
      );
  }

  const { account, market, positions, pendingOrders } = view;
  const usd = (value: string | null) => (value === null ? 'Unavailable' : `${value} USD`);
  // Presentation only: the server's signed decimal string decides the tone, nothing is computed.
  const tone = (value: string | null) => (value === null ? 'text-ink' : value.trim().startsWith('-') ? 'text-down' : /^0(\.0+)?$/.test(value.trim()) ? 'text-ink' : 'text-up');
  const pair = (id: string) => id.replace('_', '/');

  return (
    <div className="space-y-4" data-testid="practice-desk">
      {notice && (
        <p
          role={notice.kind === 'error' ? 'alert' : 'status'}
          className={`notice !py-3 text-sm font-medium ${notice.kind === 'error' ? '!border-[color-mix(in_srgb,var(--fo-down)_40%,transparent)] !text-down' : '!border-[color-mix(in_srgb,var(--fo-up)_40%,transparent)] !text-up'}`}
          data-testid="desk-notice"
        >
          {notice.text}
        </p>
      )}

      <div className={panel === 'trade' ? 'space-y-4' : 'hidden'}>{renderTrade()}</div>
      <div className={panel === 'results' ? 'space-y-5' : 'hidden'}>{renderResults()}</div>
    </div>
  );

  /** One line that says what this is; the rules and risks open on request. */
  function renderStatus() {
    return (
      <section className="rounded-panel border border-line bg-surface-1" aria-label="Market status" data-testid="market-status">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 text-xs text-ink-muted">
          <p className="sim-badge !whitespace-normal" data-testid="market-label">{market.label}</p>
          {market.open
            ? (
              <p className="flex items-center gap-2" data-testid="market-clock">
                <span className="h-2 w-2 shrink-0 rounded-full bg-up" aria-hidden />
                <span>Simulated market open{market.simulatedTime ? ` · simulated time ${new Date(market.simulatedTime).toUTCString()}` : ''}{market.sessions.length ? ` · ${market.sessions.join(', ')}` : ''}</span>
              </p>
            )
            : (
              <p role="status" className="flex items-center gap-2 font-medium text-ink" data-testid="market-closed">
                <span className="h-2 w-2 shrink-0 rounded-full bg-caution" aria-hidden />
                <span>{market.message}{market.nextOpen ? ` Next open: ${new Date(market.nextOpen).toUTCString()}.` : ''}</span>
              </p>
            )}
          {market.dataset?.testFixture && <p className="font-semibold text-caution">Data: {market.dataset.name}{market.dataset.source ? ` (${market.dataset.source})` : ''}</p>}
          <button type="button" className="ml-auto inline-flex min-h-[44px] items-center gap-1.5 font-semibold text-ink hover:text-primary-600 dark:hover:text-primary-400" aria-expanded={showRules} aria-controls="desk-rules" onClick={() => setShowRules((v) => !v)}>
            Rules and risks<ChevronDown className={`h-4 w-4 transition-transform ${showRules ? 'rotate-180' : ''}`} aria-hidden />
          </button>
        </div>
        <div className="border-t border-line px-4 py-2.5 text-[13px]" data-testid="simulator-disclosure">
          <p className="font-medium text-ink">Virtual funds only. This is not real money and no broker is involved.</p>
          <div id="desk-rules" className={showRules ? 'mt-3 grid grid-cols-1 gap-4 pb-1 leading-relaxed text-ink-muted md:grid-cols-2' : 'hidden'}>
            <p>Prices come from the ForexOrbit simulated market, which is generated by a model and does not follow any real market or broker. You buy at the ask and sell at the bid, and the spread is the only cost. There is no commission, no overnight swap and no added slippage. Real trading has all of these, prices can move faster than any stop, and leverage can magnify losses quickly, so results here do not predict real results. Trading involves substantial risk; this is for education only.</p>
            <ul className="space-y-1">
              <li>Leverage 1:30, minimum 1,000 units.</li>
              <li>A stop-loss on every order.</li>
              <li>At most 2% of equity at risk per trade, 5% across open trades.</li>
              <li>A margin call blocks new orders at 100% margin level.</li>
              <li>A stop-out closes your largest loser at 50%.</li>
              {market.dataset && !market.dataset.testFixture && <li className="text-ink-subtle">Data: {market.dataset.name}{market.dataset.source ? ` (${market.dataset.source})` : ''}</li>}
            </ul>
          </div>
        </div>
      </section>
    );
  }

  function renderQuotes() {
    if (!market.open) return null;
    return (
      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <ul className="flex w-max gap-2 sm:grid sm:w-auto sm:grid-cols-2 lg:grid-cols-3" data-testid="quotes">
          {market.instruments.map((i) => {
            const selected = form.instrument === i.id;
            return (
              <li key={i.id}>
                <button
                  type="button"
                  onClick={() => setForm({ ...form, instrument: i.id })}
                  aria-pressed={selected}
                  className={`relative flex min-h-[52px] w-full min-w-[12.5rem] flex-col justify-center rounded-xl border px-3.5 py-2 text-left transition-colors ${selected ? 'border-primary-500 bg-tint' : 'border-line bg-surface-1 hover:border-line-strong'}`}
                >
                  <span className="font-display text-sm font-semibold text-ink">{i.label}</span>
                  {i.bid
                    ? <span className="text-xs text-ink-muted num">bid <span className="font-semibold text-ink">{i.bid}</span> · ask <span className="font-semibold text-ink">{i.ask}</span><span className="absolute right-3.5 top-2.5 text-2xs text-ink-subtle"><span className="sr-only"> · </span>spread {i.spreadPips} pips</span></span>
                    : <span className="text-xs text-ink-subtle">no price</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  function renderTrade() {
    if (!account) {
      return (
        <>
          {renderStatus()}
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
            <section className="panel-hero self-start p-6 xl:col-start-2 xl:row-start-1">
              <h2 className="section-title">Open your practice account</h2>
              <p className="mt-2 text-sm text-ink-muted">You get USD 10,000 in virtual funds.</p>
              <button type="button" disabled={busy} className="btn btn-primary btn-lg mt-5 w-full" onClick={() => void act(() => apiClient.post('/trading/account', {}), 'Your practice account is ready.', 'The account could not be created.')}>Create practice account</button>
            </section>
            <div className="min-w-0 space-y-4 xl:col-start-1 xl:row-start-1">{renderQuotes()}{renderChart()}</div>
          </div>
        </>
      );
    }
    return (
      <>
        {renderStatus()}

        <section className="overflow-hidden rounded-panel border border-line" aria-label="Virtual account" data-testid="account-summary">
          {account.marginCall && <p role="alert" className="border-b border-line bg-[color-mix(in_srgb,var(--fo-down)_10%,transparent)] px-4 py-3 text-sm font-semibold text-down" data-testid="margin-call">Margin call: your margin level is at or below 100%, so new orders are blocked. A stop-out closes positions at 50%.</p>}
          <div className="grid grid-cols-2 gap-px bg-[var(--fo-line)] sm:grid-cols-3 xl:grid-cols-6">
            <Figure label="Virtual balance" value={usd(account.balance)} id="fig-balance" />
            <Figure label="Virtual equity" value={usd(account.equity)} id="fig-equity" />
            <Figure label="Open P&L" value={usd(account.unrealizedPl)} id="fig-open-pl" tone={tone(account.unrealizedPl)} />
            <Figure label="Used margin" value={usd(account.usedMargin)} id="fig-used" />
            <Figure label="Free margin" value={usd(account.freeMargin)} id="fig-free" />
            <Figure label="Margin level" value={account.marginLevel === null ? 'No open trades' : `${account.marginLevel}%`} id="fig-level" />
          </div>
        </section>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_21rem] xl:gap-5">
          <div className="min-w-0 space-y-4">
            {renderQuotes()}
            {renderChart()}
          </div>
          <div className="xl:row-span-2">{renderTicket()}</div>
          <div className="min-w-0">{renderActivity()}</div>
        </div>
      </>
    );
  }

  function renderTicket() {
    return (
      <form onSubmit={(e) => void placeOrder(e)} className="card !p-5 xl:sticky xl:top-20" aria-label="New order" data-testid="order-form">
        <h3 className="section-title !text-base">New simulated order</h3>
        <div className="mt-4 grid grid-cols-2 gap-2" role="group" aria-label="Side">
          {(['buy', 'sell'] as const).map((side) => {
            const quote = market.instruments.find((i) => i.id === form.instrument);
            const price = side === 'buy' ? quote?.ask : quote?.bid;
            return (
              <button key={side} type="button" data-side={side} aria-pressed={form.side === side} onClick={() => setForm({ ...form, side })} className={`min-h-[56px] rounded-xl border px-3 py-1.5 text-left transition-colors ${form.side === side ? (side === 'buy' ? 'border-primary-500 bg-primary-500 text-neutral-950' : 'border-ink bg-[var(--fo-text)] text-[var(--fo-surface-1)]') : 'border-line text-ink hover:border-line-strong'}`}>
                <span className="block text-sm font-semibold">{side === 'buy' ? 'Buy' : 'Sell'}</span>
                <span className="block text-xs num">{price || 'no price'}</span>
              </button>
            );
          })}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className={field}>Pair
            <select className={input} value={form.instrument} onChange={(e) => setForm({ ...form, instrument: e.target.value })}>
              {market.instruments.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
            </select>
          </label>
          <label className={field}>Type
            <select className={input} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option value="market">Market</option><option value="limit">Limit</option><option value="stop">Stop</option>
            </select>
          </label>
          <label className={`${field} col-span-2`}>Units (minimum 1,000)
            <input className={input} inputMode="numeric" value={form.units} onChange={(e) => setForm({ ...form, units: e.target.value })} required />
          </label>
          {form.type !== 'market' && (
            <>
              <label className={field}>Order price
                <input className={input} inputMode="decimal" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} required />
              </label>
              <label className={field}>Expires after (hours, 1-168)
                <input className={input} inputMode="numeric" value={form.expiryHours} onChange={(e) => setForm({ ...form, expiryHours: e.target.value })} required />
              </label>
            </>
          )}
          <label className={field}>Stop-loss (required)
            <input className={input} inputMode="decimal" value={form.stopLoss} onChange={(e) => setForm({ ...form, stopLoss: e.target.value })} required />
          </label>
          <label className={field}>Take-profit (optional)
            <input className={input} inputMode="decimal" value={form.takeProfit} onChange={(e) => setForm({ ...form, takeProfit: e.target.value })} />
          </label>
        </div>
        {/* The plan note: kept with the order and shown again when the trade is reviewed. */}
        {showNote || form.note
          ? (
            <label className={`${field} mt-3`}>Why am I taking this trade? (optional)
              <textarea
                className={`${input} min-h-[72px] resize-y py-2`}
                value={form.note}
                maxLength={500}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
                placeholder="Setup, reason, what would prove you wrong"
                data-testid="order-plan-note"
              />
            </label>
          )
          : <button type="button" className="mt-2 inline-flex min-h-[44px] items-center gap-1.5 text-sm font-semibold text-primary-600 dark:text-primary-400" onClick={() => setShowNote(true)}><Plus className="h-4 w-4" aria-hidden />Add a plan note</button>}
        {preview.figures && (
          <dl className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-[var(--fo-line)] text-sm" data-testid="risk-preview">
            <div className="bg-surface-2 px-3 py-2"><dt className="readout-label">Entry</dt><dd className="font-semibold text-ink num">{preview.figures.entry}</dd></div>
            <div className="bg-surface-2 px-3 py-2"><dt className="readout-label">Margin</dt><dd className="font-semibold text-ink num">{preview.figures.margin} USD</dd></div>
            <div className="bg-surface-2 px-3 py-2"><dt className="readout-label">Planned risk</dt><dd className="font-semibold text-ink num">{preview.figures.plannedRisk} USD</dd></div>
            <div className="bg-surface-2 px-3 py-2"><dt className="readout-label">Risk of equity</dt><dd className="font-semibold text-ink num">{preview.figures.riskPercent}%</dd></div>
            {preview.figures.reason && <p className="col-span-2 bg-surface-2 px-3 py-2 text-down" data-testid="risk-preview-reason">{preview.figures.reason}</p>}
          </dl>
        )}
        {preview.message && <p className="mt-3 text-sm text-ink-muted" data-testid="risk-preview-message">{preview.message}</p>}
        <button type="submit" disabled={busy || !market.open} className="btn btn-primary btn-lg mt-4 w-full">{busy ? 'Sending…' : 'Place order'}</button>
        {!market.open && <p className="mt-2 text-center text-xs text-ink-subtle">Orders are paused while the market is closed.</p>}
      </form>
    );
  }

  /** Open trades, waiting orders and the record, in one place. */
  function renderActivity() {
    const views: Array<[ActivityView, string, number | null]> = [['positions', 'Open', positions.length], ['pending', 'Pending', pendingOrders.length], ['history', 'History', null]];
    return (
      <section className="card !p-0" aria-label="Trades and orders">
        <div className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-line px-3" role="group" aria-label="Show">
          {views.map(([id, label, count]) => (
            <button key={id} type="button" aria-pressed={activity === id} onClick={() => setActivity(id)} className={`-mb-px min-h-[48px] shrink-0 border-b-2 px-3 text-sm font-semibold ${activity === id ? 'border-primary-500 text-ink' : 'border-transparent text-ink-muted hover:text-ink'}`}>
              {label}{count !== null && <span className="ml-1.5 text-ink-subtle num">{count}</span>}
            </button>
          ))}
        </div>

        <div className={activity === 'positions' ? 'px-5 py-3' : 'hidden'} data-testid="open-positions">
          {positions.length === 0 ? <p className="py-5 text-center text-sm text-ink-subtle">No open positions.</p> : (
            <ul className="divide-y divide-[var(--fo-line)]">
              {positions.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                  <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                    <span className={`chip ${p.side === 'buy' ? 'chip-brand' : ''}`}>{p.side === 'buy' ? 'Buy' : 'Sell'}</span>
                    <span className="font-display font-semibold text-ink">{pair(p.instrument)}</span>
                    <span className="break-words text-xs text-ink-subtle num">{p.units} at {p.entry} · stop {p.stopLoss}{p.takeProfit ? ` · target ${p.takeProfit}` : ''}</span>
                  </span>
                  <span className="ml-auto flex items-center gap-3">
                    <span className={`font-semibold num ${tone(p.unrealizedPl)}`}>{usd(p.unrealizedPl)}</span>
                    <button type="button" disabled={busy} className={small} onClick={() => void act(() => apiClient.post(`/trading/positions/${p.id}/close`, {}), 'Position closed.', 'The position was not closed.')}>Close</button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className={activity === 'pending' ? 'px-5 py-3' : 'hidden'} data-testid="pending-orders">
          {pendingOrders.length === 0 ? <p className="py-5 text-center text-sm text-ink-subtle">No pending orders.</p> : (
            <ul className="divide-y divide-[var(--fo-line)]">
              {pendingOrders.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                  <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                    <span className={`chip ${o.side === 'buy' ? 'chip-brand' : ''}`}>{o.side === 'buy' ? 'Buy' : 'Sell'} {o.type}</span>
                    <span className="font-display font-semibold text-ink">{pair(o.instrument)}</span>
                    <span className="break-words text-xs text-ink-subtle num">{o.units} at {o.price}{o.expiresAt ? ` · expires ${new Date(o.expiresAt).toUTCString()}` : ''}</span>
                  </span>
                  <button type="button" disabled={busy} className={`${small} ml-auto`} onClick={() => void act(() => apiClient.post(`/trading/orders/${o.id}/cancel`, {}), 'Order cancelled.', 'The order was not cancelled.')}>Cancel</button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className={activity === 'history' ? 'px-5 py-3' : 'hidden'} data-testid="history" aria-label="Simulated trade history">
          <div className="-mx-1 overflow-x-auto px-1">
            <div className="flex min-w-max gap-1 rounded-xl border border-line bg-surface-2 p-1" role="tablist" aria-label="History">
              {HISTORY_TABS.map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={tab === id}
                  className={`min-h-[44px] rounded-lg px-3.5 text-sm font-medium transition-colors ${tab === id ? 'bg-surface-1 text-ink shadow-panel' : 'text-ink-muted hover:text-ink'}`}
                  onClick={() => { setTab(id); setPage(1); setRecords(null); }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {!records ? <p role="status" className="py-4 text-sm text-ink-subtle">Loading…</p> : records.rows.length === 0 ? <p className="py-4 text-center text-sm text-ink-subtle">Nothing here yet.</p> : (
            <ul className="mt-2 divide-y divide-[var(--fo-line)] text-sm">
              {records.rows.map((row) => {
                const line = 'flex flex-wrap items-baseline justify-between gap-2 py-2.5';
                if (tab === 'executions') {
                  const e = row as Execution;
                  return <li key={e.id} className={line}><span className="min-w-0 break-words text-ink-muted num">{e.kind === 'fill' ? 'Filled' : 'Closed'} {e.side} {e.units} {(e.instrument || '').replace('_', '/')} at {e.price}{e.simulatedAt ? ` · ${new Date(e.simulatedAt).toUTCString()}` : ''}</span>{e.realizedPl && <span className={`font-semibold num ${tone(e.realizedPl)}`}>{e.realizedPl} USD</span>}</li>;
                }
                if (tab === 'resets') {
                  const g = row as Generation;
                  return <li key={g.id} className={line}><span className="text-ink-muted">Account {g.generation} · {g.status === 'active' ? 'current' : 'kept after reset'} · {g.closedTrades} closed trades</span><span className="font-semibold text-ink num">{g.balance} USD</span></li>;
                }
                if (tab === 'ledger') {
                  const l = row as LedgerRow;
                  return <li key={l.id} className={line}><span className="text-ink-muted">{l.type === 'deposit' ? 'Opening virtual funds' : 'Trade result'}</span><span className="font-semibold text-ink num">{l.amount} USD · balance {l.balanceAfter}</span></li>;
                }
                if (tab === 'orders') {
                  const o = row as Order;
                  return <li key={o.id} className="break-words py-2.5 text-ink-muted num">{o.side} {o.type} {o.units} {o.instrument.replace('_', '/')}: {o.status}{o.fillPrice ? ` at ${o.fillPrice}` : ''}{o.rejectMessage ? ` · ${o.rejectMessage}` : ''}</li>;
                }
                const p = row as Position;
                return <li key={p.id} className={line}><span className="min-w-0 break-words text-ink-muted num">{p.side} {p.units} {p.instrument.replace('_', '/')} {p.entry} to {p.exit} · {REASONS[p.closeReason || ''] || ''}</span><span className={`font-semibold num ${tone(p.realizedPl)}`}>{p.realizedPl} USD</span></li>;
              })}
            </ul>
          )}
          {records && records.pagination.pages > 1 && (
            <div className="mt-3 flex items-center justify-between gap-2 text-sm">
              <button type="button" className={small} disabled={page <= 1} onClick={() => setPage((n) => n - 1)}>Newer</button>
              <span className="text-ink-subtle num">Page {records.pagination.page} of {records.pagination.pages}</span>
              <button type="button" className={small} disabled={page >= records.pagination.pages} onClick={() => setPage((n) => n + 1)}>Older</button>
            </div>
          )}
        </div>
      </section>
    );
  }

  function renderResults() {
    if (!account) return <p className={`${card} text-sm text-ink-muted`}>Open your practice account on the Trade tab to see results.</p>;
    return (
      <>
        <section className="overflow-hidden rounded-panel border border-line" aria-label="Your results" data-testid="performance">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line bg-surface-2 px-5 py-3.5">
            <h3 className="section-title !text-base">Your simulated results</h3>
            <p className="text-xs text-ink-subtle">Virtual funds. Not a guide to real trading.</p>
          </div>
          {!performance || performance.closedTrades === 0 ? <p className="bg-surface-1 px-5 py-8 text-center text-sm text-ink-subtle">Results appear after your first closed trade.</p> : (
            <div className="grid grid-cols-2 gap-px bg-[var(--fo-line)] md:grid-cols-5">
              <Figure label="Closed trades" value={String(performance.closedTrades)} />
              <Figure label="Win rate" value={`${performance.winRate}%`} />
              <Figure label="Net virtual result" value={`${performance.netResult} USD`} id="fig-net" tone={tone(performance.netResult)} />
              <Figure label="Return" value={`${performance.returnPercent}%`} tone={tone(performance.returnPercent)} />
              <Figure label="Largest drawdown" value={`${performance.maxDrawdownPercent}%`} />
            </div>
          )}
        </section>

        <section className={card} aria-label="Leaderboard" data-testid="trading-leaderboard">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="section-title !text-base">Practice leaderboard</h3>
              <p className="mt-1 text-xs text-ink-subtle">Simulated ranks, no evidence of real trading skill. {board?.minimumTrades ?? 5} closed trades to qualify.</p>
            </div>
            <label className="flex min-h-[44px] cursor-pointer items-center gap-3 text-sm font-medium text-ink">
              <input type="checkbox" className="h-5 w-5 accent-[#ff7012]" checked={account.leaderboardOptIn} disabled={busy} onChange={(e) => { const optIn = e.target.checked; void act(() => apiClient.put('/trading/leaderboard', { optIn }), optIn ? 'You joined the leaderboard.' : 'You left the leaderboard.', 'That could not be saved.'); }} />
              Show me, under a random name
            </label>
          </div>
          {board && board.rows.length > 0
            ? (
              <ol className="mt-3 divide-y divide-[var(--fo-line)] text-sm">
                {board.rows.map((r) => (
                  <li key={r.alias} className={`flex flex-wrap items-baseline justify-between gap-2 py-2.5 ${r.you ? 'text-primary-600 dark:text-primary-400' : 'text-ink-muted'}`}>
                    <span><span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full border border-line text-xs font-semibold num">{r.rank}</span>{r.alias}{r.you ? ' (you)' : ''}</span>
                    <span className="num">{r.returnPercent}% · drawdown {r.maxDrawdownPercent}% · {r.closedTrades} trades</span>
                  </li>
                ))}
              </ol>
            )
            : <p className="mt-4 text-sm text-ink-subtle">No one is ranked yet.</p>}
        </section>

        <section className={`${card} flex flex-wrap items-center justify-between gap-4`} aria-label="Reset account" data-testid="reset-account">
          <div className="min-w-0 max-w-xl">
            <h3 className="section-title !text-base">Reset account</h3>
            <p className="mt-1 text-sm text-ink-muted">Start again with USD 10,000, once every 30 days. Your history is kept.</p>
            <p className="mt-1 text-sm text-ink" data-testid="reset-eligibility">{account.nextResetAt && new Date(account.nextResetAt) > new Date() ? `Next reset available: ${new Date(account.nextResetAt).toUTCString()}.` : 'A reset is available.'}</p>
          </div>
          <button type="button" disabled={busy} className="btn btn-danger-quiet min-h-[44px]" onClick={() => { if (window.confirm('Reset your practice account? Close open positions first. This can be done once every 30 days.')) void act(() => apiClient.post('/trading/account/reset', {}), 'Your account was reset.', 'The account was not reset.'); }}>Reset account</button>
        </section>
      </>
    );
  }

  function renderChart() {
    if (candles.length === 0) return null;
    return (
      <section className={`${card} !p-4`} aria-label="Simulated price chart" data-testid="chart">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div>
            <h3 className="section-title !text-base">{form.instrument.replace('_', '/')}</h3>
            <p className="text-2xs text-ink-subtle">{market.label} · bid</p>
          </div>
          <div className="flex rounded-xl border border-line bg-surface-2 p-1" role="group" aria-label="Timeframe">
            {TIMEFRAMES.map((name) => (
              <button
                key={name}
                type="button"
                aria-pressed={timeframe === name}
                className={`min-h-[44px] min-w-[2.5rem] rounded-lg px-1.5 text-xs font-semibold transition-colors num sm:px-2.5 ${timeframe === name ? 'bg-primary-500 text-neutral-950' : 'text-ink-muted hover:text-ink'}`}
                onClick={() => setTimeframe(name)}
              >
                {name}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-3">
          <CandleChart candles={candles} label={`Simulated ${form.instrument.replace('_', '/')} candles, ${timeframe}`} />
        </div>
      </section>
    );
  }
}
