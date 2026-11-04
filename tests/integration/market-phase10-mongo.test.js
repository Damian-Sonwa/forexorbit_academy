/**
 * The synthetic market with the real engine on a real MongoDB server (npm run test:mongo:market):
 * persistence, restart, tampering, suspension, trading on generated quotes, risk release, retention.
 * Requires MONGODB_URI_TEST and MONGODB_DB_NAME_TEST (ending in "_test").
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const path = require('path');
const { ObjectId } = require('mongodb');

const { openTestDatabase, testDatabaseConfig } = require('../helpers/mongo-test-db');
const M = require('../../lib/market/model');
const S = require('../../lib/market/series');
const H = require('../../lib/market/health');
const D = require('../../lib/trading/market-data');
const E = require('../../lib/trading/engine');
const V = require('../../lib/trading/views');
const R = require('../../lib/trading/retention');
const { deleteAccount } = require('../../lib/account-approval');
const { run: initMarket } = require('../../scripts/market-init');
const { formatPrice } = require('../../lib/trading/money');

const config = testDatabaseConfig();
const skip = config.ok ? false : config.reason;
const START = new Date('2026-03-02T00:00:00Z'); // a Monday
const NOW = new Date('2026-03-04T12:00:00Z'); // the Wednesday after: open
const later = (seconds) => new Date(NOW.getTime() + seconds * 1000);
let keys = 0;
const key = () => `market-order-${(keys += 1)}-abcdef`;
const newUser = () => new ObjectId().toHexString();

async function fresh() {
  const conn = await openTestDatabase();
  await conn.reset();
  S.forgetProcessState();
  const market = { ...H.newMarket({ id: 'sim', startAt: START, seed: 'integration-seed' }), active: true };
  await conn.db.collection('marketDataSets').insertOne(market);
  await D.marketTick(conn.db, { now: NOW });
  return { conn, market: await conn.db.collection('marketDataSets').findOne({ _id: 'sim' }) };
}
async function closing(conn, fn) {
  try { await fn(); } finally { await conn.reset(); await conn.close(); }
}
/** Keeps the heartbeat current at a test time. */
const beat = (db, now) => db.collection('marketHealth').updateOne({ _id: 'sim' }, { $set: { heartbeatAt: now } });
const quoteNow = async (db, instrument, now) => (await D.quotesAt(db, (await D.marketState(db, { now })).dataset, [instrument], (await D.marketState(db, { now })).simTime)).quotes[instrument];
/** A stop this far from the entry, in pips, for a buy. */
const stopBelow = (quote, pips) => formatPrice(quote.ask - BigInt(pips) * 10n);
const buy = (stopLoss, extra = {}) => ({ clientOrderId: key(), type: 'market', instrument: 'EUR_USD', side: 'buy', units: '10000', stopLoss, ...extra });

test('real MongoDB: the market starts, reaches ACTIVE and stores a verified chain', { skip }, async () => {
  const { conn, market } = await fresh();
  await closing(conn, async () => {
    assert.equal((await H.readHealth(conn.db, market)).status, 'ACTIVE');
    const rows = await conn.db.collection('marketCheckpoints').countDocuments({ instrument: 'EUR_USD' });
    assert.equal(rows, 60, '60 whole hours since the start');
    for (const instrument of market.instruments) assert.equal((await S.verifyChain(conn.db, market, instrument, { depth: 100 })).ok, true);
    const state = await D.marketState(conn.db, { now: NOW });
    assert.equal(state.open, true);
    assert.equal(state.dataset.kind, 'synthetic');
  });
});

test('real MongoDB: a restart reproduces the same quotes and candles, and two students see the same', { skip }, async () => {
  const { conn } = await fresh();
  await closing(conn, async () => {
    const at = later(3700);
    await beat(conn.db, at);
    const first = await V.marketView(conn.db, { now: at });
    const candles = (await V.candleView(conn.db, { instrument: 'USD_JPY', timeframe: 'M5', now: at })).candles;
    S.forgetProcessState();
    const second = await V.marketView(conn.db, { now: at });
    assert.deepEqual(second.view.instruments, first.view.instruments);
    assert.deepEqual((await V.candleView(conn.db, { instrument: 'USD_JPY', timeframe: 'M5', now: at })).candles, candles);
    const dataset = await conn.db.collection('marketDataSets').findOne({ _id: 'sim' });
    const step = S.stepOf(dataset, at);
    const quote = first.view.instruments.find((i) => i.id === 'EUR_USD');
    const reference = M.quotePoints(S.stateFromStart(dataset, 'EUR_USD', step), { instrument: 'EUR_USD', hourOfDay: 13, open: true });
    assert.equal(quote.bid, (reference.bid / 100000).toFixed(5), 'the checkpointed answer equals the from-the-start answer');
  });
});

test('real MongoDB: separate processes write the same chain without conflict', { skip }, async () => {
  const { conn, market } = await fresh();
  await closing(conn, async () => {
    await conn.db.collection('marketCheckpoints').deleteMany({});
    const code = `const {openTestDatabase}=require('./tests/helpers/mongo-test-db');const D=require('./lib/trading/market-data');
      (async()=>{const c=await openTestDatabase();await D.marketTick(c.db,{now:new Date('${NOW.toISOString()}')});await c.close();})().catch((e)=>{console.error(e);process.exit(1)});`;
    const child = () => new Promise((resolve) => {
      const p = spawn(process.execPath, ['-e', code], { cwd: path.join(__dirname, '..', '..'), env: process.env, stdio: 'inherit' });
      p.on('exit', resolve);
    });
    assert.deepEqual(await Promise.all([child(), child(), child()]), [0, 0, 0]);
    assert.equal(await conn.db.collection('marketCheckpoints').countDocuments({ instrument: 'EUR_USD' }), 60);
    for (const instrument of market.instruments) assert.equal((await S.verifyChain(conn.db, market, instrument, { depth: 100 })).ok, true, instrument);
  });
});

test('real MongoDB: candles obey OHLC rules, have unique ordered times, and match the quotes', { skip }, async () => {
  const { conn, market } = await fresh();
  await closing(conn, async () => {
    for (const timeframe of Object.keys(S.TIMEFRAMES)) {
      const { candles } = await V.candleView(conn.db, { instrument: 'GBP_USD', timeframe, count: 50, now: NOW });
      assert.ok(candles.length > 0, timeframe);
      const times = candles.map((c) => c.time);
      assert.deepEqual(times, [...new Set(times)].sort(), timeframe);
      for (const c of candles) {
        const [o, h, l, cl] = [c.open, c.high, c.low, c.close].map(Number);
        assert.ok(h >= o && h >= cl && l <= o && l <= cl && h >= l, `${timeframe} ${c.time}`);
        assert.equal(new Date(c.time).getTime() % S.TIMEFRAMES[timeframe], 0, 'on the timeframe boundary');
      }
      assert.ok(new Date(times[times.length - 1]) <= NOW, 'nothing from the future');
      assert.equal(candles[candles.length - 1].complete, false);
    }
    // An hour built from checkpoints equals the same hour built tick by tick.
    const h1 = (await V.candleView(conn.db, { instrument: 'GBP_USD', timeframe: 'H1', count: 3, now: NOW })).candles[0];
    const from = S.stepOf(market, new Date(h1.time));
    const bids = [];
    S.walk(market, 'GBP_USD', S.stateFromStart(market, 'GBP_USD', from), from, from + M.CHECKPOINT_STEPS - 1, (step, state, ctx) => bids.push(M.quotePoints(state, ctx).bid));
    const first = M.quotePoints(S.stateFromStart(market, 'GBP_USD', from), { instrument: 'GBP_USD', hourOfDay: new Date(h1.time).getUTCHours(), open: true }).bid;
    const all = [first, ...bids];
    assert.equal(Number(h1.high), Math.max(...all) / 100000);
    assert.equal(Number(h1.low), Math.min(...all) / 100000);
    assert.equal(Number(h1.close), all[all.length - 1] / 100000);
  });
});

test('real MongoDB: candles for a closed weekend are absent and explained by the calendar, not a gap in data', { skip }, async () => {
  const { conn } = await fresh();
  await closing(conn, async () => {
    const monday = new Date('2026-03-09T12:00:00Z');
    await D.marketTick(conn.db, { now: monday });
    const { candles } = await V.candleView(conn.db, { instrument: 'EUR_USD', timeframe: 'H1', count: 120, now: monday });
    const weekend = candles.filter((c) => new Date(c.time) >= new Date('2026-03-06T22:00:00Z') && new Date(c.time) < new Date('2026-03-08T21:00:00Z'));
    assert.deepEqual(weekend, []);
  });
});

test('real MongoDB: a changed checkpoint is detected, trading stops, and nothing is rewritten', { skip }, async () => {
  const { conn, market } = await fresh();
  await closing(conn, async () => {
    const rows = conn.db.collection('marketCheckpoints');
    const target = await rows.find({ instrument: 'EUR_USD' }).sort({ step: -1 }).skip(3).limit(1).next();
    await rows.updateOne({ _id: target._id }, { $set: { 'state.mid': target.state.mid + 5000 } });
    const result = await D.marketTick(conn.db, { now: later(60) });
    assert.equal(result.status, 'ERROR');
    assert.equal((await D.marketState(conn.db, { now: later(60) })).reason, 'market_error');
    assert.equal((await rows.findOne({ _id: target._id })).state.mid, target.state.mid + 5000, 'left for an investigation');
    assert.equal(await conn.db.collection('marketIncidents').countDocuments({ kind: 'history_mismatch' }), 1);
    const u = newUser();
    await E.ensureAccount(conn.db, { userId: u, now: NOW });
    const placed = await E.placeOrder(conn.db, { userId: u, body: buy('1.00000'), now: later(60) });
    assert.equal(placed.order.status, 'rejected');
    const refused = await H.resumeMarket(conn.db, market, { now: later(120), simTime: later(120) });
    assert.equal(refused.ok, false, 'resume re-checks history and refuses');
    await rows.updateOne({ _id: target._id }, { $set: { 'state.mid': target.state.mid } });
    assert.equal((await H.resumeMarket(conn.db, market, { now: later(180), simTime: later(180) })).ok, true);
    assert.equal((await D.marketState(conn.db, { now: later(180) })).open, true);
  });
});

test('real MongoDB: a market whose pass has stopped suspends itself, and a pass restores it', { skip }, async () => {
  const { conn } = await fresh();
  await closing(conn, async () => {
    const stale = new Date(NOW.getTime() + H.HEARTBEAT_LIMIT_MS + 1000);
    assert.equal((await D.marketState(conn.db, { now: stale })).reason, 'market_stale');
    assert.equal((await V.marketView(conn.db, { now: stale })).view.instruments.every((i) => i.bid === null), true);
    await D.marketTick(conn.db, { now: stale });
    assert.equal((await D.marketState(conn.db, { now: stale })).open, true);
  });
});

test('real MongoDB: during a suspension positions stay open, unvalued and untriggered; on resume a stop fills at the first valid quote', { skip }, async () => {
  const { conn, market } = await fresh();
  await closing(conn, async () => {
    const u = newUser();
    await E.ensureAccount(conn.db, { userId: u, now: NOW });
    const quote = await quoteNow(conn.db, 'EUR_USD', NOW);
    const placed = await E.placeOrder(conn.db, { userId: u, body: buy(stopBelow(quote, 1)), now: NOW });
    assert.equal(placed.order.status, 'filled');
    const account = await E.activeAccount(conn.db, u);

    await H.suspendMarket(conn.db, market, { reason: 'test', now: later(10) });
    const during = later(1800);
    const view = await V.accountView(conn.db, { userId: u, now: during });
    assert.equal(view.market.reason, 'market_suspended');
    assert.deepEqual([view.account.equity, view.account.marginLevel, view.account.unrealizedPl], [null, null, null]);
    assert.equal(view.positions.length, 1);
    await E.evaluateAccount(conn.db, account._id, { now: during });
    assert.equal(await conn.db.collection('tradingPositions').countDocuments({ userId: u, status: 'open' }), 1, 'no stop runs');
    assert.equal((await E.closePosition(conn.db, { userId: u, positionId: placed.order.positionId.toString(), now: during })).status, 409, 'no close at an unverified price');

    const resumeAt = later(3600);
    assert.equal((await H.resumeMarket(conn.db, market, { now: resumeAt, simTime: resumeAt })).ok, true);
    await E.evaluateAccount(conn.db, account._id, { now: later(4200) });
    const row = await conn.db.collection('tradingPositions').findOne({ userId: u });
    if (row.status === 'closed') assert.ok(new Date(row.closedSimAt || row.closedAt) >= resumeAt, 'nothing fills inside the suspended period');
    assert.equal((await E.reconcileAccount(conn.db, account._id)).ok, true);
  });
});

test('real MongoDB: a whole trade on generated quotes: buys at the ask, closes at the bid, spread is the cost', { skip }, async () => {
  const { conn } = await fresh();
  await closing(conn, async () => {
    const u = newUser();
    await E.ensureAccount(conn.db, { userId: u, now: NOW });
    const quote = await quoteNow(conn.db, 'EUR_USD', NOW);
    const placed = await E.placeOrder(conn.db, { userId: u, body: buy(stopBelow(quote, 50)), now: NOW });
    assert.equal(String(placed.order.fillPrice), formatPrice(quote.ask));
    await E.closePosition(conn.db, { userId: u, positionId: placed.order.positionId.toString(), now: NOW });
    const stored = await E.activeAccount(conn.db, u);
    const spread = Number(quote.ask - quote.bid) / 100000 * 10000;
    assert.equal(Number(stored.balance.toString()), 10000 - spread);
    assert.equal((await E.reconcileAccount(conn.db, stored._id)).ok, true);
    assert.equal(String((await V.history(conn.db, { userId: u, kind: 'executions' })).rows.length), '2');
  });
});

test('real MongoDB: the evaluator walks generated quotes and fires a stop at the recorded side and step', { skip }, async () => {
  const { conn, market } = await fresh();
  await closing(conn, async () => {
    const u = newUser();
    await E.ensureAccount(conn.db, { userId: u, now: NOW });
    const quote = await quoteNow(conn.db, 'EUR_USD', NOW);
    await E.placeOrder(conn.db, { userId: u, body: buy(stopBelow(quote, 2), { units: '1000' }), now: NOW });
    const account = await E.activeAccount(conn.db, u);
    let closed = null;
    for (let minutes = 2; minutes <= 180 && !closed; minutes += 2) {
      const at = later(minutes * 60);
      await beat(conn.db, at);
      await E.evaluateAccount(conn.db, account._id, { now: at });
      closed = await conn.db.collection('tradingPositions').findOne({ userId: u, status: 'closed' });
    }
    assert.ok(closed, 'a 2-pip stop is reached within 3 hours');
    assert.equal(closed.closeReason, 'stop_loss');
    const step = Number(closed.closeQuoteId.split(':').pop());
    const state = S.stateFromStart(market, 'EUR_USD', step);
    const hour = S.timeOf(market, step).getUTCHours();
    const bid = M.quotePoints(state, { instrument: 'EUR_USD', hourOfDay: hour, open: true }).bid;
    assert.equal(String(closed.exit), (bid / 100000).toFixed(5), 'the fill reproduces from the model');
    assert.ok(Number(String(closed.exit)) <= Number(String(closed.stopLoss)));
  });
});

test('real MongoDB: risk is released by cancel, expiry and close, and held by pending orders, under concurrency', { skip }, async () => {
  const { conn } = await fresh();
  await closing(conn, async () => {
    const u = newUser();
    await E.ensureAccount(conn.db, { userId: u, now: NOW });
    const quote = await quoteNow(conn.db, 'EUR_USD', NOW);
    const limit = formatPrice(quote.ask - 1000n);
    const pendingBody = () => ({ clientOrderId: key(), type: 'limit', instrument: 'EUR_USD', side: 'buy', units: '5000', price: limit, stopLoss: formatPrice(quote.ask - 1000n - 3000n), expiryHours: 1 });
    const results = await Promise.all(Array.from({ length: 30 }, () => E.placeOrder(conn.db, { userId: u, body: pendingBody(), now: NOW })));
    const held = results.filter((r) => r.order.status === 'pending');
    assert.equal(held.length, 3, 'three 150.00 orders fit under 5%; 30 were sent at once');
    assert.equal((await E.placeOrder(conn.db, { userId: u, body: pendingBody(), now: NOW })).order.rejectReason, 'total_risk_exceeded');
    assert.equal((await E.cancelOrder(conn.db, { userId: u, orderId: String(held[0].order._id), now: NOW })).ok, true);
    assert.equal((await E.placeOrder(conn.db, { userId: u, body: pendingBody(), now: NOW })).order.status, 'pending', 'cancelling released its risk');
    assert.equal((await E.placeOrder(conn.db, { userId: u, body: pendingBody(), now: NOW })).order.rejectReason, 'total_risk_exceeded');
  });
});

test('real MongoDB: the preview uses the same rules and changes nothing', { skip }, async () => {
  const { conn } = await fresh();
  await closing(conn, async () => {
    const u = newUser();
    await E.ensureAccount(conn.db, { userId: u, now: NOW });
    const quote = await quoteNow(conn.db, 'EUR_USD', NOW);
    const ok = await E.previewOrder(conn.db, { userId: u, body: buy(stopBelow(quote, 100), { clientOrderId: undefined }), now: NOW });
    assert.deepEqual([ok.preview.plannedRisk, ok.preview.riskPercent, ok.preview.allowed], ['100.00', '1.00', true]);
    const big = await E.previewOrder(conn.db, { userId: u, body: buy(stopBelow(quote, 300), { clientOrderId: undefined }), now: NOW });
    assert.equal(big.preview.allowed, false);
    assert.match(big.preview.reason, /2%/);
    assert.equal(await conn.db.collection('tradingOrders').countDocuments({}), 0);
  });
});

test('real MongoDB: a student cannot read the future: nothing past the simulated now is returned', { skip }, async () => {
  const { conn } = await fresh();
  await closing(conn, async () => {
    const { candles } = await V.candleView(conn.db, { instrument: 'EUR_USD', timeframe: 'M1', count: 300, now: NOW });
    assert.ok(new Date(candles[candles.length - 1].time) <= NOW);
    const view = await V.marketView(conn.db, { now: NOW });
    assert.ok(view.view.instruments.every((i) => new Date(i.time) <= NOW));
    assert.doesNotMatch(JSON.stringify(view.view), /integration-seed|seedId/);
  });
});

test('real MongoDB: market-init is read-only by default, refuses a second market and never prints the seed', { skip }, async () => {
  const conn = await openTestDatabase();
  await conn.reset();
  await closing(conn, async () => {
    const logs = [];
    const log = (line) => logs.push(line);
    const args = { id: 'simulated-market-1', start: '2026-03-02T00:00:00Z', now: NOW, log };
    assert.equal((await initMarket(conn.db, { ...args, apply: false })).created, false);
    assert.equal(await conn.db.collection('marketDataSets').countDocuments({}), 0);
    assert.deepEqual(await initMarket(conn.db, { ...args, apply: true }), { ok: true, created: true, status: 'ACTIVE' });
    const market = await conn.db.collection('marketDataSets').findOne({});
    assert.ok(!logs.join(' ').includes(market.seed));
    const seed = market.seed;
    assert.equal((await initMarket(conn.db, { ...args, apply: true })).created, false);
    assert.equal((await conn.db.collection('marketDataSets').findOne({})).seed, seed, 'a repeat never replaces the seed');
    assert.equal((await initMarket(conn.db, { ...args, id: 'other', apply: true })).ok, false);
    assert.equal((await initMarket(conn.db, { ...args, start: '2026-03-02T00:30:00Z', apply: true })).ok, false);
  });
});

test('real MongoDB: deleting a student removes personal and linkable data and keeps the books reconcilable', { skip }, async () => {
  const { conn } = await fresh();
  await closing(conn, async () => {
    const db = conn.db;
    const { insertedId } = await db.collection('users').insertOne({ name: 'Delete me', email: 'delete@me.invalid', role: 'student', status: 'approved' });
    const u = String(insertedId);
    const other = newUser();
    await E.ensureAccount(db, { userId: u, now: NOW });
    await E.ensureAccount(db, { userId: other, now: NOW });
    const quote = await quoteNow(db, 'EUR_USD', NOW);
    const first = await E.placeOrder(db, { userId: u, body: buy(stopBelow(quote, 50), { units: '1000' }), now: NOW });
    await E.closePosition(db, { userId: u, positionId: first.order.positionId.toString(), now: NOW });
    await E.placeOrder(db, { userId: u, body: buy(stopBelow(quote, 50), { units: '1000' }), now: NOW }); // left open
    await E.placeOrder(db, { userId: u, body: { clientOrderId: key(), type: 'limit', instrument: 'EUR_USD', side: 'buy', units: '1000', price: formatPrice(quote.ask - 500n), stopLoss: formatPrice(quote.ask - 1000n), expiryHours: 1 }, now: NOW });
    await V.setLeaderboardOptIn(db, { userId: u, optIn: true });
    await db.collection('demoTradeJournal').insertOne({ studentId: u, notes: 'private' });
    await db.collection('demoTaskSubmissions').insertOne({ studentId: u, reasoning: 'private' });
    await db.collection('demoTasks').insertOne({ title: 'General', assignedTo: null, completions: { [u]: NOW, [other]: NOW } });
    const accountId = (await db.collection('tradingAccounts').findOne({ userId: u }))._id;
    const ledgerBefore = await db.collection('tradingLedger').find({ accountId }).toArray();

    const result = await deleteAccount(db, { actor: { userId: new ObjectId().toHexString(), role: 'superadmin' }, userId: u, now: NOW });
    assert.equal(result.ok, true, JSON.stringify(result));

    for (const name of ['tradingAccounts', 'tradingOrders', 'tradingPositions', 'tradingOperations']) {
      assert.equal(await db.collection(name).countDocuments({ userId: u }), 0, name);
    }
    assert.equal(await db.collection('tradingAccountSlots').countDocuments({ _id: u }), 0);
    assert.equal(await db.collection('demoTradeJournal').countDocuments({}), 0);
    assert.equal(await db.collection('demoTaskSubmissions').countDocuments({}), 0);
    const task = await db.collection('demoTasks').findOne({});
    assert.deepEqual(Object.keys(task.completions), [other], "another student's completion stays");
    assert.deepEqual(await db.collection('tradingLedger').find({ accountId }).toArray(), ledgerBefore, 'the ledger is not touched');
    assert.ok(!JSON.stringify(ledgerBefore).includes(u), 'and holds no user id');
    assert.equal((await E.reconcileAccount(db, accountId)).ledgerRows, ledgerBefore.length);
    assert.equal(await db.collection('tradingPositions').countDocuments({ accountId, status: 'open' }), 0);
    assert.equal((await db.collection('tradingPositions').findOne({ accountId, status: 'void' })).exit, undefined, 'no invented close price');
    assert.equal(await db.collection('tradingOrders').countDocuments({ accountId, status: 'pending' }), 0);
    assert.equal((await V.leaderboard(db, { userId: other })).rows.length, 0);

    await E.sweep(db, { apply: true, now: later(60) });
    assert.equal((await db.collection('tradingAccounts').findOne({ _id: accountId })).status, 'anonymised', 'the evaluator leaves it alone');

    const retained = await R.purgeExpired(db, { now: NOW });
    assert.equal(retained.expired, 0);
    const expiry = new Date(NOW.getTime() + (R.RETENTION_DAYS + 1) * 86400000);
    assert.deepEqual(await R.purgeExpired(db, { now: expiry }), { expired: 1, purged: 0 }, 'a report purges nothing');
    assert.deepEqual(await R.purgeExpired(db, { now: expiry, apply: true }), { expired: 1, purged: 1 });
    assert.equal(await db.collection('tradingLedger').countDocuments({ accountId }), 0);
    assert.equal(await db.collection('tradingAccounts').countDocuments({ _id: accountId }), 0);
    assert.equal(await db.collection('tradingAccounts').countDocuments({ userId: other }), 1);
  });
});

test('real MongoDB: anonymising twice, or after an interrupted first attempt, ends the same', { skip }, async () => {
  const { conn } = await fresh();
  await closing(conn, async () => {
    const u = newUser();
    await E.ensureAccount(conn.db, { userId: u, now: NOW });
    await R.anonymiseStudentTrading(conn.db, u, { now: NOW });
    const row = await conn.db.collection('tradingAccounts').findOne({ status: 'anonymised' });
    await R.anonymiseStudentTrading(conn.db, u, { now: later(60) });
    assert.deepEqual(await conn.db.collection('tradingAccounts').findOne({ status: 'anonymised' }), row);
  });
});

test('real MongoDB: leaving the leaderboard drops the alias, and returning gets a new one', { skip }, async () => {
  const { conn } = await fresh();
  await closing(conn, async () => {
    const u = newUser();
    await E.ensureAccount(conn.db, { userId: u, now: NOW });
    const slots = conn.db.collection('tradingAccountSlots');
    await V.setLeaderboardOptIn(conn.db, { userId: u, optIn: true });
    const first = (await slots.findOne({ _id: u })).alias;
    await V.setLeaderboardOptIn(conn.db, { userId: u, optIn: false });
    assert.equal((await slots.findOne({ _id: u })).alias, null);
    await V.setLeaderboardOptIn(conn.db, { userId: u, optIn: true });
    assert.notEqual((await slots.findOne({ _id: u })).alias, first);
  });
});

test('real MongoDB: each kind of damage to the chain is reported as itself', { skip }, async () => {
  const { conn, market } = await fresh();
  await closing(conn, async () => {
    const rows = conn.db.collection('marketCheckpoints');
    const crypto = require('crypto');
    const rehash = (doc) => crypto.createHash('sha256').update(JSON.stringify([doc.previousHash, doc.datasetId, doc.instrument, doc.step, doc.state, doc.bar])).digest('hex');
    const pick = (instrument, skipRows) => rows.find({ instrument }).sort({ step: -1 }).skip(skipRows).limit(1).next();
    const kinds = async (instrument) => (await S.verifyChain(conn.db, market, instrument)).problems.map((p) => p.problem);

    // A stored hash that does not match its row.
    const a = await pick('EUR_USD', 2);
    await rows.updateOne({ _id: a._id }, { $set: { hash: 'f'.repeat(64) } });
    assert.ok((await kinds('EUR_USD')).includes('hash'));

    // A forged state with a correct hash: only recomputing the model can see it.
    const b = await pick('GBP_USD', 2);
    const forged = { ...b, state: { ...b.state, mid: b.state.mid + 1000 } };
    await rows.updateOne({ _id: b._id }, { $set: { state: forged.state, hash: rehash(forged) } });
    const gbp = await kinds('GBP_USD');
    assert.ok(gbp.includes('state'), gbp.join());
    assert.ok(!gbp.includes('hash'), gbp.join());

    // A missing hour, with the chain repaired around it: only the step count shows the gap.
    const newer = await pick('AUD_USD', 2);
    const missing = await pick('AUD_USD', 3);
    const older = await pick('AUD_USD', 4);
    await rows.deleteOne({ _id: missing._id });
    const relinked = { ...newer, previousHash: older.hash };
    await rows.updateOne({ _id: newer._id }, { $set: { previousHash: older.hash, hash: rehash(relinked) } });
    assert.ok((await kinds('AUD_USD')).includes('gap'));
  });
});
