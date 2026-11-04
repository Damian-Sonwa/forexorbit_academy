'use strict';

/**
 * Retention and deletion of practice-trading data (Phase 10, P10-26).
 * Policy, classification and the points needing legal review: docs/audits/phase-10-practice-trading.md.
 *
 * Personal: journals, submissions and task completions. Deleted when the student is deleted.
 * Linkable: the user id on accounts, orders, positions and operations, and the leaderboard alias.
 *   The alias is deleted; the user id is removed.
 * Financial audit: the ledger and the anonymous account, order and position rows. Kept for
 *   RETENTION_DAYS after anonymisation so that the books still reconcile, then purged.
 *
 * The ledger holds no user id. It links to a person only through the account, so removing that one
 * link makes it anonymous without changing a ledger row. Everything here can be repeated safely, and
 * it runs before the user row is deleted, so a failure leaves work that a retry finishes.
 */

const E = require('./engine');

const { COLLECTIONS } = E;
/** Proposed periods, pending legal review. */
const RETENTION_DAYS = 730;
const INACTIVE_DAYS = 1095;
const DAY_MS = 86400000;

async function anonymiseStudentTrading(db, userId, { now = new Date() } = {}) {
  const id = String(userId);
  const retainUntil = new Date(now.getTime() + RETENTION_DAYS * DAY_MS);
  const accounts = await db.collection(COLLECTIONS.accounts).find({ userId: id }, { projection: { _id: 1 } }).toArray();
  const ids = accounts.map((a) => a._id);

  // Open work ends without a price: nothing is closed or valued at an invented level.
  await db.collection(COLLECTIONS.orders).updateMany({ userId: id, status: { $in: ['pending', 'received'] } }, { $set: { status: 'cancelled', finishedAt: now } });
  await db.collection(COLLECTIONS.positions).updateMany({ userId: id, status: 'open' }, { $set: { status: 'void', closeReason: 'account_deleted', closedAt: now } });
  await db.collection(COLLECTIONS.orders).updateMany({ userId: id }, { $unset: { userId: '', clientOrderId: '' }, $set: { anonymisedAt: now } });
  await db.collection(COLLECTIONS.positions).updateMany({ userId: id }, { $unset: { userId: '' }, $set: { anonymisedAt: now } });
  await db.collection(COLLECTIONS.operations).updateMany({ userId: id }, { $unset: { userId: '' } });
  await db.collection(COLLECTIONS.slots).deleteOne({ _id: id });
  // The account goes last: it is what a retry finds the rest by.
  await db.collection(COLLECTIONS.accounts).updateMany({ userId: id }, { $set: { status: 'anonymised', anonymisedAt: now, retainUntil }, $unset: { userId: '', applied: '' } });

  await db.collection('demoTradeJournal').deleteMany({ studentId: id });
  await db.collection('demoTaskSubmissions').deleteMany({ studentId: id });
  await db.collection('demoTasks').updateMany({ [`completions.${id}`]: { $exists: true } }, { $unset: { [`completions.${id}`]: '' } });
  await db.collection('demoTasks').deleteMany({ assignedTo: id });
  await db.collection('demoTrades').deleteMany({ studentId: id });
  await db.collection('demoAccounts').deleteMany({ studentId: id });
  return { accounts: ids.length };
}

/** Anonymous records past their period. Read-only unless `apply`. Needs an operator account: the app role cannot remove ledger rows. */
async function purgeExpired(db, { now = new Date(), apply = false, limit = 500 } = {}) {
  const expired = await db.collection(COLLECTIONS.accounts).find({ status: 'anonymised', retainUntil: { $lte: now } }, { projection: { _id: 1 } }).limit(limit).toArray();
  const ids = expired.map((a) => a._id);
  if (apply && ids.length) {
    for (const name of [COLLECTIONS.ledger, COLLECTIONS.positions, COLLECTIONS.orders, COLLECTIONS.operations]) {
      await db.collection(name).deleteMany({ accountId: { $in: ids } });
    }
    await db.collection(COLLECTIONS.accounts).deleteMany({ _id: { $in: ids } });
  }
  return { expired: ids.length, purged: apply ? ids.length : 0 };
}

/** Students with trading records and no trading activity for INACTIVE_DAYS. Reported only: an owner decides. */
async function inactiveStudents(db, { now = new Date(), limit = 500 } = {}) {
  const cutoff = new Date(now.getTime() - INACTIVE_DAYS * DAY_MS);
  const rows = await db.collection(COLLECTIONS.accounts).find({ status: 'active', updatedAt: { $lte: cutoff } }, { projection: { userId: 1 } }).limit(limit).toArray();
  return rows.map((row) => row.userId);
}

module.exports = { INACTIVE_DAYS, RETENTION_DAYS, anonymiseStudentTrading, inactiveStudents, purgeExpired };
