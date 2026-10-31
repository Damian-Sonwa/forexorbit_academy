'use strict';

/**
 * A student's own course payments (Phase 5). Reads only rows whose `userId` is the signed-in user,
 * so one student can never see another's records. Returns no provider payload, card data, emails
 * or internal review notes.
 *
 * Status shown:
 *   paid                 verified payment that granted the course
 *   under_review         verified charge that did not change access (duplicate or closed checkout);
 *                        support settles it
 *   confirming           a checkout whose confirmation is in progress
 *   refund_pending       a refund was requested and Paystack has not finished it
 *   partially_refunded / refunded
 */

const { ObjectId } = require('mongodb');
const { COLLECTIONS } = require('./course-payment');
const { presentRefund, refundSummary } = require('./payment-refunds');

const MAX_ROWS = 200;

function iso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function courseTitles(db, ids) {
  const objectIds = [...new Set(ids)].filter((id) => ObjectId.isValid(String(id))).map((id) => new ObjectId(String(id)));
  if (!objectIds.length) return new Map();
  const rows = await db.collection('courses').find({ _id: { $in: objectIds } }, { projection: { title: 1 } }).toArray();
  return new Map(rows.map((c) => [String(c._id), typeof c.title === 'string' ? c.title : 'Course']));
}

async function listUserPayments(db, userId) {
  const uid = String(userId);
  const [payments, confirming] = await Promise.all([
    db.collection(COLLECTIONS.payments).find({ userId: uid, kind: 'course', status: 'success' }).limit(MAX_ROWS).toArray(),
    db.collection(COLLECTIONS.intents).find({ userId: uid, kind: 'course', status: 'processing' }).limit(MAX_ROWS).toArray(),
  ]);
  const refs = payments.map((p) => String(p.reference));
  const refunds = refs.length
    ? await db.collection(COLLECTIONS.refunds).find({ userId: uid, paymentReference: { $in: refs } }).toArray()
    : [];
  const titles = await courseTitles(db, [...payments.map((p) => p.courseId), ...confirming.map((i) => i.courseId)]);
  const paidRefs = new Set(refs);

  const rows = payments.map((p) => {
    const own = refunds.filter((r) => r.paymentReference === String(p.reference));
    const summary = refundSummary(own, p.amountKobo);
    let status = p.entitlementApplied === false ? 'under_review' : 'paid';
    if (summary.state !== 'none') status = summary.state;
    return {
      reference: String(p.reference),
      courseId: String(p.courseId),
      courseTitle: titles.get(String(p.courseId)) || 'Course',
      amountKobo: Number(p.amountKobo) || 0,
      currency: p.currency || 'NGN',
      status,
      date: iso(p.paidAt || p.createdAt),
      refundedKobo: summary.refundedKobo,
      refundPendingKobo: summary.pendingKobo,
      refunds: own.map((r) => presentRefund(r, { forStudent: true })),
    };
  });
  for (const intent of confirming) {
    if (paidRefs.has(String(intent.reference))) continue;
    rows.push({
      reference: String(intent.reference),
      courseId: String(intent.courseId),
      courseTitle: titles.get(String(intent.courseId)) || 'Course',
      amountKobo: Number(intent.amountKobo) || 0,
      currency: intent.currency || 'NGN',
      status: 'confirming',
      date: iso(intent.createdAt),
      refundedKobo: 0,
      refundPendingKobo: 0,
      refunds: [],
    });
  }
  rows.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  return rows;
}

module.exports = { MAX_ROWS, listUserPayments };
