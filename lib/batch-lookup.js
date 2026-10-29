'use strict';

/**
 * One query for many documents by _id, instead of one findOne per row (N+1).
 *
 * `ids` are matched exactly as given, so callers keep the matching rules of the per-row lookup
 * they replace: pass ObjectIds where the old code did `new ObjectId(id)`, raw values where it
 * matched `{ _id: value }` directly. Returns a Map keyed by String(_id).
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ObjectId } = require('mongodb');

async function findByIds(collection, ids, projection) {
  const unique = [];
  const seen = new Set();
  for (const id of ids) {
    if (id == null) continue;
    const key = String(id);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(id);
  }
  if (unique.length === 0) return new Map();
  const options = projection ? { projection } : undefined;
  const docs = await collection.find({ _id: { $in: unique } }, options).toArray();
  return new Map(docs.map((doc) => [String(doc._id), doc]));
}

/** ObjectIds for the stored id strings that are valid; others are skipped (they cannot match). */
function objectIdsFrom(values) {
  return values.filter((value) => value != null && ObjectId.isValid(String(value)) && String(value).length === 24)
    .map((value) => new ObjectId(String(value)));
}

module.exports = { findByIds, objectIdsFrom };
