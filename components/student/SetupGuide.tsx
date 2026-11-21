/**
 * Practice desk guide: how to use ForexOrbit's built-in simulator, step by step.
 *
 * Every rule and number here mirrors what the server enforces (lib/trading/instruments.js and
 * lib/trading/engine.js): USD 10,000 virtual funds, leverage 1:30, 1,000 to 10,000,000 units, a
 * stop-loss on every order, at most 2% of equity at risk per trade and 5% in total, at most 50 open
 * items, a margin call at 100% and a stop-out at 50%, pending orders expiring after 1 to 168 hours,
 * and a reset once every 30 days with no open positions. If those change, change this text too.
 */

import { useState, type ReactNode } from 'react';

type Section = 'live' | 'tasks' | 'journal';

interface SetupGuideProps {
  /** Opens another tab of the practice desk (the page's own section switcher). */
  onNavigate?: (section: Section) => void;
}

const RULES: Array<[string, string]> = [
  ['Virtual funds', 'USD 10,000'],
  ['Leverage', '1:30'],
  ['Trade size', '1,000+ units'],
  ['Stop-loss', 'Every order'],
  ['Risk per trade', 'Max 2%'],
  ['Total open risk', 'Max 5%'],
];

function Term({ children }: { children: ReactNode }) {
  return <strong className="font-semibold text-ink">{children}</strong>;
}

function Point({ children }: { children: ReactNode }) {
  return (
    <li className="relative pl-5 before:absolute before:left-0 before:top-[0.6em] before:h-1.5 before:w-1.5 before:rounded-full before:border before:border-primary-500">
      {children}
    </li>
  );
}

export default function SetupGuide({ onNavigate }: SetupGuideProps) {
  const [activeStep, setActiveStep] = useState<number | null>(1);

  const go = (section: Section, label: string) =>
    onNavigate ? (
      <button type="button" onClick={() => onNavigate(section)} className="btn btn-secondary btn-sm mt-4">
        {label} →
      </button>
    ) : null;

  const steps: Array<{ id: number; title: string; summary: string; content: ReactNode }> = [
    {
      id: 1,
      title: 'What the practice desk is',
      summary: 'A simulator with virtual money, built into the academy.',
      content: (
        <div className="space-y-3">
          <p>
            The practice desk lets you trade six currency pairs with <Term>USD 10,000 of virtual money</Term>:
            EUR/USD, GBP/USD, AUD/USD, USD/JPY, USD/CAD and USD/CHF. There is nothing to install and no account
            to open anywhere else.
          </p>
          <ul className="space-y-1.5">
            <Point>Prices come from the <Term>ForexOrbit simulated market</Term>, a model. They do not follow any real market or broker, and every screen says so.</Point>
            <Point>No order reaches a broker. Nothing can be deposited, traded for real or withdrawn.</Point>
            <Point>The simulated market keeps the real trading week: it is <Term>closed from Friday 22:00 to Sunday 22:00 UTC</Term> and on market holidays.</Point>
          </ul>
          <p className="notice notice-caution !py-2.5 text-[13px]">
            Practice results do not predict real results. Real trading has commissions, overnight fees and slippage, and prices can move faster than any stop.
          </p>
        </div>
      ),
    },
    {
      id: 2,
      title: 'Create your practice account',
      summary: 'One click; the server opens it with USD 10,000.',
      content: (
        <div className="space-y-3">
          <p>Open the <Term>Practice account</Term> tab and click <Term>Create practice account</Term>. Your account opens with USD 10,000.00 and the ledger records the opening funds. You then see six figures:</p>
          <dl className="grid gap-px overflow-hidden rounded-xl border border-line bg-[var(--fo-line)] sm:grid-cols-2">
            {[
              ['Virtual balance', 'Your cash after closed trades.'],
              ['Virtual equity', 'Balance plus the profit or loss of open trades.'],
              ['Used margin', 'Money set aside to hold your open trades.'],
              ['Free margin', 'What is left for new trades.'],
              ['Margin level', 'Equity divided by used margin.'],
              ['Open P&L', 'The current result of open trades: green for a profit, red for a loss.'],
            ].map(([term, text]) => (
              <div key={term} className="bg-surface-1 px-4 py-3">
                <dt className="readout-label">{term}</dt>
                <dd className="mt-1 text-[13px]">{text}</dd>
              </div>
            ))}
          </dl>
          {go('live', 'Open the practice account')}
        </div>
      ),
    },
    {
      id: 3,
      title: 'Read the market',
      summary: 'Bid, ask, spread and pips, and when the market is open.',
      content: (
        <div className="space-y-3">
          <p>The status bar shows whether the simulated market is open, the simulated time and the active sessions (Sydney, Tokyo, London, New York). Each pair has a quote tile:</p>
          <ul className="space-y-1.5">
            <Point><Term>Ask</Term>: the price you pay when you <em>buy</em>.</Point>
            <Point><Term>Bid</Term>: the price you receive when you <em>sell</em>.</Point>
            <Point><Term>Spread</Term>: the gap between them, and the only cost of a trade here.</Point>
            <Point>A <Term>pip</Term> is the usual unit of movement: 0.0001 for most pairs, 0.01 for USD/JPY.</Point>
          </ul>
          <p>Click a tile to select that pair in the order ticket and on the chart. The timeframe buttons (M1 to D1) change the candle size. The desk refreshes every 15 seconds; when the market is closed it says why and when it opens again.</p>
        </div>
      ),
    },
    {
      id: 4,
      title: 'Plan the trade before you place it',
      summary: 'Choose your stop first, then let the risk preview check the size.',
      content: (
        <div className="space-y-3">
          <p>Every order needs a <Term>stop-loss</Term>: the price at which the trade closes to limit the loss. Decide it from the chart before you choose the size.</p>
          <ul className="space-y-1.5">
            <Point>A <Term>buy</Term> needs its stop-loss <em>below</em> the entry price, and any take-profit <em>above</em> it.</Point>
            <Point>A <Term>sell</Term> needs its stop-loss <em>above</em> the entry price, and any take-profit <em>below</em> it.</Point>
            <Point>If the stop is hit, you may lose at most <Term>2% of your equity</Term> on one trade, and at most <Term>5%</Term> across all open trades and pending orders.</Point>
            <Point>Trade size is <Term>1,000 to 10,000,000 units</Term>. Leverage is 1:30, so a trade holds about one thirtieth of its value as margin.</Point>
          </ul>
          <p>Enter the units and the stop-loss: the ticket then shows the server&apos;s <Term>risk preview</Term> (entry, margin, planned risk and risk of equity), and says in red if a rule would be broken.</p>
          <div className="rounded-xl border border-line bg-surface-2 p-4 text-[13px]">
            <p className="readout-label">Worked example</p>
            <p className="mt-2">EUR/USD ask 1.11102. Buy 1,000 units with the stop 40 pips lower, at 1.10702:</p>
            <ul className="mt-2 space-y-1">
              <Point>Margin ≈ 1,000 × 1.11102 ÷ 30 = <Term>USD 37.03</Term></Point>
              <Point>Planned risk = 1,000 × 0.0040 = <Term>USD 4.00</Term>, 0.04% of USD 10,000</Point>
              <Point>The 2% limit is USD 200, so with a 40-pip stop the largest size is about 50,000 units</Point>
            </ul>
          </div>
        </div>
      ),
    },
    {
      id: 5,
      title: 'Place an order',
      summary: 'Market orders fill now; limit and stop orders wait for a price.',
      content: (
        <div className="space-y-3">
          <ul className="space-y-1.5">
            <Point><Term>Market</Term> fills at once: a buy at the ask, a sell at the bid. The confirmation states the actual fill price, which can differ slightly from the screen because prices move between refreshes.</Point>
            <Point><Term>Limit</Term> waits for a better price: a buy limit sits below the current price, a sell limit above it.</Point>
            <Point><Term>Stop</Term> waits for the price to break through a level: a buy stop sits above the current price, a sell stop below it.</Point>
          </ul>
          <p>Limit and stop orders also need an <Term>order price</Term> and an expiry of <Term>1 to 168 hours</Term>. They wait under Pending orders until they fill, expire or you cancel them. A pending order fills at the quote that reaches its level, which can be better than the level you set.</p>
          <p>Use <Term>Why am I taking this trade?</Term> on the ticket to write your plan before you place it. It is kept with the order and shown again when you review the trade.</p>
          <p>You can have up to <Term>50</Term> open positions and pending orders together. If the connection drops while you place an order, trying again cannot open it twice.</p>
          {go('live', 'Go to the order ticket')}
        </div>
      ),
    },
    {
      id: 6,
      title: 'Manage open trades',
      summary: 'Close by hand, or let the stop-loss and take-profit work.',
      content: (
        <div className="space-y-3">
          <ul className="space-y-1.5">
            <Point><Term>Close</Term> exits a trade straight away: a buy closes at the bid, a sell at the ask.</Point>
            <Point>The server checks every new price. A trade closes on the first price that reaches its stop-loss or take-profit, <em>at that price</em>: if the market jumps past your stop, you get the worse price, as in real trading.</Point>
            <Point><Term>Margin call</Term>: at a margin level of 100% or less, new orders are refused until it recovers.</Point>
            <Point><Term>Stop-out</Term>: at 50% or less, the server closes your largest losing trade, then the next, until the level recovers.</Point>
          </ul>
        </div>
      ),
    },
    {
      id: 7,
      title: 'Review your results',
      summary: 'Results, history and the ledger keep a full record.',
      content: (
        <div className="space-y-3">
          <p>After your first closed trade, <Term>Your simulated results</Term> shows closed trades, win rate, net result, return and largest drawdown. The history tabs keep everything:</p>
          <ul className="space-y-1.5">
            <Point><Term>Closed trades</Term>: entry and exit, and why each trade closed (by you, stop-loss, take-profit or stop-out).</Point>
            <Point><Term>Orders</Term> and <Term>Executions</Term>: every order and every fill, at its simulated time.</Point>
            <Point><Term>Ledger</Term>: the opening funds and every trade result, with the running balance.</Point>
            <Point><Term>Accounts</Term>: your current account and any archived after a reset.</Point>
          </ul>
          <p>Every closed trade then waits in the <Term>Trade Journal</Term> for your review. Its figures come from the simulator; you add the setup, why you entered, whether you followed your plan, how you felt and what you would change. Link a review to a task to share it with your instructor.</p>
          {go('journal', 'Open the trade journal')}
        </div>
      ),
    },
    {
      id: 8,
      title: 'Tasks, leaderboard and resets',
      summary: 'Instructor tasks, an optional ranking, and a fresh start every 30 days.',
      content: (
        <div className="space-y-3">
          <ul className="space-y-1.5">
            <Point><Term>Tasks</Term>: your instructor can assign practice exercises. Do the work on the desk, then submit it from the Tasks tab, and link your trade reviews to the task so your instructor sees the trades themselves.</Point>
            <Point><Term>Practice leaderboard</Term>: optional. You appear under a random name, ranked by percentage return with your largest drawdown, after at least 5 closed trades. Ranks are simulated results, not evidence of real skill.</Point>
            <Point><Term>Reset</Term>: once every 30 days you can start again with USD 10,000. Close your open positions first. Your old account and its history are kept and still count in your results.</Point>
          </ul>
          {go('tasks', 'See your tasks')}
        </div>
      ),
    },
  ];

  return (
    <div className="card !p-5 sm:!p-7">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="page-kicker">Getting started</p>
          <h2 className="mt-3 font-display text-2xl font-semibold tracking-[-0.02em] text-ink">Practice desk guide</h2>
          <p className="mt-2 max-w-2xl text-sm text-ink-muted">
            How to use ForexOrbit&apos;s built-in simulator: open your account, read the market, plan a trade, place it and review the result.
          </p>
        </div>
        {onNavigate && (
          <button type="button" onClick={() => onNavigate('live')} className="btn btn-primary self-start lg:self-auto">
            Open the practice desk →
          </button>
        )}
      </div>

      {/* The rules at a glance (enforced by the server). */}
      <dl className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-[var(--fo-line)] sm:grid-cols-3 lg:grid-cols-6">
        {RULES.map(([label, value]) => (
          <div key={label} className="bg-surface-2 px-4 py-3">
            <dt className="readout-label">{label}</dt>
            <dd className="mt-1 font-display text-base font-semibold text-ink num">{value}</dd>
          </div>
        ))}
      </dl>

      {/* Steps along the orbit track */}
      <ol className="relative mt-6 space-y-2 before:pointer-events-none before:absolute before:bottom-6 before:left-[1.45rem] before:top-6 before:w-px before:bg-[var(--fo-line-strong)]">
        {steps.map((step) => {
          const open = activeStep === step.id;
          return (
            <li key={step.id} className={`relative rounded-xl border transition-colors ${open ? 'border-line-strong bg-surface-2' : 'border-transparent hover:bg-[color-mix(in_srgb,var(--fo-text)_4%,transparent)]'}`}>
              <button
                type="button"
                onClick={() => setActiveStep(open ? null : step.id)}
                aria-expanded={open}
                aria-controls={`guide-step-${step.id}`}
                className="flex min-h-[56px] w-full items-center gap-4 px-2.5 py-2.5 text-left"
              >
                <span
                  className={`relative z-[1] flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold num ring-4 ring-[var(--fo-surface-1)] transition-all ${open ? 'bg-primary-500 text-neutral-950 shadow-[0_0_12px_rgba(255,112,18,0.55)]' : 'border border-[var(--fo-line-strong)] bg-surface-1 text-ink-muted'}`}
                  aria-hidden
                >
                  {step.id}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-display text-[15px] font-semibold text-ink">{step.title}</span>
                  <span className="block text-xs text-ink-subtle">{step.summary}</span>
                </span>
                <svg className={`h-5 w-5 shrink-0 text-ink-subtle transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {open && (
                <div id={`guide-step-${step.id}`} className="animate-fade-in-fast pb-5 pl-[3.6rem] pr-4 text-sm leading-relaxed text-ink-muted">
                  {step.content}
                </div>
              )}
            </li>
          );
        })}
      </ol>

      <p className="mt-6 border-t border-line pt-4 text-xs text-ink-subtle">
        Educational simulation only. ForexOrbit Academy does not provide brokerage services and this is not financial advice.
      </p>
    </div>
  );
}
