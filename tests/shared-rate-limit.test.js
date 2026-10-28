/**
 * D10: the shared (MongoDB-counted) rate limit, against an in-memory stand-in for the
 * collection. The stand-in applies each upsert atomically, as MongoDB does for a single document;
 * it does not prove MongoDB's behavior across real server processes.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { RATE_LIMIT_COLLECTION, consumeSharedLimit } = require('../lib/shared-rate-limit');
const { createRateLimiter } = require('../lib/rate-limit');

const WINDOW = 10 * 60 * 1000;
const T0 = Date.UTC(2026, 9, 28, 12, 0, 0);

function sharedStore({ failWith, duplicateOnce } = {}) {
  const docs = new Map();
  let duplicatePending = Boolean(duplicateOnce);
  const calls = [];
  return {
    docs,
    calls,
    collection(name) {
      assert.equal(name, RATE_LIMIT_COLLECTION);
      return {
        async findOneAndUpdate(filter, update, options) {
          calls.push({ filter, update, options });
          if (failWith) throw failWith;
          if (duplicatePending) {
            duplicatePending = false;
            throw Object.assign(new Error('E11000'), { code: 11000 });
          }
          const doc = docs.get(filter._id) || { _id: filter._id, count: 0, ...update.$setOnInsert };
          doc.count += update.$inc.count;
          docs.set(filter._id, doc);
          return { ...doc };
        },
      };
    },
  };
}

const consume = (db, now, key = 'user_a', max = 3) => consumeSharedLimit(db, { scope: 'payment-confirm', key, windowMs: WINDOW, max, now });

test('the shared count allows max requests per window, then refuses with Retry-After until the window ends', async () => {
  const db = sharedStore();
  for (let i = 0; i < 3; i += 1) assert.deepEqual(await consume(db, T0 + i), { allowed: true, retryAfterSec: 0 });
  const refused = await consume(db, T0 + 1000);
  assert.equal(refused.allowed, false);
  assert.equal(refused.retryAfterSec, WINDOW / 1000 - 1);
  assert.equal((await consume(db, T0 + WINDOW)).allowed, true, 'a new window starts a new count');
  assert.equal((await consume(db, T0 + 1000, 'user_b')).allowed, true, 'each user has a separate count');
});

test('two server instances share one count, so their in-process limits cannot be multiplied', async () => {
  const db = sharedStore();
  const instances = [createRateLimiter({ windowMs: WINDOW, max: 3 }), createRateLimiter({ windowMs: WINDOW, max: 3 })];
  const decisions = [];
  for (let i = 0; i < 6; i += 1) {
    const local = instances[i % 2].check('confirm:user_a', T0 + i);
    decisions.push(local.allowed && (await consume(db, T0 + i)).allowed);
  }
  assert.deepEqual(decisions, [true, true, true, false, false, false]);
});

test('each window is one document with an expiry at the window end, written by a single atomic upsert', async () => {
  const db = sharedStore();
  await consume(db, T0 + 5000);
  const [call] = db.calls;
  assert.deepEqual(call.filter, { _id: `payment-confirm:user_a:${T0}` });
  assert.deepEqual(call.update.$inc, { count: 1 });
  assert.equal(call.update.$setOnInsert.expiresAt.getTime(), T0 + WINDOW);
  assert.equal(call.options.upsert, true);
  assert.equal(call.options.returnDocument, 'after');
});

test('a duplicate-key race on the first request of a window is retried once', async () => {
  const db = sharedStore({ duplicateOnce: true });
  assert.equal((await consume(db, T0)).allowed, true);
  assert.equal(db.calls.length, 2);
});

test('an unreachable store throws so the route refuses the request', async () => {
  const db = sharedStore({ failWith: new Error('connection refused') });
  await assert.rejects(consume(db, T0), /connection refused/);
});

test('payment and ledger routes count in the shared store and refuse when it is unavailable', () => {
  const read = (relative) => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
  const paymentRoute = read('lib/payment-route.ts');
  const ledgerRoute = read('lib/admin-ledger-route.ts');
  for (const source of [paymentRoute, ledgerRoute]) {
    assert.match(source, /consumeSharedLimit\(await getDb\(\)/);
    assert.match(source, /res\.status\(503\)/);
    assert.doesNotMatch(source, /catch \{\s*return true/);
  }
  assert.match(paymentRoute, /const LIMITS = \{ init: 10, confirm: 30 \} as const;/);
  assert.match(ledgerRoute, /const LIMITS = \{ provider: 20, write: 60 \} as const;/);
  assert.match(paymentRoute, /!\(await withinRateLimit\('confirm', req, res\)\)/);
  assert.match(read('pages/api/payments/paystack/init-course.ts'), /!\(await withinRateLimit\('init', req, res\)\)/);
  assert.match(read('pages/api/admin/purchases/[id]/verify.ts'), /!\(await withinLedgerLimit\('provider', req, res\)\)/);
  assert.match(read('pages/api/admin/purchases/[id]/index.ts'), /!\(await withinLedgerLimit\('write', req, res\)\)/);
  assert.match(read('pages/api/admin/payment-exceptions/[id].ts'), /!\(await withinLedgerLimit\('write', req, res\)\)/);
});
