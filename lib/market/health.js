'use strict';

/**
 * Market health, suspension, incidents and the background pass.
 *
 * One `marketHealth` document per market: status INITIALISING, ACTIVE, SUSPENDED, RECOVERING or ERROR.
 * Only ACTIVE can trade. Any other state, or a pass that has stopped running, closes the market for
 * orders and valuation: no quote is served and no fallback price exists.
 *
 * Positions during a suspension: they stay open and untouched. Equity, margin level and P&L show as
 * unavailable. Stop-loss, take-profit, pending orders and stop-out do not run. On resume the walk
 * starts at the resume time, so a stop fills at the first valid quote after resuming, at that price.
 */

const crypto = require('crypto');

const M = require('./model');
const S = require('./series');
const { CALENDAR_VERSION } = require('../trading/calendar');
const { INSTRUMENTS } = require('../trading/instruments');

const COLLECTIONS = Object.freeze({ health: 'marketHealth', incidents: 'marketIncidents' });
const STATUS = Object.freeze({ INITIALISING: 'INITIALISING', ACTIVE: 'ACTIVE', SUSPENDED: 'SUSPENDED', RECOVERING: 'RECOVERING', ERROR: 'ERROR' });
/** Without a pass for this long, nothing vouches for the market, so it stops trading. */
const HEARTBEAT_LIMIT_MS = 10 * 60 * 1000;
/** Checkpoints may trail simulated time by this much, allowing for the hour in progress. */
const CHECKPOINT_LAG_STEPS = 3 * M.CHECKPOINT_STEPS;
const MARKET_LABEL = 'SIMULATED MARKET — NOT LIVE MARKET DATA';

/** A new synthetic market. The seed is generated here and stays on the server. */
function newMarket({ id, startAt, seed = crypto.randomBytes(32).toString('hex'), scenario = { id: 'baseline', version: 1, events: [] }, speed = 1 }) {
  return {
    _id: id,
    kind: 'synthetic',
    name: 'ForexOrbit simulated market',
    active: false,
    seedId: crypto.createHash('sha256').update(String(seed)).digest('hex').slice(0, 16),
    seed,
    modelVersion: M.MODEL_VERSION,
    calendarVersion: CALENDAR_VERSION,
    scenario,
    speed,
    instruments: Object.keys(INSTRUMENTS),
    startAt: new Date(startAt),
    replayAnchorAt: new Date(startAt),
    endAt: null,
    createdAt: new Date(),
  };
}

function incident(db, market, { kind, detail, now }) {
  return db.collection(COLLECTIONS.incidents).insertOne({ marketId: market._id, seedId: market.seedId, kind, detail, createdAt: now });
}

const setHealth = (db, market, fields, now) => db.collection(COLLECTIONS.health).updateOne(
  { _id: market._id },
  { $set: { ...fields, updatedAt: now } },
  { upsert: true }
);

const readHealth = (db, market) => db.collection(COLLECTIONS.health).findOne({ _id: market._id });

/** Whether this market may serve quotes now, and the reason if not. */
function healthProblem(health, now) {
  if (!health) return 'market_initialising';
  if (health.status === STATUS.SUSPENDED) return 'market_suspended';
  if (health.status === STATUS.INITIALISING) return 'market_initialising';
  if (health.status === STATUS.RECOVERING) return 'market_recovering';
  if (health.status !== STATUS.ACTIVE) return 'market_error';
  if (!health.heartbeatAt || now.getTime() - new Date(health.heartbeatAt).getTime() > HEARTBEAT_LIMIT_MS) return 'market_stale';
  return null;
}

/**
 * One background pass: extends checkpoints and verifies recent history. Safe to run at any time and
 * in several processes. A problem suspends the market and is recorded, once, as an incident.
 */
async function marketPass(db, market, { now = new Date(), simTime, depth = 48 }) {
  const health = await readHealth(db, market);
  if (health && health.status === STATUS.SUSPENDED) return { status: STATUS.SUSPENDED };
  if (health && health.status === STATUS.ERROR) return { status: STATUS.ERROR };
  const through = S.stepOf(market, simTime);
  if (!health) await setHealth(db, market, { status: STATUS.INITIALISING, startedAt: now, seedId: market.seedId, modelVersion: market.modelVersion }, now);

  const problems = [];
  let caughtUp = true;
  for (const instrument of market.instruments) {
    await S.advanceCheckpoints(db, market, instrument, through);
    const check = await S.verifyChain(db, market, instrument, { depth });
    if (!check.ok) problems.push({ instrument, problems: check.problems.slice(0, 5) });
    if (check.lastStep === null ? through >= M.CHECKPOINT_STEPS : through - check.lastStep > CHECKPOINT_LAG_STEPS) caughtUp = false;
  }

  if (problems.length) {
    await setHealth(db, market, { status: STATUS.ERROR, reason: 'history_mismatch', heartbeatAt: now }, now);
    await incident(db, market, { kind: 'history_mismatch', detail: problems, now });
    return { status: STATUS.ERROR, problems };
  }
  if (!caughtUp) {
    await setHealth(db, market, { status: health && health.status === STATUS.ACTIVE ? STATUS.RECOVERING : (health ? health.status : STATUS.INITIALISING), heartbeatAt: now }, now);
    return { status: STATUS.RECOVERING };
  }
  await setHealth(db, market, { status: STATUS.ACTIVE, reason: null, heartbeatAt: now, verifiedThrough: simTime }, now);
  return { status: STATUS.ACTIVE };
}

/** An administrator's suspension. Positions and accounts are not touched. */
async function suspendMarket(db, market, { reason, now = new Date() }) {
  await setHealth(db, market, { status: STATUS.SUSPENDED, reason: reason || 'admin', suspendedAt: now }, now);
  await incident(db, market, { kind: 'suspended', detail: { reason: reason || 'admin' }, now });
}

/**
 * Lifts a suspension or an error after re-checking history. The market returns to ACTIVE only if
 * every pair verifies. Quotes before `simTime` stay unused, by way of `resumedSimAt`.
 */
async function resumeMarket(db, market, { now = new Date(), simTime, depth = 500 }) {
  await setHealth(db, market, { status: STATUS.RECOVERING }, now);
  const problems = [];
  for (const instrument of market.instruments) {
    const check = await S.verifyChain(db, market, instrument, { depth });
    if (!check.ok) problems.push({ instrument, problems: check.problems.slice(0, 5) });
  }
  if (problems.length) {
    await setHealth(db, market, { status: STATUS.ERROR, reason: 'history_mismatch' }, now);
    await incident(db, market, { kind: 'resume_refused', detail: problems, now });
    return { ok: false, status: STATUS.ERROR, problems };
  }
  await setHealth(db, market, { status: STATUS.ACTIVE, reason: null, heartbeatAt: now, resumedSimAt: simTime, verifiedThrough: simTime }, now);
  await incident(db, market, { kind: 'resumed', detail: { resumedSimAt: simTime }, now });
  return { ok: true, status: STATUS.ACTIVE };
}

/** What an administrator sees. The seed is left out. */
async function healthReport(db, market, { limit = 20 } = {}) {
  const [health, incidents] = await Promise.all([
    readHealth(db, market),
    db.collection(COLLECTIONS.incidents).find({ marketId: market._id }).sort({ createdAt: -1 }).limit(limit).toArray(),
  ]);
  return {
    marketId: market._id,
    seedId: market.seedId,
    modelVersion: market.modelVersion,
    calendarVersion: market.calendarVersion,
    scenario: market.scenario && { id: market.scenario.id, version: market.scenario.version },
    status: health ? health.status : STATUS.INITIALISING,
    reason: (health && health.reason) || null,
    heartbeatAt: (health && health.heartbeatAt) || null,
    verifiedThrough: (health && health.verifiedThrough) || null,
    incidents: incidents.map(({ _id, kind, detail, createdAt }) => ({ id: String(_id), kind, detail, createdAt })),
  };
}

module.exports = { COLLECTIONS, HEARTBEAT_LIMIT_MS, MARKET_LABEL, STATUS, healthProblem, healthReport, incident, marketPass, newMarket, readHealth, resumeMarket, suspendMarket };
