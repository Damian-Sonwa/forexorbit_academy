/**
 * One-time full-course purchase.
 *
 * Behavioral tests run the real lib/course-payment.js flow against an in-memory stand-in for the
 * MongoDB driver and a mocked Paystack provider. No network, Paystack, or database is used.
 * Tests marked "source contract" read files instead of executing them.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const payment = require('../lib/course-payment');
const { COURSE_PRICE_KOBO, COURSE_CURRENCY, COURSE_PRICE_LABEL, formatNairaFromKobo } = require('../lib/course-price');
const { createRateLimiter } = require('../lib/rate-limit');

const { COLLECTIONS } = payment;
const root = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

// ---------------------------------------------------------------------------
// In-memory stand-in for the subset of the MongoDB driver the payment code uses.
// ---------------------------------------------------------------------------

function isOperatorObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)
    && Object.keys(value).some((key) => key.startsWith('$'));
}

function sameValue(left, right) {
  if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime();
  if (right === null) return left === null || left === undefined;
  if (left && right && typeof left === 'object' && typeof right === 'object' && typeof left.toHexString === 'function') {
    return String(left) === String(right);
  }
  return left === right;
}

function comparable(value) {
  return value instanceof Date ? value.getTime() : value;
}

function matches(doc, query) {
  return Object.entries(query).every(([key, cond]) => {
    if (key === '$or') return cond.some((sub) => matches(doc, sub));
    const value = doc[key];
    if (isOperatorObject(cond)) {
      return Object.entries(cond).every(([op, arg]) => {
        if (op === '$in') return arg.some((candidate) => sameValue(value, candidate));
        if (op === '$ne') return !sameValue(value, arg);
        if (op === '$exists') return arg ? value !== undefined : value === undefined;
        if (op === '$lt') return value !== undefined && value !== null && comparable(value) < comparable(arg);
        throw new Error(`unsupported operator ${op}`);
      });
    }
    return sameValue(value, cond);
  });
}

/** Lets other pending work run, the way a network round trip to MongoDB would. */
const yieldTurn = () => new Promise((resolve) => setImmediate(resolve));

class MemoryCollection {
  constructor(options = {}) {
    this.docs = [];
    this.seq = 0;
    this.racy = Boolean(options.racyUpserts);
  }

  async findOne(query) {
    if (this.racy) await yieldTurn();
    return this.docs.find((doc) => matches(doc, query)) || null;
  }

  find(query) {
    const { racy } = this;
    const rows = this.docs.filter((doc) => matches(doc, query));
    const cursor = {
      project: () => cursor,
      limit: () => cursor,
      sort: () => cursor,
      toArray: async () => {
        if (racy) await yieldTurn();
        return rows.map((row) => ({ ...row }));
      },
    };
    return cursor;
  }

  async countDocuments(query, options = {}) {
    if (this.racy) await yieldTurn();
    const count = this.docs.filter((doc) => matches(doc, query)).length;
    return options.limit ? Math.min(count, options.limit) : count;
  }

  async insertOne(doc) {
    if (this.racy) await yieldTurn();
    const row = { _id: doc._id ?? `id_${++this.seq}`, ...doc };
    this.docs.push(row);
    return { insertedId: row._id };
  }

  /**
   * With `racyUpserts`, an upsert that finds no match yields before inserting, so two concurrent
   * upserts can both insert. That is MongoDB's behavior when no unique index covers the filter.
   */
  async updateOne(filter, update, options = {}) {
    let doc = this.docs.find((row) => matches(row, filter));
    let upserted = false;
    if (!doc) {
      if (!options.upsert) return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
      if (this.racy) await yieldTurn();
      doc = { _id: `id_${++this.seq}` };
      for (const [key, value] of Object.entries(filter)) {
        if (!key.startsWith('$') && !isOperatorObject(value)) doc[key] = value;
      }
      Object.assign(doc, update.$setOnInsert || {});
      this.docs.push(doc);
      upserted = true;
    }
    Object.assign(doc, update.$set || {});
    for (const [key, value] of Object.entries(update.$inc || {})) doc[key] = (doc[key] || 0) + value;
    for (const [key, value] of Object.entries(update.$push || {})) doc[key] = [...(doc[key] || []), value];
    for (const [key, value] of Object.entries(update.$pull || {})) {
      doc[key] = (doc[key] || []).filter((item) => !sameValue(item, value));
    }
    return { matchedCount: upserted ? 0 : 1, modifiedCount: upserted ? 0 : 1, upsertedCount: upserted ? 1 : 0 };
  }
}

function memoryDb(options = {}) {
  const collections = new Map();
  return {
    collection(name) {
      if (!collections.has(name)) collections.set(name, new MemoryCollection(options));
      return collections.get(name);
    },
    rows(name) {
      return this.collection(name).docs;
    },
  };
}

const STUDENT = 'user_student_a';
const OTHER_STUDENT = 'user_student_b';
const COURSE = 'course_alpha';
const OTHER_COURSE = 'course_beta';
const NOW = new Date('2026-10-27T12:00:00Z');

function successData(intent, overrides = {}) {
  return {
    status: 'success',
    reference: intent.reference,
    amount: intent.amountKobo,
    currency: 'NGN',
    paid_at: NOW.toISOString(),
    metadata: { userId: intent.userId, courseId: intent.courseId },
    customer: { email: 'student@example.test' },
    ...overrides,
  };
}

function provider(map) {
  const calls = [];
  const fetchTransaction = async (reference) => {
    calls.push(reference);
    const entry = map[reference];
    if (typeof entry === 'function') return entry();
    return entry || { outcome: 'not_found' };
  };
  fetchTransaction.calls = calls;
  return fetchTransaction;
}

let refCounter = 0;
const makeReference = () => `fo_c_test_${++refCounter}_abcdef`;

async function startCheckout(db, userId = STUDENT, courseId = COURSE) {
  const result = await payment.createCourseIntent(db, {
    userId,
    courseId,
    fetchTransaction: provider({}),
    makeReference,
    now: NOW,
  });
  assert.equal(result.ok, true);
  return db.collection(COLLECTIONS.intents).findOne({ reference: result.reference });
}

async function confirm(db, intent, data, extra = {}) {
  return payment.confirmCoursePayment(db, {
    reference: intent.reference,
    source: 'checkout',
    sessionUserId: intent.userId,
    expectedCourseId: intent.courseId,
    fetchTransaction: provider({ [intent.reference]: data === undefined ? undefined : { outcome: 'found', data } }),
    now: NOW,
    ...extra,
  });
}

// ---------------------------------------------------------------------------
// Price
// ---------------------------------------------------------------------------

test('the full-course price is ₦10,000 NGN in kobo', () => {
  assert.equal(COURSE_PRICE_KOBO, 1000000);
  assert.equal(COURSE_CURRENCY, 'NGN');
  assert.equal(COURSE_PRICE_LABEL, '₦10,000');
  assert.equal(formatNairaFromKobo(COURSE_PRICE_KOBO), '₦10,000');
});

test('checkout creates a server intent bound to the student and course at ₦10,000 NGN', async () => {
  const db = memoryDb();
  const result = await payment.createCourseIntent(db, {
    userId: STUDENT,
    courseId: COURSE,
    fetchTransaction: provider({}),
    makeReference,
    now: NOW,
  });
  assert.equal(result.ok, true);
  assert.equal(result.alreadyOwned, false);
  assert.equal(result.amountKobo, 1000000);
  assert.equal(result.currency, 'NGN');
  const intent = await db.collection(COLLECTIONS.intents).findOne({ reference: result.reference });
  assert.equal(intent.userId, STUDENT);
  assert.equal(intent.courseId, COURSE);
  assert.equal(intent.kind, 'course');
  assert.equal(intent.amountKobo, 1000000);
  assert.equal(intent.currency, 'NGN');
  assert.equal(intent.status, 'pending');
  assert.equal('email' in intent, false);
});

// ---------------------------------------------------------------------------
// Successful purchase and idempotency
// ---------------------------------------------------------------------------

test('a verified ₦10,000 payment grants the full-course entitlement once', async () => {
  const db = memoryDb();
  const intent = await startCheckout(db);
  const result = await confirm(db, intent, successData(intent));
  assert.equal(result.ok, true);
  assert.equal(result.alreadyProcessed, false);
  assert.equal(await payment.hasCourseEntitlement(db, STUDENT, COURSE), true);

  const access = db.rows(COLLECTIONS.courseAccess);
  assert.equal(access.length, 1);
  assert.equal(access[0].paid, true);
  assert.equal(access[0].entitlementType, 'paid_course');
  assert.equal(access[0].amountKobo, 1000000);
  assert.equal(access[0].currency, 'NGN');

  const payments = db.rows(COLLECTIONS.payments);
  assert.equal(payments.length, 1);
  assert.equal(payments[0].amountKobo, 1000000);
  assert.equal(payments[0].currency, 'NGN');
  assert.equal('paystackCustomerEmail' in payments[0], false);
  assert.equal(db.rows(COLLECTIONS.coursePurchases).length, 1);
  assert.equal((await db.collection(COLLECTIONS.intents).findOne({ reference: intent.reference })).status, 'paid');
  assert.equal(await payment.hasCourseEntitlement(db, STUDENT, OTHER_COURSE), false);
});

test('repeated callbacks and webhook deliveries do not duplicate payment or access rows', async () => {
  const db = memoryDb();
  const intent = await startCheckout(db);
  const data = successData(intent);
  assert.equal((await confirm(db, intent, data)).ok, true);
  const second = await confirm(db, intent, data);
  assert.equal(second.ok, true);
  assert.equal(second.alreadyProcessed, true);

  for (let i = 0; i < 2; i += 1) {
    const outcome = await payment.processWebhookEvent(db, { event: 'charge.success', data }, NOW);
    assert.equal(outcome.ack, true);
    assert.equal(outcome.code, 'already_processed');
  }
  assert.equal(db.rows(COLLECTIONS.payments).length, 1);
  assert.equal(db.rows(COLLECTIONS.courseAccess).length, 1);
  assert.equal(db.rows(COLLECTIONS.coursePurchases).length, 1);
});

test('a webhook that arrives before the browser callback grants access and the callback stays idempotent', async () => {
  const db = memoryDb();
  const intent = await startCheckout(db);
  const data = successData(intent);
  const outcome = await payment.processWebhookEvent(db, { event: 'charge.success', data }, NOW);
  assert.equal(outcome.code, 'granted');
  const callback = await confirm(db, intent, data);
  assert.equal(callback.ok, true);
  assert.equal(callback.alreadyProcessed, true);
  assert.equal(db.rows(COLLECTIONS.payments).length, 1);
});

test('a paid checkout is still confirmed after its 30-minute intent window', async () => {
  const db = memoryDb();
  const intent = await startCheckout(db);
  const later = new Date(NOW.getTime() + 2 * 60 * 60 * 1000);
  const result = await confirm(db, intent, successData(intent), { now: later });
  assert.equal(result.ok, true);
});

// ---------------------------------------------------------------------------
// Tampering and non-success outcomes
// ---------------------------------------------------------------------------

test('a lower paid amount is rejected, recorded for review, and grants nothing', async () => {
  const db = memoryDb();
  const intent = await startCheckout(db);
  const result = await confirm(db, intent, successData(intent, { amount: 500000 }));
  assert.equal(result.ok, false);
  assert.equal(result.code, 'amount_mismatch');
  assert.equal(await payment.hasCourseEntitlement(db, STUDENT, COURSE), false);
  assert.equal(db.rows(COLLECTIONS.payments).length, 0);
  const exception = db.rows(COLLECTIONS.exceptions)[0];
  assert.equal(exception.reason, 'amount_mismatch');
  assert.equal(exception.amountKobo, 500000);
  assert.equal('email' in exception, false);
});

test('a payment in another currency is rejected even with the right minor-unit amount', async () => {
  const db = memoryDb();
  const intent = await startCheckout(db);
  const result = await confirm(db, intent, successData(intent, { currency: 'USD' }));
  assert.equal(result.code, 'currency_mismatch');
  assert.equal(await payment.hasCourseEntitlement(db, STUDENT, COURSE), false);
});

test('an intent whose stored currency is not NGN cannot be confirmed', async () => {
  const db = memoryDb();
  const intent = await startCheckout(db);
  await db.collection(COLLECTIONS.intents).updateOne({ _id: intent._id }, { $set: { currency: 'GHS' } });
  const tampered = await db.collection(COLLECTIONS.intents).findOne({ _id: intent._id });
  const result = await confirm(db, tampered, successData(intent));
  assert.equal(result.code, 'currency_mismatch');
});

test('failed, abandoned, pending, missing, and uncertain payments grant nothing', async () => {
  const cases = [
    { name: 'failed', lookup: (i) => ({ outcome: 'found', data: successData(i, { status: 'failed' }) }), status: 402, retryable: false },
    { name: 'abandoned', lookup: (i) => ({ outcome: 'found', data: successData(i, { status: 'abandoned' }) }), status: 402, retryable: false },
    { name: 'reversed', lookup: (i) => ({ outcome: 'found', data: successData(i, { status: 'reversed' }) }), status: 402, retryable: false },
    { name: 'ongoing', lookup: (i) => ({ outcome: 'found', data: successData(i, { status: 'ongoing' }) }), status: 409, retryable: true },
    { name: 'not found', lookup: () => ({ outcome: 'not_found' }), status: 409, retryable: true },
    { name: 'timeout', lookup: () => ({ outcome: 'uncertain', reason: 'timeout' }), status: 503, retryable: true },
  ];
  for (const entry of cases) {
    const db = memoryDb();
    const intent = await startCheckout(db);
    const result = await payment.confirmCoursePayment(db, {
      reference: intent.reference,
      source: 'checkout',
      sessionUserId: STUDENT,
      expectedCourseId: COURSE,
      fetchTransaction: provider({ [intent.reference]: entry.lookup(intent) }),
      now: NOW,
    });
    assert.equal(result.ok, false, entry.name);
    assert.equal(result.status, entry.status, entry.name);
    assert.equal(result.retryable, entry.retryable, entry.name);
    assert.equal(await payment.hasCourseEntitlement(db, STUDENT, COURSE), false, entry.name);
    assert.equal(db.rows(COLLECTIONS.payments).length, 0, entry.name);
  }
});

test('an uncertain outcome can be retried and succeeds once the provider answers', async () => {
  const db = memoryDb();
  const intent = await startCheckout(db);
  let attempt = 0;
  const fetchTransaction = async () => {
    attempt += 1;
    return attempt === 1 ? { outcome: 'uncertain', reason: 'timeout' } : { outcome: 'found', data: successData(intent) };
  };
  const base = { reference: intent.reference, source: 'checkout', sessionUserId: STUDENT, expectedCourseId: COURSE, fetchTransaction, now: NOW };
  assert.equal((await payment.confirmCoursePayment(db, base)).code, 'provider_uncertain');
  assert.equal((await payment.confirmCoursePayment(db, base)).ok, true);
  assert.equal(db.rows(COLLECTIONS.payments).length, 1);
});

// ---------------------------------------------------------------------------
// Cross-user and cross-course misuse
// ---------------------------------------------------------------------------

test("another student cannot confirm or claim someone else's reference", async () => {
  const db = memoryDb();
  const intent = await startCheckout(db);
  const result = await confirm(db, intent, successData(intent), { sessionUserId: OTHER_STUDENT });
  assert.equal(result.status, 403);
  assert.equal(result.code, 'reference_owner_mismatch');
  assert.equal(await payment.hasCourseEntitlement(db, OTHER_STUDENT, COURSE), false);
  assert.equal(await payment.hasCourseEntitlement(db, STUDENT, COURSE), false);
});

test('a reference for one course cannot unlock another course', async () => {
  const db = memoryDb();
  const intent = await startCheckout(db);
  const result = await confirm(db, intent, successData(intent), { expectedCourseId: OTHER_COURSE });
  assert.equal(result.code, 'course_mismatch');
  assert.equal(await payment.hasCourseEntitlement(db, STUDENT, OTHER_COURSE), false);
});

test('provider metadata that names another user, course, or a lesson is rejected', async () => {
  for (const metadata of [
    { userId: OTHER_STUDENT, courseId: COURSE },
    { userId: STUDENT, courseId: OTHER_COURSE },
    { userId: STUDENT, courseId: COURSE, lessonId: 'lesson_1' },
  ]) {
    const db = memoryDb();
    const intent = await startCheckout(db);
    const result = await confirm(db, intent, successData(intent, { metadata }));
    assert.equal(result.code, 'metadata_mismatch');
    assert.equal(db.rows(COLLECTIONS.courseAccess).length, 0);
  }
});

test('a reference with no checkout intent is never granted; a real charge goes to review', async () => {
  const db = memoryDb();
  const reference = 'fo_1774766686990_legacy';
  const fetchTransaction = provider({
    [reference]: { outcome: 'found', data: { status: 'success', reference, amount: 500000, currency: 'NGN', metadata: { userId: STUDENT, courseId: COURSE } } },
  });
  const result = await payment.confirmCoursePayment(db, { reference, source: 'checkout', sessionUserId: STUDENT, fetchTransaction, now: NOW });
  assert.equal(result.status, 409);
  assert.equal(result.code, 'needs_review');
  assert.equal(await payment.hasCourseEntitlement(db, STUDENT, COURSE), false);
  assert.equal(db.rows(COLLECTIONS.exceptions)[0].reason, 'no_matching_intent');

  const stranger = await payment.confirmCoursePayment(db, { reference, source: 'checkout', sessionUserId: OTHER_STUDENT, fetchTransaction, now: NOW });
  assert.equal(stranger.code, 'unknown_reference');
});

test('malformed references are rejected before any lookup', async () => {
  const db = memoryDb();
  const fetchTransaction = provider({});
  for (const reference of ['', 'x', '../../etc', 'a'.repeat(200), { $ne: null }]) {
    const result = await payment.confirmCoursePayment(db, { reference, source: 'checkout', sessionUserId: STUDENT, fetchTransaction, now: NOW });
    assert.equal(result.code, 'invalid_reference');
  }
  assert.equal(fetchTransaction.calls.length, 0);
});

// ---------------------------------------------------------------------------
// Double-charge protection when starting a new checkout
// ---------------------------------------------------------------------------

test('starting checkout again grants a paid-but-unconfirmed earlier intent instead of charging twice', async () => {
  const db = memoryDb();
  const first = await startCheckout(db);
  const result = await payment.createCourseIntent(db, {
    userId: STUDENT,
    courseId: COURSE,
    fetchTransaction: provider({ [first.reference]: { outcome: 'found', data: successData(first) } }),
    makeReference,
    now: NOW,
  });
  assert.deepEqual(result, { ok: true, alreadyOwned: true });
  assert.equal(db.rows(COLLECTIONS.intents).length, 1);
  assert.equal(await payment.hasCourseEntitlement(db, STUDENT, COURSE), true);
});

test('starting checkout again waits while an earlier payment outcome is uncertain or processing', async () => {
  for (const lookup of [{ outcome: 'uncertain', reason: 'timeout' }, null]) {
    const db = memoryDb();
    const first = await startCheckout(db);
    const response = lookup || { outcome: 'found', data: successData(first, { status: 'ongoing' }) };
    const result = await payment.createCourseIntent(db, {
      userId: STUDENT,
      courseId: COURSE,
      fetchTransaction: provider({ [first.reference]: response }),
      makeReference,
      now: NOW,
    });
    assert.equal(result.ok, false);
    assert.equal(result.retryable, true);
    assert.equal(db.rows(COLLECTIONS.intents).length, 1);
  }
});

test('an abandoned earlier intent is kept as superseded and a new intent is created', async () => {
  const db = memoryDb();
  const first = await startCheckout(db);
  const result = await payment.createCourseIntent(db, {
    userId: STUDENT,
    courseId: COURSE,
    fetchTransaction: provider({ [first.reference]: { outcome: 'found', data: successData(first, { status: 'abandoned' }) } }),
    makeReference,
    now: NOW,
  });
  assert.equal(result.ok, true);
  assert.notEqual(result.reference, first.reference);
  const intents = db.rows(COLLECTIONS.intents);
  assert.equal(intents.length, 2);
  assert.equal(intents.find((row) => row.reference === first.reference).status, 'superseded');
});

test('a student who already owns the course is told so and no intent is created', async () => {
  const db = memoryDb();
  await db.collection(COLLECTIONS.courseAccess).insertOne({ userId: STUDENT, courseId: COURSE, paid: true });
  const result = await payment.createCourseIntent(db, { userId: STUDENT, courseId: COURSE, fetchTransaction: provider({}), now: NOW });
  assert.deepEqual(result, { ok: true, alreadyOwned: true });
  assert.equal(db.rows(COLLECTIONS.intents).length, 0);
});

// ---------------------------------------------------------------------------
// Entitlement model and legacy records
// ---------------------------------------------------------------------------

test('a legacy lesson purchase unlocks only that lesson, never the whole course', async () => {
  const db = memoryDb();
  await db.collection(COLLECTIONS.lessonAccess).insertOne({ userId: STUDENT, lessonId: 'lesson_3', courseId: COURSE, paid: true, source: 'paystack' });
  await db.collection(COLLECTIONS.lessonPurchases).insertOne({ userId: STUDENT, lessonId: 'lesson_5' });
  assert.equal(await payment.hasCourseEntitlement(db, STUDENT, COURSE), false);
  const held = await payment.legacyLessonIdsWithAccess(db, STUDENT, ['lesson_2', 'lesson_3', 'lesson_4', 'lesson_5']);
  assert.deepEqual([...held].sort(), ['lesson_3', 'lesson_5']);
  assert.equal((await payment.legacyLessonIdsWithAccess(db, OTHER_STUDENT, ['lesson_3', 'lesson_5'])).size, 0);
});

test('access rows without an explicit paid flag grant nothing', async () => {
  const db = memoryDb();
  await db.collection(COLLECTIONS.lessonAccess).insertOne({ userId: STUDENT, lessonId: 'lesson_3', courseId: COURSE });
  await db.collection(COLLECTIONS.courseAccess).insertOne({ userId: STUDENT, courseId: COURSE });
  await db.collection(COLLECTIONS.courseAccess).insertOne({ userId: OTHER_STUDENT, courseId: COURSE, paid: false });
  assert.equal(await payment.hasCourseEntitlement(db, STUDENT, COURSE), false);
  assert.equal(await payment.hasCourseEntitlement(db, OTHER_STUDENT, COURSE), false);
  assert.equal((await payment.legacyLessonIdsWithAccess(db, STUDENT, ['lesson_3'])).size, 0);
});

test('explicit complimentary and manual grants give full-course access', async () => {
  const db = memoryDb();
  await db.collection(COLLECTIONS.courseAccess).insertOne({ userId: STUDENT, courseId: COURSE, entitlementType: 'complimentary' });
  await db.collection(COLLECTIONS.courseAccess).insertOne({ userId: OTHER_STUDENT, courseId: COURSE, entitlementType: 'manual_grant' });
  assert.equal(await payment.hasCourseEntitlement(db, STUDENT, COURSE), true);
  assert.equal(await payment.hasCourseEntitlement(db, OTHER_STUDENT, COURSE), true);
});

test('a retired lesson checkout grants no lesson or course access; a real charge goes to review', async () => {
  const db = memoryDb();
  const reference = 'fo_1774000000000_lesson';
  await db.collection(COLLECTIONS.intents).insertOne({ reference, userId: STUDENT, courseId: COURSE, lessonId: 'lesson_3', kind: 'lesson', amountKobo: 300000, currency: 'NGN' });
  const data = { status: 'success', reference, amount: 300000, currency: 'NGN', metadata: { userId: STUDENT, courseId: COURSE, lessonId: 'lesson_3' } };
  const result = await payment.confirmCoursePayment(db, { reference, source: 'checkout', sessionUserId: STUDENT, fetchTransaction: provider({ [reference]: { outcome: 'found', data } }), now: NOW });
  assert.equal(result.status, 410);
  assert.equal(result.code, 'lesson_purchase_retired');
  assert.equal(db.rows(COLLECTIONS.lessonAccess).length, 0);
  assert.equal(db.rows(COLLECTIONS.courseAccess).length, 0);
  assert.equal(db.rows(COLLECTIONS.exceptions)[0].reason, 'lesson_purchase_retired');

  const webhook = await payment.processWebhookEvent(db, { event: 'charge.success', data }, NOW);
  assert.equal(webhook.ack, true);
  assert.equal(db.rows(COLLECTIONS.courseAccess).length, 0);
});

test('existing historical rows are never deleted by the purchase flow', async () => {
  const db = memoryDb();
  await db.collection(COLLECTIONS.lessonAccess).insertOne({ userId: STUDENT, lessonId: 'lesson_3', courseId: COURSE, paid: true });
  await db.collection(COLLECTIONS.payments).insertOne({ reference: 'fo_old_lesson_ref', userId: STUDENT, kind: 'lesson', status: 'success', amountKobo: 300000 });
  const intent = await startCheckout(db);
  await confirm(db, intent, successData(intent));
  assert.equal(db.rows(COLLECTIONS.lessonAccess).length, 1);
  assert.equal(db.rows(COLLECTIONS.payments).length, 2);
  assert.equal(db.rows(COLLECTIONS.intents).length, 1);
});

// ---------------------------------------------------------------------------
// Webhook
// ---------------------------------------------------------------------------

test('webhook signatures must match the raw body and the server secret', () => {
  const secret = 'sk_test_unit_secret';
  const body = Buffer.from(JSON.stringify({ event: 'charge.success', data: { reference: 'fo_c_1' } }));
  const good = crypto.createHmac('sha512', secret).update(body).digest('hex');
  assert.equal(payment.verifyWebhookSignature(body, secret, good), true);
  assert.equal(payment.verifyWebhookSignature(body, secret, undefined), false);
  assert.equal(payment.verifyWebhookSignature(body, secret, ''), false);
  assert.equal(payment.verifyWebhookSignature(body, undefined, good), false);
  assert.equal(payment.verifyWebhookSignature(body, 'sk_test_other', good), false);
  assert.equal(payment.verifyWebhookSignature(Buffer.from(body.toString().replace('fo_c_1', 'fo_c_2')), secret, good), false);
  assert.equal(payment.verifyWebhookSignature(body, secret, good.slice(0, -1)), false);
});

test('an unreconciled successful charge is recorded and acknowledged, never granted', async () => {
  const db = memoryDb();
  const data = { status: 'success', reference: 'fo_c_unknown_123', amount: 1000000, currency: 'NGN', metadata: { userId: STUDENT, courseId: COURSE } };
  const outcome = await payment.processWebhookEvent(db, { event: 'charge.success', data }, NOW);
  assert.equal(outcome.ack, true);
  assert.equal(outcome.code, 'needs_review');
  assert.equal(db.rows(COLLECTIONS.courseAccess).length, 0);
  assert.equal(db.rows(COLLECTIONS.exceptions)[0].reason, 'no_matching_intent');
});

test('a webhook with a tampered amount is recorded and does not grant', async () => {
  const db = memoryDb();
  const intent = await startCheckout(db);
  const outcome = await payment.processWebhookEvent(db, { event: 'charge.success', data: successData(intent, { amount: 100 }) }, NOW);
  assert.equal(outcome.code, 'amount_mismatch');
  assert.equal(await payment.hasCourseEntitlement(db, STUDENT, COURSE), false);
  assert.equal(db.rows(COLLECTIONS.exceptions).length, 1);
});

test('refund and dispute events are recorded for review and leave access unchanged', async () => {
  const db = memoryDb();
  const intent = await startCheckout(db);
  await confirm(db, intent, successData(intent));
  for (const event of ['refund.processed', 'charge.dispute.create']) {
    const outcome = await payment.processWebhookEvent(db, { event, data: { transaction_reference: intent.reference, amount: 1000000, currency: 'NGN' } }, NOW);
    assert.equal(outcome.code, 'recorded_for_review');
  }
  assert.equal(await payment.hasCourseEntitlement(db, STUDENT, COURSE), true);
  assert.deepEqual(db.rows(COLLECTIONS.exceptions).map((row) => row.reason).sort(), ['dispute_unhandled', 'refund_unhandled']);
});

test('a storage failure during webhook processing is surfaced so the webhook is retried', async () => {
  const db = memoryDb();
  const intent = await startCheckout(db);
  db.collection(COLLECTIONS.courseAccess).updateOne = async () => {
    throw new Error('write failed');
  };
  await assert.rejects(payment.processWebhookEvent(db, { event: 'charge.success', data: successData(intent) }, NOW));
});

test('other webhook events are ignored', async () => {
  const db = memoryDb();
  const outcome = await payment.processWebhookEvent(db, { event: 'transfer.success', data: {} }, NOW);
  assert.deepEqual(outcome, { ack: true, code: 'ignored' });
});

// ---------------------------------------------------------------------------
// Duplicate payments and existing entitlements (D4, D5)
// ---------------------------------------------------------------------------

const MINUTES = 60 * 1000;

async function insertIntent(db, overrides = {}) {
  const intent = {
    reference: makeReference(),
    userId: STUDENT,
    courseId: COURSE,
    kind: 'course',
    amountKobo: COURSE_PRICE_KOBO,
    currency: 'NGN',
    status: 'pending',
    createdAt: NOW,
    expiresAt: new Date(NOW.getTime() + 30 * MINUTES),
    ...overrides,
  };
  await db.collection(COLLECTIONS.intents).insertOne(intent);
  return db.collection(COLLECTIONS.intents).findOne({ reference: intent.reference });
}

function exceptionsFor(db, reason) {
  return db.rows(COLLECTIONS.exceptions).filter((row) => row.reason === reason);
}

test('a payment for a course held through a complimentary or manual grant keeps the grant and is recorded as a duplicate', async () => {
  for (const entitlementType of ['complimentary', 'manual_grant']) {
    const db = memoryDb();
    const intent = await startCheckout(db);
    await db.collection(COLLECTIONS.courseAccess).insertOne({ userId: STUDENT, courseId: COURSE, entitlementType, source: 'admin' });

    const result = await confirm(db, intent, successData(intent, { id: 5001 }));
    assert.equal(result.ok, true, entitlementType);
    assert.equal(result.duplicatePayment, true);
    assert.equal(payment.presentConfirmResult(result, 'sid').body.duplicatePayment, true);
    assert.match(payment.presentConfirmResult(result, 'sid').body.message, /already had full access/);

    const access = db.rows(COLLECTIONS.courseAccess);
    assert.equal(access.length, 1);
    assert.equal(access[0].entitlementType, entitlementType, 'the grant type is not overwritten');
    assert.equal(access[0].paid, undefined);
    assert.equal(access[0].paystackReference, undefined);
    assert.equal(db.rows(COLLECTIONS.coursePurchases).length, 0);

    const [held] = db.rows(COLLECTIONS.payments);
    assert.equal(held.reference, intent.reference);
    assert.equal(held.status, 'success');
    assert.equal(held.amountKobo, COURSE_PRICE_KOBO);
    assert.equal(held.entitlementApplied, false);
    assert.equal(held.heldReason, 'duplicate_payment');
    assert.deepEqual(held.heldEvidence, { existingReference: null, existingEntitlementType: entitlementType });

    const [exception] = exceptionsFor(db, 'duplicate_payment');
    assert.equal(exception.reference, intent.reference);
    assert.equal(exception.userId, STUDENT);
    assert.equal(exception.amountKobo, COURSE_PRICE_KOBO);
    assert.deepEqual(exception.evidence, { existingReference: null, existingEntitlementType: entitlementType });
    assert.equal('email' in exception, false);
    assert.equal((await db.collection(COLLECTIONS.intents).findOne({ _id: intent._id })).status, 'held');
  }
});

test('a genuinely separate second charge for an owned course is kept, recorded once, and changes no access', async () => {
  const db = memoryDb();
  const first = await startCheckout(db);
  assert.equal((await confirm(db, first, successData(first, { id: 7001 }))).ok, true);
  const accessBefore = { ...db.rows(COLLECTIONS.courseAccess)[0] };
  const purchaseBefore = { ...db.rows(COLLECTIONS.coursePurchases)[0] };

  const second = await insertIntent(db);
  const data = successData(second, { id: 7002 });
  const result = await confirm(db, second, data);
  assert.equal(result.ok, true);
  assert.equal(result.duplicatePayment, true);
  assert.equal(result.alreadyProcessed, false);

  assert.deepEqual(db.rows(COLLECTIONS.courseAccess), [accessBefore]);
  assert.deepEqual(db.rows(COLLECTIONS.coursePurchases), [purchaseBefore]);
  const payments = db.rows(COLLECTIONS.payments);
  assert.equal(payments.length, 2);
  assert.equal(payments.find((row) => row.reference === second.reference).entitlementApplied, false);
  const [exception] = exceptionsFor(db, 'duplicate_payment');
  assert.equal(exception.evidence.existingReference, first.reference);
  assert.equal(exception.occurrences, 1);

  const replay = await confirm(db, second, data);
  assert.equal(replay.duplicatePayment, true);
  assert.equal(replay.alreadyProcessed, true);
  for (let i = 0; i < 2; i += 1) {
    assert.deepEqual(await payment.processWebhookEvent(db, { event: 'charge.success', data }, NOW), { ack: true, code: 'duplicate_payment' });
  }
  assert.equal(db.rows(COLLECTIONS.payments).length, 2);
  assert.equal(exceptionsFor(db, 'duplicate_payment').length, 1);
  assert.equal(exceptionsFor(db, 'duplicate_payment')[0].occurrences, 1, 'replays of the same charge are not counted again');
});

test('replaying the reference that granted access is not treated as a duplicate payment', async () => {
  const db = memoryDb();
  const intent = await startCheckout(db);
  const data = successData(intent, { id: 8001 });
  await payment.processWebhookEvent(db, { event: 'charge.success', data }, NOW);
  const callback = await confirm(db, intent, data);
  assert.equal(callback.ok, true);
  assert.equal(callback.duplicatePayment, undefined);
  assert.equal(db.rows(COLLECTIONS.exceptions).length, 0);
});

test('an earlier non-entitled access row is upgraded and its old reference is kept', async () => {
  const db = memoryDb();
  await db.collection(COLLECTIONS.courseAccess).insertOne({ userId: STUDENT, courseId: COURSE, paid: false, paystackReference: 'fo_old_refunded_1', createdAt: NOW });
  await db.collection(COLLECTIONS.coursePurchases).insertOne({ userId: STUDENT, courseId: COURSE, status: 'pending', paymentReference: 'fo_old_refunded_1' });
  const intent = await startCheckout(db);
  assert.equal((await confirm(db, intent, successData(intent))).ok, true);
  const [access] = db.rows(COLLECTIONS.courseAccess);
  assert.equal(access.paid, true);
  assert.equal(access.entitlementType, 'paid_course');
  assert.equal(access.paystackReference, intent.reference);
  assert.deepEqual(access.previousPaystackReferences, ['fo_old_refunded_1']);
  const [purchase] = db.rows(COLLECTIONS.coursePurchases);
  assert.equal(purchase.status, 'paid');
  assert.equal(purchase.paymentReference, intent.reference);
  assert.deepEqual(purchase.previousPaymentReferences, ['fo_old_refunded_1']);
});

// ---------------------------------------------------------------------------
// Closed checkouts and concurrent checkout starts (D3)
// ---------------------------------------------------------------------------

test('starting checkout again reuses an unexpired intent that Paystack has not seen', async () => {
  const db = memoryDb();
  const first = await startCheckout(db);
  const again = await payment.createCourseIntent(db, { userId: STUDENT, courseId: COURSE, fetchTransaction: provider({}), makeReference, now: new Date(NOW.getTime() + 5 * MINUTES) });
  assert.equal(again.reference, first.reference);
  assert.equal(again.reused, true);
  assert.equal(db.rows(COLLECTIONS.intents).length, 1);
});

test('a payment on a superseded checkout is kept for review and does not grant access', async () => {
  for (const closeWith of ['expired_window', 'abandoned']) {
    const db = memoryDb();
    const first = await startCheckout(db);
    const later = new Date(NOW.getTime() + 45 * MINUTES);
    const lookup = closeWith === 'abandoned'
      ? { [first.reference]: { outcome: 'found', data: successData(first, { status: 'abandoned' }) } }
      : {};
    const next = await payment.createCourseIntent(db, { userId: STUDENT, courseId: COURSE, fetchTransaction: provider(lookup), makeReference, now: later });
    assert.notEqual(next.reference, first.reference, closeWith);
    const closed = await db.collection(COLLECTIONS.intents).findOne({ reference: first.reference });
    assert.equal(closed.status, 'superseded');

    const result = await confirm(db, closed, successData(first, { id: 9100 }), { now: later });
    assert.equal(result.ok, false, closeWith);
    assert.equal(result.code, 'needs_review');
    assert.equal(await payment.hasCourseEntitlement(db, STUDENT, COURSE), false);
    const held = db.rows(COLLECTIONS.payments).find((row) => row.reference === first.reference);
    assert.equal(held.entitlementApplied, false);
    assert.equal(held.heldReason, 'superseded_intent_paid');
    assert.equal(exceptionsFor(db, 'superseded_intent_paid').length, 1);

    const webhook = await payment.processWebhookEvent(db, { event: 'charge.success', data: successData(first, { id: 9100 }) }, later);
    assert.deepEqual(webhook, { ack: true, code: 'needs_review' });
    assert.equal(exceptionsFor(db, 'superseded_intent_paid')[0].occurrences, 1);

    const current = await db.collection(COLLECTIONS.intents).findOne({ reference: next.reference });
    assert.equal((await confirm(db, current, successData(current), { now: later })).ok, true, 'the current checkout still works');
  }
});

test('two checkouts started at the same moment hand out one payable reference', async () => {
  const db = memoryDb({ racyUpserts: true });
  const start = () => payment.createCourseIntent(db, { userId: STUDENT, courseId: COURSE, fetchTransaction: provider({}), makeReference, now: NOW });
  const [a, b] = await Promise.all([start(), start()]);
  assert.equal(a.ok && b.ok, true);
  assert.equal(a.reference, b.reference);
  const pending = db.rows(COLLECTIONS.intents).filter((row) => row.status === 'pending');
  assert.equal(pending.length, 1);
  assert.equal(pending[0].reference, a.reference);
});

test('with a unique pending-intent index, the checkout that loses the insert returns the winner', async () => {
  const db = memoryDb();
  const col = db.collection(COLLECTIONS.intents);
  const realInsert = col.insertOne.bind(col);
  col.insertOne = async (doc) => {
    const clash = db.rows(COLLECTIONS.intents).some((row) => row.status === 'pending' && row.userId === doc.userId && row.courseId === doc.courseId && row.kind === doc.kind);
    if (clash) throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
    return realInsert(doc);
  };
  const first = await payment.createCourseIntent(db, { userId: STUDENT, courseId: COURSE, fetchTransaction: provider({}), makeReference, now: NOW });
  const ref = first.reference;
  const realFind = col.find.bind(col);
  let hidden = true;
  col.find = (query) => {
    if (hidden) {
      hidden = false;
      return { toArray: async () => [] };
    }
    return realFind(query);
  };
  const second = await payment.createCourseIntent(db, { userId: STUDENT, courseId: COURSE, fetchTransaction: provider({}), makeReference, now: NOW });
  assert.equal(second.ok, true);
  assert.equal(second.reference, ref);
  assert.equal(second.reused, true);
  assert.equal(db.rows(COLLECTIONS.intents).length, 1);

  col.insertOne = async () => { throw new Error('storage down'); };
  col.find = () => ({ toArray: async () => [] });
  await assert.rejects(payment.createCourseIntent(db, { userId: STUDENT, courseId: COURSE, fetchTransaction: provider({}), makeReference, now: NOW }), /storage down/);
});

// ---------------------------------------------------------------------------
// Concurrent confirmation and partial writes (D2)
// ---------------------------------------------------------------------------

test('the racy test store does produce duplicates for unguarded concurrent upserts', async () => {
  const db = memoryDb({ racyUpserts: true });
  const upsert = () => db.collection('probe').updateOne({ key: 'k' }, { $setOnInsert: { key: 'k' } }, { upsert: true });
  await Promise.all([upsert(), upsert()]);
  assert.equal(db.rows('probe').length, 2);
});

test('a browser confirmation and a webhook racing on one reference write one set of records', async () => {
  const db = memoryDb({ racyUpserts: true });
  const intent = await startCheckout(db);
  const data = successData(intent, { id: 9300 });
  const [callback, webhook] = await Promise.all([
    confirm(db, intent, data),
    payment.processWebhookEvent(db, { event: 'charge.success', data }, NOW),
  ]);
  const okCount = [callback.ok, webhook.ack && webhook.code !== 'payment_processing'].filter(Boolean).length;
  assert.ok(okCount >= 1);
  if (!callback.ok) assert.equal(callback.code, 'payment_processing');
  if (webhook.code === 'payment_processing') assert.equal(webhook.ack, false, 'Paystack retries a webhook that lost the race');

  const retry = await confirm(db, intent, data);
  assert.equal(retry.ok, true);
  assert.equal(db.rows(COLLECTIONS.payments).length, 1);
  assert.equal(db.rows(COLLECTIONS.courseAccess).length, 1);
  assert.equal(db.rows(COLLECTIONS.coursePurchases).length, 1);
  assert.equal(db.rows(COLLECTIONS.exceptions).length, 0);
});

test('a confirmation that fails part-way is released and the retry completes without duplicates', async () => {
  const db = memoryDb();
  const intent = await startCheckout(db);
  const purchases = db.collection(COLLECTIONS.coursePurchases);
  const realUpdate = purchases.updateOne.bind(purchases);
  purchases.updateOne = async () => {
    purchases.updateOne = realUpdate;
    throw new Error('write failed');
  };
  await assert.rejects(confirm(db, intent, successData(intent)));
  assert.equal((await db.collection(COLLECTIONS.intents).findOne({ _id: intent._id })).status, 'pending');
  assert.equal(db.rows(COLLECTIONS.payments).length, 1);
  assert.equal(db.rows(COLLECTIONS.courseAccess).length, 1);

  const retry = await confirm(db, intent, undefined);
  assert.equal(retry.ok, true, 'the stored payment row lets the retry finish without asking the provider');
  assert.equal(retry.alreadyProcessed, true);
  assert.equal(db.rows(COLLECTIONS.payments).length, 1);
  assert.equal(db.rows(COLLECTIONS.courseAccess).length, 1);
  assert.equal(db.rows(COLLECTIONS.coursePurchases).length, 1);
  assert.equal((await db.collection(COLLECTIONS.intents).findOne({ _id: intent._id })).status, 'paid');
});

test('a confirmation in progress makes others wait; an abandoned claim is taken over', async () => {
  const db = memoryDb();
  const intent = await startCheckout(db);
  await db.collection(COLLECTIONS.intents).updateOne({ _id: intent._id }, { $set: { status: 'processing', claimedAt: new Date(NOW.getTime() - 30 * 1000), claimedFrom: 'pending' } });
  const busy = await confirm(db, intent, successData(intent));
  assert.equal(busy.code, 'payment_processing');
  assert.equal(busy.retryable, true);
  const webhook = await payment.processWebhookEvent(db, { event: 'charge.success', data: successData(intent) }, NOW);
  assert.deepEqual(webhook, { ack: false, code: 'payment_processing' });

  const later = new Date(NOW.getTime() + payment.CLAIM_TTL_MS + 1000);
  const takeover = await confirm(db, intent, successData(intent), { now: later });
  assert.equal(takeover.ok, true);
  assert.equal(db.rows(COLLECTIONS.payments).length, 1);
});

test('a failed provider lookup returns the checkout to its earlier state', async () => {
  const db = memoryDb();
  const intent = await startCheckout(db);
  await confirm(db, intent, undefined);
  const after = await db.collection(COLLECTIONS.intents).findOne({ _id: intent._id });
  assert.equal(after.status, 'pending');
  assert.equal(after.claimedAt, null);
});

// ---------------------------------------------------------------------------
// Recurring exceptions (D7)
// ---------------------------------------------------------------------------

async function closeException(db, row, status) {
  await db.collection(COLLECTIONS.exceptions).updateOne(
    { _id: row._id },
    {
      $set: {
        review: { status, outcome: 'owner_confirmed', notes: 'Checked with finance.', updatedAt: NOW, updatedBy: { userId: 'admin_1', email: null } },
        resolved: true,
        reviewVersion: 1,
      },
      $push: { reviewHistory: { at: NOW, actor: { userId: 'admin_1', email: null }, reason: 'Reviewed', before: { status: 'open' }, after: { status } } },
    }
  );
}

test('a resolved or dismissed exception reopens when it recurs, keeping its review history', async () => {
  for (const status of ['resolved', 'dismissed']) {
    const db = memoryDb();
    const intent = await startCheckout(db);
    await confirm(db, intent, successData(intent, { amount: 500000, id: 4100 }));
    const [first] = db.rows(COLLECTIONS.exceptions);
    await closeException(db, first, status);

    await confirm(db, intent, successData(intent, { amount: 500000, id: 4100 }));
    let row = db.rows(COLLECTIONS.exceptions)[0];
    assert.equal(row.occurrences, 1, 'the same provider transaction is a replay');
    assert.equal(row.review.status, status);

    const later = new Date(NOW.getTime() + 60 * MINUTES);
    const recorded = await payment.recordPaymentException(db, {
      reference: intent.reference, reason: 'amount_mismatch', source: 'checkout', amountKobo: 500000, currency: 'NGN', eventKey: 'txn:4101',
    }, later);
    assert.deepEqual(recorded, { recorded: 'reopened' });
    row = db.rows(COLLECTIONS.exceptions)[0];
    assert.equal(db.rows(COLLECTIONS.exceptions).length, 1);
    assert.equal(row.occurrences, 2);
    assert.equal(row.resolved, false);
    assert.equal(row.review.status, 'open');
    assert.equal(row.review.outcome, 'owner_confirmed', 'the earlier outcome is kept');
    assert.equal(row.review.notes, 'Checked with finance.');
    assert.equal(row.reviewVersion, 2);
    assert.equal(row.reopenCount, 1);
    assert.equal(row.reviewHistory.length, 2);
    assert.equal(row.reviewHistory[1].action, 'exception_reopened');
    assert.equal(row.reviewHistory[1].before.status, status);
    assert.equal(row.reviewHistory[1].actor.userId, 'system');
    assert.deepEqual(row.pendingAuditIds, []);
    const [audit] = db.rows(payment.AUDIT_COLLECTION);
    assert.equal(audit.action, 'exception_reopened');
    assert.equal(String(audit._id), String(row.reviewHistory[1].auditId));
    assert.equal(audit.before.status, status);
    assert.equal(audit.after.status, 'open');
  }
});

test('an open exception only counts a new occurrence; a replayed refund event is ignored', async () => {
  const db = memoryDb();
  const intent = await startCheckout(db);
  await confirm(db, intent, successData(intent));
  const refund = (id) => payment.processWebhookEvent(db, { event: 'refund.processed', data: { id, transaction_reference: intent.reference, amount: 1000000, currency: 'NGN' } }, NOW);
  await refund(61);
  await refund(61);
  assert.equal(exceptionsFor(db, 'refund_unhandled')[0].occurrences, 1);
  await refund(62);
  const [row] = exceptionsFor(db, 'refund_unhandled');
  assert.equal(row.occurrences, 2);
  assert.equal(row.review, undefined);
  assert.equal(db.rows(payment.AUDIT_COLLECTION).length, 0);
});

test('if the reopening audit entry cannot be written, its id stays pending for repair', async () => {
  const db = memoryDb();
  const intent = await startCheckout(db);
  await confirm(db, intent, successData(intent, { amount: 500000, id: 4200 }));
  await closeException(db, db.rows(COLLECTIONS.exceptions)[0], 'resolved');
  db.collection(payment.AUDIT_COLLECTION).insertOne = async () => {
    throw new Error('audit write failed');
  };
  await payment.recordPaymentException(db, { reference: intent.reference, reason: 'amount_mismatch', source: 'checkout', eventKey: 'txn:4201' }, NOW);
  const row = db.rows(COLLECTIONS.exceptions)[0];
  assert.equal(row.review.status, 'open');
  assert.equal(row.pendingAuditIds.length, 1);
  assert.equal(String(row.pendingAuditIds[0]), String(row.reviewHistory[1].auditId));
});

// ---------------------------------------------------------------------------
// Provider reliability
// ---------------------------------------------------------------------------

function fakeResponse(status, body) {
  return { status, ok: status >= 200 && status < 300, json: async () => (body instanceof Error ? Promise.reject(body) : body) };
}

test('provider lookup normalizes success, not-found, errors, bad bodies, and timeouts', async () => {
  const secret = 'sk_test_unit';
  const call = (impl, extra = {}) => payment.fetchPaystackTransaction('fo_c_ref_1', { secret, fetchImpl: impl, ...extra });

  const found = await call(async () => fakeResponse(200, { status: true, data: { status: 'success', amount: 1000000 } }));
  assert.equal(found.outcome, 'found');
  assert.equal((await call(async () => fakeResponse(400, { status: false, message: 'Transaction reference not found' }))).outcome, 'not_found');
  assert.equal((await call(async () => fakeResponse(500, {}))).outcome, 'uncertain');
  assert.equal((await call(async () => fakeResponse(429, {}))).outcome, 'uncertain');
  assert.equal((await call(async () => fakeResponse(401, {}))).outcome, 'uncertain');
  assert.equal((await call(async () => fakeResponse(200, new Error('not json')))).outcome, 'uncertain');
  assert.equal((await call(async () => { throw new Error('ECONNRESET'); })).reason, 'network');

  const hanging = (url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  const timedOut = await call(hanging, { timeoutMs: 20 });
  assert.deepEqual(timedOut, { outcome: 'uncertain', reason: 'timeout' });

  assert.equal((await payment.fetchPaystackTransaction('fo_c_ref_1', { secret: '', fetchImpl: async () => fakeResponse(200, {}) })).outcome, 'uncertain');
});

test('public confirm responses expose codes and a support ID, never provider payloads', () => {
  const ok = payment.presentConfirmResult({ ok: true, status: 200, courseId: COURSE, reference: 'fo_c_1', alreadyProcessed: false }, 'sid');
  assert.equal(ok.status, 200);
  assert.equal(ok.body.unlocked, true);
  const denied = payment.presentConfirmResult({ ok: false, status: 400, code: 'amount_mismatch', message: 'm', retryable: false }, 'sid-2');
  assert.deepEqual(Object.keys(denied.body).sort(), ['code', 'message', 'retryable', 'success', 'supportId', 'verified']);
});

// ---------------------------------------------------------------------------
// Environment isolation
// ---------------------------------------------------------------------------

test('payments run only in production or in an isolated test environment', () => {
  const srv = 'mongodb+srv:' + '//';
  const shared = `${srv}cluster.example.net/Forex_elearning`;
  const decide = payment.decidePaymentEnvironment;
  assert.equal(decide({}).reason, 'not_configured');
  assert.equal(decide({ NODE_ENV: 'production', PAYSTACK_SECRET_KEY: 'sk_live_x' }).enabled, true);
  assert.equal(decide({ NODE_ENV: 'development', PAYSTACK_SECRET_KEY: 'sk_live_x', MONGO_URI: shared, MONGODB_DB_NAME: 'forexorbit_local' }).reason, 'live_key_outside_production');
  assert.equal(decide({ NODE_ENV: 'development', PAYSTACK_SECRET_KEY: 'sk_test_x', MONGO_URI: shared }).reason, 'shared_database');
  assert.equal(decide({ NODE_ENV: 'development', PAYSTACK_SECRET_KEY: 'sk_test_x', MONGO_URI: shared, MONGODB_DB_NAME: 'Forex_elearning' }).reason, 'shared_database');
  assert.equal(decide({ NODE_ENV: 'development', PAYSTACK_SECRET_KEY: 'sk_test_x', MONGO_URI: shared, MONGODB_DB_NAME: 'forexorbit_local' }).enabled, true);
  assert.equal(decide({ NODE_ENV: 'test', PAYSTACK_SECRET_KEY: 'sk_test_x', MONGO_URI: 'mongodb://localhost:27017/Forex_elearning' }).enabled, true);
  assert.equal(decide({ PAYSTACK_SECRET_KEY: 'sk_test_x', MONGO_URI: 'mongodb://127.0.0.1/app' }).enabled, true);
  assert.equal(payment.isLocalMongoUri('mongodb://localhost.attacker.example/db'), false);
  assert.equal(payment.isLocalMongoUri(`${srv}localhost/db`), false);
});

test('production refuses a test or unrecognized Paystack key; development keeps test keys working', () => {
  const srv = 'mongodb+srv:' + '//';
  const shared = `${srv}cluster.example.net/Forex_elearning`;
  const decide = payment.decidePaymentEnvironment;

  assert.deepEqual(decide({ NODE_ENV: 'production', PAYSTACK_SECRET_KEY: 'sk_live_x', MONGO_URI: shared }), { enabled: true, mode: 'live' });
  assert.deepEqual(decide({ NODE_ENV: 'production', PAYSTACK_SECRET_KEY: '  sk_live_x  ' }), { enabled: true, mode: 'live' });

  for (const env of [
    { NODE_ENV: 'production', PAYSTACK_SECRET_KEY: 'sk_test_x', MONGO_URI: shared },
    { NODE_ENV: 'production', PAYSTACK_SECRET_KEY: 'sk_test_x', MONGO_URI: 'mongodb://localhost:27017/app', MONGODB_DB_NAME: 'Forex_elearning_dev' },
    { NODE_ENV: 'production', PAYSTACK_SECRET_KEY: ' sk_test_x ' },
  ]) {
    const decision = decide(env);
    assert.equal(decision.enabled, false);
    assert.equal(decision.status, 503);
    assert.equal(decision.reason, 'test_key_in_production');
    assert.equal(decision.message, 'Payments are disabled: production requires a live Paystack secret key');
    assert.equal(decision.message.includes('sk_test_x'), false, 'the key is never echoed');
  }
  const odd = decide({ NODE_ENV: 'production', PAYSTACK_SECRET_KEY: 'pk_live_x' });
  assert.equal(odd.enabled, false);
  assert.equal(odd.reason, 'unrecognized_key');
  assert.equal(decide({ NODE_ENV: 'production', PAYSTACK_SECRET_KEY: '' }).reason, 'not_configured');

  assert.deepEqual(decide({ PAYSTACK_SECRET_KEY: 'sk_test_x', MONGO_URI: shared, MONGODB_DB_NAME: 'Forex_elearning_dev' }), { enabled: true, mode: 'test' });
  assert.deepEqual(decide({ NODE_ENV: 'development', PAYSTACK_SECRET_KEY: 'sk_test_x', MONGO_URI: shared, MONGODB_DB_NAME: 'Forex_elearning_dev' }), { enabled: true, mode: 'test' });
  assert.deepEqual(decide({ NODE_ENV: 'test', PAYSTACK_SECRET_KEY: 'sk_test_x', MONGO_URI: 'mongodb://127.0.0.1/app' }), { enabled: true, mode: 'test' });
});

test('every payment route takes its on/off decision from decidePaymentEnvironment', () => {
  for (const file of ['lib/payment-route.ts', 'pages/api/paystack/webhook.ts', 'pages/api/admin/purchases/[id]/verify.ts']) {
    assert.match(read(file), /decidePaymentEnvironment\(process\.env\)/, file);
  }
  for (const file of ['pages/api/payments/paystack/init-course.ts', 'pages/api/courses/[id]/pay.ts']) {
    const source = read(file);
    assert.ok(source.includes('paymentsAllowed') || source.includes('respondWithCourseConfirmation'), file);
  }
});

test('rate limiter blocks after the limit and resets after the window', () => {
  const limiter = createRateLimiter({ windowMs: 1000, max: 2 });
  assert.equal(limiter.check('init:a', 0).allowed, true);
  assert.equal(limiter.check('init:a', 10).allowed, true);
  const blocked = limiter.check('init:a', 20);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSec, 1);
  assert.equal(limiter.check('init:b', 20).allowed, true);
  assert.equal(limiter.check('init:a', 1001).allowed, true);
});

// ---------------------------------------------------------------------------
// Source contracts (read files; they do not execute routes or pages)
// ---------------------------------------------------------------------------

test('source contract: the retired lesson checkout route returns 410 and writes nothing', () => {
  const source = read('pages/api/payments/paystack/init-lesson.ts');
  assert.equal(source.includes('status(410)'), true);
  assert.equal(/insertOne|updateOne|getDb/.test(source), false);
});

test('source contract: the webhook has no environment-based signature bypass', () => {
  const source = read('pages/api/paystack/webhook.ts');
  assert.equal(source.includes("NODE_ENV"), false);
  assert.equal(source.includes('verifyWebhookSignature'), true);
  assert.equal(source.includes('bodyParser: false'), true);
  assert.equal(source.includes('customer'), false);
  assert.match(source, /if \(!outcome\.ack\) \{\s*return res\.status\(500\)\.json\(\{ message: 'Processing incomplete', supportId \}\);/, 'unfinished processing is not acknowledged, so Paystack retries');
});

test('source contract: the course price is not read from environment variables', () => {
  const monetization = read('lib/lesson-monetization.ts');
  assert.equal(/PAYSTACK_(COURSE|LESSON)_PRICE_KOBO|PAYSTACK_CURRENCY/.test(monetization), false);
  assert.equal(monetization.includes('COURSE_PRICE_KOBO'), true);
  assert.equal(monetization.includes('$exists: false'), false);
});

test('source contract: checkout pages use the server intent and the shared price label', () => {
  const coursePage = read('pages/courses/[id].tsx');
  const lessonPage = read('pages/courses/[id]/lessons/[lessonId].tsx');
  const checkout = read('components/monetization/PaystackCourseUnlock.tsx');
  for (const source of [coursePage, lessonPage, checkout]) {
    assert.equal(source.includes('₦5,000'), false);
    assert.equal(source.includes('NEXT_PUBLIC_PAYSTACK_COURSE_PRICE_KOBO'), false);
    assert.equal(/sessionStorage|CoursePaidClient/.test(source), false);
  }
  assert.equal(coursePage.includes('PaystackCourseUnlock'), true);
  assert.equal(coursePage.includes('fo_${Date.now()}'), false);
  assert.equal(checkout.includes('/payments/paystack/init-course'), true);
  assert.equal(checkout.includes('init-lesson'), false);
  assert.equal(checkout.includes('ref: reference'), true);
  assert.equal(checkout.includes('amount: init.amountKobo'), true);
});
