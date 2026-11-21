/**
 * Practice trading on the student dashboard (Phase 11): an educational overview of the student's
 * SIMULATED account and realised results, not a broker portfolio. Figures are the server's exact
 * decimal strings (lib/trading/analytics.js). Realised results (closed trades) and unrealised
 * results (open positions, active account) are always shown apart. Charts are passed in.
 */

import Link from 'next/link';
import type { ReactNode } from 'react';
import type { TradingSection } from '@/lib/student-analytics';
import { Disclosure, EmptyState, Metric, MetricGrid } from './Panels';
import { CLOSE_REASONS, pairLabel, relativeTime, signed, toneClass } from './format';

export default function PracticePanel({ trading, charts }: { trading: TradingSection; charts?: { performance?: ReactNode; outcome?: ReactNode; instrument?: ReactNode } }) {
  const p = trading.performance;
  const o = trading.overview;
  const banner = (
    <p className="sim-badge mb-4 inline-flex" data-testid="sim-label">{trading.marketLabel}</p>
  );
  if (!trading.hasAccount && p.closedTrades === 0) {
    return (
      <div>
        {banner}
        <EmptyState
          title="No practice account yet"
          text="Open a practice account with USD 10,000 of virtual funds and try what you learn on the simulated market."
          action={<Link href="/student-dashboard" className="btn btn-primary btn-sm">Open the practice desk</Link>}
          testId="practice-empty"
        />
      </div>
    );
  }
  return (
    <div className="space-y-5" data-testid="practice-panel">
      {banner}
      {o && (
        <div>
          <p className="readout-label mb-2">Active practice account · virtual funds</p>
          <MetricGrid>
            <Metric label="Balance" value={`${o.account.balance}`} hint="USD, after closed trades" testId="fig-balance" />
            <Metric label="Equity" value={o.account.equity ?? '-'} hint={o.account.equity ? 'USD, at the latest simulated quote' : 'no quote while the market is closed'} testId="fig-equity" />
            <Metric label="Free margin" value={o.account.freeMargin ?? '-'} hint="USD available" testId="fig-free-margin" />
            <Metric label="Open positions" value={o.openPositions} hint={o.pendingOrders ? `${o.pendingOrders} pending order${o.pendingOrders === 1 ? '' : 's'}` : undefined} testId="fig-open" />
            <Metric label="Unrealised" value={signed(o.account.unrealizedPl)} tone={toneClass(o.account.unrealizedPl)} hint="open positions" testId="fig-unrealized" />
            <Metric label="Margin level" value={o.account.marginLevel ? `${o.account.marginLevel}%` : '-'} hint={o.account.marginCall ? 'margin call: new orders blocked' : undefined} tone={o.account.marginCall ? 'text-down' : 'text-ink'} />
          </MetricGrid>
        </div>
      )}

      <div>
        <p className="readout-label mb-2">Realised performance · all practice accounts</p>
        {p.closedTrades === 0 ? (
          <EmptyState title="No closed trades yet" text="Results appear after your first practice trade closes." testId="practice-no-trades" />
        ) : (
          <MetricGrid>
            <Metric label="Closed trades" value={p.closedTrades} testId="perf-closed" />
            <Metric label="Win rate" value={p.winRate === null ? '-' : `${p.winRate}%`} hint={`${p.wins} won · ${p.losses} lost${p.breakeven ? ` · ${p.breakeven} even` : ''}`} testId="perf-win-rate" />
            <Metric label="Net realised" value={signed(p.netRealized)} tone={toneClass(p.netRealized)} hint="USD, spread included" testId="perf-net" />
            <Metric label="Average win" value={p.averageWin ? signed(p.averageWin) : '-'} tone="text-up" hint="USD" testId="perf-avg-win" />
            <Metric label="Average loss" value={p.averageLoss ?? '-'} tone={p.averageLoss ? 'text-down' : 'text-ink'} hint="USD" testId="perf-avg-loss" />
            <Metric label="Reviewed" value={`${trading.reviews.reviewed}/${p.closedTrades}`} hint={trading.reviews.pending ? `${trading.reviews.pending} to review` : 'all reviewed'} testId="perf-reviewed" />
          </MetricGrid>
        )}
      </div>

      {p.closedTrades > 0 && charts && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <div className="card !p-4">
            <p className="text-sm font-semibold text-ink">Running result by day</p>
            <p className="mb-2 text-xs text-ink-subtle">Realised, USD, simulated</p>
            {charts.performance}
          </div>
          <div className="space-y-4">
            <div className="card !p-4">
              <p className="mb-1 text-sm font-semibold text-ink">Winning and losing trades</p>
              {charts.outcome}
            </div>
          </div>
          <div className="card !p-4 lg:col-span-2">
            <p className="text-sm font-semibold text-ink">By currency pair</p>
            <p className="mb-2 text-xs text-ink-subtle">Realised result per pair; hover for trades and win rate</p>
            {charts.instrument}
          </div>
        </div>
      )}

      <Disclosure title="Recent practice trades" hint={trading.recent.length ? `last ${trading.recent.length}` : undefined} testId="recent-trades-disclosure">
        <div className="mb-3 flex justify-end">
          <Link href="/student-dashboard" className="text-sm font-semibold text-primary-600 dark:text-primary-400">Full history →</Link>
        </div>
        {trading.recent.length === 0 ? (
          <EmptyState title="No trades yet" text="Your simulated trades will be listed here." />
        ) : (
          <div className="overflow-x-auto rounded-panel border border-line bg-surface-1">
            <table className="table-orbit w-full text-sm" data-testid="recent-trades">
              <thead>
                <tr><th>Pair</th><th>Side</th><th className="text-right">Units</th><th className="text-right">Entry</th><th className="text-right">Exit</th><th>Status</th><th className="text-right">Result (USD)</th><th>When</th></tr>
              </thead>
              <tbody>
                {trading.recent.map((t) => (
                  <tr key={t.id}>
                    <td className="font-medium text-ink">{pairLabel(t.instrument)}</td>
                    <td><span className={`chip ${t.side === 'buy' ? 'chip-up' : 'chip-down'} uppercase`}>{t.side}</span></td>
                    <td className="text-right num">{Number(t.units).toLocaleString()}</td>
                    <td className="text-right num">{t.entry}</td>
                    <td className="text-right num">{t.exit ?? '-'}</td>
                    <td className="whitespace-nowrap text-xs">{t.status === 'open' ? 'Open' : CLOSE_REASONS[t.closeReason || ''] || 'Closed'}</td>
                    <td className={`text-right num ${t.status === 'open' ? 'text-ink-subtle' : toneClass(t.realizedPl)}`}>{t.status === 'open' ? 'open' : signed(t.realizedPl)}</td>
                    <td className="whitespace-nowrap text-xs text-ink-subtle">{relativeTime(t.closedAt || t.openedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Disclosure>
    </div>
  );
}
