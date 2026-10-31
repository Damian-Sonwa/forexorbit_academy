'use strict';

/**
 * Payment reconciliation (Phase 5): compares local payment records with Paystack and repairs only
 * what Paystack's own answer proves. It never creates a payment Paystack did not report, never
 * marks an uncertain payment failed, and never grants access except through the normal
 * confirmation path (lib/course-payment.js), which re-checks amount, currency, owner and course.
 *
 * Each run is bounded (`limit` provider calls). Safe to run repeatedly and from several processes:
 * every repair goes through the same conditional claims as a live confirmation.
 *
 * Repairs (only with `apply: true`):
 *   R1 stale_processing   a confirmation claimed a checkout and stopped (crash, timeout): re-run it.
 *   R2 unconfirmed_paid   a recent pending checkout that Paystack reports paid (webhook lost, browser
 *                         closed): confirm it, which grants access.
 *   R3 refund_status      open refunds re-read from Paystack; processed refunds finished.
 * Reports only (need a person):
 *   D1 payment_without_access   verified payment that granted access, but no entitled access row now
 *   D2 duplicate_reference      the same reference twice in payments or checkouts (unique index missing?)
 *   D3 duplicate_entitlement    more than one access row for a student and course
 *   D4 local_success_unverified a recent local success that Paystack does not confirm (with verifySample)
 *   D5 refund_without_record    a refund exception with no local refund record
 *   D6 held_payment             a verified charge held for review (duplicate or superseded checkout)
 *   D7 refund_uncertain         a refund whose creation outcome is still unknown
 */

const { CLAIM_TTL_MS, COLLECTIONS, INTENT_RECHECK_WINDOW_MS, confirmCoursePayment, isEntitledRow } = require('./course-payment');
const { REFUND_OPEN, refreshRefund } = require('./payment-refunds');

/** A pending checkout is left alone this long (the student is probably still paying). */
const PENDING_MIN_AGE_MS = 10 * 60 * 1000;
/** And re-checked at most this often. */
const PENDING_RECHECK_MS = 60 * 60 * 1000;
const REFUND_MIN_AGE_MS = 5 * 60 * 1000;
const DEFAULT_LIMIT = 25;
const SCAN_CAP = 5000;

function time(value) {
  return value ? new Date(value).getTime() : 0;
}

function duplicates(rows, keyOf) {
  const seen = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    if (!key) continue;
    seen.set(key, (seen.get(key) || 0) + 1);
  }
  return [...seen.entries()].filter(([, n]) => n > 1).map(([key, n]) => ({ key, count: n }));
}

/**
 * Runs one pass. Options:
 *   fetchTransaction(reference), fetchRefund(id), listRefunds(transactionId)  (server-side Paystack)
 *   apply (default false): perform R1-R3; otherwise only report what would be done
 *   limit: maximum provider calls in this pass (default 25)
 *   verifySample: number of recent local successes to re-verify with Paystack (D4; default 0)
 */
async function runReconciliation(db, options = {}) {
  const now = options.now || new Date();
  const apply = options.apply === true;
  let budget = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : DEFAULT_LIMIT;
  const items = [];
  const counts = {};
  const add = (item) => {
    items.push(item);
    counts[item.type] = (counts[item.type] || 0) + 1;
  };
  const spend = () => {
    if (budget <= 0) return false;
    budget -= 1;
    return true;
  };
  const intents = db.collection(COLLECTIONS.intents);

  // R1: confirmations that stopped while holding the claim.
  const processing = (await intents.find({ kind: 'course', status: 'processing' }).toArray())
    .filter((i) => now.getTime() - time(i.claimedAt) >= CLAIM_TTL_MS);
  for (const intent of processing) {
    if (!apply) { add({ type: 'stale_processing', reference: intent.reference, action: 'would_confirm' }); continue; }
    if (!spend()) { add({ type: 'stale_processing', reference: intent.reference, action: 'deferred_budget' }); continue; }
    const result = await confirmCoursePayment(db, { reference: intent.reference, source: 'reconciliation', fetchTransaction: options.fetchTransaction, now });
    add({ type: 'stale_processing', reference: intent.reference, action: result.ok ? (result.alreadyProcessed ? 'already_settled' : 'granted') : result.code });
  }

  // R2: recent pending checkouts Paystack may have settled while nobody was watching.
  const pending = (await intents.find({ kind: 'course', status: 'pending' }).toArray())
    .filter((i) => {
      const age = now.getTime() - time(i.createdAt);
      return age >= PENDING_MIN_AGE_MS && age <= INTENT_RECHECK_WINDOW_MS && now.getTime() - time(i.reconcileCheckedAt) >= PENDING_RECHECK_MS;
    })
    .sort((a, b) => time(a.createdAt) - time(b.createdAt));
  for (const intent of pending) {
    if (!apply) { add({ type: 'unconfirmed_checkout', reference: intent.reference, action: 'would_check' }); continue; }
    if (!spend()) { add({ type: 'unconfirmed_checkout', reference: intent.reference, action: 'deferred_budget' }); continue; }
    const lookup = await options.fetchTransaction(intent.reference);
    const paid = lookup.outcome === 'found' && String(lookup.data.status || '').toLowerCase() === 'success';
    if (paid) {
      const result = await confirmCoursePayment(db, { reference: intent.reference, source: 'reconciliation', fetchTransaction: async () => lookup, now });
      add({ type: 'unconfirmed_paid', reference: intent.reference, action: result.ok ? (result.duplicatePayment ? 'held_duplicate' : 'granted') : result.code });
    } else {
      // Not paid, abandoned, still processing, or unknown: leave it pending. Never marked failed here.
      await intents.updateOne({ _id: intent._id, status: 'pending' }, { $set: { reconcileCheckedAt: now } });
      add({ type: 'unconfirmed_checkout', reference: intent.reference, action: lookup.outcome === 'uncertain' ? 'provider_uncertain' : `left_pending:${lookup.outcome === 'found' ? String(lookup.data.status || 'unknown').toLowerCase().slice(0, 20) : 'not_found'}` });
    }
  }

  // R3: open refunds and processed refunds whose effects were not finished.
  const refunds = (await db.collection(COLLECTIONS.refunds).find({}).toArray())
    .filter((r) => (REFUND_OPEN.includes(r.status) && now.getTime() - time(r.updatedAt || r.requestedAt) >= REFUND_MIN_AGE_MS)
      || (r.status === 'processed' && !r.finalizedAt));
  for (const refund of refunds) {
    if (!apply) { add({ type: 'refund_status', reference: refund.paymentReference, refundId: String(refund._id), action: 'would_refresh' }); continue; }
    if (refund.status !== 'processed' && !spend()) { add({ type: 'refund_status', reference: refund.paymentReference, refundId: String(refund._id), action: 'deferred_budget' }); continue; }
    const out = await refreshRefund(db, refund._id, { fetchRefund: options.fetchRefund, listRefunds: options.listRefunds, fetchTransaction: options.fetchTransaction, now });
    add({ type: refund.status === 'uncertain' && out.code !== 'found_at_provider' && out.code !== 'not_created' ? 'refund_uncertain' : 'refund_status', reference: refund.paymentReference, refundId: String(refund._id), action: out.code, status: out.refund ? out.refund.status : null });
  }

  // Diagnostics (no writes).
  const payments = await db.collection(COLLECTIONS.payments).find({ kind: 'course', status: 'success' }).limit(SCAN_CAP).toArray();
  const accessRows = await db.collection(COLLECTIONS.courseAccess).find({}).limit(SCAN_CAP).toArray();
  const allIntents = await intents.find({}).limit(SCAN_CAP).toArray();
  const refundRows = await db.collection(COLLECTIONS.refunds).find({}).limit(SCAN_CAP).toArray();
  const accessByPair = new Map();
  for (const row of accessRows) {
    const key = `${row.userId}|${row.courseId}`;
    accessByPair.set(key, [...(accessByPair.get(key) || []), row]);
  }
  for (const p of payments) {
    if (p.entitlementApplied === false) {
      add({ type: 'held_payment', reference: p.reference, action: 'review', detail: p.heldReason || 'held' });
      continue;
    }
    if (p.refundState === 'refunded') continue;
    const rows = accessByPair.get(`${p.userId}|${p.courseId}`) || [];
    if (!rows.some(isEntitledRow)) add({ type: 'payment_without_access', reference: p.reference, action: 'review', detail: rows.length ? 'access_row_not_entitled' : 'no_access_row' });
  }
  for (const d of duplicates(payments, (p) => p.reference)) add({ type: 'duplicate_reference', reference: d.key, action: 'review', detail: `payments x${d.count}` });
  for (const d of duplicates(allIntents, (i) => i.reference)) add({ type: 'duplicate_reference', reference: d.key, action: 'review', detail: `checkouts x${d.count}` });
  for (const [pair, rows] of accessByPair) if (rows.length > 1) add({ type: 'duplicate_entitlement', reference: null, action: 'review', detail: `${rows.length} access rows for ${pair}` });
  const refundRefs = new Set(refundRows.map((r) => r.paymentReference));
  const refundExceptions = await db.collection(COLLECTIONS.exceptions).find({ reason: 'refund_unhandled' }).limit(SCAN_CAP).toArray();
  for (const e of refundExceptions) {
    if (e.reference && !refundRefs.has(e.reference) && !String(e.reference).startsWith('event:')) add({ type: 'refund_without_record', reference: e.reference, action: 'review' });
  }

  // D4: optional sample of recent local successes re-verified with Paystack.
  const sample = Number.isInteger(options.verifySample) ? options.verifySample : 0;
  if (sample > 0 && typeof options.fetchTransaction === 'function') {
    const recent = [...payments].sort((a, b) => time(b.paidAt) - time(a.paidAt)).slice(0, sample);
    for (const p of recent) {
      if (!spend()) { add({ type: 'local_success_unverified', reference: p.reference, action: 'deferred_budget' }); continue; }
      const lookup = await options.fetchTransaction(p.reference);
      if (lookup.outcome === 'uncertain') { add({ type: 'local_success_unverified', reference: p.reference, action: 'provider_uncertain' }); continue; }
      const ok = lookup.outcome === 'found'
        && ['success', 'reversed'].includes(String(lookup.data.status || '').toLowerCase())
        && Number(lookup.data.amount) === Number(p.amountKobo)
        && String(lookup.data.currency || '').toUpperCase() === String(p.currency || '').toUpperCase();
      if (!ok) add({ type: 'local_success_unverified', reference: p.reference, action: 'review', detail: lookup.outcome === 'found' ? `provider status ${String(lookup.data.status || '').slice(0, 20)}` : 'not_found_at_provider' });
    }
  }

  return { checkedAt: now.toISOString(), apply, budgetLeft: budget, counts, items };
}

module.exports = { DEFAULT_LIMIT, PENDING_MIN_AGE_MS, PENDING_RECHECK_MS, runReconciliation };
