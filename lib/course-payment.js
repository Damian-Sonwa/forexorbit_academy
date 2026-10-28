'use strict';

/**
 * Full-course purchase: one server-created Paystack intent per checkout, confirmed only
 * after the provider reports success for that intent's exact amount and currency.
 *
 * Works against any object exposing `collection(name)` with the MongoDB driver methods used
 * below, so tests can run the real flow on an in-memory store.
 */

const crypto = require('crypto');
const { ObjectId } = require('mongodb');
const { COURSE_PRICE_KOBO, COURSE_CURRENCY } = require('./course-price');

const SHARED_DB_NAME = 'Forex_elearning';
const INTENT_TTL_MS = 30 * 60 * 1000;
/** Pending intents older than this are expired without asking the provider. */
const INTENT_RECHECK_WINDOW_MS = 24 * 60 * 60 * 1000;
const PROVIDER_TIMEOUT_MS = 10000;
const REFERENCE_PATTERN = /^[A-Za-z0-9_.=-]{6,100}$/;

const COLLECTIONS = Object.freeze({
  intents: 'paystackPaymentIntents',
  payments: 'paystackPayments',
  courseAccess: 'userCourseAccess',
  coursePurchases: 'coursePurchases',
  exceptions: 'paymentExceptions',
  lessonAccess: 'userLessonAccess',
  lessonPurchases: 'lessonPurchases',
});

/** Append-only Super Admin audit trail (see lib/admin-purchase-ledger.js). */
const AUDIT_COLLECTION = 'adminAuditLog';

/** Entitlement types an administrator may grant without a payment. */
const GRANTED_ENTITLEMENTS = Object.freeze(['complimentary', 'manual_grant']);

/**
 * A confirmation claims its checkout intent by moving it to `processing`. A claim older than
 * this is treated as abandoned (the process died) and may be taken over.
 */
const CLAIM_TTL_MS = 2 * 60 * 1000;
/** Intent states a confirmation may claim. `paid` and `held` are final. */
const CLAIMABLE_INTENT_STATUSES = Object.freeze(['pending', 'expired', 'superseded']);

const CLOSED_EXCEPTION_STATUSES = new Set(['resolved', 'dismissed']);
const MAX_EXCEPTION_EVENT_KEYS = 100;
const SYSTEM_ACTOR = Object.freeze({ userId: 'system', email: null });

const PENDING_PROVIDER_STATUSES = new Set(['ongoing', 'pending', 'processing', 'queued']);

function courseEntitlementQuery(userId, courseId) {
  return {
    userId: String(userId),
    courseId: String(courseId),
    $or: [{ paid: true }, { entitlementType: { $in: [...GRANTED_ENTITLEMENTS] } }],
  };
}

/** Legacy per-lesson rows unlock only the lesson they name. */
function legacyLessonAccessQuery(userId, lessonIds) {
  return { userId: String(userId), lessonId: { $in: lessonIds.map(String) }, paid: true };
}

function legacyLessonPurchaseQuery(userId, lessonIds) {
  return { userId: String(userId), lessonId: { $in: lessonIds.map(String) } };
}

async function hasCourseEntitlement(db, userId, courseId) {
  const count = await db
    .collection(COLLECTIONS.courseAccess)
    .countDocuments(courseEntitlementQuery(userId, courseId), { limit: 1 });
  return count > 0;
}

async function legacyLessonIdsWithAccess(db, userId, lessonIds) {
  if (!lessonIds.length) return new Set();
  const [access, purchases] = await Promise.all([
    db.collection(COLLECTIONS.lessonAccess).find(legacyLessonAccessQuery(userId, lessonIds)).project({ lessonId: 1 }).toArray(),
    db.collection(COLLECTIONS.lessonPurchases).find(legacyLessonPurchaseQuery(userId, lessonIds)).project({ lessonId: 1 }).toArray(),
  ]);
  return new Set([...access, ...purchases].map((row) => String(row.lessonId)));
}

function isLocalMongoUri(uri) {
  return /^mongodb:\/\/(?:[^@/]*@)?(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|\?|$)/i.test(String(uri || '').trim());
}

function resolveDbName(env) {
  return String(env.MONGODB_DB_NAME || '').trim() || SHARED_DB_NAME;
}

/**
 * Payments may run only where a successful charge cannot write entitlements into the shared
 * database by accident. Production must be explicit and needs a live key, because a test key
 * there would let test cards unlock real courses; anything else needs a Paystack test key and an
 * isolated database.
 */
function decidePaymentEnvironment(env) {
  const secret = String(env.PAYSTACK_SECRET_KEY || '').trim();
  if (!secret) {
    return { enabled: false, status: 503, reason: 'not_configured', message: 'Payments are not configured' };
  }
  if (env.NODE_ENV === 'production') {
    if (secret.startsWith('sk_live_')) return { enabled: true, mode: 'live' };
    return {
      enabled: false,
      status: 503,
      reason: secret.startsWith('sk_test_') ? 'test_key_in_production' : 'unrecognized_key',
      message: 'Payments are disabled: production requires a live Paystack secret key',
    };
  }
  if (!secret.startsWith('sk_test_')) {
    return {
      enabled: false,
      status: 503,
      reason: 'live_key_outside_production',
      message: 'Payments are disabled: a live Paystack key is configured outside production',
    };
  }
  const uri = env.MONGO_URI || env.MONGODB_URI;
  if (!isLocalMongoUri(uri) && resolveDbName(env) === SHARED_DB_NAME) {
    return {
      enabled: false,
      status: 503,
      reason: 'shared_database',
      message: 'Payments are disabled: set MONGODB_DB_NAME to an isolated database for local payment testing',
    };
  }
  return { enabled: true, mode: 'test' };
}

function verifyWebhookSignature(rawBody, secret, signatureHeader) {
  if (!secret || typeof signatureHeader !== 'string' || !signatureHeader) return false;
  const expected = crypto.createHmac('sha512', secret).update(rawBody).digest('hex');
  if (expected.length !== signatureHeader.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(signatureHeader, 'utf8'));
  } catch {
    return false;
  }
}

/**
 * Normalized provider lookup. `uncertain` means the outcome is unknown and the caller must
 * leave the reference retryable without granting or creating a new charge.
 */
async function fetchPaystackTransaction(reference, options = {}) {
  const secret = String(options.secret || '').trim();
  if (!secret) return { outcome: 'uncertain', reason: 'not_configured' };
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const timeoutMs = options.timeoutMs || PROVIDER_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetchImpl(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${secret}`, Accept: 'application/json' },
      signal: controller.signal,
    });
  } catch (error) {
    return { outcome: 'uncertain', reason: error && error.name === 'AbortError' ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 429 || res.status >= 500 || res.status === 401 || res.status === 403) {
    return { outcome: 'uncertain', reason: `http_${res.status}` };
  }
  let json;
  try {
    json = await res.json();
  } catch {
    return { outcome: 'uncertain', reason: 'invalid_response' };
  }
  if (res.ok && json && json.status === true && json.data && typeof json.data === 'object') {
    return { outcome: 'found', data: json.data };
  }
  if (res.status === 400 || res.status === 404 || (res.ok && json && json.status === false)) {
    return { outcome: 'not_found' };
  }
  return { outcome: 'uncertain', reason: `http_${res.status}` };
}

function flattenMetadata(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, value] of Object.entries(raw)) {
    if (value == null) continue;
    out[key] = typeof value === 'string' ? value.trim() : String(value);
  }
  return out;
}

/** Compares a provider transaction with the server-created intent it claims to pay. */
function evaluateTransaction(intent, data) {
  const status = String((data && data.status) || '').toLowerCase();
  if (status !== 'success') {
    if (PENDING_PROVIDER_STATUSES.has(status)) {
      return { grant: false, code: 'payment_pending', status: 409, retryable: true, exception: false, message: 'Payment is still processing. Try again in a moment.' };
    }
    return { grant: false, code: 'payment_not_successful', status: 402, retryable: false, exception: false, message: 'Payment was not successful. No charge was applied to this course.' };
  }
  const mismatch = (code, message) => ({ grant: false, code, status: 400, retryable: false, exception: true, message });
  if (data.reference && String(data.reference) !== String(intent.reference)) {
    return mismatch('reference_mismatch', 'Payment reference does not match this checkout.');
  }
  const expectedAmount = Number(intent.amountKobo);
  if (!Number.isInteger(expectedAmount) || expectedAmount <= 0 || Number(data.amount) !== expectedAmount) {
    return mismatch('amount_mismatch', 'Paid amount does not match the course price for this checkout.');
  }
  if (String(intent.currency || '').toUpperCase() !== COURSE_CURRENCY || String(data.currency || '').toUpperCase() !== COURSE_CURRENCY) {
    return mismatch('currency_mismatch', 'Payment currency must be NGN.');
  }
  const meta = flattenMetadata(data.metadata);
  if (meta.lessonId) return mismatch('metadata_mismatch', 'Payment metadata does not describe a course purchase.');
  if (meta.userId && meta.userId !== String(intent.userId)) return mismatch('metadata_mismatch', 'Payment metadata does not match this checkout.');
  if (meta.courseId && meta.courseId !== String(intent.courseId)) return mismatch('metadata_mismatch', 'Payment metadata does not match this checkout.');
  return { grant: true };
}

function exceptionIsClosed(doc) {
  if (doc.review && typeof doc.review.status === 'string') return CLOSED_EXCEPTION_STATUSES.has(doc.review.status);
  return doc.resolved === true;
}

function exceptionReviewState(doc) {
  const review = doc.review || {};
  return {
    status: typeof review.status === 'string' ? review.status : doc.resolved === true ? 'resolved' : 'open',
    outcome: review.outcome || 'none',
    notes: review.notes || '',
  };
}

/**
 * One exception per reference and reason. `eventKey` names the provider event or transaction
 * that caused it, so a replayed delivery of the same event is ignored instead of counted again.
 * A new occurrence of a resolved or dismissed exception reopens it; the earlier review stays in
 * `reviewHistory` and an audit entry records the reopening.
 */
async function recordPaymentException(db, entry, now) {
  const at = now || new Date();
  const col = db.collection(COLLECTIONS.exceptions);
  const key = { reference: String(entry.reference), reason: entry.reason };
  const eventKey = entry.eventKey ? String(entry.eventKey).slice(0, 200) : null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const existing = await col.findOne(key);
    if (!existing) {
      const inserted = await col.updateOne(
        key,
        {
          $setOnInsert: {
            ...key,
            source: entry.source,
            userId: entry.userId ? String(entry.userId) : null,
            courseId: entry.courseId ? String(entry.courseId) : null,
            amountKobo: Number.isFinite(Number(entry.amountKobo)) ? Number(entry.amountKobo) : null,
            currency: entry.currency ? String(entry.currency).toUpperCase() : null,
            providerStatus: entry.providerStatus || null,
            evidence: entry.evidence || null,
            eventKeys: eventKey ? [eventKey] : [],
            resolved: false,
            createdAt: at,
          },
          $set: { lastSeenAt: at },
          $inc: { occurrences: 1 },
        },
        { upsert: true }
      );
      if (inserted.upsertedCount) return { recorded: 'created' };
      continue;
    }

    const seen = Array.isArray(existing.eventKeys) ? existing.eventKeys : [];
    if (eventKey && seen.includes(eventKey)) return { recorded: 'replay' };
    const eventKeys = eventKey ? [...seen, eventKey].slice(-MAX_EXCEPTION_EVENT_KEYS) : seen;

    if (!exceptionIsClosed(existing)) {
      await col.updateOne({ _id: existing._id }, { $set: { lastSeenAt: at, eventKeys }, $inc: { occurrences: 1 } });
      return { recorded: 'occurrence' };
    }

    const version = Number.isInteger(existing.reviewVersion) ? existing.reviewVersion : 0;
    const before = exceptionReviewState(existing);
    const after = { status: 'open', outcome: before.outcome, notes: before.notes };
    const auditId = new ObjectId();
    const reason = 'The exception occurred again after it was closed.';
    const reopened = await col.updateOne(
      { _id: existing._id, ...(version === 0 ? { reviewVersion: { $exists: false } } : { reviewVersion: version }) },
      {
        $set: {
          lastSeenAt: at,
          eventKeys,
          resolved: false,
          review: { ...(existing.review || {}), status: 'open', updatedAt: at, updatedBy: SYSTEM_ACTOR },
          reviewVersion: version + 1,
          reopenedAt: at,
          reopenCount: (Number.isInteger(existing.reopenCount) ? existing.reopenCount : 0) + 1,
          pendingAuditIds: [...(Array.isArray(existing.pendingAuditIds) ? existing.pendingAuditIds : []), auditId],
        },
        $inc: { occurrences: 1 },
        $push: { reviewHistory: { at, actor: SYSTEM_ACTOR, reason, before, after, action: 'exception_reopened', auditId } },
      }
    );
    if (!reopened.matchedCount) continue;
    await writeExceptionAudit(db, {
      _id: auditId,
      entityType: 'payment_exception',
      entityId: String(existing._id),
      reference: existing.reference || null,
      action: 'exception_reopened',
      reason,
      before,
      after,
      actor: SYSTEM_ACTOR,
      createdAt: at,
    }, existing._id);
    return { recorded: 'reopened' };
  }
  throw new Error('payment exception kept changing while it was being recorded');
}

/**
 * Inserts an audit entry whose id is already listed in the exception's `pendingAuditIds`, then
 * clears it. If the insert fails the id stays pending and `repairPendingExceptionAudits` in
 * lib/admin-purchase-ledger.js writes it later; the fixed `_id` prevents a second copy.
 */
async function writeExceptionAudit(db, auditEntry, exceptionId) {
  try {
    await db.collection(AUDIT_COLLECTION).insertOne(auditEntry);
  } catch (error) {
    if (!isDuplicateKey(error)) return false;
  }
  await db.collection(COLLECTIONS.exceptions).updateOne({ _id: exceptionId }, { $pull: { pendingAuditIds: auditEntry._id } });
  return true;
}

function isDuplicateKey(error) {
  return Boolean(error && (error.code === 11000 || error.codeName === 'DuplicateKey'));
}

function isEntitledRow(row) {
  return Boolean(row && (row.paid === true || GRANTED_ENTITLEMENTS.includes(row.entitlementType)));
}

/**
 * The user's course entitlement from some other source (another payment, a grant, or a legacy
 * record). Null when there is none, or when an entitled row already names this reference.
 */
async function findOtherEntitlement(db, userId, courseId, reference) {
  const rows = await db.collection(COLLECTIONS.courseAccess).find(courseEntitlementQuery(userId, courseId)).toArray();
  if (!rows.length || rows.some((row) => String(row.paystackReference || '') === reference)) return null;
  return rows[0];
}

function transactionEventKey(data, reference) {
  return `txn:${data && data.id != null ? String(data.id) : reference}`;
}

function providerPaidAt(data, now) {
  const raw = data && (data.paid_at || data.paidAt);
  const parsed = raw ? new Date(raw) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : now;
}

function withPrevious(list, value, current) {
  const previous = Array.isArray(list) ? list.map(String) : [];
  if (!value || String(value) === current || previous.includes(String(value))) return previous;
  return [...previous, String(value)];
}

/**
 * Applies a verified payment to the user's course access. Retrying after a partial write finishes
 * the remaining steps. An entitlement the user already holds (paid, complimentary, or manual) is
 * never overwritten; an earlier reference on a non-entitled row is kept in
 * `previousPaystackReferences` / `previousPaymentReferences`.
 */
async function grantCourseEntitlement(db, { intent, amountKobo, currency, source, paidAt, now }) {
  const reference = String(intent.reference);
  const userId = String(intent.userId);
  const courseId = String(intent.courseId);
  const payment = await db.collection(COLLECTIONS.payments).updateOne(
    { reference },
    {
      $setOnInsert: {
        reference,
        userId,
        courseId,
        kind: 'course',
        status: 'success',
        amountKobo,
        currency,
        source,
        paidAt: paidAt || now,
        entitlementApplied: true,
        createdAt: now,
      },
    },
    { upsert: true }
  );

  const accessCol = db.collection(COLLECTIONS.courseAccess);
  const access = await accessCol.findOne({ userId, courseId });
  if (!access) {
    await accessCol.updateOne(
      { userId, courseId },
      {
        $set: { paid: true, verifiedAt: now },
        $setOnInsert: {
          userId,
          courseId,
          entitlementType: 'paid_course',
          paystackReference: reference,
          amountKobo,
          currency,
          source: `paystack-${source}`,
          unlockedAt: now,
          createdAt: now,
        },
      },
      { upsert: true }
    );
  } else if (!isEntitledRow(access)) {
    await accessCol.updateOne(
      { _id: access._id, paid: { $ne: true } },
      {
        $set: {
          paid: true,
          entitlementType: 'paid_course',
          paystackReference: reference,
          previousPaystackReferences: withPrevious(access.previousPaystackReferences, access.paystackReference, reference),
          amountKobo,
          currency,
          source: `paystack-${source}`,
          verifiedAt: now,
          unlockedAt: access.unlockedAt || now,
        },
      }
    );
  }

  const purchaseCol = db.collection(COLLECTIONS.coursePurchases);
  const purchase = await purchaseCol.findOne({ userId, courseId });
  if (!purchase) {
    await purchaseCol.updateOne(
      { userId, courseId },
      {
        $set: { status: 'paid', updatedAt: now },
        $setOnInsert: { userId, courseId, paymentReference: reference, amountKobo, currency, createdAt: now },
      },
      { upsert: true }
    );
  } else if (purchase.status !== 'paid') {
    await purchaseCol.updateOne(
      { _id: purchase._id, status: { $ne: 'paid' } },
      {
        $set: {
          status: 'paid',
          paymentReference: reference,
          previousPaymentReferences: withPrevious(purchase.previousPaymentReferences, purchase.paymentReference, reference),
          amountKobo,
          currency,
          updatedAt: now,
        },
      }
    );
  }

  await db.collection(COLLECTIONS.intents).updateOne({ _id: intent._id }, { $set: { status: 'paid', paidAt: now, claimedAt: null } });
  return { newPayment: Boolean(payment.upsertedCount) };
}

/**
 * Keeps a verified charge that must not change access (a duplicate purchase, or a payment on a
 * closed checkout): the payment row is stored with `entitlementApplied: false`, an exception is
 * recorded for review, and the intent becomes `held`. Nothing is refunded or revoked.
 */
async function holdPayment(db, { intent, reason, evidence, amountKobo, currency, providerStatus, eventKey, source, paidAt, now }) {
  const reference = String(intent.reference);
  await db.collection(COLLECTIONS.payments).updateOne(
    { reference },
    {
      $setOnInsert: {
        reference,
        userId: String(intent.userId),
        courseId: String(intent.courseId),
        kind: 'course',
        status: 'success',
        amountKobo,
        currency,
        source,
        paidAt: paidAt || now,
        entitlementApplied: false,
        heldReason: reason,
        heldEvidence: evidence || null,
        heldEventKey: eventKey || null,
        createdAt: now,
      },
    },
    { upsert: true }
  );
  await recordPaymentException(db, {
    reference,
    reason,
    source,
    userId: intent.userId,
    courseId: intent.courseId,
    amountKobo,
    currency,
    providerStatus,
    evidence,
    eventKey,
  }, now);
  await db.collection(COLLECTIONS.intents).updateOne(
    { _id: intent._id },
    { $set: { status: 'held', heldReason: reason, closedAt: now, claimedAt: null } }
  );
}

function heldResult(reason, intent, reference, alreadyProcessed) {
  if (reason === 'duplicate_payment') {
    return { ok: true, status: 200, courseId: String(intent.courseId), reference, alreadyProcessed, duplicatePayment: true };
  }
  return failure(409, 'needs_review', 'This payment was made on a checkout that had already been closed. It has been recorded for support review.', { recorded: true });
}

async function claimIntent(db, intent, now) {
  const status = intent.status;
  const filter = { _id: intent._id };
  let claimedFrom;
  if (status === 'processing') {
    const claimedAt = intent.claimedAt ? new Date(intent.claimedAt) : new Date(0);
    if (now.getTime() - claimedAt.getTime() < CLAIM_TTL_MS) return { busy: true };
    filter.status = 'processing';
    filter.claimedAt = intent.claimedAt == null ? null : intent.claimedAt;
    claimedFrom = intent.claimedFrom || 'pending';
  } else if (status == null) {
    filter.status = { $exists: false };
    claimedFrom = 'pending';
  } else if (CLAIMABLE_INTENT_STATUSES.includes(status)) {
    filter.status = status;
    claimedFrom = status;
  } else {
    return { closed: true };
  }
  const result = await db.collection(COLLECTIONS.intents).updateOne(filter, { $set: { status: 'processing', claimedAt: now, claimedFrom } });
  if (!result.matchedCount) return { lost: true };
  return { claimed: true, intent: { ...intent, status: 'processing', claimedAt: now, claimedFrom } };
}

async function releaseIntent(db, intent) {
  await db.collection(COLLECTIONS.intents).updateOne(
    { _id: intent._id, status: 'processing', claimedAt: intent.claimedAt },
    { $set: { status: intent.claimedFrom, claimedAt: null } }
  );
}

function failure(status, code, message, extra = {}) {
  return { ok: false, status, code, message, retryable: false, ...extra };
}

/**
 * Confirms a course payment for `source` `checkout` (signed-in student, provider is queried)
 * or `webhook` (signed Paystack event, `providerData` is the event payload).
 */
async function confirmCoursePayment(db, options) {
  const now = options.now || new Date();
  const source = options.source === 'webhook' ? 'webhook' : 'checkout';
  const reference = String(options.reference || '').trim();
  if (!REFERENCE_PATTERN.test(reference)) {
    return failure(400, 'invalid_reference', 'A valid payment reference is required.');
  }

  const lookup = async () => {
    if (source === 'webhook') return { outcome: 'found', data: options.providerData || {} };
    return options.fetchTransaction(reference);
  };

  const intent = await db.collection(COLLECTIONS.intents).findOne({ reference });

  if (!intent) {
    if (source === 'checkout') {
      const settled = await db.collection(COLLECTIONS.payments).findOne({ reference, userId: options.sessionUserId, kind: 'course', status: 'success' });
      if (settled && (await hasCourseEntitlement(db, settled.userId, settled.courseId))) {
        return { ok: true, status: 200, courseId: String(settled.courseId), reference, alreadyProcessed: true };
      }
    }
    const result = await lookup();
    if (result.outcome === 'uncertain') {
      return failure(503, 'provider_uncertain', 'We could not reach the payment provider. Try again shortly.', { retryable: true });
    }
    const data = result.outcome === 'found' ? result.data : null;
    const meta = flattenMetadata(data && data.metadata);
    const ownsCharge = source === 'webhook' || meta.userId === String(options.sessionUserId);
    if (data && String(data.status).toLowerCase() === 'success' && ownsCharge) {
      await recordPaymentException(db, {
        reference,
        reason: 'no_matching_intent',
        source,
        userId: meta.userId,
        courseId: meta.courseId,
        amountKobo: data.amount,
        currency: data.currency,
        providerStatus: data.status,
        eventKey: transactionEventKey(data, reference),
      }, now);
      return failure(409, 'needs_review', 'This payment could not be matched to a checkout. It has been recorded for support review.', { recorded: true });
    }
    return failure(404, 'unknown_reference', 'Unknown payment reference. Start checkout from the course page.');
  }

  if (options.sessionUserId !== undefined && String(intent.userId) !== String(options.sessionUserId)) {
    return failure(403, 'reference_owner_mismatch', 'This payment reference belongs to another account.');
  }
  if (options.expectedCourseId && String(intent.courseId) !== String(options.expectedCourseId)) {
    return failure(400, 'course_mismatch', 'This payment reference is for a different course.');
  }

  if (intent.kind !== 'course') {
    const result = await lookup();
    const data = result.outcome === 'found' ? result.data : null;
    if (data && String(data.status).toLowerCase() === 'success') {
      await recordPaymentException(db, {
        reference,
        reason: 'lesson_purchase_retired',
        source,
        userId: intent.userId,
        courseId: intent.courseId,
        amountKobo: data.amount,
        currency: data.currency,
        providerStatus: data.status,
        eventKey: transactionEventKey(data, reference),
      }, now);
    }
    return failure(410, 'lesson_purchase_retired', 'Individual lesson purchases are no longer available. Unlock the full course instead.', { recorded: Boolean(data && String(data.status).toLowerCase() === 'success') });
  }

  const ctx = { reference, source, lookup, now };
  let current = intent;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (current.status === 'paid') {
      return { ok: true, status: 200, courseId: String(current.courseId), reference, alreadyProcessed: true };
    }
    if (current.status === 'held') {
      return heldResult(current.heldReason, current, reference, true);
    }
    const claim = await claimIntent(db, current, now);
    if (claim.closed) {
      return failure(409, 'checkout_closed', 'This checkout is closed. Start checkout again from the course page.');
    }
    if (claim.busy) {
      return failure(409, 'payment_processing', 'This payment is already being confirmed. Try again in a moment.', { retryable: true });
    }
    if (claim.claimed) {
      try {
        return await settleClaimedIntent(db, claim.intent, ctx);
      } catch (error) {
        await releaseIntent(db, claim.intent).catch(() => {});
        throw error;
      }
    }
    current = await db.collection(COLLECTIONS.intents).findOne({ _id: intent._id });
    if (!current) return failure(404, 'unknown_reference', 'Unknown payment reference. Start checkout from the course page.');
  }
  return failure(409, 'payment_processing', 'This payment is already being confirmed. Try again in a moment.', { retryable: true });
}

/**
 * Runs while this request holds the intent's `processing` claim, so a concurrent confirmation of
 * the same reference waits instead of writing a second set of records.
 */
async function settleClaimedIntent(db, intent, { reference, source, lookup, now }) {
  const settled = await db.collection(COLLECTIONS.payments).findOne({ reference, status: 'success' });
  if (settled && settled.entitlementApplied === false) {
    const reason = settled.heldReason || 'duplicate_payment';
    await holdPayment(db, {
      intent,
      reason,
      evidence: settled.heldEvidence || null,
      amountKobo: Number(settled.amountKobo),
      currency: String(settled.currency || COURSE_CURRENCY),
      providerStatus: 'success',
      eventKey: settled.heldEventKey || `txn:${reference}`,
      source: settled.source || source,
      paidAt: settled.paidAt,
      now,
    });
    return heldResult(reason, intent, reference, true);
  }
  if (settled) {
    await grantCourseEntitlement(db, {
      intent,
      amountKobo: Number(settled.amountKobo),
      currency: String(settled.currency || COURSE_CURRENCY),
      source: settled.source || source,
      paidAt: settled.paidAt,
      now,
    });
    return { ok: true, status: 200, courseId: String(intent.courseId), reference, alreadyProcessed: true };
  }

  const result = await lookup();
  if (result.outcome === 'uncertain') {
    await releaseIntent(db, intent);
    return failure(503, 'provider_uncertain', 'We could not confirm the payment with the provider yet. Try again shortly.', { retryable: true });
  }
  if (result.outcome === 'not_found') {
    await releaseIntent(db, intent);
    return failure(409, 'payment_not_found', 'We have not received this payment yet. Complete checkout, then try again.', { retryable: true });
  }

  const data = result.data;
  const verdict = evaluateTransaction(intent, data);
  if (!verdict.grant) {
    if (verdict.exception) {
      await recordPaymentException(db, {
        reference,
        reason: verdict.code,
        source,
        userId: intent.userId,
        courseId: intent.courseId,
        amountKobo: data.amount,
        currency: data.currency,
        providerStatus: data.status,
        eventKey: transactionEventKey(data, reference),
      }, now);
    }
    await releaseIntent(db, intent);
    return failure(verdict.status, verdict.code, verdict.message, { retryable: verdict.retryable, recorded: verdict.exception });
  }

  const paidAt = providerPaidAt(data, now);
  const charge = {
    intent,
    amountKobo: Number(data.amount),
    currency: COURSE_CURRENCY,
    providerStatus: data.status,
    eventKey: transactionEventKey(data, reference),
    source,
    paidAt,
    now,
  };

  const other = await findOtherEntitlement(db, intent.userId, intent.courseId, reference);
  if (other) {
    await holdPayment(db, {
      ...charge,
      reason: 'duplicate_payment',
      evidence: {
        existingReference: other.paystackReference ? String(other.paystackReference) : null,
        existingEntitlementType: other.entitlementType || (other.paid === true ? 'paid' : null),
      },
    });
    return heldResult('duplicate_payment', intent, reference, false);
  }
  if (intent.claimedFrom === 'superseded') {
    await holdPayment(db, {
      ...charge,
      reason: 'superseded_intent_paid',
      evidence: { supersededAt: intent.closedAt || null, supersededBy: intent.supersededBy || null },
    });
    return heldResult('superseded_intent_paid', intent, reference, false);
  }

  const granted = await grantCourseEntitlement(db, {
    intent,
    amountKobo: charge.amountKobo,
    currency: COURSE_CURRENCY,
    source,
    paidAt,
    now,
  });
  return { ok: true, status: 200, courseId: String(intent.courseId), reference, alreadyProcessed: !granted.newPayment };
}

function newReference() {
  return `fo_c_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
}

function intentOrder(a, b) {
  const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
  const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
  if (ta !== tb) return ta - tb;
  return String(a.reference).localeCompare(String(b.reference));
}

function checkoutFor(intent, reused) {
  return {
    ok: true,
    alreadyOwned: false,
    reference: String(intent.reference),
    amountKobo: Number(intent.amountKobo),
    currency: String(intent.currency || COURSE_CURRENCY),
    reused,
  };
}

/**
 * Starts a checkout. Earlier unpaid intents for the same course are checked first so a paid
 * but unconfirmed checkout is granted instead of charged twice. An unexpired intent that
 * Paystack has never seen is handed out again rather than replaced, so the user has one payable
 * reference per course. Intents are superseded only once Paystack reports them unpaid
 * (failed or abandoned) or their checkout window has passed.
 */
async function createCourseIntent(db, options) {
  const now = options.now || new Date();
  const userId = String(options.userId);
  const courseId = String(options.courseId);
  const intents = db.collection(COLLECTIONS.intents);

  if (await hasCourseEntitlement(db, userId, courseId)) {
    return { ok: true, alreadyOwned: true };
  }

  const open = (await intents
    .find({ userId, courseId, kind: 'course', $or: [{ status: 'pending' }, { status: { $exists: false } }] })
    .toArray()).sort(intentOrder);

  let reusable = null;
  for (const intent of open) {
    const createdAt = intent.createdAt ? new Date(intent.createdAt) : new Date(0);
    if (now.getTime() - createdAt.getTime() > INTENT_RECHECK_WINDOW_MS) {
      await intents.updateOne({ _id: intent._id, status: intent.status == null ? { $exists: false } : intent.status }, { $set: { status: 'expired', closedAt: now } });
      continue;
    }
    const lookup = await options.fetchTransaction(String(intent.reference));
    if (lookup.outcome === 'uncertain') {
      return failure(503, 'previous_payment_uncertain', 'We are still confirming your previous checkout. Try again shortly.', { retryable: true });
    }
    if (lookup.outcome === 'found') {
      const status = String(lookup.data.status || '').toLowerCase();
      if (status === 'success') {
        const confirmed = await confirmCoursePayment(db, {
          reference: intent.reference,
          source: 'checkout',
          sessionUserId: userId,
          expectedCourseId: courseId,
          fetchTransaction: async () => lookup,
          now,
        });
        if (confirmed.ok) return { ok: true, alreadyOwned: true };
        return confirmed;
      }
      if (PENDING_PROVIDER_STATUSES.has(status)) {
        return failure(409, 'previous_payment_pending', 'Your previous payment is still processing. Try again in a moment.', { retryable: true });
      }
    } else {
      const expiresAt = intent.expiresAt ? new Date(intent.expiresAt) : createdAt;
      if (!reusable && intent.amountKobo === COURSE_PRICE_KOBO && now.getTime() < expiresAt.getTime()) {
        reusable = intent;
        continue;
      }
    }
    await intents.updateOne(
      { _id: intent._id, status: intent.status == null ? { $exists: false } : intent.status },
      { $set: { status: 'superseded', closedAt: now } }
    );
  }
  if (reusable) return checkoutFor(reusable, true);

  const reference = (options.makeReference || newReference)();
  let inserted;
  try {
    inserted = await intents.insertOne({
      reference,
      userId,
      courseId,
      kind: 'course',
      amountKobo: COURSE_PRICE_KOBO,
      currency: COURSE_CURRENCY,
      status: 'pending',
      createdAt: now,
      expiresAt: new Date(now.getTime() + INTENT_TTL_MS),
    });
  } catch (error) {
    // With the planned partial unique index on pending intents (docs/audits/course-payment-index-migration-plan.md),
    // a concurrent checkout loses here and hands out the one that won.
    if (!isDuplicateKey(error)) throw error;
    const existing = (await intents.find({ userId, courseId, kind: 'course', status: 'pending' }).toArray()).sort(intentOrder)[0];
    if (!existing) throw error;
    return checkoutFor(existing, true);
  }

  // Two checkouts started at the same moment can both get here. The later one (by creation time,
  // then reference) closes itself before its reference reaches the browser and returns the
  // earlier one. This narrows the race; without a unique index it cannot be ruled out across
  // servers, and a second charge is then caught as a duplicate payment.
  const pending = (await intents.find({ userId, courseId, kind: 'course', status: 'pending' }).toArray()).sort(intentOrder);
  const winner = pending[0];
  if (winner && String(winner.reference) !== reference) {
    const yielded = await intents.updateOne(
      { _id: inserted.insertedId, status: 'pending' },
      { $set: { status: 'superseded', closedAt: now, supersededBy: String(winner.reference) } }
    );
    if (yielded.matchedCount) return checkoutFor(winner, true);
  }
  return { ok: true, alreadyOwned: false, reference, amountKobo: COURSE_PRICE_KOBO, currency: COURSE_CURRENCY, reused: false };
}

/** Events recorded for review only. No access is changed until a refund and dispute policy exists. */
const REVIEW_ONLY_EVENTS = new Set([
  'refund.pending',
  'refund.processing',
  'refund.processed',
  'refund.failed',
  'charge.dispute.create',
  'charge.dispute.remind',
  'charge.dispute.resolve',
]);

/**
 * Fields of a signed event that disagree with the payment already verified for its reference.
 * Metadata is not compared here; it is checked once, when the payment is verified.
 */
function lateEventConflicts(payment, data) {
  const conflicts = [];
  if (Number(data.amount) !== Number(payment.amountKobo)) conflicts.push('amount');
  if (String(data.currency || '').toUpperCase() !== String(payment.currency || '').toUpperCase()) conflicts.push('currency');
  if (String(data.status || '').toLowerCase() !== 'success') conflicts.push('status');
  return conflicts;
}

const shortText = (value, max) => (typeof value === 'string' || typeof value === 'number' ? String(value).slice(0, max) : null);

/**
 * Records a signed event that contradicts an already verified payment. The payment, access and
 * purchase rows are left exactly as verified. The event key includes the conflicting values, so a
 * redelivery of the same event is a replay while a different conflict counts as a new occurrence.
 */
async function recordLateConflict(db, reference, data, now) {
  const payment = await db.collection(COLLECTIONS.payments).findOne({ reference, status: 'success' });
  if (!payment) return false;
  const conflicts = lateEventConflicts(payment, data);
  if (!conflicts.length) return false;
  const amount = Number(data.amount);
  const currency = shortText(data.currency, 10);
  const status = shortText(data.status, 40);
  await recordPaymentException(db, {
    reference,
    reason: 'late_conflicting_event',
    source: 'webhook',
    userId: payment.userId,
    courseId: payment.courseId,
    amountKobo: Number.isFinite(amount) ? amount : null,
    currency,
    providerStatus: status,
    evidence: {
      conflicts,
      recordedAmountKobo: Number(payment.amountKobo),
      recordedCurrency: String(payment.currency || ''),
      recordedStatus: 'success',
    },
    eventKey: `late:${data.id != null ? shortText(data.id, 40) : reference}:${shortText(data.amount, 20)}:${currency}:${status}`,
  }, now);
  return true;
}

/**
 * Handles a webhook whose signature has already been verified.
 * Returns `ack: true` when the event is fully processed or durably recorded.
 */
async function processWebhookEvent(db, payload, now) {
  const at = now || new Date();
  const event = payload && typeof payload.event === 'string' ? payload.event : '';
  const data = payload && payload.data && typeof payload.data === 'object' ? payload.data : null;

  if (REVIEW_ONLY_EVENTS.has(event)) {
    const reference = data && (data.transaction_reference || (data.transaction && data.transaction.reference) || data.reference);
    await recordPaymentException(db, {
      reference: reference || `event:${event}:${data && data.id ? data.id : at.getTime()}`,
      reason: event.startsWith('refund') ? 'refund_unhandled' : 'dispute_unhandled',
      source: 'webhook',
      amountKobo: data && data.amount,
      currency: data && data.currency,
      providerStatus: event,
      eventKey: data && data.id != null ? `event:${event}:${data.id}` : null,
    }, at);
    return { ack: true, code: 'recorded_for_review' };
  }

  if (event !== 'charge.success' || !data) {
    return { ack: true, code: 'ignored' };
  }

  const result = await confirmCoursePayment(db, { reference: data.reference, source: 'webhook', providerData: data, now: at });
  if (result.ok) {
    if (result.alreadyProcessed && (await recordLateConflict(db, result.reference, data, at))) {
      return { ack: true, code: 'late_conflicting_event' };
    }
    if (result.duplicatePayment) return { ack: true, code: 'duplicate_payment' };
    return { ack: true, code: result.alreadyProcessed ? 'already_processed' : 'granted' };
  }
  if (result.recorded) return { ack: true, code: result.code };
  if (result.retryable) return { ack: false, code: result.code };
  if (result.code === 'invalid_reference' || result.code === 'unknown_reference') {
    await recordPaymentException(db, {
      reference: data.reference ? String(data.reference).slice(0, 100) : `event:charge.success:${at.getTime()}`,
      reason: 'unreconciled_charge',
      source: 'webhook',
      amountKobo: data.amount,
      currency: data.currency,
      providerStatus: data.status,
      eventKey: transactionEventKey(data, data.reference ? String(data.reference) : 'none'),
    }, at);
    return { ack: true, code: 'unreconciled_charge' };
  }
  return { ack: true, code: result.code };
}

/** Public response body. Internal codes help support; no provider payload is echoed. */
function presentConfirmResult(result, supportId) {
  if (result.ok) {
    return {
      status: 200,
      body: {
        success: true,
        verified: true,
        access: true,
        unlocked: true,
        unlockCourse: true,
        courseId: result.courseId,
        reference: result.reference,
        alreadyProcessed: Boolean(result.alreadyProcessed),
        duplicatePayment: Boolean(result.duplicatePayment),
        message: result.duplicatePayment
          ? 'You already had full access to this course. This additional payment has been recorded for support review.'
          : 'Payment confirmed. The full course is unlocked.',
      },
    };
  }
  return {
    status: result.status,
    body: {
      success: false,
      verified: false,
      code: result.code,
      retryable: Boolean(result.retryable),
      message: result.message,
      supportId,
    },
  };
}

module.exports = {
  AUDIT_COLLECTION,
  CLAIM_TTL_MS,
  COURSE_PRICE_KOBO,
  COURSE_CURRENCY,
  COLLECTIONS,
  SYSTEM_ACTOR,
  GRANTED_ENTITLEMENTS,
  INTENT_TTL_MS,
  SHARED_DB_NAME,
  confirmCoursePayment,
  courseEntitlementQuery,
  createCourseIntent,
  decidePaymentEnvironment,
  evaluateTransaction,
  fetchPaystackTransaction,
  hasCourseEntitlement,
  isLocalMongoUri,
  legacyLessonIdsWithAccess,
  presentConfirmResult,
  processWebhookEvent,
  recordPaymentException,
  resolveDbName,
  verifyWebhookSignature,
  writeExceptionAudit,
};
