/**
 * Payment reconciliation from the command line (lib/payment-reconciliation.js).
 *
 *   node scripts/payment-reconcile.js --database <name>                      report only, no Paystack calls
 *   node scripts/payment-reconcile.js --database <name> --apply              repair what Paystack proves
 *   node scripts/payment-reconcile.js --database <name> --apply --verify-sample 10
 *                                                                            also re-verify 10 recent successes
 *   ... --limit <n>   maximum Paystack calls in this run (default 25, at most 100)
 *
 * The connection comes from MONGO_URI (or MONGODB_URI) and is never printed; the Paystack secret
 * from PAYSTACK_SECRET_KEY. `--apply` needs the same payment environment rules as the app (live key
 * only in production; a test key only with an isolated database). It never charges or refunds and
 * never marks an uncertain payment failed. Output: counts and references only (no emails).
 */
const { decidePaymentEnvironment, fetchPaystackTransaction } = require('../lib/course-payment');
const { fetchPaystackRefund, listPaystackRefunds } = require('../lib/payment-refunds');
const { runReconciliation } = require('../lib/payment-reconciliation');

function parseArgs(argv) {
  const args = argv.slice(2);
  const value = (flag) => {
    const at = args.indexOf(flag);
    return at !== -1 ? String(args[at + 1] || '').trim() : null;
  };
  const database = value('--database') || '';
  if (!database || database.startsWith('--')) return { error: 'Pass the target database name with --database <name>.' };
  const limit = value('--limit') === null ? 25 : Number(value('--limit'));
  const sample = value('--verify-sample') === null ? 0 : Number(value('--verify-sample'));
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return { error: '--limit must be 1 to 100.' };
  if (!Number.isInteger(sample) || sample < 0 || sample > 50) return { error: '--verify-sample must be 0 to 50.' };
  return { database, apply: args.includes('--apply'), limit, sample };
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
    console.error('No connection: set MONGO_URI.');
    process.exit(1);
  }
  const env = { ...process.env, MONGODB_DB_NAME: args.database };
  const environment = decidePaymentEnvironment(env);
  if ((args.apply || args.sample) && !environment.enabled) {
    console.error(`Refused: Paystack calls are not allowed here (${environment.reason}).`);
    process.exit(1);
  }
  const secret = process.env.PAYSTACK_SECRET_KEY;
  const noProvider = async () => ({ outcome: 'uncertain', reason: 'report_only' });
  const { MongoClient } = require('mongodb');
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
  try {
    await client.connect();
    const report = await runReconciliation(client.db(args.database), {
      apply: args.apply,
      limit: args.limit,
      verifySample: args.sample,
      fetchTransaction: args.apply || args.sample ? (reference) => fetchPaystackTransaction(reference, { secret }) : noProvider,
      fetchRefund: args.apply ? (id) => fetchPaystackRefund(id, { secret }) : noProvider,
      listRefunds: args.apply ? (id) => listPaystackRefunds(id, { secret }) : noProvider,
    });
    console.log(`Database: ${args.database}. Mode: ${args.apply ? 'apply' : 'report only'}. Checked at ${report.checkedAt}.`);
    console.log(`Counts: ${JSON.stringify(report.counts)}`);
    for (const item of report.items) {
      console.log(`  ${item.type}  ${item.reference || '-'}  ${item.action}${item.detail ? `  (${item.detail})` : ''}`);
    }
    process.exitCode = 0;
  } finally {
    await client.close().catch(() => {});
  }
}

if (require.main === module) main().catch(() => { console.error('Reconciliation failed.'); process.exit(1); });

module.exports = { parseArgs };
