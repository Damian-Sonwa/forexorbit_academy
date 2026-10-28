/**
 * Post-payment unlock. The browser helper (lib/course-checkout.js) is driven against the real
 * confirmCoursePayment + presentConfirmResult (what POST /api/courses/:id/pay runs), using an
 * in-memory MongoDB stand-in and a mocked Paystack lookup. No network, Paystack, or database.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const payment = require('../lib/course-payment');
const checkout = require('../lib/course-checkout');

const { COLLECTIONS } = payment;
const read = (relative) => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');

function isOperatorObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)
    && Object.keys(value).some((key) => key.startsWith('$'));
}

function sameValue(left, right) {
  if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime();
  if (right === null) return left === null || left === undefined;
  return left === right;
}

const comparable = (value) => (value instanceof Date ? value.getTime() : value);

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

const yieldTurn = () => new Promise((resolve) => setImmediate(resolve));

class MemoryCollection {
  constructor() {
    this.docs = [];
    this.seq = 0;
  }
  async findOne(query) {
    await yieldTurn();
    return this.docs.find((doc) => matches(doc, query)) || null;
  }
  find(query) {
    const rows = this.docs.filter((doc) => matches(doc, query));
    const cursor = {
      project: () => cursor,
      limit: () => cursor,
      sort: () => cursor,
      toArray: async () => rows.map((row) => ({ ...row })),
    };
    return cursor;
  }
  async countDocuments(query) {
    return this.docs.filter((doc) => matches(doc, query)).length;
  }
  async insertOne(doc) {
    const row = { _id: doc._id ?? `id_${++this.seq}`, ...doc };
    this.docs.push(row);
    return { insertedId: row._id };
  }
  async updateOne(filter, update, options = {}) {
    await yieldTurn();
    let doc = this.docs.find((row) => matches(row, filter));
    let upserted = false;
    if (!doc) {
      if (!options.upsert) return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
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
    return { matchedCount: upserted ? 0 : 1, modifiedCount: upserted ? 0 : 1, upsertedCount: upserted ? 1 : 0 };
  }
}

function memoryDb() {
  const collections = new Map();
  return {
    collection(name) {
      if (!collections.has(name)) collections.set(name, new MemoryCollection());
      return collections.get(name);
    },
    rows(name) {
      return this.collection(name).docs;
    },
  };
}

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    size: () => map.size,
  };
}

const STUDENT = 'user_student_a';
const COURSE = 'course_alpha';
const NOW = new Date('2026-10-27T12:00:00Z');
let refCounter = 0;

async function startCheckout(db) {
  const result = await payment.createCourseIntent(db, {
    userId: STUDENT,
    courseId: COURSE,
    fetchTransaction: async () => ({ outcome: 'not_found' }),
    makeReference: () => `fo_c_unlock_${++refCounter}_abcdef`,
    now: NOW,
  });
  assert.equal(result.ok, true);
  assert.equal(result.amountKobo, 1000000);
  return db.collection(COLLECTIONS.intents).findOne({ reference: result.reference });
}

const paid = (intent, overrides = {}) => ({
  outcome: 'found',
  data: {
    status: 'success',
    reference: intent.reference,
    amount: intent.amountKobo,
    currency: 'NGN',
    paid_at: NOW.toISOString(),
    metadata: { userId: intent.userId, courseId: intent.courseId },
    ...overrides,
  },
});

/** Mirrors respondWithCourseConfirmation: the browser only ever sees presentConfirmResult. */
function confirmEndpoint(db, lookup) {
  const calls = [];
  const post = async (url, body) => {
    calls.push({ url, reference: body.reference });
    const courseId = url.match(/^\/courses\/([^/]+)\/pay$/)[1];
    const result = await payment.confirmCoursePayment(db, {
      reference: body.reference,
      source: 'checkout',
      sessionUserId: STUDENT,
      expectedCourseId: courseId,
      fetchTransaction: async (reference) => lookup(reference),
      now: NOW,
    });
    const { status, body: out } = payment.presentConfirmResult(result, 'support-test');
    if (status >= 400) {
      const error = new Error(out.message || 'Request failed');
      error.response = { status, data: out };
      throw error;
    }
    return out;
  };
  post.calls = calls;
  return post;
}

const noWait = { delays: [0, 0, 0], sleep: async () => {} };

function unlockedSpy() {
  const spy = async () => {
    spy.count += 1;
  };
  spy.count = 0;
  return spy;
}

test('1. a successful payment unlocks the course automatically after server confirmation', async () => {
  const db = memoryDb();
  const storage = memoryStorage();
  const intent = await startCheckout(db);
  checkout.rememberPendingCheckout(storage, COURSE, intent.reference, NOW.getTime());
  const post = confirmEndpoint(db, () => paid(intent));
  const onUnlocked = unlockedSpy();

  const result = await checkout.settleCourseCheckout({ post, storage, courseId: COURSE, reference: intent.reference, onUnlocked, ...noWait });

  assert.equal(result.state, 'unlocked');
  assert.equal(onUnlocked.count, 1, 'page state refreshed once, with no second unlock click');
  assert.equal(post.calls.length, 1);
  assert.equal(await payment.hasCourseEntitlement(db, STUDENT, COURSE), true);
  assert.equal(checkout.readPendingCheckout(storage, COURSE, NOW.getTime()), null);
  const access = db.rows(COLLECTIONS.courseAccess);
  assert.equal(access.length, 1);
  assert.equal(access[0].amountKobo, 1000000);
});

test('1b. Paystack submitting the host form no longer navigates; it triggers confirmation instead', () => {
  const listeners = [];
  let navigated = 0;
  const form = {
    elements: [{ name: 'reference', value: 'fo_c_form_1_abcdef' }],
    submit: () => {
      navigated += 1;
    },
    addEventListener: (type, fn) => listeners.push({ type, fn }),
  };
  const seen = [];
  checkout.neutralizeFormSubmission(form, (reference) => seen.push(reference));

  form.submit();
  form.requestSubmit();
  let prevented = false;
  listeners.find((l) => l.type === 'submit').fn({ preventDefault: () => { prevented = true; } });

  assert.equal(navigated, 0);
  assert.equal(prevented, true);
  assert.deepEqual(seen, ['fo_c_form_1_abcdef', 'fo_c_form_1_abcdef', 'fo_c_form_1_abcdef']);
  checkout.neutralizeFormSubmission(form, () => assert.fail('must not wrap twice'));
  form.submit();
});

test('2. pending verification does not grant access and keeps the reference for a status check', async () => {
  const db = memoryDb();
  const storage = memoryStorage();
  const intent = await startCheckout(db);
  checkout.rememberPendingCheckout(storage, COURSE, intent.reference, NOW.getTime());
  const post = confirmEndpoint(db, () => ({ outcome: 'not_found' }));
  const onUnlocked = unlockedSpy();
  const slept = [];

  const result = await checkout.settleCourseCheckout({
    post,
    storage,
    courseId: COURSE,
    reference: intent.reference,
    onUnlocked,
    delays: [1, 2, 3],
    sleep: async (ms) => slept.push(ms),
  });

  assert.equal(result.state, 'pending');
  assert.equal(result.retryable, true);
  assert.deepEqual(slept, [1, 2, 3], 'retried on the documented schedule before reporting pending');
  assert.equal(post.calls.length, 4);
  assert.equal(onUnlocked.count, 0);
  assert.equal(await payment.hasCourseEntitlement(db, STUDENT, COURSE), false);
  assert.equal(db.rows(COLLECTIONS.payments).length, 0);
  assert.equal(checkout.readPendingCheckout(storage, COURSE, NOW.getTime()), intent.reference);
  const stored = db.rows(COLLECTIONS.intents).find((row) => row.reference === intent.reference);
  assert.equal(stored.status, 'pending');
});

test('3. failed verification keeps the course locked and returns a useful, retryable message', async () => {
  const db = memoryDb();
  const storage = memoryStorage();
  const intent = await startCheckout(db);
  checkout.rememberPendingCheckout(storage, COURSE, intent.reference, NOW.getTime());
  const post = confirmEndpoint(db, () => paid(intent, { status: 'failed' }));
  const onUnlocked = unlockedSpy();

  const result = await checkout.settleCourseCheckout({ post, storage, courseId: COURSE, reference: intent.reference, onUnlocked, ...noWait });

  assert.equal(result.state, 'failed');
  assert.ok(result.message && result.message.length > 10);
  assert.equal(result.retryable, true);
  assert.equal(onUnlocked.count, 0);
  assert.equal(await payment.hasCourseEntitlement(db, STUDENT, COURSE), false);
  assert.equal(checkout.readPendingCheckout(storage, COURSE, NOW.getTime()), intent.reference);

  const foreign = await checkout.settleCourseCheckout({
    post: async () => {
      const error = new Error('x');
      error.response = { status: 403, data: { code: 'reference_owner_mismatch', message: 'This payment reference belongs to another account.' } };
      throw error;
    },
    storage,
    courseId: COURSE,
    reference: intent.reference,
    onUnlocked,
    ...noWait,
  });
  assert.equal(foreign.state, 'failed');
  assert.equal(foreign.retryable, false);
  assert.equal(checkout.readPendingCheckout(storage, COURSE, NOW.getTime()), null, 'unusable references are dropped');
});

test('4. duplicate callbacks share one confirmation and never duplicate payments or entitlements', async () => {
  const db = memoryDb();
  const storage = memoryStorage();
  const intent = await startCheckout(db);
  const post = confirmEndpoint(db, () => paid(intent));
  const onUnlocked = unlockedSpy();
  const args = { post, storage, courseId: COURSE, reference: intent.reference, onUnlocked, ...noWait };

  const [a, b, c] = await Promise.all([
    checkout.settleCourseCheckout(args),
    checkout.settleCourseCheckout(args),
    checkout.settleCourseCheckout(args),
  ]);
  assert.equal(a, b);
  assert.equal(b, c);
  assert.equal(post.calls.length, 1, 'callback, form signal, and resume share one request');

  const later = await checkout.settleCourseCheckout(args);
  assert.equal(later.state, 'unlocked');
  assert.equal(later.alreadyProcessed, true);

  const direct = confirmEndpoint(db, () => paid(intent));
  await Promise.all([direct('/courses/course_alpha/pay', { reference: intent.reference }), direct('/courses/course_alpha/pay', { reference: intent.reference })].map((p) => p.catch((e) => e)));

  assert.equal(db.rows(COLLECTIONS.payments).filter((row) => row.reference === intent.reference).length, 1);
  assert.equal(db.rows(COLLECTIONS.courseAccess).length, 1);
  assert.equal(db.rows(COLLECTIONS.coursePurchases).length, 1);
});

test('5. after a reload or return from Paystack the stored or URL reference is confirmed', async () => {
  const db = memoryDb();
  const storage = memoryStorage();
  const intent = await startCheckout(db);
  checkout.rememberPendingCheckout(storage, COURSE, intent.reference, NOW.getTime());

  const resumed = checkout.resumableReference(storage, COURSE, '', NOW.getTime() + 60_000);
  assert.equal(resumed, intent.reference);
  assert.equal(checkout.resumableReference(memoryStorage(), COURSE, `?trxref=${intent.reference}&reference=${intent.reference}`), intent.reference);
  assert.equal(checkout.resumableReference(memoryStorage(), COURSE, '?reference=<script>'), null);
  assert.equal(checkout.readPendingCheckout(storage, COURSE, NOW.getTime() + checkout.PENDING_MAX_AGE_MS + 1), null, 'old references expire');

  checkout.rememberPendingCheckout(storage, COURSE, intent.reference, NOW.getTime());
  const onUnlocked = unlockedSpy();
  const result = await checkout.settleCourseCheckout({
    post: confirmEndpoint(db, () => paid(intent)),
    storage,
    courseId: COURSE,
    reference: resumed,
    onUnlocked,
    ...noWait,
  });
  assert.equal(result.state, 'unlocked');
  assert.equal(onUnlocked.count, 1);
  assert.equal(await payment.hasCourseEntitlement(db, STUDENT, COURSE), true, 'a fresh page load sees the entitlement');

  const webhookFirst = memoryDb();
  const late = await startCheckout(webhookFirst);
  const hook = await payment.processWebhookEvent(webhookFirst, { event: 'charge.success', data: paid(late).data }, NOW);
  assert.equal(hook.code, 'granted');
  const afterWebhook = await checkout.settleCourseCheckout({
    post: confirmEndpoint(webhookFirst, () => assert.fail('already settled by the webhook')),
    storage: memoryStorage(),
    courseId: COURSE,
    reference: late.reference,
    onUnlocked: unlockedSpy(),
    ...noWait,
  });
  assert.equal(afterWebhook.state, 'unlocked');
  assert.equal(afterWebhook.alreadyProcessed, true);
  assert.equal(webhookFirst.rows(COLLECTIONS.payments).length, 1);
});

test('6. complimentary and manual grants stay intact through the checkout follow-through', async () => {
  for (const entitlementType of ['complimentary', 'manual_grant']) {
    const db = memoryDb();
    const intent = await startCheckout(db);
    const grant = { userId: STUDENT, courseId: COURSE, entitlementType, grantedBy: 'admin_1', createdAt: NOW };
    await db.collection(COLLECTIONS.courseAccess).insertOne({ ...grant });

    const result = await checkout.settleCourseCheckout({
      post: confirmEndpoint(db, () => paid(intent)),
      storage: memoryStorage(),
      courseId: COURSE,
      reference: intent.reference,
      onUnlocked: unlockedSpy(),
      ...noWait,
    });

    assert.equal(result.state, 'unlocked');
    assert.equal(result.duplicatePayment, true, `${entitlementType}: extra charge recorded for review, not re-granted`);
    const rows = db.rows(COLLECTIONS.courseAccess);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].entitlementType, entitlementType);
    assert.equal(rows[0].grantedBy, 'admin_1');
    assert.equal(rows[0].paid, undefined);
    assert.equal(await payment.hasCourseEntitlement(db, STUDENT, COURSE), true);
  }
});

test('7. a stale reference from another course is never confirmed for the next course and does not erase its checkout', async () => {
  const db = memoryDb();
  const storage = memoryStorage();
  const OTHER = 'course_beta';
  const first = await startCheckout(db);
  await checkout.settleCourseCheckout({ post: confirmEndpoint(db, () => paid(first)), storage, courseId: COURSE, reference: first.reference, ...noWait });

  const second = await payment.createCourseIntent(db, {
    userId: STUDENT,
    courseId: OTHER,
    fetchTransaction: async () => ({ outcome: 'not_found' }),
    makeReference: () => `fo_c_unlock_${++refCounter}_beta00`,
    now: NOW,
  });
  checkout.rememberPendingCheckout(storage, OTHER, second.reference, NOW.getTime());

  const removed = [];
  const form = {
    elements: [
      { name: 'reference', value: first.reference, remove() { removed.push(this.value); } },
      { name: 'reference', value: second.reference, remove() { removed.push(this.value); } },
    ],
  };
  assert.equal(checkout.readFormReference(form), second.reference, 'latest field wins');
  assert.equal(
    checkout.referenceForFormSignal(first.reference, checkout.readPendingCheckout(storage, OTHER, NOW.getTime())),
    second.reference,
    'the stored checkout for this course is trusted over a stale form value'
  );
  assert.equal(checkout.referenceForFormSignal(first.reference, null), null, 'no stored checkout: nothing is confirmed');
  checkout.clearFormReferences(form);
  assert.deepEqual(removed, [first.reference, second.reference]);

  const mismatch = await checkout.settleCourseCheckout({
    post: confirmEndpoint(db, () => paid(first)),
    storage,
    courseId: OTHER,
    reference: first.reference,
    ...noWait,
  });
  assert.equal(mismatch.state, 'failed');
  assert.equal(mismatch.code, 'course_mismatch');
  assert.ok(checkout.SILENT_RESUME_CODES.has('course_mismatch'));
  assert.equal(checkout.readPendingCheckout(storage, OTHER, NOW.getTime()), second.reference, 'the other course keeps its checkout');
  assert.equal(await payment.hasCourseEntitlement(db, STUDENT, OTHER), false);
  assert.equal(db.rows(COLLECTIONS.payments).length, 1);
});

test('8. automatic resume only verifies an existing checkout, and repeating it after success is a database read', async () => {
  const db = memoryDb();
  const storage = memoryStorage();
  const intent = await startCheckout(db);
  checkout.rememberPendingCheckout(storage, COURSE, intent.reference, NOW.getTime());
  const lookups = [];
  const post = confirmEndpoint(db, (reference) => {
    lookups.push(reference);
    return paid(intent);
  });

  const first = await checkout.settleCourseCheckout({ post, storage, courseId: COURSE, reference: intent.reference, ...noWait });
  assert.equal(first.state, 'unlocked');
  assert.equal(lookups.length, 1);
  assert.equal(checkout.readPendingCheckout(storage, COURSE, NOW.getTime()), null, 'a settled reference is forgotten');

  for (let reload = 0; reload < 3; reload += 1) {
    const again = await checkout.settleCourseCheckout({
      post,
      storage,
      courseId: COURSE,
      reference: checkout.resumableReference(storage, COURSE, `?reference=${intent.reference}`, NOW.getTime()),
      ...noWait,
    });
    assert.equal(again.state, 'unlocked');
    assert.equal(again.alreadyProcessed, true);
  }
  assert.equal(lookups.length, 1, 'a paid checkout is answered from the database without asking Paystack again');
  assert.ok(post.calls.every((call) => call.url === `/courses/${COURSE}/pay`), 'resume never starts a new checkout');
  assert.equal(db.rows(COLLECTIONS.intents).length, 1);
  assert.equal(db.rows(COLLECTIONS.payments).length, 1);
  assert.equal(db.rows(COLLECTIONS.courseAccess).length, 1);
  assert.equal(db.rows(COLLECTIONS.coursePurchases).length, 1);
});

test('9. abandoned, never-opened, and rate-limited resumes are bounded and grant nothing', async () => {
  const delays = [0, 0, 0];
  const sleep = async () => {};
  const scenarios = [
    { name: 'abandoned at Paystack', lookup: (intent) => paid(intent, { status: 'abandoned' }), maxCalls: 1 },
    { name: 'never reached Paystack', lookup: () => ({ outcome: 'not_found' }), maxCalls: 1 + delays.length },
    { name: 'provider unreachable', lookup: () => ({ outcome: 'uncertain', reason: 'network' }), maxCalls: 1 + delays.length },
  ];
  for (const scenario of scenarios) {
    const db = memoryDb();
    const storage = memoryStorage();
    const intent = await startCheckout(db);
    checkout.rememberPendingCheckout(storage, COURSE, intent.reference, NOW.getTime());
    const post = confirmEndpoint(db, () => scenario.lookup(intent));
    const onUnlocked = unlockedSpy();

    const result = await checkout.settleCourseCheckout({ post, storage, courseId: COURSE, reference: intent.reference, onUnlocked, delays, sleep });

    assert.notEqual(result.state, 'unlocked', scenario.name);
    assert.equal(post.calls.length, scenario.maxCalls, `${scenario.name}: requests per page load are bounded`);
    assert.ok(post.calls.every((call) => call.url === `/courses/${COURSE}/pay`), `${scenario.name}: no new checkout`);
    assert.equal(onUnlocked.count, 0);
    assert.equal(await payment.hasCourseEntitlement(db, STUDENT, COURSE), false);
    assert.equal(db.rows(COLLECTIONS.payments).length, 0);
    assert.equal(db.rows(COLLECTIONS.intents).length, 1);
    assert.equal(db.rows(COLLECTIONS.intents)[0].status, 'pending', `${scenario.name}: the claim is released`);
  }

  const limited = [];
  const rateLimited = async (url, body) => {
    limited.push({ url, reference: body.reference });
    const error = new Error('Too many payment requests.');
    error.response = { status: 429, data: { code: 'rate_limited', retryable: true, message: 'Too many payment requests. Wait a moment and try again.' } };
    throw error;
  };
  const throttled = await checkout.settleCourseCheckout({
    post: rateLimited,
    storage: memoryStorage(),
    courseId: COURSE,
    reference: 'fo_c_rate_limited_ref',
    delays,
    sleep,
  });
  assert.equal(throttled.state, 'pending');
  assert.equal(limited.length, 1 + delays.length, 'a 429 is retried on the same bounded schedule, not in a loop');
});

test('10. two tabs resuming the same checkout at once record one payment and one entitlement', async () => {
  const db = memoryDb();
  const intent = await startCheckout(db);
  const tabA = confirmEndpoint(db, () => paid(intent));
  const tabB = confirmEndpoint(db, () => paid(intent));
  const shortWait = { delays: [20, 20, 20], sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) };
  const results = await Promise.all([
    checkout.confirmCourseCheckout({ post: tabA, courseId: COURSE, reference: intent.reference, ...shortWait }),
    checkout.confirmCourseCheckout({ post: tabB, courseId: COURSE, reference: intent.reference, ...shortWait }),
  ]);
  assert.deepEqual(results.map((r) => r.state), ['unlocked', 'unlocked'], 'the tab that waited sees the settled result');
  assert.ok(tabA.calls.length + tabB.calls.length <= 2 + shortWait.delays.length);
  assert.equal(db.rows(COLLECTIONS.payments).length, 1);
  assert.equal(db.rows(COLLECTIONS.courseAccess).length, 1);
  assert.equal(db.rows(COLLECTIONS.coursePurchases).length, 1);
});

test('source contract: checkout confirms through the existing endpoint and the host form cannot navigate', () => {
  const component = read('components/monetization/PaystackCourseUnlock.tsx');
  const script = read('lib/paystack-inline-script.ts');
  const helper = read('lib/course-checkout.js');
  assert.match(component, /rememberPendingCheckout\(browserStorage\(\), courseId, reference\)/);
  assert.match(component, /settleCourseCheckout\(/);
  assert.match(component, /resumableReference\(/);
  assert.match(component, /onPaystackHostFormSubmit\(/);
  assert.match(component, /referenceForFormSignal\(/);
  assert.match(component, /resetPaystackHostForm\(\);\s*rememberPendingCheckout/);
  assert.doesNotMatch(component, /Reference: \$\{reference\}\./, 'no trailing period glued to the reference');
  assert.match(helper, /`\/courses\/\$\{courseId\}\/pay`/);
  assert.match(script, /neutralizeFormSubmission\(form/);
  assert.doesNotMatch(script, /form\.method\s*=\s*'post'/);
  assert.doesNotMatch(helper, /hasCourseEntitlement|userCourseAccess|unlocked\s*=\s*true/);
});
