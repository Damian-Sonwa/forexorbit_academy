/**
 * The practice simulator against a real MongoDB server (npm run test:mongo:trading).
 *
 * What only a real server shows: truly concurrent orders and closes on one account, conditional
 * updates under contention, duplicate-key behaviour, exact Decimal128 round trips, index builds and
 * query plans. Failure injection wraps the real driver: only the chosen call throws. Quotes are
 * TEST-ONLY fixtures.
 *
 * Requires MONGODB_URI_TEST (an isolated server) and MONGODB_DB_NAME_TEST (ending in "_test").
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');

const { openTestDatabase, testDatabaseConfig } = require('../helpers/mongo-test-db');
const { START, fixtureDataset, quoteDoc } = require('../helpers/trading-fixture');
const E = require('../../lib/trading/engine');
const V = require('../../lib/trading/views');
const D = require('../../lib/trading/market-data');
const { applyImport, planImport } = require('../../lib/trading/import');
const { TRADING_INDEXES, ensureTradingIndexes, tradingIndexReport } = require('../../lib/trading/indexes');
const { run: runIndexScript } = require('../../scripts/trading-indexes');
const { run: runReconcile } = require('../../scripts/trading-reconcile');

const config = testDatabaseConfig();
const skip = config.ok ? false : config.reason;
const after = (seconds) => new Date(START.getTime() + seconds * 1000);
const later = after(600);
let seq = 0;
const key = () => `mongo-order-${(seq += 1)}-abcdef`;
const buy = (extra = {}) => ({ clientOrderId: key(), type: 'market', instrument: 'EUR_USD', side: 'buy', units: '10000', stopLoss: '1.09000', ...extra });
const newUser = () => new ObjectId().toHexString();

async function fresh({ dataset = true } = {}) {
  const conn = await openTestDatabase();
  await conn.reset();
  if (dataset) {
    const d = fixtureDataset();
    await conn.db.collection('marketDataSets').insertOne(d);
    await conn.db.collection('marketQuotes').insertOne(quoteDoc(d._id, 'EUR_USD', START, '1.10000', '1.10020'));
  }
  return conn;
}
async function closing(conn, fn) {
  try {
    await fn();
  } finally {
    await conn.reset();
    await conn.close();
  }
}
const addQuote = (db, time, bid, ask, instrument = 'EUR_USD') => db.collection('marketQuotes').insertOne(quoteDoc('test-fixture', instrument, time, bid, ask));
const account = (db, userId) => E.activeAccount(db, userId);
const positionsOf = (db, userId) => db.collection('tradingPositions').find({ userId }).toArray();

/** The real database with one chosen call replaced. */
function failing(db, plan) {
  const counts = new Map();
  return {
    collection(name) {
      const real = db.collection(name);
      return new Proxy(real, {
        get(target, prop) {
          const value = target[prop];
          if (typeof value !== 'function') return value;
          return (...args) => {
            const label = `${name}.${String(prop)}`;
            counts.set(label, (counts.get(label) || 0) + 1);
            if (plan.key === label && counts.get(label) === plan.nth) return Promise.reject(new Error(`injected ${label}`));
            return value.apply(target, args);
          };
        },
      });
    },
  };
}

test('real MongoDB: money and prices survive storage exactly, as Decimal128', { skip }, async () => {
  const conn = await fresh();
  await closing(conn, async () => {
    const u = newUser();
    await E.ensureAccount(conn.db, { userId: u, now: START });
    await E.placeOrder(conn.db, { userId: u, body: buy(), now: START });
    const [row] = await positionsOf(conn.db, u);
    assert.equal(row.entry._bsontype, 'Decimal128');
    assert.deepEqual([String(row.entry), String(row.margin), String(row.plannedRisk)], ['1.10020', '366.73', '102.00']);
    const stored = await account(conn.db, u);
    assert.deepEqual([String(stored.balance), String(stored.usedMargin)], ['10000.00', '366.73']);
  });
});

test('real MongoDB: 30 simultaneous creates make one account and one opening ledger row', { skip }, async () => {
  const conn = await fresh();
  await closing(conn, async () => {
    for (let round = 0; round < 5; round += 1) {
      const u = newUser();
      const results = await Promise.all(Array.from({ length: 30 }, () => E.ensureAccount(conn.db, { userId: u, now: START })));
      assert.equal(new Set(results.map((r) => String(r._id))).size, 1);
      assert.equal(await conn.db.collection('tradingAccounts').countDocuments({ userId: u }), 1);
      assert.equal(await conn.db.collection('tradingLedger').countDocuments({ userId: u }), 1);
    }
  });
});

test('real MongoDB: 30 simultaneous orders cannot spend the same margin', { skip }, async () => {
  const conn = await fresh();
  await closing(conn, async () => {
    for (let round = 0; round < 4; round += 1) {
      const u = newUser();
      await E.ensureAccount(conn.db, { userId: u, now: START });
      // Each needs 5,501.00 of margin: only one can fit in 10,000.00.
      const results = await Promise.all(Array.from({ length: 30 }, () => E.placeOrder(conn.db, { userId: u, body: buy({ units: '150000', stopLoss: '1.09950' }), now: START })));
      assert.equal(results.filter((r) => r.order.status === 'filled').length, 1, `round ${round}`);
      assert.equal((await positionsOf(conn.db, u)).length, 1);
      const stored = await account(conn.db, u);
      assert.equal(String(stored.usedMargin), '5501.00');
      assert.deepEqual(stored.applied, {});
      assert.equal((await E.reconcileAccount(conn.db, stored._id)).ok, true);
    }
  });
});

test('real MongoDB: risk limits hold under concurrency', { skip }, async () => {
  const conn = await fresh();
  await closing(conn, async () => {
    // This once failed about one run in four, so it repeats: a single pass proves little.
    for (let round = 0; round < 12; round += 1) {
      const u = newUser();
      await E.ensureAccount(conn.db, { userId: u, now: START });
      // 150.00 of risk each: three fit under 5% (about 499.90); 40 are sent at once.
      await Promise.all(Array.from({ length: 40 }, () => E.placeOrder(conn.db, { userId: u, body: buy({ units: '5000', stopLoss: '1.07020' }), now: START })));
      const rows = await positionsOf(conn.db, u);
      assert.equal(rows.length, 3, `round ${round}`);
      assert.equal(String(rows[0].plannedRisk), '150.00');
    }
  });
});

test('real MongoDB: 30 identical requests execute once', { skip }, async () => {
  const conn = await fresh();
  await closing(conn, async () => {
    const u = newUser();
    await E.ensureAccount(conn.db, { userId: u, now: START });
    const body = buy();
    const results = await Promise.all(Array.from({ length: 30 }, () => E.placeOrder(conn.db, { userId: u, body, now: START })));
    assert.equal(new Set(results.map((r) => String(r.order._id))).size, 1);
    assert.equal((await positionsOf(conn.db, u)).length, 1);
    assert.equal(String((await account(conn.db, u)).usedMargin), '366.73');
  });
});

test('real MongoDB: 30 simultaneous closes settle once', { skip }, async () => {
  const conn = await fresh();
  await closing(conn, async () => {
    const u = newUser();
    await E.ensureAccount(conn.db, { userId: u, now: START });
    await E.placeOrder(conn.db, { userId: u, body: buy(), now: START });
    const [position] = await positionsOf(conn.db, u);
    await addQuote(conn.db, after(30), '1.10520', '1.10540');
    await Promise.all(Array.from({ length: 30 }, () => E.closePosition(conn.db, { userId: u, positionId: String(position._id), now: after(30) })));
    const stored = await account(conn.db, u);
    assert.deepEqual([String(stored.balance), String(stored.usedMargin), stored.closedTrades, stored.ledgerSeq], ['10050.00', '0.00', 1, 2]);
    assert.equal(await conn.db.collection('tradingLedger').countDocuments({ accountId: stored._id }), 2);
    assert.equal((await E.reconcileAccount(conn.db, stored._id)).ok, true);
  });
});

test('real MongoDB: a manual close racing a stop-loss produces one close', { skip }, async () => {
  const conn = await fresh();
  await closing(conn, async () => {
    const u = newUser();
    await E.ensureAccount(conn.db, { userId: u, now: START });
    await E.placeOrder(conn.db, { userId: u, body: buy({ stopLoss: '1.09900' }), now: START });
    const [position] = await positionsOf(conn.db, u);
    const stored = await account(conn.db, u);
    await addQuote(conn.db, after(30), '1.09890', '1.09910');
    await Promise.all([
      ...Array.from({ length: 8 }, () => E.evaluateAccount(conn.db, stored._id, { now: after(30) })),
      ...Array.from({ length: 8 }, () => E.closePosition(conn.db, { userId: u, positionId: String(position._id), now: after(30) })),
    ]);
    const final = await account(conn.db, u);
    assert.equal(final.closedTrades, 1);
    assert.equal(String(final.balance), '9987.00'); // (1.09890 - 1.10020) x 10,000 = -13.00
    assert.equal((await E.reconcileAccount(conn.db, final._id)).ok, true);
  });
});

test('real MongoDB: a pending order fills once under concurrent evaluation', { skip }, async () => {
  const conn = await fresh();
  await closing(conn, async () => {
    const u = newUser();
    await E.ensureAccount(conn.db, { userId: u, now: START });
    await E.placeOrder(conn.db, { userId: u, body: buy({ type: 'limit', price: '1.09900', stopLoss: '1.09500' }), now: START });
    await addQuote(conn.db, after(30), '1.09880', '1.09900');
    const stored = await account(conn.db, u);
    await Promise.all(Array.from({ length: 20 }, () => E.evaluateAccount(conn.db, stored._id, { now: after(30) })));
    assert.equal((await positionsOf(conn.db, u)).length, 1);
    assert.equal(String((await account(conn.db, u)).usedMargin), '366.33');
  });
});

test('real MongoDB: a mixed storm of orders and closes leaves the books reconciled', { skip }, async () => {
  const conn = await fresh();
  await closing(conn, async () => {
    const u = newUser();
    await E.ensureAccount(conn.db, { userId: u, now: START });
    const worker = async () => {
      for (let i = 0; i < 6; i += 1) {
        await E.placeOrder(conn.db, { userId: u, body: buy({ units: '1000', stopLoss: '1.09900' }), now: START });
        const open = await conn.db.collection('tradingPositions').find({ userId: u, status: 'open' }).limit(1).toArray();
        if (open.length) await E.closePosition(conn.db, { userId: u, positionId: String(open[0]._id), now: START });
      }
    };
    await Promise.all(Array.from({ length: 10 }, worker));
    await E.recoverOperations(conn.db, { now: later });
    const stored = await account(conn.db, u);
    const report = await E.reconcileAccount(conn.db, stored._id);
    assert.deepEqual([report.ok, report.problems], [true, []]);
    assert.ok(report.ledgerRows > 1);
    // Every trade here closes at the spread: 0.20 lost per 1,000 units, exactly.
    assert.equal(String(stored.balance), (10000 - (report.ledgerRows - 1) * 0.2).toFixed(2));
  });
});

for (const [plan, status, filled] of [
  [{ key: 'tradingOperations.updateOne', nth: 1 }, 'rejected', false],
  [{ key: 'tradingAccounts.updateOne', nth: 1 }, 'rejected', false],
  [{ key: 'tradingPositions.insertOne', nth: 1 }, 'filled', true],
  [{ key: 'tradingOrders.updateOne', nth: 2 }, 'filled', true],
  [{ key: 'tradingAccounts.updateOne', nth: 2 }, 'filled', true],
  [{ key: 'tradingOperations.updateOne', nth: 2 }, 'filled', true],
]) {
  test(`real MongoDB: fill interrupted at ${plan.key} #${plan.nth} recovers to one outcome`, { skip }, async () => {
    const conn = await fresh();
    await closing(conn, async () => {
      const u = newUser();
      await E.ensureAccount(conn.db, { userId: u, now: START });
      await assert.rejects(E.placeOrder(failing(conn.db, plan), { userId: u, body: buy(), now: START }), /injected/);
      await E.recoverOperations(conn.db, { now: later });
      const stored = await account(conn.db, u);
      assert.equal((await positionsOf(conn.db, u)).length, filled ? 1 : 0);
      assert.equal(String(stored.usedMargin), filled ? '366.73' : '0.00');
      assert.equal((await conn.db.collection('tradingOrders').findOne({ userId: u })).status, status);
      assert.deepEqual(stored.applied, {});
      assert.equal((await E.reconcileAccount(conn.db, stored._id)).ok, true);
    });
  });
}

for (const plan of [
  { key: 'tradingAccounts.updateOne', nth: 1 },
  { key: 'tradingLedger.insertOne', nth: 1 },
  { key: 'tradingPositions.updateOne', nth: 1 },
  { key: 'tradingAccounts.updateOne', nth: 2 },
  { key: 'tradingOperations.updateOne', nth: 1 },
]) {
  test(`real MongoDB: close interrupted at ${plan.key} #${plan.nth} finishes exactly once`, { skip }, async () => {
    const conn = await fresh();
    await closing(conn, async () => {
      const u = newUser();
      await E.ensureAccount(conn.db, { userId: u, now: START });
      await E.placeOrder(conn.db, { userId: u, body: buy(), now: START });
      const [position] = await positionsOf(conn.db, u);
      await addQuote(conn.db, after(30), '1.10520', '1.10540');
      await assert.rejects(E.closePosition(failing(conn.db, plan), { userId: u, positionId: String(position._id), now: after(30) }), /injected/);
      await E.recoverOperations(conn.db, { now: later });
      await E.recoverOperations(conn.db, { now: later });
      const stored = await account(conn.db, u);
      assert.deepEqual([String(stored.balance), stored.ledgerSeq, stored.closedTrades], ['10050.00', 2, 1]);
      assert.equal((await E.reconcileAccount(conn.db, stored._id)).ok, true);
    });
  });
}

test('real MongoDB: a reset racing orders leaves exactly one active account and clean books', { skip }, async () => {
  const conn = await fresh();
  await closing(conn, async () => {
    for (let round = 0; round < 5; round += 1) {
      const u = newUser();
      await E.ensureAccount(conn.db, { userId: u, now: START });
      await Promise.all([
        ...Array.from({ length: 6 }, () => E.resetAccount(conn.db, { userId: u, now: START })),
        ...Array.from({ length: 6 }, () => E.placeOrder(conn.db, { userId: u, body: buy({ units: '1000' }), now: START })),
      ]);
      const accounts = await conn.db.collection('tradingAccounts').find({ userId: u }).toArray();
      assert.ok(accounts.filter((a) => a.status === 'active').length === 1, `round ${round}`);
      for (const row of accounts) assert.equal((await E.reconcileAccount(conn.db, row._id)).ok, true, `round ${round}`);
      for (const row of accounts.filter((a) => a.status === 'archived')) {
        assert.equal(await conn.db.collection('tradingPositions').countDocuments({ accountId: row._id, status: 'open' }), 0, 'no open position is stranded on an archived account');
      }
    }
  });
});

test('real MongoDB: the gate reads real documents; a withdrawn approval suspends trading at once', { skip }, async () => {
  const conn = await fresh();
  await closing(conn, async () => {
    assert.equal((await D.marketState(conn.db, { now: START })).open, true);
    await conn.db.collection('marketDataSets').updateOne({ _id: 'test-fixture' }, { $set: { 'approval.status': 'withdrawn' } });
    assert.equal((await D.marketState(conn.db, { now: START })).reason, 'no_verified_data');
    const view = await V.marketView(conn.db, { now: START });
    assert.ok(view.view.instruments.every((i) => i.bid === null));
  });
});

test('real MongoDB: an approved import writes quotes, inactive, and they are read back exactly', { skip }, async () => {
  const conn = await fresh({ dataset: false });
  await closing(conn, async () => {
    const manifest = { ...fixtureDataset(), _id: 'approved-sample', testFixture: false };
    const plan = planImport({ manifest, csvText: 'instrument,time,bid,ask\nEUR_USD,2026-03-04T12:00:00Z,1.10000,1.10020\n', env: { NODE_ENV: 'test' } });
    assert.equal(plan.ok, true);
    assert.equal((await applyImport(conn.db, { manifest, plan })).imported, 1);
    assert.equal((await D.marketState(conn.db, { now: START })).reason, 'no_verified_data', 'imported is not active');
    await conn.db.collection('marketDataSets').updateOne({ _id: 'approved-sample' }, { $set: { active: true } });
    const state = await D.marketState(conn.db, { now: START });
    const { quote } = await D.latestQuote(conn.db, state.dataset, 'EUR_USD', START);
    assert.deepEqual([quote.bid, quote.ask], [110000n, 110020n]);
  });
});

test('real MongoDB: the index script is read-only by default, builds T1-T10, is idempotent and refuses duplicates', { skip }, async () => {
  const conn = await fresh({ dataset: false });
  await closing(conn, async () => {
    await conn.db.createCollection('tradingLedger');
    const report = await runIndexScript(conn.db, { apply: false, log: () => {} });
    assert.equal(report.built.length, 0);
    assert.deepEqual((await conn.db.listCollections().toArray()).map((c) => c.name), ['tradingLedger'], 'a report creates nothing');
    const applied = await runIndexScript(conn.db, { apply: true, log: () => {} });
    assert.deepEqual([applied.ok, applied.built.length], [true, TRADING_INDEXES.length]);
    assert.deepEqual((await runIndexScript(conn.db, { apply: true, log: () => {} })).built, []);
    assert.ok((await tradingIndexReport(conn.db)).every((r) => r.state === 'present'));
    const accountId = new ObjectId();
    await conn.db.collection('tradingLedger').insertOne({ accountId, seq: 1 });
    await assert.rejects(conn.db.collection('tradingLedger').insertOne({ accountId, seq: 1 }), (e) => e.code === 11000);
    await conn.db.collection('marketQuotes').insertOne({ datasetId: 'd', instrument: 'EUR_USD', time: START });
    await assert.rejects(conn.db.collection('marketQuotes').insertOne({ datasetId: 'd', instrument: 'EUR_USD', time: START }), (e) => e.code === 11000);
  });
  const dup = await fresh({ dataset: false });
  await closing(dup, async () => {
    await dup.db.collection('marketQuotes').insertMany([{ datasetId: 'd', instrument: 'E', time: START }, { datasetId: 'd', instrument: 'E', time: START }]);
    const result = await ensureTradingIndexes(dup.db, { apply: true });
    assert.deepEqual([result.ok, result.built, result.blocked], [false, [], ['T8']]);
    assert.equal(await dup.db.collection('marketQuotes').countDocuments({}), 2, 'nothing was deleted');
  });
});

test('real MongoDB: hot reads use their indexes', { skip }, async () => {
  const conn = await fresh();
  await closing(conn, async () => {
    await ensureTradingIndexes(conn.db, { apply: true });
    const plan = async (cursor) => JSON.stringify((await cursor.explain('queryPlanner')).queryPlanner.winningPlan);
    const accountId = new ObjectId();
    assert.match(await plan(conn.db.collection('tradingPositions').find({ accountId, status: 'open' })), /trading_position_account_status/);
    assert.match(await plan(conn.db.collection('tradingOrders').find({ accountId, status: 'pending' })), /trading_order_account_status/);
    assert.match(await plan(conn.db.collection('marketQuotes').find({ datasetId: 'test-fixture', instrument: 'EUR_USD', time: { $lte: START } }).sort({ time: -1 }).limit(1)), /market_quote_dataset_instrument_time/);
  });
});

test('real MongoDB: reconciliation reports tampering, repairs nothing, and the script exits on it', { skip }, async () => {
  const conn = await fresh();
  await closing(conn, async () => {
    const u = newUser();
    const stored = await E.ensureAccount(conn.db, { userId: u, now: START });
    assert.equal((await runReconcile(conn.db, { apply: false, log: () => {} })).mismatches.length, 0);
    const { Decimal128 } = require('mongodb');
    await conn.db.collection('tradingAccounts').updateOne({ _id: stored._id }, { $set: { balance: Decimal128.fromString('1.00') } });
    const report = await runReconcile(conn.db, { apply: true, log: () => {} });
    assert.equal(report.mismatches.length, 1);
    assert.equal(String((await account(conn.db, u)).balance), '1.00');
  });
});
