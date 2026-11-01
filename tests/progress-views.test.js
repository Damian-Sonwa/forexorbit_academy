/**
 * GET /api/progress data (lib/progress-views.js).
 *
 * The batched loader must return exactly what the earlier per-enrollment code returned, in the
 * same order, while running a fixed number of queries and never loading lesson content.
 * Runs against an in-memory collection double that records every query. No database is used.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');

const { loadEnrollmentProgress } = require('../lib/progress-views');
const { presentEnrollmentProgress, quizHistoryQuery } = require('../lib/enrollment-state');

const same = (a, b) => String(a) === String(b);

function matches(doc, query) {
  return Object.entries(query).every(([key, cond]) => {
    if (cond && typeof cond === 'object' && !(cond instanceof ObjectId) && '$in' in cond) {
      return cond.$in.some((candidate) => same(doc[key], candidate));
    }
    return same(doc[key], cond);
  });
}

function recordingDb(data) {
  const calls = [];
  return {
    calls,
    collection(name) {
      const docs = data[name] || [];
      return {
        find(query, options = {}) {
          calls.push({ name, op: 'find', query, projection: options.projection || null });
          return { toArray: async () => docs.filter((doc) => matches(doc, query)).map((doc) => ({ ...doc })) };
        },
        async findOne(query) {
          calls.push({ name, op: 'findOne', query });
          return docs.find((doc) => matches(doc, query)) || null;
        },
      };
    },
  };
}

/** The per-enrollment implementation this replaces, kept as the reference result. */
async function referenceProgress(db, userId) {
  const userProgress = await db.collection('progress').find({ userId }).toArray();
  return Promise.all(userProgress.map(async (p) => {
    const courseIdStr = p.courseId == null ? '' : String(p.courseId);
    let course = null;
    if (/^[a-fA-F0-9]{24}$/.test(courseIdStr)) {
      course = await db.collection('courses').findOne({ _id: new ObjectId(courseIdStr) });
    }
    const courseLessons = courseIdStr ? await db.collection('lessons').find({ courseId: courseIdStr }).toArray() : [];
    const scores = courseIdStr ? await db.collection('quizScores').find(quizHistoryQuery(userId, courseIdStr)).toArray() : [];
    return presentEnrollmentProgress(p, {
      course: course ? { id: course._id.toString(), title: course.title, thumbnail: course.thumbnail, difficulty: course.difficulty, category: course.category } : null,
      totalLessons: courseLessons.length,
      quizScores: scores,
    });
  }));
}

const USER = '650000000000000000000001';
const OTHER = '650000000000000000000002';

function fixture(enrollments) {
  const courses = [];
  const lessons = [];
  const progress = [];
  const quizScores = [];
  for (let i = 0; i < enrollments; i += 1) {
    const id = new ObjectId();
    courses.push({ _id: id, title: `Course ${i}`, thumbnail: i % 2 ? `/t${i}.webp` : '', difficulty: 'beginner', category: 'basics', description: '<p>long</p>' });
    for (let l = 0; l <= i % 4; l += 1) lessons.push({ _id: new ObjectId(), courseId: String(id), title: `L${l}`, content: '<p>heavy lesson body</p>'.repeat(50) });
    progress.push({ _id: new ObjectId(), userId: USER, courseId: String(id), progress: (i * 17) % 100, completedLessons: [], active: i % 5 !== 3 });
    quizScores.push({ _id: new ObjectId(), userId: USER, courseId: String(id), lessonId: 'lx', score: i % 3, totalQuestions: 3 });
    quizScores.push({ _id: new ObjectId(), userId: OTHER, courseId: String(id), lessonId: 'lx', score: 3, totalQuestions: 3 });
  }
  // Edge cases the old code handled: a missing course, a non-ObjectId course id, no course id,
  // an upper-case id string, and another learner's row.
  progress.push({ _id: new ObjectId(), userId: USER, courseId: String(new ObjectId()), progress: 10, completedLessons: ['a'] });
  progress.push({ _id: new ObjectId(), userId: USER, courseId: 'legacy-course', progress: 5, completedLessons: [] });
  progress.push({ _id: new ObjectId(), userId: USER, courseId: null, progress: 0, completedLessons: [] });
  progress.push({ _id: new ObjectId(), userId: USER, courseId: String(courses[0]._id).toUpperCase(), progress: 1, completedLessons: [] });
  lessons.push({ _id: new ObjectId(), courseId: 'legacy-course', title: 'Legacy' });
  progress.push({ _id: new ObjectId(), userId: OTHER, courseId: String(courses[0]._id), progress: 99, completedLessons: [] });
  return { courses, lessons, progress, quizScores };
}

test('batched progress returns exactly what the per-enrollment version returned, in the same order', async () => {
  const data = fixture(9);
  const expected = await referenceProgress(recordingDb(data), USER);
  const actual = await loadEnrollmentProgress(recordingDb(data), USER);
  // Phase 8 changes completedLessonsCount (current lessons only) and adds status, completedAt and
  // lastViewedAt; every other field must be exactly what the per-enrollment version returned.
  const unchanged = ({ completedLessonsCount, status, completedAt, lastViewedAt, ...rest }) => rest;
  assert.deepEqual(actual.map(unchanged), expected.map(unchanged));
  assert.equal(actual.length, 13);
  const lessonIds = (courseId) => data.lessons.filter((l) => String(l.courseId) === String(courseId)).map((l) => String(l._id));
  for (const row of actual) {
    assert.equal(row.completedLessonsCount, row.completedLessons.filter((id) => lessonIds(row.courseId).includes(id)).length, row._id);
  }
});

test('Phase 8: completed counts exclude deleted lessons, and a recorded completion stays completed', async () => {
  const courseId = new ObjectId();
  const kept = [new ObjectId(), new ObjectId(), new ObjectId()];
  const data = {
    courses: [{ _id: courseId, title: 'C', difficulty: 'beginner' }],
    lessons: kept.map((id) => ({ _id: id, courseId: String(courseId) })),
    progress: [{ _id: new ObjectId(), userId: USER, courseId: String(courseId), progress: 66.67, completedLessons: [String(kept[0]), String(kept[1]), 'deleted-1', 'deleted-2'], completedAt: new Date('2026-10-01T00:00:00Z'), lastViewedAt: new Date('2026-10-02T00:00:00Z') }],
    quizScores: [],
  };
  const [row] = await loadEnrollmentProgress(recordingDb(data), USER);
  assert.equal(row.completedLessonsCount, 2, 'not 4 (two of the ids are deleted lessons)');
  assert.equal(row.totalLessons, 3);
  assert.equal(row.status, 'completed', 'completedAt is permanent although a lesson was added since');
  assert.equal(row.completedAt, '2026-10-01T00:00:00.000Z');
  assert.equal(row.lastViewedAt, '2026-10-02T00:00:00.000Z');
  data.progress[0].completedAt = undefined;
  const [open] = await loadEnrollmentProgress(recordingDb(data), USER);
  assert.equal(open.status, 'in_progress');
});

test('the number of queries does not grow with the number of enrollments', async () => {
  for (const enrollments of [1, 10, 60]) {
    const db = recordingDb(fixture(enrollments));
    await loadEnrollmentProgress(db, USER);
    assert.equal(db.calls.length, 4, `${enrollments} enrollments`);
  }
  const reference = recordingDb(fixture(60));
  await referenceProgress(reference, USER);
  assert.ok(reference.calls.length > 150, 'the old version ran three queries per enrollment');
});

test('lesson content and full course documents are never loaded', async () => {
  const db = recordingDb(fixture(5));
  await loadEnrollmentProgress(db, USER);
  const lessonRead = db.calls.find((call) => call.name === 'lessons');
  assert.deepEqual(lessonRead.projection, { courseId: 1 });
  const courseRead = db.calls.find((call) => call.name === 'courses');
  assert.deepEqual(courseRead.projection, { title: 1, thumbnail: 1, difficulty: 1, category: 1 });
});

test('only the signed-in learner\'s rows and quiz scores are read', async () => {
  const db = recordingDb(fixture(4));
  const rows = await loadEnrollmentProgress(db, USER);
  assert.ok(rows.every((row) => row.userId === USER));
  const scoreRead = db.calls.find((call) => call.name === 'quizScores');
  assert.equal(scoreRead.query.userId, USER);
  for (const row of rows) for (const score of row.quizScores) assert.notEqual(score.score, 3, 'another learner\'s score leaked');
});

test('a learner with no enrollments costs one query', async () => {
  const db = recordingDb({ progress: [] });
  assert.deepEqual(await loadEnrollmentProgress(db, USER), []);
  assert.equal(db.calls.length, 1);
});
