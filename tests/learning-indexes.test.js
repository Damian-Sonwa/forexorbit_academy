/**
 * Learning read-path indexes (lib/learning-indexes.js, scripts/learning-indexes.js).
 * Runs the script logic against an in-memory stand-in; no database is used.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { LEARNING_INDEXES } = require('../lib/learning-indexes');
const { parseArgs, compareIndex, run } = require('../scripts/learning-indexes');

function fakeDb(existing = {}) {
  const indexes = {};
  for (const name of ['progress', 'lessons', 'quizScores', 'notifications', 'demoTradeJournal', 'users']) {
    indexes[name] = [{ name: '_id_', key: { _id: 1 } }, ...(existing[name] || [])];
  }
  const writes = [];
  return {
    writes,
    indexes,
    listCollections: () => ({ toArray: async () => Object.keys(indexes).map((name) => ({ name })) }),
    collection(name) {
      return {
        indexes: async () => indexes[name].map((index) => ({ ...index })),
        createIndex: async (key, options) => { writes.push(['create', name, options.name]); indexes[name].push({ key, ...options }); },
        dropIndex: async (indexName) => { writes.push(['drop', name, indexName]); indexes[name] = indexes[name].filter((i) => i.name !== indexName); },
      };
    },
  };
}

const quiet = () => {};

test('every learning index is non-unique and has a distinct name', () => {
  const names = new Set();
  for (const definition of LEARNING_INDEXES) {
    assert.notEqual(definition.options.unique, true, definition.id);
    assert.equal(definition.options.partialFilterExpression, undefined, definition.id);
    assert.ok(!names.has(definition.options.name), definition.options.name);
    names.add(definition.options.name);
  }
});

test('progress keeps { userId, courseId } free for the planned unique enrollment index', () => {
  const pair = LEARNING_INDEXES.find((d) => d.collection === 'progress' && JSON.stringify(d.key) === JSON.stringify({ userId: 1, courseId: 1 }));
  assert.equal(pair, undefined);
});

test('the default mode only reads', async () => {
  const db = fakeDb();
  const result = await run(db, { mode: 'plan', log: quiet });
  assert.equal(db.writes.length, 0);
  assert.ok(result.states.every((s) => s.state === 'missing'));
});

test('apply builds only the missing indexes and verifies them', async () => {
  const db = fakeDb({ lessons: [{ name: 'perf_lessons_course_order', key: { courseId: 1, order: 1 } }] });
  const result = await run(db, { mode: 'apply', log: quiet });
  assert.equal(result.ok, true);
  assert.equal(db.writes.length, LEARNING_INDEXES.length - 1);
  assert.ok(!db.writes.some(([, , name]) => name === 'perf_lessons_course_order'));
  assert.ok(result.states.every((s) => s.state === 'present'));
});

test('apply refuses when an existing index has the same key or name with another definition', async () => {
  for (const existing of [
    { notifications: [{ name: 'my_own', key: { userId: 1, createdAt: -1 } }] },
    { users: [{ name: 'perf_users_role_points', key: { role: 1 } }] },
    { progress: [{ name: 'perf_progress_user', key: { userId: 1 }, unique: true }] },
  ]) {
    const db = fakeDb(existing);
    const result = await run(db, { mode: 'apply', log: quiet });
    assert.equal(result.ok, false);
    assert.equal(db.writes.length, 0);
  }
});

test('rollback drops only the indexes this script owns', async () => {
  const db = fakeDb({ progress: [{ name: 'somebody_else', key: { createdAt: 1 } }] });
  await run(db, { mode: 'apply', log: quiet });
  await run(db, { mode: 'rollback', log: quiet });
  assert.deepEqual(db.indexes.progress.map((i) => i.name), ['_id_', 'somebody_else']);
});

test('arguments: a database is required and the modes are exclusive', () => {
  assert.ok(parseArgs(['node', 's']).error);
  assert.ok(parseArgs(['node', 's', '--database', 'x', '--apply', '--rollback']).error);
  assert.equal(parseArgs(['node', 's', '--database', 'x']).mode, 'plan');
  assert.equal(compareIndex(LEARNING_INDEXES[0], []), 'missing');
});
