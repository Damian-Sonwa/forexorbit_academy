/**
 * R1 only: the TTL index that removes finished shared rate-limit windows (rateLimits.expiresAt).
 *
 *   node scripts/rate-limit-index.js --database <name>            read-only: inspect and report
 *   node scripts/rate-limit-index.js --database <name> --apply    create R1 if it is missing
 *
 * Touches nothing but R1 on rateLimits: it never builds, changes or drops any other index, never
 * drops R1, and never changes documents. A differently defined index is reported as a conflict
 * and left alone. Running --apply again when R1 is present does nothing.
 *
 * The production database (Forex_elearning) is refused unless the name is repeated with
 * --confirm-production Forex_elearning. The connection string comes from MONGO_URI (or
 * MONGODB_URI) and is never printed.
 */
const { RATE_LIMIT_COLLECTION, RATE_LIMIT_TTL_INDEX } = require('../lib/shared-rate-limit');
const { compareIndex } = require('./course-payment-indexes');

const PRODUCTION_DB_NAME = 'Forex_elearning';

function parseArgs(argv) {
  const args = argv.slice(2);
  const valueOf = (flag) => {
    const at = args.indexOf(flag);
    return at !== -1 ? String(args[at + 1] || '').trim() : '';
  };
  if (args.includes('--rollback')) return { error: 'This tool never drops indexes.' };
  const known = new Set(['--database', '--apply', '--confirm-production']);
  const unknown = args.filter((arg, i) => arg.startsWith('--') && !known.has(arg) && !known.has(args[i - 1]));
  if (unknown.length) return { error: `Unknown option: ${unknown.join(' ')}` };
  const database = valueOf('--database');
  if (!database || database.startsWith('--')) return { error: 'Pass the target database name with --database <name>.' };
  const confirm = valueOf('--confirm-production');
  if (database === PRODUCTION_DB_NAME && confirm !== PRODUCTION_DB_NAME) {
    return { error: `${PRODUCTION_DB_NAME} is the production database. Repeat its name with --confirm-production ${PRODUCTION_DB_NAME} to target it.` };
  }
  return { database, mode: args.includes('--apply') ? 'apply' : 'inspect' };
}

const describe = (definition) => `${JSON.stringify(definition.key)} ${JSON.stringify(definition.options)}`;

async function inspect(db) {
  const exists = (await db.listCollections({ name: RATE_LIMIT_COLLECTION }, { nameOnly: true }).toArray()).length > 0;
  const indexes = exists ? await db.collection(RATE_LIMIT_COLLECTION).indexes() : [];
  const state = compareIndex(RATE_LIMIT_TTL_INDEX, indexes);
  let documents = 0;
  let expired = 0;
  if (exists) {
    const col = db.collection(RATE_LIMIT_COLLECTION);
    [documents, expired] = await Promise.all([
      col.estimatedDocumentCount(),
      col.countDocuments({ expiresAt: { $lte: new Date() } }),
    ]);
  }
  return { exists, indexes, state, documents, expired };
}

function report(result, log) {
  log(`collection: ${RATE_LIMIT_COLLECTION} (${result.exists ? 'exists' : 'absent'}) | documents: ${result.documents} | past expiresAt: ${result.expired}`);
  log(`required: ${RATE_LIMIT_TTL_INDEX.id} ${RATE_LIMIT_TTL_INDEX.options.name} ${describe(RATE_LIMIT_TTL_INDEX)}`);
  const others = result.indexes.map((item) => item.name).join(', ') || '(none)';
  log(`existing indexes on ${RATE_LIMIT_COLLECTION}: ${others}`);
  log(`state: ${result.state.state}${result.state.detail ? ` (${result.state.detail})` : ''}`);
}

/** Inspects, and with mode 'apply' creates R1 when it is missing. Never drops or replaces. */
async function run(db, { mode, log = console.log }) {
  const before = await inspect(db);
  report(before, log);

  if (before.state.state === 'conflict') {
    return {
      ok: false,
      mode,
      state: 'conflict',
      error: 'An index conflicts with R1. Nothing was changed. Review it by hand; this tool never drops or replaces indexes.',
    };
  }
  if (before.state.state === 'present') {
    log('R1 is present with the expected definition. Nothing to do.');
    return { ok: true, mode, state: 'present', created: false };
  }
  if (mode !== 'apply') {
    log(`Would create on ${RATE_LIMIT_COLLECTION}: ${RATE_LIMIT_TTL_INDEX.options.name}. Run again with --apply to create it.`);
    return { ok: true, mode, state: 'missing', created: false };
  }

  await db.collection(RATE_LIMIT_COLLECTION).createIndex(RATE_LIMIT_TTL_INDEX.key, RATE_LIMIT_TTL_INDEX.options);
  const after = await inspect(db);
  if (after.state.state !== 'present') {
    return { ok: false, mode, state: after.state.state, error: 'R1 could not be verified after creation.' };
  }
  log(`created and verified ${RATE_LIMIT_COLLECTION}.${RATE_LIMIT_TTL_INDEX.options.name}`);
  return { ok: true, mode, state: 'present', created: true };
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.error) {
    console.error(args.error);
    process.exit(2);
  }
  require('dotenv').config({ quiet: true });
  const uri = String(process.env.MONGO_URI || process.env.MONGODB_URI || '').trim();
  if (!uri) {
    console.error('Set MONGO_URI (or MONGODB_URI) for the target cluster.');
    process.exit(2);
  }
  const { MongoClient } = require('mongodb');
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
  try {
    await client.connect();
    const db = client.db(args.database);
    const status = await db.command({ connectionStatus: 1 });
    const users = (status.authInfo.authenticatedUsers || []).map((item) => item.user).join(', ') || '(none)';
    console.log(`database: ${args.database} | signed in as: ${users} | mode: ${args.mode}`);
    const result = await run(db, { mode: args.mode });
    if (!result.ok) {
      console.error(result.error);
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`Failed: ${error.codeName || error.name || 'error'}`);
    process.exitCode = 1;
  } finally {
    await client.close().catch(() => {});
  }
}

if (require.main === module) main();

module.exports = { PRODUCTION_DB_NAME, inspect, parseArgs, run };
