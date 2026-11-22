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

/**
 * Hard cap so a stuck command cannot block the handler past `ms`. Phase 15: the timer is cleared
 * when the ping answers; before, it always fired and logged "deadline exceeded" 10 s after every
 * deep health check, even a successful one (a false alarm in the logs).
 */
export async function checkMongoWithDeadline(ms: number, db: Db): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => {
      console.error('[checkMongo] deadline exceeded', ms, 'ms');
      resolve(false);
    }, ms);
  });
  try {
    return await Promise.race([checkMongo(db), deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
