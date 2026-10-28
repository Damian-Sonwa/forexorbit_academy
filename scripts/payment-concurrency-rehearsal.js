/**
 * Cross-process payment rehearsal on a real MongoDB server.
 *
 *   node scripts/payment-concurrency-rehearsal.js --database <name>
 *
 * Every collection is prefixed `rehearsal_<run>_` and built with the real I1–I6 and R1 indexes;
 * existing collections are never read or written, and the prefixed ones are dropped at the end.
 * Each worker is a separate Node process with its own connection. The database name must end in
 * `_dev` or `_test`. The connection string comes from MONGO_URI (or MONGODB_URI) and is never
 * printed. No payment provider is called: workers receive locally built `charge.success` data.
 */
const { fork } = require('child_process');

const WORKER_FLAG = '--worker';

function parseArgs(argv) {
  const args = argv.slice(2);
  const at = args.indexOf('--database');
  const database = at !== -1 ? String(args[at + 1] || '').trim() : '';
  if (!database || database.startsWith('--')) return { error: 'Pass the target database name with --database <name>.' };
  if (!/_(dev|test)$/i.test(database)) return { error: `Refusing "${database}": the database name must end in _dev or _test.` };
  return { database };
}

function connectionString() {
  require('dotenv').config({ quiet: true });
  return String(process.env.MONGO_URI || process.env.MONGODB_URI || '').trim();
}

function prefixedDb(db, prefix) {
  return { collection: (name) => db.collection(prefix + name) };
}

async function runWorker() {
  const job = JSON.parse(process.env.FO_REHEARSAL_JOB);
  const { MongoClient } = require('mongodb');
  const payment = require('../lib/course-payment');
  const { consumeSharedLimit } = require('../lib/shared-rate-limit');
  const client = new MongoClient(connectionString(), { serverSelectionTimeoutMS: 15000, maxPoolSize: 2 });
  await client.connect();
  const db = prefixedDb(client.db(job.database), job.prefix);
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, job.startAt - Date.now())));
  let result;
  try {
    if (job.task === 'intent') {
      const out = await payment.createCourseIntent(db, { userId: job.userId, courseId: job.courseId, fetchTransaction: async () => ({ outcome: 'not_found' }) });
      result = { ok: out.ok, reference: out.reference || null, code: out.code || null };
    } else if (job.task === 'webhook') {
      result = await payment.processWebhookEvent(db, { event: 'charge.success', data: job.data });
    } else if (job.task === 'limit') {
      let allowed = 0;
      for (let i = 0; i < job.attempts; i += 1) {
        if ((await consumeSharedLimit(db, { scope: 'rehearsal', key: 'k', windowMs: 600000, max: job.max, now: job.now })).allowed) allowed += 1;
      }
      result = { allowed };
    }
  } catch (error) {
    result = { error: error.codeName || error.name || 'error' };
  } finally {
    await client.close().catch(() => {});
  }
  process.stdout.write(`RESULT ${JSON.stringify(result)}\n`);
}

function runWorkers(base, count, perWorker = () => ({})) {
  const startAt = Date.now() + 4000;
  return Promise.all(Array.from({ length: count }, (_, i) => new Promise((resolve, reject) => {
    const child = fork(__filename, [WORKER_FLAG], {
      env: { ...process.env, FO_REHEARSAL_JOB: JSON.stringify({ ...base, ...perWorker(i), startAt }) },
      stdio: ['ignore', 'pipe', 'inherit', 'ipc'],
    });
    let out = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.on('error', reject);
    child.on('exit', () => {
      const line = out.split('\n').find((l) => l.startsWith('RESULT '));
      resolve(line ? JSON.parse(line.slice(7)) : { error: 'no_result' });
    });
  })));
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.error) {
    console.error(args.error);
    process.exit(2);
  }
  const uri = connectionString();
  if (!uri) {
    console.error('Set MONGO_URI (or MONGODB_URI).');
    process.exit(2);
  }
  const { MongoClient } = require('mongodb');
  const payment = require('../lib/course-payment');
  const { COURSE_PAYMENT_INDEXES } = require('../lib/course-payment-indexes');
  const { RATE_LIMIT_TTL_INDEX } = require('../lib/shared-rate-limit');
  const { COLLECTIONS, CLAIM_TTL_MS } = payment;

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
  const prefix = `rehearsal_${Date.now().toString(36)}_`;
  const checks = [];
  const check = (name, pass, detail) => {
    checks.push(pass);
    console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
  };
  await client.connect();
  const real = client.db(args.database);
  const db = prefixedDb(real, prefix);
  try {
    const status = await real.command({ connectionStatus: 1 });
    const users = (status.authInfo.authenticatedUsers || []).map((u) => u.user).join(', ');
    const version = (await real.admin().command({ buildInfo: 1 })).version;
    console.log(`database: ${args.database} | user: ${users} | server: ${version} | prefix: ${prefix}`);

    for (const index of [...COURSE_PAYMENT_INDEXES, RATE_LIMIT_TTL_INDEX]) {
      await db.collection(index.collection).createIndex(index.key, index.options);
    }
    const base = { database: args.database, prefix };
    const WORKERS = 8;

    // 1. Concurrent checkout creation for one student and course.
    const intents = await runWorkers({ ...base, task: 'intent', userId: 'rehearsal_user_1', courseId: 'rehearsal_course_1' }, WORKERS);
    const refs = new Set(intents.map((r) => r.reference));
    const pending = await db.collection(COLLECTIONS.intents).countDocuments({ userId: 'rehearsal_user_1', status: 'pending' });
    check('concurrent checkouts share one pending intent', intents.every((r) => r.ok) && refs.size === 1 && pending === 1, `${WORKERS} processes, ${refs.size} reference(s), ${pending} pending`);

    // 2. Concurrent webhook confirmation of that payment.
    const intent = await db.collection(COLLECTIONS.intents).findOne({ userId: 'rehearsal_user_1', status: 'pending' });
    const data = (id) => ({ id, status: 'success', reference: intent.reference, amount: intent.amountKobo, currency: 'NGN', paid_at: new Date().toISOString(), metadata: { userId: intent.userId, courseId: intent.courseId } });
    const confirms = await runWorkers({ ...base, task: 'webhook', data: data(910001) }, WORKERS);
    const codes = confirms.map((r) => r.code || r.error);
    const payments = await db.collection(COLLECTIONS.payments).countDocuments({ reference: intent.reference });
    const access = await payment.hasCourseEntitlement(db, intent.userId, intent.courseId);
    check('concurrent confirmations grant once', codes.filter((c) => c === 'granted').length === 1 && payments === 1 && access, `codes: ${codes.join(',')}; payment rows ${payments}`);

    // 3. Replay after processing.
    const [replay] = await runWorkers({ ...base, task: 'webhook', data: data(910001) }, 1);
    const afterReplay = await db.collection(COLLECTIONS.payments).countDocuments({ reference: intent.reference });
    check('a replayed webhook changes nothing', replay.code === 'already_processed' && afterReplay === 1, replay.code);

    // 4. Recovery from a claim left behind by a crashed process.
    const [second] = await runWorkers({ ...base, task: 'intent', userId: 'rehearsal_user_2', courseId: 'rehearsal_course_1' }, 1);
    const stale = new Date(Date.now() - CLAIM_TTL_MS - 60000);
    await db.collection(COLLECTIONS.intents).updateOne({ reference: second.reference }, { $set: { status: 'processing', claimedFrom: 'pending', claimedAt: stale } });
    const recovered = await runWorkers({ ...base, task: 'webhook', data: { ...data(910002), reference: second.reference, metadata: { userId: 'rehearsal_user_2', courseId: 'rehearsal_course_1' } } }, 4);
    const recoveredCodes = recovered.map((r) => r.code || r.error);
    const secondPayments = await db.collection(COLLECTIONS.payments).countDocuments({ reference: second.reference });
    check('a stale claim is recovered and granted once', recoveredCodes.filter((c) => c === 'granted').length === 1 && secondPayments === 1 && (await payment.hasCourseEntitlement(db, 'rehearsal_user_2', 'rehearsal_course_1')), `codes: ${recoveredCodes.join(',')}`);

    // 5. Shared rate limit across processes.
    const limits = await runWorkers({ ...base, task: 'limit', attempts: 5, max: 12, now: Date.now() }, WORKERS);
    const allowed = limits.reduce((sum, r) => sum + (r.allowed || 0), 0);
    check('the shared rate limit holds across processes', allowed === 12 && limits.every((r) => !r.error), `${WORKERS * 5} attempts, ${allowed} allowed, limit 12`);
  } finally {
    const names = (await real.listCollections({ name: { $regex: `^${prefix}` } }, { nameOnly: true }).toArray()).map((c) => c.name);
    for (const name of names) {
      if (name.startsWith(prefix)) await real.collection(name).drop();
    }
    const left = await real.listCollections({ name: { $regex: `^${prefix}` } }, { nameOnly: true }).toArray();
    console.log(`cleanup: dropped ${names.length} rehearsal collections, ${left.length} left`);
    await client.close();
  }
  const ok = checks.length === 5 && checks.every(Boolean);
  console.log(ok ? 'REHEARSAL PASSED' : 'REHEARSAL FAILED');
  if (!ok) process.exitCode = 1;
}

if (process.argv.includes(WORKER_FLAG)) runWorker().catch(() => process.exit(1));
else if (require.main === module) main().catch((error) => {
  console.error(`Failed: ${error.codeName || error.name || 'error'}`);
  process.exitCode = 1;
});

module.exports = { parseArgs, prefixedDb };
