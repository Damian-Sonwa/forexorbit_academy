'use strict';

/**
 * Safety guard for the Phase 4 acceptance harness (scripts/acceptance/run.js).
 *
 * The harness writes synthetic data and starts the real application, so it only ever runs against
 * a dedicated, disposable database:
 *   - its own variables: ACCEPTANCE_MONGODB_URI and ACCEPTANCE_DB_NAME. The application's
 *     MONGO_URI / MONGODB_URI are never used, and a test URI equal to either is refused;
 *   - the database name must end in "_acceptance" or "_test" and must not be a production name;
 *   - the host must be local (localhost, 127.0.0.1, ::1) unless ACCEPTANCE_ALLOW_REMOTE is set to
 *     "dedicated-test-cluster" (a separate Atlas project or cluster used only for testing);
 *   - the database must be empty, or carry this harness's marker document (nothing else's data).
 * Nothing here prints the URI.
 */

const PRODUCTION_DATABASE_NAMES = Object.freeze(['forex_elearning']);
const NAME_PATTERN = /^[A-Za-z0-9_-]+_(acceptance|test)$/;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const REMOTE_OPT_IN = 'dedicated-test-cluster';
const MARKER_COLLECTION = 'acceptanceHarness';
const MARKER = Object.freeze({ _id: 'forexorbit-phase-4-acceptance', kind: 'forexorbit-acceptance-fixtures' });

function hostsOf(uri) {
  const match = /^mongodb(?:\+srv)?:\/\/(?:[^@/]*@)?([^/?]+)/.exec(uri);
  if (!match) return [];
  return match[1].split(',').map((h) => h.replace(/:\d+$/, '').toLowerCase());
}

function uriDatabase(uri) {
  const match = /^mongodb(?:\+srv)?:\/\/[^/]+\/([^?]*)/.exec(uri);
  return match ? decodeURIComponent(match[1]) : '';
}

/** Pure check of the configuration. Returns { ok, uri, dbName, hosts } or { ok: false, reason }. */
function checkAcceptanceConfig(env = process.env) {
  const uri = String(env.ACCEPTANCE_MONGODB_URI || '').trim();
  const dbName = String(env.ACCEPTANCE_DB_NAME || '').trim();
  if (!uri) return { ok: false, reason: 'ACCEPTANCE_MONGODB_URI is not set (put it in .env.acceptance, which Git ignores).' };
  if (!/^mongodb(\+srv)?:\/\//.test(uri)) return { ok: false, reason: 'ACCEPTANCE_MONGODB_URI is not a MongoDB connection string.' };
  for (const name of ['MONGO_URI', 'MONGODB_URI']) {
    if (String(env[name] || '').trim() === uri) return { ok: false, reason: `ACCEPTANCE_MONGODB_URI is the same as ${name}; use a separate test server.` };
  }
  if (!dbName) return { ok: false, reason: 'ACCEPTANCE_DB_NAME is not set.' };
  if (PRODUCTION_DATABASE_NAMES.includes(dbName.toLowerCase())) return { ok: false, reason: 'ACCEPTANCE_DB_NAME is a production database name.' };
  if (!NAME_PATTERN.test(dbName)) return { ok: false, reason: 'ACCEPTANCE_DB_NAME must end in "_acceptance" or "_test".' };
  const inUri = uriDatabase(uri);
  if (inUri && PRODUCTION_DATABASE_NAMES.includes(inUri.toLowerCase())) return { ok: false, reason: 'The test URI names a production database.' };
  const hosts = hostsOf(uri);
  if (!hosts.length) return { ok: false, reason: 'The test URI has no host.' };
  const remote = hosts.some((h) => !LOCAL_HOSTS.has(h));
  if (remote && String(env.ACCEPTANCE_ALLOW_REMOTE || '') !== REMOTE_OPT_IN) {
    return { ok: false, reason: `The test server is not local. Set ACCEPTANCE_ALLOW_REMOTE=${REMOTE_OPT_IN} only for a cluster used solely for testing.` };
  }
  return { ok: true, uri, dbName, hosts: remote ? 'remote (opted in)' : 'local' };
}

/** The database must be empty or belong to this harness. */
async function checkDisposable(db) {
  const collections = (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name);
  if (!collections.length) return { ok: true, fresh: true };
  if (collections.includes(MARKER_COLLECTION)) {
    const marker = await db.collection(MARKER_COLLECTION).findOne({ _id: MARKER._id });
    if (marker && marker.kind === MARKER.kind) return { ok: true, fresh: false };
  }
  return { ok: false, reason: 'The test database already holds data that this harness did not create; use an empty database.' };
}

module.exports = { MARKER, MARKER_COLLECTION, NAME_PATTERN, PRODUCTION_DATABASE_NAMES, REMOTE_OPT_IN, checkAcceptanceConfig, checkDisposable, hostsOf, uriDatabase };
