/**
 * Phase 10 completion, F5: the background sweep and recovery reach every record, not the same first
 * 200 (lib/trading/engine.js sweep, recoverOperations). F4 index definitions, F8 script URIs.
 *
 * In-memory database (no real MongoDB). Positions and orders are made by the real engine
 * (ensureAccount, placeOrder), never hand-built, except stuck orders, which only a crash can leave.
 * Real-server plans and the same coverage on MongoDB: tests/integration/trading-sweep-mongo.test.js.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { ObjectId } = require('mongodb');

const E = require('../lib/trading/engine');
const { TRADING_INDEXES } = require('../lib/trading/indexes');
const { ASSESSMENT_INDEXES } = require('../lib/assessment-indexes');
const { LEARNING_INDEXES } = require('../lib/learning-indexes');
const { paymentMemoryDb } = require('./helpers/payment-memory-db');
const { START, fixtureDataset, quoteDoc } = require('./helpers/trading-fixture');

const ROOT = path.join(__dirname, '..');
const after = (seconds) => new Date(START.getTime() + seconds * 1000);
const LATER = after(60);
let keySeq = 0;
const key = () => `sweep-order-${(keySeq += 1)}-abcdef`;
const market = (extra = {}) => ({ clientOrderId: key(), type: 'market', instrument: 'EUR_USD', side: 'buy', units: '1000', stopLoss: '1.09000', ...extra });
const limitBuy = () => market({ type: 'limit', price: '1.09900', stopLoss: '1.09500' });

function world({ racy = false } = {}) {
  const db = paymentMemoryDb({ racy });
  const dataset = fixtureDataset();
  db.rows('marketDataSets').push(dataset);
  db.rows('marketQuotes').push(quoteDoc(dataset._id, 'EUR_USD', START, '1.10000', '1.10020'));
  return { db, quote: (time, bid, ask) => db.rows('marketQuotes').push(quoteDoc(dataset._id, 'EUR_USD', time, bid, ask)) };
}

/** `count` students, each with an account; `positions(i)` market buys and `pending(i)` limit buys. */
async function populate(x, count, { positions = () => 1, pending = () => 0 } = {}) {
  const accounts = [];
  for (let i = 0; i < count; i += 1) {
    const userId = new ObjectId().toHexString();
    const account = await E.ensureAccount(x.db, { userId, now: START });
    for (let p = 0; p < positions(i); p += 1) assert.equal((await E.placeOrder(x.db, { userId, body: market(), now: START })).order.status, 'filled');
    for (let p = 0; p < pending(i); p += 1) assert.equal((await E.placeOrder(x.db, { userId, body: limitBuy(), now: START })).order.status, 'pending');
    accounts.push({ userId, accountId: account._id });
  }
  return accounts;
}

/**
 * The database with every call observable: the page size of each find, each account evaluation
 * (the evaluatedThrough write that ends evaluateAccount), and an optional failure on one account.
 */
function observed(db) {
  const seen = { limits: [], evaluations: new Map(), failFor: null };
  const wrapCollection = (name, collection) => new Proxy(collection, {
    get(target, prop) {
      const value = target[prop];
      if (prop === 'find') {
        return (...args) => {
          const cursor = value.apply(target, args);
          const limit = cursor.limit;
          cursor.limit = (n) => { seen.limits.push({ name, n }); return limit(n); };
          return cursor;
        };
      }
      if (prop === 'findOne' && name === 'tradingAccounts') {
        return (query, ...rest) => {
          if (seen.failFor && query && String(query._id) === String(seen.failFor)) return Promise.reject(Object.assign(new Error('injected'), { codeName: 'InjectedFailure' }));
          return value.call(target, query, ...rest);
        };
      }
      if (prop === 'updateOne' && name === 'tradingAccounts') {
        return (filter, update, ...rest) => {
          if (update && update.$set && 'evaluatedThrough' in update.$set) {
            const id = String(filter._id);
            seen.evaluations.set(id, (seen.evaluations.get(id) || 0) + 1);
          }
          return value.call(target, filter, update, ...rest);
        };
      }
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const proxy = new Proxy(db, { get: (target, prop) => (prop === 'collection' ? (name) => wrapCollection(name, target.collection(name)) : target[prop]) });
  return { db: proxy, seen };
}

/** Page reads of the swept collections (evaluateAccount's own quote reads are not sweep pages). */
const SWEPT = new Set(['tradingAccounts', 'tradingOperations', 'tradingOrders', 'tradingPositions']);
const sweepPages = (seen) => seen.limits.filter((l) => SWEPT.has(l.name));
const evaluatedIds = (seen) => new Set(seen.evaluations.keys());
const ids = (accounts) => new Set(accounts.map((a) => String(a.accountId)));

test('F5 rotation: 450 accounts (more than 200) are all evaluated and reconciled over passes of 200, not the same first 200', async () => {
  const x = world();
  // Every 7th account has two positions, so pages split one account's positions; 260 also have an order.
  const accounts = await populate(x, 450, { positions: (i) => (i % 7 === 0 ? 2 : 1), pending: (i) => (i < 260 ? 1 : 0) });
  assert.equal(x.db.rows('tradingPositions').length, 450 + 65);
  assert.ok(x.db.rows('tradingAccounts').every((a) => a.evaluatedThrough === null), 'nothing evaluated before the sweep');
  const { db, seen } = observed(x.db);
  const cursor = E.createSweepCursor();

  const first = await E.sweep(db, { apply: true, now: LATER, cursor });
  assert.ok(evaluatedIds(seen).size < 450, 'one pass is bounded');
  assert.equal(first.checked, 200, 'one page of accounts reconciled');
  const passes = [first];
  while (passes.length < 10 && !passes[passes.length - 1].wrapped.includes('positions')) passes.push(await E.sweep(db, { apply: true, now: LATER, cursor }));
  assert.equal(passes.length, 3, 'about 515 positions in pages of 200: three passes');
  assert.deepEqual(evaluatedIds(seen), ids(accounts), 'every account with a position was evaluated');
  assert.equal(passes.reduce((n, r) => n + r.checked, 0), 450, 'every account reconciled exactly once over the rotation');
  assert.ok(passes[2].wrapped.includes('accounts'));
  assert.ok(sweepPages(seen).every((l) => l.n <= E.SWEEP_PAGE), 'no read is larger than one page');
  assert.ok(x.db.rows('tradingAccounts').every((a) => a.evaluatedThrough !== null));
  assert.deepEqual(passes.flatMap((r) => r.mismatches), []);
  assert.equal(passes.reduce((n, r) => n + r.failures.count, 0), 0);

  // The rotation wraps: the next pass starts again at the first account, not where the old cap stopped.
  const before = seen.evaluations.get(String(accounts[0].accountId));
  const wrappedPass = await E.sweep(db, { apply: true, now: LATER, cursor });
  assert.ok(seen.evaluations.get(String(accounts[0].accountId)) > before, 'first account visited again after the wrap');
  assert.equal(wrappedPass.checked, 200);
});

test('F5 full pass (operator script): one call evaluates and reconciles all 450 accounts, 200 rows at a time', async () => {
  const x = world();
  const accounts = await populate(x, 450, { pending: (i) => (i % 3 === 0 ? 1 : 0) });
  const { db, seen } = observed(x.db);
  const report = await E.sweep(db, { apply: true, now: LATER });
  assert.equal(report.evaluated, 450, 'each account evaluated once, though 150 appear in both streams');
  assert.deepEqual(evaluatedIds(seen), ids(accounts));
  assert.ok([...seen.evaluations.values()].every((n) => n === 1), 'never twice in one pass');
  assert.equal(report.checked, 450);
  assert.deepEqual(report.wrapped, ['positions', 'orders', 'accounts']);
  assert.ok(sweepPages(seen).filter((l) => l.name === 'tradingPositions').length >= 3, '450 positions read in pages, not one unbounded read');
  assert.ok(sweepPages(seen).every((l) => l.n <= E.SWEEP_PAGE));
});

test('F5 ties: 230 pending orders created in the same millisecond are each reached once, in pages of 50', async () => {
  const x = world();
  const accounts = await populate(x, 230, { positions: () => 0, pending: () => 1 });
  const created = new Set(x.db.rows('tradingOrders').map((o) => o.createdAt.getTime()));
  assert.equal(created.size, 1, 'every order shares one createdAt: page boundaries fall inside a tie');

  const full = observed(x.db);
  assert.equal((await E.sweep(full.db, { apply: true, now: LATER, limit: 50 })).evaluated, 230);
  assert.deepEqual(evaluatedIds(full.seen), ids(accounts));

  const rotating = observed(x.db);
  const cursor = E.createSweepCursor();
  let passes = 0;
  let report;
  do {
    report = await E.sweep(rotating.db, { apply: true, now: LATER, limit: 50, cursor });
    passes += 1;
    if (!report.wrapped.includes('orders')) assert.ok(cursor.orders.ids.length > 0, 'the tie is carried in the cursor');
  } while (!report.wrapped.includes('orders') && passes < 20);
  assert.equal(passes, 5, '230 orders / 50');
  assert.deepEqual(evaluatedIds(rotating.seen), ids(accounts));
  assert.ok([...rotating.seen.evaluations.values()].every((n) => n === 1), 'no order read twice across the rotation');
});

test('F5 recovery pages past stuck orders it must leave alone, instead of re-reading the same first page', async () => {
  const x = world();
  const old = after(-3600);
  const orders = x.db.rows('tradingOrders');
  const operations = x.db.rows('tradingOperations');
  // 150 older orders whose fill operation exists: recovery leaves them (the operation finishes them).
  for (let i = 0; i < 150; i += 1) {
    const _id = `kept-${i}`;
    orders.push({ _id, accountId: new ObjectId(), status: 'executing', createdAt: new Date(old.getTime() - 1000) });
    operations.push({ _id: `fill:${_id}`, type: 'fill', orderId: _id, status: 'done', createdAt: new Date(old.getTime() - 1000) });
  }
  // 250 newer ones with no operation: nothing happened, so each must end as interrupted.
  for (let i = 0; i < 250; i += 1) orders.push({ _id: `stuck-${i}`, accountId: new ObjectId(), status: 'received', createdAt: old });

  const counts = await E.recoverOperations(x.db, { now: LATER });
  assert.deepEqual(counts, { finished: 0, abandoned: 250 }, 'the old limit of 100 reached none of them');
  assert.ok(orders.filter((o) => o._id.startsWith('stuck-')).every((o) => o.status === 'rejected' && o.rejectReason === 'interrupted'));
  assert.ok(orders.filter((o) => o._id.startsWith('kept-')).every((o) => o.status === 'executing'), 'orders with an operation are untouched');
  assert.deepEqual(await E.recoverOperations(x.db, { now: LATER }), { finished: 0, abandoned: 0 }, 'a second run changes nothing');
});

test('F5 errors: a failing account is reported, the pass carries on, and the rotation retries it', async () => {
  const x = world();
  const accounts = await populate(x, 260);
  const { db, seen } = observed(x.db);
  const bad = accounts[5].accountId;
  seen.failFor = bad;
  const report = await E.sweep(db, { apply: true, now: LATER });
  assert.ok(report.failures.count >= 1);
  assert.ok(report.failures.items.every((f) => f.id && f.stream && f.error === 'InjectedFailure'));
  const others = new Set([...ids(accounts)].filter((id) => id !== String(bad)));
  assert.deepEqual(evaluatedIds(seen), others, 'every account after the failing one was still evaluated');

  seen.failFor = null;
  const retry = await E.sweep(db, { apply: true, now: LATER });
  assert.equal(retry.failures.count, 0);
  assert.ok(seen.evaluations.has(String(bad)), 'retried on the next pass');
});

test('F5 changes between passes: closed, new and deleted records are neither skipped nor processed twice', async () => {
  const x = world();
  const accounts = await populate(x, 120);
  const { db, seen } = observed(x.db);
  const cursor = E.createSweepCursor();
  await E.sweep(db, { apply: true, now: LATER, limit: 50, cursor });
  const boundary = String(cursor.positions.value);
  // The position at the cursor is closed and its row deleted; one account behind the cursor opens a
  // second position; a new student arrives (newest ObjectId, ahead of the cursor).
  const atBoundary = accounts.find((a) => String(a.accountId) === boundary);
  const row = x.db.rows('tradingPositions').find((p) => String(p.accountId) === boundary);
  assert.equal((await E.closePosition(x.db, { userId: atBoundary.userId, positionId: String(row._id), now: after(30) })).ok, true);
  x.db.rows('tradingPositions').splice(x.db.rows('tradingPositions').findIndex((p) => p._id === row._id), 1);
  const behind = accounts[0];
  await E.placeOrder(x.db, { userId: behind.userId, body: market(), now: after(31) });
  const [late] = await populate(x, 1);

  let report;
  let passes = 0;
  do {
    report = await E.sweep(db, { apply: true, now: LATER, limit: 50, cursor });
    passes += 1;
  } while (!report.wrapped.includes('positions') && passes < 10);
  const expected = new Set([...ids(accounts), String(late.accountId)]);
  assert.deepEqual(evaluatedIds(seen), expected, 'the new account and everyone after the deleted row were reached');
  const second = await E.sweep(db, { apply: true, now: LATER, limit: 50, cursor });
  assert.ok(second.evaluated > 0);
  assert.ok(seen.evaluations.get(String(behind.accountId)) >= 2, 'the account behind the cursor is reached again after the wrap');
});

test('F5 idempotent: two overlapping full sweeps fill each of 230 triggered orders exactly once', async () => {
  const x = world({ racy: true });
  const accounts = await populate(x, 230, { positions: () => 0, pending: () => 1 });
  x.quote(after(30), '1.09860', '1.09880'); // ask at or below the 1.09900 limit: every order triggers
  const [a, b] = await Promise.all([E.sweep(x.db, { apply: true, now: LATER }), E.sweep(x.db, { apply: true, now: LATER })]);
  assert.equal(a.failures.count + b.failures.count, 0);
  const positions = x.db.rows('tradingPositions');
  assert.equal(positions.length, 230, 'one position per order, none duplicated');
  assert.deepEqual(new Set(positions.map((p) => String(p.accountId))), ids(accounts));
  assert.ok(x.db.rows('tradingOrders').every((o) => o.status === 'filled'));
  const fills = x.db.rows('tradingOperations').filter((o) => o.type === 'fill');
  assert.equal(fills.length, 230);
  assert.ok(fills.every((o) => o.status === 'done'));
  const ledger = x.db.rows('tradingLedger');
  assert.equal(new Set(ledger.map((r) => r._id)).size, ledger.length, 'no ledger row twice');
  const rows = ledger.length;
  const third = await E.sweep(x.db, { apply: true, now: LATER });
  assert.deepEqual([third.mismatches, x.db.rows('tradingLedger').length, x.db.rows('tradingPositions').length], [[], rows, 230], 'a further pass changes nothing');
});

// ---------------------------------------------------------------------------
// F4 and step 6: index definitions
// ---------------------------------------------------------------------------

test('F4: T17 and T18 serve the sweep and recovery reads; T1-T20, L8/L9 and A1-A7 are all defined', () => {
  assert.deepEqual(TRADING_INDEXES.map((i) => i.id), Array.from({ length: 20 }, (_, i) => `T${i + 1}`));
  const byId = Object.fromEntries(TRADING_INDEXES.map((i) => [i.id, i]));
  assert.deepEqual([byId.T17.collection, byId.T17.key, byId.T17.options], ['tradingPositions', { status: 1, accountId: 1 }, { name: 'trading_position_status_account' }]);
  assert.deepEqual([byId.T18.collection, byId.T18.key, byId.T18.options], ['tradingOrders', { status: 1, createdAt: 1 }, { name: 'trading_order_status_created' }]);
  assert.equal(new Set(TRADING_INDEXES.map((i) => i.options.name)).size, 20, 'names are unique');
  // A unique index must carry a duplicate check whose fields are exactly its key, so the report
  // counts duplicates and --apply refuses, rather than failing part-way with E11000.
  for (const index of TRADING_INDEXES.filter((i) => i.options.unique)) assert.deepEqual(index.duplicateKey, Object.keys(index.key), index.id);
  for (const index of ASSESSMENT_INDEXES.filter((i) => i.options.unique)) assert.deepEqual(index.duplicateKey, Object.keys(index.key), index.id);
  assert.deepEqual(ASSESSMENT_INDEXES.map((i) => i.id), ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7']);
  assert.deepEqual(LEARNING_INDEXES.filter((i) => ['L8', 'L9'].includes(i.id)).map((i) => [i.collection, i.key]), [['learningDays', { userId: 1, day: -1 }], ['learningMinutes', { at: 1 }]]);
  assert.ok(LEARNING_INDEXES.every((i) => !i.options.unique), 'learning indexes are non-unique');

  // The sweep's streams sort on the field that follows the status equality in T17 and T18.
  const source = fs.readFileSync(path.join(ROOT, 'lib/trading/engine.js'), 'utf8');
  assert.match(source, /COLLECTIONS\.positions\), \{ status: 'open' \}, \{ \.\.\.paging, stream: 'positions', field: 'accountId'/);
  assert.match(source, /COLLECTIONS\.orders\), \{ status: 'pending' \}, \{ \.\.\.paging, stream: 'orders', field: 'createdAt'/);
  assert.doesNotMatch(source.slice(source.indexOf('// Recovery and reconciliation')), /\.limit\(limit\)/, 'no fixed cap left in recovery or the sweep');
});

test('step 6: every index script reports by default and builds only with an explicit --apply', () => {
  for (const script of ['trading-indexes', 'learning-indexes', 'assessment-indexes']) {
    const { parseArgs } = require(`../scripts/${script}`);
    const plain = parseArgs(['node', script, '--database', 'Forex_elearning']);
    assert.ok(plain.apply === false || plain.mode === 'plan', `${script}: report mode by default`);
    const applied = parseArgs(['node', script, '--database', 'Forex_elearning', '--apply']);
    assert.ok(applied.apply === true || applied.mode === 'apply', script);
    assert.ok(parseArgs(['node', script]).error, `${script}: needs --database`);
    const source = fs.readFileSync(path.join(ROOT, 'scripts', `${script}.js`), 'utf8');
    assert.doesNotMatch(source, /\.(deleteOne|deleteMany|updateOne|updateMany|insertOne|insertMany|drop)\(/, `${script} never changes documents`);
  }
  for (const file of ['lib/trading/indexes.js', 'lib/assessment-indexes.js']) {
    assert.doesNotMatch(fs.readFileSync(path.join(ROOT, file), 'utf8'), /\.(deleteOne|deleteMany|updateOne|updateMany|dropIndex|drop)\(/, `${file} never deletes duplicates or drops indexes`);
  }
});

// ---------------------------------------------------------------------------
// F8: operator scripts read MONGO_URI or MONGODB_URI
// ---------------------------------------------------------------------------

test('F8: mongoUri resolves like the app: MONGO_URI, else MONGODB_URI, trimmed; empty when neither is set', () => {
  const { MISSING_URI, mongoUri } = require('../scripts/mongo-uri');
  assert.equal(mongoUri({ MONGO_URI: ' mongodb://a ', MONGODB_URI: 'mongodb://b' }), 'mongodb://a');
  assert.equal(mongoUri({ MONGODB_URI: ' mongodb://b ' }), 'mongodb://b');
  // Same resolution as the app (lib/mongodb.js): a set MONGO_URI wins even if blank, so the script
  // refuses rather than silently connecting somewhere the app would not.
  assert.equal(mongoUri({ MONGO_URI: '   ', MONGODB_URI: 'mongodb://b' }), '');
  assert.equal(mongoUri({ MONGO_URI: '', MONGODB_URI: '' }), '');
  assert.equal(mongoUri({}), '');
  assert.equal(MISSING_URI, 'MONGO_URI (or MONGODB_URI) is not set.');
});

test('F8: market-init and trading-retention refuse without a URI, accept MONGODB_URI, and never print it', () => {
  // An empty working directory, so dotenv finds no .env file to fall back on.
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'forexorbit-f8-'));
  const runScript = (script, extraArgs, env) => spawnSync(process.execPath, [path.join(ROOT, 'scripts', script), '--database', 'Forex_elearning_f8_test', ...extraArgs], {
    cwd,
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...env },
    encoding: 'utf8',
    timeout: 20000,
  });
  try {
    for (const [script, extra] of [['market-init.js', ['--start', '2026-09-01T00:00:00Z']], ['trading-retention.js', []]]) {
      const missing = runScript(script, extra, {});
      assert.equal(missing.status, 2, `${script}: ${missing.stderr}`);
      assert.match(missing.stderr, /MONGO_URI \(or MONGODB_URI\) is not set\./);
      // A malformed MONGODB_URI gets past the check (it was read) and fails in the driver before any
      // connection; the value itself is never printed.
      const secret = 'not-a-mongodb-uri-SECRET-f8';
      for (const name of ['MONGODB_URI', 'MONGO_URI']) {
        const bad = runScript(script, extra, { [name]: secret });
        assert.equal(bad.status, 1, `${script} with ${name}: ${bad.stderr}`);
        assert.match(bad.stderr, /failed: MongoParseError/);
        assert.equal(`${bad.stdout}${bad.stderr}`.includes('SECRET-f8'), false, `${script} printed the URI`);
      }
    }
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
