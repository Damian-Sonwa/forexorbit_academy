#!/usr/bin/env node
'use strict';

/**
 * Communication worker, on demand (Phase 14). Without --apply it only reports the delivery figures
 * (no email, push or announcement is sent). With --apply it runs one worker tick, the same one
 * server.js runs on an interval: due scheduled announcements, then queued emails and pushes, each
 * bounded and idempotent. Uses MONGODB_URI / MONGODB_DB_NAME like the other scripts.
 */

const { getDb } = require('../lib/mongodb');
const { deliveryStats } = require('../lib/communication/delivery');
const { runTick } = require('../lib/communication/worker');

(async () => {
  const apply = process.argv.includes('--apply');
  const db = await getDb();
  const before = await deliveryStats(db, { windowHours: 24 });
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'report', queueDepth: before.queueDepth, retrying: before.retrying, email: before.email, suppressedAddresses: before.suppressedAddresses }, null, 2));
  if (apply) console.log(JSON.stringify(await runTick(db), null, 2));
  process.exit(0);
})().catch(() => {
  console.error(JSON.stringify({ event: 'communicationWorkerScript', result: 'failed' }));
  process.exit(1);
});
