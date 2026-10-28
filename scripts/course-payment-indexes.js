/**
 * Course payment unique indexes I1–I6 (docs/audits/course-payment-index-migration-plan.md).
 *
 *   node scripts/course-payment-indexes.js --database <name>              read-only: scans and plan
 *   node scripts/course-payment-indexes.js --database <name> --apply      build missing indexes
 *   node scripts/course-payment-indexes.js --database <name> --rollback   drop only these indexes
 *
 * The connection string comes from MONGO_URI (or MONGODB_URI) and is never printed. `--apply`
 * refuses while any duplicate scan reports a group or an existing index conflicts. No document
 * is ever changed.
 */
const { COURSE_PAYMENT_INDEXES, PENDING_COURSE_INTENT } = require('../lib/course-payment-indexes');
const { COLLECTIONS } = require('../lib/course-payment');

const MAX_LISTED_GROUPS = 10;

const asText = (field) => ({ $toString: `$${field}` });
const duplicateGroups = [{ $match: { n: { $gt: 1 } } }];

const SCANS = Object.freeze([
  {
    id: 'S1',
    index: 'I1',
    collection: COLLECTIONS.intents,
    what: 'intents sharing a reference (rows without one count as a shared null)',
    pipeline: [{ $group: { _id: { r: '$reference' }, n: { $sum: 1 } } }, ...duplicateGroups],
  },
  {
    id: 'S2',
    index: 'I2',
    collection: COLLECTIONS.intents,
    what: 'student and course pairs with more than one pending course intent, or a course intent with no status',
    pipeline: [
      { $match: { kind: PENDING_COURSE_INTENT.kind, $or: [{ status: PENDING_COURSE_INTENT.status }, { status: { $exists: false } }] } },
      {
        $group: {
          _id: { u: asText('userId'), c: asText('courseId') },
          n: { $sum: 1 },
          missingStatus: { $sum: { $cond: [{ $eq: [{ $type: '$status' }, 'missing'] }, 1, 0] } },
        },
      },
      { $match: { $or: [{ n: { $gt: 1 } }, { missingStatus: { $gt: 0 } }] } },
    ],
  },
  {
    id: 'S3',
    index: 'I3',
    collection: COLLECTIONS.payments,
    what: 'payments sharing a reference (rows without one count as a shared null)',
    pipeline: [{ $group: { _id: { r: '$reference' }, n: { $sum: 1 } } }, ...duplicateGroups],
  },
  {
    id: 'S4',
    index: 'I4',
    collection: COLLECTIONS.courseAccess,
    what: 'access rows for one student and course, compared as text so mixed id types show up',
    pipeline: pairScan(),
  },
  {
    id: 'S5',
    index: 'I5',
    collection: COLLECTIONS.coursePurchases,
    what: 'purchase rows for one student and course, compared as text so mixed id types show up',
    pipeline: pairScan(),
  },
  {
    id: 'S6',
    index: 'I6',
    collection: COLLECTIONS.exceptions,
    what: 'exceptions sharing a reference and reason',
    pipeline: [{ $group: { _id: { r: '$reference', why: '$reason' }, n: { $sum: 1 } } }, ...duplicateGroups],
  },
]);

function pairScan() {
  return [
    {
      $group: {
        _id: { u: asText('userId'), c: asText('courseId') },
        n: { $sum: 1 },
        types: { $addToSet: { u: { $type: '$userId' }, c: { $type: '$courseId' } } },
      },
    },
    { $match: { $or: [{ n: { $gt: 1 } }, { 'types.1': { $exists: true } }] } },
  ];
}

function maskValue(value) {
  if (value === null || value === undefined) return '(none)';
  const text = String(value);
  if (text.length <= 8) return `…${text.slice(-2)}`;
  return `${text.slice(0, 4)}…${text.slice(-4)}`;
}

function maskGroup(group) {
  const parts = Object.entries(group._id || {}).map(([key, value]) => `${key}=${maskValue(value)}`);
  const extra = group.missingStatus ? ` missingStatus=${group.missingStatus}` : '';
  return `${parts.join(' ')} rows=${group.n}${extra}`;
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const at = args.indexOf('--database');
  const database = at !== -1 ? String(args[at + 1] || '').trim() : '';
  const apply = args.includes('--apply');
  const rollback = args.includes('--rollback');
  if (!database || database.startsWith('--')) return { error: 'Pass the target database name with --database <name>.' };
  if (apply && rollback) return { error: 'Use either --apply or --rollback, not both.' };
  return { database, mode: apply ? 'apply' : rollback ? 'rollback' : 'dry-run' };
}

async function collectionNames(db) {
  return new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((item) => item.name));
}

async function runScans(db, names) {
  const results = [];
  for (const scan of SCANS) {
    if (!names.has(scan.collection)) {
      results.push({ id: scan.id, index: scan.index, collection: scan.collection, absent: true, groups: [] });
      continue;
    }
    const groups = await db.collection(scan.collection).aggregate(scan.pipeline, { allowDiskUse: true }).toArray();
    results.push({ id: scan.id, index: scan.index, collection: scan.collection, absent: false, groups });
  }
  return results;
}

const sameJson = (left, right) => JSON.stringify(left ?? null) === JSON.stringify(right ?? null);

function compareIndex(definition, existing) {
  const byName = existing.find((item) => item.name === definition.options.name);
  if (byName) {
    const same = sameJson(byName.key, definition.key)
      && Boolean(byName.unique) === true
      && sameJson(byName.partialFilterExpression, definition.options.partialFilterExpression);
    return same ? { state: 'present' } : { state: 'conflict', detail: 'an index with this name has a different definition' };
  }
  const sameKey = existing.find((item) => sameJson(item.key, definition.key)
    && sameJson(item.partialFilterExpression, definition.options.partialFilterExpression));
  if (sameKey) return { state: 'conflict', detail: `the same keys are already indexed as "${sameKey.name}"` };
  return { state: 'missing' };
}

async function indexStates(db, names) {
  const states = [];
  for (const definition of COURSE_PAYMENT_INDEXES) {
    const existing = names.has(definition.collection) ? await db.collection(definition.collection).indexes() : [];
    states.push({ definition, ...compareIndex(definition, existing) });
  }
  return states;
}

function blockingFindings(scans, states) {
  const problems = [];
  for (const scan of scans) {
    if (scan.groups.length) problems.push(`${scan.id} (${scan.collection}) found ${scan.groups.length} group(s)`);
  }
  for (const item of states) {
    if (item.state === 'conflict') problems.push(`${item.definition.id} ${item.definition.options.name}: ${item.detail}`);
  }
  return problems;
}

/** Runs the read-only checks, then builds, drops, or only reports, depending on `mode`. */
async function run(db, { mode, log = console.log }) {
  const names = await collectionNames(db);
  const known = COURSE_PAYMENT_INDEXES.filter((item) => names.has(item.collection)).length;
  if (known === 0) {
    return { ok: false, error: 'None of the course payment collections exist in this database. Check --database.' };
  }

  const scans = await runScans(db, names);
  for (const scan of SCANS) {
    const result = scans.find((item) => item.id === scan.id);
    const status = result.absent ? 'collection absent (0 rows)' : `${result.groups.length} group(s)`;
    log(`${scan.id} ${scan.collection}: ${status} - ${scan.what}`);
    result.groups.slice(0, MAX_LISTED_GROUPS).forEach((group) => log(`    ${maskGroup(group)}`));
    if (result.groups.length > MAX_LISTED_GROUPS) log(`    … ${result.groups.length - MAX_LISTED_GROUPS} more`);
  }

  const states = await indexStates(db, names);
  states.forEach((item) => log(`${item.definition.id} ${item.definition.collection}.${item.definition.options.name}: ${item.state}${item.detail ? ` (${item.detail})` : ''}`));

  if (mode === 'rollback') {
    const dropped = [];
    for (const item of states) {
      if (item.state !== 'present') continue;
      await db.collection(item.definition.collection).dropIndex(item.definition.options.name);
      dropped.push(item.definition.options.name);
      log(`dropped ${item.definition.collection}.${item.definition.options.name}`);
    }
    return { ok: true, mode, dropped };
  }

  const problems = blockingFindings(scans, states);
  if (mode === 'dry-run') {
    log(problems.length ? `Not ready to build: ${problems.join('; ')}` : 'Ready to build: every scan is clean and no index conflicts.');
    return { ok: problems.length === 0, mode, problems };
  }

  if (problems.length) {
    return { ok: false, mode, problems, error: `Refusing to build: ${problems.join('; ')}` };
  }
  const created = [];
  for (const item of states) {
    if (item.state === 'present') continue;
    await db.collection(item.definition.collection).createIndex(item.definition.key, item.definition.options);
    created.push(item.definition.options.name);
    log(`created ${item.definition.collection}.${item.definition.options.name}`);
  }
  const after = await indexStates(db, await collectionNames(db));
  const unverified = after.filter((item) => item.state !== 'present').map((item) => item.definition.options.name);
  if (unverified.length) return { ok: false, mode, created, error: `Not verified after build: ${unverified.join(', ')}` };
  log('Verified: all six indexes are present with the expected keys and options.');
  return { ok: true, mode, created };
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
      if (result.error) console.error(result.error);
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

module.exports = { SCANS, compareIndex, maskValue, parseArgs, run };
