/**
 * The synthetic market's model, series and calendar. Pure: no database.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const M = require('../lib/market/model');
const S = require('../lib/market/series');
const H = require('../lib/market/health');
const C = require('../lib/trading/calendar');
const D = require('../lib/trading/market-data');
const { INSTRUMENTS } = require('../lib/trading/instruments');
const { listPage } = require('../lib/practice-desk');

const ROOT = path.join(__dirname, '..');
const market = (seed = 'test-seed', extra = {}) => ({ ...H.newMarket({ id: 'm', startAt: '2026-01-05T00:00:00Z', seed }), ...extra });
const PAIRS = Object.keys(M.PAIRS);
const DAY_STEPS = 8640;
const run = (dataset, instrument, steps, visit) => S.walk(dataset, instrument, M.initialState(instrument, S.seedNumber(dataset)), 0, steps, visit);

test('the model covers exactly the six simulator pairs, with precision matching the instrument table', () => {
  assert.deepEqual(PAIRS.sort(), Object.keys(INSTRUMENTS).sort());
  for (const id of PAIRS) {
    assert.equal(M.PAIRS[id].decimals, INSTRUMENTS[id].priceDecimals, id);
    assert.ok(M.PAIRS[id].minSpread > 0 && M.PAIRS[id].minSpread <= M.PAIRS[id].spreadPoints && M.PAIRS[id].spreadPoints <= M.PAIRS[id].maxSpread, id);
  }
});

test('determinism: the same seed, model, pair and step give the same state, whatever the route', () => {
  const dataset = market();
  for (const id of PAIRS) {
    const direct = S.stateFromStart(dataset, id, 5000);
    const halfway = S.stateFromStart(dataset, id, 2500);
    assert.deepEqual(S.walk(dataset, id, halfway, 2500, 5000), direct, id);
    assert.deepEqual(S.stateFromStart(dataset, id, 5000), direct, id);
  }
});

test('determinism: a separate process, on a different clock, computes the same state', () => {
  const code = `const S=require('./lib/market/series');const H=require('./lib/market/health');
    const d=H.newMarket({id:'m',startAt:'2026-01-05T00:00:00Z',seed:'test-seed'});
    console.log(JSON.stringify(S.stateFromStart(d,'USD_JPY',5000)));`;
  const child = spawnSync(process.execPath, ['-e', code], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, TZ: 'Asia/Tokyo' } });
  assert.deepEqual(JSON.parse(child.stdout), S.stateFromStart(market(), 'USD_JPY', 5000));
});

test('a different seed gives a different market, and pairs differ from each other', () => {
  assert.notDeepEqual(S.stateFromStart(market('a'), 'EUR_USD', 1000), S.stateFromStart(market('b'), 'EUR_USD', 1000));
  const a = S.stateFromStart(market(), 'EUR_USD', 1000).mid / M.midOf(M.PAIRS.EUR_USD);
  const b = S.stateFromStart(market(), 'GBP_USD', 1000).mid / M.midOf(M.PAIRS.GBP_USD);
  assert.notEqual(a, b);
});

test('the generator uses no source of nondeterminism and no floating-point transcendental', () => {
  for (const file of ['lib/market/model.js', 'lib/market/series.js']) {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(source, /Math\.(random|exp|log|pow|sin|cos|sqrt)\b|Date\.now|new Date\(\)/, file);
  }
});

test('every state stays whole and bounded, and every quote is coherent, for 60 days of every pair', () => {
  const dataset = market();
  for (const id of PAIRS) {
    const pair = M.PAIRS[id];
    run(dataset, id, 60 * DAY_STEPS, (step, state, ctx) => {
      if (step % 7 !== 0) return;
      assert.ok(Number.isSafeInteger(state.mid) && Number.isSafeInteger(state.vol) && Number.isSafeInteger(state.anchor));
      const { bid, ask, spread } = M.quotePoints(state, ctx);
      assert.ok(ask > bid, 'ask above bid');
      assert.equal(ask - bid, spread);
      assert.ok(spread >= pair.minSpread && spread <= pair.maxSpread, 'spread within the pair limits');
      assert.ok(bid > 0);
    });
  }
});

test('a synthetic quote passes the same validation as any other quote', () => {
  const dataset = market();
  for (const id of PAIRS) {
    const step = 3000;
    const state = S.stateFromStart(dataset, id, step);
    const { bid, ask } = M.quotePoints(state, { instrument: id, hourOfDay: 12, open: true });
    const scale = 10 ** M.PAIRS[id].decimals;
    const text = (points) => (points / scale).toFixed(M.PAIRS[id].decimals);
    const checked = D.checkQuote({ instrument: id, time: new Date('2026-01-06T12:00:00Z'), bid: text(bid), ask: text(ask) });
    assert.equal(checked.ok, true, `${id}: ${checked.reason}`);
  }
});

test('the process produces volatility clustering, regimes and reversion, measured not assumed', () => {
  const dataset = market();
  const moves = [];
  const seen = new Set();
  let previous = M.midOf(M.PAIRS.EUR_USD);
  run(dataset, 'EUR_USD', 30 * DAY_STEPS, (step, state) => {
    moves.push(Math.abs(state.mid - previous));
    previous = state.mid;
    seen.add(state.regime);
  });
  assert.equal(seen.size, 5, 'all regimes occur');
  const mean = moves.reduce((a, b) => a + b, 0) / moves.length;
  let num = 0;
  let den = 0;
  for (let i = 1; i < moves.length; i += 1) {
    num += (moves[i] - mean) * (moves[i - 1] - mean);
    den += (moves[i] - mean) ** 2;
  }
  assert.ok(num / den > 0.05, `absolute moves are autocorrelated (${(num / den).toFixed(3)})`);
});

test('USD pairs share a factor: EUR/USD and USD/CHF tend to move in opposite directions', () => {
  const dataset = market();
  const series = (id) => {
    const out = [];
    let previous = M.midOf(M.PAIRS[id]);
    run(dataset, id, 5 * DAY_STEPS, (step, state) => { out.push(state.mid - previous); previous = state.mid; });
    return out;
  };
  const a = series('EUR_USD');
  const b = series('USD_CHF');
  const dot = a.reduce((sum, value, i) => sum + Math.sign(value) * Math.sign(b[i]), 0);
  assert.ok(dot < 0, `sign agreement ${dot}`);
});

test('a scheduled scenario shock moves the price by its size at its step', () => {
  const at = new Date('2026-01-05T01:00:00Z');
  const scenario = { id: 's', version: 1, events: [{ instrument: 'EUR_USD', at, pips: 50 }] };
  const plain = market('x');
  const shocked = market('x', { scenario });
  const step = S.stepOf(plain, at);
  const before = S.stateFromStart(plain, 'EUR_USD', step);
  const after = S.stateFromStart(shocked, 'EUR_USD', step);
  assert.equal(after.mid - before.mid, 50 * M.pipOf(M.PAIRS.EUR_USD));
});

test('a new market keeps a secret seed and records what an audit needs', () => {
  const dataset = H.newMarket({ id: 'm', startAt: '2026-01-05T00:00:00Z' });
  assert.match(dataset.seed, /^[0-9a-f]{64}$/);
  assert.notEqual(dataset.seed, H.newMarket({ id: 'm', startAt: '2026-01-05T00:00:00Z' }).seed);
  assert.ok(!dataset.seed.startsWith(dataset.seedId), 'the public id is a hash, not a prefix');
  assert.deepEqual([dataset.modelVersion, dataset.calendarVersion, dataset.scenario.id], [M.MODEL_VERSION, C.CALENDAR_VERSION, 'baseline']);
});

test('the gate refuses a synthetic market with no seed, or built by another model or calendar', () => {
  assert.deepEqual(D.datasetProblems(market(), { NODE_ENV: 'production' }), []);
  assert.deepEqual(D.datasetProblems(market('x', { seed: '' }), {}), ['seed']);
  assert.deepEqual(D.datasetProblems(market('x', { modelVersion: 'old' }), {}), ['modelVersion']);
  assert.deepEqual(D.datasetProblems(market('x', { calendarVersion: 'old' }), {}), ['calendarVersion']);
  assert.deepEqual(D.datasetProblems(market('x', { instruments: ['XAU_USD'] }), {}), ['instruments']);
});

test('health: only a recently confirmed ACTIVE market may serve quotes', () => {
  const now = new Date('2026-03-04T12:00:00Z');
  const fresh = new Date(now.getTime() - 60000);
  const old = new Date(now.getTime() - H.HEARTBEAT_LIMIT_MS - 1);
  assert.equal(H.healthProblem({ status: 'ACTIVE', heartbeatAt: fresh }, now), null);
  assert.equal(H.healthProblem({ status: 'ACTIVE', heartbeatAt: old }, now), 'market_stale');
  assert.equal(H.healthProblem(null, now), 'market_initialising');
  assert.equal(H.healthProblem({ status: 'INITIALISING' }, now), 'market_initialising');
  assert.equal(H.healthProblem({ status: 'SUSPENDED', heartbeatAt: fresh }, now), 'market_suspended');
  assert.equal(H.healthProblem({ status: 'RECOVERING', heartbeatAt: fresh }, now), 'market_recovering');
  assert.equal(H.healthProblem({ status: 'ERROR', heartbeatAt: fresh }, now), 'market_error');
});

test('the simulated clock runs at the configured speed', () => {
  const dataset = market('x', { startAt: new Date('2026-01-05T00:00:00Z'), replayAnchorAt: new Date('2026-06-01T00:00:00Z'), speed: 4 });
  assert.equal(D.simulatedTime(dataset, new Date('2026-06-01T01:00:00Z')).toISOString(), '2026-01-05T04:00:00.000Z');
  assert.equal(D.simulatedTime({ ...dataset, speed: undefined }, new Date('2026-06-01T01:00:00Z')).toISOString(), '2026-01-05T01:00:00.000Z');
});

test('calendar: open and close move with daylight saving, in both directions', () => {
  const open = (t) => C.marketSession(new Date(t)).open;
  // Winter: Sunday 17:00 New York is 22:00 UTC. Summer: 21:00 UTC.
  assert.deepEqual([open('2026-01-11T21:59:00Z'), open('2026-01-11T22:00:00Z')], [false, true]);
  assert.deepEqual([open('2026-07-12T20:59:00Z'), open('2026-07-12T21:00:00Z')], [false, true]);
  // The weekend of the US change: Sunday 8 March 2026 opens on the summer hour.
  assert.deepEqual([open('2026-03-08T20:59:00Z'), open('2026-03-08T21:00:00Z')], [false, true]);
  // The weekend of the autumn change: Sunday 1 November 2026 opens on the winter hour.
  assert.deepEqual([open('2026-11-01T21:59:00Z'), open('2026-11-01T22:00:00Z')], [false, true]);
  // Friday close, each side of the change.
  assert.deepEqual([open('2026-01-16T21:59:00Z'), open('2026-01-16T22:00:00Z')], [true, false]);
  assert.deepEqual([open('2026-07-17T20:59:00Z'), open('2026-07-17T21:00:00Z')], [true, false]);
});

test('calendar: named sessions follow their own zones and stop when the market closes', () => {
  assert.deepEqual(C.activeSessions(new Date('2026-01-14T14:00:00Z')), ['London', 'New York']);
  assert.deepEqual(C.activeSessions(new Date('2026-01-14T02:00:00Z')), ['Sydney', 'Tokyo']);
  // London moves an hour in UTC with British Summer Time.
  assert.ok(C.activeSessions(new Date('2026-01-14T07:30:00Z')).every((s) => s !== 'London'));
  assert.ok(C.activeSessions(new Date('2026-07-15T07:30:00Z')).includes('London'));
  assert.deepEqual(C.activeSessions(new Date('2026-01-17T12:00:00Z')), []);
});

test('calendar: Easter is right across years, and the next open is found past a holiday weekend', () => {
  assert.deepEqual(C.easterSunday(2026), { month: 4, day: 5 });
  assert.deepEqual(C.easterSunday(2027), { month: 3, day: 28 });
  assert.deepEqual(C.easterSunday(2030), { month: 4, day: 21 });
  assert.equal(C.nextOpen(new Date('2026-01-17T12:00:00Z')).toISOString(), '2026-01-18T22:00:00.000Z');
  assert.equal(C.nextOpen(new Date('2026-04-03T12:00:00Z')).toISOString(), '2026-04-05T21:00:00.000Z');
});

test('every calendar boundary falls on the hour, which the series relies on', () => {
  for (let ms = Date.UTC(2026, 0, 1); ms < Date.UTC(2027, 0, 5); ms += 3600000) {
    const start = C.marketSession(new Date(ms)).open;
    assert.equal(C.marketSession(new Date(ms + 3599999)).open, start, new Date(ms).toISOString());
  }
});

test('lists are bounded: a default page, a hard maximum, and nothing else is accepted', () => {
  assert.deepEqual(listPage({}), { page: 1, limit: 100, skip: 0 });
  assert.deepEqual(listPage({ page: '3', limit: '20' }), { page: 3, limit: 20, skip: 40 });
  assert.equal(listPage({ limit: '100000' }).limit, 200);
  assert.deepEqual(listPage({ page: '-1', limit: ['1'] }), { page: 1, limit: 100, skip: 0 });
});

test('no student-visible text calls generated prices live or real', () => {
  const desk = fs.readFileSync(path.join(ROOT, 'components/TradingInterface.tsx'), 'utf8');
  assert.doesNotMatch(desk, /live market|real-time|actual market/i);
  assert.equal(H.MARKET_LABEL, 'SIMULATED MARKET — NOT LIVE MARKET DATA');
  assert.match(desk, /data-testid="market-label"/);
  for (const [area, pattern] of [['ticket', /New simulated order/], ['confirmation', /Simulated execution/], ['history', /Simulated trade history/], ['results', /Your simulated results/], ['leaderboard', /no evidence of real trading skill/]]) {
    assert.match(desk, pattern, area);
  }
});

test('student responses never include the seed', () => {
  const views = fs.readFileSync(path.join(ROOT, 'lib/trading/views.js'), 'utf8');
  assert.doesNotMatch(views, /\bseed\b|seedId/);
  const report = fs.readFileSync(path.join(ROOT, 'lib/market/health.js'), 'utf8').match(/async function healthReport[\s\S]*?\n}\n/)[0];
  assert.doesNotMatch(report, /\.seed\b/);
});

test('bid and ask straddle the mid: the spread is split around it, not added to one side', () => {
  const dataset = market();
  for (const id of PAIRS) {
    const state = S.stateFromStart(dataset, id, 4000);
    const { bid, ask } = M.quotePoints(state, { instrument: id, hourOfDay: 12, open: true });
    const mid = state.mid / M.pointOf(M.PAIRS[id]);
    assert.ok(bid < mid && mid < ask, id);
    assert.ok(Math.abs((bid + ask) / 2 - mid) <= 1, id);
  }
});

test('no quote exists when the calendar is closed, even asked for directly', async () => {
  const dataset = market();
  const noDatabase = { collection: () => { throw new Error('a closed market needs no read'); } };
  assert.deepEqual(await S.latestQuote(noDatabase, dataset, 'EUR_USD', new Date('2026-01-10T12:00:00Z')), { ok: false, reason: 'quote_outside_session' });
});
