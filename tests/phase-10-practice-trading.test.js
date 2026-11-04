/**
 * Phase 10: the practice simulator (docs/audits/phase-10-practice-trading.md).
 *
 * Expected values are worked out by hand and written here, never read back from the code. Quotes are
 * TEST-ONLY fixtures (tests/helpers/trading-fixture.js). The in-memory database enforces no Decimal128
 * maths of its own: the engine computes in BigInt either way. Real-server concurrency, persistence
 * and indexes are in tests/integration/trading-phase10-mongo.test.js.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ObjectId } = require('mongodb');

const M = require('../lib/trading/money');
const I = require('../lib/trading/instruments');
const { marketSession } = require('../lib/trading/calendar');
const D = require('../lib/trading/market-data');
const E = require('../lib/trading/engine');
const V = require('../lib/trading/views');
const { parseQuoteCsv, planImport } = require('../lib/trading/import');
const { paymentMemoryDb, yieldTurn } = require('./helpers/payment-memory-db');
const { loadModule, mockResponse } = require('./helpers/ts-loader');
const { requestHeaders, seedSession } = require('./helpers/session-cookie');
const { COOKIE_NAME } = require('../lib/session-core');
const { START, fixtureDataset, quoteDoc } = require('./helpers/trading-fixture');

const ROOT = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const ROUTE_ENV = { NODE_ENV: 'test', APP_ORIGIN: undefined, PORT: undefined, SHARED_RATE_LIMIT: undefined };
const newId = () => new ObjectId().toHexString();
const after = (seconds, from = START) => new Date(from.getTime() + seconds * 1000);
let keySeq = 0;
const key = () => `test-order-${(keySeq += 1)}-abcdef`;

async function withEnv(env, fn) {
  const saved = {};
  for (const name of Object.keys(env)) {
    saved[name] = process.env[name];
    if (env[name] === undefined) delete process.env[name];
    else process.env[name] = env[name];
  }
  try {
    return await fn();
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}
const route = (fn) => () => withEnv(ROUTE_ENV, fn);

/** Simulated time equals the `now` passed in: the dataset's anchor is its own start. */
function world({ racy = false, quotes = true } = {}) {
  const db = paymentMemoryDb({ racy });
  const dataset = fixtureDataset();
  db.rows('marketDataSets').push(dataset);
  const quote = (instrument, time, bid, ask) => db.rows('marketQuotes').push(quoteDoc(dataset._id, instrument, time, bid, ask));
  if (quotes) {
    quote('EUR_USD', START, '1.10000', '1.10020');
    quote('USD_JPY', START, '150.000', '150.020');
    quote('GBP_USD', START, '1.30000', '1.30030');
  }
  const a = newId();
  const b = newId();
  return { db, dataset, quote, a, b };
}

const buy = (extra = {}) => ({ clientOrderId: key(), type: 'market', instrument: 'EUR_USD', side: 'buy', units: '10000', stopLoss: '1.09000', ...extra });
const sell = (extra = {}) => ({ clientOrderId: key(), type: 'market', instrument: 'EUR_USD', side: 'sell', units: '10000', stopLoss: '1.11000', ...extra });
const place = (x, body, userId = x.a, now = START) => E.placeOrder(x.db, { userId, body, now });
const accountOf = (x, userId = x.a) => E.activeAccount(x.db, userId);
const positions = (x) => x.db.rows('tradingPositions');
const ledger = (x) => x.db.rows('tradingLedger');

async function opened(x, body = buy(), now = START) {
  await E.ensureAccount(x.db, { userId: x.a, now });
  const result = await place(x, body, x.a, now);
  assert.equal(result.order.status, 'filled', result.order.rejectReason);
  return x.db.rows('tradingPositions').find((p) => String(p._id) === String(result.order.positionId));
}

// ---------------------------------------------------------------------------
// G1: exact arithmetic
// ---------------------------------------------------------------------------

test('decimals: strings only, exact, and anything that would need rounding is refused', () => {
  assert.equal(M.parseMoney('10000.00'), 1000000n);
  assert.equal(M.parsePrice('1.08125'), 108125n);
  assert.equal(M.parsePrice('149.123'), 14912300n);
  assert.equal(M.parseMoney('-0.01'), -1n);
  assert.equal(M.parseMoney('1.10'), 110n);
  for (const bad of [0.1, 1, null, undefined, '', 'abc', '1e5', '1.2.3', ' 1', '0x10', '1.234']) assert.equal(M.parseMoney(bad), null, String(bad));
  assert.equal(M.parsePrice('1.081259'), null, 'a sixth decimal is refused, not rounded');
  assert.equal(M.parsePrice('1.081250'), 108125n, 'trailing zeros are exact');
  assert.equal(M.formatMoney(1000000n), '10000.00');
  assert.equal(M.formatMoney(-5n), '-0.05');
  assert.equal(M.formatPrice(108125n), '1.08125');
  assert.equal(M.formatPrice(14912300n), '149.12300');
});

test('rounding: half-even, both signs, ties to the even neighbour', () => {
  const cases = [[5n, 10n, 0n], [15n, 10n, 2n], [25n, 10n, 2n], [35n, 10n, 4n], [-5n, 10n, 0n], [-15n, 10n, -2n], [-25n, 10n, -2n], [14n, 10n, 1n], [16n, 10n, 2n], [1n, 3n, 0n], [2n, 3n, 1n], [10n, 5n, 2n]];
  for (const [n, d, want] of cases) assert.equal(M.divideHalfEven(n, d), want, `${n}/${d}`);
  assert.throws(() => M.divideHalfEven(1n, 0n), RangeError);
});

test('no drift: 100,000 postings of 0.10 sum to exactly 10,000.00, where floats do not', () => {
  let exact = 0n;
  let float = 0;
  for (let i = 0; i < 100000; i += 1) {
    exact += M.parseMoney('0.10');
    float += 0.1;
  }
  assert.equal(M.formatMoney(exact), '10000.00');
  assert.notEqual(float, 10000, 'the failure this design avoids');
});

test('pip size and precision per pair', () => {
  assert.equal(I.pipSize(I.INSTRUMENTS.EUR_USD), 10n); // 0.0001
  assert.equal(I.pipSize(I.INSTRUMENTS.USD_JPY), 1000n); // 0.01
  assert.equal(I.priceFitsInstrument(M.parsePrice('149.123'), I.INSTRUMENTS.USD_JPY), true);
  assert.equal(I.priceFitsInstrument(M.parsePrice('149.1234'), I.INSTRUMENTS.USD_JPY), false, 'JPY quotes 3 decimals');
  assert.equal(I.priceFitsInstrument(M.parsePrice('1.08125'), I.INSTRUMENTS.EUR_USD), true);
  assert.equal(Object.keys(I.INSTRUMENTS).sort().join(), 'AUD_USD,EUR_USD,GBP_USD,USD_CAD,USD_CHF,USD_JPY');
  assert.equal(I.instrumentOf('EUR_GBP'), null);
  assert.equal(I.instrumentOf('__proto__'), null);
  assert.equal(I.instrumentOf({ $ne: 1 }), null);
});

test('margin at 1:30, by hand', () => {
  const margin = (id, units, p) => M.formatMoney(I.requiredMargin(I.INSTRUMENTS[id], units, M.parsePrice(p)));
  assert.equal(margin('EUR_USD', 10000n, '1.10000'), '366.67'); // 11,000 / 30 = 366.666...
  assert.equal(margin('EUR_USD', 1000n, '1.20000'), '40.00'); // 1,200 / 30
  assert.equal(margin('USD_JPY', 10000n, '150.000'), '333.33'); // base is USD: 10,000 / 30
  assert.equal(margin('USD_CHF', 3000n, '0.90000'), '100.00'); // 3,000 / 30
});

test('P&L by hand: USD-quoted, USD-based, buy, sell, losses, and a half-even tie', () => {
  const pl = (id, side, units, entry, exit) => M.formatMoney(I.profitLoss({ instrument: I.INSTRUMENTS[id], side, units, entry: M.parsePrice(entry), exit: M.parsePrice(exit) }));
  assert.equal(pl('EUR_USD', 'buy', 10000n, '1.10000', '1.10500'), '50.00'); // 0.005 x 10,000
  assert.equal(pl('EUR_USD', 'sell', 10000n, '1.10000', '1.10500'), '-50.00');
  assert.equal(pl('EUR_USD', 'sell', 10000n, '1.10000', '1.09900'), '10.00');
  assert.equal(pl('USD_JPY', 'buy', 10000n, '150.000', '151.000'), '66.23'); // 10,000 JPY / 151 = 66.2251...
  assert.equal(pl('USD_JPY', 'sell', 10000n, '150.000', '151.000'), '-66.23');
  assert.equal(pl('USD_CHF', 'buy', 10000n, '0.80000', '0.80800'), '99.01'); // 80 CHF / 0.808 = 99.0099...
  assert.equal(pl('EUR_USD', 'buy', 1001n, '1.10000', '1.10005'), '0.05'); // 0.05005 -> 0.05
  assert.equal(pl('EUR_USD', 'buy', 1000n, '1.10000', '1.10001'), '0.01');
  assert.equal(pl('EUR_USD', 'buy', 1250n, '1.10000', '1.10002'), '0.02'); // 0.025 is a tie: to even
  assert.equal(pl('EUR_USD', 'buy', 1750n, '1.10000', '1.10002'), '0.04'); // 0.035 is a tie: to even
});

test('planned risk and account figures, by hand', () => {
  const risk = I.plannedRisk({ instrument: I.INSTRUMENTS.EUR_USD, side: 'buy', units: 10000n, entry: M.parsePrice('1.10020'), stopLoss: M.parsePrice('1.09000') });
  assert.equal(M.formatMoney(risk), '102.00');
  const row = { instrument: 'EUR_USD', side: 'buy', units: 10000n, entry: M.parsePrice('1.10000'), margin: M.parseMoney('366.67') };
  const quote = { bid: M.parsePrice('1.09500'), ask: M.parsePrice('1.09520') };
  const f = I.accountFigures({ balance: M.parseMoney('10000.00'), positions: [row], quotes: { EUR_USD: quote } });
  assert.deepEqual([M.formatMoney(f.unrealized), M.formatMoney(f.equity), M.formatMoney(f.usedMargin), M.formatMoney(f.freeMargin)], ['-50.00', '9950.00', '366.67', '9583.33']);
  assert.equal(M.formatDecimal(f.marginLevel, 2), '2713.61'); // 9,950 / 366.67
  const unknown = I.accountFigures({ balance: 1n, positions: [row], quotes: {} });
  assert.deepEqual([unknown.equity, unknown.freeMargin, unknown.marginLevel], [null, null, null], 'an unknown value stays unknown');
  assert.equal(I.accountFigures({ balance: 100n, positions: [], quotes: {} }).marginLevel, null);
});

// ---------------------------------------------------------------------------
// G2: calendar and market data
// ---------------------------------------------------------------------------

test('calendar: the week follows New York time through daylight saving', () => {
  const open = (t) => marketSession(new Date(t)).open;
  // Winter (EST, UTC-5): 17:00 New York is 22:00 UTC.
  assert.equal(open('2026-01-11T21:59:59Z'), false);
  assert.equal(open('2026-01-11T22:00:00Z'), true);
  assert.equal(open('2026-01-16T21:59:59Z'), true);
  assert.equal(open('2026-01-16T22:00:00Z'), false);
  // Summer (EDT, UTC-4): 17:00 New York is 21:00 UTC.
  assert.equal(open('2026-07-05T20:59:59Z'), false);
  assert.equal(open('2026-07-05T21:00:00Z'), true);
  assert.equal(open('2026-07-10T20:59:59Z'), true);
  assert.equal(open('2026-07-10T21:00:00Z'), false);
  // Clocks change on Sunday 8 March 2026 at 02:00 New York: that evening's open is already EDT.
  assert.equal(open('2026-03-08T20:59:59Z'), false);
  assert.equal(open('2026-03-08T21:00:00Z'), true);
  // Clocks change back on Sunday 1 November 2026: that evening's open is EST.
  assert.equal(open('2026-11-01T21:30:00Z'), false);
  assert.equal(open('2026-11-01T22:00:00Z'), true);
  // Mid-week and all of Saturday.
  assert.equal(open('2026-03-04T12:00:00Z'), true);
  assert.equal(marketSession(new Date('2026-03-07T12:00:00Z')).reason, 'weekend');
});

test('calendar: Christmas and New Year close from 17:00 New York the evening before', () => {
  const at = (t) => marketSession(new Date(t));
  assert.deepEqual([at('2026-12-25T12:00:00Z').open, at('2026-12-25T12:00:00Z').reason, at('2026-12-25T12:00:00Z').holiday], [false, 'holiday', 'Christmas Day']);
  assert.equal(at('2026-12-24T21:59:00Z').open, true, '16:59 New York on the 24th');
  assert.equal(at('2026-12-24T22:00:00Z').open, false, '17:00 New York starts the 25th\'s trading day');
  assert.equal(at('2026-01-01T12:00:00Z').reason, 'holiday');
  assert.equal(at('2026-12-31T22:30:00Z').reason, 'holiday');
  assert.equal(at('2026-07-03T12:00:00Z').open, true, 'other holidays stay open; missing data still suspends');
  assert.equal(marketSession(new Date('nonsense')).open, false);
});

test('the approval gate refuses a dataset missing any fact, and any fixture in production', () => {
  assert.deepEqual(D.datasetProblems(fixtureDataset(), { NODE_ENV: 'test' }), []);
  assert.deepEqual(D.datasetProblems(fixtureDataset(), { NODE_ENV: 'production' }), ['test_fixture_in_production']);
  assert.deepEqual(D.datasetProblems(null), ['missing']);
  const without = (group, field) => {
    const dataset = fixtureDataset();
    dataset[group] = { ...dataset[group], [field]: '' };
    return D.datasetProblems(dataset, { NODE_ENV: 'test' });
  };
  for (const [group, field] of D.REQUIRED_APPROVAL_FIELDS) assert.ok(without(group, field).includes(`${group}.${field}`), `${group}.${field}`);
  assert.ok(D.datasetProblems(fixtureDataset({ approval: { status: 'pending' } }), {}).includes('not_approved'));
  assert.ok(D.datasetProblems(fixtureDataset({ instruments: ['XAU_USD'] }), {}).includes('instruments'));
  assert.ok(D.datasetProblems(fixtureDataset({ endAt: new Date('2025-01-01') }), {}).includes('coverage'));
});

test('quotes: crossed, zero, wide, imprecise and malformed rows are corrupt', () => {
  const ok = (bid, ask, instrument = 'EUR_USD') => D.checkQuote({ instrument, time: START, bid, ask });
  assert.equal(ok('1.10000', '1.10020').ok, true);
  assert.equal(ok('1.10000', '1.10000').ok, true, 'a zero spread is possible');
  assert.equal(ok('1.10020', '1.10000').reason, 'crossed_quote');
  assert.equal(ok('0.00000', '1.10000').reason, 'non_positive_price');
  assert.equal(ok('1.10000', '1.12000').reason, 'spread_too_wide');
  assert.equal(ok('abc', '1.10000').reason, 'invalid_price');
  assert.equal(ok('149.123456', '149.125000', 'USD_JPY').reason, 'invalid_price', 'more decimals than the scale');
  assert.equal(ok('149.1234', '149.1250', 'USD_JPY').reason, 'precision', 'JPY pairs quote 3 decimals');
  assert.equal(D.checkQuote({ instrument: 'XAU_USD', time: START, bid: '1', ask: '2' }).reason, 'unknown_instrument');
  assert.equal(D.checkQuote({ instrument: 'EUR_USD', time: 'nonsense', bid: '1.00000', ask: '1.00010' }).reason, 'invalid_time');
});

test('without an approved dataset trading is suspended; nothing substitutes a price', async () => {
  const x = world();
  x.db.rows('marketDataSets')[0].active = false;
  assert.deepEqual([(await D.marketState(x.db, { now: START })).open, (await D.marketState(x.db, { now: START })).reason], [false, 'no_verified_data']);
  await E.ensureAccount(x.db, { userId: x.a, now: START });
  const result = await place(x, buy());
  assert.deepEqual([result.order.status, result.order.rejectReason], ['rejected', 'no_verified_data']);
  assert.equal(positions(x).length, 0);
  x.db.rows('marketDataSets')[0].active = true;
  x.db.rows('marketDataSets')[0].approval.status = 'withdrawn';
  assert.equal((await D.marketState(x.db, { now: START })).reason, 'no_verified_data', 'withdrawing approval suspends at once');
});

test('fixtures can never run in production, even active and fully filled in', async () => {
  const x = world();
  const state = await D.marketState(x.db, { now: START, env: { NODE_ENV: 'production' } });
  assert.deepEqual([state.open, state.reason, state.dataset], [false, 'no_verified_data', null]);
  await E.ensureAccount(x.db, { userId: x.a, now: START });
  const result = await E.placeOrder(x.db, { userId: x.a, body: buy(), now: START, env: { NODE_ENV: 'production' } });
  assert.equal(result.order.rejectReason, 'no_verified_data');
});

test('missing, stale, corrupt and out-of-session quotes refuse the order and name the reason', async () => {
  const x = world({ quotes: false });
  await E.ensureAccount(x.db, { userId: x.a, now: START });
  assert.equal((await place(x, buy())).order.rejectReason, 'quote_missing');
  x.quote('EUR_USD', after(-121), '1.10000', '1.10020');
  assert.equal((await place(x, buy())).order.rejectReason, 'quote_stale');
  x.quote('EUR_USD', after(-5), '1.10020', '1.10000');
  assert.equal((await place(x, buy())).order.rejectReason, 'quote_corrupt');
  assert.equal(positions(x).length, 0);
  const y = world({ quotes: false });
  await E.ensureAccount(y.db, { userId: y.a, now: START });
  y.quote('EUR_USD', '2026-03-07T11:59:30Z', '1.10000', '1.10020');
  const saturday = await place(y, buy(), y.a, new Date('2026-03-07T12:00:00Z'));
  assert.equal(saturday.order.rejectReason, 'weekend');
  const z = world({ quotes: false });
  await E.ensureAccount(z.db, { userId: z.a, now: START });
  z.quote('EUR_USD', '2026-03-08T20:59:30Z', '1.10000', '1.10020'); // Sunday, before the open
  assert.equal((await place(z, buy(), z.a, new Date('2026-03-08T21:00:10Z'))).order.rejectReason, 'quote_outside_session');
});

test('data outside the dataset window suspends trading', async () => {
  const x = world();
  assert.equal((await D.marketState(x.db, { now: new Date('2027-06-02T12:00:00Z') })).reason, 'data_ended');
  x.db.rows('marketDataSets')[0].replayAnchorAt = new Date('2026-06-01T00:00:00Z');
  assert.equal((await D.marketState(x.db, { now: START })).reason, 'data_not_started');
});

test('imports: the licence facts are mandatory, every row is checked, one bad row refuses the file', () => {
  const header = 'instrument,time,bid,ask\n';
  const manifest = (extra = {}) => ({ ...fixtureDataset(), _id: 'real', testFixture: false, ...extra });
  const env = { NODE_ENV: 'production' };
  const good = planImport({ manifest: manifest(), csvText: `${header}EUR_USD,2026-03-04T12:00:00Z,1.10000,1.10020\n`, env });
  assert.deepEqual([good.ok, good.quotes, good.outsideSession], [true, 1, 0]);
  assert.equal(planImport({ manifest: manifest({ testFixture: true }), csvText: header, env }).ok, false);
  const unlicensed = planImport({ manifest: manifest({ licence: {} }), csvText: header, env });
  assert.ok(unlicensed.errors.some((e) => /redistributionRights/.test(e)));
  assert.ok(planImport({ manifest: manifest({ approval: {} }), csvText: header, env }).errors.some((e) => /not_approved/.test(e)));
  const offset = parseQuoteCsv(`${header}EUR_USD,2026-03-04T12:00:00,1.10000,1.10020\n`);
  assert.match(offset.errors[0], /explicit offset/, 'a time with no offset would be a guess');
  assert.match(parseQuoteCsv(`${header}EUR_USD,2026-03-04T12:00:00Z,1.10020,1.10000\n`).errors[0], /crossed_quote/);
  const twice = `${header}EUR_USD,2026-03-04T12:00:00Z,1.10000,1.10020\nEUR_USD,2026-03-04T12:00:00+00:00,1.10000,1.10020\n`;
  assert.match(parseQuoteCsv(twice).errors[0], /duplicate/);
  assert.equal(parseQuoteCsv('a,b\n').ok, false);
  assert.ok(planImport({ manifest: manifest({ instruments: ['GBP_USD'] }), csvText: `${header}EUR_USD,2026-03-04T12:00:00Z,1.10000,1.10020\n`, env }).errors[0].includes('does not list'));
});

test('no code path can generate a price', () => {
  for (const file of ['lib/trading/money.js', 'lib/trading/instruments.js', 'lib/trading/market-data.js', 'lib/trading/engine.js', 'lib/trading/views.js', 'lib/trading/calendar.js', 'components/TradingInterface.tsx']) {
    assert.doesNotMatch(read(file), /Math\.random|mockPrices/, file);
  }
  assert.doesNotMatch(read('lib/trading/engine.js'), /parseFloat|toFixed|Number\(.*(price|balance|margin)/);
  assert.doesNotMatch(read('lib/trading/instruments.js'), /parseFloat|toFixed/);
});

// ---------------------------------------------------------------------------
// G3: accounts
// ---------------------------------------------------------------------------

test('accounts: USD 10,000 from the server, one per student, with an opening ledger row', async () => {
  const x = world();
  const account = await E.ensureAccount(x.db, { userId: x.a, now: START });
  assert.equal(String(account.balance), '10000.00');
  assert.deepEqual([account.currency, account.status, account.generation, account.version], ['USD', 'active', 1, 0]);
  await E.ensureAccount(x.db, { userId: x.a, now: START });
  assert.equal(x.db.rows('tradingAccounts').length, 1);
  assert.deepEqual([ledger(x).length, ledger(x)[0].type, ledger(x)[0].seq, String(ledger(x)[0].amount)], [1, 'deposit', 1, '10000.00']);
  assert.equal((await E.reconcileAccount(x.db, account._id)).ok, true);
});

test('accounts: parallel creation makes one account', async () => {
  const x = world({ racy: true });
  const results = await Promise.all(Array.from({ length: 8 }, () => E.ensureAccount(x.db, { userId: x.a, now: START })));
  assert.equal(new Set(results.map((r) => String(r._id))).size, 1);
  assert.equal(x.db.rows('tradingAccounts').length, 1);
  assert.equal(ledger(x).length, 1);
});

test('accounts: a crash between slot and account is finished by the next request', async () => {
  const x = world();
  const col = x.db.collection('tradingAccounts');
  const insert = col.insertOne.bind(col);
  col.insertOne = async () => { throw new Error('injected'); };
  await assert.rejects(E.ensureAccount(x.db, { userId: x.a, now: START }));
  col.insertOne = insert;
  const account = await E.ensureAccount(x.db, { userId: x.a, now: START });
  assert.equal(String(account.balance), '10000.00');
  assert.equal(ledger(x).length, 1, 'the opening row was not duplicated');
});

// ---------------------------------------------------------------------------
// G4: market orders, positions
// ---------------------------------------------------------------------------

test('execution: a buy fills at the ask, a sell at the bid; the spread is the cost', async () => {
  const x = world();
  const long = await opened(x, buy());
  assert.equal(String(long.entry), '1.10020');
  assert.equal(String(long.margin), '366.73'); // 11,002 / 30 = 366.7333
  assert.equal(String(long.plannedRisk), '102.00');
  const short = await opened(x, sell({ units: '1000', stopLoss: '1.11000' }));
  assert.equal(String(short.entry), '1.10000');
  const account = await accountOf(x);
  assert.equal(String(account.usedMargin), '403.40'); // 366.73 + 36.67
  assert.equal(String(account.balance), '10000.00', 'opening a position moves no money');
  const view = await V.accountView(x.db, { userId: x.a, now: START });
  // Closing now costs the spread: buy exits at 1.10000 (-2.00), sell exits at 1.10020 (-0.20).
  assert.deepEqual([view.account.unrealizedPl, view.account.equity], ['-2.20', '9997.80']);
  assert.equal(view.account.virtual, true);
});

test('validation: every malformed order is refused before anything is written', async () => {
  const x = world();
  await E.ensureAccount(x.db, { userId: x.a, now: START });
  const cases = [
    { clientOrderId: 'x' }, { clientOrderId: undefined }, { clientOrderId: { $ne: 1 } }, { type: 'trailing' }, { instrument: 'XAU_USD' }, { instrument: { $ne: 1 } },
    { side: 'long' }, { units: 10000 }, { units: '999' }, { units: '-1000' }, { units: '1000.5' }, { units: 'abc' }, { units: '10000001' }, { units: '1e6' },
    { stopLoss: undefined }, { stopLoss: 1.09 }, { stopLoss: 'abc' }, { stopLoss: '-1.00000' }, { stopLoss: '0' }, { takeProfit: 'abc' },
    { type: 'limit', price: undefined }, { type: 'limit', price: '1.09000', expiryHours: 0 }, { type: 'limit', price: '1.09000', expiryHours: 169 }, { type: 'limit', price: '1.09000', expiryHours: 1.5 },
  ];
  for (const extra of cases) {
    const result = await place(x, buy(extra));
    assert.deepEqual([result.ok, result.status], [false, 400], JSON.stringify(extra));
  }
  assert.equal(x.db.rows('tradingOrders').length, 0);
  assert.equal((await place(x, buy({ instrument: 'USD_JPY', stopLoss: '149.1234' }))).ok, false, 'more decimals than the pair quotes');
});

test('stops: a stop-loss is mandatory and must be on the losing side; take-profit on the winning side', async () => {
  const x = world();
  await E.ensureAccount(x.db, { userId: x.a, now: START });
  assert.equal((await place(x, buy({ stopLoss: '1.10100' }))).order.rejectReason, 'invalid_stop_loss');
  assert.equal((await place(x, buy({ takeProfit: '1.10000' }))).order.rejectReason, 'invalid_take_profit');
  assert.equal((await place(x, sell({ stopLoss: '1.09000' }))).order.rejectReason, 'invalid_stop_loss');
  assert.equal((await place(x, sell({ takeProfit: '1.11000' }))).order.rejectReason, 'invalid_take_profit');
});

test('risk: 2% of equity per trade, at the boundary', async () => {
  const x = world();
  await E.ensureAccount(x.db, { userId: x.a, now: START });
  // Entry 1.10020. 10,000 units x 0.0200 = exactly 200.00 = 2% of 10,000: allowed.
  assert.equal((await place(x, buy({ stopLoss: '1.08020' }))).order.status, 'filled');
  // One point further is 200.10: refused.
  const y = world();
  await E.ensureAccount(y.db, { userId: y.a, now: START });
  assert.equal((await place(y, buy({ stopLoss: '1.08019' }))).order.rejectReason, 'risk_per_trade_exceeded');
  assert.equal(y.db.rows('tradingPositions').length, 0);
});

test('risk: 5% of equity across open trades and pending orders', async () => {
  const x = world();
  await E.ensureAccount(x.db, { userId: x.a, now: START });
  assert.equal((await place(x, buy({ stopLoss: '1.08020' }))).order.status, 'filled'); // risk 200.00
  // Equity is now 9,998.00 after 2.00 of spread, so 2% is 199.96 and another 200.00 is refused.
  assert.equal((await place(x, buy({ stopLoss: '1.08020' }))).order.rejectReason, 'risk_per_trade_exceeded');
  assert.equal((await place(x, buy({ stopLoss: '1.08100' }))).order.status, 'filled'); // risk 192.00
  // Equity 9,996.00, so the limit is 5% of that: 499.80. 392.00 is already at risk.
  const equity = (await V.accountView(x.db, { userId: x.a, now: START })).account.equity;
  assert.equal(equity, '9996.00');
  assert.equal((await place(x, buy({ stopLoss: '1.08941' }))).order.rejectReason, 'total_risk_exceeded', '392.00 + 107.90 = 499.90');
  assert.equal((await place(x, buy({ stopLoss: '1.08942' }))).order.status, 'filled', '392.00 + 107.80 = 499.80, exactly the limit');
  // A pending order counts too: the budget is used up (equity 9,994.00, limit 499.70).
  assert.equal((await place(x, buy({ type: 'limit', price: '1.09900', stopLoss: '1.09890', units: '1000' }))).order.rejectReason, 'total_risk_exceeded');
});

test('margin: an order beyond free margin is refused, on the server, by hand', async () => {
  const x = world();
  await E.ensureAccount(x.db, { userId: x.a, now: START });
  // 300,000 units need 11,002.00 of margin; free margin is 10,000.00.
  const big = await place(x, buy({ units: '300000', stopLoss: '1.09990' }));
  assert.equal(big.order.rejectReason, 'insufficient_margin');
  assert.equal(String((await accountOf(x)).usedMargin), '0.00');
});

test('margin call: at or below 100% new orders are blocked', async () => {
  const x = world();
  await E.ensureAccount(x.db, { userId: x.a, now: START });
  // 270,000 units at 1.10020: margin 297,054 / 30 = 9,901.80. Planned risk to 1.09950 is 189.00.
  assert.equal((await place(x, buy({ units: '270000', stopLoss: '1.09950' }))).order.status, 'filled');
  x.quote('EUR_USD', after(30), '1.09960', '1.09980');
  await E.evaluateAccount(x.db, (await accountOf(x))._id, { now: after(30) });
  const view = await V.accountView(x.db, { userId: x.a, now: after(30) });
  // Equity = 10,000 + (1.09960 - 1.10020) x 270,000 = 9,838.00. 9,838 / 9,901.80 = 99.3557%.
  assert.deepEqual([view.account.equity, view.account.marginLevel, view.account.marginCall], ['9838.00', '99.36', true]);
  assert.equal((await accountOf(x)).marginCall, true);
  const blocked = await place(x, buy({ units: '1000', stopLoss: '1.09000' }), x.a, after(30));
  assert.equal(blocked.order.rejectReason, 'margin_call');
});

test('idempotency: a repeat returns the same order and executes nothing; a reused key is refused', async () => {
  const x = world();
  await E.ensureAccount(x.db, { userId: x.a, now: START });
  const body = buy();
  const first = await place(x, body);
  const second = await place(x, body);
  assert.equal(second.repeated, true);
  assert.equal(String(second.order._id), String(first.order._id));
  assert.equal(positions(x).length, 1);
  assert.equal(String((await accountOf(x)).usedMargin), '366.73');
  const conflict = await place(x, { ...body, units: '20000' });
  assert.deepEqual([conflict.status, conflict.code], [409, 'idempotency_conflict']);
});

test('concurrency: parallel identical requests fill once', async () => {
  const x = world({ racy: true });
  await E.ensureAccount(x.db, { userId: x.a, now: START });
  const body = buy();
  await Promise.all(Array.from({ length: 10 }, () => place(x, body)));
  assert.equal(positions(x).length, 1);
  assert.equal(String((await accountOf(x)).usedMargin), '366.73');
});

test('concurrency: parallel different orders cannot spend the same margin', async () => {
  const x = world({ racy: true });
  await E.ensureAccount(x.db, { userId: x.a, now: START });
  // Each needs 5,501.00 of margin, 150,000 units; only one fits in 10,000.00.
  const results = await Promise.all(Array.from({ length: 8 }, () => place(x, buy({ units: '150000', stopLoss: '1.09950' }))));
  assert.equal(results.filter((r) => r.order.status === 'filled').length, 1);
  assert.equal(positions(x).length, 1);
  assert.equal((await E.reconcileAccount(x.db, (await accountOf(x))._id)).ok, true);
});

// ---------------------------------------------------------------------------
// Closing, stop-loss, take-profit, pending orders
// ---------------------------------------------------------------------------

test('close: P&L reaches the balance through one ledger row; the position keeps its record', async () => {
  const x = world();
  const position = await opened(x);
  x.quote('EUR_USD', after(30), '1.10520', '1.10540');
  const closed = await E.closePosition(x.db, { userId: x.a, positionId: String(position._id), now: after(30) });
  assert.equal(closed.ok, true);
  const account = await accountOf(x);
  assert.deepEqual([String(account.balance), String(account.usedMargin), account.closedTrades, account.ledgerSeq], ['10050.00', '0.00', 1, 2]); // (1.10520 - 1.10020) x 10,000
  const row = ledger(x).find((l) => l.seq === 2);
  assert.deepEqual([row.type, String(row.amount), String(row.balanceAfter), row.reference], ['realized_pnl', '50.00', '10050.00', 'manual']);
  assert.deepEqual([closed.position.status, String(closed.position.exit), String(closed.position.realizedPl)], ['closed', '1.10520', '50.00']);
  assert.equal((await E.reconcileAccount(x.db, account._id)).ok, true);
});

test('close: repeated and concurrent closes settle once', async () => {
  const x = world({ racy: true });
  const position = await opened(x);
  x.quote('EUR_USD', after(30), '1.10520', '1.10540');
  await Promise.all(Array.from({ length: 10 }, () => E.closePosition(x.db, { userId: x.a, positionId: String(position._id), now: after(30) })));
  const again = await E.closePosition(x.db, { userId: x.a, positionId: String(position._id), now: after(30) });
  assert.equal(again.alreadyClosed, true);
  const account = await accountOf(x);
  assert.deepEqual([String(account.balance), account.closedTrades, ledger(x).length], ['10050.00', 1, 2]);
});

test('close: refused with no fresh price or a closed market, and the position stays open', async () => {
  const x = world();
  const position = await opened(x);
  const late = await E.closePosition(x.db, { userId: x.a, positionId: String(position._id), now: after(500) });
  assert.deepEqual([late.status, late.code], [409, 'quote_stale']);
  const weekend = await E.closePosition(x.db, { userId: x.a, positionId: String(position._id), now: new Date('2026-03-07T12:00:00Z') });
  assert.equal(weekend.code, 'weekend');
  assert.equal(positions(x)[0].status, 'open');
});

test('stop-loss and take-profit use the correct side: a long watches the bid, a short the ask', async () => {
  // Long: the ask touches the stop but the bid does not -> no trigger... then the bid does.
  const x = world();
  await opened(x, buy({ stopLoss: '1.09900', takeProfit: '1.10500' }));
  const id = (await accountOf(x))._id;
  x.quote('EUR_USD', after(10), '1.09910', '1.09900');
  x.db.rows('marketQuotes').pop(); // (crossed rows are corrupt; use a valid one)
  x.quote('EUR_USD', after(10), '1.09901', '1.09921');
  await E.evaluateAccount(x.db, id, { now: after(10) });
  assert.equal(positions(x)[0].status, 'open', 'bid 1.09901 is above the stop');
  x.quote('EUR_USD', after(20), '1.09900', '1.09920');
  await E.evaluateAccount(x.db, id, { now: after(20) });
  assert.deepEqual([positions(x)[0].status, positions(x)[0].closeReason, String(positions(x)[0].exit)], ['closed', 'stop_loss', '1.09900']);
  assert.equal(String(positions(x)[0].realizedPl), '-12.00'); // (1.09900 - 1.10020) x 10,000

  // Short: the bid crosses the stop level first but only the ask counts.
  const y = world();
  await opened(y, sell({ stopLoss: '1.10100', takeProfit: '1.09500' }));
  const short = (await accountOf(y))._id;
  y.quote('EUR_USD', after(10), '1.10090', '1.10099');
  await E.evaluateAccount(y.db, short, { now: after(10) });
  assert.equal(positions(y)[0].status, 'open', 'ask 1.10099 is below the stop');
  y.quote('EUR_USD', after(20), '1.10085', '1.10100');
  await E.evaluateAccount(y.db, short, { now: after(20) });
  assert.deepEqual([positions(y)[0].closeReason, String(positions(y)[0].exit), String(positions(y)[0].realizedPl)], ['stop_loss', '1.10100', '-10.00']);

  // Take-profit on each side.
  const z = world();
  await opened(z, buy({ stopLoss: '1.09900', takeProfit: '1.10500' }));
  z.quote('EUR_USD', after(10), '1.10500', '1.10520');
  await E.evaluateAccount(z.db, (await accountOf(z))._id, { now: after(10) });
  assert.deepEqual([positions(z)[0].closeReason, String(positions(z)[0].realizedPl)], ['take_profit', '48.00']);
  const w = world();
  await opened(w, sell({ stopLoss: '1.10100', takeProfit: '1.09500' }));
  w.quote('EUR_USD', after(10), '1.09480', '1.09500');
  await E.evaluateAccount(w.db, (await accountOf(w))._id, { now: after(10) });
  assert.deepEqual([positions(w)[0].closeReason, String(positions(w)[0].realizedPl)], ['take_profit', '50.00']);
});

test('a gap fills at the recorded price, not the stop level: nothing is invented', async () => {
  const x = world();
  await opened(x, buy({ stopLoss: '1.09900' }));
  x.quote('EUR_USD', after(10), '1.09500', '1.09520');
  await E.evaluateAccount(x.db, (await accountOf(x))._id, { now: after(10) });
  assert.deepEqual([String(positions(x)[0].exit), String(positions(x)[0].realizedPl)], ['1.09500', '-52.00']);
});

test('evaluation walks every recorded quote: a stop hit and recovered between two requests still fires', async () => {
  const x = world();
  await opened(x, buy({ stopLoss: '1.09900' }));
  x.quote('EUR_USD', after(10), '1.09890', '1.09910');
  x.quote('EUR_USD', after(20), '1.10500', '1.10520');
  await E.evaluateAccount(x.db, (await accountOf(x))._id, { now: after(30) });
  assert.deepEqual([positions(x)[0].status, String(positions(x)[0].exit)], ['closed', '1.09890']);
  await E.evaluateAccount(x.db, (await accountOf(x))._id, { now: after(30) });
  assert.equal(ledger(x).length, 2, 'evaluating again changes nothing');
});

test('evaluation ignores corrupt rows and quotes from a closed session', async () => {
  const x = world();
  await opened(x, buy({ stopLoss: '1.09900' }));
  x.quote('EUR_USD', after(10), '1.09000', '1.08000'); // crossed
  x.quote('EUR_USD', '2026-03-07T12:00:00Z', '1.09000', '1.09020'); // Saturday
  await E.evaluateAccount(x.db, (await accountOf(x))._id, { now: new Date('2026-03-07T12:00:10Z') });
  assert.equal(positions(x)[0].status, 'open');
});

test('pending: limits and stops trigger on the correct side and fill at the recorded price', async () => {
  const x = world();
  await E.ensureAccount(x.db, { userId: x.a, now: START });
  const limit = await place(x, buy({ type: 'limit', price: '1.09900', stopLoss: '1.09500' }));
  assert.equal(limit.order.status, 'pending');
  const stop = await place(x, buy({ type: 'stop', price: '1.10500', stopLoss: '1.10000' }));
  assert.equal(stop.order.status, 'pending');
  assert.equal(String((await accountOf(x)).usedMargin), '0.00', 'pending orders hold no margin');
  const id = (await accountOf(x))._id;
  x.quote('EUR_USD', after(10), '1.09890', '1.09910');
  await E.evaluateAccount(x.db, id, { now: after(10) });
  assert.equal(positions(x).length, 0, 'ask 1.09910 is above the limit');
  x.quote('EUR_USD', after(20), '1.09880', '1.09900');
  await E.evaluateAccount(x.db, id, { now: after(20) });
  assert.deepEqual([positions(x).length, String(positions(x)[0].entry)], [1, '1.09900']);
  x.quote('EUR_USD', after(30), '1.10490', '1.10510');
  await E.evaluateAccount(x.db, id, { now: after(30) });
  assert.deepEqual([positions(x).length, String(positions(x)[1].entry)], [2, '1.10510'], 'a stop fills at the recorded ask, past its level');
  assert.equal(x.db.rows('tradingOrders').filter((o) => o.status === 'filled').length, 2);
});

test('pending: a price on the wrong side of the market is refused', async () => {
  const x = world();
  await E.ensureAccount(x.db, { userId: x.a, now: START });
  assert.equal((await place(x, buy({ type: 'limit', price: '1.10100', stopLoss: '1.09000' }))).order.rejectReason, 'invalid_order_price');
  assert.equal((await place(x, buy({ type: 'stop', price: '1.10000', stopLoss: '1.09000' }))).order.rejectReason, 'invalid_order_price');
  assert.equal((await place(x, sell({ type: 'limit', price: '1.09900', stopLoss: '1.11000' }))).order.rejectReason, 'invalid_order_price');
  assert.equal((await place(x, sell({ type: 'stop', price: '1.10100', stopLoss: '1.11000' }))).order.rejectReason, 'invalid_order_price');
});

test('pending: expiry is explicit and happens even with no quote; cancel works once, for the owner', async () => {
  const x = world();
  await E.ensureAccount(x.db, { userId: x.a, now: START });
  const expiring = await place(x, buy({ type: 'limit', price: '1.09900', stopLoss: '1.09500', expiryHours: 1 }));
  assert.deepEqual(new Date(expiring.order.expiresSimAt), after(3600));
  await E.evaluateAccount(x.db, (await accountOf(x))._id, { now: after(3599) });
  assert.equal(x.db.rows('tradingOrders')[0].status, 'pending');
  await E.evaluateAccount(x.db, (await accountOf(x))._id, { now: after(3600) });
  assert.equal(x.db.rows('tradingOrders')[0].status, 'expired');

  const y = world();
  await E.ensureAccount(y.db, { userId: y.a, now: START });
  await E.ensureAccount(y.db, { userId: y.b, now: START });
  const order = (await place(y, buy({ type: 'limit', price: '1.09900', stopLoss: '1.09500' }))).order;
  const other = await E.cancelOrder(y.db, { userId: y.b, orderId: String(order._id), now: START });
  assert.deepEqual([other.status, other.code], [404, 'order_not_found'], 'another student\'s order does not exist for them');
  assert.equal((await E.cancelOrder(y.db, { userId: y.a, orderId: String(order._id), now: START })).order.status, 'cancelled');
  assert.equal((await E.cancelOrder(y.db, { userId: y.a, orderId: String(order._id), now: START })).code, 'order_not_pending');
  assert.equal((await E.cancelOrder(y.db, { userId: y.a, orderId: 'nonsense', now: START })).status, 404);
  y.quote('EUR_USD', after(10), '1.09880', '1.09900');
  await E.evaluateAccount(y.db, (await accountOf(y))._id, { now: after(10) });
  assert.equal(y.db.rows('tradingPositions').length, 0, 'a cancelled order never fills');
});

test('pending: concurrent evaluation fills once; a fill failing the rules is rejected with its reason', async () => {
  const x = world({ racy: true });
  await E.ensureAccount(x.db, { userId: x.a, now: START });
  await place(x, buy({ type: 'limit', price: '1.09900', stopLoss: '1.09500' }));
  x.quote('EUR_USD', after(10), '1.09880', '1.09900');
  const id = (await accountOf(x))._id;
  await Promise.all(Array.from({ length: 6 }, () => E.evaluateAccount(x.db, id, { now: after(10) })));
  assert.equal(positions(x).length, 1);
  assert.equal(String((await accountOf(x)).usedMargin), '366.33'); // 10,990 / 30

  const y = world();
  await E.ensureAccount(y.db, { userId: y.a, now: START });
  await place(y, buy({ type: 'limit', price: '1.09900', stopLoss: '1.09500', units: '250000' })); // margin 9,158.33; risk 1,000 -> refused
  assert.equal(y.db.rows('tradingOrders')[0].rejectReason, 'risk_per_trade_exceeded');
});

test('modify: the stop can move within the limits, never disappear, only for the owner', async () => {
  const x = world();
  const position = await opened(x, buy({ stopLoss: '1.09900' }));
  await E.ensureAccount(x.db, { userId: x.b, now: START });
  const id = String(position._id);
  const modify = (body, userId = x.a) => E.modifyPosition(x.db, { userId, positionId: id, body, now: START });
  assert.equal((await modify({ stopLoss: '1.09950', takeProfit: '1.10500' })).ok, true);
  assert.equal(String(positions(x)[0].plannedRisk), '7.00'); // (1.10020 - 1.09950) x 10,000
  assert.equal((await modify({ takeProfit: '1.10500' })).code, 'invalid_stop_loss');
  assert.equal((await modify({ stopLoss: '1.10500' })).code, 'invalid_stop_loss', 'above the bid');
  assert.equal((await modify({ stopLoss: '1.07000' })).code, 'risk_per_trade_exceeded');
  assert.equal((await modify({ stopLoss: '1.09950' }, x.b)).status, 404);
});

test('stop-out: at or below 50% the largest loser closes first, until the level recovers', async () => {
  const x = world();
  await E.ensureAccount(x.db, { userId: x.a, now: START });
  await place(x, buy({ units: '100000', stopLoss: '1.09900' }));
  await place(x, { clientOrderId: key(), type: 'market', instrument: 'GBP_USD', side: 'buy', units: '10000', stopLoss: '1.29900' });
  // Direct edit: a stop far away would break the 2% rule, so stop-outs can only be reached this way
  // or by a gap past several stops at once. The test widens the stops to exercise the safety net.
  for (const row of positions(x)) row.stopLoss = require('mongodb').Decimal128.fromString('0.50000');
  x.quote('GBP_USD', after(10), '1.29900', '1.29930');
  x.quote('EUR_USD', after(10), '1.03000', '1.03020');
  await E.evaluateAccount(x.db, (await accountOf(x))._id, { now: after(10) });
  // EUR loss 7,020.00; GBP loss 13.00. Equity 2,967; used 3,667.33 + 433.43 = 4,100.76: 72%?
  const eur = positions(x).find((p) => p.instrument === 'EUR_USD');
  assert.equal(eur.status, 'open', 'above 50%: margin call only');
  assert.equal((await accountOf(x)).marginCall, true);
  x.quote('EUR_USD', after(20), '1.01000', '1.01020');
  await E.evaluateAccount(x.db, (await accountOf(x))._id, { now: after(20) });
  // EUR loss 9,020.00: equity 967.00, level 23.58%: stop out EUR, the largest loser, at the bid.
  const closed = positions(x).find((p) => p.instrument === 'EUR_USD');
  assert.deepEqual([closed.status, closed.closeReason, String(closed.exit), String(closed.realizedPl)], ['closed', 'stop_out', '1.01000', '-9020.00']);
  assert.equal(positions(x).find((p) => p.instrument === 'GBP_USD').status, 'open', 'the level recovered, so the other position stays');
  const account = await accountOf(x);
  assert.equal(String(account.balance), '980.00');
  assert.equal((await E.reconcileAccount(x.db, account._id)).ok, true);
});

// ---------------------------------------------------------------------------
// G6: recovery and reconciliation
// ---------------------------------------------------------------------------

function failing(db, name, method, nth = 1) {
  const col = db.collection(name);
  const original = col[method].bind(col);
  let calls = 0;
  col[method] = async (...args) => {
    calls += 1;
    if (calls === nth) throw new Error(`injected ${name}.${method}`);
    return original(...args);
  };
  return () => { col[method] = original; };
}
const later = after(600);

const FILL_STEPS = [
  ['the operation record', 'tradingOperations', 'updateOne', 1, 0],
  ['the account update', 'tradingAccounts', 'updateOne', 1, 0],
  ['the position insert', 'tradingPositions', 'insertOne', 1, 1],
  ['the order update', 'tradingOrders', 'updateOne', 2, 1],
  ['the operation finish', 'tradingOperations', 'updateOne', 2, 1],
  ['clearing the applied mark', 'tradingAccounts', 'updateOne', 2, 1],
];
for (const [label, name, method, nth, positionsAfter] of FILL_STEPS) {
  test(`recovery: a crash at ${label} during a fill leaves one consistent outcome`, async () => {
    const x = world();
    await E.ensureAccount(x.db, { userId: x.a, now: START });
    const restore = failing(x.db, name, method, nth);
    await assert.rejects(place(x, buy()));
    restore();
    await E.recoverOperations(x.db, { now: later });
    const account = await accountOf(x);
    assert.equal(positions(x).length, positionsAfter);
    assert.equal(String(account.usedMargin), positionsAfter ? '366.73' : '0.00');
    assert.deepEqual(account.applied, {});
    assert.equal(x.db.rows('tradingOrders')[0].status, positionsAfter ? 'filled' : 'rejected');
    assert.equal((await E.reconcileAccount(x.db, account._id)).ok, true);
  });
}

const CLOSE_STEPS = [
  ['the account update', 'tradingAccounts', 'updateOne', 1],
  ['the ledger insert', 'tradingLedger', 'insertOne', 1],
  ['the position update', 'tradingPositions', 'updateOne', 1],
  ['the operation finish', 'tradingOperations', 'updateOne', 1],
  ['clearing the applied mark', 'tradingAccounts', 'updateOne', 2],
];
for (const [label, name, method, nth] of CLOSE_STEPS) {
  test(`recovery: a crash at ${label} during a close finishes exactly once`, async () => {
    const x = world();
    const position = await opened(x);
    x.quote('EUR_USD', after(30), '1.10520', '1.10540');
    const restore = failing(x.db, name, method, nth);
    await assert.rejects(E.closePosition(x.db, { userId: x.a, positionId: String(position._id), now: after(30) }));
    restore();
    await E.recoverOperations(x.db, { now: later });
    const account = await accountOf(x);
    assert.deepEqual([String(account.balance), String(account.usedMargin), account.ledgerSeq, ledger(x).length, positions(x)[0].status], ['10050.00', '0.00', 2, 2, 'closed']);
    assert.deepEqual(account.applied, {});
    assert.equal((await E.reconcileAccount(x.db, account._id)).ok, true);
    await E.recoverOperations(x.db, { now: later });
    assert.equal(String((await accountOf(x)).balance), '10050.00', 'recovering again changes nothing');
  });
}

test('recovery: a retry after a crash returns the stored outcome instead of trading again', async () => {
  const x = world();
  await E.ensureAccount(x.db, { userId: x.a, now: START });
  const body = buy();
  const restore = failing(x.db, 'tradingPositions', 'insertOne');
  await assert.rejects(place(x, body));
  restore();
  const retry = await place(x, body);
  assert.equal(retry.repeated, true, 'the key still identifies the order');
  await E.recoverOperations(x.db, { now: later });
  assert.equal(positions(x).length, 1);
  assert.equal(String((await accountOf(x)).usedMargin), '366.73');
});

test('recovery: orders stopped before any operation existed end as interrupted, with nothing charged', async () => {
  const x = world();
  await E.ensureAccount(x.db, { userId: x.a, now: START });
  const restore = failing(x.db, 'marketDataSets', 'findOne');
  await assert.rejects(place(x, buy()));
  restore();
  assert.equal(x.db.rows('tradingOrders')[0].status, 'received');
  await E.recoverOperations(x.db, { now: later });
  assert.deepEqual([x.db.rows('tradingOrders')[0].status, x.db.rows('tradingOrders')[0].rejectReason], ['rejected', 'interrupted']);
});

test('recovery does not touch work that may still be running', async () => {
  const x = world();
  await E.ensureAccount(x.db, { userId: x.a, now: START });
  const restore = failing(x.db, 'tradingAccounts', 'updateOne');
  await assert.rejects(place(x, buy()));
  restore();
  const counts = await E.recoverOperations(x.db, { now: after(10) });
  assert.deepEqual(counts, { finished: 0, abandoned: 0 });
});

test('reconciliation detects tampering and reports it; it never rewrites anything', async () => {
  const x = world();
  const position = await opened(x);
  x.quote('EUR_USD', after(30), '1.10520', '1.10540');
  await E.closePosition(x.db, { userId: x.a, positionId: String(position._id), now: after(30) });
  const account = await accountOf(x);
  const row = x.db.rows('tradingAccounts')[0];
  const original = row.balance;
  row.balance = require('mongodb').Decimal128.fromString('99999.00');
  const report = await E.reconcileAccount(x.db, account._id);
  assert.deepEqual([report.ok, report.problems], [false, ['balance_differs_from_ledger']]);
  const swept = await E.sweep(x.db, { apply: true, now: later });
  assert.equal(swept.mismatches.length, 1);
  assert.equal(String(row.balance), '99999.00', 'reported, not repaired');
  row.balance = original;
  ledger(x)[1].amount = require('mongodb').Decimal128.fromString('1.00');
  assert.ok((await E.reconcileAccount(x.db, account._id)).problems.includes('ledger_balance_at_2'));
  ledger(x).splice(0, 1);
  assert.ok((await E.reconcileAccount(x.db, account._id)).problems.some((p) => p.startsWith('ledger_gap')));
});

test('the ledger is append-only in the code and in the role', () => {
  const source = read('lib/trading/engine.js');
  assert.doesNotMatch(source, /COLLECTIONS\.ledger\)\.(update|delete|replace|findOneAnd)/);
  const { APPEND_ONLY_COLLECTIONS, READ_WRITE_COLLECTIONS } = require('../lib/app-database-role');
  assert.ok(APPEND_ONLY_COLLECTIONS.includes('tradingLedger'));
  assert.equal(READ_WRITE_COLLECTIONS.includes('tradingLedger'), false);
  for (const name of ['marketDataSets', 'marketQuotes', 'tradingAccountSlots', 'tradingAccounts', 'tradingOperations', 'tradingOrders', 'tradingPositions']) assert.ok(READ_WRITE_COLLECTIONS.includes(name), name);
});

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

test('reset: a fresh USD 10,000; the old account and all its history stay', async () => {
  const x = world();
  const position = await opened(x);
  x.quote('EUR_USD', after(30), '1.09900', '1.09920');
  await E.closePosition(x.db, { userId: x.a, positionId: String(position._id), now: after(30) });
  const oldAccount = await accountOf(x);
  assert.equal(String(oldAccount.balance), '9988.00');
  const reset = await E.resetAccount(x.db, { userId: x.a, now: after(40) });
  assert.equal(reset.ok, true);
  const fresh = await accountOf(x);
  assert.notEqual(String(fresh._id), String(oldAccount._id));
  assert.deepEqual([String(fresh.balance), fresh.generation], ['10000.00', 2]);
  const archived = x.db.rows('tradingAccounts').find((a) => String(a._id) === String(oldAccount._id));
  assert.deepEqual([archived.status, String(archived.balance)], ['archived', '9988.00']);
  assert.equal(ledger(x).filter((l) => String(l.accountId) === String(oldAccount._id)).length, 2);
  assert.equal(positions(x).length, 1, 'closed positions remain');
  assert.equal((await E.reconcileAccount(x.db, oldAccount._id)).ok, true);
  assert.equal((await E.reconcileAccount(x.db, fresh._id)).ok, true);
});

test('reset: once per 30 days, measured exactly; open positions block it; pending orders are cancelled', async () => {
  const x = world();
  await E.ensureAccount(x.db, { userId: x.a, now: START });
  await E.resetAccount(x.db, { userId: x.a, now: START });
  const soon = await E.resetAccount(x.db, { userId: x.a, now: new Date(START.getTime() + E.RESET_INTERVAL_MS - 1) });
  assert.deepEqual([soon.code, soon.nextResetAt], ['reset_too_soon', new Date(START.getTime() + E.RESET_INTERVAL_MS).toISOString()]);
  assert.equal((await E.resetAccount(x.db, { userId: x.a, now: new Date(START.getTime() + E.RESET_INTERVAL_MS) })).ok, true);

  const y = world();
  await opened(y);
  assert.equal((await E.resetAccount(y.db, { userId: y.a, now: START })).code, 'positions_open');
  const z = world();
  await E.ensureAccount(z.db, { userId: z.a, now: START });
  await place(z, buy({ type: 'limit', price: '1.09900', stopLoss: '1.09500' }));
  await E.resetAccount(z.db, { userId: z.a, now: START });
  assert.deepEqual([z.db.rows('tradingOrders')[0].status, z.db.rows('tradingOrders')[0].cancelReason], ['cancelled', 'account_reset']);
  assert.equal((await E.resetAccount(z.db, { userId: z.b, now: START })).status, 404);
});

test('reset: a crash mid-way finishes on recovery; parallel resets make one new account', async () => {
  const x = world();
  await E.ensureAccount(x.db, { userId: x.a, now: START });
  const restore = failing(x.db, 'tradingAccountSlots', 'updateOne');
  await assert.rejects(E.resetAccount(x.db, { userId: x.a, now: START }));
  restore();
  await E.recoverOperations(x.db, { now: later });
  assert.deepEqual([(await accountOf(x)).generation, x.db.rows('tradingAccounts').length], [2, 2]);

  const y = world({ racy: true });
  await E.ensureAccount(y.db, { userId: y.a, now: START });
  await Promise.all(Array.from({ length: 6 }, () => E.resetAccount(y.db, { userId: y.a, now: START })));
  assert.equal(y.db.rows('tradingAccounts').length, 2);
  assert.equal((await accountOf(y)).generation, 2);
});

test('reset: an order racing a reset cannot land on the archived account', async () => {
  const x = world();
  await E.ensureAccount(x.db, { userId: x.a, now: START });
  const account = await accountOf(x);
  const col = x.db.collection('tradingAccounts');
  const update = col.updateOne.bind(col);
  let raced = false;
  col.updateOne = async (filter, ...rest) => {
    if (!raced) {
      raced = true;
      await E.resetAccount(x.db, { userId: x.a, now: START });
    }
    return update(filter, ...rest);
  };
  const result = await place(x, buy());
  assert.equal(result.order.status, 'rejected');
  col.updateOne = update;
  assert.equal(positions(x).length, 0);
  assert.equal((await E.reconcileAccount(x.db, account._id)).ok, true);
});

// ---------------------------------------------------------------------------
// Routes: authentication, authorization, CSRF, validation, rate limits, privacy
// ---------------------------------------------------------------------------

function routes(x) {
  const stubs = { 'lib/mongodb': { getDb: async () => x.db } };
  const load = (file) => loadModule(`pages/api/trading/${file}`, stubs).default;
  const users = { student: x.a, other: x.b, instructor: newId() };
  for (const [name, id] of Object.entries(users)) x.db.rows('users').push({ _id: new ObjectId(id), email: `${name}@example.test`, name, role: name === 'instructor' ? 'instructor' : 'student', status: 'approved', sessionGeneration: 0 });
  const T = {};
  for (const [name, id] of Object.entries(users)) T[name] = seedSession(x.db.rows('sessions'), { userId: id, generation: 0, now: new Date() });
  return { T, r: { account: load('account.ts'), reset: load('account/reset.ts'), orders: load('orders/index.ts'), cancel: load('orders/[id]/cancel.ts'), position: load('positions/[id].ts'), close: load('positions/[id]/close.ts'), history: load('history.ts'), performance: load('performance.ts'), leaderboard: load('leaderboard.ts') } };
}
async function call(handler, { method = 'GET', token, body, query = {}, headers } = {}) {
  const res = mockResponse();
  await handler({ method, url: '/api/test', headers: headers || requestHeaders(token), body, query, socket: { remoteAddress: '10.0.0.7' } }, res);
  return res;
}
/** Real time, so the fixture is anchored to make simulated time the fixture's START. */
function liveWorld() {
  const x = world();
  const now = new Date();
  x.db.rows('marketDataSets')[0].replayAnchorAt = new Date(new Date(x.dataset.startAt).getTime() + (now.getTime() - START.getTime()));
  return x;
}

test('routes: session, student role and method are enforced on every route', route(async () => {
  const x = liveWorld();
  const { T, r } = routes(x);
  for (const [name, handler] of Object.entries(r)) {
    assert.equal((await call(handler, {})).statusCode, 401, name);
    assert.equal((await call(handler, { token: T.instructor })).statusCode, 403, `${name}: staff have no trading account`);
  }
  for (const [handler, method] of [[r.account, 'DELETE'], [r.reset, 'GET'], [r.orders, 'PUT'], [r.cancel, 'GET'], [r.close, 'GET'], [r.position, 'GET'], [r.history, 'POST'], [r.performance, 'POST']]) {
    const res = await call(handler, { method, token: T.student });
    assert.equal(res.statusCode, 405);
    assert.ok(res.headers.allow);
  }
}));

test('routes: writes need the CSRF header and the exact Origin; responses are private', route(async () => {
  const x = liveWorld();
  const { T, r } = routes(x);
  const noCsrf = { ...requestHeaders(T.student), 'x-fo-csrf': undefined };
  const foreign = requestHeaders(T.student, { origin: 'https://evil.example' });
  for (const [handler, method] of [[r.account, 'POST'], [r.reset, 'POST'], [r.orders, 'POST'], [r.cancel, 'POST'], [r.close, 'POST'], [r.position, 'PATCH'], [r.leaderboard, 'PUT']]) {
    assert.equal((await call(handler, { method, headers: noCsrf })).statusCode, 403);
    assert.equal((await call(handler, { method, headers: foreign })).statusCode, 403);
  }
  assert.equal(x.db.rows('tradingAccounts').length, 0);
  const ok = await call(r.account, { method: 'POST', token: T.student });
  assert.equal(ok.statusCode, 201);
  assert.match(String(ok.headers['cache-control']), /no-store/);
}));

test('routes: nothing the browser sends sets a balance, price, owner or result', route(async () => {
  const x = liveWorld();
  const { T, r } = routes(x);
  await call(r.account, { method: 'POST', token: T.student, body: { initialBalance: 1e15, balance: 1e15, leverage: 500, userId: x.b } });
  assert.equal(String(x.db.rows('tradingAccounts')[0].balance), '10000.00');
  assert.equal(x.db.rows('tradingAccounts')[0].userId, x.a);
  const res = await call(r.orders, { method: 'POST', token: T.student, body: buy({ fillPrice: '0.50000', entry: '0.50000', price: '0.50000', margin: '0.01', realizedPl: '999999', status: 'filled', userId: x.b, accountId: 'x' }) });
  assert.equal(res.statusCode, 201);
  const position = positions(x)[0];
  assert.deepEqual([String(position.entry), String(position.margin), position.userId], ['1.10020', '366.73', x.a]);
  assert.equal(res.body.order.fillPrice, '1.10020');
}));

test('routes: refused orders are 422 with a message for the student; repeats are 200', route(async () => {
  const x = liveWorld();
  const { T, r } = routes(x);
  await call(r.account, { method: 'POST', token: T.student });
  const bad = await call(r.orders, { method: 'POST', token: T.student, body: buy({ stopLoss: '1.07000' }) });
  assert.equal(bad.statusCode, 422);
  assert.match(bad.body.order.rejectMessage, /risks more than 2%/);
  const body = buy();
  assert.equal((await call(r.orders, { method: 'POST', token: T.student, body })).statusCode, 201);
  const again = await call(r.orders, { method: 'POST', token: T.student, body });
  assert.deepEqual([again.statusCode, again.body.repeated], [200, true]);
  assert.equal((await call(r.orders, { method: 'POST', token: T.student, body: { units: '1' } })).statusCode, 400);
}));

test('routes: a student can reach nothing of another student\'s, by any id', route(async () => {
  const x = liveWorld();
  const { T, r } = routes(x);
  await call(r.account, { method: 'POST', token: T.student });
  await call(r.account, { method: 'POST', token: T.other });
  const filled = await call(r.orders, { method: 'POST', token: T.student, body: buy() });
  const pending = await call(r.orders, { method: 'POST', token: T.student, body: buy({ type: 'limit', price: '1.09900', stopLoss: '1.09500' }) });
  const positionId = positions(x)[0]._id.toString();
  assert.ok(filled.body.order.id);
  assert.equal((await call(r.close, { method: 'POST', token: T.other, query: { id: positionId } })).statusCode, 404);
  assert.equal((await call(r.position, { method: 'PATCH', token: T.other, query: { id: positionId }, body: { stopLoss: '1.09900' } })).statusCode, 404);
  assert.equal((await call(r.cancel, { method: 'POST', token: T.other, query: { id: pending.body.order.id } })).statusCode, 404);
  const account = x.db.rows('tradingAccounts').find((a) => a.userId === x.a);
  for (const kind of ['positions', 'ledger']) {
    const rows = (await call(r.history, { token: T.other, query: { kind, accountId: String(account._id) } })).body.rows;
    assert.deepEqual(rows, [], `${kind}: asking for another account returns nothing`);
  }
  assert.deepEqual((await call(r.orders, { token: T.other, query: { accountId: String(account._id) } })).body.rows, []);
  const view = (await call(r.account, { token: T.other })).body;
  assert.deepEqual([view.positions.length, view.pendingOrders.length], [0, 0]);
  assert.equal(positions(x)[0].status, 'open');
}));

test('routes: malformed ids and operator objects are refused, not interpreted', route(async () => {
  const x = liveWorld();
  const { T, r } = routes(x);
  await call(r.account, { method: 'POST', token: T.student });
  for (const id of ['nonsense', '', { $ne: null }, ['a', 'b']]) {
    assert.equal((await call(r.close, { method: 'POST', token: T.student, query: { id } })).statusCode, 404);
    assert.equal((await call(r.cancel, { method: 'POST', token: T.student, query: { id } })).statusCode, 404);
  }
  assert.equal((await call(r.history, { token: T.student, query: { page: { $gt: 0 }, limit: '-1' } })).statusCode, 200);
}));

test('routes: writes are rate limited per account', route(async () => {
  const x = liveWorld();
  const { T, r } = routes(x);
  let last;
  for (let i = 0; i < 301; i += 1) last = await call(r.cancel, { method: 'POST', token: T.student, query: { id: 'nonsense' } });
  assert.equal(last.statusCode, 429);
}));

test('routes: no internal fields or stack details reach the client; failures are generic', route(async () => {
  const x = liveWorld();
  const { T, r } = routes(x);
  await call(r.account, { method: 'POST', token: T.student });
  await call(r.orders, { method: 'POST', token: T.student, body: buy() });
  const view = await call(r.account, { token: T.student });
  const text = JSON.stringify(view.body);
  for (const secret of ['applied', 'fingerprint', 'version', 'userId', 'quoteId', 'clientOrderId', 'email']) assert.equal(text.includes(secret), false, secret);
  const restore = failing(x.db, 'tradingAccountSlots', 'findOne');
  const failed = await call(r.account, { token: T.student });
  restore();
  assert.equal(failed.statusCode, 500);
  assert.equal(JSON.stringify(failed.body).includes('injected'), false);
}));

test('with no verified data the account page still works and says why nothing can trade', route(async () => {
  const x = liveWorld();
  x.db.rows('marketDataSets').length = 0;
  const { T, r } = routes(x);
  await call(r.account, { method: 'POST', token: T.student });
  const view = (await call(r.account, { token: T.student })).body;
  assert.deepEqual([view.market.open, view.market.reason, view.account.balance, view.account.equity], [false, 'no_verified_data', '10000.00', '10000.00']);
  assert.match(view.market.message, /no verified market data/);
  assert.ok(view.market.instruments.every((i) => i.bid === null && i.ask === null), 'no price of any kind');
}));

test('retired broker routes: nothing can reach a broker; GET still changes nothing', route(async () => {
  const x = world();
  const called = [];
  const trap = new Proxy({}, { get: (_t, name) => () => { called.push(name); throw new Error('broker reached'); } });
  const stubs = { 'lib/mongodb': { getDb: async () => x.db }, 'lib/brokers/broker-factory': { BrokerFactory: trap } };
  const load = (file) => loadModule(`pages/api/demo-trading/${file}`, stubs).default;
  x.db.rows('users').push({ _id: new ObjectId(x.a), email: 'a@example.test', name: 'a', role: 'student', status: 'approved', sessionGeneration: 0 });
  const token = seedSession(x.db.rows('sessions'), { userId: x.a, generation: 0, now: new Date() });
  const close = load('positions/[positionId]/close.ts');
  const get = await call(close, { method: 'GET', headers: { cookie: `${COOKIE_NAME}=${token}` }, query: { positionId: 'EUR_USD' } });
  assert.deepEqual([get.statusCode, get.headers.allow], [405, 'POST']);
  for (const method of ['HEAD', 'OPTIONS', 'PUT', 'PATCH', 'DELETE']) assert.equal((await call(close, { method, token, query: { positionId: 'x' } })).statusCode, 405, method);
  assert.equal((await call(close, { method: 'POST', query: {} })).statusCode, 401);
  assert.equal((await call(close, { method: 'POST', headers: { ...requestHeaders(token), 'x-fo-csrf': undefined } })).statusCode, 403);
  assert.equal((await call(close, { method: 'POST', token, query: { positionId: 'x' } })).statusCode, 410);
  for (const file of ['account.ts', 'trades.ts']) {
    assert.equal((await call(load(file), { method: 'POST', token, body: { initialBalance: 1e15, units: 1 } })).statusCode, 410, file);
    assert.equal((await call(load(file), { token })).statusCode, 410, file);
  }
  assert.deepEqual(called, []);
  assert.equal(x.db.rows('demoAccounts').length, 0);
  const walk = (dir, out = []) => {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel, out);
      else if (/\.(ts|tsx|js)$/.test(e.name)) out.push(rel);
    }
    return out;
  };
  const files = [...walk('pages'), ...walk('components'), ...walk('hooks'), ...walk('lib')].filter((f) => !f.startsWith('lib/brokers/') && f !== 'lib/performance-metrics.ts');
  assert.deepEqual(files.filter((f) => /broker-factory|brokers\/oanda|performance-metrics/.test(read(f))), [], 'no application code imports the broker or the mock calculator');
}));

test('legacy performance stays switched off: no figures, no broker', route(async () => {
  const x = world();
  const handler = loadModule('pages/api/demo-trading/performance.ts', { 'lib/mongodb': { getDb: async () => x.db } }).default;
  x.db.rows('users').push({ _id: new ObjectId(x.a), email: 'a@example.test', name: 'a', role: 'student', status: 'approved', sessionGeneration: 0 });
  const token = seedSession(x.db.rows('sessions'), { userId: x.a, generation: 0, now: new Date() });
  const res = await call(handler, { token });
  assert.deepEqual([res.statusCode, res.body.code], [503, 'performance_unavailable']);
  assert.deepEqual(Object.keys(res.body).sort(), ['available', 'code', 'error']);
  assert.equal((await call(handler, { method: 'POST', token })).statusCode, 405);
  assert.equal((await call(handler, {})).statusCode, 401);
}));

// ---------------------------------------------------------------------------
// Performance and leaderboard
// ---------------------------------------------------------------------------

async function trade(x, userId, exitBid, at) {
  const result = await E.placeOrder(x.db, { userId, body: buy(), now: at });
  const position = x.db.rows('tradingPositions').find((p) => String(p._id) === String(result.order.positionId));
  x.quote('EUR_USD', after(1, at), exitBid, `1.${String(Number(exitBid.slice(2)) + 20).padStart(5, '0')}`);
  await E.closePosition(x.db, { userId, positionId: String(position._id), now: after(1, at) });
}

test('performance comes from closed trades, by hand, and survives a reset', async () => {
  const x = world();
  await E.ensureAccount(x.db, { userId: x.a, now: START });
  await trade(x, x.a, '1.10520', after(10)); // quotes are fresh for 120 s: entry 1.10020
  assert.equal(String((await accountOf(x)).balance), '10050.00');
  const before = await V.performanceOf(x.db, x.a);
  assert.deepEqual([before.closedTrades, before.wins, before.losses, before.winRate, before.netResult, before.returnPercent, before.maxDrawdownPercent], [1, 1, 0, '100.00', '50.00', '0.50', '0.00']);
  await trade(x, x.a, '1.10000', after(20)); // entry 1.10540, exit 1.10000: -54.00
  const stats = await V.performanceOf(x.db, x.a);
  assert.deepEqual([stats.closedTrades, stats.wins, stats.losses, stats.winRate, stats.netResult], [2, 1, 1, '50.00', '-4.00']);
  assert.equal(stats.maxDrawdownPercent, '0.54'); // 54.00 from a peak of 10,050.00
  await E.resetAccount(x.db, { userId: x.a, now: after(30) });
  const carried = await V.performanceOf(x.db, x.a);
  assert.deepEqual([carried.netResult, carried.accounts, carried.returnPercent], ['-4.00', 2, '-0.02']); // -4 on 20,000 issued
});

test('leaderboard: off by default, pseudonymous, percentage return, drawdown shown, resets cannot help', async () => {
  const x = world();
  await E.ensureAccount(x.db, { userId: x.a, now: START });
  await E.ensureAccount(x.db, { userId: x.b, now: START });
  for (let i = 0; i < 5; i += 1) await trade(x, x.a, '1.10520', after(10 + i)); // not opted in yet
  assert.deepEqual((await V.leaderboard(x.db, { userId: x.a })).rows, []);
  const opted = await V.setLeaderboardOptIn(x.db, { userId: x.a, optIn: true });
  assert.equal(opted.leaderboardOptIn, true);
  const board = await V.leaderboard(x.db, { userId: x.a });
  assert.equal(board.rows.length, 1);
  assert.deepEqual(Object.keys(board.rows[0]).sort(), ['alias', 'closedTrades', 'maxDrawdownPercent', 'rank', 'returnPercent', 'you']);
  assert.match(board.rows[0].alias, /^Trader-[0-9A-F]{6}$/);
  assert.equal(board.rows[0].you, true);
  assert.equal(JSON.stringify(board).includes(x.a), false, 'no id');
  const seen = await V.leaderboard(x.db, { userId: x.b });
  assert.equal(seen.rows[0].you, false);
  assert.equal((await V.setLeaderboardOptIn(x.db, { userId: newId(), optIn: true })).status, 404);

  // Too few trades: not ranked.
  await V.setLeaderboardOptIn(x.db, { userId: x.b, optIn: true });
  await trade(x, x.b, '1.10520', after(40));
  assert.equal((await V.leaderboard(x.db, { userId: x.b })).rows.length, 1);

  // A reset does not improve a position: capital issued grows, the result stays.
  const before = (await V.leaderboard(x.db, { userId: x.a })).rows[0].returnPercent;
  await E.resetAccount(x.db, { userId: x.a, now: after(50) });
  const lower = (await V.leaderboard(x.db, { userId: x.a })).rows[0].returnPercent;
  assert.ok(Number(lower) <= Number(before));

  await V.setLeaderboardOptIn(x.db, { userId: x.a, optIn: false });
  assert.deepEqual((await V.leaderboard(x.db, { userId: x.a })).rows, [], 'leaving removes you at once');
});

// ---------------------------------------------------------------------------
// G8: practice desk security and instructor workflows
// ---------------------------------------------------------------------------

function desk() {
  const db = paymentMemoryDb({});
  const ids = { a: newId(), b: newId(), instructor: newId(), rival: newId(), admin: newId() };
  for (const [name, id] of Object.entries(ids)) db.rows('users').push({ _id: new ObjectId(id), email: `${name}@example.test`, name, role: ['a', 'b'].includes(name) ? 'student' : name === 'admin' ? 'admin' : 'instructor', status: 'approved', sessionGeneration: 0 });
  const T = {};
  for (const [name, id] of Object.entries(ids)) T[name] = seedSession(db.rows('sessions'), { userId: id, generation: 0, now: new Date() });
  const stubs = { 'lib/mongodb': { getDb: async () => db }, 'lib/notifications': { createNotification: async () => 'n' }, 'lib/ai': { isAIConfigured: () => true, analyzeTrade: async () => ({}), analyzeStudentPerformance: async () => ({ summary: 'ok' }) } };
  const load = (file) => loadModule(`pages/api/${file}`, stubs).default;
  return { db, ids, T, load };
}

test('tasks: completion is per student; a shared task stays open for everyone else', route(async () => {
  const x = desk();
  const id = new ObjectId();
  x.db.rows('demoTasks').push({ _id: id, title: 'General', description: 'd', assignedBy: x.ids.instructor, assignedTo: null, completed: false, createdAt: new Date() });
  const complete = x.load('demo-trading/tasks/[id]/complete.ts');
  const list = x.load('demo-trading/tasks.ts');
  assert.equal((await call(complete, { method: 'POST', token: x.T.a, query: { id: String(id) } })).statusCode, 200);
  assert.equal((await call(complete, { method: 'POST', token: x.T.a, query: { id: String(id) } })).statusCode, 400, 'once per student');
  const seenByB = (await call(list, { token: x.T.b })).body[0];
  assert.equal(seenByB.completed, false);
  assert.equal(JSON.stringify(seenByB).includes(x.ids.a), false, 'nor who finished it');
  assert.equal((await call(complete, { method: 'POST', token: x.T.b, query: { id: String(id) } })).statusCode, 200);
  assert.equal((await call(list, { token: x.T.a })).body[0].completed, true);
}));

test('tasks: a legacy completed flag counts only for whoever set it', () => {
  const { completionFor } = require('../lib/practice-desk');
  const legacy = { completed: true, completedBy: 'a', assignedTo: null, completedAt: 'then' };
  assert.deepEqual(completionFor(legacy, 'a'), { completed: true, completedAt: 'then' });
  assert.equal(completionFor(legacy, 'b').completed, false);
  assert.equal(completionFor({ completed: true, assignedTo: 'c' }, 'c').completed, true);
});

test('tasks: GET never changes state; a private task is out of reach; bad ids are 400, not 500', route(async () => {
  const x = desk();
  const id = new ObjectId();
  x.db.rows('demoTasks').push({ _id: id, title: 'Private', description: 'd', assignedBy: x.ids.instructor, assignedTo: x.ids.a });
  const complete = x.load('demo-trading/tasks/[id]/complete.ts');
  const submit = x.load('demo-trading/tasks/[id]/submit.ts');
  const get = await call(complete, { method: 'GET', headers: { cookie: `${COOKIE_NAME}=${x.T.a}` }, query: { id: String(id) } });
  assert.deepEqual([get.statusCode, get.headers.allow], [405, 'POST']);
  assert.equal(x.db.rows('demoTasks')[0].completions, undefined);
  assert.equal((await call(submit, { method: 'GET', token: x.T.a, query: { id: String(id) } })).statusCode, 405);
  assert.equal((await call(submit, { method: 'POST', token: x.T.b, query: { id: String(id) }, body: { reasoning: 'x' } })).statusCode, 404, 'another student\'s task');
  assert.equal(x.db.rows('demoTaskSubmissions').length, 0);
  assert.equal((await call(submit, { method: 'POST', token: x.T.a, query: { id: String(id) }, body: { reasoning: 'mine' } })).statusCode, 200);
  assert.equal((await call(complete, { method: 'POST', token: x.T.a, query: { id: 'nonsense' } })).statusCode, 400);
  assert.equal((await call(submit, { method: 'POST', token: x.T.a, query: { id: 'nonsense' }, body: { reasoning: 'x' } })).statusCode, 400);
}));

test('instructor routes: method, id and ownership checks hold; lists read in fixed queries', route(async () => {
  const x = desk();
  const task = new ObjectId();
  x.db.rows('demoTasks').push({ _id: task, title: 'T', description: 'd', assignedBy: x.ids.instructor, assignedTo: null });
  for (const key of ['a', 'b']) x.db.rows('demoTaskSubmissions').push({ _id: new ObjectId(), studentId: x.ids[key], taskId: String(task), instructorId: x.ids.instructor, reasoning: 'r', grade: null, submittedAt: new Date() });
  const list = x.load('demo-trading/tasks/[id]/submissions.ts');
  const all = x.load('demo-trading/submissions.ts');
  const review = x.load('demo-submissions/[id]/review.ts');
  const own = await call(list, { token: x.T.instructor, query: { id: String(task) } });
  assert.deepEqual([own.statusCode, own.body.submissions.map((s) => s.studentName).sort()], [200, ['a', 'b']]);
  assert.equal((await call(list, { token: x.T.rival, query: { id: String(task) } })).statusCode, 403);
  assert.equal((await call(list, { token: x.T.instructor, query: { id: 'nonsense' } })).statusCode, 400);
  assert.equal((await call(list, { method: 'POST', token: x.T.instructor, query: { id: String(task) } })).statusCode, 405);
  assert.equal((await call(list, { token: x.T.a, query: { id: String(task) } })).statusCode, 403);
  const users = x.db.collection('users');
  let finds = 0;
  const find = users.find.bind(users);
  const findOne = users.findOne.bind(users);
  users.find = (...args) => { finds += 1; return find(...args); };
  users.findOne = (...args) => { finds += 1; return findOne(...args); };
  assert.equal((await call(all, { token: x.T.instructor })).body.length, 2);
  assert.ok(finds <= 2, 'one lookup for all students, plus the session');
  users.find = find;
  users.findOne = findOne;
  const submissionId = String(x.db.rows('demoTaskSubmissions')[0]._id);
  assert.equal((await call(review, { method: 'GET', token: x.T.instructor, query: { id: submissionId } })).statusCode, 405);
  assert.equal((await call(review, { method: 'PUT', token: x.T.rival, query: { id: submissionId }, body: { grade: 90 } })).statusCode, 403);
  assert.equal((await call(review, { method: 'PUT', token: x.T.instructor, query: { id: 'nonsense' }, body: { grade: 90 } })).statusCode, 400);
  assert.equal((await call(review, { method: 'PUT', token: x.T.instructor, query: { id: submissionId }, body: { grade: 90, feedback: 'ok' } })).statusCode, 200);
}));

test('journal: figures are validated, bounded and marked self-reported; ownership holds', route(async () => {
  const x = desk();
  const journal = x.load('demo-trading/journal.ts');
  const entry = x.load('demo-trading/journal/[id].ts');
  const good = { pair: 'eur/usd', direction: 'buy', entryPrice: '1.1', stopLoss: '1.09', takeProfit: '1.12', lotSize: '0.1', result: 'open' };
  for (const bad of [{ pair: 'ANYTHING' }, { entryPrice: 'abc' }, { lotSize: '-9' }, { stopLoss: 0 }, { takeProfit: 'x' }, { direction: 'up' }, { result: 'maybe' }, { result: 'win' }, { result: 'win', profitLoss: 'abc' }, { result: 'win', profitLoss: 1e12 }, { notes: 'x'.repeat(5001) }]) {
    assert.equal((await call(journal, { method: 'POST', token: x.T.a, body: { ...good, ...bad } })).statusCode, 400, JSON.stringify(bad).slice(0, 40));
  }
  assert.equal((await call(journal, { method: 'POST', token: x.T.a, body: { ...good, taskId: 'bad' } })).statusCode, 400);
  const saved = await call(journal, { method: 'POST', token: x.T.a, body: good });
  assert.equal(saved.statusCode, 201);
  const row = x.db.rows('demoTradeJournal')[0];
  row._id = new ObjectId(); // The in-memory database makes string ids; a real one makes ObjectIds.
  assert.deepEqual([row.pair, row.entryPrice, row.selfReported], ['EUR/USD', 1.1, true]);
  const id = String(row._id);
  assert.equal((await call(entry, { method: 'DELETE', token: x.T.b, query: { id } })).statusCode, 403);
  assert.equal((await call(entry, { method: 'PUT', token: x.T.b, query: { id }, body: good })).statusCode, 403);
  assert.equal((await call(entry, { method: 'PUT', token: x.T.a, query: { id }, body: { ...good, entryPrice: 'abc' } })).statusCode, 400);
  assert.equal((await call(entry, { method: 'DELETE', token: x.T.a, query: { id: 'nonsense' } })).statusCode, 400);
  assert.deepEqual((await call(journal, { token: x.T.b })).body, []);
  assert.match(String((await call(journal, { token: x.T.a })).headers['cache-control']), /no-store/);
  assert.equal((await call(journal, { token: x.T.instructor })).statusCode, 403, 'a journal is the student\'s own');
}));

test('instructor analysis reaches only that instructor\'s students', route(async () => {
  const x = desk();
  const course = new ObjectId();
  x.db.rows('courses').push({ _id: course, instructorId: x.ids.instructor, title: 'C' });
  x.db.rows('progress').push({ _id: new ObjectId(), userId: x.ids.a, courseId: String(course) });
  const analyze = x.load('ai/instructor/analyze-student.ts');
  const ask = (token, studentId) => call(analyze, { method: 'POST', token, body: { studentId } });
  assert.equal((await ask(x.T.instructor, x.ids.a)).statusCode, 200);
  assert.equal((await ask(x.T.rival, x.ids.a)).statusCode, 403);
  assert.equal((await ask(x.T.instructor, x.ids.b)).statusCode, 403);
  assert.equal((await ask(x.T.admin, x.ids.b)).statusCode, 200);
  assert.equal((await ask(x.T.instructor, 'nonsense')).statusCode, 400);
  x.db.rows('demoTaskSubmissions').push({ _id: new ObjectId(), studentId: x.ids.b, instructorId: x.ids.instructor, grade: null });
  assert.equal((await ask(x.T.instructor, x.ids.b)).statusCode, 200, 'a student who submitted to their task');
}));

test('every writing route on the desk is rate limited and every route is private', () => {
  for (const file of ['tasks/[id]/complete.ts', 'tasks/[id]/submit.ts', 'journal.ts', 'journal/[id].ts', 'journal/upload.ts']) assert.match(read(`pages/api/demo-trading/${file}`), /allowRequest\(tradingLimiter/, file);
  assert.match(read('pages/api/ai/analyze-trade.ts'), /allowRequest\(tradingLimiter/);
  for (const file of ['tasks.ts', 'tasks/[id]/complete.ts', 'tasks/[id]/submit.ts', 'tasks/[id]/submissions.ts', 'submissions.ts', 'submissions/[id].ts', 'submissions/student.ts', 'journal.ts', 'journal/[id].ts', 'journal/upload.ts', 'account.ts', 'trades.ts', 'performance.ts', 'positions/[positionId]/close.ts']) assert.match(read(`pages/api/demo-trading/${file}`), /setPrivateNoStore\(res\)/, file);
});

test('the UI labels money as virtual and explains the limits', () => {
  const ui = read('components/TradingInterface.tsx');
  for (const text of [/virtual/i, /not real money/i, /spread/i, /commission/i, /swap/i, /slippage/i, /stop-out/i]) assert.match(ui, text);
  assert.doesNotMatch(ui, /parseFloat|toFixed/, 'the browser computes no financial value');
  void yieldTurn;
});

test('every order rejection the engine can store has its own explanation', () => {
  const source = read('lib/trading/engine.js');
  const codes = new Set([...source.matchAll(/refuse\(400, '([a-z_]+)'/g)].map((m) => m[1]).filter((c) => c !== 'invalid_order'));
  assert.ok(codes.has('invalid_stop_loss'));
  for (const code of codes) assert.notEqual(E.reasonText(code), 'The order could not be executed.', code);
});

test('trading reads and writes are both rate limited, per student', () => {
  const limits = require('../lib/content-rate-limit');
  assert.deepEqual([limits.TRADING_RULES[0].max, limits.TRADING_READ_RULES[0].max], [300, 1200]);
  assert.match(read('lib/trading/route.ts'), /req\.method === 'GET' \? tradingReadLimiter : tradingLimiter/);
});

test('the margin call starts at exactly 100.00%, not below it', () => {
  const I = require('../lib/trading/instruments');
  const quote = { bid: 110000n, ask: 110020n };
  const position = { instrument: 'EUR_USD', side: 'buy', units: 10000n, entry: 110000n, stopLoss: 100000n, takeProfit: null, margin: 10000n };
  const order = { positions: [position], pending: [], quotes: { EUR_USD: quote }, instrument: I.INSTRUMENTS.EUR_USD, side: 'buy', units: 1000n, entry: 110020n, stopLoss: 109000n };
  assert.equal(E.checkOrderRules({ ...order, account: { balance: '100.00' } }).code, 'margin_call');
  assert.equal(E.checkOrderRules({ ...order, account: { balance: '100.01' } }).code, 'insufficient_margin');
});
