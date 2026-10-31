'use strict';

/**
 * Indexes for the `sessions` collection (lib/session-core.js, Phase 4.5).
 *
 *   S1 userId            revoke every session of an account (sign out everywhere, security events)
 *   S2 familyId          revoke one sign-in and its rotations (sign out, reuse detection)
 *   S3 absoluteExpiresAt TTL: MongoDB deletes a record one day after its absolute expiry. Records are
 *                        kept until then (also when revoked or rotated) so a replayed old id is
 *                        recognised as reuse rather than as unknown.
 *
 * Lookups by session id use `_id`, which always has its own index. None of these is unique, so
 * building them never rejects or changes a document. The application never builds them: its
 * database role may not create indexes. A privileged account runs scripts/session-indexes.js once.
 */

const SESSION_INDEXES = Object.freeze([
  Object.freeze({ id: 'S1', key: { userId: 1 }, options: { name: 'session_user' } }),
  Object.freeze({ id: 'S2', key: { familyId: 1 }, options: { name: 'session_family' } }),
  Object.freeze({ id: 'S3', key: { absoluteExpiresAt: 1 }, options: { name: 'session_ttl', expireAfterSeconds: 86400 } }),
]);

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** present | missing | conflicting for one definition against the collection's current indexes. */
function compareSessionIndex(definition, existing) {
  const exact = (index) => same(index.key, definition.key)
    && !index.unique && !index.sparse && !index.partialFilterExpression
    && (index.expireAfterSeconds ?? null) === (definition.options.expireAfterSeconds ?? null);
  const byName = existing.find((index) => index.name === definition.options.name);
  if (byName) return exact(byName) ? 'present' : 'conflicting';
  if (existing.some((index) => same(index.key, definition.key))) return 'conflicting';
  return 'missing';
}

/**
 * The state of every session index: { states: [{ id, name, state }], readable }. When the indexes
 * cannot be listed (the app role cannot), every state is "unknown". A collection that does not
 * exist yet has no indexes: every state is "missing".
 */
async function sessionIndexReport(db) {
  let existing;
  try {
    existing = await db.collection('sessions').indexes();
  } catch (error) {
    const missing = error && (error.code === 26 || error.codeName === 'NamespaceNotFound');
    return {
      readable: missing,
      states: SESSION_INDEXES.map((d) => ({ id: d.id, name: d.options.name, state: missing ? 'missing' : 'unknown' })),
    };
  }
  return {
    readable: true,
    states: SESSION_INDEXES.map((d) => ({ id: d.id, name: d.options.name, state: compareSessionIndex(d, existing) })),
  };
}

/**
 * Read-only unless `apply`. With `apply`, builds only the missing indexes, and only when no index
 * is unknown or conflicting. Never drops or changes an index. Idempotent: a second run is a no-op.
 */
async function ensureSessionIndexes(db, { apply = false, log = () => {} } = {}) {
  const before = await sessionIndexReport(db);
  for (const s of before.states) log(`index ${s.id} ${s.name}: ${s.state}`);
  if (!apply) return { ok: true, built: [], states: before.states };
  if (before.states.some((s) => s.state === 'unknown')) {
    log('Refusing to build: this account cannot list the indexes.');
    return { ok: false, built: [], states: before.states };
  }
  if (before.states.some((s) => s.state === 'conflicting')) {
    log('Refusing to build: an index with the same name or key but different options exists.');
    return { ok: false, built: [], states: before.states };
  }
  const built = [];
  for (const definition of SESSION_INDEXES) {
    if (before.states.find((s) => s.id === definition.id).state !== 'missing') continue;
    await db.collection('sessions').createIndex(definition.key, definition.options);
    built.push(definition.options.name);
  }
  const after = await sessionIndexReport(db);
  for (const s of after.states) log(`index ${s.id} ${s.name}: ${s.state}`);
  return { ok: after.states.every((s) => s.state === 'present'), built, states: after.states };
}

module.exports = { SESSION_INDEXES, compareSessionIndex, ensureSessionIndexes, sessionIndexReport };
