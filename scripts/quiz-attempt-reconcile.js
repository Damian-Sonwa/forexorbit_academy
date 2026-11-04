/**
 * Finishes assessment work that was interrupted (Phase 9, docs/audits/phase-9-assessments.md).
 *
 *   node scripts/quiz-attempt-reconcile.js --database <name>            read-only: counts only
 *   node scripts/quiz-attempt-reconcile.js --database <name> --apply    finishes them
 *
 * Finds quiz attempts whose score or lesson completion was not confirmed, quiz attempts whose time
 * ran out with no later request, and assignment point awards still pending. Students who return
 * trigger the same recovery themselves; this covers the ones who do not. Every step is idempotent,
 * so it is safe to run while the application is serving and safe to run again. It is run by hand:
 * nothing schedules it (scheduling is a possible future improvement, see the Phase 9 report).
 *
 * The connection string comes from MONGO_URI (or MONGODB_URI) and is never printed.
 */
const { sweepAttempts } = require('../lib/quiz-attempts');
const { sweepPendingPoints } = require('../lib/assignment-grading');

function parseArgs(argv) {
  const args = argv.slice(2);
  const at = args.indexOf('--database');
  const database = at !== -1 ? String(args[at + 1] || '').trim() : '';
  if (!database || database.startsWith('--')) return { error: 'Pass the target database name with --database <name>.' };
  return { database, apply: args.includes('--apply') };
}

async function run(db, { apply, log = console.log }) {
  const attempts = await sweepAttempts(db, { apply });
  const points = await sweepPendingPoints(db, { apply });
  log(`Quiz attempts: ${attempts.pending} interrupted, ${attempts.overdue} overdue.`);
  log(`Assignment awards: ${points.pending} pending.`);
  if (apply) {
    log(`Finished: ${attempts.reconciled} reconciled, ${attempts.expired} expired, ${points.settled} awards settled, ${attempts.failed + points.failed} failed.`);
  }
  return { ok: attempts.failed + points.failed === 0, attempts, points };
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.error) {
    console.error(args.error);
    process.exit(1);
  }
  require('dotenv').config({ quiet: true });
  const uri = String(process.env.MONGO_URI || process.env.MONGODB_URI || '').trim();
  if (!uri) {
    console.error('MONGO_URI (or MONGODB_URI) is not set.');
    process.exit(1);
  }
  const { MongoClient } = require('mongodb');
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
  try {
    await client.connect();
    console.log(`Database: ${args.database}. Mode: ${args.apply ? 'apply' : 'report (read-only)'}.`);
    const result = await run(client.db(args.database), { apply: args.apply });
    process.exitCode = result.ok ? 0 : 1;
  } finally {
    await client.close().catch(() => {});
  }
}

if (require.main === module) main().catch(() => { console.error('Reconcile script failed.'); process.exit(1); });

module.exports = { parseArgs, run };
