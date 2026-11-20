/**
 * Phase 10 completion (F4, F5) against a real MongoDB server (npm run test:mongo:sweep).
 *
 * What only a real server shows: the query plans of the exact queries the sweep and recovery send
 * (captured from the running code, then explained with executionStats), and full coverage of more than
 * 200 accounts through the real engine with real concurrency. Quotes are TEST-ONLY fixtures.
 *
 * Requires MONGODB_URI_TEST (an isolated server) and MONGODB_DB_NAME_TEST (ending in "_test").
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');

const { openTestDatabase, testDatabaseConfig } = require('../helpers/mongo-test-db');
const { START, fixtureDataset, quoteDoc } = require('../helpers/trading-fixture');
const E = require('../../lib/trading/engine');
const { ensureTradingIndexes } = require('../../lib/trading/indexes');

const config = testDatabaseConfig();
const skip = config.ok ? false : config.reason;
const after = (seconds) => new Date(START.getTime() + seconds * 1000);
const LATER = after(60);
let seq = 0;
const key = () => `sweep-mongo-${(seq += 1)}-abcdef`;
const market = (extra = {}) => ({ clientOrderId: key(), type: 'market', instrument: 'EUR_USD', side: 'buy', units: '1000', stopLoss: '1.09000', ...extra });
const limitBuy = () => market({ type: 'limit', price: '1.09900', stopLoss: '1.09500' });

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

/** The real database, recording every find the code sends: collection, filter, options, sort, limit. */
function recording(db) {
  const finds = [];
  const proxy = new Proxy(db, {
    get(target, prop) {
      if (prop !== 'collection') return typeof target[prop] === 'function' ? target[prop].bind(target) : target[prop];
      return (name) => {
        const collection = target.collection(name);
        return new Proxy(collection, {
          get(c, p) {
            if (p !== 'find') return typeof c[p] === 'function' ? c[p].bind(c) : c[p];
            return (filter, options) => {
              const entry = { name, filter, options, sort: null, limit: null };
              finds.push(entry);
              const cursor = c.find(filter, options);
              const sort = cursor.sort.bind(cursor);
              const limit = cursor.limit.bind(cursor);
              cursor.sort = (spec) => { entry.sort = spec; sort(spec); return cursor; };
              cursor.limit = (n) => { entry.limit = n; limit(n); return cursor; };
              return cursor;
            };
          },
        });
      };
    },
  });
  return { db: proxy, finds };
}

function stages(plan, out = []) {
  if (!plan || typeof plan !== 'object') return out;
  if (plan.stage) out.push(plan.indexName ? `${plan.stage}(${plan.indexName})` : plan.stage);
  for (const child of [plan.inputStage, ...(plan.inputStages || [])]) stages(child, out);
  return out;
}

async function explainFind(db, entry) {
  const cursor = db.collection(entry.name).find(entry.filter, entry.options || {});
  if (entry.sort) cursor.sort(entry.sort);
  if (entry.limit) cursor.limit(entry.limit);
  const result = await cursor.explain('executionStats');
  const s = result.executionStats;
  return { plan: stages(result.queryPlanner.winningPlan), keys: s.totalKeysExamined, docs: s.totalDocsExamined, returned: s.nReturned };
}

test('real MongoDB explain(): every sweep and recovery page uses its index, with no in-memory sort and no collection scan', { skip, timeout: 120000 }, async () => {
  const conn = await fresh({ dataset: false });
  await closing(conn, async () => {
    const { db } = conn;
    assert.equal((await ensureTradingIndexes(db, { apply: true })).ok, true);
    const old = after(-3600);
    const at = (i) => new Date(old.getTime() + i * 1000);
    const page = 100;
    // Most rows are in states the sweep must NOT read: an index that only matched on accountId or
    // createdAt would examine them all. Statuses and keys are what the engine writes.
    const accountIds = Array.from({ length: 600 }, () => new ObjectId());
    await db.collection('tradingAccounts').insertMany(accountIds.map((_id, i) => ({ _id, status: 'active', createdAt: at(i) })));
    await db.collection('tradingPositions').insertMany([
      ...accountIds.map((accountId, i) => ({ _id: new ObjectId(), accountId, status: 'open', openedAt: at(i) })),
      ...Array.from({ length: 4000 }, (_, i) => ({ _id: new ObjectId(), accountId: accountIds[i % 600], status: 'closed', openedAt: at(i) })),
    ]);
    await db.collection('tradingOrders').insertMany([
      ...Array.from({ length: 400 }, (_, i) => ({ _id: `p-${i}`, accountId: accountIds[i], status: 'pending', createdAt: at(i % 50) })),
      ...Array.from({ length: 300 }, (_, i) => ({ _id: `r-${i}`, accountId: accountIds[i], status: i % 2 ? 'received' : 'executing', createdAt: at(i % 40) })),
      ...Array.from({ length: 4000 }, (_, i) => ({ _id: `f-${i}`, accountId: accountIds[i % 600], status: 'filled', createdAt: at(i) })),
    ]);
    await db.collection('tradingOperations').insertMany([
      ...Array.from({ length: 300 }, (_, i) => ({ _id: `op-${i}`, type: 'noop', accountId: accountIds[i], status: 'pending', createdAt: at(i % 30) })),
      ...Array.from({ length: 4000 }, (_, i) => ({ _id: `done-${i}`, type: 'fill', accountId: accountIds[i % 600], status: 'done', createdAt: at(i) })),
    ]);
    // Stuck orders keep a fill operation so recovery leaves them in place: page 2 must still be reachable.
    await db.collection('tradingOperations').insertMany(Array.from({ length: 300 }, (_, i) => ({ _id: `fill:r-${i}`, type: 'fill', status: 'done', createdAt: at(0) })));

    const { db: spied, finds } = recording(db);
    const cursor = E.createSweepCursor();
    await E.sweep(spied, { apply: true, now: LATER, limit: page, cursor });
    const firstPass = finds.length;
    await E.sweep(spied, { apply: true, now: LATER, limit: page, cursor });
    const streamOf = (f) => {
      if (f.name === 'tradingPositions' && f.filter.status === 'open' && f.sort) return 'positions';
      if (f.name === 'tradingOrders' && f.filter.status === 'pending' && f.sort) return 'orders';
      if (f.name === 'tradingOrders' && f.filter.status && f.filter.status.$in && f.sort) return 'stuckOrders';
      if (f.name === 'tradingOperations' && f.filter.status === 'pending' && f.sort) return 'operations';
      if (f.name === 'tradingAccounts' && f.sort) return 'accounts';
      return null;
    };
    const expected = {
      positions: 'trading_position_status_account', // T17
      orders: 'trading_order_status_created', // T18
      stuckOrders: 'trading_order_status_created', // T18
      operations: 'trading_operation_status', // T5
      accounts: '_id_',
    };
    const evidence = {};
    for (const [label, entries] of [['first page', finds.slice(0, firstPass)], ['resumed page', finds.slice(firstPass)]]) {
      for (const entry of entries) {
        const stream = streamOf(entry);
        if (!stream || evidence[`${stream} ${label}`]) continue;
        const result = await explainFind(db, entry);
        evidence[`${stream} ${label}`] = result;
        const plan = result.plan.join(' > ');
        assert.ok(result.plan.some((s) => s.includes(`(${expected[stream]})`)), `${stream} ${label}: ${plan}`);
        assert.ok(!result.plan.includes('COLLSCAN'), `${stream} ${label} scans the collection: ${plan}`);
        assert.ok(!result.plan.includes('SORT'), `${stream} ${label} sorts in memory: ${plan}`);
        assert.ok(result.returned <= page);
        // Bounded by the page plus the ties already seen at the boundary (re-read, then left out by
        // $nin), never by the collection: 4,000+ rows in other states sit in each one.
        const ties = { operations: 10, orders: 8, stuckOrders: 8, positions: 0, accounts: 0 }[stream];
        assert.ok(result.docs <= page + ties, `${stream} ${label} examined ${result.docs} documents`);
        assert.ok(result.keys <= 2 * page + 10, `${stream} ${label} examined ${result.keys} keys`);
      }
    }
    for (const stream of Object.keys(expected)) {
      for (const label of ['first page', 'resumed page']) assert.ok(evidence[`${stream} ${label}`], `no ${label} captured for ${stream}`);
    }
    // The resumed queries are the keyset forms: $gt for accounts and positions, $gte + $nin for ties.
    const resumed = finds.slice(firstPass);
    assert.ok(resumed.some((f) => streamOf(f) === 'positions' && f.filter.accountId.$gt));
    assert.ok(resumed.some((f) => streamOf(f) === 'orders' && f.filter.createdAt.$gte && f.filter._id.$nin));
    for (const [name, r] of Object.entries(evidence)) console.log(`explain ${name}: ${r.plan.join(' > ')} | keys ${r.keys} docs ${r.docs} returned ${r.returned}`);
  });
});

test('real MongoDB: 260 position accounts and 230 order accounts (more than 200) are all evaluated, reconciled and filled exactly once', { skip, timeout: 300000 }, async () => {
  const conn = await fresh();
  await closing(conn, async () => {
    const { db } = conn;
    await ensureTradingIndexes(db, { apply: true });
    const accounts = [];
    for (let i = 0; i < 490; i += 1) {
      const userId = new ObjectId().toHexString();
      const account = await E.ensureAccount(db, { userId, now: START });
      const body = i < 260 ? market() : limitBuy();
      assert.equal((await E.placeOrder(db, { userId, body, now: START })).ok, true);
      accounts.push(String(account._id));
    }
    assert.equal(await db.collection('tradingPositions').countDocuments({ status: 'open' }), 260);
    assert.equal(await db.collection('tradingOrders').countDocuments({ status: 'pending' }), 230);
    assert.equal(await db.collection('tradingAccounts').countDocuments({ evaluatedThrough: { $ne: null } }), 0);

    // Rotation, as the server runs it: one page of 200 per stream per pass.
    const cursor = E.createSweepCursor();
    const passes = [];
    const covered = () => ['positions', 'orders', 'accounts'].every((stream) => passes.some((p) => p.wrapped.includes(stream)));
    do passes.push(await E.sweep(db, { apply: true, now: LATER, cursor }));
    while (!covered() && passes.length < 10);
    assert.equal(passes.length, 3, '490 accounts / 200 per page');
    const evaluated = (await db.collection('tradingAccounts').find({ evaluatedThrough: { $ne: null } }, { projection: { _id: 1 } }).toArray()).map((a) => String(a._id));
    assert.deepEqual(new Set(evaluated), new Set(accounts), 'every account with a position or an order was evaluated');
    assert.equal(passes.reduce((n, p) => n + p.checked, 0), 490, 'every account reconciled once in the rotation');
    assert.deepEqual(passes.flatMap((p) => p.mismatches), []);

    // Trigger all 230 limits after the point already evaluated (LATER); two servers then sweep at once
    // (full passes), and each order must fill exactly once.
    const NEXT = after(120);
    await db.collection('marketQuotes').insertOne(quoteDoc('test-fixture', 'EUR_USD', after(90), '1.09860', '1.09880'));
    const ledgerBefore = await db.collection('tradingLedger').countDocuments({});
    const [a, b] = await Promise.all([E.sweep(db, { apply: true, now: NEXT }), E.sweep(db, { apply: true, now: NEXT })]);
    assert.equal(a.failures.count + b.failures.count, 0, JSON.stringify([a.failures, b.failures]));
    assert.equal(await db.collection('tradingOrders').countDocuments({ status: 'filled' }), 490);
    assert.equal(await db.collection('tradingPositions').countDocuments({}), 490, 'no duplicate position');
    assert.equal(await db.collection('tradingOperations').countDocuments({ type: 'fill', status: 'done' }), 490);
    const ledgerAfter = await db.collection('tradingLedger').countDocuments({});
    const third = await E.sweep(db, { apply: true, now: NEXT });
    assert.deepEqual([third.mismatches, third.checked, await db.collection('tradingLedger').countDocuments({})], [[], 490, ledgerAfter], 'a further pass changes nothing');
    assert.ok(ledgerAfter >= ledgerBefore);
  });
});

test('real MongoDB: recovery reaches 250 stuck orders behind 150 it must leave, and T11 duplicates block --apply without deleting', { skip, timeout: 120000 }, async () => {
  const conn = await fresh({ dataset: false });
  await closing(conn, async () => {
    const { db } = conn;
    await ensureTradingIndexes(db, { apply: true });
    const old = after(-3600);
    await db.collection('tradingOrders').insertMany(Array.from({ length: 150 }, (_, i) => ({ _id: `kept-${i}`, accountId: new ObjectId(), status: 'executing', createdAt: new Date(old.getTime() - 1000) })));
    await db.collection('tradingOperations').insertMany(Array.from({ length: 150 }, (_, i) => ({ _id: `fill:kept-${i}`, type: 'fill', status: 'done', createdAt: old })));
    await db.collection('tradingOrders').insertMany(Array.from({ length: 250 }, (_, i) => ({ _id: `stuck-${i}`, accountId: new ObjectId(), status: 'received', createdAt: old })));
    assert.deepEqual(await E.recoverOperations(db, { now: LATER }), { finished: 0, abandoned: 250 });
    assert.equal(await db.collection('tradingOrders').countDocuments({ status: 'rejected', rejectReason: 'interrupted' }), 250);
    assert.equal(await db.collection('tradingOrders').countDocuments({ status: 'executing' }), 150);
  });

  const dup = await fresh({ dataset: false });
  await closing(dup, async () => {
    const row = { datasetId: 'd', instrument: 'EUR_USD', step: 1 };
    await dup.db.collection('marketCheckpoints').insertMany([{ ...row }, { ...row }]);
    const result = await ensureTradingIndexes(dup.db, { apply: true });
    assert.deepEqual([result.ok, result.built, result.blocked], [false, [], ['T11']]);
    assert.equal(result.report.find((r) => r.id === 'T11').duplicates, 1);
    assert.equal(await dup.db.collection('marketCheckpoints').countDocuments({}), 2, 'nothing deleted');
    assert.deepEqual((await dup.db.collection('marketCheckpoints').indexes()).map((i) => i.name), ['_id_'], 'nothing built');
  });
});
