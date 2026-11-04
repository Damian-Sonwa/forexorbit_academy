'use strict';

/**
 * The synthetic series: quotes and candles from the model, with durable hourly checkpoints.
 *
 * A market is a `marketDataSets` document with `kind: 'synthetic'`: seed, model version, scenario and
 * start time. Any process computes the same series from it. Checkpoints bound how far back a
 * computation reaches, carry the hour's candle, and form a hash chain so that any later change to the
 * stored history is detected rather than trusted.
 *
 * The seed decides the future, so it stays on the server. No student route returns it, and nothing
 * here computes a quote later than the simulated time it is given by the caller.
 */

const crypto = require('crypto');

const M = require('./model');
const { marketSession } = require('../trading/calendar');
const { INSTRUMENTS } = require('../trading/instruments');

const COLLECTIONS = Object.freeze({ checkpoints: 'marketCheckpoints' });
const STEP_MS = M.STEP_SECONDS * 1000;
const HOUR_MS = 3600000;

const TIMEFRAMES = Object.freeze({
  M1: 60000,
  M5: 300000,
  M15: 900000,
  H1: HOUR_MS,
  H4: 4 * HOUR_MS,
  D1: 24 * HOUR_MS,
});
const MAX_CANDLES = 300;

const stepOf = (dataset, time) => Math.floor((time.getTime() - new Date(dataset.startAt).getTime()) / STEP_MS);
const timeOf = (dataset, step) => new Date(new Date(dataset.startAt).getTime() + step * STEP_MS);

/** A 32-bit number from the dataset's secret seed. */
function seedNumber(dataset) {
  return crypto.createHash('sha256').update(String(dataset.seed)).digest().readUInt32LE(0);
}

// Whether the calendar is open only changes on the hour, so it is worked out once per hour.
const sessionCache = new Map();
function hourIsOpen(hourIndex) {
  let open = sessionCache.get(hourIndex);
  if (open === undefined) {
    open = marketSession(new Date(hourIndex * HOUR_MS)).open;
    if (sessionCache.size > 50000) sessionCache.clear();
    sessionCache.set(hourIndex, open);
  }
  return open;
}

function scenarioShocks(dataset, instrument) {
  const events = (dataset.scenario && dataset.scenario.events) || [];
  const shocks = new Map();
  for (const event of events) {
    if (event.instrument === instrument) shocks.set(stepOf(dataset, new Date(event.at)), event.pips);
  }
  return shocks;
}

function context(dataset, instrument, step, seed, shocks) {
  const ms = timeOf(dataset, step).getTime();
  const hourIndex = Math.floor(ms / HOUR_MS);
  return { instrument, seed, step, hourOfDay: hourIndex % 24, open: hourIsOpen(hourIndex), shockPips: shocks.get(step) || 0 };
}

/** Walks from `state` at `fromStep` to `toStep`, calling `visit(step, state, ctx)` for each step after it. */
function walk(dataset, instrument, state, fromStep, toStep, visit) {
  const seed = seedNumber(dataset);
  const shocks = scenarioShocks(dataset, instrument);
  let current = state;
  for (let step = fromStep + 1; step <= toStep; step += 1) {
    const ctx = context(dataset, instrument, step, seed, shocks);
    current = M.advance(current, ctx);
    if (visit) visit(step, current, ctx);
  }
  return current;
}

const genesis = (dataset, instrument) => M.initialState(instrument, seedNumber(dataset));

/** The state at `step`, from the start. The reference answer that everything else must equal. */
const stateFromStart = (dataset, instrument, step) => walk(dataset, instrument, genesis(dataset, instrument), 0, step);

/** Scales points to the simulator's 5-decimal BigInt price. */
function toPrice(points, instrument) {
  return BigInt(points) * 10n ** BigInt(5 - INSTRUMENTS[instrument].priceDecimals);
}

function quoteFrom(dataset, instrument, step, state, ctx) {
  const { bid, ask, spread } = M.quotePoints(state, ctx);
  return { id: `${dataset._id}:${instrument}:${step}`, instrument, seq: step, bid: toPrice(bid, instrument), ask: toPrice(ask, instrument), spreadPoints: spread, time: timeOf(dataset, step) };
}

function checkpointHash(previousHash, doc) {
  return crypto.createHash('sha256').update(JSON.stringify([previousHash, doc.datasetId, doc.instrument, doc.step, doc.state, doc.bar])).digest('hex');
}

// The newest state each process has reached. It is only a shortcut: it holds what the walk produced.
const reached = new Map();

async function nearestCheckpoint(db, dataset, instrument, step) {
  const rows = await db.collection(COLLECTIONS.checkpoints)
    .find({ datasetId: dataset._id, instrument, step: { $lte: step } })
    .sort({ step: -1 })
    .limit(1)
    .toArray();
  return rows[0] || null;
}

/** The state at `step`, from the nearest shortcut. */
async function stateAt(db, dataset, instrument, step) {
  const key = `${dataset._id}:${instrument}`;
  const memo = reached.get(key);
  let from = { step: 0, state: genesis(dataset, instrument) };
  if (memo && memo.step <= step) from = memo;
  else {
    const row = await nearestCheckpoint(db, dataset, instrument, step);
    if (row) from = { step: row.step, state: row.state };
  }
  const state = walk(dataset, instrument, from.state, from.step, step);
  if (!memo || step > memo.step) reached.set(key, { step, state });
  return state;
}

/** The quote in force at `at`, or { ok: false, reason }. Nothing later than `at` is ever computed. */
async function latestQuote(db, dataset, instrument, at) {
  const step = stepOf(dataset, at);
  if (step < 0) return { ok: false, reason: 'quote_missing' };
  const time = timeOf(dataset, step);
  if (!hourIsOpen(Math.floor(time.getTime() / HOUR_MS))) return { ok: false, reason: 'quote_outside_session' };
  const state = await stateAt(db, dataset, instrument, step);
  const ctx = context(dataset, instrument, step, seedNumber(dataset), new Map());
  return { ok: true, quote: quoteFrom(dataset, instrument, step, state, ctx) };
}

/**
 * Quotes in (after, through], oldest first, in session only. After a suspension the walk starts at
 * the resume time: quotes from the suspended period are never acted on.
 */
async function quotesBetween(db, dataset, instrument, after, through, limit) {
  const resumed = dataset.resumedSimAt ? new Date(dataset.resumedSimAt) : null;
  const start = resumed && resumed > after ? resumed : after;
  const fromStep = Math.max(0, stepOf(dataset, start));
  const lastStep = Math.min(stepOf(dataset, through), fromStep + limit);
  const quotes = [];
  if (lastStep <= fromStep) return { quotes, full: false, lastRowTime: null };
  const state = await stateAt(db, dataset, instrument, fromStep);
  walk(dataset, instrument, state, fromStep, lastStep, (step, current, ctx) => {
    if (ctx.open) quotes.push(quoteFrom(dataset, instrument, step, current, ctx));
  });
  const full = lastStep === fromStep + limit && lastStep < stepOf(dataset, through);
  return { quotes, full, lastRowTime: timeOf(dataset, lastStep) };
}

function addToBar(bar, price) {
  if (!bar) return { open: price, high: price, low: price, close: price };
  return { open: bar.open, high: Math.max(bar.high, price), low: Math.min(bar.low, price), close: price };
}

/**
 * Writes every whole hour up to `throughStep` that has no checkpoint yet. The _id makes this safe to
 * run in several processes: each hour is computed the same way, so a duplicate is simply ignored,
 * and a different stored hash is reported by verifyChain. Returns the number written.
 */
async function advanceCheckpoints(db, dataset, instrument, throughStep, { maxHours = 2000 } = {}) {
  const collection = db.collection(COLLECTIONS.checkpoints);
  const last = await nearestCheckpoint(db, dataset, instrument, throughStep);
  let step = last ? last.step : 0;
  let state = last ? last.state : genesis(dataset, instrument);
  let previousHash = last ? last.hash : 'genesis';
  const seed = seedNumber(dataset);
  const noShocks = new Map();
  let written = 0;
  const batch = [];
  while (step + M.CHECKPOINT_STEPS <= throughStep && written + batch.length < maxHours) {
    // A bar covers [step, end): the step on the hour opens that hour's candle.
    const end = step + M.CHECKPOINT_STEPS;
    const first = context(dataset, instrument, step, seed, noShocks);
    let bar = first.open ? addToBar(null, M.quotePoints(state, first).bid) : null;
    state = walk(dataset, instrument, state, step, end, (at, current, ctx) => {
      if (ctx.open && at < end) bar = addToBar(bar, M.quotePoints(current, ctx).bid);
    });
    step = end;
    const doc = { _id: `${dataset._id}:${instrument}:${step}`, datasetId: dataset._id, instrument, step, time: timeOf(dataset, step), state, bar };
    doc.hash = checkpointHash(previousHash, doc);
    doc.previousHash = previousHash;
    previousHash = doc.hash;
    batch.push(doc);
    if (batch.length >= 200) {
      written += await saveAll(collection, batch);
      batch.length = 0;
    }
  }
  if (batch.length) written += await saveAll(collection, batch);
  return written;
}

async function saveAll(collection, docs) {
  try {
    const result = await collection.insertMany(docs, { ordered: false });
    return result.insertedCount;
  } catch (error) {
    if (error && (error.code === 11000 || (error.writeErrors || []).every((e) => (e.code || (e.err && e.err.code)) === 11000))) return error.insertedCount || 0;
    throw error;
  }
}

/**
 * Recomputes the last `depth` checkpoints from their predecessor and compares. A stored state or
 * candle that the model does not reproduce, or a broken chain, is reported, never rewritten.
 */
async function verifyChain(db, dataset, instrument, { depth = 48 } = {}) {
  const rows = await db.collection(COLLECTIONS.checkpoints)
    .find({ datasetId: dataset._id, instrument })
    .sort({ step: -1 })
    .limit(depth + 1)
    .toArray();
  rows.reverse();
  const problems = [];
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const before = i > 0 ? rows[i - 1] : null;
    if (checkpointHash(row.previousHash, row) !== row.hash) problems.push({ step: row.step, problem: 'hash' });
    if (!before) continue;
    if (row.previousHash !== before.hash) problems.push({ step: row.step, problem: 'chain' });
    if (row.step !== before.step + M.CHECKPOINT_STEPS) problems.push({ step: row.step, problem: 'gap' });
    const state = walk(dataset, instrument, before.state, before.step, row.step);
    if (JSON.stringify(state) !== JSON.stringify(row.state)) problems.push({ step: row.step, problem: 'state' });
  }
  return { ok: problems.length === 0, checked: rows.length, problems, lastStep: rows.length ? rows[rows.length - 1].step : null };
}

const pointsText = (points, instrument) => {
  const decimals = INSTRUMENTS[instrument].priceDecimals;
  const text = String(points).padStart(decimals + 1, '0');
  return `${text.slice(0, -decimals)}.${text.slice(-decimals)}`;
};

/** Candles on the bid. Hours come from checkpoints; only the unfinished tail is computed step by step. */
async function candles(db, dataset, instrument, timeframe, simTime, count = 120) {
  const size = TIMEFRAMES[timeframe];
  if (!size) return null;
  const wanted = Math.min(MAX_CANDLES, Math.max(1, count));
  const nowStep = stepOf(dataset, simTime);
  const buckets = new Map();
  const add = (ms, bar) => {
    const key = Math.floor(ms / size) * size;
    const candle = buckets.get(key);
    buckets.set(key, candle
      ? { open: candle.open, high: Math.max(candle.high, bar.high), low: Math.min(candle.low, bar.low), close: bar.close }
      : { ...bar });
  };
  // Hourly data suffices at H1 and above. Below that, each bar needs its steps.
  const hourly = size >= HOUR_MS;
  const spanMs = wanted * size * (hourly ? 2 : 3) + 4 * 24 * HOUR_MS * (hourly ? 1 : 0);
  const fromStep = Math.max(0, nowStep - Math.ceil(spanMs / STEP_MS));
  let cursor = fromStep;
  if (hourly) {
    const rows = await db.collection(COLLECTIONS.checkpoints)
      .find({ datasetId: dataset._id, instrument, step: { $gt: fromStep, $lte: nowStep } })
      .sort({ step: 1 })
      .toArray();
    for (const row of rows) {
      if (row.bar) add(timeOf(dataset, row.step - 1).getTime(), row.bar);
      cursor = row.step;
    }
  }
  const state = await stateAt(db, dataset, instrument, cursor);
  const addStep = (step, current, ctx) => {
    if (!ctx.open) return;
    const price = M.quotePoints(current, ctx).bid;
    add(timeOf(dataset, step).getTime(), { open: price, high: price, low: price, close: price });
  };
  addStep(cursor, state, context(dataset, instrument, cursor, seedNumber(dataset), new Map()));
  walk(dataset, instrument, state, cursor, nowStep, addStep);
  const keys = [...buckets.keys()].sort((a, b) => a - b).slice(-wanted);
  const currentBucket = Math.floor(simTime.getTime() / size) * size;
  return keys.map((key) => {
    const c = buckets.get(key);
    return { time: new Date(key).toISOString(), open: pointsText(c.open, instrument), high: pointsText(c.high, instrument), low: pointsText(c.low, instrument), close: pointsText(c.close, instrument), complete: key < currentBucket };
  });
}

/** Clears this process's shortcut. Tests use it to stand in for a restart. */
const forgetProcessState = () => reached.clear();

module.exports = {
  COLLECTIONS,
  MAX_CANDLES,
  STEP_MS,
  TIMEFRAMES,
  advanceCheckpoints,
  candles,
  forgetProcessState,
  latestQuote,
  quotesBetween,
  seedNumber,
  stateAt,
  stateFromStart,
  stepOf,
  timeOf,
  verifyChain,
  walk,
};
