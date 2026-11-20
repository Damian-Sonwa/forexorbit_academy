'use strict';

/**
 * In-place conversion of an existing non-unique index to unique (MongoDB 6.0+ collMod), for A4:
 * production's quizzes_lesson { lessonId: 1 } on `quizzes`. The index is never dropped, so the
 * collection is never without it.
 *
 * Stages (inspectConversion, read-only):
 *   no collection | absent | unexpected   stop: the index is not the expected one
 *   non-unique    the starting state                          next: prepare
 *   prepared      prepareUnique: true. NEW duplicate keys are rejected (E11000); existing
 *                 duplicates are NOT checked                  next: convert (or abort)
 *   unique        done (listIndexes shows unique: true and no prepareUnique)
 *
 * Steps (each refuses unless its preflight passes; each verifies after itself):
 *   prepare  non-unique -> prepared. Needs clean data: no duplicate, null, missing or wrong-type key.
 *   convert  prepared -> unique. Rechecks the data, runs collMod with dryRun first (reports
 *            CannotConvertIndexToUnique without changing anything), then converts.
 *   abort    prepared -> non-unique (prepareUnique: false). A unique index cannot be made
 *            non-unique again by collMod ("Cannot make index non-unique").
 * Rerunning a step that is already done changes nothing. A run interrupted after prepare leaves
 * the index prepared, which is safe (it only rejects new duplicates); inspect, then convert or abort.
 * Every step also checks that no other index of the collection and no collection option changed.
 *
 * The signed-in user must hold collMod (plus find and listIndexes) on the collection; a user
 * without it (the Phase 10 indexer) is refused before any command that could change anything.
 * Nothing here deletes, changes or inserts a document.
 */

const A4_CONVERSION = Object.freeze({
  id: 'A4',
  collection: 'quizzes',
  indexName: 'quizzes_lesson',
  key: Object.freeze({ lessonId: 1 }),
  field: 'lessonId',
  valueType: 'string',
});

/** Every conversion this module knows (one): its collections are covered by the app role test. */
const CONVERSIONS = Object.freeze([A4_CONVERSION]);

const UNEXPECTED_OPTIONS = ['sparse', 'hidden', 'partialFilterExpression', 'expireAfterSeconds', 'collation', 'weights', 'wildcardProjection'];
const sameKey = (a, b) => JSON.stringify(Object.entries(a || {})) === JSON.stringify(Object.entries(b || {}));
const omit = (object, keys) => Object.fromEntries(Object.entries(object).filter(([k]) => !keys.includes(k)));
const strip = (index) => omit(index, ['v', 'ns', 'background']);
const errorName = (error) => String((error && (error.codeName || error.code)) || 'error').replace(/[^\w-]/g, '').slice(0, 40);

function stageOf(index, target) {
  if (!index) return { stage: 'absent', problems: [`no index named ${target.indexName}`] };
  const problems = [];
  if (!sameKey(index.key, target.key)) problems.push(`key ${JSON.stringify(index.key)} (expected ${JSON.stringify(target.key)})`);
  for (const option of UNEXPECTED_OPTIONS) {
    if (index[option] !== undefined && index[option] !== false && !(option === 'collation' && index.collation.locale === 'simple')) {
      problems.push(`${option} ${JSON.stringify(index[option])}`);
    }
  }
  if (problems.length) return { stage: 'unexpected', problems };
  if (index.unique === true) return { stage: 'unique', problems };
  if (index.prepareUnique === true) return { stage: 'prepared', problems };
  return { stage: 'non-unique', problems };
}

/** Read-only: the index stage, the data checks and a fingerprint of everything else. */
async function inspectConversion(db, target = A4_CONVERSION) {
  const [info] = await db.listCollections({ name: target.collection }).toArray();
  if (!info) return { stage: 'no collection', problems: [`collection ${target.collection} does not exist`], data: null, fingerprint: null };
  const coll = db.collection(target.collection);
  const indexes = (await coll.indexes()).map(strip);
  const index = indexes.find((i) => i.name === target.indexName);
  const { stage, problems } = stageOf(index, target);
  const field = target.field;
  const [documents, nullOrMissing, wrongType, dupes] = await Promise.all([
    coll.countDocuments({}),
    coll.countDocuments({ [field]: null }),
    coll.countDocuments({ [field]: { $exists: true, $ne: null, $not: { $type: target.valueType } } }),
    coll.aggregate([{ $group: { _id: `$${field}`, n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }, { $count: 'groups' }], { allowDiskUse: true }).toArray(),
  ]);
  const duplicateGroups = dupes.length ? dupes[0].groups : 0;
  const others = indexes.filter((i) => i.name !== target.indexName).sort((a, b) => (a.name < b.name ? -1 : 1));
  return {
    stage,
    problems,
    index: index || null,
    data: { documents, duplicateGroups, nullOrMissing, wrongType, clean: duplicateGroups === 0 && nullOrMissing === 0 && wrongType === 0 },
    fingerprint: JSON.stringify({ others, options: info.options || {}, type: info.type, key: index ? index.key : null, name: index ? index.name : null }),
  };
}

/** Whether the signed-in user may run collMod, find and listIndexes on the collection. */
async function checkPrivileges(db, target = A4_CONVERSION) {
  const status = await db.command({ connectionStatus: 1, showPrivileges: true });
  const info = status.authInfo || {};
  if (!(info.authenticatedUsers || []).length) return { ok: true, authentication: false, missing: [] };
  const held = new Set();
  for (const p of info.authenticatedUserPrivileges || []) {
    const r = p.resource || {};
    const dbMatches = r.db === db.databaseName || r.db === '';
    const onCollection = r.anyResource === true || (dbMatches && (r.collection === target.collection || r.collection === ''));
    const onDatabase = r.anyResource === true || (dbMatches && r.collection === '');
    if (r.cluster) continue;
    for (const action of p.actions || []) {
      if (onCollection) held.add(action);
      if (onDatabase) held.add(`db:${action}`);
    }
  }
  const missing = ['collMod', 'find', 'listIndexes'].filter((a) => !held.has(a));
  if (!held.has('db:listCollections')) missing.push('listCollections (database)');
  return { ok: missing.length === 0, authentication: true, missing };
}

async function collMod(db, target, indexChange, extra = {}) {
  return db.command({ collMod: target.collection, index: { name: target.indexName, ...indexChange }, ...extra });
}

const refused = (step, before, reason) => ({ ok: false, step, changed: false, before, after: before, reason });

async function guarded(db, target, step) {
  const privileges = await checkPrivileges(db, target);
  if (!privileges.ok) {
    return { ok: false, step, changed: false, reason: `the signed-in user lacks ${privileges.missing.join(', ')} on ${db.databaseName}.${target.collection}; nothing was sent` };
  }
  return null;
}

/** prepare: non-unique -> prepared. */
async function prepareUnique(db, target = A4_CONVERSION) {
  const denied = await guarded(db, target, 'prepare');
  if (denied) return denied;
  const before = await inspectConversion(db, target);
  if (before.stage === 'prepared' || before.stage === 'unique') return { ok: true, step: 'prepare', changed: false, before, after: before, reason: `already ${before.stage}` };
  if (before.stage !== 'non-unique') return refused('prepare', before, `index is ${before.stage}: ${before.problems.join('; ')}`);
  if (!before.data.clean) return refused('prepare', before, dataReason(before.data));
  try {
    await collMod(db, target, { prepareUnique: true });
  } catch (error) {
    return { ...refused('prepare', before, `collMod prepareUnique failed (${errorName(error)})`), after: await inspectConversion(db, target) };
  }
  const after = await inspectConversion(db, target);
  return verify('prepare', before, after, 'prepared');
}

/** convert: prepared -> unique, after a dry run. */
async function convertToUnique(db, target = A4_CONVERSION) {
  const denied = await guarded(db, target, 'convert');
  if (denied) return denied;
  const before = await inspectConversion(db, target);
  if (before.stage === 'unique') return { ok: true, step: 'convert', changed: false, before, after: before, reason: 'already unique' };
  if (before.stage !== 'prepared') return refused('convert', before, `index is ${before.stage}${before.stage === 'non-unique' ? ': run the prepare step first' : `: ${before.problems.join('; ')}`}`);
  if (!before.data.clean) return refused('convert', before, dataReason(before.data));
  try {
    await collMod(db, target, { unique: true }, { dryRun: true });
  } catch (error) {
    const violations = error && error.errorResponse && Array.isArray(error.errorResponse.violations) ? error.errorResponse.violations.length : 0;
    return refused('convert', before, `dry run refused (${errorName(error)}${violations ? `, ${violations} conflicting group(s)` : ''}); the index stays prepared`);
  }
  try {
    await collMod(db, target, { unique: true });
  } catch (error) {
    return { ...refused('convert', before, `collMod unique failed (${errorName(error)}); the index stays prepared`), after: await inspectConversion(db, target) };
  }
  const after = await inspectConversion(db, target);
  return verify('convert', before, after, 'unique');
}

/** abort: prepared -> non-unique. Never applies to a unique index. */
async function abortPrepare(db, target = A4_CONVERSION) {
  const denied = await guarded(db, target, 'abort');
  if (denied) return denied;
  const before = await inspectConversion(db, target);
  if (before.stage === 'non-unique') return { ok: true, step: 'abort', changed: false, before, after: before, reason: 'not prepared' };
  if (before.stage !== 'prepared') return refused('abort', before, `index is ${before.stage}; only a prepared index can be returned to non-unique`);
  try {
    await collMod(db, target, { prepareUnique: false });
  } catch (error) {
    return { ...refused('abort', before, `collMod prepareUnique false failed (${errorName(error)})`), after: await inspectConversion(db, target) };
  }
  const after = await inspectConversion(db, target);
  return verify('abort', before, after, 'non-unique');
}

function dataReason(data) {
  return `data not clean: ${data.duplicateGroups} duplicate group(s), ${data.nullOrMissing} null or missing, ${data.wrongType} of another type; nothing was changed`;
}

function verify(step, before, after, expected) {
  const problems = [];
  if (after.stage !== expected) problems.push(`stage is ${after.stage}, expected ${expected}`);
  if (after.fingerprint !== before.fingerprint) problems.push('another index, the key, the name or a collection option changed');
  return { ok: problems.length === 0, step, changed: true, before, after, reason: problems.length ? `verification failed: ${problems.join('; ')}` : `now ${after.stage}` };
}

module.exports = { A4_CONVERSION, CONVERSIONS,abortPrepare, checkPrivileges, convertToUnique, inspectConversion, prepareUnique, stageOf };
