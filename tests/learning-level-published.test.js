/**
 * Learning-level completion counts only published courses (owner decision, 31 October 2026).
 * Draft, in-review and archived courses never block advancement; older courses stored without a
 * status were already live and still count. Archived courses stay readable for their enrolled
 * students. The real lib/learning-level.ts runs against the in-memory database
 * (tests/helpers/memory-db.js); this is not real-MongoDB coverage.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');

const { memoryDb } = require('./helpers/memory-db');
const { loadModule } = require('./helpers/ts-loader');
const lifecycle = require('../lib/course-lifecycle');

function fixture({ courses, completed = {}, enrolledOnly = [], role = 'student', level = 'beginner' }) {
  const userId = new ObjectId();
  const courseRows = [];
  const lessonRows = [];
  const progressRows = [];
  for (const spec of courses) {
    const _id = new ObjectId();
    courseRows.push({ _id, title: spec.key, difficulty: spec.difficulty || 'beginner', ...(spec.status === undefined ? {} : { status: spec.status }) });
    const lessonIds = [new ObjectId(), new ObjectId()];
    for (const id of lessonIds) lessonRows.push({ _id: id, courseId: String(_id) });
    if (completed[spec.key] !== undefined || enrolledOnly.includes(spec.key)) {
      const done = completed[spec.key] === 'all' ? lessonIds.map(String) : completed[spec.key] === 'one' ? [String(lessonIds[0])] : [];
      progressRows.push({ userId: String(userId), courseId: String(_id), completedLessons: done, progress: done.length * 50, active: true });
    }
    spec.id = String(_id);
  }
  const db = memoryDb({
    users: [{ _id: userId, role, status: 'approved', learningLevel: level }],
    courses: courseRows,
    lessons: lessonRows,
    progress: progressRows,
  });
  const mod = loadModule('lib/learning-level.ts', { 'lib/mongodb': { getDb: async () => db } });
  return { db, mod, userId: String(userId), courses };
}

const levelOf = (db) => db.docs('users')[0].learningLevel;

test('a draft course at the level does not block advancement', async () => {
  const { db, mod, userId } = fixture({
    courses: [{ key: 'pub', status: 'published' }, { key: 'draft', status: 'draft' }],
    completed: { pub: 'all' },
  });
  assert.equal(await mod.updateLearningLevelIfEligible(userId), 'intermediate');
  assert.equal(levelOf(db), 'intermediate');
});

test('an in-review course does not block advancement', async () => {
  const { mod, userId } = fixture({
    courses: [{ key: 'pub', status: 'published' }, { key: 'review', status: 'in_review' }],
    completed: { pub: 'all' },
  });
  assert.equal(await mod.checkLevelCompletion(userId, 'beginner'), true);
});

test('an archived course does not block advancement, even for a student enrolled in it with work left', async () => {
  const { db, mod, userId, courses } = fixture({
    courses: [{ key: 'pub', status: 'published' }, { key: 'arch', status: 'archived' }],
    completed: { pub: 'all', arch: 'one' },
  });
  const before = JSON.stringify(db.docs('progress'));
  assert.equal(await mod.updateLearningLevelIfEligible(userId), 'intermediate');
  assert.equal(JSON.stringify(db.docs('progress')), before, 'the archived enrolment is not changed');

  // The archived course stays readable for the enrolled student, and closed to new students.
  const archived = db.docs('courses').find((c) => String(c._id) === courses[1].id);
  const student = { userId, role: 'student' };
  assert.equal(lifecycle.canSeeCourse(student, archived, { activeEnrollment: true }), true);
  assert.equal(lifecycle.studentContentOpen(archived), true);
  assert.equal(lifecycle.canSeeCourse(student, archived, { activeEnrollment: false }), false);
  assert.equal(lifecycle.decideCourseOpenForSale(archived).code, 'course_archived');
});

test('an unfinished published course still blocks advancement, whatever is completed elsewhere', async () => {
  const { db, mod, userId } = fixture({
    courses: [{ key: 'pub', status: 'published' }, { key: 'pub2', status: 'published' }, { key: 'draft', status: 'draft' }, { key: 'arch', status: 'archived' }],
    completed: { pub: 'all', pub2: 'one', draft: 'all', arch: 'all' },
  });
  assert.equal(await mod.updateLearningLevelIfEligible(userId), 'beginner');
  assert.equal(levelOf(db), 'beginner');
});

test('a published course the student is not enrolled in still blocks advancement (rule unchanged)', async () => {
  const { mod, userId } = fixture({
    courses: [{ key: 'pub', status: 'published' }, { key: 'other', status: 'published' }],
    completed: { pub: 'all' },
  });
  assert.equal(await mod.checkLevelCompletion(userId, 'beginner'), false);
});

test('an older course stored without a status is live and still counts', async () => {
  const incomplete = fixture({ courses: [{ key: 'pub', status: 'published' }, { key: 'legacy' }], completed: { pub: 'all', legacy: 'one' } });
  assert.equal(await incomplete.mod.checkLevelCompletion(incomplete.userId, 'beginner'), false);
  const complete = fixture({ courses: [{ key: 'legacy' }], completed: { legacy: 'all' } });
  assert.equal(await complete.mod.checkLevelCompletion(complete.userId, 'beginner'), true);
});

test('existing rules unchanged: no published course at a level means no advancement; one level per step; staff are advanced', async () => {
  const onlyHidden = fixture({ courses: [{ key: 'draft', status: 'draft' }, { key: 'arch', status: 'archived' }], completed: { draft: 'all', arch: 'all' } });
  assert.equal(await onlyHidden.mod.checkLevelCompletion(onlyHidden.userId, 'beginner'), false);

  const both = fixture({
    courses: [{ key: 'b', status: 'published' }, { key: 'i', status: 'published', difficulty: 'intermediate' }, { key: 'iDraft', status: 'draft', difficulty: 'intermediate' }],
    completed: { b: 'all', i: 'all' },
  });
  assert.equal(await both.mod.updateLearningLevelIfEligible(both.userId), 'advanced', 'beginner then intermediate, as before');

  const instructor = fixture({ courses: [{ key: 'pub', status: 'published' }], role: 'instructor' });
  assert.equal(await instructor.mod.updateLearningLevelIfEligible(instructor.userId), 'advanced');
});

test('the course query asks for published courses only (legacy rows without a status included)', async () => {
  const { db, mod, userId } = fixture({ courses: [{ key: 'pub', status: 'published' }], completed: { pub: 'all' } });
  await mod.checkLevelCompletion(userId, 'beginner');
  const query = db.log.find((entry) => entry.name === 'courses' && entry.method === 'find').query;
  assert.deepEqual(query, { difficulty: 'beginner', $or: [{ status: 'published' }, { status: { $exists: false } }] });
});
