/**
 * Read-path indexes for the learning collections (lib/learning-indexes.js).
 *
 *   node scripts/learning-indexes.js --database <name>              read-only: report each index
 *   node scripts/learning-indexes.js --database <name> --apply      build the missing ones
 *   node scripts/learning-indexes.js --database <name> --rollback   drop only these indexes
 *
 * The connection string comes from MONGO_URI (or MONGODB_URI) and is never printed. The indexes
 * are non-unique, so building them never changes or rejects a document. `--apply` refuses when an
 * existing index has the same name or key with different options.
 */
const { LEARNING_INDEXES } = require('../lib/learning-indexes');

function parseArgs(argv) {
  const args = argv.slice(2);
  const at = args.indexOf('--database');
  const database = at !== -1 ? String(args[at + 1] || '').trim() : '';
  const apply = args.includes('--apply');
  const rollback = args.includes('--rollback');
  if (!database || database.startsWith('--')) return { error: 'Pass the target database name with --database <name>.' };
  if (apply && rollback) return { error: 'Use either --apply or --rollback, not both.' };
  return { database, mode: apply ? 'apply' : rollback ? 'rollback' : 'plan' };
}

const sameKey = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** present | missing | conflicting (same name or key with a different definition). */
function compareIndex(definition, existing) {
  const byName = existing.find((index) => index.name === definition.options.name);
  if (byName) return sameKey(byName.key, definition.key) && !byName.unique ? 'present' : 'conflicting';
  const byKey = existing.find((index) => sameKey(index.key, definition.key));
  if (byKey) return 'conflicting';
  return 'missing';
}

async function indexStates(db) {
  const names = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
  const states = [];
  for (const definition of LEARNING_INDEXES) {
    const existing = names.has(definition.collection) ? await db.collection(definition.collection).indexes() : [];
    states.push({ definition, state: names.has(definition.collection) ? compareIndex(definition, existing) : 'no collection' });
  }
  return states;
}

async function run(db, { mode, log = console.log }) {
  const states = await indexStates(db);
  for (const { definition, state } of states) {
    log(`${definition.id} ${definition.collection} ${JSON.stringify(definition.key)} ${definition.options.name}: ${state}`);
  }
  if (mode === 'plan') return { ok: true, states };
  if (mode === 'apply') {
    const conflicts = states.filter((s) => s.state === 'conflicting');
    if (conflicts.length) {
      log(`Refusing to apply: ${conflicts.map((s) => s.definition.id).join(', ')} conflict with existing indexes.`);
      return { ok: false, states };
    }
    for (const { definition, state } of states) {
      if (state !== 'missing') continue;
      await db.collection(definition.collection).createIndex(definition.key, definition.options);
      log(`Built ${definition.id} (${definition.options.name}).`);
    }
    const after = await indexStates(db);
    const missing = after.filter((s) => s.state === 'missing' || s.state === 'conflicting');
    log(missing.length ? `Not verified: ${missing.map((s) => s.definition.id).join(', ')}.` : 'Verified: every learning index is present.');
    return { ok: missing.length === 0, states: after };
  }
  for (const { definition, state } of states) {
    if (state !== 'present') continue;
    await db.collection(definition.collection).dropIndex(definition.options.name);
    log(`Dropped ${definition.id} (${definition.options.name}).`);
  }
  return { ok: true, states: await indexStates(db) };
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
    console.log(`Database: ${args.database}. Mode: ${args.mode}.`);
    const result = await run(client.db(args.database), { mode: args.mode });
    process.exitCode = result.ok ? 0 : 1;
  } finally {
    await client.close().catch(() => {});
  }
}

if (require.main === module) main().catch(() => { console.error('Index script failed.'); process.exit(1); });

module.exports = { parseArgs, compareIndex, run };
