'use strict';

/**
 * Market data boundary of the practice simulator (Phase 10, G2).
 *
 * The simulator only ever reads recorded quotes from a dataset that passed the approval gate. There
 * is no fallback of any kind: with no approved dataset, or with a missing, stale or corrupt quote,
 * trading is suspended and the reason is reported. No code here can produce a price.
 *
 * marketDataSets  one document per dataset: provenance, licence, approval, coverage and the replay
 *                 anchor. Exactly one may be `active`.
 * marketQuotes    { datasetId, instrument, time, bid, ask }: recorded quotes, read-only to the app.
 *
 * Time: a dataset is replayed at real speed. simulated time = startAt + (now - replayAnchorAt). All
 * market rules (session, freshness, expiry) use simulated time, so a run can be reproduced.
 *
 * A dataset marked `testFixture` holds synthetic quotes for automated tests and is refused when
 * NODE_ENV is production, whatever its other fields say.
 */

const { priceFrom, parsePrice } = require('./money');
const { INSTRUMENTS, instrumentOf, pipSize, priceFitsInstrument } = require('./instruments');
const { marketSession } = require('./calendar');

const COLLECTIONS = Object.freeze({ datasets: 'marketDataSets', quotes: 'marketQuotes' });
const DEFAULT_MAX_QUOTE_AGE_SECONDS = 120;
/** A wider spread than this is treated as corrupt data, not as a market. */
const MAX_SPREAD_PIPS = 100n;

/** What the owner must have confirmed before a dataset can be adopted. */
const REQUIRED_APPROVAL_FIELDS = Object.freeze([
  ['provenance', 'source'],
  ['provenance', 'sourceUrl'],
  ['provenance', 'retrievedAt'],
  ['licence', 'name'],
  ['licence', 'url'],
  ['licence', 'educationalUse'],
  ['licence', 'storageRights'],
  ['licence', 'redistributionRights'],
  ['timeSemantics', 'timezone'],
  ['timeSemantics', 'daylightSaving'],
  ['approval', 'approvedBy'],
  ['approval', 'approvedAt'],
]);

/** Every reason this gate would refuse a dataset. An empty list means it may be used. */
function datasetProblems(dataset, env = process.env) {
  const problems = [];
  if (!dataset || typeof dataset !== 'object') return ['missing'];
  if (dataset.testFixture === true && env.NODE_ENV === 'production') return ['test_fixture_in_production'];
  if (!dataset.approval || dataset.approval.status !== 'approved') problems.push('not_approved');
  for (const [group, field] of REQUIRED_APPROVAL_FIELDS) {
    const value = dataset[group] && dataset[group][field];
    if (value === undefined || value === null || value === '' || value === false) problems.push(`${group}.${field}`);
  }
  const start = new Date(dataset.startAt);
  const end = new Date(dataset.endAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) problems.push('coverage');
  if (Number.isNaN(new Date(dataset.replayAnchorAt).getTime())) problems.push('replayAnchorAt');
  if (!Array.isArray(dataset.instruments) || dataset.instruments.length === 0 || !dataset.instruments.every((id) => instrumentOf(id))) problems.push('instruments');
  return problems;
}

/** Validates one recorded quote. Returns { ok, bid, ask } in price units, or { ok: false, reason }. */
function checkQuote(row) {
  const instrument = row && instrumentOf(row.instrument);
  if (!instrument) return { ok: false, reason: 'unknown_instrument' };
  const time = new Date(row.time);
  if (Number.isNaN(time.getTime())) return { ok: false, reason: 'invalid_time' };
  const bid = parsePrice(String(row.bid));
  const ask = parsePrice(String(row.ask));
  if (bid === null || ask === null) return { ok: false, reason: 'invalid_price' };
  if (bid <= 0n || ask <= 0n) return { ok: false, reason: 'non_positive_price' };
  if (ask < bid) return { ok: false, reason: 'crossed_quote' };
  if (!priceFitsInstrument(bid, instrument) || !priceFitsInstrument(ask, instrument)) return { ok: false, reason: 'precision' };
  if (ask - bid > MAX_SPREAD_PIPS * pipSize(instrument)) return { ok: false, reason: 'spread_too_wide' };
  return { ok: true, bid, ask, time };
}

function simulatedTime(dataset, now) {
  const elapsed = now.getTime() - new Date(dataset.replayAnchorAt).getTime();
  return new Date(new Date(dataset.startAt).getTime() + elapsed);
}

/**
 * Whether trading can happen now, and on what data. `open` is true only with an approved dataset,
 * inside its coverage, in an open market session.
 */
async function marketState(db, { now = new Date(), env = process.env } = {}) {
  const dataset = await db.collection(COLLECTIONS.datasets).findOne({ active: true });
  if (!dataset) return { open: false, reason: 'no_verified_data', dataset: null, simTime: null };
  const problems = datasetProblems(dataset, env);
  if (problems.length) return { open: false, reason: 'no_verified_data', dataset: null, simTime: null, problems };
  const simTime = simulatedTime(dataset, now);
  if (simTime < new Date(dataset.startAt)) return { open: false, reason: 'data_not_started', dataset, simTime: null };
  if (simTime > new Date(dataset.endAt)) return { open: false, reason: 'data_ended', dataset, simTime: new Date(dataset.endAt) };
  const session = marketSession(simTime);
  return { open: session.open, reason: session.reason, holiday: session.holiday || null, dataset, simTime };
}

/**
 * The latest usable quote at `at`. Never older than the dataset's freshness limit, never from a
 * closed session, never a corrupt row. Returns { ok: true, quote } or { ok: false, reason }.
 */
async function latestQuote(db, dataset, instrument, at) {
  const rows = await db.collection(COLLECTIONS.quotes)
    .find({ datasetId: dataset._id, instrument, time: { $lte: at } })
    .sort({ time: -1 })
    .limit(1)
    .toArray();
  if (!rows.length) return { ok: false, reason: 'quote_missing' };
  const row = rows[0];
  const checked = checkQuote(row);
  if (!checked.ok) return { ok: false, reason: 'quote_corrupt' };
  const maxAge = (dataset.maxQuoteAgeSeconds || DEFAULT_MAX_QUOTE_AGE_SECONDS) * 1000;
  if (at.getTime() - checked.time.getTime() > maxAge) return { ok: false, reason: 'quote_stale' };
  if (!marketSession(checked.time).open) return { ok: false, reason: 'quote_outside_session' };
  return { ok: true, quote: { id: String(row._id), instrument, bid: checked.bid, ask: checked.ask, time: checked.time } };
}

/** Recorded quotes in (after, through], oldest first, valid and in session only. */
async function quotesBetween(db, dataset, instrument, after, through, limit) {
  const rows = await db.collection(COLLECTIONS.quotes)
    .find({ datasetId: dataset._id, instrument, time: { $gt: after, $lte: through } })
    .sort({ time: 1 })
    .limit(limit)
    .toArray();
  const quotes = [];
  for (const row of rows) {
    const checked = checkQuote(row);
    if (checked.ok && marketSession(checked.time).open) quotes.push({ id: String(row._id), instrument, bid: checked.bid, ask: checked.ask, time: checked.time });
  }
  return { quotes, full: rows.length === limit, lastRowTime: rows.length ? new Date(rows[rows.length - 1].time) : null };
}

/** Quotes for several instruments at one instant. Instruments without a usable quote are absent. */
async function quotesAt(db, dataset, instruments, at) {
  const quotes = {};
  const missing = {};
  for (const instrument of new Set(instruments)) {
    const result = await latestQuote(db, dataset, instrument, at);
    if (result.ok) quotes[instrument] = result.quote;
    else missing[instrument] = result.reason;
  }
  return { quotes, missing };
}

module.exports = {
  COLLECTIONS,
  DEFAULT_MAX_QUOTE_AGE_SECONDS,
  INSTRUMENT_IDS: Object.freeze(Object.keys(INSTRUMENTS)),
  MAX_SPREAD_PIPS,
  REQUIRED_APPROVAL_FIELDS,
  checkQuote,
  datasetProblems,
  latestQuote,
  marketState,
  priceFrom,
  quotesAt,
  quotesBetween,
  simulatedTime,
};
