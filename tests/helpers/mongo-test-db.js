'use strict';

/**
 * Connection to the dedicated MongoDB test database for real-MongoDB integration tests.
 *
 * Only MONGODB_URI_TEST is used. MONGO_URI and MONGODB_URI (the application's, and in production
 * the live cluster's) are never read here, so a missing test setting cannot fall back to them.
 * The database name must look like a test database and must not be the production name; tests
 * may drop only that database. Tests skip when MONGODB_URI_TEST is unset.
 *
 * Environment:
 *   MONGODB_URI_TEST       connection string for an isolated server (for example a local container)
 *   MONGODB_DB_NAME_TEST   database name, default Forex_elearning_r1_test (must end in _test)
 */

const PRODUCTION_DB_NAME = 'Forex_elearning';
const DEFAULT_TEST_DB_NAME = 'Forex_elearning_r1_test';
const TEST_NAME = /^[A-Za-z0-9_-]+_test$/;

/**
 * The test target, or { ok: false, reason } explaining why there is none. Never throws, never
 * reveals the connection string.
 */
function testDatabaseConfig(env = process.env) {
  const uri = String(env.MONGODB_URI_TEST || '').trim();
  if (!uri) return { ok: false, reason: 'MONGODB_URI_TEST is not set; real-MongoDB tests are skipped.' };
  if (!/^mongodb(\+srv)?:\/\//.test(uri)) return { ok: false, reason: 'MONGODB_URI_TEST is not a MongoDB connection string.' };
  for (const name of ['MONGO_URI', 'MONGODB_URI']) {
    if (String(env[name] || '').trim() === uri) {
      return { ok: false, reason: `MONGODB_URI_TEST is the same as ${name}; the test server must be a separate one.` };
    }
  }
  const dbName = String(env.MONGODB_DB_NAME_TEST || DEFAULT_TEST_DB_NAME).trim();
  if (dbName === PRODUCTION_DB_NAME || dbName.toLowerCase() === PRODUCTION_DB_NAME.toLowerCase()) {
    return { ok: false, reason: 'The test database cannot be the production database.' };
  }
  if (!TEST_NAME.test(dbName)) {
    return { ok: false, reason: `Test database names must end in "_test" (got "${dbName}").` };
  }
  return { ok: true, uri, dbName };
}

/**
 * Opens the test database. Returns { client, db, dbName, reset, close }. `reset` drops the test
 * database only after re-checking its name.
 */
async function openTestDatabase(env = process.env, { serverSelectionTimeoutMS = 5000 } = {}) {
  const config = testDatabaseConfig(env);
  if (!config.ok) throw new Error(config.reason);
  const { MongoClient } = require('mongodb');
  const client = new MongoClient(config.uri, { serverSelectionTimeoutMS });
  await client.connect();
  const db = client.db(config.dbName);
  return {
    client,
    db,
    dbName: config.dbName,
    async reset() {
      if (!TEST_NAME.test(db.databaseName) || db.databaseName === PRODUCTION_DB_NAME) {
        throw new Error('Refusing to drop a database that is not a test database.');
      }
      await db.dropDatabase();
    },
    close: () => client.close(),
  };
}

module.exports = { DEFAULT_TEST_DB_NAME, PRODUCTION_DB_NAME, openTestDatabase, testDatabaseConfig };
