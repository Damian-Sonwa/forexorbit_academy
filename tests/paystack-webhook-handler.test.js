/**
 * Paystack webhook route (pages/api/paystack/webhook.ts), executed end to end at handler level.
 *
 * The TypeScript route is transpiled in memory and run with its real signature check and the real
 * lib/course-payment.js processing. Only the database (`@/lib/mongodb`) is replaced, by an
 * in-memory store, and logging is captured. Payloads are signed locally with a random,
 * test-prefixed secret generated per run. No network, Paystack, `.env`, or MongoDB is used.
 * These are replayed deliveries built in the test, not genuine Paystack deliveries.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const ts = require('typescript');

const payment = require('../lib/course-payment');

const { COLLECTIONS, AUDIT_COLLECTION } = payment;
const ROUTE = path.join(__dirname, '..', 'pages', 'api', 'paystack', 'webhook.ts');
const SECRET = `sk_test_${crypto.randomBytes(24).toString('hex')}`;
const OTHER_SECRET = `sk_test_${crypto.randomBytes(24).toString('hex')}`;
const STUDENT = 'user_student_a';
const COURSE = 'course_alpha';
const NOW = new Date('2026-10-27T12:00:00Z');
const CUSTOMER_EMAIL = 'student@example.test';

// ---------------------------------------------------------------------------
// In-memory stand-in for the MongoDB driver calls the payment code makes.
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

class MemoryCollection {
  constructor(name, db) {
    this.name = name;
    this.db = db;
    this.docs = [];
    this.seq = 0;
  }
  guard(method, args) {
    if (this.db.failWhen && this.db.failWhen(this.name, method, ...args)) {
      throw new Error(`simulated ${method} failure on ${this.name}`);
    }
  }
  async findOne(query) {
    this.guard('findOne', [query]);
    return this.docs.find((doc) => matches(doc, query)) || null;
  }
  find(query) {
    this.guard('find', [query]);
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
    this.guard('insertOne', [doc]);
    const row = { _id: doc._id ?? `id_${this.name}_${++this.seq}`, ...doc };
    this.docs.push(row);
    return { insertedId: row._id };
  }
  async updateOne(filter, update, options = {}) {
    this.guard('updateOne', [filter, update]);
    let doc = this.docs.find((row) => matches(row, filter));
    let upserted = false;
    if (!doc) {
      if (!options.upsert) return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
      doc = { _id: `id_${this.name}_${++this.seq}` };
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

function memoryDb() {
  const collections = new Map();
  const db = {
    failWhen: null,
    collection(name) {
      if (!collections.has(name)) collections.set(name, new MemoryCollection(name, db));
      return collections.get(name);
    },
    rows(name) {
      return this.collection(name).docs;
    },
    snapshot() {
      return JSON.stringify([...collections.entries()].map(([name, col]) => [name, col.docs]));
    },
  };
  return db;
}

// ---------------------------------------------------------------------------
// The real route, with only the database and logger swapped.
// ---------------------------------------------------------------------------

const harness = { db: null, getDbCalls: 0, getDbError: null, logs: [] };

function loadRoute() {
  const source = fs.readFileSync(ROUTE, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: ROUTE,
  });
  const stubs = {
    '@/lib/mongodb': {
      getDb: async () => {
        harness.getDbCalls += 1;
        if (harness.getDbError) throw harness.getDbError;
        return harness.db;
      },
    },
    '@/lib/course-payment': payment,
    '@/lib/payment-route': {
      newSupportId: () => crypto.randomUUID(),
      logPayment: (tag, fields) => harness.logs.push({ tag, ...fields }),
    },
  };
  const routeModule = { exports: {} };
  const localRequire = (id) => {
    if (Object.prototype.hasOwnProperty.call(stubs, id)) return stubs[id];
    if (id.startsWith('@/')) throw new Error(`webhook route imports an unexpected module: ${id}`);
    return require(id);
  };
  new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(
    routeModule.exports, localRequire, routeModule, ROUTE, path.dirname(ROUTE)
  );
  return routeModule.exports;
}

const route = loadRoute();
const handler = route.default;

const sign = (raw, secret = SECRET) => crypto.createHmac('sha512', secret).update(raw).digest('hex');

async function deliver(body, { signature, method = 'POST', raw } = {}) {
  const buffer = raw || Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  const headers = { 'content-type': 'application/json' };
  const sig = signature === undefined ? sign(buffer) : signature;
  if (sig !== null) headers['x-paystack-signature'] = sig;
  const req = Readable.from([buffer]);
  req.method = method;
  req.headers = headers;
  const res = {
    statusCode: 200,
    body: undefined,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    setHeader(name, value) { this.headers[name] = value; },
  };
  await handler(req, res);
  return { status: res.statusCode, body: res.body, raw: buffer };
}

const lastLog = () => harness.logs[harness.logs.length - 1];

let refCounter = 0;
async function startCheckout(db, courseId = COURSE) {
  const result = await payment.createCourseIntent(db, {
    userId: STUDENT,
    courseId,
    fetchTransaction: async () => ({ outcome: 'not_found' }),
    makeReference: () => `fo_c_webhook_${++refCounter}_abcdef`,
    now: NOW,
  });
  assert.equal(result.ok, true);
  assert.equal(result.amountKobo, 1000000);
  return db.collection(COLLECTIONS.intents).findOne({ reference: result.reference });
}

let eventId = 5000;
function chargeSuccess(intent, overrides = {}) {
  return {
    event: 'charge.success',
    data: {
      id: ++eventId,
      domain: 'test',
      status: 'success',
      reference: intent.reference,
      amount: intent.amountKobo,
      currency: 'NGN',
      paid_at: NOW.toISOString(),
      metadata: { userId: intent.userId, courseId: intent.courseId },
      customer: { email: CUSTOMER_EMAIL },
      ...overrides,
    },
  };
}

function counts(db) {
  return {
    payments: db.rows(COLLECTIONS.payments).length,
    access: db.rows(COLLECTIONS.courseAccess).length,
    purchases: db.rows(COLLECTIONS.coursePurchases).length,
    exceptions: db.rows(COLLECTIONS.exceptions).length,
    audit: db.rows(AUDIT_COLLECTION).length,
  };
}

const intentStatus = async (db, intent) => (await db.collection(COLLECTIONS.intents).findOne({ reference: intent.reference })).status;

const savedEnv = {};
const ENV_KEYS = ['PAYSTACK_SECRET_KEY', 'MONGODB_DB_NAME', 'MONGO_URI', 'MONGODB_URI', 'NODE_ENV'];

test.before(() => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  delete process.env.MONGO_URI;
  delete process.env.MONGODB_URI;
  delete process.env.NODE_ENV;
  process.env.MONGODB_DB_NAME = 'Forex_elearning_webhook_test';
  process.env.PAYSTACK_SECRET_KEY = SECRET;
  assert.deepEqual(payment.decidePaymentEnvironment(process.env), { enabled: true, mode: 'test' });
});

test.after(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

test.beforeEach(() => {
  harness.db = memoryDb();
  harness.getDbCalls = 0;
  harness.getDbError = null;
  harness.logs = [];
});

test.afterEach(() => {
  const logged = JSON.stringify(harness.logs);
  assert.equal(logged.includes(SECRET), false, 'the webhook secret is never logged');
  assert.equal(logged.includes(CUSTOMER_EMAIL), false, 'customer emails are never logged');
});

// ---------------------------------------------------------------------------
// 1. Valid signed event
// ---------------------------------------------------------------------------

test('1. a correctly signed charge.success for a pending ₦10,000 checkout is accepted and grants once', async () => {
  const db = harness.db;
  const intent = await startCheckout(db);
  const res = await deliver(chargeSuccess(intent));

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { received: true });
  assert.equal(lastLog().code, 'granted');
  assert.equal(await intentStatus(db, intent), 'paid');
  assert.equal(await payment.hasCourseEntitlement(db, STUDENT, COURSE), true);
  assert.deepEqual(counts(db), { payments: 1, access: 1, purchases: 1, exceptions: 0, audit: 0 });
  const [row] = db.rows(COLLECTIONS.payments);
  assert.equal(row.source, 'webhook');
  assert.equal(row.amountKobo, 1000000);
  assert.equal(row.currency, 'NGN');
  assert.equal(row.entitlementApplied, true);
  assert.equal(db.rows(COLLECTIONS.courseAccess)[0].source, 'paystack-webhook');
});

// ---------------------------------------------------------------------------
// 2. Invalid signatures
// ---------------------------------------------------------------------------

test('2. missing, wrong-secret, truncated, and post-signing-tampered signatures get 401 and touch nothing', async () => {
  const db = harness.db;
  const intent = await startCheckout(db);
  const event = chargeSuccess(intent);
  const raw = Buffer.from(JSON.stringify(event));
  const tampered = Buffer.from(JSON.stringify({ ...event, data: { ...event.data, amount: 100 } }));
  const before = db.snapshot();

  const attempts = [
    { label: 'no header', raw, signature: null },
    { label: 'empty header', raw, signature: '' },
    { label: 'signed with another test secret', raw, signature: sign(raw, OTHER_SECRET) },
    { label: 'truncated signature', raw, signature: sign(raw).slice(0, -2) },
    { label: 'uppercase hex', raw, signature: sign(raw).toUpperCase() },
    { label: 'SHA-256 instead of SHA-512', raw, signature: crypto.createHmac('sha256', SECRET).update(raw).digest('hex') },
    { label: 'body changed after signing', raw: tampered, signature: sign(raw) },
  ];
  for (const attempt of attempts) {
    const res = await deliver(null, { raw: attempt.raw, signature: attempt.signature });
    assert.equal(res.status, 401, attempt.label);
    assert.deepEqual(res.body, { message: 'Unauthorized' }, attempt.label);
    assert.equal(lastLog().code, 'invalid_signature', attempt.label);
  }

  assert.equal(harness.getDbCalls, 0, 'the database is never opened for an unsigned request');
  assert.equal(db.snapshot(), before);
  assert.equal(await intentStatus(db, intent), 'pending');
  assert.equal(await payment.hasCourseEntitlement(db, STUDENT, COURSE), false);
});

test('2b. with no secret configured the route refuses every delivery before reading it', async () => {
  const db = harness.db;
  const intent = await startCheckout(db);
  const before = db.snapshot();
  delete process.env.PAYSTACK_SECRET_KEY;
  try {
    const res = await deliver(chargeSuccess(intent));
    assert.equal(res.status, 503);
    assert.equal(lastLog().code, 'not_configured');
  } finally {
    process.env.PAYSTACK_SECRET_KEY = SECRET;
  }
  assert.equal(harness.getDbCalls, 0);
  assert.equal(db.snapshot(), before);
});

// ---------------------------------------------------------------------------
// 3. Replays
// ---------------------------------------------------------------------------

test('3. replaying the identical signed delivery never duplicates payment, access, purchase, or ledger rows', async () => {
  const db = harness.db;
  const intent = await startCheckout(db);
  const raw = Buffer.from(JSON.stringify(chargeSuccess(intent)));
  const signature = sign(raw);

  const codes = [];
  for (let i = 0; i < 4; i += 1) {
    const res = await deliver(null, { raw, signature });
    assert.equal(res.status, 200);
    codes.push(lastLog().code);
  }
  assert.deepEqual(codes, ['granted', 'already_processed', 'already_processed', 'already_processed']);
  assert.deepEqual(counts(db), { payments: 1, access: 1, purchases: 1, exceptions: 0, audit: 0 });
});

test('3b. concurrent duplicate deliveries write one set of records; any loser is told to retry', async () => {
  const db = harness.db;
  const intent = await startCheckout(db);
  const raw = Buffer.from(JSON.stringify(chargeSuccess(intent)));
  const signature = sign(raw);

  const results = await Promise.all([1, 2, 3].map(() => deliver(null, { raw, signature })));
  for (const res of results) assert.ok(res.status === 200 || res.status === 500, `unexpected ${res.status}`);
  assert.ok(results.some((res) => res.status === 200));
  assert.deepEqual(counts(db), { payments: 1, access: 1, purchases: 1, exceptions: 0, audit: 0 });

  const again = await deliver(null, { raw, signature });
  assert.equal(again.status, 200);
  assert.deepEqual(counts(db), { payments: 1, access: 1, purchases: 1, exceptions: 0, audit: 0 });
});

test('3c. a webhook replayed after the browser confirmation is idempotent', async () => {
  const db = harness.db;
  const intent = await startCheckout(db);
  const event = chargeSuccess(intent);
  const browser = await payment.confirmCoursePayment(db, {
    reference: intent.reference,
    source: 'checkout',
    sessionUserId: STUDENT,
    expectedCourseId: COURSE,
    fetchTransaction: async () => ({ outcome: 'found', data: event.data }),
    now: NOW,
  });
  assert.equal(browser.ok, true);

  const res = await deliver(event);
  assert.equal(res.status, 200);
  assert.equal(lastLog().code, 'already_processed');
  assert.deepEqual(counts(db), { payments: 1, access: 1, purchases: 1, exceptions: 0, audit: 0 });
  assert.equal(db.rows(COLLECTIONS.payments)[0].source, 'checkout');
});

test('3d. a replayed review-only event (refund) is recorded once, not counted again', async () => {
  const db = harness.db;
  const intent = await startCheckout(db);
  const refund = { event: 'refund.processed', data: { id: 77001, transaction_reference: intent.reference, amount: 1000000, currency: 'NGN' } };
  const raw = Buffer.from(JSON.stringify(refund));
  for (let i = 0; i < 3; i += 1) {
    const res = await deliver(null, { raw, signature: sign(raw) });
    assert.equal(res.status, 200);
  }
  const exceptions = db.rows(COLLECTIONS.exceptions);
  assert.equal(exceptions.length, 1);
  assert.equal(exceptions[0].reason, 'refund_unhandled');
  assert.equal(exceptions[0].occurrences, 1);
});

// ---------------------------------------------------------------------------
// 4. Wrong amount or currency
// ---------------------------------------------------------------------------

test('4. a signed event with the wrong amount, currency, or metadata is acknowledged, recorded, and grants nothing', async () => {
  const cases = [
    { label: 'lower amount', overrides: { amount: 500000 }, code: 'amount_mismatch' },
    { label: 'higher amount', overrides: { amount: 2000000 }, code: 'amount_mismatch' },
    { label: 'amount as a string', overrides: { amount: '1000000x' }, code: 'amount_mismatch' },
    { label: 'other currency, same minor units', overrides: { currency: 'USD' }, code: 'currency_mismatch' },
    { label: 'missing currency', overrides: { currency: undefined }, code: 'currency_mismatch' },
    { label: 'metadata names another course', overrides: { metadata: { userId: STUDENT, courseId: 'course_other' } }, code: 'metadata_mismatch' },
    { label: 'metadata names another user', overrides: { metadata: { userId: 'user_other', courseId: COURSE } }, code: 'metadata_mismatch' },
  ];
  for (const { label, overrides, code } of cases) {
    const db = memoryDb();
    harness.db = db;
    const intent = await startCheckout(db);
    const raw = Buffer.from(JSON.stringify(chargeSuccess(intent, overrides)));

    const res = await deliver(null, { raw, signature: sign(raw) });
    assert.equal(res.status, 200, `${label}: acknowledged so Paystack stops retrying`);
    assert.equal(lastLog().code, code, label);
    assert.equal(await payment.hasCourseEntitlement(db, STUDENT, COURSE), false, label);
    assert.equal(await intentStatus(db, intent), 'pending', `${label}: checkout is not marked paid`);
    assert.deepEqual(counts(db), { payments: 0, access: 0, purchases: 0, exceptions: 1, audit: 0 }, label);
    assert.equal(db.rows(COLLECTIONS.exceptions)[0].reason, code, label);

    const replay = await deliver(null, { raw, signature: sign(raw) });
    assert.equal(replay.status, 200, label);
    assert.equal(db.rows(COLLECTIONS.exceptions)[0].occurrences, 1, `${label}: replay not counted twice`);
    assert.equal(await payment.hasCourseEntitlement(db, STUDENT, COURSE), false, label);
  }
});

test('4b. a signed charge for a reference with no checkout is recorded for review and never grants', async () => {
  const db = harness.db;
  const res = await deliver({
    event: 'charge.success',
    data: { id: 88001, status: 'success', reference: 'fo_c_unknown_reference_1', amount: 1000000, currency: 'NGN', metadata: { userId: STUDENT, courseId: COURSE } },
  });
  assert.equal(res.status, 200);
  assert.equal(lastLog().code, 'needs_review');
  assert.equal(await payment.hasCourseEntitlement(db, STUDENT, COURSE), false);
  assert.deepEqual(counts(db), { payments: 0, access: 0, purchases: 0, exceptions: 1, audit: 0 });
  assert.equal(db.rows(COLLECTIONS.exceptions)[0].reason, 'no_matching_intent');
});

// ---------------------------------------------------------------------------
// 5. Unknown, unsupported, and malformed events
// ---------------------------------------------------------------------------

test('5. unsupported or malformed signed events are handled without writes; non-success charges grant nothing', async () => {
  const db = harness.db;
  const intent = await startCheckout(db);
  const before = db.snapshot();

  const ignored = [
    { event: 'transfer.success', data: { reference: intent.reference, amount: 1000000 } },
    { event: 'subscription.create', data: {} },
    { event: 'charge.success' },
    { event: 'charge.success', data: 'not-an-object' },
    { data: chargeSuccess(intent).data },
    {},
    [],
  ];
  for (const body of ignored) {
    const res = await deliver(body);
    assert.equal(res.status, 200, JSON.stringify(body).slice(0, 60));
    assert.equal(lastLog().code, 'ignored');
  }
  assert.equal(db.snapshot(), before);

  const badJson = await deliver('{"event":"charge.success",', {});
  assert.equal(badJson.status, 400);
  assert.equal(lastLog().code, 'invalid_json');

  const getRes = await deliver(chargeSuccess(intent), { method: 'GET' });
  assert.equal(getRes.status, 405);

  const huge = Buffer.alloc(300 * 1024, 0x20);
  const tooLarge = await deliver(null, { raw: huge, signature: sign(huge) });
  assert.equal(tooLarge.status, 400);
  assert.equal(lastLog().code, 'invalid_body');
  assert.equal(db.snapshot(), before);

  for (const status of ['failed', 'abandoned', 'reversed']) {
    const res = await deliver(chargeSuccess(intent, { status }));
    assert.equal(res.status, 200, status);
    assert.equal(lastLog().code, 'payment_not_successful', status);
  }
  for (const status of ['pending', 'ongoing']) {
    const res = await deliver(chargeSuccess(intent, { status }));
    assert.equal(res.status, 500, `${status}: left for Paystack to redeliver`);
    assert.equal(lastLog().code, 'payment_pending', status);
  }
  assert.equal(await intentStatus(db, intent), 'pending');
  assert.equal(await payment.hasCourseEntitlement(db, STUDENT, COURSE), false);
  assert.deepEqual(counts(db), { payments: 0, access: 0, purchases: 0, exceptions: 0, audit: 0 });
});

// ---------------------------------------------------------------------------
// 6. Processing failures
// ---------------------------------------------------------------------------

test('6. a database outage returns 500 so Paystack retries, and nothing is marked complete', async () => {
  const db = harness.db;
  const intent = await startCheckout(db);
  harness.getDbError = new Error('simulated connection failure');
  const res = await deliver(chargeSuccess(intent));
  assert.equal(res.status, 500);
  assert.equal(res.body.message, 'Processing failed');
  assert.equal(typeof res.body.supportId, 'string');
  assert.equal(lastLog().code, 'processing_failed');
  assert.equal(await intentStatus(db, intent), 'pending');
  assert.deepEqual(counts(db), { payments: 0, access: 0, purchases: 0, exceptions: 0, audit: 0 });
});

test('6b. a write failure part-way returns 500, releases the checkout, and the redelivery completes without duplicates', async () => {
  const db = harness.db;
  const intent = await startCheckout(db);
  const raw = Buffer.from(JSON.stringify(chargeSuccess(intent)));
  let failures = 0;
  db.failWhen = (name, method, filter, update) => {
    const markingPaid = name === COLLECTIONS.intents && method === 'updateOne' && update && update.$set && update.$set.status === 'paid';
    if (markingPaid && failures === 0) {
      failures += 1;
      return true;
    }
    return false;
  };

  const first = await deliver(null, { raw, signature: sign(raw) });
  assert.equal(first.status, 500);
  assert.equal(lastLog().code, 'processing_failed');
  assert.equal(await intentStatus(db, intent), 'pending', 'the claim is released, not left as paid or processing');

  const retry = await deliver(null, { raw, signature: sign(raw) });
  assert.equal(retry.status, 200);
  assert.equal(await intentStatus(db, intent), 'paid');
  assert.equal(await payment.hasCourseEntitlement(db, STUDENT, COURSE), true);
  assert.deepEqual(counts(db), { payments: 1, access: 1, purchases: 1, exceptions: 0, audit: 0 });
});

test('6c. a delivery that finds another confirmation in progress returns 500 and leaves the claim alone', async () => {
  const db = harness.db;
  const intent = await startCheckout(db);
  const claimedAt = new Date();
  await db.collection(COLLECTIONS.intents).updateOne({ _id: intent._id }, { $set: { status: 'processing', claimedAt, claimedFrom: 'pending' } });

  const res = await deliver(chargeSuccess(intent));
  assert.equal(res.status, 500);
  assert.equal(res.body.message, 'Processing incomplete');
  assert.equal(lastLog().code, 'payment_processing');
  const stored = await db.collection(COLLECTIONS.intents).findOne({ _id: intent._id });
  assert.equal(stored.status, 'processing');
  assert.equal(stored.claimedAt, claimedAt);
  assert.deepEqual(counts(db), { payments: 0, access: 0, purchases: 0, exceptions: 0, audit: 0 });
});

test('6d. a failure while recording a review-only event returns 500 instead of a false acknowledgement', async () => {
  const db = harness.db;
  const intent = await startCheckout(db);
  db.failWhen = (name) => name === COLLECTIONS.exceptions;
  const res = await deliver({ event: 'charge.dispute.create', data: { id: 66001, transaction_reference: intent.reference, amount: 1000000, currency: 'NGN' } });
  assert.equal(res.status, 500);
  assert.equal(lastLog().code, 'processing_failed');
});

// ---------------------------------------------------------------------------
// 7. Delayed or repeated events after a verified payment
// ---------------------------------------------------------------------------

const verifiedState = (db) => JSON.stringify([
  db.rows(COLLECTIONS.payments),
  db.rows(COLLECTIONS.courseAccess),
  db.rows(COLLECTIONS.coursePurchases),
  db.rows(COLLECTIONS.intents),
]);

test('7. delayed events with a bad amount, currency, or failed status cannot change a verified payment and are recorded', async () => {
  const db = harness.db;
  const intent = await startCheckout(db);
  assert.equal((await deliver(chargeSuccess(intent))).status, 200);
  const before = verifiedState(db);

  const late = [
    [chargeSuccess(intent, { amount: 100 }), 'late_conflicting_event'],
    [chargeSuccess(intent, { currency: 'USD' }), 'late_conflicting_event'],
    [chargeSuccess(intent, { status: 'failed' }), 'late_conflicting_event'],
    [chargeSuccess(intent, { metadata: { userId: 'user_other', courseId: 'course_other' } }), 'already_processed'],
    [{ event: 'charge.failed', data: chargeSuccess(intent).data }, 'ignored'],
  ];
  for (const [body, code] of late) {
    const res = await deliver(body);
    assert.equal(res.status, 200);
    assert.equal(lastLog().code, code);
  }
  assert.equal(verifiedState(db), before, 'payment, access, purchase and checkout rows are unchanged');
  assert.equal(await intentStatus(db, intent), 'paid');
  assert.equal(await payment.hasCourseEntitlement(db, STUDENT, COURSE), true);
  assert.equal(db.rows(COLLECTIONS.payments)[0].amountKobo, 1000000);

  const exceptions = db.rows(COLLECTIONS.exceptions);
  assert.equal(exceptions.length, 1);
  assert.equal(exceptions[0].reason, 'late_conflicting_event');
  assert.equal(exceptions[0].occurrences, 3);
  assert.equal(exceptions[0].eventKeys.length, 3);
  assert.equal(db.rows(AUDIT_COLLECTION).length, 0);
});

test('7e. a conflicting late event stores only references, codes and amounts, and its redelivery is not counted twice', async () => {
  const db = harness.db;
  const intent = await startCheckout(db);
  assert.equal((await deliver(chargeSuccess(intent))).status, 200);
  const before = verifiedState(db);

  const raw = Buffer.from(JSON.stringify(chargeSuccess(intent, { amount: 500000, currency: 'usd' })));
  for (let i = 0; i < 3; i += 1) {
    const res = await deliver(null, { raw, signature: sign(raw) });
    assert.equal(res.status, 200);
    assert.equal(lastLog().code, 'late_conflicting_event');
  }
  assert.equal(verifiedState(db), before);

  const [row] = db.rows(COLLECTIONS.exceptions);
  assert.equal(db.rows(COLLECTIONS.exceptions).length, 1);
  assert.equal(row.occurrences, 1, 'identical redeliveries are replays');
  assert.equal(row.reference, intent.reference);
  assert.equal(row.source, 'webhook');
  assert.equal(row.userId, STUDENT);
  assert.equal(row.courseId, COURSE);
  assert.equal(row.amountKobo, 500000);
  assert.equal(row.currency, 'USD');
  assert.equal(row.providerStatus, 'success');
  assert.deepEqual(row.evidence, { conflicts: ['amount', 'currency'], recordedAmountKobo: 1000000, recordedCurrency: 'NGN', recordedStatus: 'success' });
  assert.equal(JSON.stringify(row).includes(CUSTOMER_EMAIL), false, 'no customer email is stored');
  assert.equal(JSON.stringify(row).includes('customer'), false);

  const ledger = require('../lib/admin-purchase-ledger');
  assert.equal(ledger.EXCEPTION_REASON_LABELS.late_conflicting_event, 'Later webhook event conflicts with the verified payment');
});

test('7f. a matching late redelivery records nothing; a reopened conflict after review is reopened, not duplicated', async () => {
  const db = harness.db;
  const intent = await startCheckout(db);
  const event = chargeSuccess(intent);
  assert.equal((await deliver(event)).status, 200);
  assert.equal((await deliver({ ...event, data: { ...event.data, currency: 'ngn' } })).status, 200);
  assert.equal(lastLog().code, 'already_processed', 'a lowercase currency code is not a conflict');
  assert.equal(db.rows(COLLECTIONS.exceptions).length, 0);

  assert.equal((await deliver(chargeSuccess(intent, { amount: 1 }))).status, 200);
  const [row] = db.rows(COLLECTIONS.exceptions);
  row.review = { status: 'resolved', outcome: 'other', notes: 'checked', updatedAt: NOW, updatedBy: { userId: 'admin_1', email: null } };
  row.resolved = true;

  assert.equal((await deliver(chargeSuccess(intent, { amount: 2 }))).status, 200);
  assert.equal(db.rows(COLLECTIONS.exceptions).length, 1);
  assert.equal(row.review.status, 'open');
  assert.equal(row.reopenCount, 1);
  assert.equal(await payment.hasCourseEntitlement(db, STUDENT, COURSE), true);
});

test('7g. a conflicting late event on a complimentary-grant duplicate keeps the grant untouched', async () => {
  const db = harness.db;
  const intent = await startCheckout(db);
  await db.collection(COLLECTIONS.courseAccess).insertOne({ userId: STUDENT, courseId: COURSE, entitlementType: 'manual_grant', grantedBy: 'admin_1', createdAt: NOW });
  assert.equal((await deliver(chargeSuccess(intent))).status, 200);
  assert.equal(lastLog().code, 'duplicate_payment');
  const grant = JSON.stringify(db.rows(COLLECTIONS.courseAccess));

  assert.equal((await deliver(chargeSuccess(intent, { currency: 'GHS' }))).status, 200);
  assert.equal(lastLog().code, 'late_conflicting_event');
  assert.equal(JSON.stringify(db.rows(COLLECTIONS.courseAccess)), grant);
  assert.equal(db.rows(COLLECTIONS.payments).length, 1);
  assert.equal(db.rows(COLLECTIONS.payments)[0].entitlementApplied, false);
  assert.deepEqual(db.rows(COLLECTIONS.exceptions).map((e) => e.reason).sort(), ['duplicate_payment', 'late_conflicting_event']);
});

test('7h. a storage failure while recording a late conflict returns 500 so Paystack retries', async () => {
  const db = harness.db;
  const intent = await startCheckout(db);
  assert.equal((await deliver(chargeSuccess(intent))).status, 200);
  const before = verifiedState(db);
  db.failWhen = (name) => name === COLLECTIONS.exceptions;
  const res = await deliver(chargeSuccess(intent, { amount: 7 }));
  assert.equal(res.status, 500);
  assert.equal(lastLog().code, 'processing_failed');
  assert.equal(verifiedState(db), before);
});

test('8. in production a test secret key disables the webhook before the body or database is touched', async () => {
  const db = harness.db;
  const intent = await startCheckout(db);
  const before = db.snapshot();
  process.env.NODE_ENV = 'production';
  try {
    const res = await deliver(chargeSuccess(intent));
    assert.equal(res.status, 503);
    assert.deepEqual(res.body, { message: 'Webhook not configured' });
    assert.equal(lastLog().code, 'test_key_in_production');
  } finally {
    delete process.env.NODE_ENV;
  }
  assert.equal(harness.getDbCalls, 0);
  assert.equal(db.snapshot(), before);

  const res = await deliver(chargeSuccess(intent));
  assert.equal(res.status, 200, 'the same test key still works outside production');
  assert.equal(lastLog().code, 'granted');
});

test('7b. refund and dispute events after a verified payment are recorded and leave access unchanged', async () => {
  const db = harness.db;
  const intent = await startCheckout(db);
  assert.equal((await deliver(chargeSuccess(intent))).status, 200);
  const access = JSON.stringify(db.rows(COLLECTIONS.courseAccess));
  const purchases = JSON.stringify(db.rows(COLLECTIONS.coursePurchases));
  const payments = JSON.stringify(db.rows(COLLECTIONS.payments));

  for (const [i, event] of ['refund.processed', 'charge.dispute.create', 'charge.dispute.resolve'].entries()) {
    const res = await deliver({ event, data: { id: 99000 + i, transaction_reference: intent.reference, amount: 1000000, currency: 'NGN' } });
    assert.equal(res.status, 200, event);
    assert.equal(lastLog().code, 'recorded_for_review', event);
  }
  assert.equal(JSON.stringify(db.rows(COLLECTIONS.courseAccess)), access);
  assert.equal(JSON.stringify(db.rows(COLLECTIONS.coursePurchases)), purchases);
  assert.equal(JSON.stringify(db.rows(COLLECTIONS.payments)), payments);
  assert.equal(await payment.hasCourseEntitlement(db, STUDENT, COURSE), true);
  assert.deepEqual(db.rows(COLLECTIONS.exceptions).map((row) => row.reason).sort(), ['dispute_unhandled', 'refund_unhandled']);
});

test('7c. a delayed charge on a superseded checkout is held for review and grants nothing', async () => {
  const db = harness.db;
  const intent = await startCheckout(db);
  await db.collection(COLLECTIONS.intents).updateOne({ _id: intent._id }, { $set: { status: 'superseded', closedAt: NOW } });

  const res = await deliver(chargeSuccess(intent));
  assert.equal(res.status, 200);
  assert.equal(lastLog().code, 'needs_review');
  assert.equal(await payment.hasCourseEntitlement(db, STUDENT, COURSE), false);
  assert.equal(await intentStatus(db, intent), 'held');
  const [row] = db.rows(COLLECTIONS.payments);
  assert.equal(row.entitlementApplied, false);
  assert.equal(row.heldReason, 'superseded_intent_paid');
  assert.equal(db.rows(COLLECTIONS.courseAccess).length, 0);
});

test('7d. a delayed charge for a course already held by a complimentary grant keeps the grant and is recorded as a duplicate', async () => {
  const db = harness.db;
  const intent = await startCheckout(db);
  await db.collection(COLLECTIONS.courseAccess).insertOne({ userId: STUDENT, courseId: COURSE, entitlementType: 'complimentary', grantedBy: 'admin_1', createdAt: NOW });
  const grant = JSON.stringify(db.rows(COLLECTIONS.courseAccess));

  const res = await deliver(chargeSuccess(intent));
  assert.equal(res.status, 200);
  assert.equal(lastLog().code, 'duplicate_payment');
  assert.equal(JSON.stringify(db.rows(COLLECTIONS.courseAccess)), grant, 'the complimentary grant is not overwritten');
  assert.equal(db.rows(COLLECTIONS.payments)[0].entitlementApplied, false);
  assert.equal(db.rows(COLLECTIONS.exceptions)[0].reason, 'duplicate_payment');

  const replay = await deliver(chargeSuccess(intent));
  assert.equal(replay.status, 200);
  assert.equal(db.rows(COLLECTIONS.payments).length, 1);
  assert.equal(db.rows(COLLECTIONS.exceptions).length, 1);
});

test('source contract: the harness runs the route file as written, with no signature bypass', () => {
  const source = fs.readFileSync(ROUTE, 'utf8');
  assert.equal(typeof handler, 'function');
  assert.equal(route.config.api.bodyParser, false);
  assert.match(source, /verifyWebhookSignature\(rawBody, process\.env\.PAYSTACK_SECRET_KEY/);
  assert.equal(/NODE_ENV|SKIP_SIGNATURE|bypass\s*=/.test(source.replace(/There is no bypass[^\n]*/, '')), false);
});
