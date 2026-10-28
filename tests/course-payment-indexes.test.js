/**
 * The course payment index script, against a fake database (no MongoDB connection).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { COURSE_PAYMENT_INDEXES, PENDING_COURSE_INTENT } = require('../lib/course-payment-indexes');
const { COLLECTIONS } = require('../lib/course-payment');
const { SCANS, compareIndex, maskValue, parseArgs, run } = require('../scripts/course-payment-indexes');

const PAYMENT_COLLECTIONS = [COLLECTIONS.intents, COLLECTIONS.payments, COLLECTIONS.courseAccess, COLLECTIONS.coursePurchases];

function fakeDb({ collections = PAYMENT_COLLECTIONS, groups = {}, indexes = {} } = {}) {
  const calls = [];
  const present = new Set(collections);
  const idx = new Map(collections.map((name) => [name, [{ name: '_id_', key: { _id: 1 } }, ...(indexes[name] || [])]]));
  return {
    calls,
    indexesOf: (name) => idx.get(name) || [],
    listCollections: () => ({ toArray: async () => [...present].map((name) => ({ name })) }),
    collection(name) {
      return {
        aggregate(pipeline) {
          calls.push({ op: 'aggregate', name });
          const scan = SCANS.find((item) => item.collection === name && item.pipeline === pipeline);
          return { toArray: async () => (scan && groups[scan.id]) || [] };
        },
        indexes: async () => (idx.get(name) || []).map((item) => ({ ...item })),
        createIndex: async (key, options) => {
          calls.push({ op: 'createIndex', name, key, options });
          present.add(name);
          if (!idx.has(name)) idx.set(name, [{ name: '_id_', key: { _id: 1 } }]);
          idx.get(name).push({ name: options.name, key, unique: options.unique, partialFilterExpression: options.partialFilterExpression });
          return options.name;
        },
        dropIndex: async (indexName) => {
          calls.push({ op: 'dropIndex', name, indexName });
          idx.set(name, idx.get(name).filter((item) => item.name !== indexName));
        },
        updateOne: async () => { throw new Error('documents must not change'); },
        deleteMany: async () => { throw new Error('documents must not change'); },
        insertOne: async () => { throw new Error('documents must not change'); },
      };
    },
  };
}

const quiet = () => {};
const writes = (db) => db.calls.filter((call) => call.op !== 'aggregate');

test('the six indexes match the migration plan, in build order, all unique', () => {
  assert.deepEqual(COURSE_PAYMENT_INDEXES.map((item) => item.id), ['I1', 'I3', 'I6', 'I2', 'I5', 'I4']);
  assert.ok(COURSE_PAYMENT_INDEXES.every((item) => item.options.unique === true));
  const byId = Object.fromEntries(COURSE_PAYMENT_INDEXES.map((item) => [item.id, item]));
  assert.deepEqual(byId.I1, { id: 'I1', collection: 'paystackPaymentIntents', key: { reference: 1 }, options: { name: 'uniq_intent_reference', unique: true } });
  assert.deepEqual(byId.I2.key, { userId: 1, courseId: 1, kind: 1 });
  assert.deepEqual(byId.I2.options.partialFilterExpression, { status: 'pending', kind: 'course' });
  assert.deepEqual(byId.I3.key, { reference: 1 });
  assert.equal(byId.I3.collection, 'paystackPayments');
  assert.deepEqual(byId.I4.key, { userId: 1, courseId: 1 });
  assert.equal(byId.I4.collection, 'userCourseAccess');
  assert.deepEqual(byId.I5.key, { userId: 1, courseId: 1 });
  assert.equal(byId.I5.collection, 'coursePurchases');
  assert.deepEqual(byId.I6.key, { reference: 1, reason: 1 });
  assert.equal(byId.I6.collection, 'paymentExceptions');
});

test('the pending-intent index covers exactly the intents the checkout code treats as one open checkout', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'course-payment.js'), 'utf8');
  assert.match(source, /intents\.find\(\{ userId, courseId, kind: 'course', status: 'pending' \}\)/);
  assert.deepEqual(PENDING_COURSE_INTENT, { status: 'pending', kind: 'course' });
  assert.match(source, /if \(!isDuplicateKey\(error\)\) throw error;\s+await db\.collection\(COLLECTIONS\.intents\)\.updateOne\(filter, \{ \$set: \{ claimedAt: null \} \}\);/);
});

test('arguments: a database name is required and apply and rollback exclude each other', () => {
  assert.match(parseArgs(['node', 's']).error, /--database/);
  assert.match(parseArgs(['node', 's', '--database', '--apply']).error, /--database/);
  assert.match(parseArgs(['node', 's', '--database', 'x', '--apply', '--rollback']).error, /not both/);
  assert.deepEqual(parseArgs(['node', 's', '--database', 'Forex_elearning_dev']), { database: 'Forex_elearning_dev', mode: 'dry-run' });
  assert.equal(parseArgs(['node', 's', '--database', 'x', '--apply']).mode, 'apply');
  assert.equal(parseArgs(['node', 's', '--database', 'x', '--rollback']).mode, 'rollback');
});

test('a dry run only reads, and reports ready when every scan is clean', async () => {
  const db = fakeDb();
  const lines = [];
  const result = await run(db, { mode: 'dry-run', log: (line) => lines.push(line) });
  assert.equal(result.ok, true);
  assert.deepEqual(writes(db), []);
  assert.equal(db.calls.filter((call) => call.op === 'aggregate').length, 5);
  assert.ok(lines.some((line) => line.startsWith('S6 paymentExceptions: collection absent')));
  assert.ok(lines.some((line) => line.startsWith('Ready to build')));
});

test('apply builds the six indexes in plan order with the exact definitions, then verifies them', async () => {
  const db = fakeDb();
  const result = await run(db, { mode: 'apply', log: quiet });
  assert.equal(result.ok, true);
  const created = writes(db);
  assert.deepEqual(created.map((call) => call.options.name), COURSE_PAYMENT_INDEXES.map((item) => item.options.name));
  created.forEach((call, i) => {
    assert.equal(call.name, COURSE_PAYMENT_INDEXES[i].collection);
    assert.deepEqual(call.key, COURSE_PAYMENT_INDEXES[i].key);
    assert.deepEqual(call.options, COURSE_PAYMENT_INDEXES[i].options);
  });

  const again = await run(db, { mode: 'apply', log: quiet });
  assert.equal(again.ok, true);
  assert.deepEqual(again.created, []);
});

test('apply refuses and changes nothing while any scan reports a duplicate group', async () => {
  for (const scan of SCANS) {
    const db = fakeDb({ collections: [...PAYMENT_COLLECTIONS, COLLECTIONS.exceptions], groups: { [scan.id]: [{ _id: { r: 'fo_c_dup_reference_x' }, n: 2 }] } });
    const result = await run(db, { mode: 'apply', log: quiet });
    assert.equal(result.ok, false, scan.id);
    assert.match(result.error, new RegExp(`${scan.id} `));
    assert.deepEqual(writes(db), [], scan.id);
  }
});

test('apply refuses when an existing index conflicts by name or by keys', async () => {
  const sameName = fakeDb({ indexes: { paystackPayments: [{ name: 'uniq_payment_reference', key: { reference: 1 } }] } });
  const byName = await run(sameName, { mode: 'apply', log: quiet });
  assert.equal(byName.ok, false);
  assert.match(byName.error, /different definition/);
  assert.deepEqual(writes(sameName), []);

  const sameKeys = fakeDb({ indexes: { userCourseAccess: [{ name: 'userId_1_courseId_1', key: { userId: 1, courseId: 1 } }] } });
  const byKeys = await run(sameKeys, { mode: 'apply', log: quiet });
  assert.equal(byKeys.ok, false);
  assert.match(byKeys.error, /already indexed as "userId_1_courseId_1"/);
  assert.deepEqual(writes(sameKeys), []);
});

test('compareIndex recognises an index that is already in place', () => {
  const [first] = COURSE_PAYMENT_INDEXES;
  assert.equal(compareIndex(first, [{ name: first.options.name, key: first.key, unique: true }]).state, 'present');
  assert.equal(compareIndex(first, []).state, 'missing');
});

test('a wrong database name is refused before any scan', async () => {
  const db = fakeDb({ collections: ['users'] });
  const result = await run(db, { mode: 'apply', log: quiet });
  assert.equal(result.ok, false);
  assert.match(result.error, /Check --database/);
  assert.deepEqual(db.calls, []);
});

test('rollback drops only the six named indexes that exist', async () => {
  const db = fakeDb({ indexes: { paystackPayments: [{ name: 'uniq_payment_reference', key: { reference: 1 }, unique: true }, { name: 'other_index', key: { createdAt: 1 } }] } });
  const result = await run(db, { mode: 'rollback', log: quiet });
  assert.deepEqual(result.dropped, ['uniq_payment_reference']);
  assert.deepEqual(writes(db).map((call) => call.indexName), ['uniq_payment_reference']);
  assert.deepEqual(db.indexesOf('paystackPayments').map((item) => item.name), ['_id_', 'other_index']);
});

test('scan output masks references and ids', async () => {
  assert.equal(maskValue('fo_c_1730000000_abcdef'), 'fo_c…cdef');
  assert.equal(maskValue('6720aa11bb22cc33dd44bee0'), '6720…bee0');
  assert.equal(maskValue(null), '(none)');
  const lines = [];
  const db = fakeDb({ groups: { S3: [{ _id: { r: 'fo_c_1730000000_abcdef' }, n: 2 }] } });
  await run(db, { mode: 'dry-run', log: (line) => lines.push(line) });
  const text = lines.join('\n');
  assert.ok(text.includes('r=fo_c…cdef rows=2'));
  assert.ok(!text.includes('fo_c_1730000000_abcdef'));
});

test('the script never prints the connection string and never changes documents', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'course-payment-indexes.js'), 'utf8');
  assert.doesNotMatch(source, /console\.(log|error)\([^)]*\buri\b/);
  assert.doesNotMatch(source, /\.(insertOne|insertMany|updateOne|updateMany|deleteOne|deleteMany|replaceOne|findOneAndUpdate|bulkWrite|drop)\(/);
});
