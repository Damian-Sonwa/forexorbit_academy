/**
 * Unique certificate per student and course (lib/certificate-indexes.js).
 *
 *   node scripts/certificate-indexes.js --database <name>            read-only: data check + index state
 *   node scripts/certificate-indexes.js --database <name> --apply    build the index if the check passes
 *   ... --connection-file <path>   read CERTIFICATE_INDEX_MONGO_URI from a local file kept OUTSIDE the repository
 *
 * The connection string comes from CERTIFICATE_INDEX_MONGO_URI (a privileged account, from --connection-file
 * or the shell), else MONGO_URI (or MONGODB_URI). It is never printed: only the variable name used is
 * reported. Output is counts only. `--apply` refuses when duplicates or non-string ids exist, when an index with the same name
 * or key but different options is already there, or when the indexes cannot be read.
 *
 * The application's own database role (forexorbitAppRole) may neither list nor create indexes, so
 * its check reports the index state as "unknown". Building the index needs an account with the
 * listIndexes and createIndex privileges on this collection (for example the owner's Atlas admin
 * user), set in the shell's environment for that one command, after an Atlas snapshot is confirmed.
 * The script only ever creates this one index; it never drops or changes another.
 */
const { CERTIFICATE_UNIQUE_INDEX, certificateIndexReport } = require('../lib/certificate-indexes');

function parseArgs(argv) {
  const args = argv.slice(2);
  const value = (flag) => {
    const at = args.indexOf(flag);
    return at !== -1 ? String(args[at + 1] || '').trim() : null;
  };
  const database = value('--database') || '';
  if (!database || database.startsWith('--')) return { error: 'Pass the target database name with --database <name>.' };
  const envFile = value('--connection-file');
  if (envFile !== null && (!envFile || envFile.startsWith('--'))) return { error: 'Pass a file path with --connection-file <path>.' };
  return { database, apply: args.includes('--apply'), envFile };
}

/**
 * Connection settings. With --connection-file only that file's CERTIFICATE_INDEX_MONGO_URI is used: no
 * fallback to the shell, .env, .env.local or the application's MONGO_URI. The file must be outside
 * any Git working tree, so a privileged connection string cannot end up committed by accident.
 * Without --connection-file (development and tests) the shell's variables are used.
 */
function connectionFrom({ env, envFile, readFile, insideGitWorktree }) {
  if (envFile) {
    if (insideGitWorktree(envFile)) return { error: 'The --connection-file must be outside any Git repository.' };
    let text;
    try {
      text = readFile(envFile);
    } catch {
      return { error: 'The --connection-file could not be read.' };
    }
    const uri = String(require('dotenv').parse(text).CERTIFICATE_INDEX_MONGO_URI || '').trim();
    if (!uri) return { error: 'The --connection-file does not define CERTIFICATE_INDEX_MONGO_URI (no other variable is used).' };
    return { uri, variable: 'CERTIFICATE_INDEX_MONGO_URI (from --connection-file)' };
  }
  const source = { ...env };
  for (const name of ['CERTIFICATE_INDEX_MONGO_URI', 'MONGO_URI', 'MONGODB_URI']) {
    const uri = String(source[name] || '').trim();
    if (uri) return { uri, variable: name };
  }
  return { error: 'No connection: set CERTIFICATE_INDEX_MONGO_URI (or MONGO_URI).' };
}

const PRODUCTION_DATABASE = 'Forex_elearning';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function hostsOf(uri) {
  const match = /^mongodb(?:\+srv)?:\/\/(?:[^@/]*@)?([^/?]+)/.exec(String(uri));
  return match ? match[1].split(',').map((h) => h.replace(/:\d+$/, '').toLowerCase()) : [];
}

/**
 * Target check before connecting. The production database is only ever reached on Atlas
 * (*.mongodb.net), and a production run (--connection-file) only ever targets the production database.
 * Local servers are for disposable databases ending in "_acceptance" or "_test".
 * Returns { ok, hostKind } or { ok: false, error }. Never includes the connection string.
 */
function decideTarget({ uri, database, envFile }) {
  const hosts = hostsOf(uri);
  if (!hosts.length) return { ok: false, error: 'The connection string has no host.' };
  const atlas = hosts.every((h) => h.endsWith('.mongodb.net'));
  const local = hosts.every((h) => LOCAL_HOSTS.has(h));
  const disposable = /_(acceptance|test)$/.test(database);
  if (envFile && database !== PRODUCTION_DATABASE) {
    return { ok: false, error: `A production run (--connection-file) only targets ${PRODUCTION_DATABASE}.` };
  }
  if (database === PRODUCTION_DATABASE && !atlas) {
    return { ok: false, error: `${PRODUCTION_DATABASE} is only reached on the Atlas cluster (*.mongodb.net); refusing this host.` };
  }
  if (local && !disposable) return { ok: false, error: 'A local server is only used for databases ending in "_acceptance" or "_test".' };
  if (!atlas && !local) return { ok: false, error: 'Unrecognised host: neither the Atlas cluster nor a local server.' };
  return { ok: true, hostKind: atlas ? 'Atlas cluster (*.mongodb.net)' : 'local server' };
}

/**
 * present | missing | conflicting | unknown. `unknown` means the account may not list indexes
 * (the application's own role cannot); it is never reported as `missing`.
 */
async function indexState(db) {
  let existing;
  try {
    existing = await db.collection('certificates').indexes();
  } catch (error) {
    // A collection that does not exist yet has no indexes: the state is known ("missing").
    // Any other failure (for example "not authorized") leaves it unknown.
    if (error && (error.code === 26 || error.codeName === 'NamespaceNotFound')) return 'missing';
    return 'unknown';
  }
  const def = CERTIFICATE_UNIQUE_INDEX;
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const byName = existing.find((i) => i.name === def.options.name);
  if (byName) {
    const exact = same(byName.key, def.key) && byName.unique === true && !byName.sparse && !byName.partialFilterExpression;
    return exact ? 'present' : 'conflicting';
  }
  if (existing.find((i) => same(i.key, def.key))) return 'conflicting';
  return 'missing';
}

async function run(db, { apply, log = console.log }) {
  const report = await certificateIndexReport(db);
  const state = await indexState(db);
  log(`certificates: ${JSON.stringify(report)}; index ${CERTIFICATE_UNIQUE_INDEX.options.name}: ${state}`);
  if (state === 'unknown') {
    log('This account cannot list indexes, so the index state is unknown. Use an account allowed to list and create indexes on this collection.');
  }
  if (!apply) return { ok: true, report, state };
  if (state === 'present') return { ok: true, report, state };
  if (state === 'unknown') {
    log('Refusing to build: the existing indexes could not be read.');
    return { ok: false, report, state };
  }
  if (state === 'conflicting' || !report.safeToBuild) {
    log('Refusing to build: fix the reported data or index conflict first.');
    return { ok: false, report, state };
  }
  await db.collection('certificates').createIndex(CERTIFICATE_UNIQUE_INDEX.key, CERTIFICATE_UNIQUE_INDEX.options);
  const after = await indexState(db);
  log(`index ${CERTIFICATE_UNIQUE_INDEX.options.name}: ${after}`);
  return { ok: after === 'present', report, state: after };
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.error) {
    console.error(args.error);
    process.exit(1);
  }
  // A production run (--connection-file) reads nothing else: no .env from the current directory.
  if (!args.envFile) require('dotenv').config({ quiet: true });
  const fs = require('fs');
  const path = require('path');
  const connection = connectionFrom({
    env: process.env,
    envFile: args.envFile,
    readFile: (file) => fs.readFileSync(file, 'utf8'),
    insideGitWorktree: (file) => {
      for (let dir = path.dirname(path.resolve(file)); ; dir = path.dirname(dir)) {
        if (fs.existsSync(path.join(dir, '.git'))) return true;
        if (path.dirname(dir) === dir) return false;
      }
    },
  });
  if (connection.error) {
    console.error(connection.error);
    process.exit(1);
  }
  const uri = connection.uri;
  const target = decideTarget({ uri, database: args.database, envFile: args.envFile });
  if (!target.ok) {
    console.error(`Refused: ${target.error}`);
    process.exit(1);
  }
  console.log(`Connection from ${connection.variable} (not printed). Host: ${target.hostKind}.`);
  const { MongoClient } = require('mongodb');
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
  try {
    await client.connect();
    const db = client.db(args.database);
    // The production collection must already exist; the script never creates it.
    if (args.database === PRODUCTION_DATABASE) {
      const found = await db.listCollections({ name: 'certificates' }, { nameOnly: true }).toArray();
      if (!found.length) {
        console.error(`Refused: ${PRODUCTION_DATABASE}.certificates was not found.`);
        process.exitCode = 1;
        return;
      }
    }
    console.log(`Target: ${args.database}.certificates. Mode: ${args.apply ? 'apply' : 'read-only'}.`);
    const result = await run(db, { apply: args.apply });
    process.exitCode = result.ok ? 0 : 1;
  } finally {
    await client.close().catch(() => {});
  }
}

if (require.main === module) main().catch(() => { console.error('Certificate index script failed.'); process.exit(1); });

module.exports = { connectionFrom, decideTarget, hostsOf, indexState, parseArgs, run };
