/**
 * Indexes for the `sessions` collection (lib/session-indexes.js).
 *
 *   node scripts/session-indexes.js --database <name>                read-only: state of each index
 *   node scripts/session-indexes.js --database <name> --apply        build the missing ones
 *   ... --connection-file <path>   read CERTIFICATE_INDEX_MONGO_URI from a local file kept OUTSIDE the repository
 *
 * Same connection and target rules as scripts/certificate-indexes.js (shared code):
 *   - with --connection-file only that file's CERTIFICATE_INDEX_MONGO_URI is read (no .env fallback),
 *     and the file must be outside any Git working tree;
 *   - otherwise CERTIFICATE_INDEX_MONGO_URI, else MONGO_URI (or MONGODB_URI) from the shell;
 *   - Forex_elearning only on the Atlas cluster (*.mongodb.net); local servers only for databases
 *     ending in "_acceptance" or "_test".
 * The connection string is never printed. The script never drops or changes an index, and refuses
 * to build when an index state is unknown (the account cannot list indexes) or conflicting.
 * Building needs an account with listIndexes and createIndex on `sessions`: not the app's role.
 */
const { connectionFrom, decideTarget, parseArgs } = require('./certificate-indexes');
const { ensureSessionIndexes } = require('../lib/session-indexes');

const PRODUCTION_DATABASE = 'Forex_elearning';

async function main() {
  const args = parseArgs(process.argv);
  if (args.error) {
    console.error(args.error);
    process.exit(1);
  }
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
  const target = decideTarget({ uri: connection.uri, database: args.database, envFile: args.envFile });
  if (!target.ok) {
    console.error(`Refused: ${target.error}`);
    process.exit(1);
  }
  console.log(`Connection from ${connection.variable} (not printed). Host: ${target.hostKind}.`);
  const { MongoClient } = require('mongodb');
  const client = new MongoClient(connection.uri, { serverSelectionTimeoutMS: 15000 });
  try {
    await client.connect();
    const db = client.db(args.database);
    // In production the database must already exist (the collection may not yet: it is created by
    // the first index build or the first sign-in).
    if (args.database === PRODUCTION_DATABASE) {
      const found = await db.listCollections({ name: 'users' }, { nameOnly: true }).toArray();
      if (!found.length) {
        console.error(`Refused: ${PRODUCTION_DATABASE}.users was not found; wrong database?`);
        process.exitCode = 1;
        return;
      }
    }
    console.log(`Target: ${args.database}.sessions. Mode: ${args.apply ? 'apply' : 'read-only'}.`);
    const result = await ensureSessionIndexes(db, { apply: args.apply, log: console.log });
    if (result.built.length) console.log(`Built: ${result.built.join(', ')}`);
    process.exitCode = result.ok ? 0 : 1;
  } finally {
    await client.close().catch(() => {});
  }
}

if (require.main === module) main().catch(() => { console.error('Session index script failed.'); process.exit(1); });
