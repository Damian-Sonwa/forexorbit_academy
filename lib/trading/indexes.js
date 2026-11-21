'use strict';

/**
 * Practice simulator indexes (Phase 10). Read-only unless `apply`; scripts/trading-indexes.js.
 * Correctness does not depend on them: identity comes from deterministic _ids and account
 * version checks. T6, T8 and T11 are second guarantees; the rest serve reads. Unique ones carry a
 * `duplicateKey`: the report counts existing duplicates and --apply refuses while any exist. Nothing
 * here ever deletes or changes a document, or drops an index.
 */

const { applyIndexPlan, blockedRows, planIndexes } = require('../index-plan');

// T2, T4, T7 and T13 end with the history views' tie-breaker (lib/trading/views.js), so a page is read
// in index order instead of sorting the student's whole history in memory. Appending a field keeps
// every query the shorter key served.
const TRADING_INDEXES = Object.freeze([
  Object.freeze({ id: 'T1', collection: 'tradingPositions', key: { accountId: 1, status: 1 }, options: { name: 'trading_position_account_status' } }),
  Object.freeze({ id: 'T2', collection: 'tradingPositions', key: { userId: 1, status: 1, openedAt: -1, _id: -1 }, options: { name: 'trading_position_user_recent' } }),
  Object.freeze({ id: 'T3', collection: 'tradingOrders', key: { accountId: 1, status: 1 }, options: { name: 'trading_order_account_status' } }),
  Object.freeze({ id: 'T4', collection: 'tradingOrders', key: { userId: 1, createdAt: -1, _id: -1 }, options: { name: 'trading_order_user_recent' } }),
  Object.freeze({ id: 'T5', collection: 'tradingOperations', key: { status: 1, createdAt: 1 }, options: { name: 'trading_operation_status' } }),
  Object.freeze({ id: 'T6', collection: 'tradingLedger', key: { accountId: 1, seq: 1 }, options: { name: 'trading_ledger_account_seq', unique: true }, duplicateKey: ['accountId', 'seq'] }),
  Object.freeze({ id: 'T7', collection: 'tradingLedger', key: { accountId: 1, createdAt: -1, seq: -1 }, options: { name: 'trading_ledger_account_recent' } }),
  Object.freeze({ id: 'T8', collection: 'marketQuotes', key: { datasetId: 1, instrument: 1, time: 1 }, options: { name: 'market_quote_dataset_instrument_time', unique: true }, duplicateKey: ['datasetId', 'instrument', 'time'] }),
  Object.freeze({ id: 'T9', collection: 'tradingAccounts', key: { userId: 1 }, options: { name: 'trading_account_user' } }),
  Object.freeze({ id: 'T10', collection: 'tradingAccountSlots', key: { leaderboardOptIn: 1 }, options: { name: 'trading_slot_leaderboard' } }),
  Object.freeze({ id: 'T11', collection: 'marketCheckpoints', key: { datasetId: 1, instrument: 1, step: -1 }, options: { name: 'market_checkpoint_series', unique: true }, duplicateKey: ['datasetId', 'instrument', 'step'] }),
  Object.freeze({ id: 'T12', collection: 'marketIncidents', key: { marketId: 1, createdAt: -1 }, options: { name: 'market_incident_recent' } }),
  Object.freeze({ id: 'T13', collection: 'tradingOperations', key: { userId: 1, status: 1, executedAt: -1, _id: 1 }, options: { name: 'trading_operation_user_recent' } }),
  Object.freeze({ id: 'T14', collection: 'demoTasks', key: { assignedTo: 1, createdAt: -1 }, options: { name: 'demo_task_assignee_recent' } }),
  Object.freeze({ id: 'T15', collection: 'demoTaskSubmissions', key: { taskId: 1, studentId: 1 }, options: { name: 'demo_submission_task_student' } }),
  Object.freeze({ id: 'T16', collection: 'demoTaskSubmissions', key: { studentId: 1, submittedAt: -1 }, options: { name: 'demo_submission_student_recent' } }),
  // Background sweep (engine.js sweep): every open position in accountId order, resumed after the last
  // account seen. Equality on status, then range and sort on accountId: no in-memory sort, no scan of
  // closed positions. T1 ({ accountId, status }) cannot serve it, because its first field is unbounded.
  Object.freeze({ id: 'T17', collection: 'tradingPositions', key: { status: 1, accountId: 1 }, options: { name: 'trading_position_status_account' } }),
  // Background sweep (pending orders, in createdAt order) and recovery (received/executing orders older
  // than the stale cutoff, also in createdAt order). Same shape as T5 on tradingOperations.
  Object.freeze({ id: 'T18', collection: 'tradingOrders', key: { status: 1, createdAt: 1 }, options: { name: 'trading_order_status_created' } }),
  // Trade reviews (lib/trading/reviews.js): which of a student's trades are reviewed (covered by the
  // index), and an instructor's task-linked reviews, newest first.
  Object.freeze({ id: 'T19', collection: 'tradingReviews', key: { userId: 1, positionId: 1 }, options: { name: 'trading_review_user_position' } }),
  Object.freeze({ id: 'T20', collection: 'tradingReviews', key: { instructorId: 1, updatedAt: -1 }, options: { name: 'trading_review_instructor_recent' } }),
]);

/** Read-only: state, satisfying index and duplicate count of every trading index (lib/index-plan.js). */
async function tradingIndexReport(db) {
  return planIndexes(db, TRADING_INDEXES);
}

async function ensureTradingIndexes(db, { apply = false } = {}) {
  if (!apply) {
    const report = await planIndexes(db, TRADING_INDEXES);
    return { ok: blockedRows(report).length === 0, built: [], report };
  }
  return applyIndexPlan(db, TRADING_INDEXES);
}

module.exports = { TRADING_INDEXES, ensureTradingIndexes, tradingIndexReport };
