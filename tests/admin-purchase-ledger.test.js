/**
 * Super Admin purchase ledger: behavioral tests against an in-memory collection double and a
 * mocked Paystack lookup, plus source-contract checks on the API routes. No database or network.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ObjectId } = require('mongodb');
const ledger = require('../lib/admin-purchase-ledger');

// ---------------------------------------------------------------------------
// In-memory collection double
// ---------------------------------------------------------------------------

const keyOf = (v) => (v && typeof v.toHexString === 'function' ? `oid:${v.toHexString()}` : v instanceof Date ? `date:${v.getTime()}` : JSON.stringify(v));
const getPath = (doc, p) => p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), doc);
const same = (a, b) => keyOf(a) === keyOf(b);

function clone(value) {
  if (value instanceof ObjectId) return value;
  if (value instanceof Date) return new Date(value.getTime());
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)]));
  return value;
}

function matchValue(actual, cond) {
  if (cond instanceof RegExp) return typeof actual === 'string' && cond.test(actual);
  if (cond && typeof cond === 'object' && !(cond instanceof Date) && typeof cond.toHexString !== 'function' && Object.keys(cond).some((k) => k.startsWith('$'))) {
    return Object.entries(cond).every(([op, v]) => {
      if (op === '$in') return v.some((x) => (x instanceof RegExp ? matchValue(actual, x) : same(actual, x)));
      if (op === '$ne') return !same(actual, v);
      if (op === '$exists') return (actual !== undefined) === Boolean(v);
      throw new Error(`unsupported operator ${op}`);
    });
  }
  return same(actual, cond);
}

function matches(doc, filter) {
  return Object.entries(filter || {}).every(([k, cond]) => {
    if (k === '$or') return cond.some((f) => matches(doc, f));
    if (k === '$and') return cond.every((f) => matches(doc, f));
    return matchValue(getPath(doc, k), cond);
  });
}

class Cursor {
  constructor(rows) { this.rows = rows; }
  sort(spec) {
    const [[field, dir]] = Object.entries(spec);
    this.rows = [...this.rows].sort((a, b) => {
      const x = getPath(a, field); const y = getPath(b, field);
      const xv = x instanceof Date ? x.getTime() : x ?? 0; const yv = y instanceof Date ? y.getTime() : y ?? 0;
      return xv < yv ? -dir : xv > yv ? dir : 0;
    });
    return this;
  }
  skip(n) { this.rows = this.rows.slice(n); return this; }
  limit(n) { this.rows = this.rows.slice(0, n); return this; }
  project() { return this; }
  async toArray() { return this.rows.map(clone); }
}

class MemoryCollection {
  constructor(name, rows = []) { this.name = name; this.rows = rows.map((r) => ({ _id: new ObjectId(), ...r })); this.writes = []; }
  find(filter) { return new Cursor(this.rows.filter((r) => matches(r, filter))); }
  async findOne(filter) { const r = this.rows.find((x) => matches(x, filter)); return r ? clone(r) : null; }
  async countDocuments(filter) { return this.rows.filter((r) => matches(r, filter)).length; }
  async insertOne(doc) {
    this.writes.push(['insertOne', doc]);
    if (doc._id && this.rows.some((r) => same(r._id, doc._id))) throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
    const row = { _id: new ObjectId(), ...clone(doc) };
    this.rows.push(row);
    return { insertedId: row._id };
  }
  async updateOne(filter, update) {
    this.writes.push(['updateOne', filter, update]);
    const row = this.rows.find((r) => matches(r, filter));
    if (!row) return { matchedCount: 0, modifiedCount: 0 };
    Object.assign(row, clone(update.$set || {}));
    for (const [k, v] of Object.entries(update.$push || {})) row[k] = [...(row[k] || []), clone(v)];
    for (const [k, v] of Object.entries(update.$pull || {})) row[k] = (row[k] || []).filter((x) => !same(x, v));
    for (const [k, v] of Object.entries(update.$inc || {})) row[k] = (row[k] || 0) + v;
    return { matchedCount: 1, modifiedCount: 1 };
  }
}

function memoryDb(seed) {
  const cols = new Map();
  return {
    collection(name) {
      if (!cols.has(name)) cols.set(name, new MemoryCollection(name, (seed && seed[name]) || []));
      return cols.get(name);
    },
    cols,
  };
}

/** Every write the ledger made, by collection. */
function writesBy(db) {
  const out = {};
  for (const [name, col] of db.cols) if (col.writes.length) out[name] = col.writes.length;
  return out;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const STUDENT = new ObjectId();
const STUDENT2 = new ObjectId();
const STUDENT3 = new ObjectId();
const COURSE = new ObjectId();
const COURSE2 = new ObjectId();
const S = STUDENT.toHexString();
const S2 = STUDENT2.toHexString();
const S3 = STUDENT3.toHexString();
const C = COURSE.toHexString();
const C2 = COURSE2.toHexString();
const ADMIN = { userId: new ObjectId().toHexString(), email: 'owner@forexorbit.test', role: 'superadmin' };
const day = (n) => new Date(Date.UTC(2026, 9, n));

function seed() {
  return {
    users: [
      { _id: STUDENT, name: 'Ada Student', email: 'ada@student.test', role: 'student' },
      { _id: STUDENT2, name: 'Bola Backfill', email: 'bola@student.test', role: 'student' },
      { _id: STUDENT3, name: 'Chi Grant', email: 'chi@student.test', role: 'student' },
    ],
    courses: [{ _id: COURSE, title: 'Forex Basics' }, { _id: COURSE2, title: 'Risk Management' }],
    userCourseAccess: [
      { userId: S, courseId: C, paid: true, entitlementType: 'paid_course', paystackReference: 'fo_c_verified_1', amountKobo: 1000000, currency: 'NGN', source: 'paystack-checkout', verifiedAt: day(10), createdAt: day(10) },
      { userId: S2, courseId: C, paid: true, paystackReference: 'fo_backfill_ref_1', amountKobo: 500000, currency: 'NGN', source: 'paystack-paystack-backfill', verifiedAt: day(2), createdAt: day(2) },
      { userId: S3, courseId: C2, entitlementType: 'manual_grant', source: 'admin', createdAt: day(5) },
      { userId: S3, courseId: C, paid: true, paystackReference: 'fo_legacy_ref_9', amountKobo: 500000, currency: 'NGN', source: 'paystack-verify-api', verifiedAt: day(3), createdAt: day(3) },
    ],
    coursePurchases: [
      { userId: S, courseId: C, status: 'paid', paymentReference: 'fo_c_verified_1', amountKobo: 1000000, currency: 'NGN', createdAt: day(10) },
      { userId: S2, courseId: C, status: 'paid', paymentReference: 'fo_backfill_ref_1', amountKobo: 500000, currency: 'NGN', createdAt: day(2) },
    ],
    paystackPayments: [
      { reference: 'fo_c_verified_1', userId: S, courseId: C, kind: 'course', status: 'success', amountKobo: 1000000, currency: 'NGN', source: 'checkout', paidAt: day(10), createdAt: day(10) },
      { reference: 'fo_backfill_ref_1', userId: S2, courseId: C, kind: 'course', status: 'success', amountKobo: 500000, currency: 'NGN', source: 'paystack-backfill', paystackCustomerEmail: 'bola@student.test', metadata: { userId: STUDENT2, courseId: COURSE }, createdAt: day(2) },
      { reference: 'fo_legacy_ref_9', userId: S3, courseId: C, kind: 'course', status: 'success', amountKobo: 500000, currency: 'NGN', paystackCustomerEmail: 'parent@payer.test', createdAt: day(3) },
      { reference: 'fo_c_orphan_7', userId: S2, courseId: C2, kind: 'course', status: 'success', amountKobo: 1000000, currency: 'NGN', source: 'webhook', createdAt: day(12) },
    ],
    paystackPaymentIntents: [
      { reference: 'fo_c_verified_1', userId: S, courseId: C, kind: 'course', amountKobo: 1000000, currency: 'NGN', status: 'paid', createdAt: day(10) },
    ],
    paymentExceptions: [
      { reference: 'fo_c_orphan_7', reason: 'no_matching_intent', source: 'webhook', amountKobo: 1000000, currency: 'NGN', providerStatus: 'success', resolved: false, occurrences: 2, createdAt: day(12), lastSeenAt: day(13) },
      { reference: 'fo_legacy_ref_9', reason: 'refund_unhandled', source: 'webhook', amountKobo: 500000, currency: 'NGN', resolved: false, occurrences: 1, createdAt: day(14), lastSeenAt: day(14) },
    ],
  };
}

async function recordFor(db, predicate) {
  const { items } = await ledger.listPurchases(db, { pageSize: '50' });
  return items.find(predicate);
}

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

test('only a super admin may use the ledger', () => {
  assert.equal(ledger.authorizeLedgerAccess({ role: 'superadmin' }), true);
  for (const role of ['admin', 'instructor', 'student', '', undefined]) {
    assert.equal(ledger.authorizeLedgerAccess({ role }), false, String(role));
  }
  assert.equal(ledger.authorizeLedgerAccess(null), false);
});

const ROUTES = [
  'pages/api/admin/purchases/index.ts',
  'pages/api/admin/purchases/[id]/index.ts',
  'pages/api/admin/purchases/[id]/verify.ts',
  'pages/api/admin/payment-exceptions/index.ts',
  'pages/api/admin/payment-exceptions/[id].ts',
  'pages/api/admin/audit-log.ts',
];

test('source contract: every ledger API route requires super admin in the wrapper and the handler', () => {
  for (const route of ROUTES) {
    const source = fs.readFileSync(path.join(__dirname, '..', route), 'utf8');
    assert.match(source, /export default withAuth\(handler, \['superadmin'\]\);/, route);
    assert.match(source, /if \(!superAdminOnly\(req, res\)\) return;/, route);
    assert.equal(source.includes("'admin'"), false, route);
  }
  const guard = fs.readFileSync(path.join(__dirname, '../lib/admin-ledger-route.ts'), 'utf8');
  assert.match(guard, /authorizeLedgerAccess\(req\.user\)/);
  assert.match(guard, /no-store/);
});

test('source contract: ledger routes and service never grant, revoke, charge, or refund', () => {
  const sources = [...ROUTES, 'lib/admin-purchase-ledger.js', 'lib/admin-ledger-route.ts']
    .map((f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8'))
    .join('\n');
  for (const forbidden of [
    'grantCourseEntitlement', 'confirmCoursePayment', 'createCourseIntent', 'processWebhookEvent',
    'transaction/initialize', '/refund', 'deleteOne', 'deleteMany', 'updateMany', 'replaceOne', 'createIndex',
    'PAYSTACK_SECRET_KEY',
  ]) {
    assert.equal(sources.includes(forbidden), false, forbidden);
  }
  const verify = fs.readFileSync(path.join(__dirname, '../pages/api/admin/purchases/[id]/verify.ts'), 'utf8');
  assert.match(verify, /decidePaymentEnvironment\(process\.env\)/);
  assert.match(verify, /lookupPaystackTransaction/);
});

// ---------------------------------------------------------------------------
// Classification and ledger content
// ---------------------------------------------------------------------------

test('only a linked successful payment for the same student and course counts as verified', () => {
  const access = { userId: S, courseId: C, paid: true };
  assert.equal(ledger.classifySource(access, { status: 'success', userId: S, courseId: C }), 'verified_paystack');
  assert.equal(ledger.classifySource(access, null), 'unverified_record');
  assert.equal(ledger.classifySource(access, { status: 'failed', userId: S, courseId: C }), 'unverified_record');
  assert.equal(ledger.classifySource(access, { status: 'success', userId: S2, courseId: C }), 'unverified_record');
  assert.equal(ledger.classifySource({ ...access, source: 'paystack-paystack-backfill' }, { status: 'success', userId: S, courseId: C }), 'historical_backfill');
  assert.equal(ledger.classifySource({ userId: S, courseId: C, entitlementType: 'complimentary' }, null), 'complimentary_grant');
  assert.equal(ledger.classifySource({ userId: S, courseId: C, entitlementType: 'manual_grant', paid: true }, null), 'manual_grant');
  assert.equal(ledger.classifySource({ userId: S, courseId: C }, null), 'no_entitlement');
});

test('the ledger lists every entitlement and every successful payment with no access', async () => {
  const db = memoryDb(seed());
  const result = await ledger.listPurchases(db, {});
  assert.equal(result.total, 5);
  const sources = result.items.map((r) => r.source).sort();
  assert.deepEqual(sources, ['historical_backfill', 'manual_grant', 'payment_without_access', 'verified_paystack', 'verified_paystack'].sort());
  assert.equal(result.items[0].paystackReference, 'fo_c_orphan_7', 'newest first');
});

test('a verified checkout shows student, course, amount, both references, and the verification time', async () => {
  const db = memoryDb(seed());
  const r = await recordFor(db, (x) => x.paystackReference === 'fo_c_verified_1');
  assert.equal(r.source, 'verified_paystack');
  assert.equal(r.student.name, 'Ada Student');
  assert.equal(r.student.email, 'ada@student.test');
  assert.equal(r.student.userId, S);
  assert.equal(r.course.title, 'Forex Basics');
  assert.equal(r.amountKobo, 1000000);
  assert.equal(r.currency, 'NGN');
  assert.equal(r.checkoutReference, 'fo_c_verified_1');
  assert.equal(r.verification.basis, 'checkout_intent');
  assert.equal(r.verification.at, day(10).toISOString());
  assert.equal(r.payer.status, 'not_recorded');
  assert.equal(r.payer.email, null);
  assert.equal(r.needsReview, false);
});

test('the payer is kept separate from the student, and a different payer email is a warning only', async () => {
  const db = memoryDb(seed());
  const r = await recordFor(db, (x) => x.paystackReference === 'fo_legacy_ref_9');
  assert.equal(r.student.email, 'chi@student.test');
  assert.equal(r.payer.email, 'parent@payer.test');
  assert.equal(r.payer.status, 'recorded_at_verification');
  assert.equal(r.source, 'verified_paystack');
  assert.equal(r.verification.basis, 'legacy_server_verification');
  const w = r.warnings.find((x) => x.code === 'payer_email_differs');
  assert.equal(w.severity, 'warning');
  assert.match(w.message, /not proof/);
});

test('a backfill record is flagged, is never verified, and does not show the copied email as the payer', async () => {
  const db = memoryDb(seed());
  const r = await recordFor(db, (x) => x.paystackReference === 'fo_backfill_ref_1');
  assert.equal(r.source, 'historical_backfill');
  assert.equal(r.sourceLabel, 'Historical / backfill record');
  assert.equal(r.verification.basis, 'none_backfill');
  assert.equal(r.verification.at, null);
  assert.equal(r.payer.email, null);
  assert.equal(r.payer.status, 'copied_from_student');
  assert.ok(r.warnings.some((w) => w.code === 'historical_backfill' && /cannot be independently established/.test(w.message)));
  assert.equal(r.needsReview, true);
  assert.equal(r.accessStatus, 'active', 'access is shown as it is, not revoked');
});

test('manual grants are distinct from purchases and marked as administrative', async () => {
  const db = memoryDb(seed());
  const r = await recordFor(db, (x) => x.source === 'manual_grant');
  assert.equal(r.paystackReference, null);
  assert.equal(r.amountKobo, null, 'no amount is invented');
  assert.equal(r.verification.basis, 'none');
  assert.ok(r.warnings.some((w) => w.code === 'administrative_grant' && w.severity === 'info'));
  assert.equal(r.needsReview, false);
});

test('a successful payment with no access is critical and carries its exception', async () => {
  const db = memoryDb(seed());
  const r = await recordFor(db, (x) => x.paystackReference === 'fo_c_orphan_7');
  assert.equal(r.kind, 'payment');
  assert.equal(r.source, 'payment_without_access');
  assert.equal(r.accessStatus, 'none');
  assert.equal(r.openExceptions, 1);
  assert.ok(r.warnings.some((w) => w.code === 'payment_without_access' && w.severity === 'critical'));
  assert.ok(r.warnings.some((w) => w.code === 'open_exception'));
});

test('a second successful payment for a student who already has access is shown as unlinked', async () => {
  const data = seed();
  data.paystackPayments.push({ reference: 'fo_c_second_2', userId: S, courseId: C, kind: 'course', status: 'success', amountKobo: 1000000, currency: 'NGN', createdAt: day(11) });
  const db = memoryDb(data);
  const r = await recordFor(db, (x) => x.paystackReference === 'fo_c_second_2');
  assert.equal(r.source, 'unlinked_payment');
  assert.ok(r.warnings.some((w) => w.code === 'unlinked_payment'));
});

test('refund events and local amount disagreements are surfaced', async () => {
  const data = seed();
  data.coursePurchases.push({ userId: S3, courseId: C, status: 'paid', paymentReference: 'fo_legacy_ref_9', amountKobo: 300000, currency: 'NGN' });
  const db = memoryDb(data);
  const r = await recordFor(db, (x) => x.paystackReference === 'fo_legacy_ref_9');
  assert.equal(r.refundDispute, 'refund_recorded');
  assert.ok(r.warnings.some((w) => w.code === 'refund_or_dispute'));
  assert.ok(r.warnings.some((w) => w.code === 'local_amount_disagreement'));
});

test('a paid flag with no linked payment requires review', async () => {
  const data = seed();
  data.userCourseAccess.push({ userId: S, courseId: C2, paid: true, createdAt: day(20) });
  const db = memoryDb(data);
  const r = await recordFor(db, (x) => x.course.courseId === C2 && x.student.userId === S);
  assert.equal(r.source, 'unverified_record');
  assert.equal(r.paystackReference, null);
  assert.ok(r.warnings.some((w) => w.code === 'no_provider_verification'));
});

// ---------------------------------------------------------------------------
// Filtering and pagination
// ---------------------------------------------------------------------------

test('filters by source, course, access state, and review need on the server', async () => {
  const db = memoryDb(seed());
  assert.deepEqual((await ledger.listPurchases(db, { source: 'historical_backfill' })).items.map((r) => r.paystackReference), ['fo_backfill_ref_1']);
  assert.equal((await ledger.listPurchases(db, { courseId: C2 })).total, 2);
  assert.equal((await ledger.listPurchases(db, { access: 'inactive' })).total, 1);
  const review = await ledger.listPurchases(db, { review: 'needs_review' });
  assert.deepEqual(review.items.map((r) => r.source).sort(), ['historical_backfill', 'payment_without_access', 'verified_paystack'].sort());
  const ignored = await ledger.listPurchases(db, { source: 'not_a_source', courseId: 'nope', access: 'x' });
  assert.equal(ignored.total, 5, 'unknown filter values are ignored, not passed to the database');
});

test('search matches student email or name, course title, reference, and IDs', async () => {
  const db = memoryDb(seed());
  assert.equal((await ledger.listPurchases(db, { q: 'ada@student' })).total, 1);
  assert.equal((await ledger.listPurchases(db, { q: 'chi grant' })).total, 2);
  assert.equal((await ledger.listPurchases(db, { q: 'Risk' })).total, 2);
  assert.equal((await ledger.listPurchases(db, { q: 'fo_backfill_ref_1' })).total, 1);
  assert.equal((await ledger.listPurchases(db, { q: S2 })).total, 2);
  assert.equal((await ledger.listPurchases(db, { q: '.*' })).total, 0, 'regex characters are escaped');
});

test('pages are bounded and report totals', async () => {
  const db = memoryDb(seed());
  const first = await ledger.listPurchases(db, { pageSize: '2', page: '1' });
  const third = await ledger.listPurchases(db, { pageSize: '2', page: '3' });
  assert.equal(first.items.length, 2);
  assert.equal(first.totalPages, 3);
  assert.equal(third.items.length, 1);
  const ids = new Set([...first.items, ...(await ledger.listPurchases(db, { pageSize: '2', page: '2' })).items, ...third.items].map((r) => r.id));
  assert.equal(ids.size, 5);
  assert.equal((await ledger.listPurchases(db, { pageSize: '5000' })).pageSize, ledger.MAX_PAGE_SIZE);
  assert.equal((await ledger.listPurchases(db, { page: '-4' })).page, 1);
});

// ---------------------------------------------------------------------------
// Detail and provider comparison
// ---------------------------------------------------------------------------

test('detail shows linked records, labels stored metadata as local, and omits stored customer email', async () => {
  const db = memoryDb(seed());
  const r = await recordFor(db, (x) => x.paystackReference === 'fo_backfill_ref_1');
  const detail = await ledger.getPurchaseDetail(db, r.id);
  assert.equal(detail.linked.access.source, 'paystack-paystack-backfill');
  assert.equal(detail.linked.payment.source, 'paystack-backfill');
  assert.deepEqual(detail.linked.payment.storedMetadata, { userId: S2, courseId: C });
  assert.match(detail.notes.storedMetadata, /not received from Paystack/);
  assert.match(detail.notes.verifiedAt, /not a provider verification/);
  assert.equal(JSON.stringify(detail.linked).includes('bola@student.test'), false);
  assert.equal(await ledger.getPurchaseDetail(db, 'a_' + new ObjectId().toHexString()), null);
  assert.equal(await ledger.getPurchaseDetail(db, 'bogus'), null);
});

test('a linked payment id redirects to its access record', async () => {
  const db = memoryDb(seed());
  const payment = await db.collection('paystackPayments').findOne({ reference: 'fo_c_verified_1' });
  const detail = await ledger.getPurchaseDetail(db, `p_${payment._id.toHexString()}`);
  assert.match(detail.redirectTo, /^a_/);
});

test('provider comparison flags a conflicting course, missing user, and a different payer, matching the backfill case', async () => {
  const db = memoryDb(seed());
  const r = await recordFor(db, (x) => x.paystackReference === 'fo_backfill_ref_1');
  const result = ledger.compareWithProvider(r, {
    outcome: 'found',
    data: { status: 'success', reference: 'fo_backfill_ref_1', amount: 500000, currency: 'NGN', domain: 'live', metadata: { courseId: C2 }, customer: { email: 'someone@else.test' } },
  });
  const codes = result.warnings.map((w) => w.code);
  assert.deepEqual(codes.sort(), ['payer_email_differs', 'provider_course_conflict', 'provider_user_missing'].sort());
  assert.equal(result.provider.amountKobo, 500000);
  assert.equal(result.provider.payerEmail, 'someone@else.test');
});

test('provider comparison flags amount, currency, status, and reference mismatches, and not-found', async () => {
  const db = memoryDb(seed());
  const r = await recordFor(db, (x) => x.paystackReference === 'fo_c_verified_1');
  const result = ledger.compareWithProvider(r, {
    outcome: 'found',
    data: { status: 'reversed', reference: 'other', amount: 500000, currency: 'USD', metadata: JSON.stringify({ userId: S, courseId: C, lessonId: 'x' }) },
  });
  const codes = result.warnings.map((w) => w.code).sort();
  assert.deepEqual(codes, ['provider_amount_mismatch', 'provider_currency_mismatch', 'provider_lesson_metadata', 'provider_not_successful', 'provider_reference_mismatch'].sort());
  assert.equal(ledger.compareWithProvider(r, { outcome: 'not_found' }).warnings[0].code, 'provider_not_found');
  assert.equal(ledger.compareWithProvider(r, { outcome: 'uncertain', reason: 'timeout' }).outcome, 'unavailable');
  const clean = ledger.compareWithProvider(r, { outcome: 'found', data: { status: 'success', reference: 'fo_c_verified_1', amount: 1000000, currency: 'NGN', metadata: { userId: S, courseId: C }, customer: { email: 'ada@student.test' } } });
  assert.deepEqual(clean.warnings, []);
});

test('a provider check is read-only for payment data, audited by codes, and stores no payer email', async () => {
  const db = memoryDb(seed());
  const r = await recordFor(db, (x) => x.paystackReference === 'fo_backfill_ref_1');
  const calls = [];
  const out = await ledger.checkPurchaseWithProvider(db, r.id, {
    actor: ADMIN,
    now: day(27),
    fetchTransaction: async (ref) => { calls.push(ref); return { outcome: 'found', data: { status: 'success', reference: ref, amount: 500000, currency: 'NGN', metadata: { courseId: C2 }, customer: { email: 'someone@else.test' } } }; },
  });
  assert.equal(out.ok, true);
  assert.deepEqual(calls, ['fo_backfill_ref_1']);
  assert.deepEqual(writesBy(db), { adminAuditLog: 1 });
  const entry = db.collection('adminAuditLog').rows[0];
  assert.equal(entry.action, 'provider_check');
  assert.equal(entry.actor.userId, ADMIN.userId);
  assert.equal(JSON.stringify(entry).includes('someone@else.test'), false);
});

// ---------------------------------------------------------------------------
// Purchase notes, exceptions, and audit trail
// ---------------------------------------------------------------------------

test('a purchase note is audited and changes no purchase, payment, or access record', async () => {
  const db = memoryDb(seed());
  const r = await recordFor(db, (x) => x.paystackReference === 'fo_backfill_ref_1');
  assert.equal((await ledger.addPurchaseNote(db, r.id, { outcome: 'owner_confirmed', notes: 'x', reason: '' }, ADMIN)).status, 400);
  assert.equal((await ledger.addPurchaseNote(db, r.id, { outcome: 'grant_access', reason: 'checked' }, ADMIN)).status, 400);
  const ok = await ledger.addPurchaseNote(db, r.id, { outcome: 'wrong_student_or_course', notes: 'Paystack names another course.', reason: 'Dashboard comparison' }, ADMIN, day(27));
  assert.equal(ok.ok, true);
  assert.deepEqual(writesBy(db), { adminAuditLog: 1 });
  const detail = await ledger.getPurchaseDetail(db, r.id);
  assert.equal(detail.audit[0].action, 'review_note');
  assert.equal(detail.audit[0].actor.email, ADMIN.email);
  assert.deepEqual(detail.audit[0].after, { outcome: 'wrong_student_or_course', notes: 'Paystack names another course.' });
  assert.equal(detail.record.accessStatus, 'active');
});

test('exceptions are listed by status with their evidence', async () => {
  const db = memoryDb(seed());
  const open = await ledger.listExceptions(db, {});
  assert.equal(open.status, 'open');
  assert.equal(open.total, 2);
  assert.equal(open.items[0].reference, 'fo_legacy_ref_9', 'most recently seen first');
  const e = open.items.find((x) => x.reference === 'fo_c_orphan_7');
  assert.equal(e.reasonLabel, 'Successful charge with no checkout record');
  assert.equal(e.amountKobo, 1000000);
  assert.equal(e.occurrences, 2);
  assert.equal((await ledger.listExceptions(db, { reason: 'refund_unhandled' })).total, 1);
  assert.equal((await ledger.listExceptions(db, { q: 'fo_c_' })).total, 1);
  assert.equal((await ledger.listExceptions(db, { status: 'resolved' })).total, 0);
});

test('recording an exception outcome preserves evidence and keeps who changed what and why', async () => {
  const db = memoryDb(seed());
  const target = db.collection('paymentExceptions').rows.find((x) => x.reference === 'fo_c_orphan_7');
  const id = target._id.toHexString();
  const evidence = { reference: target.reference, reason: target.reason, amountKobo: target.amountKobo, currency: target.currency, providerStatus: target.providerStatus, createdAt: target.createdAt, occurrences: target.occurrences };

  assert.equal((await ledger.updateException(db, id, { status: 'resolved', outcome: 'owner_confirmed' }, ADMIN)).status, 400, 'reason required');
  assert.equal((await ledger.updateException(db, id, { status: 'closed', outcome: 'owner_confirmed', reason: 'ok then' }, ADMIN)).status, 400);
  assert.equal((await ledger.updateException(db, 'nope', { status: 'resolved', outcome: 'owner_confirmed', reason: 'ok then' }, ADMIN)).status, 404);

  const first = await ledger.updateException(db, id, { status: 'investigating', outcome: 'none', notes: 'Asked support.', reason: 'Started review' }, ADMIN, day(27));
  assert.equal(first.ok, true);
  const second = await ledger.updateException(db, id, { status: 'resolved', outcome: 'handled_outside_platform', notes: 'Refunded in dashboard by finance.', reason: 'Finance confirmed' }, ADMIN, day(28));
  assert.equal(second.exception.status, 'resolved');
  assert.equal(second.exception.history.length, 2);
  assert.deepEqual(second.exception.history[1].before, { status: 'investigating', outcome: 'none', notes: 'Asked support.' });
  assert.equal(second.exception.reviewedBy.email, ADMIN.email);

  const stored = db.collection('paymentExceptions').rows.find((x) => x.reference === 'fo_c_orphan_7');
  for (const [k, v] of Object.entries(evidence)) assert.deepEqual(stored[k], v, k);

  const audit = await ledger.listAudit(db, { entityType: 'payment_exception' });
  assert.equal(audit.total, 2);
  assert.equal(audit.items[0].reason, 'Finance confirmed');
  assert.deepEqual(audit.items[0].before.status, 'investigating');
  assert.deepEqual(audit.items[0].after.status, 'resolved');
  assert.equal(audit.items[0].actor.userId, ADMIN.userId);

  assert.equal((await ledger.listExceptions(db, { status: 'resolved' })).total, 1);
  assert.equal((await ledger.listExceptions(db, {})).total, 1);
  assert.deepEqual(writesBy(db), { paymentExceptions: 4, adminAuditLog: 2 }, 'each review: one guarded update, one audit insert, one pending-id clear');
  assert.deepEqual(stored.pendingAuditIds, []);
  assert.deepEqual(
    stored.reviewHistory.map((h) => String(h.auditId)),
    db.collection('adminAuditLog').rows.map((a) => String(a._id)),
    'each history entry names the audit entry written for it'
  );
});

test('an unchanged review is rejected and a stale concurrent review is refused', async () => {
  const db = memoryDb(seed());
  const target = db.collection('paymentExceptions').rows[0];
  const id = target._id.toHexString();
  await ledger.updateException(db, id, { status: 'investigating', outcome: 'none', reason: 'first look' }, ADMIN);
  assert.equal((await ledger.updateException(db, id, { status: 'investigating', outcome: 'none', reason: 'again' }, ADMIN)).status, 400);
  const col = db.collection('paymentExceptions');
  const realFindOne = col.findOne.bind(col);
  col.findOne = async (filter) => {
    const doc = await realFindOne(filter);
    if (doc) doc.reviewVersion = 0;
    return doc;
  };
  const stale = await ledger.updateException(db, id, { status: 'resolved', outcome: 'other', reason: 'late writer' }, ADMIN);
  assert.equal(stale.status, 409);
});

test('no ledger operation writes to access, purchase, payment, or checkout collections', async () => {
  const db = memoryDb(seed());
  await ledger.listPurchases(db, {});
  await ledger.listPurchases(db, { q: 'ada', source: 'verified_paystack' });
  const r = await recordFor(db, (x) => x.paystackReference === 'fo_c_orphan_7');
  await ledger.getPurchaseDetail(db, r.id);
  await ledger.addPurchaseNote(db, r.id, { outcome: 'other', reason: 'looked at it' }, ADMIN);
  await ledger.checkPurchaseWithProvider(db, r.id, { actor: ADMIN, fetchTransaction: async () => ({ outcome: 'not_found' }) });
  const ex = db.collection('paymentExceptions').rows[0]._id.toHexString();
  await ledger.updateException(db, ex, { status: 'dismissed', outcome: 'duplicate_or_test_payment', reason: 'test charge' }, ADMIN);
  await ledger.listExceptions(db, { status: 'all' });
  await ledger.listAudit(db, {});
  const writes = writesBy(db);
  for (const name of ['userCourseAccess', 'coursePurchases', 'paystackPayments', 'paystackPaymentIntents', 'users', 'courses', 'userLessonAccess', 'lessonPurchases']) {
    assert.equal(writes[name], undefined, name);
  }
  assert.deepEqual(writes, { adminAuditLog: 3, paymentExceptions: 2 });
});

// ---------------------------------------------------------------------------
// D6: review and audit stay consistent
// ---------------------------------------------------------------------------

function failAuditInserts(db, times = 1) {
  const col = db.collection('adminAuditLog');
  const real = col.insertOne.bind(col);
  let left = times;
  col.insertOne = async (doc) => {
    if (left > 0) { left -= 1; throw new Error('audit store unavailable'); }
    return real(doc);
  };
}

test('if the audit entry cannot be written, the review is not reported as a silent success and is repaired later', async () => {
  const db = memoryDb(seed());
  const target = db.collection('paymentExceptions').rows.find((x) => x.reference === 'fo_c_orphan_7');
  const id = target._id.toHexString();
  failAuditInserts(db);

  const result = await ledger.updateException(db, id, { status: 'resolved', outcome: 'owner_confirmed', reason: 'Checked dashboard' }, ADMIN, day(27));
  assert.equal(result.ok, false);
  assert.equal(result.status, 500);
  assert.equal(result.reviewSaved, true);
  assert.match(result.message, /saved, but its audit entry could not be written/);
  assert.equal(result.exception.auditPending, true);

  const stored = db.collection('paymentExceptions').rows.find((x) => x._id === target._id);
  assert.equal(stored.review.status, 'resolved', 'the guarded review update itself succeeded');
  assert.equal(stored.pendingAuditIds.length, 1);
  assert.equal(String(stored.reviewHistory[0].auditId), String(stored.pendingAuditIds[0]));
  assert.equal(db.collection('adminAuditLog').rows.length, 0);

  const audit = await ledger.listAudit(db, { entityType: 'payment_exception' });
  assert.equal(audit.total, 1, 'listing the audit log writes the missing entry first');
  assert.equal(audit.items[0].id, String(stored.reviewHistory[0].auditId));
  assert.equal(audit.items[0].reason, 'Checked dashboard');
  assert.equal(audit.items[0].actor.userId, ADMIN.userId);
  assert.deepEqual(audit.items[0].after, { status: 'resolved', outcome: 'owner_confirmed', notes: '' });
  assert.deepEqual(stored.pendingAuditIds, []);

  assert.deepEqual(await ledger.repairPendingExceptionAudits(db), { repaired: 0 });
  await ledger.listExceptions(db, { status: 'all' });
  assert.equal(db.collection('adminAuditLog').rows.length, 1, 'repair never writes a second copy');
});

test('a repair that races the original audit insert does not duplicate the entry', async () => {
  const db = memoryDb(seed());
  const target = db.collection('paymentExceptions').rows[0];
  const auditId = new ObjectId();
  const entry = { at: day(20), actor: { userId: ADMIN.userId, email: ADMIN.email }, reason: 'raced', before: { status: 'open' }, after: { status: 'investigating' }, action: 'exception_review', auditId };
  target.reviewHistory = [entry];
  target.pendingAuditIds = [auditId];
  db.collection('adminAuditLog').rows.push({ _id: auditId, entityType: 'payment_exception', entityId: target._id.toHexString(), action: 'exception_review', reason: 'raced', createdAt: day(20) });

  assert.deepEqual(await ledger.repairPendingExceptionAudits(db), { repaired: 1 });
  assert.equal(db.collection('adminAuditLog').rows.length, 1);
  assert.deepEqual(target.pendingAuditIds, []);
});

test('a stale concurrent review still gets 409 and writes no audit entry', async () => {
  const db = memoryDb(seed());
  const target = db.collection('paymentExceptions').rows[0];
  const id = target._id.toHexString();
  await ledger.updateException(db, id, { status: 'investigating', outcome: 'none', reason: 'first look' }, ADMIN);
  const col = db.collection('paymentExceptions');
  const realFindOne = col.findOne.bind(col);
  col.findOne = async (filter) => {
    const doc = await realFindOne(filter);
    if (doc) doc.reviewVersion = 0;
    return doc;
  };
  const audits = db.collection('adminAuditLog').rows.length;
  const stale = await ledger.updateException(db, id, { status: 'resolved', outcome: 'other', reason: 'late writer' }, ADMIN);
  assert.equal(stale.status, 409);
  assert.equal(db.collection('adminAuditLog').rows.length, audits);
  assert.equal(target.review.status, 'investigating');
  assert.deepEqual(target.pendingAuditIds, []);
});

test('the exception route reports a saved review whose audit is pending as a failure, not success', () => {
  const route = fs.readFileSync(path.join(__dirname, '../pages/api/admin/payment-exceptions/[id].ts'), 'utf8');
  assert.match(route, /if \(!result\.ok\) \{/);
  assert.match(route, /reviewSaved: true/);
  assert.match(route, /return res\.status\(200\)\.json\(\{ exception: result\.exception \}\);/);
});

// ---------------------------------------------------------------------------
// D7: new exception reasons and reopened exceptions
// ---------------------------------------------------------------------------

test('duplicate and superseded payment exceptions have labels and reopened exceptions show as open', async () => {
  assert.equal(ledger.EXCEPTION_REASON_LABELS.duplicate_payment, 'Additional payment for a course the student already has');
  assert.equal(ledger.EXCEPTION_REASON_LABELS.superseded_intent_paid, 'Payment on a checkout that had been replaced');
  const db = memoryDb({
    paymentExceptions: [{
      reference: 'fo_c_dup_2', reason: 'duplicate_payment', resolved: false, occurrences: 3, createdAt: day(10), lastSeenAt: day(20),
      review: { status: 'open', outcome: 'owner_confirmed', notes: 'first time', updatedAt: day(20), updatedBy: { userId: 'system', email: null } },
      reviewVersion: 2,
      reviewHistory: [
        { at: day(11), actor: { userId: ADMIN.userId, email: ADMIN.email }, reason: 'Refunded by finance', before: { status: 'open' }, after: { status: 'resolved' }, auditId: new ObjectId() },
        { at: day(20), actor: { userId: 'system', email: null }, reason: 'The exception occurred again after it was closed.', before: { status: 'resolved' }, after: { status: 'open' }, action: 'exception_reopened', auditId: new ObjectId() },
      ],
      pendingAuditIds: [],
    }],
  });
  const open = await ledger.listExceptions(db, { reason: 'duplicate_payment' });
  assert.equal(open.total, 1);
  const e = open.items[0];
  assert.equal(e.status, 'open');
  assert.equal(e.occurrences, 3);
  assert.equal(e.reasonLabel, 'Additional payment for a course the student already has');
  assert.deepEqual(e.history.map((h) => h.action), ['exception_review', 'exception_reopened']);
});

// ---------------------------------------------------------------------------
// D8: truncated totals are never presented as complete
// ---------------------------------------------------------------------------

test('a ledger scan that hits the cap marks its total as a lower bound', async () => {
  const small = await ledger.listPurchases(memoryDb(seed()), {});
  assert.equal(small.truncated, false);
  assert.equal(small.totalIsLowerBound, false);
  assert.equal(small.scanCap, ledger.SCAN_CAP);

  const many = seed();
  for (let i = 0; i <= ledger.SCAN_CAP; i += 1) {
    many.userCourseAccess.push({ userId: S, courseId: new ObjectId().toHexString(), entitlementType: 'manual_grant', source: 'admin', createdAt: day(1) });
  }
  const big = await ledger.listPurchases(memoryDb(many), {});
  assert.equal(big.truncated, true);
  assert.equal(big.totalIsLowerBound, true);
});

test('source contract: the ledger UI shows truncation conspicuously and labels the total as a minimum', () => {
  const ui = fs.readFileSync(path.join(__dirname, '../pages/admin/purchases.tsx'), 'utf8');
  assert.match(ui, /Results are incomplete\./);
  assert.match(ui, /role="alert"/);
  assert.match(ui, /At least \{total\} records \(incomplete\)/);
  assert.match(ui, /lowerBound=\{Boolean\(data\.totalIsLowerBound \?\? data\.truncated\)\}/);
  assert.match(ui, /reviewSaved === true/);
});

// ---------------------------------------------------------------------------
// D9: the audit log is append-only at the application layer
// ---------------------------------------------------------------------------

function sourceFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.next', '.git', 'tests'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.(js|ts|tsx|cjs|mjs)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

test('source contract: no route, library, or script updates or deletes audit log entries', () => {
  const root = path.join(__dirname, '..');
  const files = ['lib', 'pages', 'scripts', 'server.js']
    .map((p) => path.join(root, p))
    .filter((p) => fs.existsSync(p))
    .flatMap((p) => (fs.statSync(p).isDirectory() ? sourceFiles(p) : [p]));
  const allowed = new Set(['insertOne', 'find', 'findOne', 'countDocuments']);
  const usage = /collection\(\s*(?:AUDIT_COLLECTION|['"`]adminAuditLog['"`])\s*\)\s*\.\s*(\w+)/g;
  const seen = [];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    for (const m of source.matchAll(usage)) {
      seen.push(m[1]);
      assert.ok(allowed.has(m[1]), `${path.relative(root, file)} calls ${m[1]} on the audit log`);
    }
    assert.equal(/adminAuditLog['"`]\s*\)\s*\.\s*(?:update|delete|replace|findOneAnd|bulkWrite|drop)/.test(source), false, file);
  }
  assert.ok(seen.includes('insertOne') && seen.includes('find'), 'the scan found the known audit usages');
});

test('every ledger operation leaves existing audit entries untouched', async () => {
  const db = memoryDb(seed());
  const col = db.collection('adminAuditLog');
  for (const method of ['updateOne', 'updateMany', 'deleteOne', 'deleteMany', 'replaceOne', 'findOneAndUpdate', 'findOneAndDelete', 'bulkWrite', 'drop']) {
    col[method] = async () => { throw new Error(`audit log ${method} is not allowed`); };
  }
  const r = await recordFor(db, (x) => x.paystackReference === 'fo_c_orphan_7');
  await ledger.getPurchaseDetail(db, r.id);
  await ledger.addPurchaseNote(db, r.id, { outcome: 'other', reason: 'looked at it' }, ADMIN);
  await ledger.checkPurchaseWithProvider(db, r.id, { actor: ADMIN, fetchTransaction: async () => ({ outcome: 'not_found' }) });
  const ex = db.collection('paymentExceptions').rows[0]._id.toHexString();
  failAuditInserts(db);
  await ledger.updateException(db, ex, { status: 'dismissed', outcome: 'duplicate_or_test_payment', reason: 'test charge' }, ADMIN);
  await ledger.listExceptions(db, { status: 'all' });
  const audit = await ledger.listAudit(db, {});
  assert.equal(audit.total, 3);
  assert.ok(col.writes.every(([op]) => op === 'insertOne'));
});
