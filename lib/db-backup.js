'use strict';

/**
 * Logical database backup and restore (Phase 15).
 *
 * Replaces scripts/backup-data.js and scripts/restore-data.js, which wrote plain JSON (ObjectIds,
 * dates and Decimal128 ledger amounts lost their types), saved no indexes, and restored over the
 * production database name after deleting every document.
 *
 * Format: one directory per backup:
 *   manifest.json             { format, createdAt, sourceDb, collections: [{ name, count, sha256,
 *                               indexes, options }] }
 *   <collection>.ndjson       one Extended JSON (canonical) document per line, so every BSON type
 *                             (ObjectId, Date, Decimal128, Long, Binary) round-trips exactly
 * Documents are streamed with a cursor (no whole-collection arrays in memory).
 *
 * Restore safety:
 *   - the target database name may never be the production name (Forex_elearning) and must end
 *     in _restore, _test or _drill: disaster recovery restores to a new database, verifies it, and
 *     then repoints the application (docs/audits/phase-15-production-readiness.md);
 *   - a target that already has data is refused unless dropTarget is set;
 *   - every file's checksum is checked before anything is written;
 *   - indexes are recreated with their options, and counts are verified after the restore.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { EJSON } = require('mongodb').BSON;

const FORMAT = 'forexorbit-backup-v1';
const PRODUCTION_DB = 'Forex_elearning';
const SAFE_TARGET = /^[A-Za-z0-9_-]+_(restore|test|drill)$/;
const BATCH = 500;

function safeName(name) {
  if (!/^[A-Za-z0-9_.-]{1,120}$/.test(name) || name.startsWith('system.')) throw new Error(`Unsupported collection name: ${name}`);
  return name;
}

async function backupDatabase(db, outDir, { now = new Date() } = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  const manifest = { format: FORMAT, createdAt: now.toISOString(), sourceDb: db.databaseName, collections: [] };
  const infos = (await db.listCollections({}, { nameOnly: false }).toArray()).filter((c) => c.type !== 'view' && !c.name.startsWith('system.')).sort((a, b) => a.name.localeCompare(b.name));
  for (const info of infos) {
    const name = safeName(info.name);
    const file = path.join(outDir, `${name}.ndjson`);
    const hash = crypto.createHash('sha256');
    const out = fs.createWriteStream(file);
    let count = 0;
    for await (const doc of db.collection(name).find({}, { batchSize: BATCH })) {
      const line = `${EJSON.stringify(doc, { relaxed: false })}\n`;
      hash.update(line);
      if (!out.write(line)) await new Promise((r) => out.once('drain', r));
      count += 1;
    }
    await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
    const indexes = (await db.collection(name).listIndexes().toArray()).filter((i) => i.name !== '_id_').map(({ v, ns, ...rest }) => rest); // eslint-disable-line no-unused-vars
    manifest.collections.push({ name, count, sha256: hash.digest('hex'), indexes: EJSON.serialize(indexes, { relaxed: false }), options: EJSON.serialize(info.options || {}, { relaxed: false }) });
  }
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}

async function fileSha256(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

/** Checks a backup directory without touching any database. */
async function verifyBackup(dir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  if (manifest.format !== FORMAT) throw new Error('Not a forexorbit-backup-v1 directory.');
  const problems = [];
  for (const c of manifest.collections) {
    const file = path.join(dir, `${safeName(c.name)}.ndjson`);
    if (!fs.existsSync(file)) problems.push(`${c.name}: file missing`);
    else if ((await fileSha256(file)) !== c.sha256) problems.push(`${c.name}: checksum mismatch`);
  }
  return { ok: problems.length === 0, problems, manifest };
}

async function restoreDatabase(client, dir, targetDbName, { dropTarget = false } = {}) {
  if (targetDbName === PRODUCTION_DB) throw new Error('Refusing to restore into the production database name. Restore to <name>_restore, verify, then repoint the application.');
  if (!SAFE_TARGET.test(targetDbName)) throw new Error('The target database name must end in _restore, _test or _drill.');
  const checked = await verifyBackup(dir);
  if (!checked.ok) throw new Error(`Backup failed verification: ${checked.problems.join('; ')}`);
  const db = client.db(targetDbName);
  const existing = await db.listCollections({}, { nameOnly: true }).toArray();
  if (existing.length && !dropTarget) throw new Error(`Target ${targetDbName} already has ${existing.length} collections. Pass dropTarget to replace it.`);
  if (existing.length) await db.dropDatabase();
  const report = [];
  for (const c of checked.manifest.collections) {
    const name = safeName(c.name);
    const options = EJSON.deserialize(c.options || {}, { relaxed: false });
    await db.createCollection(name, options);
    const coll = db.collection(name);
    const rl = readline.createInterface({ input: fs.createReadStream(path.join(dir, `${name}.ndjson`)), crlfDelay: Infinity });
    let batch = [];
    let restored = 0;
    for await (const line of rl) {
      if (!line) continue;
      batch.push(EJSON.parse(line, { relaxed: false }));
      if (batch.length >= BATCH) {
        await coll.insertMany(batch, { ordered: true });
        restored += batch.length;
        batch = [];
      }
    }
    if (batch.length) {
      await coll.insertMany(batch, { ordered: true });
      restored += batch.length;
    }
    // Indexes after the data: faster, and a unique index proves the restored data still satisfies it.
    const indexes = EJSON.deserialize(c.indexes || [], { relaxed: false });
    for (const { key, name: indexName, ...opts } of indexes) await coll.createIndex(key, { name: indexName, ...opts });
    const count = await coll.countDocuments({});
    report.push({ name, expected: c.count, restored: count, indexes: indexes.length, ok: count === c.count });
  }
  return { ok: report.every((r) => r.ok), targetDb: targetDbName, collections: report };
}

module.exports = { FORMAT, PRODUCTION_DB, SAFE_TARGET, backupDatabase, restoreDatabase, verifyBackup };
