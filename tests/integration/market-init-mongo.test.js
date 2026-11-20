/**
 * Real MongoDB: the production market initialisation (scripts/market-init.js) on a fresh database,
 * its reruns, an interrupted initialisation and a suspended market, then the 15-second server pass
 * moving it forward. Only MONGODB_URI_TEST (tests/helpers/mongo-test-db.js); never production.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { openTestDatabase, testDatabaseConfig } = require('../helpers/mongo-test-db');
const { run: initMarket } = require('../../scripts/market-init');
const S = require('../../lib/market/series');
const H = require('../../lib/market/health');
const D = require('../../lib/trading/market-data');

const config = testDatabaseConfig();
const skip = config.ok ? false : config.reason;
// A Wednesday, inside the trading week; the market starts on the hour about 1,900 hours earlier.
const NOW = new Date('2026-11-18T12:00:07Z');
const ARGS = { id: 'simulated-market-1', start: '2026-09-01T00:00:00Z', now: NOW };
const SIX = ['AUD_USD', 'EUR_USD', 'GBP_USD', 'USD_CAD', 'USD_CHF', 'USD_JPY'];

async function withDb(fn) {
  const conn = await openTestDatabase();
  await conn.reset();
  try {
    await fn(conn.db);
  } finally {
    await conn.reset().catch(() => {});
    await conn.close();
  }
}

const collections = async (db) => (await db.listCollections().toArray()).map((c) => c.name).sort();

test('real MongoDB: market-init on a fresh database: report writes nothing; --apply creates one synthetic market with six instruments, checkpoints, health ACTIVE and live simulated quotes', { skip, timeout: 120000 }, async () => {
  await withDb(async (db) => {
    const logs = [];
    const report = await initMarket(db, { ...ARGS, apply: false, log: (l) => logs.push(l) });
    assert.deepEqual(report, { ok: true, created: false });
    assert.deepEqual(await collections(db), [], 'report mode created nothing');

    const created = await initMarket(db, { ...ARGS, apply: true, log: (l) => logs.push(l) });
    assert.deepEqual(created, { ok: true, created: true, status: 'ACTIVE' });
    const markets = await db.collection('marketDataSets').find({}).toArray();
    assert.equal(markets.length, 1);
    const market = markets[0];
    assert.deepEqual([market._id, market.kind, market.active, [...market.instruments].sort()], ['simulated-market-1', 'synthetic', true, SIX]);
    assert.ok(!logs.join('\n').includes(market.seed), 'the seed is never logged');
    assert.equal(market.startAt.toISOString(), '2026-09-01T00:00:00.000Z');

    const health = await db.collection('marketHealth').findOne({ _id: market._id });
    assert.equal(health.status, 'ACTIVE');
    assert.ok(health.verifiedThrough instanceof Date);
    assert.equal(await db.collection('marketIncidents').countDocuments({}), 0, 'no incident');
    for (const instrument of SIX) {
      assert.ok(await db.collection('marketCheckpoints').countDocuments({ datasetId: market._id, instrument }) > 0, `${instrument}: checkpoints`);
      assert.equal((await S.verifyChain(db, market, instrument)).ok, true, `${instrument}: chain verifies`);
      const quote = await D.latestQuote(db, market, instrument, NOW);
      assert.equal(quote.ok, true, `${instrument}: a quote now (${quote.reason || ''})`);
      assert.ok(quote.quote.bid < quote.quote.ask, `${instrument}: bid below ask`);
    }
    const state = await D.marketState(db, { now: NOW });
    assert.equal(state.open, true, `market open (${state.reason})`);
    assert.match(H.MARKET_LABEL, /SIMULATED MARKET/);
    assert.equal(await db.collection('marketQuotes').countDocuments({}), 0, 'synthetic prices are computed, never stored as imported quotes');
  });
});

test('real MongoDB: market-init reruns are safe: nothing is replaced, a second market is refused', { skip, timeout: 120000 }, async () => {
  await withDb(async (db) => {
    await initMarket(db, { ...ARGS, apply: true, log: () => {} });
    const before = await db.collection('marketDataSets').findOne({});
    const checkpoints = await db.collection('marketCheckpoints').countDocuments({});
    for (const apply of [false, true]) {
      const again = await initMarket(db, { ...ARGS, apply, log: () => {} });
      assert.deepEqual(again, { ok: true, created: false, status: 'ACTIVE' }, `rerun, apply=${apply}`);
    }
    assert.deepEqual(await db.collection('marketDataSets').findOne({}), before, 'the market document (seed included) is unchanged');
    assert.equal(await db.collection('marketCheckpoints').countDocuments({}), checkpoints, 'no duplicate checkpoints at the same time');
    const other = await initMarket(db, { ...ARGS, id: 'simulated-market-2', apply: true, log: () => {} });
    assert.deepEqual([other.ok, /another market is active/.test(other.reason)], [false, true]);
    assert.equal(await db.collection('marketDataSets').countDocuments({}), 1);
    assert.equal((await initMarket(db, { ...ARGS, start: '2026-09-01T00:30:00Z', apply: true, log: () => {} })).ok, false, 'start must be on the hour');
    assert.equal((await initMarket(db, { ...ARGS, start: '2026-12-01T00:00:00Z', apply: true, log: () => {} })).ok, false, 'start must be in the past');
  });
});

test('real MongoDB: an interrupted market-init is reported, not called success, and --apply finishes it; a suspended market is never lifted by it', { skip, timeout: 120000 }, async () => {
  await withDb(async (db) => {
    // The process stopped right after writing the market document: no health, no checkpoints.
    await db.collection('marketDataSets').insertOne({ ...H.newMarket({ id: ARGS.id, startAt: new Date(ARGS.start) }), active: true });
    const report = await initMarket(db, { ...ARGS, apply: false, log: () => {} });
    assert.deepEqual(report, { ok: false, created: false, status: 'INITIALISING' }, 'report mode tells the truth');
    assert.equal(await db.collection('marketHealth').countDocuments({}), 0, 'and writes nothing');
    const finished = await initMarket(db, { ...ARGS, apply: true, log: () => {} });
    assert.deepEqual(finished, { ok: true, created: false, status: 'ACTIVE' });

    const market = await db.collection('marketDataSets').findOne({});
    await H.suspendMarket(db, market, { reason: 'test', now: NOW });
    const suspended = await initMarket(db, { ...ARGS, apply: true, log: () => {} });
    assert.deepEqual([suspended.ok, suspended.status], [false, 'SUSPENDED']);
    assert.equal((await db.collection('marketHealth').findOne({})).status, 'SUSPENDED', 'still suspended: only the Super Admin resumes');
  });
});

test('real MongoDB: the server pass (every 15 s) moves the market forward; a new process continues the same history', { skip, timeout: 120000 }, async () => {
  await withDb(async (db) => {
    await initMarket(db, { ...ARGS, apply: true, log: () => {} });
    const market = await db.collection('marketDataSets').findOne({});
    const first = await D.latestQuote(db, market, 'EUR_USD', NOW);
    let at = NOW;
    for (let i = 0; i < 8; i += 1) {
      at = new Date(at.getTime() + 15000);
      assert.equal((await D.marketTick(db, { now: at })).status, 'ACTIVE');
    }
    const later = await D.latestQuote(db, market, 'EUR_USD', at);
    assert.ok(later.quote.time > first.quote.time, 'quotes progress with time');
    const health = await db.collection('marketHealth').findOne({});
    assert.equal(health.heartbeatAt.getTime(), at.getTime(), 'heartbeat follows the pass');
    // "Restart": a separate connection computes the same quote from the stored checkpoints.
    const other = await openTestDatabase();
    try {
      const again = await D.latestQuote(other.db, market, 'EUR_USD', at);
      assert.deepEqual([again.quote.bid, again.quote.ask, again.quote.time.getTime()], [later.quote.bid, later.quote.ask, later.quote.time.getTime()]);
    } finally {
      await other.close();
    }
    assert.equal(await db.collection('marketIncidents').countDocuments({}), 0);
  });
});
