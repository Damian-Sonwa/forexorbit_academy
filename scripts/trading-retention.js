/**
 * Practice-trading retention. Read-only unless --apply.
 *
 *   node scripts/trading-retention.js --database <name>            reports expired and inactive records
 *   node scripts/trading-retention.js --database <name> --apply    purges expired anonymous records
 *
 * --apply needs an operator account: the app role cannot remove ledger rows. Inactive students are
 * only ever reported. Connection: MONGO_URI.
 */
const { inactiveStudents, purgeExpired } = require('../lib/trading/retention');

function parseArgs(argv) {
  const args = argv.slice(2);
  const i = args.indexOf('--database');
  if (i < 0 || !args[i + 1]) return { error: 'Give --database <name>.' };
  return { database: args[i + 1], apply: args.includes('--apply') };
}

async function run(db, { apply, now = new Date(), log = console.log }) {
  const purge = await purgeExpired(db, { now, apply });
  const inactive = await inactiveStudents(db, { now });
  log(`Expired anonymous accounts: ${purge.expired}. Purged: ${purge.purged}. Inactive students: ${inactive.length}.`);
  return { ...purge, inactive: inactive.length };
}

if (require.main === module) {
  (async () => {
    const args = parseArgs(process.argv);
    if (args.error) { console.error(args.error); process.exit(2); }
    if (!process.env.MONGO_URI) { console.error('MONGO_URI is not set.'); process.exit(2); }
    const { MongoClient } = require('mongodb');
    const client = new MongoClient(process.env.MONGO_URI);
    await client.connect();
    await run(client.db(args.database), args);
    await client.close();
  })();
}

module.exports = { parseArgs, run };
