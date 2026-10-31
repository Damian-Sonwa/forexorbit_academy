/**
 * Phase 4 data migration for existing courses (see docs/audits/phase-4-implementation.md).
 *
 *   Read-only plan (default; counts only):
 *     node scripts/phase-4-course-migration.js --database <name> [--steps status,preview]
 *   Apply (writes; needs the counts from the plan and a rollback file path):
 *     node scripts/phase-4-course-migration.js --database <name> --apply \
 *       --expect status=6,previewCourses=6,previewLessons=6 --rollback-file <path.json>
 *   Undo exactly what an apply recorded (read-only plan first, then --apply):
 *     node scripts/phase-4-course-migration.js --database <name> --rollback <path.json> [--apply]
 *
 * Steps (default: status,preview). Every write is conditional, so a rerun changes nothing:
 *   status      Courses with no `status` were already live: they get 'published'. The application
 *               already treats a missing status as published, so nothing becomes hidden.
 *   preview     Courses with no `freePreviewExplicit`: the lesson free under the old rule (first by
 *               order, or marked isFirstLesson) gets `isFreePreview: true`, then the course gets
 *               `freePreviewExplicit: true`. An existing `isFreePreview` value is never changed.
 *   completion  Only when asked for (`--steps ...,completion`). Records `completedAt` for an
 *               enrolment at 100% only when every current lesson is completed (or, for rows from
 *               before lessons were added, every completed lesson still exists), using the row's
 *               own `updatedAt` as the date. A row without `updatedAt` is left unresolved: dates are
 *               never invented. `completionEvidence` records the rule that was used. Rows whose 100%
 *               includes deleted lessons are never changed; they are counted as unresolved.
 *
 * Safety:
 *   - Without --apply only `find` and `countDocuments` are called.
 *   - --apply re-plans and stops before any write unless every count in --expect matches, so a
 *     change in the data between the dry run and the apply (for example a concurrent edit) is
 *     detected. It writes the ids it is about to change to --rollback-file first.
 *   - Nothing is ever deleted; only the fields named above are added.
 * The connection string comes from MONGO_URI (or MONGODB_URI) and is never printed; the output is
 * counts only (no names, emails or ids).
 */
const fs = require('fs');
const { courseCompletion } = require('../lib/course-progress');
const { sortLessonsByOrder } = require('../lib/course-lesson-list');

const ALL_STEPS = ['status', 'preview', 'completion'];
const DEFAULT_STEPS = ['status', 'preview'];
const EVIDENCE = Object.freeze({
  current: 'phase4-migration:all-current-lessons-completed',
  historical: 'phase4-migration:all-completed-lessons-still-exist',
});
const EXPECT_KEYS = ['status', 'previewCourses', 'previewLessons', 'completion'];

function parseArgs(argv) {
  const args = argv.slice(2);
  const value = (flag) => {
    const at = args.indexOf(flag);
    return at !== -1 ? String(args[at + 1] || '').trim() : '';
  };
  const database = value('--database');
  if (!database || database.startsWith('--')) return { error: 'Pass the target database name with --database <name>.' };
  const apply = args.includes('--apply');
  const rollback = value('--rollback');
  const stepsText = value('--steps');
  const steps = stepsText ? stepsText.split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_STEPS;
  if (!steps.length || steps.some((s) => !ALL_STEPS.includes(s))) return { error: `--steps must list some of: ${ALL_STEPS.join(', ')}.` };
  if (rollback) return { database, apply, rollback };
  const expect = {};
  const expectText = value('--expect');
  if (expectText) {
    for (const pair of expectText.split(',')) {
      const [key, raw] = pair.split('=').map((s) => s.trim());
      if (!EXPECT_KEYS.includes(key) || !/^\d+$/.test(raw || '')) return { error: `--expect takes ${EXPECT_KEYS.join(', ')} as key=count.` };
      expect[key] = Number(raw);
    }
  }
  const rollbackFile = value('--rollback-file');
  if (apply) {
    const needed = steps.flatMap((step) => ({ status: ['status'], preview: ['previewCourses', 'previewLessons'], completion: ['completion'] })[step]);
    const missing = needed.filter((key) => expect[key] === undefined);
    if (missing.length) return { error: `--apply needs the planned counts: --expect ${missing.map((k) => `${k}=<n>`).join(',')}.` };
    if (!rollbackFile) return { error: '--apply needs --rollback-file <path.json> (written before any change).' };
  }
  return { database, apply, steps, expect, rollbackFile };
}

/** Which lesson ids of one course were free under the old rule, given all its lessons. */
function legacyPreviewLessonIds(lessons) {
  const ids = new Set();
  sortLessonsByOrder(lessons).forEach((lesson, index) => {
    if (index === 0 || lesson.isFirstLesson === true) ids.add(String(lesson._id));
  });
  return ids;
}

/** Read-only: what each step would change. Ids stay in memory and the rollback file only. */
async function plan(db, steps) {
  const result = { steps };
  if (steps.includes('status')) {
    const rows = await db.collection('courses').find({ status: { $exists: false } }, { projection: { _id: 1 } }).toArray();
    result.status = { courseIds: rows.map((r) => r._id) };
  }
  if (steps.includes('preview')) {
    const courses = await db.collection('courses').find({ freePreviewExplicit: { $exists: false } }, { projection: { _id: 1 } }).toArray();
    const lessonIds = [];
    let alreadySet = 0;
    for (const course of courses) {
      const lessons = await db.collection('lessons')
        .find({ courseId: String(course._id) }, { projection: { _id: 1, order: 1, isFirstLesson: 1, isFreePreview: 1 } })
        .toArray();
      const free = legacyPreviewLessonIds(lessons);
      for (const lesson of lessons) {
        if (!free.has(String(lesson._id))) continue;
        if (lesson.isFreePreview !== undefined) alreadySet += 1;
        else lessonIds.push(lesson._id);
      }
    }
    result.preview = { courseIds: courses.map((c) => c._id), lessonIds, alreadySet };
  }
  if (steps.includes('completion')) {
    const rows = await db.collection('progress')
      .find({ progress: { $gte: 100 }, completedAt: { $exists: false } }, { projection: { courseId: 1, completedLessons: 1, progress: 1, updatedAt: 1 } })
      .toArray();
    const lessonIdsByCourse = new Map();
    const record = [];
    const unresolved = { deletedLessonsInHundred: 0, notAllCurrentLessons: 0, noUpdatedAt: 0 };
    for (const row of rows) {
      const courseId = String(row.courseId);
      if (!lessonIdsByCourse.has(courseId)) {
        const lessons = await db.collection('lessons').find({ courseId }, { projection: { _id: 1 } }).toArray();
        lessonIdsByCourse.set(courseId, lessons.map((lesson) => String(lesson._id)));
      }
      const completion = courseCompletion({ enrollment: row, currentLessonIds: lessonIdsByCourse.get(courseId) });
      if (!completion.complete) {
        if (completion.basis === 'unverified') unresolved.deletedLessonsInHundred += 1;
        else unresolved.notAllCurrentLessons += 1;
        continue;
      }
      if (!(row.updatedAt instanceof Date)) {
        unresolved.noUpdatedAt += 1;
        continue;
      }
      record.push({ _id: row._id, completedAt: row.updatedAt, evidence: EVIDENCE[completion.basis] || EVIDENCE.current });
    }
    result.completion = { candidates: rows.length, record, unresolved };
  }
  return result;
}

function planCounts(p) {
  const counts = {};
  if (p.status) counts.status = p.status.courseIds.length;
  if (p.preview) {
    counts.previewCourses = p.preview.courseIds.length;
    counts.previewLessons = p.preview.lessonIds.length;
    counts.previewLessonsAlreadySet = p.preview.alreadySet;
  }
  if (p.completion) {
    counts.completionCandidates = p.completion.candidates;
    counts.completion = p.completion.record.length;
    counts.completionUnresolved = p.completion.unresolved;
  }
  return counts;
}

function mismatches(counts, expect) {
  return Object.entries(expect).filter(([key, n]) => counts[key] !== n).map(([key, n]) => `${key}: planned ${counts[key]}, expected ${n}`);
}

/** Writes the planned changes; every write re-checks that the field is still missing. */
async function applyPlan(db, p, now = new Date()) {
  const written = {};
  if (p.status) {
    let n = 0;
    for (const _id of p.status.courseIds) {
      n += (await db.collection('courses').updateOne({ _id, status: { $exists: false } }, { $set: { status: 'published' } })).modifiedCount;
    }
    written.status = n;
  }
  if (p.preview) {
    let lessons = 0;
    let courses = 0;
    for (const _id of p.preview.lessonIds) {
      lessons += (await db.collection('lessons').updateOne({ _id, isFreePreview: { $exists: false } }, { $set: { isFreePreview: true } })).modifiedCount;
    }
    for (const _id of p.preview.courseIds) {
      courses += (await db.collection('courses').updateOne({ _id, freePreviewExplicit: { $exists: false } }, { $set: { freePreviewExplicit: true } })).modifiedCount;
    }
    written.previewLessons = lessons;
    written.previewCourses = courses;
  }
  if (p.completion) {
    let n = 0;
    for (const row of p.completion.record) {
      n += (await db.collection('progress').updateOne(
        { _id: row._id, completedAt: { $exists: false } },
        { $set: { completedAt: row.completedAt, completionEvidence: row.evidence, completionRecordedAt: now } }
      )).modifiedCount;
    }
    written.completion = n;
  }
  return written;
}

function rollbackRecord(database, p, now) {
  const ids = (list) => (list || []).map((id) => String(id));
  return {
    kind: 'phase-4-course-migration',
    database,
    createdAt: now.toISOString(),
    courseStatusSet: ids(p.status && p.status.courseIds),
    courseFreePreviewExplicitSet: ids(p.preview && p.preview.courseIds),
    lessonIsFreePreviewSet: ids(p.preview && p.preview.lessonIds),
    progressCompletedAtSet: ids(p.completion && p.completion.record.map((r) => r._id)),
  };
}

/**
 * Undo from a rollback file. Each unset is conditional on the value the migration wrote, so a
 * value changed by the application since (for example a course archived later) is kept.
 */
async function rollback(db, record, { apply, toId }) {
  const ops = [
    ['courses', record.courseStatusSet, { status: 'published', statusChangedAt: { $exists: false } }, { status: '' }],
    ['courses', record.courseFreePreviewExplicitSet, { freePreviewExplicit: true }, { freePreviewExplicit: '' }],
    ['lessons', record.lessonIsFreePreviewSet, { isFreePreview: true }, { isFreePreview: '' }],
    ['progress', record.progressCompletedAtSet, { completionEvidence: { $in: Object.values(EVIDENCE) } }, { completedAt: '', completionEvidence: '', completionRecordedAt: '' }],
  ];
  const result = {};
  for (const [collection, list, condition, unset] of ops) {
    const key = `${collection}.${Object.keys(unset)[0]}`;
    const filter = { _id: { $in: (list || []).map(toId) }, ...condition };
    result[key] = apply
      ? (await db.collection(collection).updateMany(filter, { $unset: unset })).modifiedCount
      : await db.collection(collection).countDocuments(filter);
  }
  return result;
}

/** Read-only view of a database: anything but find/countDocuments throws before reaching it. */
function readOnly(db) {
  const allowed = new Set(['find', 'findOne', 'countDocuments']);
  return {
    collection(name) {
      const col = db.collection(name);
      return new Proxy({}, {
        get(_, prop) {
          if (allowed.has(prop)) return col[prop].bind(col);
          throw new Error(`read-only run: ${String(prop)} on ${name} refused`);
        },
      });
    },
  };
}

async function run(db, { database = '(memory)', apply = false, steps = DEFAULT_STEPS, expect = {}, rollbackFile = '', writeFile = fs.writeFileSync, log = console.log, now = new Date() }) {
  const target = apply ? db : readOnly(db);
  const before = plan(target, steps);
  const p = await before;
  const counts = planCounts(p);
  log(`plan: ${JSON.stringify(counts)}`);
  if (!apply) return { ok: true, applied: false, counts };
  const wrong = mismatches(counts, expect);
  if (wrong.length) {
    log(`Stopped before any write: the data no longer matches the dry run (${wrong.join('; ')}).`);
    return { ok: false, applied: false, counts, mismatches: wrong };
  }
  writeFile(rollbackFile, `${JSON.stringify(rollbackRecord(database, p, now), null, 2)}\n`);
  log('rollback file written');
  const written = await applyPlan(db, p, now);
  log(`written: ${JSON.stringify(written)}`);
  const after = planCounts(await plan(readOnly(db), steps));
  log(`remaining after apply: ${JSON.stringify(after)}`);
  return { ok: true, applied: true, counts, written, after };
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
  const { MongoClient, ObjectId } = require('mongodb');
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
  try {
    await client.connect();
    // The database must already exist (a mistyped name would otherwise read an empty database).
    let exists;
    try {
      exists = (await client.db().admin().listDatabases({ nameOnly: true })).databases.some((d) => d.name === args.database);
    } catch {
      exists = (await client.db(args.database).listCollections({ name: 'courses' }, { nameOnly: true }).toArray()).length > 0;
    }
    if (!exists) {
      console.error(`Database "${args.database}" does not exist on this server; nothing was done.`);
      process.exitCode = 1;
      return;
    }
    const db = client.db(args.database);
    console.log(`Database: ${args.database}. Mode: ${args.rollback ? 'rollback ' : ''}${args.apply ? 'apply' : 'read-only'}.`);
    if (args.rollback) {
      const record = JSON.parse(fs.readFileSync(args.rollback, 'utf8'));
      if (record.kind !== 'phase-4-course-migration' || record.database !== args.database) {
        console.error('The rollback file is not for this migration and database; nothing was done.');
        process.exitCode = 1;
        return;
      }
      const result = await rollback(args.apply ? db : readOnly(db), record, { apply: args.apply, toId: (id) => new ObjectId(id) });
      console.log(`rollback ${args.apply ? 'applied' : 'plan'}: ${JSON.stringify(result)}`);
      return;
    }
    const result = await run(db, { database: args.database, apply: args.apply, steps: args.steps, expect: args.expect, rollbackFile: args.rollbackFile });
    process.exitCode = result.ok ? 0 : 1;
  } finally {
    await client.close().catch(() => {});
  }
}

if (require.main === module) main().catch(() => { console.error('Migration script failed.'); process.exit(1); });

module.exports = { ALL_STEPS, DEFAULT_STEPS, EVIDENCE, applyPlan, legacyPreviewLessonIds, parseArgs, plan, planCounts, readOnly, rollback, rollbackRecord, run };
