/**
 * Indexes for the communication queries and practical tasks (lib/communication-indexes.js, Phase 15).
 *
 *   node scripts/communication-indexes.js --database <name>              read-only: report each index
 *   node scripts/communication-indexes.js --database <name> --apply      build the missing ones
 *   node scripts/communication-indexes.js --database <name> --rollback   drop only indexes this script built
 *
 * The connection string comes from MONGO_URI (or MONGODB_URI) and is never printed. The report and
 * --apply share one comparison (lib/index-plan.js): an existing index with the same key and options
 * satisfies a definition under any name.
 * --apply refuses, building nothing, while any definition conflicts. Exit code: 0 when nothing is
 * blocked (report) or everything is present (apply); 1 otherwise.
 *
 * --rollback drops an index only when it carries this script's own name AND exactly this script's
 * definition; an equivalent index under another name, or a prefix cover, is never dropped.
 */
const { COMMUNICATION_INDEXES } = require('../lib/communication-indexes');
const { applyIndexPlan, blockedRows, classifyIndex, describePlan, describeRow, planIndexes } = require('../lib/index-plan');

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

/** present | missing | conflicting. */
function compareIndex(definition, existing) {
  return classifyIndex(definition, existing).state;
}

const logRows = (rows, log) => rows.forEach((row) => log(describeRow(row, { withKey: true })));

async function run(db, { mode, log = console.log }) {
  if (mode === 'plan') {
    const rows = await planIndexes(db, COMMUNICATION_INDEXES);
    logRows(rows, log);
    describePlan(rows).forEach((line) => log(line));
    return { ok: blockedRows(rows).length === 0, states: rows };
  }
  if (mode === 'apply') {
    const result = await applyIndexPlan(db, COMMUNICATION_INDEXES);
    logRows(result.report, log);
    if (result.blocked) log(`Refusing to apply: ${result.blocked.join(', ')} conflict with existing indexes. Nothing was built.`);
    if (result.built.length) log(`Built: ${result.built.join(', ')}.`);
    if (result.failed) log(`Build of ${result.failed.id} failed (${result.failed.error}). Built before the failure: ${result.built.join(', ') || 'none'}.`);
    else if (!result.blocked) log(result.ok ? 'Verified: every communication index is present.' : `Not verified: ${result.report.filter((r) => r.state !== 'present').map((r) => r.id).join(', ')}.`);
    return { ok: result.ok, built: result.built, states: result.report };
  }
  // Rollback: only this script's own indexes, by its own name and its exact definition.
  const rows = await planIndexes(db, COMMUNICATION_INDEXES);
  const dropped = [];
  for (const row of rows) {
    if (row.state !== 'present' || row.coverage !== 'exact') {
      if (row.state === 'present') log(`Kept ${row.id}: satisfied by ${row.satisfiedBy}, which this script did not build.`);
      continue;
    }
    await db.collection(row.collection).dropIndex(row.name);
    dropped.push(row.id);
    log(`Dropped ${row.id} (${row.name}).`);
  }
  return { ok: true, dropped, states: await planIndexes(db, COMMUNICATION_INDEXES) };
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
    console.log(`Database: ${args.database}. Mode: ${args.mode === 'plan' ? 'report (read-only)' : args.mode}.`);
    const result = await run(client.db(args.database), { mode: args.mode });
    process.exitCode = result.ok ? 0 : 1;
  } finally {
    await client.close().catch(() => {});
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Index script failed (${(error && (error.codeName || error.name)) || 'error'}). Check the report before rerunning.`);
    process.exit(1);
  });
}

module.exports = { parseArgs, compareIndex, run };
