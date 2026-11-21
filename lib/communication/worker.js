'use strict';

/**
 * The communication worker tick (Phase 14), run by server.js on an interval and by
 * scripts/communication-worker.js on demand: publishes due scheduled announcements, then sends due
 * emails and pushes. Each step is bounded and idempotent (claims are conditional updates; emails
 * carry a provider idempotency key), so overlapping or repeated ticks never send twice. A failing
 * step is logged (no contents, no addresses) and does not stop the others.
 */

const { processEmailQueue } = require('./delivery');
const { processPushQueue } = require('./web-push');
const { createEmailSender } = require('./email-sender');
const { publishDue } = require('./announcements');
const { deliverToRecipients } = require('./deliver');
const metrics = require('./metrics');

async function runTick(db, { send = createEmailSender(), sendPush, now = new Date() } = {}) {
  const summary = { announcements: 0, email: null, push: null, errors: [] };
  try {
    const due = await publishDue(db, { now });
    for (const n of due) {
      const { userIds, ...params } = n;
      await deliverToRecipients(db, params, userIds, { now });
      summary.announcements += 1;
    }
  } catch {
    summary.errors.push('announcements');
  }
  try {
    summary.email = await processEmailQueue(db, { send, now });
  } catch {
    summary.errors.push('email');
  }
  try {
    summary.push = await processPushQueue(db, { ...(sendPush ? { send: sendPush } : {}), now });
  } catch {
    summary.errors.push('push');
  }
  metrics.worker(summary);
  if (summary.errors.length) {
    metrics.count('workerFailures');
    console.error(JSON.stringify({ event: 'communicationWorker', result: 'partial', failed: summary.errors }));
  }
  return summary;
}

module.exports = { runTick };
