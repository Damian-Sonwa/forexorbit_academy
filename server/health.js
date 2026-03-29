/**
 * Shared MongoDB check for plain Node scripts (e.g. node -e "require('./server/health')").
 * Same timeouts as lib/check-mongo.ts — keep in sync if you change limits.
 */

const { MongoClient } = require('mongodb');

const CLIENT_OPTS = {
  serverSelectionTimeoutMS: 8000,
  connectTimeoutMS: 8000,
};

async function checkMongo() {
  const uri = (process.env.MONGO_URI || process.env.MONGODB_URI || '').trim();
  if (!uri) return false;

  let client;
  try {
    client = new MongoClient(uri, CLIENT_OPTS);
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
