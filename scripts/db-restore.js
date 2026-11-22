#!/usr/bin/env node
'use strict';

/**
 * Restores a backup made by scripts/db-backup.js into a NEW database (Phase 15; lib/db-backup.js).
 *
 *   RESTORE_TARGET_URI=<connection string> node scripts/db-restore.js --from <backup dir> \
 *     --db <name>_restore [--drop-target]
 *
 * Refuses the production database name and any name not ending in _restore, _test or _drill.
 * Verifies every checksum before writing, recreates indexes, and checks counts afterwards.
 * Disaster recovery: restore here, verify (docs/audits/phase-15-production-readiness.md), then
 * repoint MONGODB_DB_NAME / the connection string; never restore over the live database.
 */

const { MongoClient } = require('mongodb');
const { restoreDatabase, verifyBackup } = require('../lib/db-backup');

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
};

(async () => {
  const from = arg('--from');
  const dbName = arg('--db');
  if (!from || !dbName) {
    console.error('Usage: RESTORE_TARGET_URI=... node scripts/db-restore.js --from <dir> --db <name>_restore [--drop-target] [--verify-only]');
    process.exit(2);
  }
  if (process.argv.includes('--verify-only')) {
    const checked = await verifyBackup(from);
    console.log(JSON.stringify({ event: 'dbBackupVerify', ok: checked.ok, problems: checked.problems, collections: checked.manifest.collections.length }));
    process.exit(checked.ok ? 0 : 1);
  }
  const uri = (process.env.RESTORE_TARGET_URI || '').trim();
  if (!uri) {
    console.error('RESTORE_TARGET_URI is required.');
    process.exit(2);
  }
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const report = await restoreDatabase(client, from, dbName, { dropTarget: process.argv.includes('--drop-target') });
    console.log(JSON.stringify({ event: 'dbRestore', ...report }, null, 2));
    process.exitCode = report.ok ? 0 : 1;
  } catch (error) {
    console.error(JSON.stringify({ event: 'dbRestore', result: 'failed', reason: error && error.message ? error.message.replace(/mongodb(\+srv)?:\/\/\S+/g, '<uri>') : 'unknown' }));
    process.exitCode = 1;
  } finally {
    await client.close().catch(() => undefined);
  }
})();
