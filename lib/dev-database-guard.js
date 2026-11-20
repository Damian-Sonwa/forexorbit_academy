'use strict';

/**
 * Local development must never reach the production database by default.
 *
 * getDb() falls back to `Forex_elearning` (production) when MONGODB_DB_NAME is unset, which is what
 * production relies on. Outside production (NODE_ENV !== 'production'), the application refuses to
 * start unless MONGODB_DB_NAME names a database that is clearly not production: it must end in
 * _dev, _test, _acceptance or _local, and must not be a production name. There is no override;
 * production is started with `npm start` (scripts/start-production.js sets NODE_ENV=production).
 *
 * This guards the database NAME. A development database on the production cluster (with a
 * credential that can reach production) still passes; keep development data on its own cluster.
 * Nothing here reads or prints the connection string.
 */

const PRODUCTION_DATABASE_NAMES = Object.freeze(['forex_elearning']);
const NON_PRODUCTION_NAME = /^[A-Za-z0-9_-]+_(dev|test|acceptance|local)$/i;

function checkDevelopmentDatabase(env = process.env) {
  if (env.NODE_ENV === 'production') return { ok: true };
  const name = String(env.MONGODB_DB_NAME || '').trim();
  if (!name) {
    return { ok: false, reason: 'MONGODB_DB_NAME is not set. Outside production the application needs an explicit local, dev or test database (a name ending in _dev, _test, _acceptance or _local); it never defaults to the production database.' };
  }
  if (PRODUCTION_DATABASE_NAMES.includes(name.toLowerCase())) {
    return { ok: false, reason: `MONGODB_DB_NAME is the production database (${name}). Outside production that is refused; production starts with npm start.` };
  }
  if (!NON_PRODUCTION_NAME.test(name)) {
    return { ok: false, reason: `MONGODB_DB_NAME "${name}" must end in _dev, _test, _acceptance or _local outside production.` };
  }
  return { ok: true };
}

/** Throws with a clear message when development would reach a production database name. */
function assertDevelopmentDatabase(env = process.env) {
  const result = checkDevelopmentDatabase(env);
  if (!result.ok) throw new Error(`Refusing to start: ${result.reason}`);
}

module.exports = { NON_PRODUCTION_NAME, PRODUCTION_DATABASE_NAMES, assertDevelopmentDatabase, checkDevelopmentDatabase };
