#!/usr/bin/env node
'use strict';

/**
 * Backup and restore drill (Phase 15). Proves the backup format restores a usable database.
 *
 *   DRILL_MONGO_URI=mongodb://127.0.0.1:27017 node scripts/restore-drill.js [--keep]
 *
 * Runs ONLY against a test server: DRILL_MONGO_URI must point at localhost / 127.0.0.1 (or pass
 * --allow-host <host> for a disposable test cluster). It never reads MONGO_URI or MONGODB_URI.
 *
 * Steps:
 *   1. seed Forex_elearning_drill_source_test with production-shaped synthetic data (ObjectIds,
 *      dates, Decimal128 ledger amounts, integer kobo payments) and every index the application
 *      defines (trading, learning, assessment, enrollment, payment, refund, community indexes);
 *   2. back it up with lib/db-backup.js (the same code as scripts/db-backup.js);
 *   3. check the safety refusals: production name, unsuffixed name, non-empty target, tampered file;
 *   4. restore into Forex_elearning_drill;
 *   5. verify counts, index definitions and BSON types, then run application logic on the restored
 *      copy (trading ledger reconciliation, admin finance totals, notification queue figures) and
 *      compare with the source.
 * Prints a JSON report and exits 1 on any failed check. Drops the drill databases unless --keep.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { MongoClient, ObjectId, Decimal128, Long } = require('mongodb');
const { backupDatabase, restoreDatabase } = require('../lib/db-backup');

const SOURCE = 'Forex_elearning_drill_source_test';
const TARGET = 'Forex_elearning_drill';
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
};

function allIndexes() {
  const out = [];
  const add = (list, shape) => { for (const i of list) out.push(shape(i)); };
  add(require('../lib/trading/indexes').TRADING_INDEXES, (i) => ({ collection: i.collection, key: i.key, options: i.options }));
  add(require('../lib/learning-indexes').LEARNING_INDEXES, (i) => ({ collection: i.collection, key: i.key, options: i.options }));
  add(require('../lib/assessment-indexes').ASSESSMENT_INDEXES, (i) => ({ collection: i.collection, key: i.key, options: i.options }));
  add(require('../lib/enrollment-indexes').ENROLLMENT_INDEXES, (i) => ({ collection: i.collection, key: i.key, options: i.options }));
  add(require('../lib/course-payment-indexes').COURSE_PAYMENT_INDEXES, (i) => ({ collection: i.collection, key: i.key, options: i.options }));
  add(require('../lib/refund-indexes').REFUND_INDEXES, (i) => ({ collection: i.collection, key: i.key, options: i.options }));
  add(require('../lib/community-qa').COMMUNITY_QA_INDEXES, (i) => ({ collection: i.collection, key: i.key, options: { name: i.name, ...(i.unique ? { unique: true } : {}) } }));
  return out;
}

async function seed(db) {
  const now = Date.now();
  const day = 86400000;
  const users = [];
  for (let i = 0; i < 40; i += 1) users.push({ _id: new ObjectId(), name: `Drill User ${i}`, email: `drill${i}@example.test`, role: i < 30 ? 'student' : i < 38 ? 'instructor' : 'admin', status: i % 13 ? 'approved' : 'suspended', createdAt: new Date(now - i * day) });
  await db.collection('users').insertMany(users);
  const courses = Array.from({ length: 5 }, (_, i) => ({ _id: new ObjectId(), title: `Drill Course ${i}`, status: 'published', instructorId: String(users[30 + i]._id), createdAt: new Date(now - 50 * day) }));
  await db.collection('courses').insertMany(courses);
  await db.collection('progress').insertMany(users.slice(0, 30).map((u, i) => ({ _id: new ObjectId(), userId: String(u._id), courseId: String(courses[i % 5]._id), progress: (i * 7) % 100, enrolledAt: new Date(now - i * day) })));
  // Payments: integer kobo amounts; some paid, some pending.
  await db.collection('paystackPaymentIntents').insertMany(users.slice(0, 20).map((u, i) => ({ _id: new ObjectId(), reference: `fo_course_drill_${i}`, userId: String(u._id), courseId: String(courses[i % 5]._id), kind: 'course', amountKobo: 1250000 + i * 100, status: i % 4 ? 'paid' : 'pending', createdAt: new Date(now - i * day), paidAt: i % 4 ? new Date(now - i * day) : null })));
  // Trading: accounts and a consistent Decimal128 ledger (deposit + realized P&L rows).
  for (let a = 0; a < 6; a += 1) {
    const accountId = new ObjectId();
    let balance = 1000000n; // cents
    const rows = [{ _id: `${accountId}:1`, accountId, seq: 1, type: 'deposit', amount: Decimal128.fromString('10000.00'), balanceAfter: Decimal128.fromString('10000.00'), reference: 'opening_virtual_funds', createdAt: new Date(now - 10 * day) }];
    for (let s = 2; s <= 25; s += 1) {
      const pl = BigInt(((s * 37 + a * 11) % 400) - 200) * 100n + BigInt(s % 100);
      balance += pl;
      const fmt = (v) => `${v < 0n ? '-' : ''}${(v < 0n ? -v : v) / 100n}.${String((v < 0n ? -v : v) % 100n).padStart(2, '0')}`;
      rows.push({ _id: `${accountId}:${s}`, accountId, seq: s, type: 'realized_pnl', amount: Decimal128.fromString(fmt(pl)), balanceAfter: Decimal128.fromString(fmt(balance)), positionId: new ObjectId(), reference: 'take_profit', createdAt: new Date(now - (10 - s / 3) * day) });
    }
    const fmt = (v) => `${v / 100n}.${String(v % 100n).padStart(2, '0')}`;
    await db.collection('tradingLedger').insertMany(rows);
    await db.collection('tradingAccounts').insertOne({ _id: accountId, userId: String(users[a]._id), generation: 1, status: 'active', currency: 'USD', balance: Decimal128.fromString(fmt(balance)), startingBalance: Decimal128.fromString('10000.00'), usedMargin: Decimal128.fromString('0.00'), peakBalance: Decimal128.fromString(fmt(balance)), maxDrawdown: Decimal128.fromString('0.00'), closedTrades: 24, ledgerSeq: 25, version: 24, applied: {}, marginCall: false, evaluatedThrough: null, createdAt: new Date(now - 10 * day), updatedAt: new Date(now) });
    await db.collection('tradingAccountSlots').insertOne({ _id: String(users[a]._id), activeAccountId: accountId, generation: 1, lastResetAt: null, createdAt: new Date(now - 10 * day) });
  }
  await db.collection('notifications').insertMany(users.slice(0, 30).map((u, i) => ({ _id: new ObjectId(), userId: String(u._id), type: 'task_feedback', category: 'learning', title: 'Graded', message: 'Synthetic', read: i % 2 === 0, createdAt: new Date(now - i * 3600000), channels: { email: { state: ['sent', 'delivered', 'failed', 'queued'][i % 4], attempts: 1, updatedAt: new Date(now) } } })));
  // The audit log is append-only even here: one insertOne per entry (tests/admin-purchase-ledger.test.js).
  for (const entry of Array.from({ length: 12 }, (_, i) => ({ _id: new ObjectId(), entityType: 'account', entityId: String(users[i]._id), action: 'account_approved', outcome: 'saved', actor: { userId: String(users[39]._id), role: 'superadmin' }, createdAt: new Date(now - i * day), seq: Long.fromNumber(9007199254740000 + i) }))) await db.collection('adminAuditLog').insertOne(entry);
  const failures = [];
  for (const ix of allIndexes()) {
    try {
      await db.collection(ix.collection).createIndex(ix.key, ix.options);
    } catch (error) {
      failures.push(`${ix.collection}.${ix.options && ix.options.name}: ${error.codeName || 'error'}`);
    }
  }
  return { indexFailures: failures };
}

async function describe(db) {
  const out = {};
  for (const c of (await db.listCollections({}, { nameOnly: true }).toArray()).map((x) => x.name).sort()) {
    const idx = (await db.collection(c).listIndexes().toArray()).map((i) => `${i.name}:${JSON.stringify(i.key)}${i.unique ? ':unique' : ''}${i.partialFilterExpression ? `:partial${JSON.stringify(i.partialFilterExpression)}` : ''}`).sort();
    out[c] = { count: await db.collection(c).countDocuments({}), indexes: idx };
  }
  return out;
}

async function appChecks(db) {
  const engine = require('../lib/trading/engine');
  const accounts = await db.collection('tradingAccounts').find({}).toArray();
  const reconcile = [];
  for (const a of accounts) {
    const r = await engine.reconcileAccount(db, a._id);
    reconcile.push({ ok: r.ok, problems: r.problems || [] });
  }
  const { deliveryStats } = require('../lib/communication/delivery');
  const stats = await deliveryStats(db, { windowHours: 24 * 400 });
  let finance = null;
  try {
    const portal = require('../lib/admin-portal');
    const superAdmin = await db.collection('users').findOne({ role: 'admin' });
    const overview = await portal.adminOverview(db, { userId: String(superAdmin._id), role: 'superadmin' }, { days: 365 });
    finance = overview.finance ? { gross: overview.finance.gross, paidCount: overview.finance.paidCount } : null;
  } catch (error) {
    finance = { error: error.message };
  }
  // Stored BSON types, counted on the server (the driver may hand back a Long as a JS number).
  const typed = async (coll, field, type) => db.collection(coll).countDocuments({ [field]: { $type: type } });
  const types = {
    ledgerAmountDecimal128: await typed('tradingLedger', 'amount', 'decimal'),
    ledgerAccountIdObjectId: await typed('tradingLedger', 'accountId', 'objectId'),
    ledgerCreatedAtDate: await typed('tradingLedger', 'createdAt', 'date'),
    auditSeqLong: await typed('adminAuditLog', 'seq', 'long'),
    paymentKoboInt: await typed('paystackPaymentIntents', 'amountKobo', 'int'),
  };
  return { reconcile, allLedgersConsistent: reconcile.every((r) => r.ok), emailStates: stats.email, finance, types };
}

(async () => {
  const uri = (process.env.DRILL_MONGO_URI || '').trim();
  if (!uri) {
    console.error('Set DRILL_MONGO_URI to a local or disposable test MongoDB server.');
    process.exit(2);
  }
  const host = (/^mongodb(\+srv)?:\/\/(?:[^@/]*@)?([^/:?,]+)/.exec(uri) || [])[2] || '';
  if (!['127.0.0.1', 'localhost'].includes(host) && arg('--allow-host') !== host) {
    console.error('Refusing: the drill runs only against localhost unless --allow-host <host> names a disposable test cluster.');
    process.exit(2);
  }
  const client = new MongoClient(uri);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fo-restore-drill-'));
  const checks = [];
  const check = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), ...(detail === undefined ? {} : { detail }) });
  try {
    await client.connect();
    await client.db(SOURCE).dropDatabase();
    await client.db(TARGET).dropDatabase();
    const seeded = await seed(client.db(SOURCE));
    check('all application indexes created on the source', seeded.indexFailures.length === 0, seeded.indexFailures);
    const t0 = Date.now();
    const manifest = await backupDatabase(client.db(SOURCE), dir);
    const backupMs = Date.now() - t0;
    check('backup wrote every collection', manifest.collections.length > 0, { collections: manifest.collections.length, documents: manifest.collections.reduce((s, c) => s + c.count, 0), backupMs });

    const refuse = async (name, fn) => {
      try { await fn(); check(name, false, 'not refused'); } catch (e) { check(name, true, e.message.slice(0, 90)); }
    };
    await refuse('refuses the production database name', () => restoreDatabase(client, dir, 'Forex_elearning'));
    await refuse('refuses a target without a _restore/_test/_drill suffix', () => restoreDatabase(client, dir, 'Forex_elearning_copy'));
    await client.db(TARGET).collection('placeholder').insertOne({ x: 1 });
    await refuse('refuses a non-empty target without dropTarget', () => restoreDatabase(client, dir, TARGET));
    const tamperFile = path.join(dir, 'users.ndjson');
    const original = fs.readFileSync(tamperFile);
    fs.appendFileSync(tamperFile, '{"_id":{"$oid":"000000000000000000000000"}}\n');
    await refuse('refuses a tampered backup file (checksum)', () => restoreDatabase(client, dir, TARGET, { dropTarget: true }));
    fs.writeFileSync(tamperFile, original);

    const t1 = Date.now();
    const restored = await restoreDatabase(client, dir, TARGET, { dropTarget: true });
    const restoreMs = Date.now() - t1;
    check('restore completed with matching counts', restored.ok, { collections: restored.collections.length, restoreMs });

    const [src, dst] = [await describe(client.db(SOURCE)), await describe(client.db(TARGET))];
    const diffs = Object.keys({ ...src, ...dst }).filter((c) => JSON.stringify(src[c]) !== JSON.stringify(dst[c]));
    check('collections, counts and index definitions identical', diffs.length === 0, diffs);

    const [appSrc, appDst] = [await appChecks(client.db(SOURCE)), await appChecks(client.db(TARGET))];
    check('trading ledgers reconcile on the restored copy', appDst.allLedgersConsistent, appDst.reconcile.filter((r) => !r.ok));
    check('BSON types preserved (Decimal128, ObjectId, Date, Long, integer kobo)', JSON.stringify(appSrc.types) === JSON.stringify(appDst.types) && Object.values(appDst.types).every((n) => n > 0), appDst.types);
    check('admin finance totals identical to the source', JSON.stringify(appSrc.finance) === JSON.stringify(appDst.finance) && appDst.finance && !appDst.finance.error, { source: appSrc.finance, restored: appDst.finance });
    check('notification delivery figures identical to the source', JSON.stringify(appSrc.emailStates) === JSON.stringify(appDst.emailStates));
    check('source database untouched by the restore', JSON.stringify(src) === JSON.stringify(await describe(client.db(SOURCE))));

    const ok = checks.every((c) => c.ok);
    console.log(JSON.stringify({ event: 'restoreDrill', ok, server: host, sourceDb: SOURCE, targetDb: TARGET, checks }, null, 2));
    process.exitCode = ok ? 0 : 1;
  } catch (error) {
    console.error(JSON.stringify({ event: 'restoreDrill', ok: false, reason: error.message.replace(/mongodb(\+srv)?:\/\/\S+/g, '<uri>'), checks }, null, 2));
    process.exitCode = 1;
  } finally {
    if (!process.argv.includes('--keep')) {
      await client.db(SOURCE).dropDatabase().catch(() => undefined);
      await client.db(TARGET).dropDatabase().catch(() => undefined);
    }
    fs.rmSync(dir, { recursive: true, force: true });
    await client.close().catch(() => undefined);
  }
})();
