/**
 * Fast-fail Mongo ping for /api/health and tooling.
 * Uses short timeouts so the HTTP handler never hangs on bad network / Atlas.
 */

import { MongoClient } from 'mongodb';

const CLIENT_OPTS = {
  serverSelectionTimeoutMS: 4_000,
  connectTimeoutMS: 4_000,
  socketTimeoutMS: 4_000,
} as const;

/** Hard cap so the driver cannot block the event loop past `ms` (extra safety on Windows). */
export async function checkMongoWithDeadline(ms: number): Promise<boolean> {
  return Promise.race([
    checkMongo(),
    new Promise<boolean>((resolve) => {
      setTimeout(() => {
        console.error('[checkMongo] deadline exceeded', ms, 'ms');
        resolve(false);
      }, ms);
    }),
  ]);
}

export async function checkMongo(): Promise<boolean> {
  const uri = (process.env.MONGO_URI || process.env.MONGODB_URI || '').trim();
  if (!uri) return false;

  let client: MongoClient | undefined;
  try {
    client = new MongoClient(uri, CLIENT_OPTS);
    await client.connect();
    await client.db().command({ ping: 1 });
    return true;
  } catch (e) {
    console.error('[checkMongo]', e instanceof Error ? e.message : e);
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
