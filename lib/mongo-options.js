'use strict';

/**
 * MongoDB client settings and connection recovery (Phase 15), shared by lib/mongodb.js
 * (server.js and plain scripts) and db/mongoClient.ts (Next API routes), which share one client.
 *
 *   serverSelectionTimeoutMS 10 s   a request fails within ~10 s when the database is unreachable,
 *                                   instead of the driver's 30 s default (requests piled up)
 *   connectTimeoutMS 10 s
 *   maxPoolSize 50 (MONGO_MAX_POOL_SIZE)  bounded per process; Atlas tiers cap total connections
 *   maxIdleTimeMS 5 min             idle sockets are released
 *
 * A failed first connection used to leave a rejected promise in the global cache, so every request
 * failed until the process restarted. connectShared() drops a failed attempt, so the next request
 * tries again.
 */

function clientOptions(env = process.env) {
  const pool = Number(env.MONGO_MAX_POOL_SIZE);
  return {
    maxPoolSize: Number.isInteger(pool) && pool >= 5 && pool <= 500 ? pool : 50,
    serverSelectionTimeoutMS: 10_000,
    connectTimeoutMS: 10_000,
    maxIdleTimeMS: 300_000,
    appName: 'forexorbit-academy',
  };
}

/** The shared client promise; a failed connection attempt is forgotten so the next call retries. */
function connectShared(MongoClient, uri, holder = global) {
  if (!holder._mongoClientPromise) {
    const client = new MongoClient(uri, clientOptions());
    const attempt = client.connect();
    holder._mongoClientPromise = attempt;
    attempt.catch((error) => {
      if (holder._mongoClientPromise === attempt) holder._mongoClientPromise = undefined;
      // The reason helps operators (DNS, allowlist, auth, timeout); connection strings are removed.
      const reason = error && error.message ? String(error.message).replace(/mongodb(\+srv)?:\/\/\S+/g, '<uri>').slice(0, 200) : 'unknown';
      console.error(JSON.stringify({ event: 'mongoConnect', result: 'failed', error: error && error.name ? error.name : 'Error', reason, retry: 'next request' }));
    });
  }
  return holder._mongoClientPromise;
}

module.exports = { clientOptions, connectShared };
