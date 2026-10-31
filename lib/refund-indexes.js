'use strict';

/**
 * Unique indexes for `paystackRefunds` (lib/payment-refunds.js, Phase 5).
 *
 *   F1 uniq_refund_request       requestId: one record per admin request (double-submit safe)
 *   F2 uniq_open_refund_payment  paymentReference where open: true: at most one unfinished refund
 *                                per payment, which is what prevents duplicate refunds
 *   F3 uniq_provider_refund      providerRefundId where present: one record per Paystack refund
 *
 * The collection is new, so building them cannot meet existing duplicates. The application never
 * builds them (its role may not create indexes); scripts/refund-indexes.js does, with a privileged
 * account, read-only unless --apply, and never drops or changes an index.
 */

const { COLLECTIONS } = require('./course-payment');

const REFUND_INDEXES = Object.freeze([
  Object.freeze({ id: 'F1', collection: COLLECTIONS.refunds, key: { requestId: 1 }, options: { name: 'uniq_refund_request', unique: true } }),
  Object.freeze({
    id: 'F2',
    collection: COLLECTIONS.refunds,
    key: { paymentReference: 1 },
    options: { name: 'uniq_open_refund_payment', unique: true, partialFilterExpression: { open: true } },
  }),
  Object.freeze({
    id: 'F3',
    collection: COLLECTIONS.refunds,
    key: { providerRefundId: 1 },
    options: { name: 'uniq_provider_refund', unique: true, partialFilterExpression: { providerRefundId: { $exists: true } } },
  }),
]);

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** present | missing | conflicting. */
function compareRefundIndex(definition, existing) {
  const exact = (index) => same(index.key, definition.key) && index.unique === true && !index.sparse
    && same(index.partialFilterExpression, definition.options.partialFilterExpression);
  const byName = existing.find((index) => index.name === definition.options.name);
  if (byName) return exact(byName) ? 'present' : 'conflicting';
  if (existing.some((index) => same(index.key, definition.key))) return 'conflicting';
  return 'missing';
}

async function refundIndexReport(db) {
  let existing;
  try {
    existing = await db.collection(COLLECTIONS.refunds).indexes();
  } catch (error) {
    const missing = error && (error.code === 26 || error.codeName === 'NamespaceNotFound');
    return REFUND_INDEXES.map((d) => ({ id: d.id, name: d.options.name, state: missing ? 'missing' : 'unknown' }));
  }
  return REFUND_INDEXES.map((d) => ({ id: d.id, name: d.options.name, state: compareRefundIndex(d, existing) }));
}

/** Read-only unless `apply`; builds only missing indexes and refuses on unknown or conflicting. */
async function ensureRefundIndexes(db, { apply = false, log = () => {} } = {}) {
  const before = await refundIndexReport(db);
  for (const s of before) log(`index ${s.id} ${s.name}: ${s.state}`);
  if (!apply) return { ok: true, built: [], states: before };
  if (before.some((s) => s.state === 'unknown' || s.state === 'conflicting')) {
    log('Refusing to build: an index state is unknown or conflicting.');
    return { ok: false, built: [], states: before };
  }
  const built = [];
  for (const d of REFUND_INDEXES) {
    if (before.find((s) => s.id === d.id).state !== 'missing') continue;
    await db.collection(d.collection).createIndex(d.key, d.options);
    built.push(d.options.name);
  }
  const after = await refundIndexReport(db);
  for (const s of after) log(`index ${s.id} ${s.name}: ${s.state}`);
  return { ok: after.every((s) => s.state === 'present'), built, states: after };
}

module.exports = { REFUND_INDEXES, compareRefundIndex, ensureRefundIndexes, refundIndexReport };
