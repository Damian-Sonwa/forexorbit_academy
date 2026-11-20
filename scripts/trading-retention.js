/**
 * Practice-trading retention. Read-only unless --apply.
 *
 *   node scripts/trading-retention.js --database <name>            reports expired and inactive records
 *   node scripts/trading-retention.js --database <name> --apply    purges expired anonymous records
 *
 * --apply needs an operator account: the app role cannot remove ledger rows. Inactive students are
 * only ever reported. Connection: MONGO_URI (or MONGODB_URI), as the other operator scripts; never printed.
 */
const { inactiveStudents, purgeExpired } = require('../lib/trading/retention');
const { MISSING_URI, mongoUri } = require('./mongo-uri');

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
    require('dotenv').config({ quiet: true });
    const uri = mongoUri();
    if (!uri) { console.error(MISSING_URI); process.exit(2); }
    const { MongoClient } = require('mongodb');
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
    try {
      await client.connect();
      await run(client.db(args.database), args);
    } finally {
      await client.close().catch(() => {});
    }
  })().catch((error) => {
    console.error(`Trading retention failed: ${(error && (error.codeName || error.name)) || 'error'}`);
    process.exit(1);
  });
}

module.exports = { parseArgs, run };
