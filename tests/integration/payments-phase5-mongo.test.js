/**
 * Phase 5 payments against a real MongoDB server (npm run test:mongo:payments).
 *
 * Builds the real unique indexes (course payment I1-I6 and refund F1-F3) in an isolated test
 * database and runs checkout confirmation, refunds, concurrent refund requests, reconciliation and
 * payment history through the official driver. Paystack is a stub; nothing leaves the machine.
 *
 * Requires MONGODB_URI_TEST (an isolated server, never production) and MONGODB_DB_NAME_TEST
 * (must end in "_test"). Skipped when MONGODB_URI_TEST is unset.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');

const { openTestDatabase, testDatabaseConfig } = require('../helpers/mongo-test-db');
const payment = require('../../lib/course-payment');
const refunds = require('../../lib/payment-refunds');
const { runReconciliation } = require('../../lib/payment-reconciliation');
const { listUserPayments } = require('../../lib/payment-history');
const { COURSE_PAYMENT_INDEXES } = require('../../lib/course-payment-indexes');
const { REFUND_INDEXES, ensureRefundIndexes } = require('../../lib/refund-indexes');

const config = testDatabaseConfig();
const skip = config.ok ? false : config.reason;
const { COLLECTIONS } = payment;
const NOW = new Date('2026-11-05T12:00:00Z');
const later = (ms) => new Date(NOW.getTime() + ms);
const SUPER = { userId: new ObjectId().toHexString(), email: 'owner@example.test', role: 'superadmin' };
let seq = 0;

async function fresh() {
  const conn = await openTestDatabase();
  await conn.reset();
  for (const index of COURSE_PAYMENT_INDEXES) await conn.db.collection(index.collection).createIndex(index.key, index.options);
  const built = await ensureRefundIndexes(conn.db, { apply: true });
  assert.equal(built.ok, true);
  return conn;
}

const lookupFor = (map) => async (key) => map[key] || { outcome: 'not_found' };

async function paidCourse(db, userId, courseId) {
  const created = await payment.createCourseIntent(db, { userId, courseId, fetchTransaction: lookupFor({}), makeReference: () => `fo_c_int_${++seq}_abcdef12`, now: NOW });
  const intent = await db.collection(COLLECTIONS.intents).findOne({ reference: created.reference });
  const data = { id: 880000 + seq, status: 'success', reference: intent.reference, amount: intent.amountKobo, currency: 'NGN', metadata: { userId, courseId } };
  const result = await payment.confirmCoursePayment(db, { reference: intent.reference, source: 'checkout', sessionUserId: userId, expectedCourseId: courseId, fetchTransaction: lookupFor({ [intent.reference]: { outcome: 'found', data } }), now: NOW });
  assert.equal(result.ok, true);
  return intent;
}

test('real MongoDB: the refund indexes exist with their partial filters, and building them twice is a no-op', { skip }, async () => {
  const conn = await fresh();
  try {
    const indexes = await conn.db.collection(COLLECTIONS.refunds).indexes();
    for (const def of REFUND_INDEXES) {
      const found = indexes.find((i) => i.name === def.options.name);
      assert.ok(found, def.options.name);
      assert.equal(found.unique, true);
      assert.deepEqual(found.partialFilterExpression || null, def.options.partialFilterExpression || null);
    }
    assert.deepEqual((await ensureRefundIndexes(conn.db, { apply: true })).built, []);
  } finally {
    await conn.close();
  }
});

test('real MongoDB: concurrent refund requests for one payment reach Paystack once (open-refund unique index)', { skip }, async () => {
  const conn = await fresh();
  try {
    const db = conn.db;
    const userId = new ObjectId().toHexString();
    const courseId = new ObjectId().toHexString();
    const intent = await paidCourse(db, userId, courseId);
    let calls = 0;
    const createRefund = async () => { calls += 1; return { outcome: 'created', data: { id: `rf_int_${calls}`, status: 'pending' } }; };
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => refunds.requestRefund(db, {
      reference: intent.reference, revokeAccess: true, reason: 'Concurrent refund test', requestId: `req-int-${i}-abcdef`, actor: SUPER, createRefund, now: NOW,
    })));
    assert.equal(results.filter((r) => r.ok).length, 1);
    assert.ok(results.filter((r) => !r.ok).every((r) => r.code === 'refund_in_progress'));
    assert.equal(calls, 1);
    assert.equal(await db.collection(COLLECTIONS.refunds).countDocuments({}), 1);
  } finally {
    await conn.close();
  }
});

test('real MongoDB: a processed full refund with removal ends access, keeps the payment, and is finished exactly once', { skip }, async () => {
  const conn = await fresh();
  try {
    const db = conn.db;
    const userId = new ObjectId().toHexString();
    const courseId = new ObjectId().toHexString();
    const intent = await paidCourse(db, userId, courseId);
    const out = await refunds.requestRefund(db, { reference: intent.reference, revokeAccess: true, reason: 'Course not suitable', requestId: 'req-int-full-0001', actor: SUPER, createRefund: async () => ({ outcome: 'created', data: { id: 'rf_int_full', status: 'pending' } }), now: NOW });
    assert.equal(out.refund.status, 'pending');
    assert.equal(await payment.hasCourseEntitlement(db, userId, courseId), true);
    const fetchRefund = async () => ({ outcome: 'found', data: { id: 'rf_int_full', status: 'processed' } });
    for (let i = 0; i < 3; i += 1) {
      await refunds.processRefundEvent(db, 'refund.processed', { id: 'rf_int_full', transaction_reference: intent.reference, amount: 1000000 }, { fetchRefund, now: later(i * 60000) });
    }
    assert.equal(await payment.hasCourseEntitlement(db, userId, courseId), false);
    const pay = await db.collection(COLLECTIONS.payments).findOne({ reference: intent.reference });
    assert.deepEqual([pay.status, pay.refundState, pay.refundedKobo], ['success', 'refunded', 1000000]);
    const refund = await db.collection(COLLECTIONS.refunds).findOne({});
    assert.deepEqual([refund.status, 'open' in refund, refund.accessOutcome], ['processed', false, 'revoked']);
    assert.equal(await db.collection('adminAuditLog').countDocuments({ action: 'refund_processed' }), 1);
    // After the refund closed, a new refund on the same payment is refused as nothing is left.
    const again = await refunds.requestRefund(db, { reference: intent.reference, revokeAccess: false, reason: 'again', requestId: 'req-int-full-0002', actor: SUPER, createRefund: fetchRefund, now: later(10 * 60000) });
    assert.equal(again.code, 'nothing_to_refund');
  } finally {
    await conn.close();
  }
});

test('real MongoDB: reconciliation settles a paid-but-unconfirmed checkout and leaves an unpaid one pending', { skip }, async () => {
  const conn = await fresh();
  try {
    const db = conn.db;
    const userId = new ObjectId().toHexString();
    const paidCourseId = new ObjectId().toHexString();
    const unpaidCourseId = new ObjectId().toHexString();
    const mk = async (courseId) => {
      const r = await payment.createCourseIntent(db, { userId, courseId, fetchTransaction: lookupFor({}), makeReference: () => `fo_c_int_${++seq}_abcdef12`, now: NOW });
      return db.collection(COLLECTIONS.intents).findOne({ reference: r.reference });
    };
    const paid = await mk(paidCourseId);
    const unpaid = await mk(unpaidCourseId);
    const fetchTransaction = lookupFor({
      [paid.reference]: { outcome: 'found', data: { id: 99, status: 'success', reference: paid.reference, amount: paid.amountKobo, currency: 'NGN', metadata: { userId, courseId: paidCourseId } } },
      [unpaid.reference]: { outcome: 'found', data: { status: 'abandoned', reference: unpaid.reference } },
    });
    const report = await runReconciliation(db, { apply: true, fetchTransaction, fetchRefund: lookupFor({}), listRefunds: lookupFor({}), now: later(15 * 60000) });
    assert.ok(report.items.some((i) => i.reference === paid.reference && i.action === 'granted'));
    assert.equal(await payment.hasCourseEntitlement(db, userId, paidCourseId), true);
    assert.equal(await payment.hasCourseEntitlement(db, userId, unpaidCourseId), false);
    assert.equal((await db.collection(COLLECTIONS.intents).findOne({ _id: unpaid._id })).status, 'pending');
    const history = await listUserPayments(db, userId);
    assert.deepEqual(history.map((h) => h.status), ['paid']);
  } finally {
    await conn.close();
  }
});
