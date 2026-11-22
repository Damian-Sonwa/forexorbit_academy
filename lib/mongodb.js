/**
 * MongoDB Connection Utility (CommonJS)
 * For use in server.js
 * Uses the same connection pattern as db/mongoClient.ts
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { MongoClient } = require('mongodb');

const uri = (process.env.MONGO_URI || process.env.MONGODB_URI)?.trim();
if (!uri) {
  throw new Error(
    'MongoDB URI not set. Add MONGO_URI (or MONGODB_URI) to .env.local with your connection string.'
  );
}

// Validate URI format
if (!uri.startsWith('mongodb')) {
  throw new Error('MONGO_URI / MONGODB_URI must start with mongodb:// or mongodb+srv://');
}

// Outside production, an explicit non-production MONGODB_DB_NAME is required (lib/dev-database-guard.js).
require('./dev-database-guard').assertDevelopmentDatabase();

// One client per process, shared with the Next API routes (db/mongoClient.ts) through this
// global, so server.js and the API use one connection pool. Phase 15: bounded timeouts and pool,
// and a failed connection is retried on the next call (lib/mongo-options.js).
const { connectShared } = require('./mongo-options');
connectShared(MongoClient, uri);

/** MONGODB_DB_NAME isolates local or test data; unset keeps the shared Forex_elearning database. */
async function getDb(dbName = process.env.MONGODB_DB_NAME?.trim() || 'Forex_elearning') {
  const client = await connectShared(MongoClient, uri);
  return client.db(dbName);
}

module.exports = { getDb, getClient: () => connectShared(MongoClient, uri) };

