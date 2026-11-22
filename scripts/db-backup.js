#!/usr/bin/env node
'use strict';

/**
 * Logical backup of one database (Phase 15; lib/db-backup.js). Read-only on the source.
 *
 *   BACKUP_SOURCE_URI=<connection string> node scripts/db-backup.js --db <name> [--out <dir>]
 *
 * The connection string is read only from BACKUP_SOURCE_URI (never printed). Output defaults to
 * backups/<db>-<timestamp>/ (git-ignored). Use a read-only database user for production backups.
 */

const path = require('path');
const { MongoClient } = require('mongodb');
const { backupDatabase } = require('../lib/db-backup');

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
};

(async () => {
  const uri = (process.env.BACKUP_SOURCE_URI || '').trim();
  const dbName = arg('--db');
  if (!uri || !dbName) {
    console.error('Usage: BACKUP_SOURCE_URI=... node scripts/db-backup.js --db <name> [--out <dir>]');
    process.exit(2);
  }
  const out = arg('--out') || path.join(__dirname, '..', 'backups', `${dbName}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  const client = new MongoClient(uri, { readPreference: 'secondaryPreferred' });
  try {
    await client.connect();
    const manifest = await backupDatabase(client.db(dbName), out);
    const total = manifest.collections.reduce((s, c) => s + c.count, 0);
    console.log(JSON.stringify({ event: 'dbBackup', result: 'ok', out, collections: manifest.collections.length, documents: total }));
  } catch (error) {
    console.error(JSON.stringify({ event: 'dbBackup', result: 'failed', reason: error && error.message ? error.message.replace(/mongodb(\+srv)?:\/\/\S+/g, '<uri>') : 'unknown' }));
    process.exitCode = 1;
  } finally {
    await client.close().catch(() => undefined);
  }
})();
