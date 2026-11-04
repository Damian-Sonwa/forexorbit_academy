'use strict';

/**
 * The only way recorded market data enters the simulator (Phase 10, G2). A dataset is refused unless
 * its manifest records an approved source and every licence and provenance fact, and every quote
 * passes validation. There is no partial import: one bad row refuses the file. Test fixtures can
 * never be imported this way.
 *
 * CSV columns: instrument,time,bid,ask. Time is ISO 8601 with an explicit offset; a time without one
 * is refused, because its meaning would be a guess.
 */

const { Decimal128 } = require('mongodb');
const { COLLECTIONS, checkQuote, datasetProblems } = require('./market-data');
const { instrumentOf } = require('./instruments');
const { marketSession } = require('./calendar');

const EXPLICIT_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function parseQuoteCsv(text) {
  const lines = String(text).split(/\r?\n/).filter((line) => line.trim());
  if (lines[0] !== 'instrument,time,bid,ask') return { ok: false, errors: ['The header must be instrument,time,bid,ask.'] };
  const rows = [];
  const errors = [];
  const seen = new Set();
  lines.slice(1).forEach((line, index) => {
    const at = index + 2;
    const [instrument, time, bid, ask, extra] = line.split(',');
    if (extra !== undefined) return errors.push(`Line ${at}: too many columns.`);
    if (!EXPLICIT_OFFSET.test(time || '')) return errors.push(`Line ${at}: time needs an explicit offset.`);
    const checked = checkQuote({ instrument, time, bid, ask });
    if (!checked.ok) return errors.push(`Line ${at}: ${checked.reason}.`);
    const key = `${instrument}|${checked.time.toISOString()}`;
    if (seen.has(key)) return errors.push(`Line ${at}: duplicate quote.`);
    seen.add(key);
    rows.push({ instrument, time: checked.time, bid, ask });
    return undefined;
  });
  return errors.length ? { ok: false, errors } : { ok: true, rows };
}

/** What an import would do. Read-only. */
function planImport({ manifest, csvText, env = process.env }) {
  const errors = [];
  if (manifest && manifest.testFixture === true) errors.push('Test fixtures cannot be imported.');
  for (const problem of datasetProblems(manifest, env)) errors.push(`Manifest: ${problem}.`);
  const parsed = parseQuoteCsv(csvText);
  if (!parsed.ok) errors.push(...parsed.errors);
  if (errors.length) return { ok: false, errors };
  const rows = parsed.rows;
  const outside = rows.filter((row) => !marketSession(row.time).open).length;
  const unknown = rows.filter((row) => !manifest.instruments.includes(row.instrument) || !instrumentOf(row.instrument)).length;
  if (unknown) return { ok: false, errors: [`${unknown} quotes are for instruments the manifest does not list.`] };
  return { ok: true, quotes: rows.length, outsideSession: outside, rows };
}

/** Writes a planned import. The dataset is left inactive: activating it is a separate decision. */
async function applyImport(db, { manifest, plan }) {
  const { _id, ...fields } = manifest;
  await db.collection(COLLECTIONS.datasets).updateOne({ _id }, { $set: { ...fields, active: false } }, { upsert: true });
  const docs = plan.rows.map((row) => ({ datasetId: _id, instrument: row.instrument, time: row.time, bid: Decimal128.fromString(row.bid), ask: Decimal128.fromString(row.ask) }));
  for (let i = 0; i < docs.length; i += 1000) await db.collection(COLLECTIONS.quotes).insertMany(docs.slice(i, i + 1000), { ordered: false });
  return { imported: docs.length };
}

module.exports = { applyImport, parseQuoteCsv, planImport };
