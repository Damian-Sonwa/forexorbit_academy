/**
 * Practice trading desk (Phase 10). This component only presents what the server decides: every
 * balance, price, margin and result arrives as a finished decimal string and is shown as it is.
 * Nothing financial is computed in the browser. An order key is kept across a network failure, so
 * retrying cannot trade twice, and a new key is used only after the server has answered.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '@/lib/api-client';

type Instrument = { id: string; label: string; bid: string | null; ask: string | null; time: string | null; unavailable: string | null };
type Market = { open: boolean; reason: string | null; message: string | null; simulatedTime: string | null; dataset: { name: string; source: string; testFixture: boolean } | null; instruments: Instrument[] };
type Account = { virtual: true; currency: string; generation: number; startingBalance: string; balance: string; equity: string | null; usedMargin: string; freeMargin: string | null; marginLevel: string | null; unrealizedPl: string | null; marginCall: boolean; leverage: string; lastResetAt: string | null; leaderboardOptIn: boolean };
type Position = { id: string; instrument: string; side: string; units: string; entry: string; stopLoss: string; takeProfit: string | null; margin: string; currentPrice: string | null; unrealizedPl: string | null; exit: string | null; realizedPl: string | null; closeReason: string | null; closedAt: string | null };
type Order = { id: string; type: string; instrument: string; side: string; units: string; price: string | null; stopLoss: string | null; status: string; rejectMessage: string | null; fillPrice: string | null; expiresAt: string | null; createdAt: string };
type View = { account: Account | null; market: Market; positions: Position[]; pendingOrders: Order[] };
type Performance = { closedTrades: number; wins: number; losses: number; winRate: string | null; netResult: string; returnPercent: string | null; maxDrawdownPercent: string | null };
type Board = { minimumTrades: number; rows: { rank: number; alias: string; returnPercent: string; maxDrawdownPercent: string | null; closedTrades: number; you: boolean }[] };
type Paged<T> = { rows: T[]; pagination: { page: number; pages: number; total: number } };
type LedgerRow = { id: string; seq: number; type: string; amount: string; balanceAfter: string; reference: string; createdAt: string };

const EMPTY_FORM = { type: 'market', instrument: 'EUR_USD', side: 'buy', units: '1000', price: '', stopLoss: '', takeProfit: '', expiryHours: '24' };
const REASONS: Record<string, string> = { manual: 'Closed by you', stop_loss: 'Stop-loss', take_profit: 'Take-profit', stop_out: 'Stop-out' };
const card = 'rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800';
const input = 'mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white';
const small = 'min-h-[44px] rounded-lg border border-gray-300 px-3 text-sm font-medium text-gray-800 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-100 dark:hover:bg-gray-700';

function messageOf(err: unknown, fallback: string) {
  const ax = err as { response?: { data?: { error?: string; order?: { rejectMessage?: string } } } };
  if (!ax?.response) return 'Could not reach the server. Nothing is confirmed yet: check your orders, then try again.';
  return ax.response.data?.order?.rejectMessage || ax.response.data?.error || fallback;
}

function Figure({ label, value, id }: { label: string; value: string; id?: string }) {
  return (
    <div data-testid={id}>
      <p className="text-xs text-gray-600 dark:text-gray-400">{label}</p>
      <p className="break-words text-lg font-bold text-gray-900 dark:text-white">{value}</p>
    </div>
  );
}

export default function TradingInterface() {
  const [view, setView] = useState<View | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [tab, setTab] = useState<'orders' | 'positions' | 'ledger'>('positions');
  const [records, setRecords] = useState<Paged<Order | Position | LedgerRow> | null>(null);
  const [page, setPage] = useState(1);
  const [performance, setPerformance] = useState<Performance | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const orderKey = useRef<string | null>(null);

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
        apiClient.get<Paged<Order | Position | LedgerRow>>(url),
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
      });
      orderKey.current = null;
      setNotice({ kind: 'ok', text: res.order.status === 'pending' ? 'Pending order placed.' : `Filled at ${res.order.fillPrice}.` });
      setForm({ ...EMPTY_FORM, instrument: form.instrument });
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
      ? <div role="alert" className={card}><p className="text-sm">The practice desk could not be loaded.</p><button type="button" className={`${small} mt-2`} onClick={() => void load()}>Try again</button></div>
      : <p role="status" className="py-8 text-center text-sm text-gray-600">Loading the practice desk…</p>;
  }

  const { account, market, positions, pendingOrders } = view;
  const usd = (value: string | null) => (value === null ? 'Unavailable' : `${value} USD`);
  return (
    <div className="space-y-4" data-testid="practice-desk">
      <section className={card} aria-label="How this simulator works" data-testid="simulator-disclosure">
        <p className="text-sm font-semibold text-gray-900 dark:text-white">Virtual funds only. This is not real money and no broker is involved.</p>
        <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">
          Orders fill at recorded bid and ask prices: you buy at the ask and sell at the bid, and the spread is the only cost. There is no commission, no overnight swap and no added slippage. Real trading has all of these, prices can move faster than any stop, and leverage can magnify losses quickly, so results here do not predict real results.
        </p>
        <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">
          Rules: leverage 1:30, minimum 1,000 units, a stop-loss on every order, at most 2% of equity at risk per trade and 5% across open trades. A margin call blocks new orders at 100% margin level. A stop-out closes your largest loser at 50%.
        </p>
      </section>

      <section className={card} aria-label="Market status" data-testid="market-status">
        {market.open
          ? <p className="text-sm font-semibold text-gray-900 dark:text-white">Market open{market.simulatedTime ? ` · recorded time ${new Date(market.simulatedTime).toUTCString()}` : ''}</p>
          : <p role="status" className="text-sm font-semibold text-gray-900 dark:text-white" data-testid="market-closed">{market.message}</p>}
        {market.dataset && <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">Data: {market.dataset.name}{market.dataset.source ? ` (${market.dataset.source})` : ''}</p>}
        {market.open && (
          <ul className="mt-2 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3" data-testid="quotes">
            {market.instruments.map((i) => (
              <li key={i.id} className="rounded-lg bg-gray-50 p-2 dark:bg-gray-900/40">
                <span className="font-semibold">{i.label}</span>{' '}
                {i.bid ? <span>bid {i.bid} · ask {i.ask}</span> : <span className="text-gray-600 dark:text-gray-400">no price</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {notice && <p role={notice.kind === 'error' ? 'alert' : 'status'} className={`rounded-lg p-3 text-sm ${notice.kind === 'error' ? 'bg-red-50 text-red-800' : 'bg-green-50 text-green-800'}`} data-testid="desk-notice">{notice.text}</p>}

      {!account ? (
        <section className={card}>
          <p className="text-sm text-gray-700 dark:text-gray-300">Create your practice account to get USD 10,000 in virtual funds.</p>
          <button type="button" disabled={busy} className="btn btn-primary mt-3 min-h-[44px] px-5" onClick={() => void act(() => apiClient.post('/trading/account', {}), 'Your practice account is ready.', 'The account could not be created.')}>Create practice account</button>
        </section>
      ) : (
        <>
          <section className={card} aria-label="Virtual account" data-testid="account-summary">
            <h3 className="text-base font-bold text-gray-900 dark:text-white">Your virtual account</h3>
            {account.marginCall && <p role="alert" className="mt-2 rounded-lg bg-red-50 p-2 text-sm font-semibold text-red-800" data-testid="margin-call">Margin call: your margin level is at or below 100%, so new orders are blocked. A stop-out closes positions at 50%.</p>}
            <div className="mt-2 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
              <Figure label="Virtual balance" value={usd(account.balance)} id="fig-balance" />
              <Figure label="Virtual equity" value={usd(account.equity)} id="fig-equity" />
              <Figure label="Used margin" value={usd(account.usedMargin)} id="fig-used" />
              <Figure label="Free margin" value={usd(account.freeMargin)} id="fig-free" />
              <Figure label="Margin level" value={account.marginLevel === null ? 'No open trades' : `${account.marginLevel}%`} id="fig-level" />
              <Figure label="Open P&L" value={usd(account.unrealizedPl)} id="fig-open-pl" />
            </div>
          </section>

          <form onSubmit={(e) => void placeOrder(e)} className={card} aria-label="New order" data-testid="order-form">
            <h3 className="text-base font-bold text-gray-900 dark:text-white">New order</h3>
            <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="text-sm text-gray-700 dark:text-gray-300">Type
                <select className={input} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                  <option value="market">Market</option><option value="limit">Limit</option><option value="stop">Stop</option>
                </select>
              </label>
              <label className="text-sm text-gray-700 dark:text-gray-300">Pair
                <select className={input} value={form.instrument} onChange={(e) => setForm({ ...form, instrument: e.target.value })}>
                  {market.instruments.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
                </select>
              </label>
              <label className="text-sm text-gray-700 dark:text-gray-300">Side
                <select className={input} value={form.side} onChange={(e) => setForm({ ...form, side: e.target.value })}>
                  <option value="buy">Buy</option><option value="sell">Sell</option>
                </select>
              </label>
              <label className="text-sm text-gray-700 dark:text-gray-300">Units (minimum 1,000)
                <input className={input} inputMode="numeric" value={form.units} onChange={(e) => setForm({ ...form, units: e.target.value })} required />
              </label>
              {form.type !== 'market' && (
                <label className="text-sm text-gray-700 dark:text-gray-300">Order price
                  <input className={input} inputMode="decimal" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} required />
                </label>
              )}
              <label className="text-sm text-gray-700 dark:text-gray-300">Stop-loss (required)
                <input className={input} inputMode="decimal" value={form.stopLoss} onChange={(e) => setForm({ ...form, stopLoss: e.target.value })} required />
              </label>
              <label className="text-sm text-gray-700 dark:text-gray-300">Take-profit (optional)
                <input className={input} inputMode="decimal" value={form.takeProfit} onChange={(e) => setForm({ ...form, takeProfit: e.target.value })} />
              </label>
              {form.type !== 'market' && (
                <label className="text-sm text-gray-700 dark:text-gray-300">Expires after (hours, 1-168)
                  <input className={input} inputMode="numeric" value={form.expiryHours} onChange={(e) => setForm({ ...form, expiryHours: e.target.value })} required />
                </label>
              )}
            </div>
            <button type="submit" disabled={busy || !market.open} className="btn btn-primary mt-3 min-h-[44px] w-full px-5 sm:w-auto">{busy ? 'Sending…' : 'Place order'}</button>
            {!market.open && <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">Orders are paused while the market is unavailable.</p>}
          </form>

          <section className={card} aria-label="Open positions" data-testid="open-positions">
            <h3 className="text-base font-bold text-gray-900 dark:text-white">Open positions</h3>
            {positions.length === 0 ? <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">No open positions.</p> : (
              <ul className="mt-2 divide-y divide-gray-200 dark:divide-gray-700">
                {positions.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <span className="min-w-0 break-words">{p.side === 'buy' ? 'Buy' : 'Sell'} {p.units} {p.instrument.replace('_', '/')} at {p.entry} · stop {p.stopLoss}{p.takeProfit ? ` · target ${p.takeProfit}` : ''}</span>
                    <span className="flex items-center gap-2">
                      <span className="font-semibold">{usd(p.unrealizedPl)}</span>
                      <button type="button" disabled={busy} className={small} onClick={() => void act(() => apiClient.post(`/trading/positions/${p.id}/close`, {}), 'Position closed.', 'The position was not closed.')}>Close</button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={card} aria-label="Pending orders" data-testid="pending-orders">
            <h3 className="text-base font-bold text-gray-900 dark:text-white">Pending orders</h3>
            {pendingOrders.length === 0 ? <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">No pending orders.</p> : (
              <ul className="mt-2 divide-y divide-gray-200 dark:divide-gray-700">
                {pendingOrders.map((o) => (
                  <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <span className="min-w-0 break-words">{o.side === 'buy' ? 'Buy' : 'Sell'} {o.type} {o.units} {o.instrument.replace('_', '/')} at {o.price}{o.expiresAt ? ` · expires ${new Date(o.expiresAt).toUTCString()}` : ''}</span>
                    <button type="button" disabled={busy} className={small} onClick={() => void act(() => apiClient.post(`/trading/orders/${o.id}/cancel`, {}), 'Order cancelled.', 'The order was not cancelled.')}>Cancel</button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={card} aria-label="Your results" data-testid="performance">
            <h3 className="text-base font-bold text-gray-900 dark:text-white">Your virtual results</h3>
            {!performance || performance.closedTrades === 0 ? <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">Results appear after your first closed trade.</p> : (
              <div className="mt-2 grid grid-cols-2 gap-3 md:grid-cols-5">
                <Figure label="Closed trades" value={String(performance.closedTrades)} />
                <Figure label="Win rate" value={`${performance.winRate}%`} />
                <Figure label="Net virtual result" value={`${performance.netResult} USD`} id="fig-net" />
                <Figure label="Return" value={`${performance.returnPercent}%`} />
                <Figure label="Largest drawdown" value={`${performance.maxDrawdownPercent}%`} />
              </div>
            )}
          </section>

          <section className={card} aria-label="History" data-testid="history">
            <div className="flex flex-wrap gap-2" role="tablist">
              {(['positions', 'orders', 'ledger'] as const).map((name) => (
                <button key={name} type="button" role="tab" aria-selected={tab === name} className={small} onClick={() => { setTab(name); setPage(1); setRecords(null); }}>
                  {name === 'positions' ? 'Closed trades' : name === 'orders' ? 'Orders' : 'Ledger'}
                </button>
              ))}
            </div>
            {!records ? <p role="status" className="mt-2 text-sm text-gray-600">Loading…</p> : records.rows.length === 0 ? <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">Nothing here yet.</p> : (
              <ul className="mt-2 divide-y divide-gray-200 text-sm dark:divide-gray-700">
                {records.rows.map((row) => {
                  if (tab === 'ledger') {
                    const l = row as LedgerRow;
                    return <li key={l.id} className="flex flex-wrap justify-between gap-2 py-2"><span>{l.type === 'deposit' ? 'Opening virtual funds' : 'Trade result'}</span><span className="font-semibold">{l.amount} USD · balance {l.balanceAfter}</span></li>;
                  }
                  if (tab === 'orders') {
                    const o = row as Order;
                    return <li key={o.id} className="py-2 break-words">{o.side} {o.type} {o.units} {o.instrument.replace('_', '/')}: {o.status}{o.fillPrice ? ` at ${o.fillPrice}` : ''}{o.rejectMessage ? ` · ${o.rejectMessage}` : ''}</li>;
                  }
                  const p = row as Position;
                  return <li key={p.id} className="flex flex-wrap justify-between gap-2 py-2"><span className="min-w-0 break-words">{p.side} {p.units} {p.instrument.replace('_', '/')} {p.entry} to {p.exit} · {REASONS[p.closeReason || ''] || ''}</span><span className="font-semibold">{p.realizedPl} USD</span></li>;
                })}
              </ul>
            )}
            {records && records.pagination.pages > 1 && (
              <div className="mt-2 flex items-center justify-between text-sm">
                <button type="button" className={small} disabled={page <= 1} onClick={() => setPage((n) => n - 1)}>Newer</button>
                <span>Page {records.pagination.page} of {records.pagination.pages}</span>
                <button type="button" className={small} disabled={page >= records.pagination.pages} onClick={() => setPage((n) => n + 1)}>Older</button>
              </div>
            )}
          </section>

          <section className={card} aria-label="Leaderboard" data-testid="trading-leaderboard">
            <h3 className="text-base font-bold text-gray-900 dark:text-white">Practice leaderboard</h3>
            <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">Optional. You appear under a random name, ranked by percentage return on all virtual funds you have been given, with your largest drawdown. Resets do not improve your rank. Your journal and account details stay private. A minimum of {board?.minimumTrades ?? 5} closed trades applies.</p>
            <label className="mt-2 flex min-h-[44px] items-center gap-2 text-sm">
              <input type="checkbox" checked={account.leaderboardOptIn} disabled={busy} onChange={(e) => { const optIn = e.target.checked; void act(() => apiClient.put('/trading/leaderboard', { optIn }), optIn ? 'You joined the leaderboard.' : 'You left the leaderboard.', 'That could not be saved.'); }} />
              Show me on the leaderboard
            </label>
            {board && board.rows.length > 0 && (
              <ol className="mt-2 divide-y divide-gray-200 text-sm dark:divide-gray-700">
                {board.rows.map((r) => <li key={r.alias} className="flex flex-wrap justify-between gap-2 py-2"><span>{r.rank}. {r.alias}{r.you ? ' (you)' : ''}</span><span>{r.returnPercent}% · drawdown {r.maxDrawdownPercent}% · {r.closedTrades} trades</span></li>)}
              </ol>
            )}
          </section>

          <section className={card} aria-label="Reset account" data-testid="reset-account">
            <h3 className="text-base font-bold text-gray-900 dark:text-white">Reset account</h3>
            <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">Starts a new USD 10,000 virtual account, once every 30 days, with no open positions. Your old account and its history are kept and still count in your results.</p>
            <button type="button" disabled={busy} className={`${small} mt-2`} onClick={() => { if (window.confirm('Reset your practice account? This can be done once every 30 days.')) void act(() => apiClient.post('/trading/account/reset', {}), 'Your account was reset.', 'The account was not reset.'); }}>Reset account</button>
          </section>
        </>
      )}
    </div>
  );
}
