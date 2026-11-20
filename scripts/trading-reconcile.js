/**
 * Practice simulator recovery and reconciliation (lib/trading/engine.js).
 *
 *   node scripts/trading-reconcile.js --database <name>            read-only: checks every account
 *   node scripts/trading-reconcile.js --database <name> --apply    also finishes interrupted work
 *
 * Mismatches are reported, never repaired: the ledger is not rewritten. Every account, open position,
 * pending order and stale operation is visited, 200 at a time in key order (no 200-record cap).
 *
 * The connection string comes from MONGO_URI (or MONGODB_URI) and is never printed.
 */
const { sweep } = require('../lib/trading/engine');

function parseArgs(argv) {
  const args = argv.slice(2);
  const at = args.indexOf('--database');
  const database = at !== -1 ? String(args[at + 1] || '').trim() : '';
  if (!database || database.startsWith('--')) return { error: 'Pass the target database name with --database <name>.' };
  return { database, apply: args.includes('--apply') };
}

async function run(db, { apply, log = console.log }) {
  const report = await sweep(db, { apply });
  log(`Accounts checked: ${report.checked}. Mismatches: ${report.mismatches.length}.`);
  if (report.recovered) log(`Recovered: ${report.recovered.finished} finished, ${report.recovered.abandoned} abandoned. Evaluated: ${report.evaluated}.`);
  for (const row of report.mismatches) log(`${row.accountId}: ${row.problems.join(', ')}`);
  if (report.failures.count) {
    log(`Failed: ${report.failures.count} record(s); every other record was still processed. Rerun to retry them.`);
    for (const item of report.failures.items) log(`  ${item.stream} ${item.id}: ${item.error}`);
  }
  return report;
}

async function withDatabase(name, run) {
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
    return await run(client.db(name));
  } finally {
    await client.close().catch(() => {});
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.error) {
    console.error(args.error);
    process.exit(1);
  }
  console.log(`Database: ${args.database}. Mode: ${args.apply ? 'apply' : 'report (read-only)'}.`);
  const report = await withDatabase(args.database, (db) => run(db, { apply: args.apply }));
  process.exitCode = report.mismatches.length || report.failures.count ? 1 : 0;
}

if (require.main === module) main().catch(() => { console.error('Reconcile script failed.'); process.exit(1); });

module.exports = { parseArgs, run };
