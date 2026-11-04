'use strict';

/**
 * The practice simulator's accounts, orders, positions and ledger (Phase 10, G3-G6). Virtual funds
 * only; no broker is involved. Formulas: lib/trading/instruments.js. Prices: lib/trading/market-data.js.
 *
 * Consistency. Transactions are not assumed (the app uses none and the local server is standalone),
 * so every change is a recoverable workflow built on three facts:
 *  - The account document is the single point of serialization. Every balance or margin change is one
 *    compare-and-set on `version`, so concurrent requests cannot both spend the same funds.
 *  - Identities are deterministic, so a retry cannot duplicate: an order's _id is a hash of the
 *    account and the client's key; a fill's operation is `fill:<orderId>`; a close's is
 *    `close:<positionId>`; a ledger row's _id is `<accountId>:<seq>`.
 *  - An operation is written before the account changes and records its result on the account
 *    (`applied.<opId>`) in the same atomic update. Anything found half-done is finished from those
 *    records (recoverOperations); nothing is ever computed twice.
 *  - Rules are checked only on a settled account: a request first finishes any operation already
 *    applied (settleApplied), so it cannot miss a fill whose position is not written yet.
 *
 * tradingLedger is append-only: this file inserts rows and never updates or deletes one.
 */

const crypto = require('crypto');
const { Decimal128, ObjectId } = require('mongodb');
const { PERCENT_SCALE, formatDecimal, formatMoney, formatPrice, moneyFrom, parsePrice, percentOf, priceFrom } = require('./money');
const I = require('./instruments');
const { marketState, quotesAt, quotesBetween } = require('./market-data');

const COLLECTIONS = Object.freeze({
  slots: 'tradingAccountSlots',
  accounts: 'tradingAccounts',
  operations: 'tradingOperations',
  orders: 'tradingOrders',
  positions: 'tradingPositions',
  ledger: 'tradingLedger',
});
const ORDER_TYPES = Object.freeze(['market', 'limit', 'stop']);
const CLIENT_ORDER_ID = /^[A-Za-z0-9-]{8,64}$/;
const CAS_ROUNDS = 12;
const RESET_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_EXPIRY_HOURS = 24;
const MAX_EXPIRY_HOURS = 168;
const MAX_OPEN_ITEMS = 50;
/** Older than this, an unfinished operation is no longer running and may be recovered. */
const STALE_OPERATION_MS = 2 * 60 * 1000;
const EVALUATION_QUOTE_LIMIT = 5000;

const d128 = (text) => Decimal128.fromString(text);
const money = (value) => d128(formatMoney(value));
const price = (value) => d128(formatPrice(value));
const refuse = (status, code, error) => ({ ok: false, status, code, error });
const isDuplicateKey = (error) => Boolean(error && (error.code === 11000 || error.codeName === 'DuplicateKey'));

async function insertIgnoringDuplicate(collection, doc) {
  try {
    await collection.insertOne(doc);
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
  }
}

const REASONS = Object.freeze({
  no_verified_data: 'Practice trading is paused: no verified market data is available.',
  market_initialising: 'The simulated market is starting up. Trading opens when it is ready.',
  market_suspended: 'The simulated market is suspended. Your positions are safe and unchanged, but nothing can be valued or traded until it resumes.',
  market_recovering: 'The simulated market is recovering. Trading resumes after its history is verified.',
  market_error: 'The simulated market failed a check, so trading is suspended. Your positions are safe and unchanged.',
  market_stale: 'The simulated market has not been confirmed recently, so trading is suspended. Your positions are safe and unchanged.',
  early_close: 'The simulated market closed early for a holiday.',
  data_not_started: 'Practice trading is paused: the market data has not started.',
  data_ended: 'Practice trading is paused: the recorded market data has ended.',
  weekend: 'The forex market is closed for the weekend.',
  holiday: 'The forex market is closed for a holiday.',
  invalid_time: 'The market is not available.',
  quote_missing: 'No price is available for this pair right now, so nothing was executed.',
  quote_stale: 'The latest price is too old to trade on, so nothing was executed.',
  quote_corrupt: 'The latest price failed its checks, so nothing was executed.',
  quote_outside_session: 'No price from the current market session is available.',
  market_data_unavailable: 'A price needed to value your account is unavailable, so nothing was executed.',
  insufficient_margin: 'You do not have enough free margin for this order.',
  margin_call: 'New orders are blocked while your margin level is at or below 100%.',
  risk_per_trade_exceeded: 'This trade risks more than 2% of your equity. Reduce the size or move the stop-loss closer.',
  total_risk_exceeded: 'This trade would take your planned risk across open trades above 5% of equity.',
  too_many_open_items: 'You have too many open positions and pending orders.',
  account_not_active: 'This practice account is no longer active.',
  invalid_stop_loss: 'The stop-loss must be below the entry price on a buy and above it on a sell.',
  invalid_take_profit: 'The take-profit must be above the entry price on a buy and below it on a sell.',
  invalid_order_price: 'A limit order waits for a better price than now, and a stop order for a worse one. Check the order price.',
  interrupted: 'This order was interrupted before it could execute. Nothing was charged.',
});
const reasonText = (code) => REASONS[code] || 'The order could not be executed.';

// ---------------------------------------------------------------------------
// Reading stored documents into exact values
// ---------------------------------------------------------------------------

function positionValues(row) {
  return {
    ...row,
    units: BigInt(row.units),
    entry: priceFrom(row.entry),
    stopLoss: priceFrom(row.stopLoss),
    takeProfit: row.takeProfit ? priceFrom(row.takeProfit) : null,
    margin: moneyFrom(row.margin),
    plannedRisk: moneyFrom(row.plannedRisk),
  };
}

const openPositions = async (db, accountId) => (await db.collection(COLLECTIONS.positions).find({ accountId, status: 'open' }).toArray()).map(positionValues);
const pendingOrders = (db, accountId) => db.collection(COLLECTIONS.orders).find({ accountId, status: 'pending' }).toArray();
const loadAccount = (db, accountId) => db.collection(COLLECTIONS.accounts).findOne({ _id: accountId });

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

/** The new account and its opening ledger row. Repeating this changes nothing. */
async function materializeAccount(db, { accountId, userId, generation, now }) {
  const opening = formatMoney(I.STARTING_BALANCE);
  await insertIgnoringDuplicate(db.collection(COLLECTIONS.ledger), {
    _id: `${accountId}:1`,
    accountId,
    seq: 1,
    type: 'deposit',
    amount: d128(opening),
    balanceAfter: d128(opening),
    reference: 'opening_virtual_funds',
    createdAt: now,
  });
  await insertIgnoringDuplicate(db.collection(COLLECTIONS.accounts), {
    _id: accountId,
    userId,
    generation,
    status: 'active',
    currency: I.ACCOUNT_CURRENCY,
    balance: d128(opening),
    startingBalance: d128(opening),
    usedMargin: d128('0.00'),
    peakBalance: d128(opening),
    maxDrawdown: d128('0.00'),
    closedTrades: 0,
    ledgerSeq: 1,
    version: 0,
    applied: {},
    marginCall: false,
    evaluatedThrough: null,
    createdAt: now,
    updatedAt: now,
  });
}

/**
 * The student's active account, created when absent. The slot (_id = user id) is what makes "one
 * active account per student" hold under concurrency, before any index exists. The balance is
 * always the server's; nothing in a request can set it.
 */
async function ensureAccount(db, { userId, now = new Date() }) {
  const slots = db.collection(COLLECTIONS.slots);
  let slot = await slots.findOne({ _id: userId });
  if (!slot) {
    const fresh = { _id: userId, activeAccountId: new ObjectId(), generation: 1, lastResetAt: null, leaderboardOptIn: false, alias: null, createdAt: now };
    try {
      await slots.insertOne(fresh);
      slot = fresh;
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      slot = await slots.findOne({ _id: userId });
    }
  }
  const existing = await loadAccount(db, slot.activeAccountId);
  if (existing) return existing;
  await materializeAccount(db, { accountId: slot.activeAccountId, userId, generation: slot.generation, now });
  return loadAccount(db, slot.activeAccountId);
}

async function activeAccount(db, userId) {
  const slot = await db.collection(COLLECTIONS.slots).findOne({ _id: userId });
  if (!slot) return null;
  return loadAccount(db, slot.activeAccountId);
}

// ---------------------------------------------------------------------------
// Risk rules
// ---------------------------------------------------------------------------

/** Every account rule for a new exposure. `excludeOrderId` leaves out the order being filled. */
function checkOrderRules({ account, positions, pending, quotes, instrument, side, units, entry, stopLoss, excludeOrderId }) {
  const figures = I.accountFigures({ balance: moneyFrom(account.balance), positions, quotes });
  if (figures.equity === null) return { ok: false, code: 'market_data_unavailable' };
  if (figures.marginLevel !== null && figures.marginLevel <= I.MARGIN_CALL_LEVEL) return { ok: false, code: 'margin_call' };
  const margin = I.requiredMargin(instrument, units, entry);
  if (margin > figures.freeMargin) return { ok: false, code: 'insufficient_margin' };
  const risk = I.plannedRisk({ instrument, side, units, entry, stopLoss });
  if (risk > I.percentOfMoney(figures.equity, I.MAX_RISK_PER_TRADE_PERCENT)) return { ok: false, code: 'risk_per_trade_exceeded' };
  let total = risk;
  for (const position of positions) total += position.plannedRisk;
  for (const order of pending) if (String(order._id) !== String(excludeOrderId)) total += moneyFrom(order.plannedRisk);
  if (total > I.percentOfMoney(figures.equity, I.MAX_TOTAL_RISK_PERCENT)) return { ok: false, code: 'total_risk_exceeded' };
  return { ok: true, margin, risk };
}

/** Parses and checks a request. Everything financial comes from here or from the server. */
function readOrderInput(body) {
  const input = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const bad = (error) => refuse(400, 'invalid_order', error);
  if (typeof input.clientOrderId !== 'string' || !CLIENT_ORDER_ID.test(input.clientOrderId)) return bad('A valid order key is required.');
  if (!ORDER_TYPES.includes(input.type)) return bad('Order type must be market, limit or stop.');
  const instrument = I.instrumentOf(input.instrument);
  if (!instrument) return bad('This pair is not available.');
  if (input.side !== 'buy' && input.side !== 'sell') return bad('Side must be buy or sell.');
  if (typeof input.units !== 'string' || !/^[1-9]\d{0,9}$/.test(input.units)) return bad('Units must be a whole number.');
  const units = BigInt(input.units);
  if (units < I.MIN_UNITS) return bad(`The minimum trade size is ${I.MIN_UNITS} units.`);
  if (units > I.MAX_UNITS) return bad(`The maximum trade size is ${I.MAX_UNITS} units.`);
  const priceField = (value) => {
    const parsed = typeof value === 'string' ? parsePrice(value) : null;
    return parsed !== null && parsed > 0n && I.priceFitsInstrument(parsed, instrument) ? parsed : null;
  };
  const stopLoss = priceField(input.stopLoss);
  if (stopLoss === null) return bad('A valid stop-loss is required on every order.');
  let takeProfit = null;
  if (input.takeProfit !== undefined && input.takeProfit !== null && input.takeProfit !== '') {
    takeProfit = priceField(input.takeProfit);
    if (takeProfit === null) return bad('The take-profit is not a valid price.');
  }
  let limitPrice = null;
  let expiryHours = null;
  if (input.type !== 'market') {
    limitPrice = priceField(input.price);
    if (limitPrice === null) return bad('A valid order price is required.');
    expiryHours = input.expiryHours === undefined ? DEFAULT_EXPIRY_HOURS : input.expiryHours;
    if (!Number.isInteger(expiryHours) || expiryHours < 1 || expiryHours > MAX_EXPIRY_HOURS) return bad(`Expiry must be 1 to ${MAX_EXPIRY_HOURS} hours.`);
  }
  return { ok: true, clientOrderId: input.clientOrderId, type: input.type, instrument, side: input.side, units, stopLoss, takeProfit, limitPrice, expiryHours };
}

/** Stop-loss and take-profit must sit on the correct side of the entry. */
function checkStops({ side, entry, stopLoss, takeProfit }) {
  const slOk = side === 'buy' ? stopLoss < entry : stopLoss > entry;
  if (!slOk) return refuse(400, 'invalid_stop_loss', side === 'buy' ? 'A buy needs its stop-loss below the entry price.' : 'A sell needs its stop-loss above the entry price.');
  if (takeProfit !== null) {
    const tpOk = side === 'buy' ? takeProfit > entry : takeProfit < entry;
    if (!tpOk) return refuse(400, 'invalid_take_profit', side === 'buy' ? 'A buy needs its take-profit above the entry price.' : 'A sell needs its take-profit below the entry price.');
  }
  return { ok: true };
}

/** A limit waits for a better price; a stop waits for the market to move through a worse one. */
function checkPendingPrice({ type, side, limitPrice, quote }) {
  const reference = I.entryPriceOf(side, quote);
  const ok = type === 'limit'
    ? (side === 'buy' ? limitPrice < reference : limitPrice > reference)
    : (side === 'buy' ? limitPrice > reference : limitPrice < reference);
  return ok ? { ok: true } : refuse(400, 'invalid_order_price', `A ${side} ${type} must be ${(type === 'limit') === (side === 'buy') ? 'below' : 'above'} the current price.`);
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

function orderIdFor(accountId, clientOrderId) {
  const digest = crypto.createHash('sha256').update(`${accountId}:${clientOrderId}`).digest('hex');
  return new ObjectId(digest.slice(0, 24));
}

const fingerprintOf = (input) => [input.type, input.instrument.id, input.side, input.units, input.limitPrice, input.stopLoss, input.takeProfit, input.expiryHours].map(String).join('|');

async function rejectOrder(db, order, code, now) {
  await db.collection(COLLECTIONS.orders).updateOne(
    { _id: order._id, status: { $in: ['received', 'executing', 'pending'] } },
    { $set: { status: 'rejected', rejectReason: code, finishedAt: now } }
  );
  return db.collection(COLLECTIONS.orders).findOne({ _id: order._id });
}

/** Finishes an applied fill. Safe to repeat. */
async function finishFill(db, op, now) {
  const order = await db.collection(COLLECTIONS.orders).findOne({ _id: op.orderId });
  await insertIgnoringDuplicate(db.collection(COLLECTIONS.positions), {
    _id: op.positionId,
    accountId: op.accountId,
    userId: op.userId,
    orderId: op.orderId,
    instrument: order.instrument,
    side: order.side,
    units: order.units,
    entry: op.entry,
    stopLoss: order.stopLoss,
    takeProfit: order.takeProfit,
    margin: op.margin,
    plannedRisk: op.risk,
    quoteId: op.quoteId,
    status: 'open',
    openedAt: op.executedAt,
    openedSimAt: op.simAt,
  });
  await db.collection(COLLECTIONS.orders).updateOne(
    { _id: op.orderId, status: 'executing' },
    { $set: { status: 'filled', fillPrice: op.entry, positionId: op.positionId, filledSimAt: op.simAt, finishedAt: now } }
  );
  await db.collection(COLLECTIONS.accounts).updateOne({ _id: op.accountId }, { $unset: { [`applied.${op._id}`]: '' } });
  await db.collection(COLLECTIONS.operations).updateOne({ _id: op._id }, { $set: { status: 'done', finishedAt: now } });
}

/**
 * Finishes every operation already applied to this account, whoever started it, and returns an
 * account with none outstanding. It repeats because another request can apply an operation while
 * these finish: rules checked against such a snapshot would miss that position. The caller's update
 * is conditional on this version, so nothing can be applied unseen after it. Repeating a finish
 * changes nothing, so two requests doing this is harmless.
 */
async function settleApplied(db, accountId, now) {
  for (let round = 0; round < CAS_ROUNDS * 4; round += 1) {
    const account = await loadAccount(db, accountId);
    const ids = Object.keys((account && account.applied) || {});
    if (!ids.length) return account;
    for (const id of ids) {
      const op = await db.collection(COLLECTIONS.operations).findOne({ _id: id });
      if (op && op.type === 'fill') await finishFill(db, op, now);
      else if (op && op.type === 'close') await finishClose(db, op, account.applied[id], now);
    }
  }
  throw new Error('Practice account is too busy to settle');
}

/**
 * Fills an order this caller has claimed (status `executing`) at `quote`, the recorded price used
 * for the fill. Rules are checked against the account version the update is conditional on.
 */
async function fillOrder(db, order, quote, { dataset, simAt, now }) {
  const opId = `fill:${order._id}`;
  const instrument = I.instrumentOf(order.instrument);
  const units = BigInt(order.units);
  const entry = I.entryPriceOf(order.side, quote);
  const stopLoss = priceFrom(order.stopLoss);
  const operations = db.collection(COLLECTIONS.operations);
  for (let round = 0; round < CAS_ROUNDS; round += 1) {
    const seen = await loadAccount(db, order.accountId);
    if (seen && seen.applied && seen.applied[opId]) break;
    const account = await settleApplied(db, order.accountId, now);
    if (!account || account.status !== 'active') return rejectOrder(db, order, 'account_not_active', now);
    const positions = await openPositions(db, account._id);
    const pending = await pendingOrders(db, account._id);
    const { quotes } = await quotesAt(db, dataset, positions.map((p) => p.instrument), simAt);
    const rules = checkOrderRules({ account, positions, pending, quotes: { ...quotes, [order.instrument]: quote }, instrument, side: order.side, units, entry, stopLoss, excludeOrderId: order._id });
    if (!rules.ok) return rejectOrder(db, order, rules.code, now);
    const op = {
      type: 'fill',
      accountId: account._id,
      userId: account.userId,
      orderId: order._id,
      positionId: order.positionId,
      entry: price(entry),
      margin: money(rules.margin),
      risk: money(rules.risk),
      quoteId: quote.id,
      simAt,
      executedAt: now,
      status: 'pending',
      createdAt: now,
    };
    await operations.updateOne({ _id: opId, status: 'pending' }, { $set: op }, { upsert: true }).catch((error) => {
      if (!isDuplicateKey(error)) throw error;
    });
    const won = await db.collection(COLLECTIONS.accounts).updateOne(
      { _id: account._id, version: account.version, status: 'active' },
      {
        $set: { usedMargin: money(moneyFrom(account.usedMargin) + rules.margin), [`applied.${opId}`]: true, updatedAt: now },
        $inc: { version: 1 },
      }
    );
    if (won.matchedCount) break;
    if (round === CAS_ROUNDS - 1) return rejectOrder(db, order, 'interrupted', now);
  }
  const op = await operations.findOne({ _id: opId });
  await finishFill(db, op, now);
  return db.collection(COLLECTIONS.orders).findOne({ _id: order._id });
}

async function placeOrder(db, { userId, body, now = new Date(), env = process.env }) {
  const input = readOrderInput(body);
  if (!input.ok) return input;
  const account = await activeAccount(db, userId);
  if (!account || account.status !== 'active') return refuse(404, 'account_not_found', 'Create a practice account first.');

  const orders = db.collection(COLLECTIONS.orders);
  const _id = orderIdFor(account._id, input.clientOrderId);
  const fingerprint = fingerprintOf(input);
  const previous = await orders.findOne({ _id });
  if (previous) {
    if (previous.fingerprint !== fingerprint) return refuse(409, 'idempotency_conflict', 'This order key was already used for a different order.');
    return { ok: true, order: previous, repeated: true };
  }

  const order = {
    _id,
    accountId: account._id,
    userId,
    clientOrderId: input.clientOrderId,
    fingerprint,
    type: input.type,
    instrument: input.instrument.id,
    side: input.side,
    units: Number(input.units),
    price: input.limitPrice === null ? null : price(input.limitPrice),
    stopLoss: price(input.stopLoss),
    takeProfit: input.takeProfit === null ? null : price(input.takeProfit),
    positionId: new ObjectId(),
    plannedRisk: d128('0.00'),
    status: 'received',
    createdAt: now,
  };
  try {
    await orders.insertOne(order);
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
    return { ok: true, order: await orders.findOne({ _id }), repeated: true };
  }

  const market = await marketState(db, { now, env });
  if (!market.open) return { ok: true, order: await rejectOrder(db, order, market.reason, now) };
  const { quotes, missing } = await quotesAt(db, market.dataset, [input.instrument.id], market.simTime);
  const quote = quotes[input.instrument.id];
  if (!quote) return { ok: true, order: await rejectOrder(db, order, missing[input.instrument.id], now) };

  const entry = input.type === 'market' ? I.entryPriceOf(input.side, quote) : input.limitPrice;
  const stops = checkStops({ side: input.side, entry, stopLoss: input.stopLoss, takeProfit: input.takeProfit });
  if (!stops.ok) return { ok: true, order: await rejectOrder(db, order, stops.code, now) };

  if (input.type === 'market') {
    await orders.updateOne({ _id, status: 'received' }, { $set: { status: 'executing' } });
    return { ok: true, order: await fillOrder(db, { ...order, status: 'executing' }, quote, { dataset: market.dataset, simAt: market.simTime, now }) };
  }

  const pendingCheck = checkPendingPrice({ type: input.type, side: input.side, limitPrice: input.limitPrice, quote });
  if (!pendingCheck.ok) return { ok: true, order: await rejectOrder(db, order, pendingCheck.code, now) };
  return { ok: true, order: await parkPendingOrder(db, order, input, { market, quote, now }) };
}

/** A pending order counts toward planned risk, so it passes the same rules, on the same version. */
async function parkPendingOrder(db, order, input, { market, quote, now }) {
  const orders = db.collection(COLLECTIONS.orders);
  for (let round = 0; round < CAS_ROUNDS; round += 1) {
    const account = await settleApplied(db, order.accountId, now);
    if (!account || account.status !== 'active') return rejectOrder(db, order, 'account_not_active', now);
    const positions = await openPositions(db, account._id);
    const pending = await pendingOrders(db, account._id);
    if (positions.length + pending.length >= MAX_OPEN_ITEMS) return rejectOrder(db, order, 'too_many_open_items', now);
    const { quotes } = await quotesAt(db, market.dataset, positions.map((p) => p.instrument), market.simTime);
    const rules = checkOrderRules({ account, positions, pending, quotes: { ...quotes, [input.instrument.id]: quote }, instrument: input.instrument, side: input.side, units: input.units, entry: input.limitPrice, stopLoss: input.stopLoss, excludeOrderId: order._id });
    if (!rules.ok) return rejectOrder(db, order, rules.code, now);
    await orders.updateOne({ _id: order._id, status: 'received' }, { $set: { plannedRisk: money(rules.risk) } });
    const won = await db.collection(COLLECTIONS.accounts).updateOne({ _id: account._id, version: account.version, status: 'active' }, { $inc: { version: 1 }, $set: { updatedAt: now } });
    if (won.matchedCount) {
      await orders.updateOne(
        { _id: order._id, status: 'received' },
        { $set: { status: 'pending', createdSimAt: market.simTime, expiresSimAt: new Date(market.simTime.getTime() + input.expiryHours * 3600000) } }
      );
      return orders.findOne({ _id: order._id });
    }
  }
  return rejectOrder(db, order, 'interrupted', now);
}

/**
 * What an order would need, without placing it: margin, planned risk and whether the rules allow it.
 * Read-only. The figures come from the same functions that execute an order.
 */
async function previewOrder(db, { userId, body, now = new Date(), env = process.env }) {
  const input = readOrderInput({ ...body, clientOrderId: 'preview-order-key' });
  if (!input.ok) return input;
  const account = await activeAccount(db, userId);
  if (!account || account.status !== 'active') return refuse(404, 'account_not_found', 'Create a practice account first.');
  const market = await marketState(db, { now, env });
  if (!market.open) return refuse(409, market.reason, reasonText(market.reason));
  const positions = await openPositions(db, account._id);
  const pending = await pendingOrders(db, account._id);
  const { quotes, missing } = await quotesAt(db, market.dataset, [...positions.map((p) => p.instrument), input.instrument.id], market.simTime);
  const quote = quotes[input.instrument.id];
  if (!quote) return refuse(409, missing[input.instrument.id], reasonText(missing[input.instrument.id]));
  const entry = input.type === 'market' ? I.entryPriceOf(input.side, quote) : input.limitPrice;
  const stops = checkStops({ side: input.side, entry, stopLoss: input.stopLoss, takeProfit: input.takeProfit });
  if (!stops.ok) return stops;
  const rules = checkOrderRules({ account, positions, pending, quotes, instrument: input.instrument, side: input.side, units: input.units, entry, stopLoss: input.stopLoss });
  const figures = I.accountFigures({ balance: moneyFrom(account.balance), positions, quotes });
  const risk = I.plannedRisk({ instrument: input.instrument, side: input.side, units: input.units, entry, stopLoss: input.stopLoss });
  return {
    ok: true,
    preview: {
      entry: formatPrice(entry),
      margin: formatMoney(I.requiredMargin(input.instrument, input.units, entry)),
      plannedRisk: formatMoney(risk),
      riskPercent: figures.equity > 0n ? formatDecimal(percentOf(risk, figures.equity), PERCENT_SCALE) : null,
      allowed: rules.ok,
      reason: rules.ok ? null : reasonText(rules.code),
    },
  };
}

async function cancelOrder(db, { userId, orderId, now = new Date() }) {
  if (!ObjectId.isValid(orderId) || String(orderId).length !== 24) return refuse(404, 'order_not_found', 'Order not found');
  const orders = db.collection(COLLECTIONS.orders);
  const _id = new ObjectId(orderId);
  const row = await orders.findOne({ _id, userId });
  if (!row) return refuse(404, 'order_not_found', 'Order not found');
  const changed = await orders.updateOne({ _id, userId, status: 'pending' }, { $set: { status: 'cancelled', finishedAt: now } });
  if (!changed.matchedCount) return refuse(409, 'order_not_pending', 'Only a pending order can be cancelled.');
  return { ok: true, order: await orders.findOne({ _id }) };
}

// ---------------------------------------------------------------------------
// Closing
// ---------------------------------------------------------------------------

/** Finishes an applied close. Safe to repeat. */
async function finishClose(db, op, detail, now) {
  await insertIgnoringDuplicate(db.collection(COLLECTIONS.ledger), {
    _id: `${op.accountId}:${detail.seq}`,
    accountId: op.accountId,
    seq: detail.seq,
    type: 'realized_pnl',
    amount: op.realizedPl,
    balanceAfter: d128(detail.balanceAfter),
    positionId: op.positionId,
    reference: op.reason,
    createdAt: op.executedAt,
  });
  await db.collection(COLLECTIONS.positions).updateOne(
    { _id: op.positionId, status: 'open' },
    { $set: { status: 'closed', exit: op.exit, realizedPl: op.realizedPl, closeReason: op.reason, closeQuoteId: op.quoteId, closedAt: op.executedAt, closedSimAt: op.simAt } }
  );
  await db.collection(COLLECTIONS.accounts).updateOne({ _id: op.accountId }, { $unset: { [`applied.${op._id}`]: '' } });
  await db.collection(COLLECTIONS.operations).updateOne({ _id: op._id }, { $set: { status: 'done', finishedAt: now } });
}

/** Applies a close operation to the account once, then finishes it. Rolls forward from any point. */
async function applyClose(db, op, now) {
  const accounts = db.collection(COLLECTIONS.accounts);
  for (let round = 0; round < CAS_ROUNDS * 4; round += 1) {
    const account = await loadAccount(db, op.accountId);
    const detail = account.applied && account.applied[op._id];
    if (detail) return finishClose(db, op, detail, now);
    // Read after the account, so a finish racing this cannot be mistaken for "not applied yet".
    const position = await db.collection(COLLECTIONS.positions).findOne({ _id: op.positionId });
    if (position && position.status === 'closed') {
      await db.collection(COLLECTIONS.operations).updateOne({ _id: op._id }, { $set: { status: 'done', finishedAt: now } });
      return undefined;
    }
    const pnl = moneyFrom(op.realizedPl);
    const balance = moneyFrom(account.balance) + pnl;
    const peak = moneyFrom(account.peakBalance) > balance ? moneyFrom(account.peakBalance) : balance;
    const drawdown = peak - balance;
    const worst = drawdown > moneyFrom(account.maxDrawdown) ? drawdown : moneyFrom(account.maxDrawdown);
    const seq = account.ledgerSeq + 1;
    const won = await accounts.updateOne(
      { _id: account._id, version: account.version },
      {
        $set: {
          balance: money(balance),
          usedMargin: money(moneyFrom(account.usedMargin) - moneyFrom(op.margin)),
          peakBalance: money(peak),
          maxDrawdown: money(worst),
          [`applied.${op._id}`]: { seq, balanceAfter: formatMoney(balance) },
          updatedAt: now,
        },
        $inc: { version: 1, ledgerSeq: 1, closedTrades: 1 },
      }
    );
    if (won.matchedCount) return finishClose(db, op, { seq, balanceAfter: formatMoney(balance) }, now);
  }
  throw new Error('Account stayed busy; the close will be finished by recovery');
}

/** Closes a position at `quote`. The operation's unique id makes one close win; repeats get it. */
async function closeAt(db, position, quote, { reason, simAt, now }) {
  const opId = `close:${position._id}`;
  const exit = I.exitPriceOf(position.side, quote);
  const pnl = I.profitLoss({ instrument: I.INSTRUMENTS[position.instrument], side: position.side, units: position.units, entry: position.entry, exit });
  const operations = db.collection(COLLECTIONS.operations);
  try {
    await operations.insertOne({
      _id: opId,
      type: 'close',
      accountId: position.accountId,
      userId: position.userId,
      positionId: position._id,
      exit: price(exit),
      realizedPl: money(pnl),
      margin: money(position.margin),
      reason,
      quoteId: quote.id,
      simAt,
      executedAt: now,
      status: 'pending',
      createdAt: now,
    });
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
  }
  const op = await operations.findOne({ _id: opId });
  if (op.status !== 'done') await applyClose(db, op, now);
  return db.collection(COLLECTIONS.positions).findOne({ _id: position._id });
}

async function loadOwnPosition(db, userId, positionId) {
  if (!ObjectId.isValid(positionId) || String(positionId).length !== 24) return null;
  return db.collection(COLLECTIONS.positions).findOne({ _id: new ObjectId(positionId), userId });
}

async function closePosition(db, { userId, positionId, now = new Date(), env = process.env }) {
  const row = await loadOwnPosition(db, userId, positionId);
  if (!row) return refuse(404, 'position_not_found', 'Position not found');
  if (row.status !== 'open') return { ok: true, position: row, alreadyClosed: true };
  const market = await marketState(db, { now, env });
  if (!market.open) return refuse(409, market.reason, reasonText(market.reason));
  const { quotes, missing } = await quotesAt(db, market.dataset, [row.instrument], market.simTime);
  if (!quotes[row.instrument]) return refuse(409, missing[row.instrument], reasonText(missing[row.instrument]));
  return { ok: true, position: await closeAt(db, positionValues(row), quotes[row.instrument], { reason: 'manual', simAt: market.simTime, now }) };
}

/** Moves a stop-loss or take-profit. A stop-loss stays mandatory, and the risk limits still apply. */
async function modifyPosition(db, { userId, positionId, body, now = new Date(), env = process.env }) {
  const row = await loadOwnPosition(db, userId, positionId);
  if (!row) return refuse(404, 'position_not_found', 'Position not found');
  if (row.status !== 'open') return refuse(409, 'position_closed', 'This position is closed.');
  const instrument = I.INSTRUMENTS[row.instrument];
  const input = body && typeof body === 'object' ? body : {};
  const read = (value) => {
    const parsed = typeof value === 'string' ? parsePrice(value) : null;
    return parsed !== null && parsed > 0n && I.priceFitsInstrument(parsed, instrument) ? parsed : null;
  };
  const stopLoss = read(input.stopLoss);
  if (stopLoss === null) return refuse(400, 'invalid_stop_loss', 'A valid stop-loss is required.');
  const clearing = input.takeProfit === null || input.takeProfit === '' || input.takeProfit === undefined;
  const takeProfit = clearing ? null : read(input.takeProfit);
  if (!clearing && takeProfit === null) return refuse(400, 'invalid_take_profit', 'The take-profit is not a valid price.');
  const market = await marketState(db, { now, env });
  if (!market.open) return refuse(409, market.reason, reasonText(market.reason));
  const { quotes, missing } = await quotesAt(db, market.dataset, [row.instrument], market.simTime);
  const quote = quotes[row.instrument];
  if (!quote) return refuse(409, missing[row.instrument], reasonText(missing[row.instrument]));
  const stops = checkStops({ side: row.side, entry: I.exitPriceOf(row.side, quote), stopLoss, takeProfit });
  if (!stops.ok) return stops;
  const position = positionValues(row);
  const risk = I.plannedRisk({ instrument, side: row.side, units: position.units, entry: position.entry, stopLoss });
  for (let round = 0; round < CAS_ROUNDS; round += 1) {
    const account = await settleApplied(db, row.accountId, now);
    if (!account || account.status !== 'active') return refuse(409, 'account_not_active', reasonText('account_not_active'));
    const others = (await openPositions(db, account._id)).filter((p) => String(p._id) !== String(row._id));
    const pending = await pendingOrders(db, account._id);
    const { quotes: all } = await quotesAt(db, market.dataset, [...others.map((p) => p.instrument), row.instrument], market.simTime);
    const figures = I.accountFigures({ balance: moneyFrom(account.balance), positions: [...others, position], quotes: all });
    if (figures.equity === null) return refuse(409, 'market_data_unavailable', reasonText('market_data_unavailable'));
    if (risk > I.percentOfMoney(figures.equity, I.MAX_RISK_PER_TRADE_PERCENT)) return refuse(409, 'risk_per_trade_exceeded', reasonText('risk_per_trade_exceeded'));
    let total = risk;
    for (const other of others) total += other.plannedRisk;
    for (const order of pending) total += moneyFrom(order.plannedRisk);
    if (total > I.percentOfMoney(figures.equity, I.MAX_TOTAL_RISK_PERCENT)) return refuse(409, 'total_risk_exceeded', reasonText('total_risk_exceeded'));
    const won = await db.collection(COLLECTIONS.accounts).updateOne({ _id: account._id, version: account.version, status: 'active' }, { $inc: { version: 1 }, $set: { updatedAt: now } });
    if (won.matchedCount) {
      const positions = db.collection(COLLECTIONS.positions);
      await positions.updateOne({ _id: row._id, status: 'open' }, { $set: { stopLoss: price(stopLoss), takeProfit: takeProfit === null ? null : price(takeProfit), plannedRisk: money(risk), updatedAt: now } });
      return { ok: true, position: await positions.findOne({ _id: row._id }) };
    }
  }
  return refuse(409, 'account_busy', 'Your account is busy. Try again.');
}

// ---------------------------------------------------------------------------
// Evaluation: pending orders, stop-loss, take-profit, margin
// ---------------------------------------------------------------------------

/** A buy watches the ask to enter and the bid to exit; a sell the reverse. */
function pendingTriggered(order, quote) {
  const level = priceFrom(order.price);
  const market = I.entryPriceOf(order.side, quote);
  if (order.type === 'limit') return order.side === 'buy' ? market <= level : market >= level;
  return order.side === 'buy' ? market >= level : market <= level;
}

function exitTrigger(position, quote) {
  const market = I.exitPriceOf(position.side, quote);
  const hit = (level, below) => level !== null && (below ? market <= level : market >= level);
  const long = position.side === 'buy';
  if (hit(position.stopLoss, long)) return 'stop_loss';
  if (hit(position.takeProfit, !long)) return 'take_profit';
  return null;
}

/** Stops out at or below 50%, largest loser first, until the level recovers. */
async function applyMarginRules(db, account, quotes, { simAt, now }) {
  for (;;) {
    const fresh = await loadAccount(db, account._id);
    const positions = await openPositions(db, account._id);
    const figures = I.accountFigures({ balance: moneyFrom(fresh.balance), positions, quotes });
    if (figures.marginLevel === null) {
      if (figures.equity !== null && fresh.marginCall) await db.collection(COLLECTIONS.accounts).updateOne({ _id: account._id }, { $set: { marginCall: false } });
      return;
    }
    if (figures.marginLevel > I.STOP_OUT_LEVEL) {
      const called = figures.marginLevel <= I.MARGIN_CALL_LEVEL;
      if (called !== fresh.marginCall) await db.collection(COLLECTIONS.accounts).updateOne({ _id: account._id }, { $set: { marginCall: called } });
      return;
    }
    const pnl = (p) => I.profitLoss({ instrument: I.INSTRUMENTS[p.instrument], side: p.side, units: p.units, entry: p.entry, exit: I.exitPriceOf(p.side, quotes[p.instrument]) });
    const worst = positions.reduce((a, b) => (pnl(b) < pnl(a) ? b : a));
    await closeAt(db, worst, quotes[worst.instrument], { reason: 'stop_out', simAt, now });
  }
}

/**
 * Walks every recorded quote since this account was last evaluated, in time order, so nothing that
 * happened between two requests is missed and a run can be reproduced. Safe to run concurrently:
 * each fill and close is guarded by its operation id.
 */
async function evaluateAccount(db, accountId, { now = new Date(), env = process.env } = {}) {
  const market = await marketState(db, { now, env });
  if (!market.dataset || !market.simTime) return { evaluated: 0 };
  const { dataset, simTime } = market;
  const account = await loadAccount(db, accountId);
  if (!account || account.status !== 'active') return { evaluated: 0 };
  let positions = await openPositions(db, accountId);
  let pending = await pendingOrders(db, accountId);
  if (!positions.length && !pending.length) {
    await db.collection(COLLECTIONS.accounts).updateOne({ _id: accountId }, { $set: { evaluatedThrough: simTime } });
    return { evaluated: 0 };
  }
  const starts = [...positions.map((p) => new Date(p.openedSimAt)), ...pending.map((o) => new Date(o.createdSimAt))];
  const earliest = new Date(Math.min(...starts.map((t) => t.getTime())));
  const after = account.evaluatedThrough && new Date(account.evaluatedThrough) > earliest ? new Date(account.evaluatedThrough) : earliest;
  const instruments = [...new Set([...positions.map((p) => p.instrument), ...pending.map((o) => o.instrument)])];
  let through = simTime;
  const stream = [];
  for (const instrument of instruments) {
    const batch = await quotesBetween(db, dataset, instrument, after, simTime, EVALUATION_QUOTE_LIMIT);
    stream.push(...batch.quotes);
    if (batch.full && batch.lastRowTime < through) through = batch.lastRowTime;
  }
  const ordered = stream.filter((q) => q.time <= through).sort((a, b) => a.time - b.time || a.instrument.localeCompare(b.instrument));
  const last = (await quotesAt(db, dataset, instruments, after)).quotes;
  let actions = 0;

  const orders = db.collection(COLLECTIONS.orders);
  for (const quote of ordered) {
    last[quote.instrument] = quote;
    const context = { dataset, simAt: quote.time, now };
    let changed = false;
    for (const order of pending) {
      if (order.instrument !== quote.instrument || quote.time <= new Date(order.createdSimAt)) continue;
      if (quote.time >= new Date(order.expiresSimAt)) {
        await orders.updateOne({ _id: order._id, status: 'pending' }, { $set: { status: 'expired', finishedAt: now } });
        changed = true;
      } else if (pendingTriggered(order, quote)) {
        const claimed = await orders.updateOne({ _id: order._id, status: 'pending' }, { $set: { status: 'executing' } });
        if (claimed.modifiedCount) await fillOrder(db, { ...order, status: 'executing' }, quote, context);
        changed = true;
      }
    }
    for (const position of positions) {
      if (position.instrument !== quote.instrument || quote.time <= new Date(position.openedSimAt)) continue;
      const reason = exitTrigger(position, quote);
      if (reason) {
        await closeAt(db, position, quote, { reason, simAt: quote.time, now });
        changed = true;
      }
    }
    if (changed) {
      actions += 1;
      positions = await openPositions(db, accountId);
      pending = await pendingOrders(db, accountId);
    }
    if (positions.length && positions.every((p) => last[p.instrument])) {
      await applyMarginRules(db, account, last, { simAt: quote.time, now });
      positions = await openPositions(db, accountId);
    }
  }

  // Orders whose expiry passed with no quote still expire, on time.
  for (const order of pending) {
    if (through >= new Date(order.expiresSimAt)) await orders.updateOne({ _id: order._id, status: 'pending' }, { $set: { status: 'expired', finishedAt: now } });
  }
  await db.collection(COLLECTIONS.accounts).updateOne({ _id: accountId }, { $set: { evaluatedThrough: through } });
  return { evaluated: ordered.length, actions };
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

/** Rolls a reset forward from wherever it stopped. The old account stays, archived. */
async function finishReset(db, op, now) {
  const accounts = db.collection(COLLECTIONS.accounts);
  await accounts.updateOne({ _id: op.accountId, status: 'active' }, { $set: { status: 'archived', archivedAt: now }, $inc: { version: 1 } });
  await db.collection(COLLECTIONS.orders).updateMany({ accountId: op.accountId, status: 'pending' }, { $set: { status: 'cancelled', cancelReason: 'account_reset', finishedAt: now } });
  await db.collection(COLLECTIONS.slots).updateOne(
    { _id: op.userId, activeAccountId: op.accountId },
    { $set: { activeAccountId: op.newAccountId, lastResetAt: op.createdAt }, $inc: { generation: 1 } }
  );
  await materializeAccount(db, { accountId: op.newAccountId, userId: op.userId, generation: op.generation, now });
  await db.collection(COLLECTIONS.operations).updateOne({ _id: op._id }, { $set: { status: 'done', finishedAt: now } });
}

async function resetAccount(db, { userId, now = new Date() }) {
  const slot = await db.collection(COLLECTIONS.slots).findOne({ _id: userId });
  if (!slot) return refuse(404, 'account_not_found', 'Create a practice account first.');
  if (slot.lastResetAt && now.getTime() - new Date(slot.lastResetAt).getTime() < RESET_INTERVAL_MS) {
    const nextResetAt = new Date(new Date(slot.lastResetAt).getTime() + RESET_INTERVAL_MS);
    return { ...refuse(409, 'reset_too_soon', 'An account can be reset once every 30 days.'), nextResetAt: nextResetAt.toISOString() };
  }
  const account = await settleApplied(db, slot.activeAccountId, now);
  if (!account || account.status !== 'active') return refuse(409, 'account_not_active', reasonText('account_not_active'));
  if ((await openPositions(db, account._id)).length) return refuse(409, 'positions_open', 'Close your open positions before resetting.');

  // The version is part of the id: an attempt that was abandoned never blocks a later one.
  const opId = `reset:${account._id}:${account.version}`;
  const operations = db.collection(COLLECTIONS.operations);
  await insertIgnoringDuplicate(operations, { _id: opId, type: 'reset', accountId: account._id, userId, newAccountId: new ObjectId(), generation: slot.generation + 1, expectedVersion: account.version, status: 'pending', createdAt: now });
  const op = await operations.findOne({ _id: opId });
  // A position opened since the check above bumps the version, so the archive does not happen.
  const archived = await db.collection(COLLECTIONS.accounts).updateOne(
    { _id: account._id, version: op.expectedVersion, status: 'active' },
    { $set: { status: 'archived', archivedAt: now }, $inc: { version: 1 } }
  );
  if (!archived.matchedCount) {
    const current = await loadAccount(db, account._id);
    if (current.status === 'active') {
      await operations.updateOne({ _id: opId, status: 'pending' }, { $set: { status: 'abandoned', finishedAt: now } });
      return refuse(409, 'account_busy', 'Your account changed. Try again.');
    }
  }
  await finishReset(db, op, now);
  return { ok: true, account: await loadAccount(db, op.newAccountId) };
}

// ---------------------------------------------------------------------------
// Recovery and reconciliation
// ---------------------------------------------------------------------------

/** Finishes or safely abandons work left by a crash. Never computes a financial result again. */
async function recoverOperations(db, { now = new Date(), accountId, limit = 100, staleMs = STALE_OPERATION_MS } = {}) {
  const cutoff = new Date(now.getTime() - staleMs);
  const operations = db.collection(COLLECTIONS.operations);
  const orders = db.collection(COLLECTIONS.orders);
  const scope = accountId ? { accountId } : {};
  const counts = { finished: 0, abandoned: 0 };
  for (const op of await operations.find({ ...scope, status: 'pending', createdAt: { $lte: cutoff } }).limit(limit).toArray()) {
    const account = await loadAccount(db, op.accountId);
    if (op.type === 'close') {
      await applyClose(db, op, now);
      counts.finished += 1;
    } else if (op.type === 'fill') {
      const written = await db.collection(COLLECTIONS.positions).findOne({ _id: op.positionId });
      if ((account && account.applied && account.applied[op._id]) || written) {
        await finishFill(db, op, now);
        counts.finished += 1;
      } else {
        // The account never changed: no funds moved, so the order simply did not happen.
        await operations.updateOne({ _id: op._id, status: 'pending' }, { $set: { status: 'abandoned', finishedAt: now } });
        await rejectOrder(db, { _id: op.orderId }, 'interrupted', now);
        counts.abandoned += 1;
      }
    } else if (op.type === 'reset') {
      if (account && account.status === 'active' && account.version !== op.expectedVersion) {
        await operations.updateOne({ _id: op._id, status: 'pending' }, { $set: { status: 'abandoned', finishedAt: now } });
        counts.abandoned += 1;
      } else {
        await finishReset(db, op, now);
        counts.finished += 1;
      }
    }
  }
  // Orders stopped before any operation existed: nothing happened, so they end as interrupted.
  for (const order of await orders.find({ ...scope, status: { $in: ['received', 'executing'] }, createdAt: { $lte: cutoff } }).limit(limit).toArray()) {
    const op = await operations.findOne({ _id: `fill:${order._id}` });
    if (!op) {
      await rejectOrder(db, order, 'interrupted', now);
      counts.abandoned += 1;
    }
  }
  return counts;
}

/** Compares derived account state with its ledger and positions. Reports; never rewrites. */
async function reconcileAccount(db, accountId) {
  const account = await loadAccount(db, accountId);
  if (!account) return { accountId: String(accountId), ok: false, problems: ['account_missing'] };
  const rows = await db.collection(COLLECTIONS.ledger).find({ accountId }).sort({ seq: 1 }).toArray();
  const open = await openPositions(db, accountId);
  const problems = [];
  let running = 0n;
  rows.forEach((row, index) => {
    if (row.seq !== index + 1) problems.push(`ledger_gap_at_${index + 1}`);
    running += moneyFrom(row.amount);
    if (running !== moneyFrom(row.balanceAfter)) problems.push(`ledger_balance_at_${row.seq}`);
  });
  const inFlight = Object.keys(account.applied || {}).length > 0;
  if (!inFlight) {
    if (running !== moneyFrom(account.balance)) problems.push('balance_differs_from_ledger');
    if (rows.length !== account.ledgerSeq) problems.push('ledger_sequence');
    const used = open.reduce((sum, p) => sum + p.margin, 0n);
    if (used !== moneyFrom(account.usedMargin)) problems.push('used_margin_differs_from_positions');
  }
  return { accountId: String(accountId), ok: problems.length === 0, inFlight, problems, ledgerRows: rows.length, ledgerBalance: formatMoney(running) };
}

/** Operator pass (scripts/trading-reconcile.js) and the server's background job. */
async function sweep(db, { apply = false, now = new Date(), env = process.env, limit = 200 } = {}) {
  const accounts = db.collection(COLLECTIONS.accounts);
  const report = { recovered: null, evaluated: 0, checked: 0, mismatches: [] };
  if (apply) {
    report.recovered = await recoverOperations(db, { now, limit });
    const ids = new Set();
    for (const row of await db.collection(COLLECTIONS.positions).find({ status: 'open' }, { projection: { accountId: 1 } }).limit(limit).toArray()) ids.add(String(row.accountId));
    for (const row of await db.collection(COLLECTIONS.orders).find({ status: 'pending' }, { projection: { accountId: 1 } }).limit(limit).toArray()) ids.add(String(row.accountId));
    for (const id of ids) {
      await evaluateAccount(db, new ObjectId(id), { now, env });
      report.evaluated += 1;
    }
  }
  for (const row of await accounts.find({}, { projection: { _id: 1 } }).limit(limit).toArray()) {
    const result = await reconcileAccount(db, row._id);
    report.checked += 1;
    if (!result.ok) report.mismatches.push(result);
  }
  return report;
}

module.exports = {
  COLLECTIONS,
  MAX_EXPIRY_HOURS,
  RESET_INTERVAL_MS,
  STALE_OPERATION_MS,
  activeAccount,
  cancelOrder,
  checkOrderRules,
  closePosition,
  ensureAccount,
  evaluateAccount,
  exitTrigger,
  modifyPosition,
  openPositions,
  orderIdFor,
  pendingOrders,
  pendingTriggered,
  percentOf,
  placeOrder,
  previewOrder,
  positionValues,
  readOrderInput,
  reasonText,
  reconcileAccount,
  recoverOperations,
  resetAccount,
  sweep,
};
