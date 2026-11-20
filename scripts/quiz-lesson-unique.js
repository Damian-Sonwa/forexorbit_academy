/**
 * A4: convert the existing quizzes_lesson { lessonId: 1 } index to unique IN PLACE (lib/unique-conversion.js).
 * An owner operation, separate from scripts/assessment-indexes.js; one step per run.
 *
 *   node scripts/quiz-lesson-unique.js --database <name>              read-only: stage + data checks
 *   node scripts/quiz-lesson-unique.js --database <name> --prepare    collMod prepareUnique: true
 *   node scripts/quiz-lesson-unique.js --database <name> --convert    dry run, then collMod unique: true
 *   node scripts/quiz-lesson-unique.js --database <name> --abort      undo --prepare (prepared only)
 *
 * The user needs collMod, find and listIndexes on <database>.quizzes (and listCollections); one
 * without collMod is refused before anything is sent. The index is never dropped and no document is
 * touched. Connection: MONGO_URI (or MONGODB_URI), never printed. Exit 0 on success (or nothing to
 * do), 1 when refused or failed, 2 on a usage error.
 */
const { A4_CONVERSION, abortPrepare, checkPrivileges, convertToUnique, inspectConversion, prepareUnique } = require('../lib/unique-conversion');
const { MISSING_URI, mongoUri } = require('./mongo-uri');

const STEPS = { '--prepare': 'prepare', '--convert': 'convert', '--abort': 'abort' };

function parseArgs(argv) {
  const args = argv.slice(2);
  const at = args.indexOf('--database');
  const database = at !== -1 ? String(args[at + 1] || '').trim() : '';
  if (!database || database.startsWith('--')) return { error: 'Pass the target database name with --database <name>.' };
  const steps = Object.keys(STEPS).filter((flag) => args.includes(flag));
  if (steps.length > 1) return { error: 'Run one step at a time: --prepare, --convert or --abort.' };
  return { database, step: steps.length ? STEPS[steps[0]] : 'report' };
}

function describe(state, log) {
  const t = A4_CONVERSION;
  log(`${t.id} ${t.collection}.${t.indexName} ${JSON.stringify(t.key)}: ${state.stage}${state.problems.length ? ` (${state.problems.join('; ')})` : ''}`);
  if (state.data) {
    const d = state.data;
    log(`Data: ${d.documents} document(s); ${d.duplicateGroups} duplicate group(s); ${d.nullOrMissing} null or missing ${t.field}; ${d.wrongType} not ${t.valueType}. ${d.clean ? 'Clean.' : 'NOT clean.'}`);
  }
}

const NEXT = {
  'non-unique': 'Next: --prepare.',
  prepared: 'Next: --convert (or --abort to undo the prepare step).',
  unique: 'Done: the index is unique.',
};

async function run(db, { step, log = console.log }) {
  if (step === 'report') {
    const state = await inspectConversion(db);
    describe(state, log);
    const privileges = await checkPrivileges(db);
    log(privileges.ok ? 'Signed-in user: may run the conversion steps.' : `Signed-in user: lacks ${privileges.missing.join(', ')} on ${db.databaseName}.${A4_CONVERSION.collection}; the steps would be refused.`);
    log(NEXT[state.stage] || 'Stop: the index is not in an expected state; review before any step.');
    return { ok: Boolean(NEXT[state.stage]) && (state.stage === 'unique' || state.data.clean), state };
  }
  const result = await { prepare: prepareUnique, convert: convertToUnique, abort: abortPrepare }[step](db);
  if (result.after) describe(result.after, log);
  log(`${step}: ${result.ok ? 'OK' : 'REFUSED'}${result.changed ? '' : ' (nothing changed)'}; ${result.reason}.`);
  return result;
}

if (require.main === module) {
  (async () => {
    const args = parseArgs(process.argv);
    if (args.error) { console.error(args.error); process.exit(2); }
    require('dotenv').config({ quiet: true });
    const uri = mongoUri();
    if (!uri) { console.error(MISSING_URI); process.exit(2); }
    const { MongoClient } = require('mongodb');
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
    try {
      await client.connect();
      console.log(`Database: ${args.database}. Step: ${args.step}${args.step === 'report' ? ' (read-only)' : ''}.`);
      const result = await run(client.db(args.database), args);
      process.exitCode = result.ok ? 0 : 1;
    } finally {
      await client.close().catch(() => {});
    }
  })().catch((error) => {
    console.error(`A4 conversion failed (${(error && (error.codeName || error.name)) || 'error'}). Run the report before anything else.`);
    process.exit(1);
  });
}

module.exports = { parseArgs, run };
