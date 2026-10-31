'use strict';

/**
 * Course payment refunds (Phase 5).
 *
 * Super Admin initiated, through Paystack's Refund API. Every refund is a durable record in
 * `paystackRefunds`, written BEFORE Paystack is called, so a crash or timeout can never lose a
 * refund that may have been created. Payment rows are never deleted or rewritten: the payment keeps
 * `status: 'success'` and gains a refund summary (`refundedKobo`, `refundState`) recomputed from the
 * processed refunds, so the history stays auditable.
 *
 * Status lifecycle (one way; final states never change):
 *   requested -> pending | processing | needs_attention | processed | failed | request_failed | uncertain
 *   uncertain -> (refresh finds it at Paystack) pending | processing | processed | failed
 *             -> (Paystack has no such refund, or the Super Admin confirms none exists) request_failed
 *   pending | processing | needs_attention -> processed | failed
 * `open: true` marks a refund that is not final yet; a unique partial index allows only one open
 * refund per payment, which is what prevents duplicate refunds.
 *
 * Access policy (no automatic business rule): the Super Admin chooses `revokeAccess` explicitly on
 * each request. It is allowed only when the refund completes a FULL refund of a payment that
 * granted access, and it is applied only once Paystack reports the refund `processed`, never when
 * it is merely submitted. Refunds made outside the app (Paystack dashboard) are recorded from their
 * signed webhook and flagged for review; they never change access by themselves.
 */

const { ObjectId } = require('mongodb');
const {
  AUDIT_COLLECTION,
  COLLECTIONS,
  COURSE_CURRENCY,
  PROVIDER_TIMEOUT_MS,
  REFERENCE_PATTERN,
  isDuplicateKey,
  recordPaymentException,
} = require('./course-payment');

const REFUND_FINAL = Object.freeze(['processed', 'failed', 'request_failed']);
const REFUND_OPEN = Object.freeze(['requested', 'pending', 'processing', 'needs_attention', 'uncertain']);
const REQUEST_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;
const REASON_MIN = 3;
const REASON_MAX = 500;
const MIN_REFUND_KOBO = 100;
/** An unconfirmed refund request is looked up at Paystack before it may be called failed. */
const UNCERTAIN_GRACE_MS = 30 * 60 * 1000;

function refuse(status, code, message, extra = {}) {
  return { ok: false, status, code, message, ...extra };
}

function cleanText(value, max) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
}

/** Paystack refund status -> local status. Unknown values stay open (never assumed final). */
function mapProviderStatus(value) {
  const status = String(value || '').toLowerCase().replace(/[-\s]/g, '_');
  if (status === 'processed') return 'processed';
  if (status === 'failed') return 'failed';
  if (status === 'pending') return 'pending';
  if (status === 'needs_attention') return 'needs_attention';
  return 'processing';
}

// ---------------------------------------------------------------------------------------------
// Paystack Refund API (server-side secret key only)

async function paystackRequest(path, { secret, method = 'GET', body, fetchImpl, timeoutMs }) {
  const key = String(secret || '').trim();
  if (!key) return { outcome: 'uncertain', reason: 'not_configured' };
  const doFetch = fetchImpl || globalThis.fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || PROVIDER_TIMEOUT_MS);
  let res;
  try {
    res = await doFetch(`https://api.paystack.co${path}`, {
      method,
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (error) {
    return { outcome: 'uncertain', reason: error && error.name === 'AbortError' ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { outcome: 'response', httpStatus: res.status, ok: res.ok, json };
}

/** Message from a Paystack error, shortened; never the request or any key. */
function providerMessage(json) {
  return json && typeof json.message === 'string' ? cleanText(json.message, 200) : null;
}

/**
 * POST /refund. `created` means Paystack accepted the refund; `rejected` means it definitely did
 * not create one (4xx with status false); everything else is `uncertain` and must be looked up.
 */
async function createPaystackRefund({ reference, amountKobo, merchantNote, secret, fetchImpl, timeoutMs }) {
  const r = await paystackRequest('/refund', {
    secret,
    method: 'POST',
    body: { transaction: reference, amount: amountKobo, ...(merchantNote ? { merchant_note: merchantNote } : {}) },
    fetchImpl,
    timeoutMs,
  });
  if (r.outcome === 'uncertain') return r;
  if (r.ok && r.json && r.json.status === true && r.json.data && typeof r.json.data === 'object') {
    return { outcome: 'created', data: r.json.data };
  }
  if (r.httpStatus >= 400 && r.httpStatus < 500 && r.httpStatus !== 429 && r.json && r.json.status === false) {
    return { outcome: 'rejected', httpStatus: r.httpStatus, message: providerMessage(r.json) };
  }
  return { outcome: 'uncertain', reason: `http_${r.httpStatus}` };
}

/** GET /refund/:id. */
async function fetchPaystackRefund(id, { secret, fetchImpl, timeoutMs }) {
  if (!id) return { outcome: 'not_found' };
  const r = await paystackRequest(`/refund/${encodeURIComponent(String(id))}`, { secret, fetchImpl, timeoutMs });
  if (r.outcome === 'uncertain') return r;
  if (r.ok && r.json && r.json.status === true && r.json.data && typeof r.json.data === 'object') return { outcome: 'found', data: r.json.data };
  if (r.httpStatus === 404 || r.httpStatus === 400) return { outcome: 'not_found' };
  return { outcome: 'uncertain', reason: `http_${r.httpStatus}` };
}

/** GET /refund?transaction=<Paystack transaction id>: refunds Paystack holds for one transaction. */
async function listPaystackRefunds(transactionId, { secret, fetchImpl, timeoutMs }) {
  if (!transactionId) return { outcome: 'uncertain', reason: 'no_transaction_id' };
  const r = await paystackRequest(`/refund?transaction=${encodeURIComponent(String(transactionId))}&perPage=50`, { secret, fetchImpl, timeoutMs });
  if (r.outcome === 'uncertain') return r;
  if (r.ok && r.json && r.json.status === true && Array.isArray(r.json.data)) return { outcome: 'found', data: r.json.data };
  return { outcome: 'uncertain', reason: `http_${r.httpStatus}` };
}

// ---------------------------------------------------------------------------------------------
// Summaries

/** Refund totals for one payment from its refund records. */
function refundSummary(refunds, paymentAmountKobo) {
  let refundedKobo = 0;
  let pendingKobo = 0;
  for (const refund of refunds || []) {
    const amount = Number(refund.amountKobo) || 0;
    if (refund.status === 'processed') refundedKobo += amount;
    else if (REFUND_OPEN.includes(refund.status)) pendingKobo += amount;
  }
  const total = Number(paymentAmountKobo) || 0;
  let state = 'none';
  if (refundedKobo > 0) state = total > 0 && refundedKobo >= total ? 'refunded' : 'partially_refunded';
  else if (pendingKobo > 0) state = 'refund_pending';
  return { refundedKobo, pendingKobo, state };
}

async function refundsForReference(db, reference) {
  return db.collection(COLLECTIONS.refunds).find({ paymentReference: String(reference) }).toArray();
}

async function appendAudit(db, entry) {
  try {
    await db.collection(AUDIT_COLLECTION).insertOne(entry);
    return true;
  } catch (error) {
    if (isDuplicateKey(error)) return true;
    console.error(JSON.stringify({ event: 'refund_audit', result: 'write_failed', action: entry.action }));
    return false;
  }
}

function actorOf(actor) {
  return actor && actor.userId ? { userId: String(actor.userId), email: actor.email || null } : { userId: 'system', email: null };
}

// ---------------------------------------------------------------------------------------------
// Request

/**
 * Starts a refund. Returns { ok: true, status, refund, code } or a refusal.
 * `createRefund({ reference, amountKobo, merchantNote })` performs the Paystack call.
 */
async function requestRefund(db, { reference, amountKobo, revokeAccess, reason, requestId, actor, createRefund, now = new Date() }) {
  if (!actor || actor.role !== 'superadmin') return refuse(403, 'superadmin_required', 'Only the Super Admin can refund payments.');
  const ref = typeof reference === 'string' ? reference.trim() : '';
  if (!REFERENCE_PATTERN.test(ref)) return refuse(400, 'invalid_reference', 'A valid payment reference is required.');
  if (typeof requestId !== 'string' || !REQUEST_ID_PATTERN.test(requestId)) {
    return refuse(400, 'invalid_request_id', 'A request id is required (it prevents a double submission).');
  }
  if (typeof revokeAccess !== 'boolean') {
    return refuse(400, 'revoke_choice_required', 'Choose explicitly whether course access should be removed once the refund is processed.');
  }
  const why = cleanText(reason, REASON_MAX);
  if (why.length < REASON_MIN) return refuse(400, 'invalid_reason', `Give a reason of ${REASON_MIN} to ${REASON_MAX} characters.`);

  const refunds = db.collection(COLLECTIONS.refunds);
  const replay = await refunds.findOne({ requestId });
  if (replay) {
    if (replay.paymentReference !== ref) return refuse(409, 'request_id_reused', 'This request id belongs to another refund.');
    return { ok: true, status: 200, code: 'already_requested', refund: replay };
  }

  const payment = await db.collection(COLLECTIONS.payments).findOne({ reference: ref, kind: 'course', status: 'success' });
  if (!payment) return refuse(404, 'payment_not_found', 'No verified course payment has this reference.');
  if (String(payment.currency || '').toUpperCase() !== COURSE_CURRENCY) {
    return refuse(409, 'currency_unsupported', 'Only NGN payments can be refunded here.');
  }
  const existing = await refundsForReference(db, ref);
  if (existing.some((r) => r.open === true)) {
    return refuse(409, 'refund_in_progress', 'A refund for this payment is already in progress. Refresh its status first.');
  }
  const paid = Number(payment.amountKobo);
  const { refundedKobo } = refundSummary(existing, paid);
  const remaining = paid - refundedKobo;
  if (!Number.isInteger(paid) || paid <= 0 || remaining <= 0) {
    return refuse(409, 'nothing_to_refund', 'This payment has already been fully refunded.');
  }
  const amount = amountKobo == null || amountKobo === '' ? remaining : Number(amountKobo);
  if (!Number.isInteger(amount) || amount < MIN_REFUND_KOBO || amount > remaining) {
    return refuse(400, 'invalid_amount', `Refund between ${MIN_REFUND_KOBO} and ${remaining} kobo (whole kobo).`);
  }
  const completesFullRefund = refundedKobo + amount === paid;
  if (revokeAccess && !completesFullRefund) {
    return refuse(400, 'revoke_requires_full_refund', 'Access can only be removed with a refund that completes a full refund.');
  }
  if (revokeAccess && payment.entitlementApplied === false) {
    return refuse(400, 'payment_did_not_grant_access', 'This payment was held for review and never granted access, so there is no access to remove.');
  }

  const doc = {
    _id: new ObjectId(),
    requestId,
    paymentReference: ref,
    userId: String(payment.userId),
    courseId: String(payment.courseId),
    amountKobo: amount,
    currency: COURSE_CURRENCY,
    full: completesFullRefund,
    revokeAccess,
    reason: why,
    initiatedBy: 'admin',
    status: 'requested',
    open: true,
    requestedBy: actorOf(actor),
    requestedAt: now,
    updatedAt: now,
    history: [{ at: now, status: 'requested', source: 'admin' }],
  };
  try {
    await refunds.insertOne(doc);
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
    const again = await refunds.findOne({ requestId });
    if (again && again.paymentReference === ref) return { ok: true, status: 200, code: 'already_requested', refund: again };
    return refuse(409, 'refund_in_progress', 'A refund for this payment is already in progress. Refresh its status first.');
  }
  await appendAudit(db, {
    _id: `refund:${doc._id}:requested`,
    entityType: 'payment_refund',
    entityId: String(doc._id),
    reference: ref,
    action: 'refund_requested',
    reason: why,
    before: null,
    after: { amountKobo: amount, full: completesFullRefund, revokeAccess },
    actor: actorOf(actor),
    createdAt: now,
  });

  const outcome = await createRefund({ reference: ref, amountKobo: amount, merchantNote: `ForexOrbit refund ${doc._id}` });
  if (outcome.outcome === 'created') {
    const data = outcome.data || {};
    const providerRefundId = data.id != null ? String(data.id).slice(0, 40) : null;
    const status = mapProviderStatus(data.status || 'pending');
    await refunds.updateOne(
      { _id: doc._id, status: 'requested' },
      { $set: { ...(providerRefundId ? { providerRefundId } : {}), providerStatus: cleanText(String(data.status || 'pending'), 40) } }
    );
    const applied = await applyRefundStatus(db, doc._id, status, { source: 'provider_create', now });
    return { ok: true, status: 201, code: 'refund_submitted', refund: applied.refund };
  }
  if (outcome.outcome === 'rejected') {
    const applied = await applyRefundStatus(db, doc._id, 'request_failed', { source: 'provider_create', now, message: outcome.message });
    return refuse(422, 'refund_rejected', outcome.message || 'Paystack did not accept this refund.', { refund: applied.refund });
  }
  const applied = await applyRefundStatus(db, doc._id, 'uncertain', { source: 'provider_create', now, message: outcome.reason || null });
  return { ok: true, status: 202, code: 'refund_uncertain', refund: applied.refund };
}

// ---------------------------------------------------------------------------------------------
// Status transitions

const ALLOWED_FROM = Object.freeze({
  requested: ['pending', 'processing', 'needs_attention', 'processed', 'failed', 'request_failed', 'uncertain'],
  uncertain: ['pending', 'processing', 'needs_attention', 'processed', 'failed', 'request_failed'],
  pending: ['processing', 'needs_attention', 'processed', 'failed'],
  processing: ['pending', 'needs_attention', 'processed', 'failed'],
  needs_attention: ['pending', 'processing', 'processed', 'failed'],
});

/**
 * Moves a refund to `next` if that transition is allowed (never out of a final state), then
 * finishes the effects of a processed refund. Idempotent: re-applying the current status only
 * re-runs the (idempotent) finishing step.
 */
async function applyRefundStatus(db, refundId, next, { source, now = new Date(), message } = {}) {
  const refunds = db.collection(COLLECTIONS.refunds);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await refunds.findOne({ _id: refundId });
    if (!current) return { changed: false, refund: null };
    if (current.status !== next) {
      const allowed = ALLOWED_FROM[current.status] || [];
      if (!allowed.includes(next)) return { changed: false, refund: current };
      const final = REFUND_FINAL.includes(next);
      const update = {
        $set: { status: next, updatedAt: now, ...(final ? { closedAt: now } : {}), ...(message ? { providerMessage: cleanText(String(message), 200) } : {}) },
        $push: { history: { at: now, status: next, source: source || 'system' } },
      };
      if (final) update.$unset = { open: '' };
      const moved = await refunds.updateOne({ _id: refundId, status: current.status }, update);
      if (!moved.matchedCount) continue;
    }
    const refund = await refunds.findOne({ _id: refundId });
    if (refund.status === 'processed' && !refund.finalizedAt) await finishProcessedRefund(db, refund, now);
    return { changed: current.status !== next, refund: await refunds.findOne({ _id: refundId }) };
  }
  return { changed: false, refund: await refunds.findOne({ _id: refundId }) };
}

/**
 * Effects of a processed refund, each step idempotent so a crash part-way is completed by the next
 * call (a webhook retry, a refresh or reconciliation):
 *   1. the payment's refund summary is recomputed from its processed refunds;
 *   2. the purchase row gets the refund state (never deleted);
 *   3. if the Super Admin chose it (full refunds only), the access row this payment created loses
 *      its paid entitlement (kept as `entitlementType: 'refunded'` with the reason and dates);
 *   4. an audit entry with a fixed id.
 */
async function finishProcessedRefund(db, refund, now) {
  const reference = refund.paymentReference;
  const payments = db.collection(COLLECTIONS.payments);
  const payment = await payments.findOne({ reference, kind: 'course' });
  if (!payment) return;
  const summary = refundSummary(await refundsForReference(db, reference), payment.amountKobo);
  await payments.updateOne(
    { _id: payment._id },
    { $set: { refundedKobo: summary.refundedKobo, refundState: summary.state, refundUpdatedAt: now } }
  );
  if (summary.state === 'refunded' || summary.state === 'partially_refunded') {
    await db.collection(COLLECTIONS.coursePurchases).updateOne(
      { userId: String(refund.userId), courseId: String(refund.courseId), paymentReference: reference },
      { $set: { refundState: summary.state, refundedKobo: summary.refundedKobo, refundUpdatedAt: now } }
    );
  }
  if (refund.revokeAccess === true && refund.full === true && summary.state === 'refunded' && !refund.accessRevokedAt) {
    const revoked = await db.collection(COLLECTIONS.courseAccess).updateOne(
      { userId: String(refund.userId), courseId: String(refund.courseId), paid: true, paystackReference: reference },
      {
        $set: {
          paid: false,
          entitlementType: 'refunded',
          revokedAt: now,
          revokedReason: `refund:${String(refund._id)}`,
          revokedBy: refund.requestedBy || null,
        },
      }
    );
    await db.collection(COLLECTIONS.refunds).updateOne(
      { _id: refund._id },
      { $set: { accessRevokedAt: now, accessOutcome: revoked.matchedCount ? 'revoked' : 'no_linked_paid_access' } }
    );
  }
  await appendAudit(db, {
    _id: `refund:${String(refund._id)}:processed`,
    entityType: 'payment_refund',
    entityId: String(refund._id),
    reference,
    action: 'refund_processed',
    reason: refund.reason || 'Refund processed by Paystack',
    before: null,
    after: { amountKobo: refund.amountKobo, refundState: summary.state, revokeAccess: Boolean(refund.revokeAccess) },
    actor: refund.requestedBy || { userId: 'system', email: null },
    createdAt: now,
  });
  await db.collection(COLLECTIONS.refunds).updateOne({ _id: refund._id, finalizedAt: { $exists: false } }, { $set: { finalizedAt: now } });
}

// ---------------------------------------------------------------------------------------------
// Refresh (admin action and reconciliation)

/**
 * Re-reads an open refund from Paystack and applies what Paystack reports.
 * Options: fetchRefund(id), listRefunds(transactionId), fetchTransaction(reference).
 */
async function refreshRefund(db, refundId, { fetchRefund, listRefunds, fetchTransaction, now = new Date() }) {
  const refunds = db.collection(COLLECTIONS.refunds);
  const refund = await refunds.findOne({ _id: refundId });
  if (!refund) return { ok: false, code: 'refund_not_found' };
  if (refund.status === 'processed' && !refund.finalizedAt) {
    await finishProcessedRefund(db, refund, now);
    return { ok: true, code: 'finalized', refund: await refunds.findOne({ _id: refundId }) };
  }
  if (!REFUND_OPEN.includes(refund.status)) return { ok: true, code: 'already_final', refund };

  if (refund.providerRefundId) {
    const lookup = await fetchRefund(refund.providerRefundId);
    if (lookup.outcome !== 'found') return { ok: false, code: 'provider_uncertain', refund };
    const applied = await applyRefundStatus(db, refund._id, mapProviderStatus(lookup.data.status), { source: 'provider_refresh', now });
    return { ok: true, code: 'refreshed', refund: applied.refund };
  }

  // No Paystack id: the creation call's outcome was never known. Look for it at Paystack.
  const payment = await db.collection(COLLECTIONS.payments).findOne({ reference: refund.paymentReference, kind: 'course' });
  let transactionId = payment && payment.providerTransactionId;
  if (!transactionId && typeof fetchTransaction === 'function') {
    const txn = await fetchTransaction(refund.paymentReference);
    if (txn.outcome === 'found' && txn.data && txn.data.id != null) transactionId = String(txn.data.id);
  }
  if (!transactionId) return { ok: false, code: 'provider_uncertain', refund };
  const list = await listRefunds(transactionId);
  if (list.outcome !== 'found') return { ok: false, code: 'provider_uncertain', refund };
  const requestedAt = new Date(refund.requestedAt).getTime();
  const others = (await refundsForReference(db, refund.paymentReference)).map((r) => r.providerRefundId).filter(Boolean);
  const match = list.data.find((r) => r && Number(r.amount) === Number(refund.amountKobo)
    && !others.includes(String(r.id))
    && (!r.createdAt || new Date(r.createdAt).getTime() >= requestedAt - 60 * 1000));
  if (match) {
    await refunds.updateOne({ _id: refund._id, providerRefundId: { $exists: false } }, { $set: { providerRefundId: String(match.id).slice(0, 40) } });
    const applied = await applyRefundStatus(db, refund._id, mapProviderStatus(match.status), { source: 'provider_refresh', now });
    return { ok: true, code: 'found_at_provider', refund: applied.refund };
  }
  if (now.getTime() - requestedAt >= UNCERTAIN_GRACE_MS) {
    const applied = await applyRefundStatus(db, refund._id, 'request_failed', { source: 'provider_refresh', now, message: 'Paystack has no refund for this request.' });
    return { ok: true, code: 'not_created', refund: applied.refund };
  }
  return { ok: true, code: 'still_unknown', refund };
}

/**
 * The Super Admin confirms in the Paystack dashboard that an `uncertain` request created no refund.
 * Only for uncertain requests without a Paystack id; audited.
 */
async function abandonUncertainRefund(db, refundId, { actor, reason, now = new Date() }) {
  if (!actor || actor.role !== 'superadmin') return refuse(403, 'superadmin_required', 'Only the Super Admin can change refunds.');
  const why = cleanText(reason, REASON_MAX);
  if (why.length < REASON_MIN) return refuse(400, 'invalid_reason', `Give a reason of ${REASON_MIN} to ${REASON_MAX} characters.`);
  const refund = await db.collection(COLLECTIONS.refunds).findOne({ _id: refundId });
  if (!refund) return refuse(404, 'refund_not_found', 'Refund not found.');
  if (refund.status !== 'uncertain' || refund.providerRefundId) {
    return refuse(409, 'not_uncertain', 'Only an unconfirmed request without a Paystack refund id can be closed this way.');
  }
  const applied = await applyRefundStatus(db, refund._id, 'request_failed', { source: 'admin_confirmed_not_created', now, message: why });
  await appendAudit(db, {
    _id: `refund:${String(refund._id)}:abandoned`,
    entityType: 'payment_refund',
    entityId: String(refund._id),
    reference: refund.paymentReference,
    action: 'refund_request_closed',
    reason: why,
    before: { status: 'uncertain' },
    after: { status: 'request_failed' },
    actor: actorOf(actor),
    createdAt: now,
  });
  return { ok: true, status: 200, code: 'closed', refund: applied.refund };
}

// ---------------------------------------------------------------------------------------------
// Webhook

/**
 * Signed `refund.*` event. The local refund is found by Paystack refund id, else by the one open
 * refund of the same payment and amount. Its status is re-read from Paystack when possible before a
 * final status is applied. Refunds not started here (Paystack dashboard) are stored as `external`
 * records and flagged for review; access never changes for them.
 */
async function processRefundEvent(db, event, data, { fetchRefund, now = new Date() } = {}) {
  const reference = shortRef(data.transaction_reference || (data.transaction && data.transaction.reference) || data.reference);
  const refundId = data.id != null ? String(data.id).slice(0, 40) : null;
  const eventStatus = mapProviderStatus(data.status || event.slice('refund.'.length));
  const refunds = db.collection(COLLECTIONS.refunds);

  let local = refundId ? await refunds.findOne({ providerRefundId: refundId }) : null;
  if (!local && reference) {
    const candidates = (await refunds.find({ paymentReference: reference, open: true }).toArray())
      .filter((r) => !r.providerRefundId && (data.amount == null || Number(r.amountKobo) === Number(data.amount)));
    if (candidates.length === 1) {
      local = candidates[0];
      if (refundId) await refunds.updateOne({ _id: local._id, providerRefundId: { $exists: false } }, { $set: { providerRefundId: refundId } });
    }
  }

  // The event names the refund; Paystack's own record decides its status. Without a refund id the
  // signed event is the only evidence and is used as is.
  let status = eventStatus;
  let verified = true;
  if (refundId && typeof fetchRefund === 'function') {
    const lookup = await fetchRefund(refundId);
    if (lookup.outcome === 'uncertain') return { ack: false, code: 'refund_lookup_uncertain' };
    if (lookup.outcome === 'found') status = mapProviderStatus(lookup.data.status);
    else verified = false;
  }

  if (local) {
    if (!verified) return { ack: true, code: 'refund_unverified' };
    const applied = await applyRefundStatus(db, local._id, status, { source: 'webhook', now });
    return { ack: true, code: applied.changed ? `refund_${status}` : 'refund_unchanged' };
  }
  if (!verified) status = 'uncertain';

  // Not started in this app. Record it (deduplicated by the Paystack refund id) and flag it.
  const payment = reference ? await db.collection(COLLECTIONS.payments).findOne({ reference, kind: 'course' }) : null;
  if (payment && refundId) {
    try {
      await refunds.updateOne(
        { providerRefundId: refundId },
        {
          $setOnInsert: {
            _id: new ObjectId(),
            requestId: `external-${refundId}`,
            providerRefundId: refundId,
            paymentReference: reference,
            userId: String(payment.userId),
            courseId: String(payment.courseId),
            amountKobo: Number.isInteger(Number(data.amount)) ? Number(data.amount) : null,
            currency: COURSE_CURRENCY,
            full: false,
            revokeAccess: false,
            reason: 'Refund made outside ForexOrbit (Paystack dashboard)',
            initiatedBy: 'external',
            status: 'requested',
            ...(REFUND_FINAL.includes(status) ? {} : { open: true }),
            requestedAt: now,
            updatedAt: now,
            history: [{ at: now, status: 'requested', source: 'webhook_external' }],
          },
        },
        { upsert: true }
      );
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
    }
    const external = await refunds.findOne({ providerRefundId: refundId });
    if (external) await applyRefundStatus(db, external._id, status, { source: 'webhook', now });
  }
  await recordPaymentException(db, {
    reference: reference || `event:${event}:${refundId || now.getTime()}`,
    reason: 'refund_unhandled',
    source: 'webhook',
    userId: payment ? payment.userId : null,
    courseId: payment ? payment.courseId : null,
    amountKobo: data.amount,
    currency: data.currency,
    providerStatus: event,
    eventKey: refundId ? `event:${event}:${refundId}` : null,
  }, now);
  return { ack: true, code: 'external_refund_recorded' };
}

function shortRef(value) {
  const ref = typeof value === 'string' ? value.trim() : '';
  return REFERENCE_PATTERN.test(ref) ? ref : null;
}

/** Public shape (no provider payload, no actor email for students). */
function presentRefund(row, { forStudent = false } = {}) {
  if (!row) return null;
  return {
    id: String(row._id),
    paymentReference: row.paymentReference,
    amountKobo: Number(row.amountKobo) || 0,
    currency: row.currency || COURSE_CURRENCY,
    status: row.status,
    full: Boolean(row.full),
    requestedAt: row.requestedAt ? new Date(row.requestedAt).toISOString() : null,
    closedAt: row.closedAt ? new Date(row.closedAt).toISOString() : null,
    ...(forStudent
      ? {}
      : {
          revokeAccess: Boolean(row.revokeAccess),
          accessOutcome: row.accessOutcome || null,
          initiatedBy: row.initiatedBy || 'admin',
          reason: row.reason || '',
          providerRefundId: row.providerRefundId || null,
          providerMessage: row.providerMessage || null,
          requestedBy: row.requestedBy ? { userId: row.requestedBy.userId || null, email: row.requestedBy.email || null } : null,
          history: Array.isArray(row.history) ? row.history.map((h) => ({ at: h.at ? new Date(h.at).toISOString() : null, status: h.status, source: h.source })) : [],
        }),
  };
}

module.exports = {
  MIN_REFUND_KOBO,
  REFUND_FINAL,
  REFUND_OPEN,
  UNCERTAIN_GRACE_MS,
  abandonUncertainRefund,
  applyRefundStatus,
  createPaystackRefund,
  fetchPaystackRefund,
  finishProcessedRefund,
  listPaystackRefunds,
  mapProviderStatus,
  presentRefund,
  processRefundEvent,
  refreshRefund,
  refundSummary,
  refundsForReference,
  requestRefund,
};
