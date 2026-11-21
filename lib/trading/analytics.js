'use strict';

/**
 * Practice trading analytics for the student dashboard (Phase 11). READ-ONLY.
 *
 * Unlike the desk's accountView, nothing here runs the engine (no recovery, no stop-loss or stop-out
 * evaluation): opening the dashboard can never close a position, write the ledger or change an
 * account. Figures therefore reflect the records as stored plus the latest simulated quote; the
 * desk and the sweep apply exits as before.
 *
 * Definitions (all money is exact: BigInt cents from the stored Decimal128 values, lib/trading/money.js;
 * every amount leaves as a decimal string and the browser computes nothing):
 *   Closed trade      a tradingPositions row with status 'closed', over all of the student's accounts
 *                     (archived ones included, as in performanceOf). Open and void positions are never
 *                     counted as trades; orders, executions and ledger rows are not counted at all, so
 *                     nothing is double-counted.
 *   Realised result   the position's stored realizedPl (spread included). Unrealised results of open
 *                     positions are shown separately, on the active account only.
 *   Win / loss        realizedPl > 0 / < 0; exactly 0 is breakeven (counts as a trade, neither side).
 *   Win rate          wins / closed trades, as a percentage (2 decimals, half-even).
 *   Average win       sum of winning results / wins (half-even to the cent); null with no wins.
 *   Average loss      sum of losing results / losses (negative); null with no losses.
 *   Daily series      closed trades grouped by the calendar day of closedAt in the learning timezone
 *                     (lib/learning-activity.js), with the day's net result and the running total.
 */

const { divideHalfEven, formatMoney, moneyFrom, percentOf, PERCENT_SCALE, formatDecimal } = require('./money');
const I = require('./instruments');
const E = require('./engine');
const { marketView, presentAccount, presentPosition } = require('./views');
const { dayKey } = require('../learning-activity');
const { MARKET_LABEL } = require('../market/health');

const COLLECTIONS = E.COLLECTIONS;
const RECENT_LIMIT = 8;
/** Days of the daily series returned (most recent days with closed trades). */
const SERIES_DAYS = 180;

const percentText = (hundredths) => (hundredths === null ? null : formatDecimal(hundredths, PERCENT_SCALE));
const iso = (value) => (value ? new Date(value).toISOString() : null);
const money = (value) => (value === null ? null : formatMoney(value));

/** Performance over closed positions (pure: rows in, figures out). */
function performanceFrom(closedRows) {
  let net = 0n;
  let grossWin = 0n;
  let grossLoss = 0n;
  let wins = 0;
  let losses = 0;
  let best = null;
  let worst = null;
  const byInstrument = new Map();
  const byDay = new Map();
  const reasons = {};
  for (const row of closedRows) {
    const pl = moneyFrom(row.realizedPl);
    net += pl;
    if (pl > 0n) { wins += 1; grossWin += pl; }
    else if (pl < 0n) { losses += 1; grossLoss += pl; }
    if (best === null || pl > best) best = pl;
    if (worst === null || pl < worst) worst = pl;
    const inst = byInstrument.get(row.instrument) || { trades: 0, wins: 0, losses: 0, net: 0n };
    inst.trades += 1;
    if (pl > 0n) inst.wins += 1;
    else if (pl < 0n) inst.losses += 1;
    inst.net += pl;
    byInstrument.set(row.instrument, inst);
    if (row.closedAt) {
      const key = dayKey(new Date(row.closedAt));
      const day = byDay.get(key) || { trades: 0, net: 0n };
      day.trades += 1;
      day.net += pl;
      byDay.set(key, day);
    }
    const reason = typeof row.closeReason === 'string' ? row.closeReason : 'other';
    reasons[reason] = (reasons[reason] || 0) + 1;
  }
  const trades = closedRows.length;
  let running = 0n;
  const days = [...byDay.keys()].sort();
  const series = days.map((day) => {
    const d = byDay.get(day);
    running += d.net;
    return { day, trades: d.trades, net: formatMoney(d.net), cumulative: formatMoney(running) };
  }).slice(-SERIES_DAYS);
  return {
    closedTrades: trades,
    wins,
    losses,
    breakeven: trades - wins - losses,
    winRate: trades ? percentText(percentOf(BigInt(wins), BigInt(trades))) : null,
    netRealized: formatMoney(net),
    grossProfit: formatMoney(grossWin),
    grossLoss: formatMoney(grossLoss),
    averageWin: wins ? formatMoney(divideHalfEven(grossWin, BigInt(wins))) : null,
    averageLoss: losses ? formatMoney(divideHalfEven(grossLoss, BigInt(losses))) : null,
    bestTrade: money(best),
    worstTrade: money(worst),
    closeReasons: reasons,
    byInstrument: [...byInstrument.entries()]
      .map(([instrument, v]) => ({
        instrument,
        trades: v.trades,
        wins: v.wins,
        losses: v.losses,
        winRate: percentText(percentOf(BigInt(v.wins), BigInt(v.trades))),
        net: formatMoney(v.net),
      }))
      .sort((a, b) => b.trades - a.trades || a.instrument.localeCompare(b.instrument)),
    series,
  };
}

/** The active account as stored, valued at the latest simulated quote. No engine call, no writes. */
async function accountOverview(db, userId, { now = new Date(), env = process.env } = {}) {
  const account = await E.activeAccount(db, userId);
  if (!account) return null;
  const [slot, openRows, pendingCount, market] = await Promise.all([
    db.collection(COLLECTIONS.slots).findOne({ _id: userId }),
    db.collection(COLLECTIONS.positions).find({ accountId: account._id, status: 'open' }).sort({ openedAt: -1 }).toArray(),
    db.collection(COLLECTIONS.orders).countDocuments({ accountId: account._id, status: 'pending' }),
    marketView(db, { now, env }),
  ]);
  let quotes = market.quotes || {};
  if (market.state && market.state.dataset && market.state.simTime && !market.state.open) quotes = {};
  const figures = I.accountFigures({ balance: moneyFrom(account.balance), positions: openRows.map(E.positionValues), quotes });
  return {
    account: presentAccount(account, figures, slot),
    openPositions: openRows.length,
    pendingOrders: pendingCount,
    positions: openRows.slice(0, RECENT_LIMIT).map((row) => presentPosition(row, quotes[row.instrument])),
    market: { label: MARKET_LABEL, open: Boolean(market.view && market.view.open) },
  };
}

/**
 * Everything the dashboard shows about practice trading for one student. `userId` always comes from
 * the session; every query is scoped to it (or to that student's active account).
 */
async function tradingAnalytics(db, userId, { now = new Date(), env = process.env } = {}) {
  const positions = db.collection(COLLECTIONS.positions);
  const [overview, closed, recentRows, accounts, reviewed] = await Promise.all([
    accountOverview(db, userId, { now, env }),
    positions.find({ userId, status: 'closed' }, { projection: { instrument: 1, realizedPl: 1, closedAt: 1, closeReason: 1 } }).toArray(),
    positions.find({ userId, status: { $in: ['open', 'closed'] } }).sort({ openedAt: -1, _id: -1 }).limit(RECENT_LIMIT).toArray(),
    db.collection(COLLECTIONS.accounts).countDocuments({ userId }),
    db.collection('tradingReviews').countDocuments({ userId }),
  ]);
  const performance = performanceFrom(closed);
  return {
    simulated: true,
    marketLabel: MARKET_LABEL,
    hasAccount: Boolean(overview),
    accounts,
    overview,
    performance,
    reviews: { reviewed, pending: Math.max(0, performance.closedTrades - reviewed) },
    recent: recentRows.map((row) => ({ ...presentPosition(row, null), openedAt: iso(row.openedAt) })),
    firstClosedAt: closed.reduce((first, row) => (row.closedAt && (!first || new Date(row.closedAt) < first) ? new Date(row.closedAt) : first), null),
  };
}

module.exports = { RECENT_LIMIT, SERIES_DAYS, accountOverview, performanceFrom, tradingAnalytics };
