/**
 * Phase 5: refunds, reconciliation and recovery, webhook re-verification, payment history, route
 * authorization, indexes and secret handling. The real modules and route handlers run against an
 * in-memory database that enforces the real unique indexes (tests/helpers/payment-memory-db.js).
 * Paystack is a stub: no network call, charge or refund leaves the process.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ObjectId } = require('mongodb');

const payment = require('../lib/course-payment');
const refunds = require('../lib/payment-refunds');
const { runReconciliation } = require('../lib/payment-reconciliation');
const { listUserPayments } = require('../lib/payment-history');
const { REFUND_INDEXES, ensureRefundIndexes } = require('../lib/refund-indexes');
const { COURSE_PAYMENT_INDEXES } = require('../lib/course-payment-indexes');
const role = require('../lib/app-database-role');
const { paymentMemoryDb } = require('./helpers/payment-memory-db');
const { loadModule, mockResponse } = require('./helpers/ts-loader');
const { requestHeaders, seedSession } = require('./helpers/session-cookie');

const { COLLECTIONS } = payment;
const ROOT = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const INDEXES = [...COURSE_PAYMENT_INDEXES, ...REFUND_INDEXES];
const NOW = new Date('2026-11-05T12:00:00Z');
const later = (ms) => new Date(NOW.getTime() + ms);
const MIN = 60 * 1000;
const STUDENT = new ObjectId().toHexString();
const OTHER = new ObjectId().toHexString();
const COURSE = new ObjectId().toHexString();
const SUPER = { userId: new ObjectId().toHexString(), email: 'owner@example.test', role: 'superadmin' };

let seq = 0;
const makeReference = () => `fo_c_p5_${++seq}_abcdef12`;
const newDb = (extra = {}) => paymentMemoryDb({ uniqueIndexes: INDEXES, ...extra });

function provider(map = {}) {
  const calls = [];
  const fn = async (key) => {
    calls.push(key);
    const entry = map[key];
    if (typeof entry === 'function') return entry();
    return entry || { outcome: 'not_found' };
  };
  fn.calls = calls;
  return fn;
}

function successData(intent, overrides = {}) {
  return { id: 777000 + seq, status: 'success', reference: intent.reference, amount: intent.amountKobo, currency: 'NGN', paid_at: NOW.toISOString(), metadata: { userId: intent.userId, courseId: intent.courseId }, ...overrides };
}

async function startCheckout(db, userId = STUDENT, courseId = COURSE, now = NOW) {
  const result = await payment.createCourseIntent(db, { userId, courseId, fetchTransaction: provider(), makeReference, now });
  assert.equal(result.ok, true);
  return db.collection(COLLECTIONS.intents).findOne({ reference: result.reference });
}

/** A verified, granted course payment for STUDENT. */
async function paidCourse(db, userId = STUDENT, courseId = COURSE) {
  const intent = await startCheckout(db, userId, courseId);
  const data = successData(intent);
  const result = await payment.confirmCoursePayment(db, {
    reference: intent.reference, source: 'checkout', sessionUserId: userId, expectedCourseId: courseId,
    fetchTransaction: provider({ [intent.reference]: { outcome: 'found', data } }), now: NOW,
  });
  assert.equal(result.ok, true);
  return { intent, data };
}

const created = (id, status = 'pending') => async () => ({ outcome: 'created', data: { id, status } });
let requestSeq = 0;
const requestId = () => `req-${++requestSeq}-p5test`;

function refundInput(reference, extra = {}) {
  return { reference, revokeAccess: false, reason: 'Customer asked for a refund', requestId: requestId(), actor: SUPER, now: NOW, createRefund: created(`rf_${requestSeq}`), ...extra };
}

// ---------------------------------------------------------------------------
// Refunds
// ---------------------------------------------------------------------------

test('full refund with access removal: submitted -> pending (access kept) -> processed via verified webhook (access removed, history kept)', async () => {
  const db = newDb();
  const { intent } = await paidCourse(db);
  const out = await refunds.requestRefund(db, refundInput(intent.reference, { revokeAccess: true, createRefund: created('rf_full') }));
  assert.deepEqual([out.ok, out.status, out.code, out.refund.status, out.refund.amountKobo, out.refund.full], [true, 201, 'refund_submitted', 'pending', 1000000, true]);
  assert.equal(await payment.hasCourseEntitlement(db, STUDENT, COURSE), true, 'a submitted refund changes nothing');

  const fetchRefund = provider({ rf_full: { outcome: 'found', data: { id: 'rf_full', status: 'processed' } } });
  const ack = await payment.processWebhookEvent(db, { event: 'refund.processed', data: { id: 'rf_full', transaction_reference: intent.reference, amount: 1000000, status: 'processed' } }, later(MIN), {
    onRefundEvent: (event, data, at) => refunds.processRefundEvent(db, event, data, { fetchRefund, now: at }),
  });
  assert.deepEqual(ack, { ack: true, code: 'refund_processed' });
  assert.deepEqual(fetchRefund.calls, ['rf_full'], 'the status came from Paystack, not the event');
  assert.equal(await payment.hasCourseEntitlement(db, STUDENT, COURSE), false);
  const [access] = db.rows(COLLECTIONS.courseAccess);
  assert.deepEqual([access.paid, access.entitlementType, access.paystackReference], [false, 'refunded', intent.reference], 'the access row is kept, not deleted');
  const [pay] = db.rows(COLLECTIONS.payments);
  assert.deepEqual([pay.status, pay.refundState, pay.refundedKobo], ['success', 'refunded', 1000000], 'the payment stays as historical evidence');
  assert.equal(db.rows(COLLECTIONS.coursePurchases)[0].refundState, 'refunded');
  const [row] = db.rows(COLLECTIONS.refunds);
  assert.deepEqual([row.status, row.open, row.accessOutcome], ['processed', undefined, 'revoked']);
  assert.deepEqual(db.rows('adminAuditLog').map((a) => a.action).sort(), ['refund_processed', 'refund_requested']);
  // Redelivery changes nothing.
  const again = await payment.processWebhookEvent(db, { event: 'refund.processed', data: { id: 'rf_full', transaction_reference: intent.reference, amount: 1000000 } }, later(2 * MIN), {
    onRefundEvent: (event, data, at) => refunds.processRefundEvent(db, event, data, { fetchRefund, now: at }),
  });
  assert.deepEqual(again, { ack: true, code: 'refund_unchanged' });
  assert.equal(db.rows('adminAuditLog').length, 2);
});

test('refund requests are validated: Super Admin only, explicit access choice, amount bounds, revoke only on a full refund', async () => {
  const db = newDb();
  const { intent } = await paidCourse(db);
  const base = (extra) => refunds.requestRefund(db, refundInput(intent.reference, extra));
  assert.equal((await base({ actor: { ...SUPER, role: 'admin' } })).code, 'superadmin_required');
  assert.equal((await base({ revokeAccess: undefined })).code, 'revoke_choice_required');
  assert.equal((await base({ revokeAccess: 'yes' })).code, 'revoke_choice_required');
  assert.equal((await base({ reason: 'x' })).code, 'invalid_reason');
  assert.equal((await base({ requestId: 'short' })).code, 'invalid_request_id');
  assert.equal((await base({ amountKobo: 1000001 })).code, 'invalid_amount');
  assert.equal((await base({ amountKobo: 50 })).code, 'invalid_amount');
  assert.equal((await base({ amountKobo: 1234.5 })).code, 'invalid_amount');
  assert.equal((await base({ amountKobo: 300000, revokeAccess: true })).code, 'revoke_requires_full_refund');
  assert.equal((await refunds.requestRefund(db, refundInput('fo_c_unknown_ref1'))).code, 'payment_not_found');
  assert.equal((await refunds.requestRefund(db, refundInput('bad ref!'))).code, 'invalid_reference');
  assert.equal(db.rows(COLLECTIONS.refunds).length, 0, 'nothing was recorded or sent');
});

test('duplicate prevention: a repeated request id returns the same refund; a second concurrent refund is refused by the open-refund index', async () => {
  const db = newDb({ racy: true });
  const { intent } = await paidCourse(db);
  const createRefund = provider({});
  const calls = [];
  const create = async (input) => { calls.push(input); return { outcome: 'created', data: { id: `rf_c_${calls.length}`, status: 'pending' } }; };
  const id = requestId();
  const first = await refunds.requestRefund(db, { ...refundInput(intent.reference), requestId: id, createRefund: create });
  const replay = await refunds.requestRefund(db, { ...refundInput(intent.reference), requestId: id, createRefund: create });
  assert.deepEqual([first.code, replay.code, String(replay.refund._id)], ['refund_submitted', 'already_requested', String(first.refund._id)]);
  assert.equal(calls.length, 1, 'Paystack was called once');

  const db2 = newDb({ racy: true });
  const { intent: other } = await paidCourse(db2);
  const calls2 = [];
  const create2 = async () => { calls2.push(1); return { outcome: 'created', data: { id: `rf_d_${calls2.length}`, status: 'pending' } }; };
  const results = await Promise.all([1, 2, 3].map(() => refunds.requestRefund(db2, { ...refundInput(other.reference), createRefund: create2 })));
  assert.equal(results.filter((r) => r.ok).length, 1);
  assert.ok(results.filter((r) => !r.ok).every((r) => r.code === 'refund_in_progress'));
  assert.equal(calls2.length, 1, 'only one refund reached Paystack');
  assert.equal(createRefund.calls.length, 0);
});

test('partial refunds accumulate; access is kept; the payment cannot be over-refunded', async () => {
  const db = newDb();
  const { intent } = await paidCourse(db);
  const process = async (providerId) => {
    const row = db.rows(COLLECTIONS.refunds).find((r) => r.providerRefundId === providerId);
    await refunds.applyRefundStatus(db, row._id, 'processed', { source: 'test', now: NOW });
  };
  await refunds.requestRefund(db, refundInput(intent.reference, { amountKobo: 300000, createRefund: created('rf_p1') }));
  await process('rf_p1');
  assert.equal(db.rows(COLLECTIONS.payments)[0].refundState, 'partially_refunded');
  assert.equal(await payment.hasCourseEntitlement(db, STUDENT, COURSE), true);
  const tooMuch = await refunds.requestRefund(db, refundInput(intent.reference, { amountKobo: 800000 }));
  assert.equal(tooMuch.code, 'invalid_amount');
  const rest = await refunds.requestRefund(db, refundInput(intent.reference, { createRefund: created('rf_p2') }));
  assert.equal(rest.refund.amountKobo, 700000, 'an empty amount refunds the remainder');
  await process('rf_p2');
  assert.deepEqual([db.rows(COLLECTIONS.payments)[0].refundState, db.rows(COLLECTIONS.payments)[0].refundedKobo], ['refunded', 1000000]);
  assert.equal(await payment.hasCourseEntitlement(db, STUDENT, COURSE), true, 'access only changes when chosen');
  assert.equal((await refunds.requestRefund(db, refundInput(intent.reference))).code, 'nothing_to_refund');
});

test('a refund Paystack rejects is closed and another can be requested; a held payment can be refunded but not "revoked"', async () => {
  const db = newDb();
  const { intent } = await paidCourse(db);
  const rejected = await refunds.requestRefund(db, refundInput(intent.reference, { createRefund: async () => ({ outcome: 'rejected', httpStatus: 400, message: 'Transaction has been fully reversed' }) }));
  assert.deepEqual([rejected.ok, rejected.code, rejected.refund.status, rejected.refund.open], [false, 'refund_rejected', 'request_failed', undefined]);
  assert.equal((await refunds.requestRefund(db, refundInput(intent.reference))).ok, true);

  const db2 = newDb();
  const { intent: first } = await paidCourse(db2);
  // Checkout refuses a second purchase of an owned course, so the second (racing) checkout is
  // inserted directly; its payment is held as a duplicate.
  await db2.collection(COLLECTIONS.intents).insertOne({ reference: makeReference(), userId: STUDENT, courseId: COURSE, kind: 'course', amountKobo: 1000000, currency: 'NGN', status: 'pending', createdAt: NOW });
  const second = db2.rows(COLLECTIONS.intents).find((i) => i.status === 'pending');
  await payment.confirmCoursePayment(db2, { reference: second.reference, source: 'checkout', sessionUserId: STUDENT, fetchTransaction: provider({ [second.reference]: { outcome: 'found', data: successData(second) } }), now: NOW });
  const held = db2.rows(COLLECTIONS.payments).find((p) => p.reference === second.reference);
  assert.equal(held.entitlementApplied, false);
  assert.equal((await refunds.requestRefund(db2, refundInput(second.reference, { revokeAccess: true }))).code, 'payment_did_not_grant_access');
  const ok = await refunds.requestRefund(db2, refundInput(second.reference, { createRefund: created('rf_held') }));
  assert.equal(ok.ok, true);
  assert.equal(await payment.hasCourseEntitlement(db2, STUDENT, COURSE), true, 'the original purchase keeps access');
  assert.ok(first);
});

test('an unconfirmed refund (Paystack timed out) blocks duplicates until a refresh finds it at Paystack or proves it absent', async () => {
  const db = newDb();
  const { intent, data } = await paidCourse(db);
  const out = await refunds.requestRefund(db, refundInput(intent.reference, { createRefund: async () => ({ outcome: 'uncertain', reason: 'timeout' }) }));
  assert.deepEqual([out.ok, out.status, out.code, out.refund.status, out.refund.open], [true, 202, 'refund_uncertain', 'uncertain', true]);
  assert.equal((await refunds.requestRefund(db, refundInput(intent.reference))).code, 'refund_in_progress', 'no second refund while the first is unknown');
  const [row] = db.rows(COLLECTIONS.refunds);

  // Paystack lists a matching refund: adopted and applied.
  const listRefunds = provider({ [String(data.id)]: { outcome: 'found', data: [{ id: 'rf_found', amount: 1000000, status: 'processing', createdAt: NOW.toISOString() }] } });
  const found = await refunds.refreshRefund(db, row._id, { fetchRefund: provider(), listRefunds, fetchTransaction: provider(), now: later(MIN) });
  assert.deepEqual([found.code, found.refund.status, found.refund.providerRefundId], ['found_at_provider', 'processing', 'rf_found']);
  assert.equal(String(db.rows(COLLECTIONS.payments)[0].providerTransactionId), String(data.id), 'the Paystack transaction id was recorded at verification');

  // Another uncertain request where Paystack has nothing: still unknown inside the grace, closed after it.
  const db2 = newDb();
  const { intent: i2 } = await paidCourse(db2);
  await refunds.requestRefund(db2, refundInput(i2.reference, { createRefund: async () => ({ outcome: 'uncertain', reason: 'http_502' }) }));
  const [r2] = db2.rows(COLLECTIONS.refunds);
  const empty = provider({ [String(db2.rows(COLLECTIONS.payments)[0].providerTransactionId)]: { outcome: 'found', data: [] } });
  assert.equal((await refunds.refreshRefund(db2, r2._id, { fetchRefund: provider(), listRefunds: empty, now: later(5 * MIN) })).code, 'still_unknown');
  const closed = await refunds.refreshRefund(db2, r2._id, { fetchRefund: provider(), listRefunds: empty, now: later(31 * MIN) });
  assert.deepEqual([closed.code, closed.refund.status], ['not_created', 'request_failed']);
  // A list lookup that fails leaves it untouched.
  const db3 = newDb();
  const { intent: i3 } = await paidCourse(db3);
  await refunds.requestRefund(db3, refundInput(i3.reference, { createRefund: async () => ({ outcome: 'uncertain', reason: 'network' }) }));
  const [r3] = db3.rows(COLLECTIONS.refunds);
  const down = await refunds.refreshRefund(db3, r3._id, { fetchRefund: provider(), listRefunds: async () => ({ outcome: 'uncertain', reason: 'timeout' }), now: later(60 * MIN) });
  assert.deepEqual([down.ok, down.code, (await db3.collection(COLLECTIONS.refunds).findOne({ _id: r3._id })).status], [false, 'provider_uncertain', 'uncertain']);
  // The Super Admin may close it after checking the dashboard; nobody else may.
  assert.equal((await refunds.abandonUncertainRefund(db3, r3._id, { actor: { ...SUPER, role: 'admin' }, reason: 'checked' })).code, 'superadmin_required');
  const abandoned = await refunds.abandonUncertainRefund(db3, r3._id, { actor: SUPER, reason: 'Checked the Paystack dashboard: no refund exists' });
  assert.deepEqual([abandoned.ok, abandoned.refund.status], [true, 'request_failed']);
});

test('refund states never move backwards: a processed refund ignores a later failed event', async () => {
  const db = newDb();
  const { intent } = await paidCourse(db);
  const out = await refunds.requestRefund(db, refundInput(intent.reference, { createRefund: created('rf_final', 'processed') }));
  assert.equal(out.refund.status, 'processed');
  const res = await refunds.processRefundEvent(db, 'refund.failed', { id: 'rf_final', transaction_reference: intent.reference, amount: 1000000, status: 'failed' }, { now: later(MIN) });
  assert.equal(res.code, 'refund_unchanged');
  assert.equal(db.rows(COLLECTIONS.refunds)[0].status, 'processed');
  assert.equal(db.rows(COLLECTIONS.payments)[0].refundState, 'refunded');
});

test('refund webhooks: Paystack unreachable -> retry (500); refund made in the Paystack dashboard -> recorded, flagged, access unchanged', async () => {
  const db = newDb();
  const { intent } = await paidCourse(db);
  const uncertain = await refunds.processRefundEvent(db, 'refund.processed', { id: 'rf_x', transaction_reference: intent.reference, amount: 1000000 }, { fetchRefund: async () => ({ outcome: 'uncertain', reason: 'timeout' }), now: NOW });
  assert.deepEqual(uncertain, { ack: false, code: 'refund_lookup_uncertain' });
  const fetchRefund = provider({ rf_ext: { outcome: 'found', data: { id: 'rf_ext', status: 'processed' } } });
  for (const [i, expected] of ['external_refund_recorded', 'refund_unchanged'].entries()) {
    const out = await refunds.processRefundEvent(db, 'refund.processed', { id: 'rf_ext', transaction_reference: intent.reference, amount: 1000000, currency: 'NGN' }, { fetchRefund, now: later(i * MIN) });
    assert.equal(out.code, expected, 'the redelivery finds the record the first delivery created');
  }
  const rows = db.rows(COLLECTIONS.refunds);
  assert.deepEqual(rows.map((r) => [r.initiatedBy, r.status, r.revokeAccess]), [['external', 'processed', false]], 'one record for two deliveries');
  assert.equal(db.rows(COLLECTIONS.payments)[0].refundState, 'refunded');
  assert.equal(await payment.hasCourseEntitlement(db, STUDENT, COURSE), true, 'an outside refund never removes access by itself');
  assert.equal(db.rows(COLLECTIONS.exceptions).filter((e) => e.reason === 'refund_unhandled').length, 1);
});

test('crash after a refund is processed: reconciliation finishes the effects (payment summary, access removal) exactly once', async () => {
  const failNext = {};
  const db = newDb({ failNext });
  const { intent } = await paidCourse(db);
  await refunds.requestRefund(db, refundInput(intent.reference, { revokeAccess: true, createRefund: created('rf_crash') }));
  failNext['paystackPayments.updateOne'] = 1;
  const [row] = db.rows(COLLECTIONS.refunds);
  await assert.rejects(refunds.applyRefundStatus(db, row._id, 'processed', { source: 'test', now: NOW }), /injected failure/);
  assert.equal(db.rows(COLLECTIONS.refunds)[0].status, 'processed');
  assert.equal(db.rows(COLLECTIONS.refunds)[0].finalizedAt, undefined);
  assert.equal(await payment.hasCourseEntitlement(db, STUDENT, COURSE), true, 'effects not applied yet');

  const report = await runReconciliation(db, { apply: true, fetchTransaction: provider(), fetchRefund: provider(), listRefunds: provider(), now: later(10 * MIN) });
  assert.ok(report.items.some((i) => i.type === 'refund_status' && i.action === 'finalized'));
  assert.equal(await payment.hasCourseEntitlement(db, STUDENT, COURSE), false);
  assert.equal(db.rows(COLLECTIONS.payments)[0].refundState, 'refunded');
  const again = await runReconciliation(db, { apply: true, fetchTransaction: provider(), fetchRefund: provider(), listRefunds: provider(), now: later(20 * MIN) });
  assert.equal(again.items.filter((i) => i.type === 'refund_status').length, 0);
  assert.equal(db.rows('adminAuditLog').filter((a) => a.action === 'refund_processed').length, 1);
});

// ---------------------------------------------------------------------------
// Reconciliation and recovery
// ---------------------------------------------------------------------------

test('crash between the payment record and the entitlement: the stalled confirmation is finished by reconciliation', async () => {
  const failNext = {};
  const db = newDb({ failNext });
  const intent = await startCheckout(db);
  failNext['userCourseAccess.updateOne'] = 1;
  await assert.rejects(payment.confirmCoursePayment(db, {
    reference: intent.reference, source: 'checkout', sessionUserId: STUDENT,
    fetchTransaction: provider({ [intent.reference]: { outcome: 'found', data: successData(intent) } }), now: NOW,
  }), /injected failure/);
  assert.equal(db.rows(COLLECTIONS.payments).length, 1, 'the payment was recorded');
  assert.equal(await payment.hasCourseEntitlement(db, STUDENT, COURSE), false, 'but access was not');
  // The failed request released its claim; reconciliation's own pending check confirms it.
  const fetchTransaction = provider({ [intent.reference]: { outcome: 'found', data: successData(intent) } });
  const report = await runReconciliation(db, { apply: true, fetchTransaction, fetchRefund: provider(), listRefunds: provider(), now: later(11 * MIN) });
  assert.ok(report.items.some((i) => i.reference === intent.reference && ['granted', 'already_settled'].includes(i.action)), JSON.stringify(report.items));
  assert.equal(await payment.hasCourseEntitlement(db, STUDENT, COURSE), true);
  assert.equal(db.rows(COLLECTIONS.payments).length, 1);
  assert.equal(db.rows(COLLECTIONS.courseAccess).length, 1);
});

test('a confirmation that died holding its claim (process crash) is taken over after the claim expires', async () => {
  const db = newDb();
  const intent = await startCheckout(db);
  await db.collection(COLLECTIONS.intents).updateOne({ _id: intent._id }, { $set: { status: 'processing', claimedAt: NOW, claimedFrom: 'pending' } });
  const fetchTransaction = provider({ [intent.reference]: { outcome: 'found', data: successData(intent) } });
  const early = await runReconciliation(db, { apply: true, fetchTransaction, fetchRefund: provider(), listRefunds: provider(), now: later(MIN) });
  assert.equal(early.items.filter((i) => i.type === 'stale_processing').length, 0, 'a live claim is left alone');
  const report = await runReconciliation(db, { apply: true, fetchTransaction, fetchRefund: provider(), listRefunds: provider(), now: later(3 * MIN) });
  assert.deepEqual(report.items.filter((i) => i.type === 'stale_processing').map((i) => i.action), ['granted']);
  assert.equal(await payment.hasCourseEntitlement(db, STUDENT, COURSE), true);
});

test('lost webhook and closed browser: a pending checkout Paystack reports paid is granted; unpaid ones stay pending (never marked failed)', async () => {
  const db = newDb();
  const paid = await startCheckout(db, STUDENT, COURSE);
  const otherCourse = new ObjectId().toHexString();
  const unpaid = await startCheckout(db, STUDENT, otherCourse);
  const third = new ObjectId().toHexString();
  const flaky = await startCheckout(db, STUDENT, third);
  const fetchTransaction = provider({
    [paid.reference]: { outcome: 'found', data: successData(paid) },
    [unpaid.reference]: { outcome: 'found', data: { status: 'abandoned', reference: unpaid.reference } },
    [flaky.reference]: { outcome: 'uncertain', reason: 'timeout' },
  });
  const tooSoon = await runReconciliation(db, { apply: true, fetchTransaction, fetchRefund: provider(), listRefunds: provider(), now: later(5 * MIN) });
  assert.equal(fetchTransaction.calls.length, 0, 'checkouts younger than 10 minutes are left to the student');
  assert.equal(tooSoon.items.filter((i) => i.type.startsWith('unconfirmed')).length, 0);
  const report = await runReconciliation(db, { apply: true, fetchTransaction, fetchRefund: provider(), listRefunds: provider(), now: later(15 * MIN) });
  const byRef = Object.fromEntries(report.items.filter((i) => i.reference).map((i) => [i.reference, i.action]));
  assert.equal(byRef[paid.reference], 'granted');
  assert.equal(byRef[unpaid.reference], 'left_pending:abandoned');
  assert.equal(byRef[flaky.reference], 'provider_uncertain');
  assert.equal(await payment.hasCourseEntitlement(db, STUDENT, COURSE), true);
  assert.equal(await payment.hasCourseEntitlement(db, STUDENT, otherCourse), false);
  const statuses = db.rows(COLLECTIONS.intents).map((i) => i.status).sort();
  assert.deepEqual(statuses, ['paid', 'pending', 'pending']);
  // Checked pending checkouts are not re-asked for an hour.
  const callsBefore = fetchTransaction.calls.length;
  await runReconciliation(db, { apply: true, fetchTransaction, fetchRefund: provider(), listRefunds: provider(), now: later(30 * MIN) });
  assert.equal(fetchTransaction.calls.length, callsBefore);
});

test('report-only mode writes nothing and calls Paystack nowhere; the call budget is respected', async () => {
  const db = newDb();
  const intents = [];
  for (let i = 0; i < 4; i += 1) intents.push(await startCheckout(db, STUDENT, new ObjectId().toHexString()));
  const before = JSON.stringify(db.rows(COLLECTIONS.intents));
  const fetchTransaction = provider();
  const report = await runReconciliation(db, { apply: false, fetchTransaction, fetchRefund: provider(), listRefunds: provider(), now: later(20 * MIN) });
  assert.equal(fetchTransaction.calls.length, 0);
  assert.equal(JSON.stringify(db.rows(COLLECTIONS.intents)), before);
  assert.equal(report.items.filter((i) => i.action === 'would_check').length, 4);
  const limited = await runReconciliation(db, { apply: true, limit: 2, fetchTransaction, fetchRefund: provider(), listRefunds: provider(), now: later(20 * MIN) });
  assert.equal(fetchTransaction.calls.length, 2);
  assert.equal(limited.items.filter((i) => i.action === 'deferred_budget').length, 2);
});

test('diagnostics: payment without access, duplicate entitlement, held payment, unverifiable success, refund without record', async () => {
  const db = paymentMemoryDb({ uniqueIndexes: [] });
  const { intent } = await paidCourse(db);
  await db.collection(COLLECTIONS.courseAccess).updateOne({ userId: STUDENT, courseId: COURSE }, { $set: { paid: false } });
  await db.collection(COLLECTIONS.courseAccess).insertOne({ userId: OTHER, courseId: COURSE, paid: true });
  await db.collection(COLLECTIONS.courseAccess).insertOne({ userId: OTHER, courseId: COURSE, paid: true });
  await db.collection(COLLECTIONS.payments).insertOne({ reference: 'fo_c_held_0001', userId: OTHER, courseId: COURSE, kind: 'course', status: 'success', amountKobo: 1000000, currency: 'NGN', entitlementApplied: false, heldReason: 'duplicate_payment', paidAt: NOW });
  await db.collection(COLLECTIONS.exceptions).insertOne({ reference: 'fo_c_refund_zz1', reason: 'refund_unhandled' });
  const fetchTransaction = provider({ [intent.reference]: { outcome: 'found', data: { status: 'success', amount: 500000, currency: 'NGN' } } });
  const report = await runReconciliation(db, { apply: false, verifySample: 1, fetchTransaction, fetchRefund: provider(), listRefunds: provider(), now: NOW });
  const types = report.items.map((i) => `${i.type}:${i.reference || ''}`);
  assert.ok(types.includes(`payment_without_access:${intent.reference}`), types.join(' '));
  assert.ok(types.some((t) => t.startsWith('duplicate_entitlement:')));
  assert.ok(types.includes('held_payment:fo_c_held_0001'));
  assert.ok(types.includes('refund_without_record:fo_c_refund_zz1'));
  assert.ok(report.items.some((i) => i.type === 'local_success_unverified' && i.reference === intent.reference));
  const text = JSON.stringify(report);
  assert.equal(/@|example\.test/.test(text), false, 'no emails in the report');
});

test('sample re-verification: a Paystack reversal agrees only when a local refund record exists', async () => {
  const db = paymentMemoryDb({ uniqueIndexes: [] });
  const { intent } = await paidCourse(db);
  const reversal = (status) => provider({ [intent.reference]: { outcome: 'found', data: { status, amount: 1025381, requested_amount: 1000000, fees: 25381, currency: 'NGN' } } });
  const flagged = async (status) => (await runReconciliation(db, { apply: false, verifySample: 1, fetchTransaction: reversal(status), fetchRefund: provider(), listRefunds: provider(), now: NOW }))
    .items.some((i) => i.type === 'local_success_unverified' && i.reference === intent.reference);
  assert.equal(await flagged('success'), false, 'customer-paid fees agree');
  assert.equal(await flagged('reversal-pending'), true, 'no local refund: a reversal needs review');
  assert.equal(await flagged('reversed'), true);
  await db.collection(COLLECTIONS.refunds).insertOne({ requestId: 'req-x', paymentReference: intent.reference, amountKobo: 300000, status: 'pending', open: true });
  assert.equal(await flagged('reversal-pending'), false);
  assert.equal(await flagged('reversed'), false);
  assert.equal(await flagged('failed'), true);
});

// ---------------------------------------------------------------------------
// Webhook re-verification and concurrency (module level)
// ---------------------------------------------------------------------------

test('webhook: the transaction is re-verified with Paystack; the payload cannot widen what is granted', async () => {
  const db = newDb();
  const intent = await startCheckout(db);
  const other = new ObjectId().toHexString();
  const forged = { event: 'charge.success', data: { reference: intent.reference, status: 'success', amount: intent.amountKobo, currency: 'NGN', metadata: { userId: intent.userId, courseId: other } } };
  const fetchTransaction = provider({ [intent.reference]: { outcome: 'found', data: successData(intent) } });
  const out = await payment.processWebhookEvent(db, forged, NOW, { fetchTransaction });
  assert.equal(out.code, 'granted');
  assert.deepEqual(fetchTransaction.calls, [intent.reference]);
  assert.equal(await payment.hasCourseEntitlement(db, STUDENT, COURSE), true);
  assert.equal(await payment.hasCourseEntitlement(db, STUDENT, other), false, 'a payment for one course never unlocks another');
  assert.deepEqual(await payment.processWebhookEvent(db, { event: 'charge.success', data: {} }, NOW, { fetchTransaction }), { ack: true, code: 'invalid_payload' });
  assert.deepEqual(await payment.processWebhookEvent(db, { event: 'charge.success', data: ['x'] }, NOW, { fetchTransaction }), { ack: true, code: 'ignored' });
});

test('concurrency: webhook, browser confirmation and reconciliation racing on one reference write one payment and one entitlement', async () => {
  const db = newDb({ racy: true });
  const intent = await startCheckout(db);
  const fetchTransaction = provider({ [intent.reference]: { outcome: 'found', data: successData(intent) } });
  const results = await Promise.all([
    payment.processWebhookEvent(db, { event: 'charge.success', data: { reference: intent.reference } }, NOW, { fetchTransaction }),
    payment.processWebhookEvent(db, { event: 'charge.success', data: { reference: intent.reference } }, NOW, { fetchTransaction }),
    payment.confirmCoursePayment(db, { reference: intent.reference, source: 'checkout', sessionUserId: STUDENT, fetchTransaction, now: NOW }),
    payment.confirmCoursePayment(db, { reference: intent.reference, source: 'reconciliation', fetchTransaction, now: NOW }),
  ]);
  assert.ok(results.length === 4);
  assert.equal(db.rows(COLLECTIONS.payments).length, 1);
  assert.equal(db.rows(COLLECTIONS.courseAccess).length, 1);
  assert.equal(db.rows(COLLECTIONS.coursePurchases).length, 1);
  // Any request that saw the claim busy can retry and gets the settled answer.
  const retry = await payment.confirmCoursePayment(db, { reference: intent.reference, source: 'checkout', sessionUserId: STUDENT, fetchTransaction, now: later(MIN) });
  assert.deepEqual([retry.ok, retry.alreadyProcessed], [true, true]);
});

// ---------------------------------------------------------------------------
// Payment history
// ---------------------------------------------------------------------------

test('payment history: only the user\'s own records, with authoritative statuses and no provider or personal data', async () => {
  const db = newDb();
  const courseB = new ObjectId();
  const courseC = new ObjectId();
  await db.collection('courses').insertOne({ _id: new ObjectId(COURSE), title: 'Price Action' });
  await db.collection('courses').insertOne({ _id: courseB, title: 'Risk Management' });
  await db.collection('courses').insertOne({ _id: courseC, title: 'Psychology' });
  const { intent: a } = await paidCourse(db, STUDENT, COURSE);
  const { intent: b } = await paidCourse(db, STUDENT, courseB.toHexString());
  await refunds.requestRefund(db, refundInput(b.reference, { amountKobo: 250000, createRefund: created('rf_hist') }));
  const c = await startCheckout(db, STUDENT, courseC.toHexString());
  await db.collection(COLLECTIONS.intents).updateOne({ _id: c._id }, { $set: { status: 'processing', claimedAt: NOW } });
  await paidCourse(db, OTHER, COURSE);

  const rows = await listUserPayments(db, STUDENT);
  const byRef = Object.fromEntries(rows.map((r) => [r.reference, r]));
  assert.deepEqual(Object.keys(byRef).sort(), [a.reference, b.reference, c.reference].sort(), 'another student\'s payment is not listed');
  assert.deepEqual([byRef[a.reference].status, byRef[a.reference].courseTitle, byRef[a.reference].amountKobo], ['paid', 'Price Action', 1000000]);
  assert.deepEqual([byRef[b.reference].status, byRef[b.reference].refundPendingKobo], ['refund_pending', 250000]);
  assert.equal(byRef[c.reference].status, 'confirming');
  const text = JSON.stringify(rows);
  for (const forbidden of ['metadata', 'customer', 'email', 'providerTransactionId', 'requestedBy', 'reason', 'history']) {
    assert.equal(text.includes(forbidden), false, forbidden);
  }
});

// ---------------------------------------------------------------------------
// Routes: sessions, roles, CSRF
// ---------------------------------------------------------------------------

const ROUTE_ENV = { NODE_ENV: 'test', PAYSTACK_SECRET_KEY: 'sk_test_phase5_unit_only', MONGODB_DB_NAME: 'forexorbit_p5_test', MONGO_URI: 'mongodb://127.0.0.1:27017', APP_ORIGIN: undefined, PORT: undefined, SHARED_RATE_LIMIT: undefined };

async function withEnv(env, fn) {
  const saved = {};
  for (const key of Object.keys(env)) {
    saved[key] = process.env[key];
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function signIn(db, userId, roleName) {
  db.rows('users').push({ _id: new ObjectId(userId), email: `${roleName}@example.test`, role: roleName, status: 'approved', sessionGeneration: 0 });
  return seedSession(db.rows('sessions'), { userId, generation: 0, now: new Date() });
}

async function call(handler, { method = 'GET', token, body, query = {}, headers } = {}) {
  const res = mockResponse();
  await handler({ method, url: '/api/test', headers: headers || requestHeaders(token), body, query, socket: { remoteAddress: '10.0.0.2' } }, res);
  return res;
}

function route(file, db, extra = {}) {
  return loadModule(file, { 'lib/mongodb': { getDb: async () => db }, ...extra }).default;
}

test('GET /api/payments/history: sign-in required, own records only (no IDOR via query), no-store', async () => {
  await withEnv(ROUTE_ENV, async () => {
    const db = newDb();
    await paidCourse(db, STUDENT, COURSE);
    await paidCourse(db, OTHER, COURSE);
    const handler = route('pages/api/payments/history.ts', db);
    assert.equal((await call(handler)).statusCode, 401);
    const token = signIn(db, STUDENT, 'student');
    const res = await call(handler, { token, query: { userId: OTHER } });
    assert.deepEqual([res.statusCode, res.headers['cache-control']], [200, 'no-store']);
    assert.equal(res.body.items.length, 1);
    assert.equal(res.body.items[0].reference.startsWith('fo_c_p5_'), true);
    assert.equal((await call(handler, { method: 'POST', token })).statusCode, 405);
  });
});

test('admin refund and reconcile routes: Super Admin only; CSRF enforced; the secret key never reaches the response', async () => {
  await withEnv(ROUTE_ENV, async () => {
    const db = newDb();
    const { intent } = await paidCourse(db);
    const calls = [];
    const stubs = {
      'lib/payment-route': {
        ...loadModule('lib/payment-route.ts', { 'lib/mongodb': { getDb: async () => db } }),
        createRefundWithPaystack: async (input) => { calls.push(input); return { outcome: 'created', data: { id: 'rf_route', status: 'pending' } }; },
        lookupPaystackTransaction: async () => ({ outcome: 'not_found' }),
        lookupPaystackRefund: async () => ({ outcome: 'not_found' }),
        listPaystackRefundsFor: async () => ({ outcome: 'found', data: [] }),
      },
    };
    const refundRoute = route('pages/api/admin/refunds/index.ts', db, stubs);
    const reconcileRoute = route('pages/api/admin/payments/reconcile.ts', db, stubs);
    const body = { reference: intent.reference, revokeAccess: false, reason: 'Duplicate charge reported', requestId: 'req-route-0001' };
    const student = signIn(db, new ObjectId().toHexString(), 'student');
    const admin = signIn(db, new ObjectId().toHexString(), 'admin');
    const owner = signIn(db, SUPER.userId, 'superadmin');
    for (const token of [student, admin]) {
      assert.equal((await call(refundRoute, { method: 'POST', token, body })).statusCode, 403);
      assert.equal((await call(reconcileRoute, { method: 'POST', token, body: {} })).statusCode, 403);
    }
    const noCsrf = await call(refundRoute, { method: 'POST', body, headers: { cookie: requestHeaders(owner).cookie, origin: requestHeaders(owner).origin } });
    assert.deepEqual([noCsrf.statusCode, noCsrf.body.code], [403, 'csrf_header_missing']);
    assert.equal(calls.length, 0, 'nothing reached Paystack');
    const ok = await call(refundRoute, { method: 'POST', token: owner, body });
    assert.deepEqual([ok.statusCode, ok.body.code, ok.body.refund.status], [201, 'refund_submitted', 'pending']);
    assert.equal(calls.length, 1);
    const list = await call(refundRoute, { token: owner, query: { reference: intent.reference } });
    assert.deepEqual([list.statusCode, list.body.refunds.length, list.body.summary.state], [200, 1, 'refund_pending']);
    const rec = await call(reconcileRoute, { method: 'POST', token: owner, body: {} });
    assert.equal(rec.statusCode, 200);
    assert.ok(Array.isArray(rec.body.items));
    for (const res of [ok, list, rec]) assert.equal(JSON.stringify(res.body).includes('sk_test_phase5_unit_only'), false);
  });
});

test('admin refund route refuses when payments are not configured (no secret key): 503, nothing recorded', async () => {
  await withEnv({ ...ROUTE_ENV, PAYSTACK_SECRET_KEY: undefined }, async () => {
    const db = newDb();
    const { intent } = await paidCourse(db);
    const owner = signIn(db, SUPER.userId, 'superadmin');
    const res = await call(route('pages/api/admin/refunds/index.ts', db), { method: 'POST', token: owner, body: { reference: intent.reference, revokeAccess: false, reason: 'x y z', requestId: 'req-route-0002' } });
    assert.deepEqual([res.statusCode, res.body.code], [503, 'not_configured']);
    assert.equal(db.rows(COLLECTIONS.refunds).length, 0);
  });
});

// ---------------------------------------------------------------------------
// Paystack API helpers (no network)
// ---------------------------------------------------------------------------

test('Paystack refund API helpers: secret only in the Authorization header; timeouts and 5xx are uncertain; 4xx with status false is a rejection', async () => {
  const seen = [];
  const fetchImpl = (status, json) => async (url, init) => { seen.push({ url, init }); return { status, ok: status >= 200 && status < 300, json: async () => json }; };
  let r = await refunds.createPaystackRefund({ reference: 'fo_c_abc_123456', amountKobo: 500000, secret: 'sk_test_x', fetchImpl: fetchImpl(200, { status: true, data: { id: 9, status: 'pending' } }) });
  assert.deepEqual(r, { outcome: 'created', data: { id: 9, status: 'pending' } });
  assert.equal(seen[0].url, 'https://api.paystack.co/refund');
  assert.equal(seen[0].init.headers.Authorization, 'Bearer sk_test_x');
  assert.deepEqual(JSON.parse(seen[0].init.body), { transaction: 'fo_c_abc_123456', amount: 500000 });
  r = await refunds.createPaystackRefund({ reference: 'fo_c_abc_123456', amountKobo: 1, secret: 'sk_test_x', fetchImpl: fetchImpl(400, { status: false, message: 'Refund amount is invalid' }) });
  assert.deepEqual(r, { outcome: 'rejected', httpStatus: 400, message: 'Refund amount is invalid' });
  r = await refunds.createPaystackRefund({ reference: 'fo_c_abc_123456', amountKobo: 1, secret: 'sk_test_x', fetchImpl: fetchImpl(502, {}) });
  assert.equal(r.outcome, 'uncertain');
  r = await refunds.createPaystackRefund({ reference: 'fo_c_abc_123456', amountKobo: 1, secret: 'sk_test_x', fetchImpl: async () => { throw Object.assign(new Error('x'), { name: 'AbortError' }); } });
  assert.deepEqual(r, { outcome: 'uncertain', reason: 'timeout' });
  r = await refunds.createPaystackRefund({ reference: 'fo_c_abc_123456', amountKobo: 1, secret: '', fetchImpl: fetchImpl(200, {}) });
  assert.deepEqual(r, { outcome: 'uncertain', reason: 'not_configured' });
  assert.deepEqual(await refunds.fetchPaystackRefund('9', { secret: 'sk_test_x', fetchImpl: fetchImpl(200, { status: true, data: { id: 9, status: 'processed' } }) }), { outcome: 'found', data: { id: 9, status: 'processed' } });
  assert.deepEqual(await refunds.fetchPaystackRefund('9', { secret: 'sk_test_x', fetchImpl: fetchImpl(404, { status: false }) }), { outcome: 'not_found' });
  assert.equal(refunds.mapProviderStatus('needs-attention'), 'needs_attention');
  assert.equal(refunds.mapProviderStatus('something-new'), 'processing', 'unknown statuses are never treated as final');
});

// ---------------------------------------------------------------------------
// Indexes, role, configuration and source contracts
// ---------------------------------------------------------------------------

test('refund indexes and the app role: unique request id, one open refund per payment, one record per Paystack refund', async () => {
  assert.deepEqual(REFUND_INDEXES.map((i) => [i.options.name, i.key, i.options.partialFilterExpression || null]), [
    ['uniq_refund_request', { requestId: 1 }, null],
    ['uniq_open_refund_payment', { paymentReference: 1 }, { open: true }],
    ['uniq_provider_refund', { providerRefundId: 1 }, { providerRefundId: { $exists: true } }],
  ]);
  assert.ok(REFUND_INDEXES.every((i) => i.options.unique === true && i.collection === 'paystackRefunds'));
  let existing = [{ name: '_id_', key: { _id: 1 } }];
  const created = [];
  const fakeDb = { collection: () => ({ indexes: async () => existing, createIndex: async (key, options) => { created.push(options.name); existing = [...existing, { key, ...options }]; } }) };
  assert.equal((await ensureRefundIndexes(fakeDb)).built.length, 0, 'read-only by default');
  assert.deepEqual((await ensureRefundIndexes(fakeDb, { apply: true })).built, ['uniq_refund_request', 'uniq_open_refund_payment', 'uniq_provider_refund']);
  assert.deepEqual((await ensureRefundIndexes(fakeDb, { apply: true })).built, [], 'idempotent');
  assert.ok(role.READ_WRITE_COLLECTIONS.includes('paystackRefunds'));
  assert.doesNotMatch(read('lib/payment-refunds.js') + read('lib/payment-reconciliation.js'), /createIndex|dropIndex|deleteOne|deleteMany/);
});

test('secrets stay server-side: browser code reads only the Paystack public key; the secret key appears only in server modules', () => {
  const browser = ['components/monetization/PaystackCourseUnlock.tsx', 'pages/payments.tsx', 'pages/admin/purchases.tsx', 'lib/course-checkout.js', 'lib/paystack-inline-script.ts'];
  for (const file of browser) {
    assert.doesNotMatch(read(file), /PAYSTACK_SECRET_KEY|sk_live_|sk_test_/, file);
  }
  assert.match(read('components/monetization/PaystackCourseUnlock.tsx'), /process\.env\.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY/);
  assert.match(read('lib/payment-route.ts'), /createPaystackRefund\(\{ \.\.\.input, secret: process\.env\.PAYSTACK_SECRET_KEY \}\)/);
  assert.doesNotMatch(read('lib/payment-refunds.js'), /console\.\w+\([^)]*(secret|Authorization)/i);
});

test('UI contracts: students get a Payments page and menu entry; the refund form requires an explicit access choice and sends a request id', () => {
  const sidebar = read('components/Sidebar.tsx');
  assert.match(sidebar, /\{ href: '\/payments', label: 'Payments', icon: PaymentsIcon, group: 'Account' \}/);
  const page = read('pages/payments.tsx');
  assert.match(page, /apiClient\.get<\{ items: PaymentHistoryRow\[\] \}>\('\/payments\/history'\)/);
  const admin = read('pages/admin/purchases.tsx');
  assert.match(admin, /if \(!revoke\) \{\s*setError\('Choose whether course access should be removed/);
  assert.match(admin, /requestId,\s*\}\);/);
  assert.match(admin, /apiClient\.post<ReconciliationReport>\('\/admin\/payments\/reconcile'/);
});

test('webhook route and server sweep: the route re-verifies with Paystack; the sweep is bounded, payments-gated and can be disabled', () => {
  const webhook = read('pages/api/paystack/webhook.ts');
  assert.match(webhook, /fetchTransaction: lookupPaystackTransaction,/);
  assert.match(webhook, /processRefundEvent\(db, refundEvent, data, \{ fetchRefund: lookupPaystackRefund, now: at \}\)/);
  const server = read('server.js');
  assert.match(server, /if \(decidePaymentEnvironment\(process\.env\)\.enabled && Number\.isFinite\(reconcileMinutes\) && reconcileMinutes > 0\)/);
  assert.match(server, /limit: 10,/);
  assert.match(server, /if \(reconciling\) return;/);
});
