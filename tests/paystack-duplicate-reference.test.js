/**
 * Regression: "Duplicate Transaction Reference" when a student retries checkout.
 *
 * Paystack Inline registers a reference as soon as the popup opens with it and refuses to open a
 * second popup with the same reference. If the student closes the popup without paying and clicks
 * Unlock again, a verify lookup on that reference can still answer "not found". createCourseIntent
 * then hands the same, already registered reference back to the browser.
 *
 * Runs the real lib/course-payment.js against an in-memory collection double and a mocked Paystack
 * that models that behaviour. No network, Paystack, or database is used.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const payment = require('../lib/course-payment');

const { COLLECTIONS } = payment;

const STUDENT = 'user_student_a';
const COURSE = 'course_alpha';
const NOW = new Date('2026-10-27T12:00:00Z');
const MINUTES = 60 * 1000;

// ---------------------------------------------------------------------------
// Minimal in-memory stand-in for the driver calls createCourseIntent makes.
// ---------------------------------------------------------------------------

function matches(doc, query) {
  return Object.entries(query).every(([key, cond]) => {
    if (key === '$or') return cond.some((sub) => matches(doc, sub));
    if (cond && typeof cond === 'object' && !(cond instanceof Date) && '$exists' in cond) {
      return cond.$exists ? doc[key] !== undefined : doc[key] === undefined;
    }
    return doc[key] === cond;
  });
}

function memoryDb() {
  const collections = new Map();
  const collection = (name) => {
    if (!collections.has(name)) {
      const docs = [];
      let seq = 0;
      collections.set(name, {
        docs,
        async countDocuments(query, options = {}) {
          // Only course access is counted here; any row for the student counts as owning.
          const count = docs.filter((doc) => doc.userId === query.userId).length;
          return options.limit ? Math.min(count, options.limit) : count;
        },
        find(query) {
          const rows = docs.filter((doc) => matches(doc, query));
          return { toArray: async () => rows.map((row) => ({ ...row })) };
        },
        async findOne(query) {
          return docs.find((doc) => matches(doc, query)) || null;
        },
        async insertOne(doc) {
          const row = { _id: `id_${++seq}`, ...doc };
          docs.push(row);
          return { insertedId: row._id };
        },
        async updateOne(filter, update) {
          const doc = docs.find((row) => matches(row, filter));
          if (!doc) return { matchedCount: 0, modifiedCount: 0 };
          Object.assign(doc, update.$set || {});
          return { matchedCount: 1, modifiedCount: 1 };
        },
      });
    }
    return collections.get(name);
  };
  return { collection, rows: (name) => collection(name).docs };
}

// ---------------------------------------------------------------------------
// Mocked Paystack: the popup registers a reference; verify reports `unpaidLookup` for it.
// ---------------------------------------------------------------------------

function fakePaystack(unpaidLookup) {
  const registered = new Set();
  return {
    /** PaystackPop.setup(...).openIframe() with `ref`. */
    openPopup(reference) {
      if (registered.has(reference)) return { opened: false, message: 'Duplicate Transaction Reference' };
      registered.add(reference);
      return { opened: true };
    },
    /** GET /transaction/verify/:reference, already normalized the way lookupPaystackTransaction does. */
    async fetchTransaction(reference) {
      if (!registered.has(reference)) return { outcome: 'not_found' };
      return unpaidLookup(reference);
    },
  };
}

let refCounter = 0;
const makeReference = () => `fo_c_dup_${++refCounter}_abcdef`;

function startCheckout(db, paystack, now) {
  return payment.createCourseIntent(db, {
    userId: STUDENT,
    courseId: COURSE,
    fetchTransaction: paystack.fetchTransaction,
    makeReference,
    now,
  });
}

/** Open the popup, close it unpaid, then click Unlock again `afterMinutes` later. */
async function closeAndRetry(unpaidLookup, afterMinutes) {
  const db = memoryDb();
  const paystack = fakePaystack(unpaidLookup);
  const first = await startCheckout(db, paystack, NOW);
  assert.equal(first.ok, true);
  assert.equal(paystack.openPopup(first.reference).opened, true);
  const retry = await startCheckout(db, paystack, new Date(NOW.getTime() + afterMinutes * MINUTES));
  return { db, first, retry, popup: retry.ok && retry.reference ? paystack.openPopup(retry.reference) : null };
}

const unpaidStatus = (status) => (reference) => ({
  outcome: 'found',
  data: { status, reference, amount: 1000000, currency: 'NGN', metadata: { userId: STUDENT, courseId: COURSE } },
});

test('retrying within 30 minutes after closing the popup, when verify says not found, opens a payable popup', async () => {
  const { first, retry, popup } = await closeAndRetry(() => ({ outcome: 'not_found' }), 5);
  assert.equal(retry.ok, true);
  assert.notEqual(retry.reference, first.reference, 'a reference already registered by the popup must not be handed out again');
  assert.deepEqual(popup, { opened: true });
});

test('control: when verify reports the closed popup as abandoned, the retry gets a fresh reference', async () => {
  const { db, first, retry, popup } = await closeAndRetry(unpaidStatus('abandoned'), 5);
  assert.notEqual(retry.reference, first.reference);
  assert.deepEqual(popup, { opened: true });
  const closed = db.rows(COLLECTIONS.intents).find((row) => row.reference === first.reference);
  assert.equal(closed.status, 'superseded');
});

test('control: after the 30-minute checkout window the retry gets a fresh reference', async () => {
  const { first, retry, popup } = await closeAndRetry(() => ({ outcome: 'not_found' }), 31);
  assert.notEqual(retry.reference, first.reference);
  assert.deepEqual(popup, { opened: true });
});

test('a payment Paystack still reports as processing blocks a second payable checkout', async () => {
  for (const status of ['ongoing', 'pending', 'processing', 'queued']) {
    const { db, first, retry, popup } = await closeAndRetry(unpaidStatus(status), 5);
    assert.equal(retry.ok, false, status);
    assert.equal(retry.code, 'previous_payment_pending', status);
    assert.equal(retry.retryable, true, status);
    assert.equal(popup, null, status);
    const intents = db.rows(COLLECTIONS.intents);
    assert.equal(intents.length, 1, status);
    assert.equal(intents[0].reference, first.reference);
    assert.equal(intents[0].status, 'pending', 'the processing checkout stays payable');
  }
});
