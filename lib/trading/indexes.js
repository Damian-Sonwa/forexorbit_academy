'use strict';

/**
 * Practice simulator indexes (Phase 10). Read-only unless `apply`; scripts/trading-indexes.js.
 * Correctness does not depend on them: identity comes from deterministic _ids and account
 * version checks. T6 and T8 are second guarantees; the rest serve reads.
 */

const { compareAssessmentIndex } = require('../assessment-indexes');

const TRADING_INDEXES = Object.freeze([
  Object.freeze({ id: 'T1', collection: 'tradingPositions', key: { accountId: 1, status: 1 }, options: { name: 'trading_position_account_status' } }),
  Object.freeze({ id: 'T2', collection: 'tradingPositions', key: { userId: 1, status: 1, openedAt: -1 }, options: { name: 'trading_position_user_recent' } }),
  Object.freeze({ id: 'T3', collection: 'tradingOrders', key: { accountId: 1, status: 1 }, options: { name: 'trading_order_account_status' } }),
  Object.freeze({ id: 'T4', collection: 'tradingOrders', key: { userId: 1, createdAt: -1 }, options: { name: 'trading_order_user_recent' } }),
  Object.freeze({ id: 'T5', collection: 'tradingOperations', key: { status: 1, createdAt: 1 }, options: { name: 'trading_operation_status' } }),
  Object.freeze({ id: 'T6', collection: 'tradingLedger', key: { accountId: 1, seq: 1 }, options: { name: 'trading_ledger_account_seq', unique: true }, duplicateKey: ['accountId', 'seq'] }),
  Object.freeze({ id: 'T7', collection: 'tradingLedger', key: { userId: 1, createdAt: -1 }, options: { name: 'trading_ledger_user_recent' } }),
  Object.freeze({ id: 'T8', collection: 'marketQuotes', key: { datasetId: 1, instrument: 1, time: 1 }, options: { name: 'market_quote_dataset_instrument_time', unique: true }, duplicateKey: ['datasetId', 'instrument', 'time'] }),
  Object.freeze({ id: 'T9', collection: 'tradingAccounts', key: { userId: 1 }, options: { name: 'trading_account_user' } }),
  Object.freeze({ id: 'T10', collection: 'tradingAccountSlots', key: { leaderboardOptIn: 1 }, options: { name: 'trading_slot_leaderboard' } }),
]);

async function duplicateGroups(db, definition) {
  if (!definition.duplicateKey) return 0;
  const _id = Object.fromEntries(definition.duplicateKey.map((field) => [field, `$${field}`]));
  const rows = await db.collection(definition.collection).aggregate([{ $group: { _id, count: { $sum: 1 } } }, { $match: { count: { $gt: 1 } } }, { $count: 'groups' }]).toArray();
  return rows.length ? rows[0].groups : 0;
}

async function tradingIndexReport(db) {
  const names = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
  const report = [];
  for (const definition of TRADING_INDEXES) {
    const exists = names.has(definition.collection);
    const existing = exists ? await db.collection(definition.collection).indexes() : [];
    report.push({ id: definition.id, collection: definition.collection, name: definition.options.name, state: exists ? compareAssessmentIndex(definition, existing) : 'no collection', duplicates: exists ? await duplicateGroups(db, definition) : 0 });
  }
  return report;
}

async function ensureTradingIndexes(db, { apply = false } = {}) {
  const before = await tradingIndexReport(db);
  const blocked = before.filter((r) => r.state === 'conflicting' || r.duplicates > 0);
  if (!apply) return { ok: blocked.length === 0, built: [], report: before };
  if (blocked.length) return { ok: false, built: [], report: before, blocked: blocked.map((r) => r.id) };
  const built = [];
  for (const definition of TRADING_INDEXES) {
    const row = before.find((r) => r.id === definition.id);
    if (row.state === 'missing' || row.state === 'no collection') {
      await db.collection(definition.collection).createIndex(definition.key, definition.options);
      built.push(definition.id);
    }
  }
  const after = await tradingIndexReport(db);
  return { ok: after.every((r) => r.state === 'present'), built, report: after };
}

module.exports = { TRADING_INDEXES, ensureTradingIndexes, tradingIndexReport };
