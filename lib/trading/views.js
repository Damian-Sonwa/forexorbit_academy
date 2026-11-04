'use strict';

/**
 * What students see of the simulator (Phase 10, G6, G9). All money and prices leave as decimal
 * strings: the browser displays them and computes nothing. Internal fields never leave.
 */

const crypto = require('crypto');
const { ObjectId } = require('mongodb');
const { MONEY_ONE, PERCENT_SCALE, divideHalfEven, formatDecimal, formatMoney, formatPrice, moneyFrom, percentOf, priceFrom } = require('./money');
const I = require('./instruments');
const { marketState, quotesAt, INSTRUMENT_IDS } = require('./market-data');
const E = require('./engine');
const { activeSessions, nextOpen } = require('./calendar');
const { MARKET_LABEL } = require('../market/health');
const { MAX_CANDLES, TIMEFRAMES, candles } = require('../market/series');

const COLLECTIONS = E.COLLECTIONS;
const PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const LEADERBOARD_MIN_TRADES = 5;
const LEADERBOARD_LIMIT = 100;

const percentText = (hundredths) => (hundredths === null ? null : formatDecimal(hundredths, PERCENT_SCALE));
const pricedText = (stored) => (stored === null || stored === undefined ? null : formatPrice(priceFrom(stored)));

function pageOf({ page, limit } = {}) {
  const size = Math.min(MAX_PAGE_SIZE, Math.max(1, Number.isInteger(limit) ? limit : PAGE_SIZE));
  const number = Math.max(1, Number.isInteger(page) ? page : 1);
  return { page: number, limit: size, skip: (number - 1) * size };
}

function presentOrder(row) {
  return {
    id: String(row._id),
    type: row.type,
    instrument: row.instrument,
    side: row.side,
    units: String(row.units),
    price: pricedText(row.price),
    stopLoss: pricedText(row.stopLoss),
    takeProfit: pricedText(row.takeProfit),
    status: row.status,
    rejectReason: row.rejectReason || null,
    rejectMessage: row.rejectReason ? E.reasonText(row.rejectReason) : null,
    fillPrice: pricedText(row.fillPrice),
    expiresAt: row.expiresSimAt ? new Date(row.expiresSimAt).toISOString() : null,
    createdAt: new Date(row.createdAt).toISOString(),
  };
}

function presentPosition(row, quote) {
  const p = E.positionValues(row);
  const open = row.status === 'open';
  const current = open && quote ? I.exitPriceOf(p.side, quote) : null;
  const unrealized = current === null ? null : I.profitLoss({ instrument: I.INSTRUMENTS[p.instrument], side: p.side, units: p.units, entry: p.entry, exit: current });
  return {
    id: String(row._id),
    instrument: row.instrument,
    side: row.side,
    units: String(row.units),
    entry: formatPrice(p.entry),
    stopLoss: formatPrice(p.stopLoss),
    takeProfit: p.takeProfit === null ? null : formatPrice(p.takeProfit),
    margin: formatMoney(p.margin),
    plannedRisk: formatMoney(p.plannedRisk),
    status: row.status,
    currentPrice: current === null ? null : formatPrice(current),
    unrealizedPl: unrealized === null ? null : formatMoney(unrealized),
    exit: pricedText(row.exit),
    realizedPl: row.realizedPl ? formatMoney(moneyFrom(row.realizedPl)) : null,
    closeReason: row.closeReason || null,
    openedAt: new Date(row.openedAt).toISOString(),
    closedAt: row.closedAt ? new Date(row.closedAt).toISOString() : null,
  };
}

function presentAccount(account, figures, slot) {
  const start = moneyFrom(account.startingBalance);
  return {
    id: String(account._id),
    virtual: true,
    currency: account.currency,
    status: account.status,
    generation: account.generation,
    startingBalance: formatMoney(start),
    balance: formatMoney(figures.balance),
    equity: figures.equity === null ? null : formatMoney(figures.equity),
    usedMargin: formatMoney(figures.usedMargin),
    freeMargin: figures.freeMargin === null ? null : formatMoney(figures.freeMargin),
    marginLevel: percentText(figures.marginLevel),
    unrealizedPl: figures.unrealized === null ? null : formatMoney(figures.unrealized),
    marginCall: figures.marginLevel !== null && figures.marginLevel <= I.MARGIN_CALL_LEVEL,
    leverage: `1:${I.LEVERAGE}`,
    lastResetAt: slot && slot.lastResetAt ? new Date(slot.lastResetAt).toISOString() : null,
    nextResetAt: slot && slot.lastResetAt ? new Date(new Date(slot.lastResetAt).getTime() + E.RESET_INTERVAL_MS).toISOString() : null,
    leaderboardOptIn: Boolean(slot && slot.leaderboardOptIn),
  };
}

/** Market status and rules, for anyone signed in, with or without an account. */
async function marketView(db, { now = new Date(), env = process.env } = {}) {
  const market = await marketState(db, { now, env });
  let quotes = {};
  let unavailable = {};
  if (market.dataset && market.simTime && market.open) {
    const result = await quotesAt(db, market.dataset, market.dataset.instruments || INSTRUMENT_IDS, market.simTime);
    quotes = result.quotes;
    unavailable = result.missing;
  }
  return {
    state: market,
    view: {
      open: market.open,
      reason: market.reason || null,
      label: MARKET_LABEL,
      message: market.open ? null : E.reasonText(market.reason),
      simulatedTime: market.simTime ? market.simTime.toISOString() : null,
      sessions: market.simTime ? activeSessions(market.simTime) : [],
      nextOpen: market.simTime && !market.open ? (nextOpen(market.simTime) || new Date(0)).toISOString() : null,
      dataset: market.dataset ? { name: market.dataset.name, source: market.dataset.provenance && market.dataset.provenance.source, testFixture: market.dataset.testFixture === true } : null,
      instruments: Object.values(I.INSTRUMENTS).map((instrument) => {
        const quote = quotes[instrument.id];
        return {
          id: instrument.id,
          label: instrument.label,
          priceDecimals: instrument.priceDecimals,
          bid: quote ? formatPrice(quote.bid) : null,
          ask: quote ? formatPrice(quote.ask) : null,
          spreadPips: quote ? formatDecimal(((quote.ask - quote.bid) * 10n) / I.pipSize(instrument), 1) : null,
          time: quote ? quote.time.toISOString() : null,
          unavailable: unavailable[instrument.id] || null,
        };
      }),
    },
    quotes,
  };
}

/** Everything the trading page needs. Finishes any interrupted work on this account first. */
async function accountView(db, { userId, now = new Date(), env = process.env }) {
  const account0 = await E.activeAccount(db, userId);
  if (!account0) return { account: null, market: (await marketView(db, { now, env })).view, positions: [], pendingOrders: [] };
  await E.recoverOperations(db, { now, accountId: account0._id });
  await E.evaluateAccount(db, account0._id, { now, env });
  const account = await E.activeAccount(db, userId);
  const slot = await db.collection(COLLECTIONS.slots).findOne({ _id: userId });
  const { state, view, quotes: shown } = await marketView(db, { now, env });
  const rows = await db.collection(COLLECTIONS.positions).find({ accountId: account._id, status: 'open' }).sort({ openedAt: -1 }).toArray();
  const positions = rows.map(E.positionValues);
  let quotes = shown;
  if (state.dataset && state.simTime && !state.open) quotes = {};
  const figures = I.accountFigures({ balance: moneyFrom(account.balance), positions, quotes });
  const pending = await db.collection(COLLECTIONS.orders).find({ accountId: account._id, status: 'pending' }).sort({ createdAt: -1 }).toArray();
  return {
    account: presentAccount(account, figures, slot),
    market: view,
    positions: rows.map((row) => presentPosition(row, quotes[row.instrument])),
    pendingOrders: pending.map(presentOrder),
  };
}

async function history(db, { userId, kind, page, limit, accountId }) {
  const paging = pageOf({ page, limit });
  if (kind === 'resets') return accountGenerations(db, userId, paging);
  if (kind === 'executions') return executions(db, userId, paging);
  const collection = { orders: COLLECTIONS.orders, positions: COLLECTIONS.positions, ledger: COLLECTIONS.ledger }[kind];
  const filter = {};
  if (kind === 'ledger') {
    // The ledger holds no user id: it is reached through the student's own accounts.
    const own = await db.collection(COLLECTIONS.accounts).find({ userId }, { projection: { _id: 1 } }).toArray();
    filter.accountId = { $in: own.map((a) => a._id) };
  } else filter.userId = userId;
  if (kind === 'positions') filter.status = 'closed';
  if (accountId && ObjectId.isValid(accountId) && String(accountId).length === 24) {
    const wanted = new ObjectId(accountId);
    if (kind !== 'ledger') filter.accountId = wanted;
    else filter.accountId = { $in: filter.accountId.$in.filter((id) => id.equals(wanted)) };
  }
  const sort = kind === 'ledger' ? { createdAt: -1, seq: -1 } : { createdAt: -1, openedAt: -1, _id: -1 };
  const col = db.collection(collection);
  const [rows, total] = await Promise.all([col.find(filter).sort(sort).skip(paging.skip).limit(paging.limit).toArray(), col.countDocuments(filter)]);
  const present = kind === 'orders' ? presentOrder : kind === 'positions' ? (row) => presentPosition(row, null) : (row) => ({
    id: row._id,
    seq: row.seq,
    type: row.type,
    amount: formatMoney(moneyFrom(row.amount)),
    balanceAfter: formatMoney(moneyFrom(row.balanceAfter)),
    reference: row.reference,
    createdAt: new Date(row.createdAt).toISOString(),
  });
  return { rows: rows.map(present), pagination: { page: paging.page, limit: paging.limit, total, pages: Math.ceil(total / paging.limit) } };
}

/** Every fill and close, with the recorded price and time. */
async function executions(db, userId, paging) {
  const col = db.collection(COLLECTIONS.operations);
  const filter = { userId, status: 'done', type: { $in: ['fill', 'close'] } };
  const [rows, total] = await Promise.all([col.find(filter).sort({ executedAt: -1, _id: 1 }).skip(paging.skip).limit(paging.limit).toArray(), col.countDocuments(filter)]);
  const positions = await db.collection(COLLECTIONS.positions).find({ _id: { $in: rows.map((r) => r.positionId) } }, { projection: { instrument: 1, side: 1, units: 1 } }).toArray();
  const byId = new Map(positions.map((p) => [String(p._id), p]));
  return {
    rows: rows.map((row) => {
      const position = byId.get(String(row.positionId)) || {};
      return {
        id: row._id,
        kind: row.type,
        instrument: position.instrument || null,
        side: position.side || null,
        units: position.units ? String(position.units) : null,
        price: pricedText(row.type === 'fill' ? row.entry : row.exit),
        realizedPl: row.realizedPl ? formatMoney(moneyFrom(row.realizedPl)) : null,
        reason: row.reason || null,
        simulatedAt: row.simAt ? new Date(row.simAt).toISOString() : null,
      };
    }),
    pagination: { page: paging.page, limit: paging.limit, total, pages: Math.ceil(total / paging.limit) },
  };
}

/** Each account the student has held, newest first. Old accounts are kept after a reset. */
async function accountGenerations(db, userId, paging) {
  const col = db.collection(COLLECTIONS.accounts);
  const filter = { userId };
  const [rows, total] = await Promise.all([col.find(filter).sort({ generation: -1 }).skip(paging.skip).limit(paging.limit).toArray(), col.countDocuments(filter)]);
  return {
    rows: rows.map((row) => ({
      id: String(row._id),
      generation: row.generation,
      status: row.status,
      startingBalance: formatMoney(moneyFrom(row.startingBalance)),
      balance: formatMoney(moneyFrom(row.balance)),
      closedTrades: row.closedTrades || 0,
      openedAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
      archivedAt: row.archivedAt ? new Date(row.archivedAt).toISOString() : null,
    })),
    pagination: { page: paging.page, limit: paging.limit, total, pages: Math.ceil(total / paging.limit) },
  };
}

/** Candles up to the current simulated time, never beyond it. Any signed-in student sees the same. */
async function candleView(db, { instrument, timeframe, count, now = new Date(), env = process.env }) {
  const market = await marketState(db, { now, env });
  const base = { label: MARKET_LABEL, instrument, timeframe, candles: [] };
  if (!I.instrumentOf(instrument)) return { ok: false, status: 400, code: 'invalid_instrument', error: 'This pair is not available.' };
  if (!TIMEFRAMES[timeframe]) return { ok: false, status: 400, code: 'invalid_timeframe', error: 'This timeframe is not available.' };
  if (!market.dataset || !market.simTime || market.dataset.kind !== 'synthetic') return { ok: true, ...base, reason: market.reason || 'no_candles' };
  return { ok: true, ...base, candles: await candles(db, market.dataset, instrument, timeframe, market.simTime, Math.min(MAX_CANDLES, count || 120)) };
}

/**
 * Performance from closed positions only, across all of the student's accounts, so a reset does not
 * erase a loss. Definitions: docs/audits/phase-10-practice-trading.md, section 12.
 */
async function performanceOf(db, userId) {
  const accounts = await db.collection(COLLECTIONS.accounts).find({ userId }).toArray();
  const closed = await db.collection(COLLECTIONS.positions).find({ userId, status: 'closed' }).toArray();
  let net = 0n;
  let wins = 0;
  let losses = 0;
  for (const row of closed) {
    const pl = moneyFrom(row.realizedPl);
    net += pl;
    if (pl > 0n) wins += 1;
    else if (pl < 0n) losses += 1;
  }
  const capital = accounts.reduce((sum, a) => sum + moneyFrom(a.startingBalance), 0n);
  let drawdown = null;
  for (const account of accounts) {
    const peak = moneyFrom(account.peakBalance);
    const value = peak > 0n ? percentOf(moneyFrom(account.maxDrawdown), peak) : 0n;
    if (drawdown === null || value > drawdown) drawdown = value;
  }
  return {
    closedTrades: closed.length,
    wins,
    losses,
    breakeven: closed.length - wins - losses,
    winRate: closed.length ? percentText(percentOf(BigInt(wins), BigInt(closed.length))) : null,
    netResult: formatMoney(net),
    returnPercent: capital > 0n ? percentText(percentOf(net, capital)) : null,
    maxDrawdownPercent: percentText(drawdown),
    accounts: accounts.length,
  };
}

/** Pseudonym chosen by the server, unrelated to the person's name or id. */
const newAlias = () => `Trader-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

async function setLeaderboardOptIn(db, { userId, optIn }) {
  const slots = db.collection(COLLECTIONS.slots);
  const slot = await slots.findOne({ _id: userId });
  if (!slot) return { ok: false, status: 404, code: 'account_not_found', error: 'Create a practice account first.' };
  const update = { leaderboardOptIn: optIn === true };
  // Leaving drops the alias too: a later return gets a new one, unlinkable to the old rows.
  update.alias = optIn === true ? slot.alias || newAlias() : null;
  await slots.updateOne({ _id: userId }, { $set: update });
  return { ok: true, leaderboardOptIn: update.leaderboardOptIn };
}

/**
 * Opted-in students only, ranked by return on all capital ever issued to them, so a reset cannot
 * improve a position. Shows the pseudonym, return, drawdown and trade count: nothing else.
 */
async function leaderboard(db, { userId }) {
  const slots = await db.collection(COLLECTIONS.slots).find({ leaderboardOptIn: true }).limit(1000).toArray();
  const rows = [];
  for (const slot of slots) {
    const stats = await performanceOf(db, slot._id);
    if (stats.closedTrades < LEADERBOARD_MIN_TRADES || stats.returnPercent === null) continue;
    rows.push({ alias: slot.alias, returnPercent: stats.returnPercent, maxDrawdownPercent: stats.maxDrawdownPercent, closedTrades: stats.closedTrades, you: slot._id === userId, sort: BigInt(stats.returnPercent.replace('.', '')) });
  }
  // Ties break on the alias, so a rank does not depend on the order rows were read.
  rows.sort((a, b) => (a.sort === b.sort ? a.alias.localeCompare(b.alias) : a.sort > b.sort ? -1 : 1));
  return { minimumTrades: LEADERBOARD_MIN_TRADES, rows: rows.slice(0, LEADERBOARD_LIMIT).map((row, index) => { const { alias, returnPercent, maxDrawdownPercent, closedTrades, you } = row; return { rank: index + 1, alias, returnPercent, maxDrawdownPercent, closedTrades, you }; }) };
}

module.exports = {
  candleView, MONEY_ONE, accountView, divideHalfEven, history, leaderboard, marketView, performanceOf, presentOrder, presentPosition, setLeaderboardOptIn };
