'use strict';

/**
 * Unique enrollment index for `progress` (Phase 6).
 *
 *   E1 uniq_enrollment_user_course  { userId: 1, courseId: 1 }: one enrollment row per student and
 *      course. The enroll route checks for an existing row and then inserts, so two concurrent
 *      requests could both insert; with E1 the second insert fails and the route answers
 *      "Already enrolled" (lib/enrollment-state.js enrollDuplicateStatus). Payment-driven and
 *      grant-driven enrollments (lib/enrollment-store.js) rely on it the same way.
 *
 * `progress` already holds rows, so the build can meet duplicates. The scan below runs first:
 *   - exact duplicates (same userId and courseId values and types) would make the build fail, so
 *     --apply refuses while any exist;
 *   - rows whose courseId is stored as an ObjectId next to a string row for the same pair are not
 *     rejected by the index (different types) but are logical duplicates; they are reported.
 * Duplicates are never merged or deleted here: they hold students' history and need review.
 * The application never builds this index (its role may not); scripts/enrollment-indexes.js does,
 * with a privileged account, read-only unless --apply, and never drops or changes an index.
 */

const ENROLLMENT_COLLECTION = 'progress';

const ENROLLMENT_INDEXES = Object.freeze([
  Object.freeze({
    id: 'E1',
    collection: ENROLLMENT_COLLECTION,
    key: { userId: 1, courseId: 1 },
    options: { name: 'uniq_enrollment_user_course', unique: true },
  }),
]);

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** present | missing | conflicting. */
function compareEnrollmentIndex(definition, existing) {
  const exact = (index) => same(index.key, definition.key) && index.unique === true && !index.sparse
    && !index.partialFilterExpression;
  const byName = existing.find((index) => index.name === definition.options.name);
  if (byName) return exact(byName) ? 'present' : 'conflicting';
  if (existing.some((index) => same(index.key, definition.key))) return 'conflicting';
  return 'missing';
}

async function enrollmentIndexReport(db) {
  let existing;
  try {
    existing = await db.collection(ENROLLMENT_COLLECTION).indexes();
  } catch (error) {
    const missing = error && (error.code === 26 || error.codeName === 'NamespaceNotFound');
    return ENROLLMENT_INDEXES.map((d) => ({ id: d.id, name: d.options.name, state: missing ? 'missing' : 'unknown' }));
  }
  return ENROLLMENT_INDEXES.map((d) => ({ id: d.id, name: d.options.name, state: compareEnrollmentIndex(d, existing) }));
}

/** Counts only (no ids) of rows that share a student and course. */
async function enrollmentDuplicateReport(db) {
  const progress = db.collection(ENROLLMENT_COLLECTION);
  const count = async (pipeline) => {
    const [row] = await progress.aggregate([...pipeline, { $count: 'groups' }]).toArray();
    return row ? row.groups : 0;
  };
  const exactGroups = await count([
    { $group: { _id: { u: '$userId', c: '$courseId' }, n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } },
  ]);
  const anyTypeGroups = await count([
    { $group: { _id: { u: { $toString: '$userId' }, c: { $toString: '$courseId' } }, n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } },
  ]);
  return { exactGroups, crossTypeGroups: Math.max(0, anyTypeGroups - exactGroups) };
}

/** Read-only unless `apply`; builds only a missing index, never with exact duplicates present. */
async function ensureEnrollmentIndexes(db, { apply = false, log = () => {} } = {}) {
  const before = await enrollmentIndexReport(db);
  for (const s of before) log(`index ${s.id} ${s.name}: ${s.state}`);
  let duplicates = null;
  if (before.some((s) => s.state === 'missing')) {
    duplicates = await enrollmentDuplicateReport(db);
    log(`duplicate enrollment groups: ${duplicates.exactGroups} exact, ${duplicates.crossTypeGroups} stored with different id types`);
  }
  if (!apply) return { ok: true, built: [], states: before, duplicates };
  if (before.some((s) => s.state === 'unknown' || s.state === 'conflicting')) {
    log('Refusing to build: an index state is unknown or conflicting.');
    return { ok: false, built: [], states: before, duplicates };
  }
  if (duplicates && duplicates.exactGroups > 0) {
    log('Refusing to build: exact duplicate enrollments exist. Review them first; nothing was changed.');
    return { ok: false, built: [], states: before, duplicates };
  }
  const built = [];
  for (const d of ENROLLMENT_INDEXES) {
    if (before.find((s) => s.id === d.id).state !== 'missing') continue;
    await db.collection(d.collection).createIndex(d.key, d.options);
    built.push(d.options.name);
  }
  const after = await enrollmentIndexReport(db);
  for (const s of after) log(`index ${s.id} ${s.name}: ${s.state}`);
  return { ok: after.every((s) => s.state === 'present'), built, states: after, duplicates };
}

module.exports = {
  ENROLLMENT_COLLECTION,
  ENROLLMENT_INDEXES,
  compareEnrollmentIndex,
  enrollmentDuplicateReport,
  enrollmentIndexReport,
  ensureEnrollmentIndexes,
};
