/**
 * Shared MongoDB connectivity check for scripts and GET /api/health.
 * Supports MONGO_URI or MONGODB_URI (same as the rest of the app).
 */

const { MongoClient } = require('mongodb');

/**
 * @returns {Promise<boolean>} true if ping succeeds
 */
async function checkMongo() {
  const uri = (process.env.MONGO_URI || process.env.MONGODB_URI || '').trim();
  if (!uri) return false;

  let client;
  try {
    client = new MongoClient(uri);
    await client.connect();
    await client.db().command({ ping: 1 });
    return true;
  } catch (e) {
    console.error('DB ping failed', e instanceof Error ? e.message : e);
    return false;
  } finally {
    if (client) {
      try {
        await client.close();
      } catch {
        /* ignore */
      }
    }
  }
}

module.exports = { checkMongo };
