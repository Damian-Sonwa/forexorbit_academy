/**
 * Indexes for email password-reset links (passwordResetTokens, lib/password-reset-token.js):
 *   T1 uniq_reset_token_hash       one record per token hash
 *   T2 uniq_active_reset_per_user  at most one live link per account (partial: status active)
 *   T3 ttl_reset_token_expiry      removes links a day after they expire
 *
 *   node scripts/password-reset-indexes.js --database <name>            read-only: inspect and report
 *   node scripts/password-reset-indexes.js --database <name> --apply    create the missing ones
 *
 * The reset code works without these indexes; they add database guarantees and cleanup. This tool
 * touches nothing but T1-T3: it never builds, changes or drops any other index, never drops T1-T3,
 * and never changes documents. A differently defined index is reported as a conflict and nothing
 * is created. Running --apply again when all are present does nothing.
 *
 * The production database (Forex_elearning) is refused unless the name is repeated with
 * --confirm-production Forex_elearning. The connection string comes from MONGO_URI (or
 * MONGODB_URI) and is never printed. The app's database user cannot create indexes; run this as
 * an administrator.
 */
const { RESET_TOKENS_COLLECTION, RESET_TOKEN_INDEXES } = require('../lib/password-reset-token');
const { compareIndex } = require('./course-payment-indexes');

const PRODUCTION_DB_NAME = 'Forex_elearning';

function parseArgs(argv) {
  const args = argv.slice(2);
  const valueOf = (flag) => {
    const at = args.indexOf(flag);
    return at !== -1 ? String(args[at + 1] || '').trim() : '';
  };
  if (args.includes('--rollback') || args.includes('--drop')) return { error: 'This tool never drops indexes.' };
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
  const exists = (await db.listCollections({ name: RESET_TOKENS_COLLECTION }, { nameOnly: true }).toArray()).length > 0;
  const indexes = exists ? await db.collection(RESET_TOKENS_COLLECTION).indexes() : [];
  const states = RESET_TOKEN_INDEXES.map((definition) => ({ definition, ...compareIndex(definition, indexes) }));
  const documents = exists ? await db.collection(RESET_TOKENS_COLLECTION).estimatedDocumentCount() : 0;
  return { exists, indexes, states, documents };
}

function report(result, log) {
  log(`collection: ${RESET_TOKENS_COLLECTION} (${result.exists ? 'exists' : 'absent'}) | documents: ${result.documents}`);
  log(`existing indexes: ${result.indexes.map((item) => item.name).join(', ') || '(none)'}`);
  for (const item of result.states) {
    log(`${item.definition.id} ${item.definition.options.name}: ${item.state}${item.detail ? ` (${item.detail})` : ''} | ${describe(item.definition)}`);
  }
}

/** Inspects, and with mode 'apply' creates the missing indexes. Never drops or replaces. */
async function run(db, { mode, log = console.log }) {
  const before = await inspect(db);
  report(before, log);

  const conflicts = before.states.filter((item) => item.state === 'conflict');
  if (conflicts.length) {
    return {
      ok: false,
      mode,
      state: 'conflict',
      error: `Conflicting index for ${conflicts.map((item) => item.definition.id).join(', ')}. Nothing was changed. Review it by hand; this tool never drops or replaces indexes.`,
    };
  }
  const missing = before.states.filter((item) => item.state === 'missing');
  if (!missing.length) {
    log('All password-reset indexes are present with the expected definitions. Nothing to do.');
    return { ok: true, mode, state: 'present', created: [] };
  }
  if (mode !== 'apply') {
    log(`Would create: ${missing.map((item) => item.definition.options.name).join(', ')}. Run again with --apply to create them.`);
    return { ok: true, mode, state: 'missing', created: [] };
  }

  const created = [];
  for (const { definition } of missing) {
    await db.collection(RESET_TOKENS_COLLECTION).createIndex(definition.key, definition.options);
    created.push(definition.options.name);
  }
  const after = await inspect(db);
  const notPresent = after.states.filter((item) => item.state !== 'present');
  if (notPresent.length) {
    return { ok: false, mode, state: 'unverified', created, error: `Could not verify: ${notPresent.map((item) => item.definition.id).join(', ')}.` };
  }
  log(`created and verified: ${created.join(', ')}`);
  return { ok: true, mode, state: 'present', created };
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
