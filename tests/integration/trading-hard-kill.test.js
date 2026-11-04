/**
 * Hard process termination (npm run test:mongo:hardkill). A real child process runs a real operation
 * against real MongoDB and is killed with SIGKILL after a chosen database call. A second, fresh
 * process then does what a restart does. Nothing about the failure is simulated in-process.
 * Requires MONGODB_URI_TEST and MONGODB_DB_NAME_TEST (ending in "_test").
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawn } = require('child_process');
const { ObjectId } = require('mongodb');

const { openTestDatabase, testDatabaseConfig } = require('../helpers/mongo-test-db');
const { START, fixtureDataset, quoteDoc } = require('../helpers/trading-fixture');
const E = require('../../lib/trading/engine');
const H = require('../../lib/market/health');
const S = require('../../lib/market/series');

const config = testDatabaseConfig();
const skip = config.ok ? false : config.reason;
const WORKER = path.join(__dirname, 'workers', 'trading-kill-worker.js');
const after = (seconds) => new Date(START.getTime() + seconds * 1000);
const RESTART = after(600); // past the two-minute staleness limit
const newUser = () => new ObjectId().toHexString();
let keys = 0;

function runWorker(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [WORKER], {
      cwd: path.join(__dirname, '..', '..'),
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, MONGODB_URI_TEST: config.uri, MONGODB_DB_NAME_TEST: config.dbName, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { err += chunk; });
    child.on('error', reject);
    child.on('exit', (code, signal) => resolve({ code, signal, finished: out.includes('finished'), err }));
  });
}

/** The process must really have died at that call: an operation that ran to its end proves nothing. */
async function killAt(at, env) {
  const result = await runWorker({ KILL_AT: at, ...env });
  assert.equal(result.finished, false, `${at}: the process ran to the end, so the kill point was never reached`);
  assert.ok(result.signal === 'SIGKILL' || result.code === 1 || result.code === null, `${at}: ${JSON.stringify(result)}`);
  assert.equal(result.err, '', `${at}: died of an error, not the kill`);
}
const restart = (now = RESTART) => runWorker({ KILL_SCENARIO: 'recover', KILL_NOW: now.toISOString() }).then((r) => assert.equal(r.finished, true, r.err));

async function fresh() {
  const conn = await openTestDatabase();
  await conn.reset();
  const dataset = fixtureDataset({ maxQuoteAgeSeconds: 3600 });
  await conn.db.collection('marketDataSets').insertOne(dataset);
  await conn.db.collection('marketQuotes').insertOne(quoteDoc(dataset._id, 'EUR_USD', START, '1.10000', '1.10020'));
  return conn;
}
async function closing(conn, fn) {
  try { await fn(); } finally { await conn.reset(); await conn.close(); }
}
async function assertClean(db, accountId) {
  const account = await db.collection('tradingAccounts').findOne({ _id: accountId });
  assert.deepEqual(account.applied || {}, {}, 'nothing left half-applied');
  assert.equal(await db.collection('tradingOperations').countDocuments({ accountId, status: 'pending' }), 0, 'no operation left pending');
  assert.equal(await db.collection('tradingOrders').countDocuments({ accountId, status: { $in: ['received', 'executing'] } }), 0, 'no order left in flight');
  const report = await E.reconcileAccount(db, accountId);
  assert.deepEqual([report.ok, report.problems], [true, []]);
  return account;
}

for (const at of [
  'tradingOrders.insertOne#1',
  'tradingOrders.updateOne#1',
  'tradingOperations.updateOne#1',
  'tradingAccounts.updateOne#1',
  'tradingPositions.insertOne#1',
  'tradingOrders.updateOne#2',
  'tradingAccounts.updateOne#2',
  'tradingOperations.updateOne#2',
]) {
  test(`hard kill: order placement dies after ${at}`, { skip, timeout: 60000 }, async () => {
    const conn = await fresh();
    await closing(conn, async () => {
      const db = conn.db;
      const u = newUser();
      const { _id: accountId } = await E.ensureAccount(db, { userId: u, now: START });
      const key = `hard-kill-order-${(keys += 1)}-abcdef`;
      await killAt(at, { KILL_SCENARIO: 'order', KILL_USER: u, KILL_ORDER_KEY: key, KILL_NOW: START.toISOString() });
      await restart();
      const account = await assertClean(db, accountId);
      const positions = await db.collection('tradingPositions').countDocuments({ accountId });
      assert.ok(positions <= 1, 'no duplicate fill');
      assert.equal(String(account.usedMargin), positions ? '366.73' : '0.00', 'the reservation matches what exists: none is stranded');
      const order = await db.collection('tradingOrders').findOne({ accountId });
      if (order) assert.equal(order.status, positions ? 'filled' : 'rejected');
      assert.equal(await db.collection('tradingLedger').countDocuments({ accountId }), 1, 'an open trade posts nothing');
      // The student retries the same request: it never trades twice.
      await E.placeOrder(db, { userId: u, now: RESTART, body: { clientOrderId: key, type: 'market', instrument: 'EUR_USD', side: 'buy', units: '10000', stopLoss: '1.09000' } });
      assert.ok((await db.collection('tradingPositions').countDocuments({ accountId })) <= 1);
      // The account is usable: a new order works.
      const next = await E.placeOrder(db, { userId: u, now: RESTART, body: { clientOrderId: `${key}-next`, type: 'market', instrument: 'EUR_USD', side: 'buy', units: '1000', stopLoss: '1.09000' } });
      assert.equal(next.order.status, 'filled');
    });
  });
}

async function openPosition(db, stopLoss = '1.09000') {
  const u = newUser();
  const { _id: accountId } = await E.ensureAccount(db, { userId: u, now: START });
  const placed = await E.placeOrder(db, { userId: u, now: START, body: { clientOrderId: `hard-kill-open-${(keys += 1)}-abcdef`, type: 'market', instrument: 'EUR_USD', side: 'buy', units: '10000', stopLoss } });
  return { u, accountId, positionId: String(placed.order.positionId) };
}

for (const at of [
  'tradingOperations.insertOne#1',
  'tradingAccounts.updateOne#1',
  'tradingLedger.insertOne#1',
  'tradingPositions.updateOne#1',
  'tradingAccounts.updateOne#2',
  'tradingOperations.updateOne#1',
]) {
  test(`hard kill: a close dies after ${at}, then finishes exactly once`, { skip, timeout: 60000 }, async () => {
    const conn = await fresh();
    await closing(conn, async () => {
      const db = conn.db;
      const { u, accountId, positionId } = await openPosition(db);
      await db.collection('marketQuotes').insertOne(quoteDoc('test-fixture', 'EUR_USD', after(30), '1.10520', '1.10540'));
      await killAt(at, { KILL_SCENARIO: 'close', KILL_USER: u, KILL_POSITION: positionId, KILL_NOW: after(30).toISOString() });
      await restart();
      await restart();
      const account = await assertClean(db, accountId);
      assert.deepEqual([String(account.balance), String(account.usedMargin), account.closedTrades, account.ledgerSeq], ['10050.00', '0.00', 1, 2], 'realised once');
      assert.equal(await db.collection('tradingLedger').countDocuments({ accountId }), 2, 'no duplicate and no lost ledger row');
    });
  });

  test(`hard kill: a stop-loss evaluation dies after ${at}, then finishes exactly once`, { skip, timeout: 60000 }, async () => {
    const conn = await fresh();
    await closing(conn, async () => {
      const db = conn.db;
      const { u, accountId } = await openPosition(db, '1.09900');
      await db.collection('marketQuotes').insertOne(quoteDoc('test-fixture', 'EUR_USD', after(30), '1.09890', '1.09910'));
      await killAt(at, { KILL_SCENARIO: 'evaluate', KILL_USER: u, KILL_NOW: after(30).toISOString() });
      await restart();
      const account = await assertClean(db, accountId);
      assert.deepEqual([String(account.balance), account.closedTrades], ['9987.00', 1], 'the recorded bid, realised once');
      const position = await db.collection('tradingPositions').findOne({ accountId });
      assert.deepEqual([position.closeReason, String(position.exit)], ['stop_loss', '1.09890']);
    });
  });
}

for (const at of [
  'tradingOperations.insertOne#1',
  'tradingAccounts.updateOne#1',
  'tradingAccounts.updateOne#2',
  'tradingAccountSlots.updateOne#1',
  'tradingLedger.insertOne#1',
]) {
  test(`hard kill: a reset dies after ${at}, and resetting is never left blocked`, { skip, timeout: 60000 }, async () => {
    const conn = await fresh();
    await closing(conn, async () => {
      const db = conn.db;
      const u = newUser();
      await E.ensureAccount(db, { userId: u, now: START });
      await killAt(at, { KILL_SCENARIO: 'reset', KILL_USER: u, KILL_NOW: START.toISOString() });
      await restart();
      const accounts = await db.collection('tradingAccounts').find({ userId: u }).toArray();
      assert.equal(accounts.filter((a) => a.status === 'active').length, 1, 'exactly one active account');
      const slot = await db.collection('tradingAccountSlots').findOne({ _id: u });
      assert.equal(String(slot.activeAccountId), String(accounts.find((a) => a.status === 'active')._id));
      for (const row of accounts) await assertClean(db, row._id);
      const afterIt = await E.resetAccount(db, { userId: u, now: new Date(RESTART.getTime() + E.RESET_INTERVAL_MS + 1000) });
      assert.equal(afterIt.ok, true, JSON.stringify(afterIt));
      assert.equal(await db.collection('tradingLedger').countDocuments({ accountId: accounts[0]._id }), 1, 'history is preserved');
    });
  });
}

const MARKET_NOW = new Date('2026-03-04T12:00:00Z');
for (const at of ['marketHealth.updateOne#1', 'marketCheckpoints.insertMany#1', 'marketCheckpoints.insertMany#3', 'marketHealth.updateOne#2']) {
  test(`hard kill: the market pass dies after ${at}; the restart completes the same history`, { skip, timeout: 60000 }, async () => {
    const conn = await openTestDatabase();
    await conn.reset();
    await closing(conn, async () => {
      const db = conn.db;
      const market = { ...H.newMarket({ id: 'sim', startAt: new Date('2026-03-02T00:00:00Z'), seed: 'hard-kill-seed' }), active: true };
      await db.collection('marketDataSets').insertOne(market);
      await killAt(at, { KILL_SCENARIO: 'market', KILL_NOW: MARKET_NOW.toISOString() });
      await restart(MARKET_NOW);
      assert.equal((await H.readHealth(db, market)).status, 'ACTIVE');
      for (const instrument of market.instruments) {
        const check = await S.verifyChain(db, market, instrument, { depth: 100 });
        assert.deepEqual([check.ok, check.checked], [true, 60], instrument);
      }
      const last = await db.collection('marketCheckpoints').find({ instrument: 'EUR_USD' }).sort({ step: -1 }).limit(1).next();
      assert.deepEqual(last.state, S.stateFromStart(market, 'EUR_USD', last.step), 'identical to computing from the start');
    });
  });
}

test('hard kill: incomplete market state found on restart suspends trading instead of guessing', { skip, timeout: 60000 }, async () => {
  const conn = await openTestDatabase();
  await conn.reset();
  await closing(conn, async () => {
    const db = conn.db;
    const market = { ...H.newMarket({ id: 'sim', startAt: new Date('2026-03-02T00:00:00Z'), seed: 'hard-kill-seed' }), active: true };
    await db.collection('marketDataSets').insertOne(market);
    await restart(MARKET_NOW);
    const rows = db.collection('marketCheckpoints');
    const middle = await rows.find({ instrument: 'EUR_USD' }).sort({ step: -1 }).skip(5).limit(1).next();
    await rows.deleteOne({ _id: middle._id });
    await restart(MARKET_NOW);
    assert.equal((await H.readHealth(db, market)).status, 'ERROR');
    assert.equal(await db.collection('marketIncidents').countDocuments({ kind: 'history_mismatch' }), 1);
  });
});
