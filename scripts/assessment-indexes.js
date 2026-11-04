/**
 * Phase 9 assessment indexes (lib/assessment-indexes.js).
 *
 *   node scripts/assessment-indexes.js --database <name>            read-only: state + duplicates
 *   node scripts/assessment-indexes.js --database <name> --apply    build the missing ones
 *
 * The connection string comes from MONGO_URI (or MONGODB_URI) and is never printed. `--apply`
 * refuses while an index conflicts or duplicates exist for a unique index; it never drops an
 * index and never changes or deletes a document.
 */
const { ensureAssessmentIndexes } = require('../lib/assessment-indexes');

function parseArgs(argv) {
  const args = argv.slice(2);
  const at = args.indexOf('--database');
  const database = at !== -1 ? String(args[at + 1] || '').trim() : '';
  if (!database || database.startsWith('--')) return { error: 'Pass the target database name with --database <name>.' };
  return { database, apply: args.includes('--apply') };
}

async function run(db, { apply, log = console.log }) {
  const result = await ensureAssessmentIndexes(db, { apply });
  for (const row of result.report) {
    log(`${row.id} ${row.collection} ${row.name}: ${row.state}${row.duplicates ? ` (${row.duplicates} duplicate group(s))` : ''}`);
  }
  if (result.blocked) log(`Refusing to apply: ${result.blocked.join(', ')} need review first (conflict or duplicates).`);
  if (result.built.length) log(`Built: ${result.built.join(', ')}.`);
  if (apply && result.ok) log('Verified: every assessment index is present.');
  return result;
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

if (require.main === module) main().catch(() => { console.error('Index script failed.'); process.exit(1); });

module.exports = { parseArgs, run };
