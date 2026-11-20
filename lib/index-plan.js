'use strict';

/**
 * Shared index planning for scripts/learning-indexes.js, scripts/assessment-indexes.js and
 * scripts/trading-indexes.js. One comparison decides the report AND the apply step.
 *
 * An existing index satisfies a definition when its key pattern (fields, order and direction) and
 * every option that changes what the index accepts or serves are the same. The NAME does not have
 * to match: production keeps older names (lessons_course_order for L2, quizscores_user_course for
 * L3, quizzes_lesson for A4), and MongoDB will not build a second index on the same key under
 * another name. The satisfying index's name is reported.
 *
 * Options compared: unique, sparse, hidden, prepareUnique, expireAfterSeconds (TTL),
 * partialFilterExpression, collation, and the text / geo / wildcard options. Anything else
 * (v, ns, background, ...) does not change behaviour and is ignored.
 *
 * States:
 *   present        an existing index satisfies the definition (`satisfiedBy`, `coverage`)
 *   missing        nothing to conflict with; --apply builds it
 *   no collection  the collection does not exist; --apply builds the index and so CREATES the
 *                  collection (`createsCollection: true`)
 *   conflicting    an index has the definition's name with another definition, or the same key
 *                  with other options (`reasons`). Never built over, never dropped: needs review.
 *
 * A definition may set `coveredByPrefix: true` (L1 only): then an existing index whose key STARTS
 * WITH the definition's key, with no partial filter, sparse, collation or hidden flag, serves the
 * same queries and also counts as present (`coverage: 'prefix'`). This is never inferred.
 *
 * Nothing here deletes or changes a document, or drops or modifies an index.
 */

const SCALAR_OPTIONS = Object.freeze(['unique', 'sparse', 'hidden', 'prepareUnique']);
const VALUE_OPTIONS = Object.freeze([
  'expireAfterSeconds', 'partialFilterExpression', 'weights', 'default_language', 'language_override',
  'textIndexVersion', '2dsphereIndexVersion', 'bits', 'min', 'max', 'bucketSize', 'wildcardProjection',
]);

const asNumber = (value) => (value && typeof value === 'object' && typeof value.toNumber === 'function' ? value.toNumber() : value);

/** Order-insensitive for object keys (filter documents), order-sensitive for arrays. */
function canonical(value) {
  const v = asNumber(value);
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])]));
  }
  return v === undefined ? null : v;
}

const sameValue = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

/** Key patterns are ordered: { a: 1, b: 1 } is not { b: 1, a: 1 }. 1 and 1.0 are the same. */
const keyEntries = (key) => Object.entries(key || {}).map(([field, dir]) => [field, asNumber(dir)]);
const sameKey = (a, b) => JSON.stringify(keyEntries(a)) === JSON.stringify(keyEntries(b));
function keyHasPrefix(key, prefix) {
  const k = keyEntries(key);
  const p = keyEntries(prefix);
  return p.length <= k.length && JSON.stringify(k.slice(0, p.length)) === JSON.stringify(p);
}

/** Collation: none on both, or every field the definition gives equal on the index. */
function collationDifference(wanted, actual) {
  const real = actual && actual.locale !== 'simple' ? actual : null;
  if (!wanted) return real ? `collation ${JSON.stringify(real)} (required: none)` : null;
  if (!real) return `no collation (required: ${JSON.stringify(wanted)})`;
  const bad = Object.keys(wanted).filter((k) => !sameValue(wanted[k], real[k]));
  return bad.length ? `collation ${bad.map((k) => `${k} ${JSON.stringify(real[k])} (required ${JSON.stringify(wanted[k])})`).join(', ')}` : null;
}

/** The option differences between a definition and an existing index with the same key. */
function optionDifferences(definition, index) {
  const wanted = definition.options || {};
  const out = [];
  for (const name of SCALAR_OPTIONS) {
    const want = Boolean(wanted[name]);
    const have = Boolean(index[name]);
    if (want !== have) out.push(name === 'prepareUnique' && have ? 'prepareUnique true (a unique conversion was started and not finished)' : `${name} ${have} (required ${want})`);
  }
  for (const name of VALUE_OPTIONS) {
    if (!sameValue(wanted[name], index[name])) out.push(`${name} ${JSON.stringify(index[name] ?? null)} (required ${JSON.stringify(wanted[name] ?? null)})`);
  }
  const collation = collationDifference(wanted.collation, index.collation);
  if (collation) out.push(collation);
  return out;
}

const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/**
 * Classifies one definition against the indexes of an existing collection.
 * Returns { state, satisfiedBy?, coverage?, reasons }. Deterministic: when several existing
 * indexes satisfy it, the one with the definition's own name wins, then the first by name.
 */
function classifyIndex(definition, existing) {
  const wantedName = definition.options.name;
  const sameKeyIndexes = existing.filter((index) => sameKey(index.key, definition.key)).sort(byName);
  const exact = sameKeyIndexes.filter((index) => optionDifferences(definition, index).length === 0);
  if (exact.length) {
    const chosen = exact.find((index) => index.name === wantedName) || exact[0];
    return { state: 'present', satisfiedBy: chosen.name, coverage: chosen.name === wantedName ? 'exact' : 'equivalent', reasons: [] };
  }
  const reasons = [];
  const named = existing.find((index) => index.name === wantedName);
  if (named) {
    reasons.push(sameKey(named.key, definition.key)
      ? `${named.name}: ${optionDifferences(definition, named).join('; ')}`
      : `${named.name} exists with key ${JSON.stringify(named.key)} (required ${JSON.stringify(definition.key)})`);
  }
  for (const index of sameKeyIndexes) {
    if (index.name !== wantedName) reasons.push(`${index.name} (same key): ${optionDifferences(definition, index).join('; ')}`);
  }
  if (reasons.length) return { state: 'conflicting', reasons };
  if (definition.coveredByPrefix) {
    const cover = existing
      .filter((index) => keyHasPrefix(index.key, definition.key) && !index.partialFilterExpression && !index.sparse && !index.hidden
        && !collationDifference(null, index.collation))
      .sort(byName)[0];
    if (cover) return { state: 'present', satisfiedBy: cover.name, coverage: 'prefix', reasons: [] };
  }
  return { state: 'missing', reasons: [] };
}

/** Number of key groups that a unique definition would reject (read-only aggregation). */
async function duplicateGroups(db, definition) {
  if (!definition.options.unique) return 0;
  const fields = definition.duplicateKey || Object.keys(definition.key);
  const _id = Object.fromEntries(fields.map((field) => [field, `$${field}`]));
  const partial = definition.options.partialFilterExpression;
  const rows = await db.collection(definition.collection).aggregate([
    ...(partial ? [{ $match: partial }] : []),
    { $group: { _id, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $count: 'groups' },
  ], { allowDiskUse: true }).toArray();
  return rows.length ? rows[0].groups : 0;
}

/**
 * Read-only plan: listCollections, listIndexes and (for unique definitions not yet present) a
 * duplicate count. One row per definition.
 */
async function planIndexes(db, definitions) {
  const names = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
  const cache = new Map();
  const rows = [];
  for (const definition of definitions) {
    const exists = names.has(definition.collection);
    if (exists && !cache.has(definition.collection)) cache.set(definition.collection, await db.collection(definition.collection).indexes());
    const result = exists ? classifyIndex(definition, cache.get(definition.collection)) : { state: 'no collection', reasons: [] };
    const duplicates = exists && result.state !== 'present' ? await duplicateGroups(db, definition) : 0;
    rows.push({
      id: definition.id,
      collection: definition.collection,
      name: definition.options.name,
      key: definition.key,
      ...result,
      duplicates,
      createsCollection: !exists,
      definition,
    });
  }
  return rows;
}

const blockedRows = (rows) => rows.filter((r) => r.state === 'conflicting' || r.duplicates > 0);
const toBuild = (rows) => rows.filter((r) => r.state === 'missing' || r.state === 'no collection');
const errorName = (error) => String((error && (error.codeName || error.code)) || 'error').replace(/[^\w-]/g, '').slice(0, 40);

/**
 * Builds the missing indexes, only after a preflight with no conflict and no duplicate. Refuses as
 * a whole otherwise (builds nothing). Stops at the first failed build and reports what was built
 * before it; never reports success unless a fresh plan shows every definition present.
 */
async function applyIndexPlan(db, definitions) {
  const before = await planIndexes(db, definitions);
  const blocked = blockedRows(before);
  if (blocked.length) return { ok: false, built: [], report: before, blocked: blocked.map((r) => r.id) };
  const built = [];
  for (const row of toBuild(before)) {
    try {
      await db.collection(row.collection).createIndex(row.definition.key, row.definition.options);
    } catch (error) {
      const report = await planIndexes(db, definitions).catch(() => before);
      return { ok: false, built, report, failed: { id: row.id, error: errorName(error) } };
    }
    built.push(row.id);
  }
  const after = await planIndexes(db, definitions);
  return { ok: after.every((r) => r.state === 'present'), built, report: after };
}

/** One report line; the same text in report and apply mode. */
function describeRow(row, { withKey = false } = {}) {
  const head = `${row.id} ${row.collection}${withKey ? ` ${JSON.stringify(row.key)}` : ''} ${row.name}: ${row.state}`;
  const notes = [];
  if (row.state === 'present' && row.coverage === 'equivalent') notes.push(`satisfied by existing ${row.satisfiedBy}`);
  if (row.state === 'present' && row.coverage === 'prefix') notes.push(`covered by the prefix of existing ${row.satisfiedBy}`);
  if (row.state === 'no collection') notes.push(`--apply would create collection ${row.collection}`);
  if (row.state === 'conflicting') notes.push(row.reasons.join(' | '));
  if (row.duplicates) notes.push(`${row.duplicates} duplicate group(s)`);
  return notes.length ? `${head} (${notes.join('; ')})` : head;
}

/** The summary printed after the rows: exactly what --apply would do, or why it refuses. */
function describePlan(rows) {
  const build = toBuild(rows);
  const blocked = blockedRows(rows);
  const lines = [];
  lines.push(build.length ? `Would build: ${build.map((r) => `${r.id} (${r.collection}.${r.name})`).join(', ')}.` : 'Would build: nothing.');
  const created = [...new Set(build.filter((r) => r.createsCollection).map((r) => r.collection))];
  if (created.length) lines.push(`Would create collections: ${created.join(', ')}.`);
  if (blocked.length) lines.push(`Blocked: ${blocked.map((r) => r.id).join(', ')}. --apply refuses and builds nothing until they are resolved.`);
  return lines;
}

module.exports = {
  applyIndexPlan,
  blockedRows,
  canonical,
  classifyIndex,
  describePlan,
  describeRow,
  duplicateGroups,
  errorName,
  optionDifferences,
  planIndexes,
  sameKey,
  toBuild,
};
