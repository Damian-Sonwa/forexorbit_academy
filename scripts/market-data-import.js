/**
 * Imports an APPROVED recorded dataset (lib/trading/import.js).
 *
 *   node scripts/market-data-import.js --database <name> --manifest <file> --csv <file>          read-only check
 *   node scripts/market-data-import.js --database <name> --manifest <file> --csv <file> --apply  import
 *
 * Refuses unless the manifest records the source, licence, rights, time semantics and approval.
 * The dataset is imported inactive; activating it is a separate, deliberate step.
 *
 * The connection string comes from MONGO_URI (or MONGODB_URI) and is never printed.
 */
const fs = require('fs');
const { applyImport, planImport } = require('../lib/trading/import');

function parseArgs(argv) {
  const args = argv.slice(2);
  const value = (name) => {
    const at = args.indexOf(name);
    return at !== -1 ? String(args[at + 1] || '').trim() : '';
  };
  const [database, manifest, csv] = [value('--database'), value('--manifest'), value('--csv')];
  if (!database || !manifest || !csv) return { error: 'Pass --database <name>, --manifest <file> and --csv <file>.' };
  return { database, manifest, csv, apply: args.includes('--apply') };
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
  const manifest = JSON.parse(fs.readFileSync(args.manifest, 'utf8'));
  const plan = planImport({ manifest, csvText: fs.readFileSync(args.csv, 'utf8') });
  if (!plan.ok) {
    plan.errors.slice(0, 50).forEach((line) => console.error(line));
    process.exit(1);
  }
  console.log(`Valid: ${plan.quotes} quotes, ${plan.outsideSession} outside market hours (these are stored but never used).`);
  if (!args.apply) return;
  const result = await withDatabase(args.database, (db) => applyImport(db, { manifest, plan }));
  console.log(`Imported ${result.imported} quotes. The dataset is inactive.`);
}

if (require.main === module) main().catch(() => { console.error('Import failed.'); process.exit(1); });

module.exports = { parseArgs };
