/**
 * Mongo ping for /api/health — uses an existing DB instance (shared connection pool),
 * never opens a separate MongoClient for health checks.
 */

import type { Db } from 'mongodb';

export async function checkMongo(existingDb: Db | null | undefined): Promise<boolean> {
  try {
    if (!existingDb) return false;

    await existingDb.command({ ping: 1 });
    return true;
  } catch (e) {
    console.error('DB ping failed', e instanceof Error ? e.message : e);
    return false;
  }
}

/** Hard cap so a stuck command cannot block the handler past `ms`. */
export async function checkMongoWithDeadline(ms: number, db: Db): Promise<boolean> {
  return Promise.race([
    checkMongo(db),
    new Promise<boolean>((resolve) => {
      setTimeout(() => {
        console.error('[checkMongo] deadline exceeded', ms, 'ms');
        resolve(false);
      }, ms);
    }),
  ]);
}
