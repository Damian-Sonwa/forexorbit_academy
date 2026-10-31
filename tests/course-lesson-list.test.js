/**
 * Course lesson lists must never carry paid lesson content to someone who may not read it.
 *
 * Behavioral tests run the real lib/course-lesson-list.js flow (with the real entitlement and
 * enrollment rules) against an in-memory stand-in for the MongoDB driver. No network, Paystack,
 * or database is used. Tests marked "source contract" read files instead of executing them.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ObjectId } = require('mongodb');

const {
  LESSON_LOCKED_MESSAGE,
  listCourseLessons,
  readLessonDetail,
  loadCourseEntitlement,
  presentCourseLessons,
  priceCourseLessons,
  sortLessonsByOrder,
  WITHHELD_LESSON_FIELDS,
} = require('../lib/course-lesson-list');
const { decideLessonCatalog } = require('../lib/account-access');
const { enrollmentDecisionRecord } = require('../lib/enrollment-state');
const { COLLECTIONS } = require('../lib/course-payment');

const root = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

// ---------------------------------------------------------------------------
// In-memory stand-in for the subset of the MongoDB driver the lesson list reads.
// Every write method is recorded so tests can prove a content request writes nothing.
// ---------------------------------------------------------------------------

const WRITE_METHODS = ['insertOne', 'insertMany', 'updateOne', 'updateMany', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndUpdate', 'findOneAndReplace', 'findOneAndDelete', 'bulkWrite'];

function sameValue(left, right) {
  if (left instanceof ObjectId || right instanceof ObjectId) {
    return left != null && right != null && String(left) === String(right);
  }
  return left === right;
}

function isOperatorObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof ObjectId) && !(value instanceof Date)
    && Object.keys(value).some((key) => key.startsWith('$'));
}

function matches(doc, query) {
  return Object.entries(query).every(([key, cond]) => {
    if (key === '$or') return cond.some((sub) => matches(doc, sub));
    const value = doc[key];
    if (isOperatorObject(cond)) {
      return Object.entries(cond).every(([op, arg]) => {
        if (op === '$in') return arg.some((candidate) => sameValue(candidate, value));
        if (op === '$exists') return arg ? value !== undefined : value === undefined;
        throw new Error(`unsupported operator ${op}`);
      });
    }
    return sameValue(value, cond);
  });
}

function memoryDb(seed) {
  const collections = new Map();
  const writes = [];
  function collection(name) {
    if (!collections.has(name)) {
      const docs = (seed[name] || []).map((doc) => ({ ...doc }));
      const col = {
        docs,
        async findOne(query) {
          const row = docs.find((doc) => matches(doc, query));
          return row ? { ...row } : null;
        },
        find(query) {
          let rows = docs.filter((doc) => matches(doc, query));
          const cursor = {
            project: () => cursor,
            limit: () => cursor,
            sort: (spec) => {
              const [[field, dir]] = Object.entries(spec);
              rows = [...rows].sort((a, b) => ((a[field] ?? 0) - (b[field] ?? 0)) * dir);
              return cursor;
            },
            toArray: async () => rows.map((row) => ({ ...row })),
          };
          return cursor;
        },
        async countDocuments(query, options = {}) {
          const count = docs.filter((doc) => matches(doc, query)).length;
          return options.limit ? Math.min(count, options.limit) : count;
        },
      };
      for (const method of WRITE_METHODS) {
        col[method] = async () => {
          writes.push(`${name}.${method}`);
          throw new Error(`unexpected write ${name}.${method}`);
        };
      }
      collections.set(name, col);
    }
    return collections.get(name);
  }
  return {
    collection,
    writes,
    snapshot: () => JSON.stringify(Object.keys(seed).sort().map((name) => [name, collection(name).docs])),
  };
}

// ---------------------------------------------------------------------------
// Fixtures. Every protected value carries a marker so a leak shows up in the serialized body.
// ---------------------------------------------------------------------------

const COURSE_ID = new ObjectId('64b000000000000000000001');
const OTHER_COURSE_ID = new ObjectId('64b000000000000000000002');
const INSTRUCTOR = '64a0000000000000000000a1';
const OTHER_INSTRUCTOR = '64a0000000000000000000a2';
const ADMIN = '64a0000000000000000000a3';

const STUDENTS = {
  unenrolled: '64a000000000000000000001',
  enrolledUnpaid: '64a000000000000000000002',
  paid: '64a000000000000000000003',
  complimentary: '64a000000000000000000004',
  manualGrant: '64a000000000000000000005',
  legacyLesson: '64a000000000000000000006',
  unpaidAccessRow: '64a000000000000000000007',
  otherCoursePaid: '64a000000000000000000008',
  withdrawnPaid: '64a000000000000000000009',
  paidNotEnrolled: '64a00000000000000000000a',
};

const LESSON = {
  intro: new ObjectId('64c000000000000000000001'),
  paidA: new ObjectId('64c000000000000000000002'),
  demo: new ObjectId('64c000000000000000000003'),
  paidB: new ObjectId('64c000000000000000000004'),
};

/**
 * `description` is a short public blurb, which the outline rule (presentLessonRead) may show on
 * lessons that are not locked. Everything else is protected teaching material.
 */
function lessonDoc(key, order, extra = {}) {
  const tag = `SECRET-${key}`;
  return {
    _id: LESSON[key],
    courseId: String(COURSE_ID),
    title: `Lesson ${key}`,
    type: 'video',
    order,
    description: `Blurb ${key}`,
    summary: `${tag}-summary`,
    content: `<p>${tag}-content</p>`,
    lessonSummary: { overview: `${tag}-overview`, screenshots: [`https://media.example.test/${tag}.png`] },
    videoUrl: `https://media.example.test/${tag}.mp4`,
    pdfUrl: `https://media.example.test/${tag}.pdf`,
    resources: [{ type: 'pdf', url: `https://media.example.test/${tag}-sheet.pdf`, title: `${tag}-sheet` }],
    quiz: { questions: [{ question: `${tag}-q`, options: ['a', 'b'], correctAnswer: 1 }] },
    visualAids: [`${tag}-aid`],
    ...extra,
  };
}

function enrollment(userId, extra = {}) {
  return { _id: `progress-${userId}`, userId, courseId: String(COURSE_ID), progress: 10, completedLessons: [String(LESSON.intro)], active: true, ...extra };
}

function fixtureSeed() {
  return {
    courses: [
      { _id: COURSE_ID, title: 'Forex Basics', instructorId: INSTRUCTOR, difficulty: 'beginner' },
      { _id: OTHER_COURSE_ID, title: 'Other', instructorId: INSTRUCTOR, difficulty: 'beginner' },
    ],
    lessons: [
      lessonDoc('paidB', 4),
      lessonDoc('intro', 1),
      lessonDoc('demo', 3, { isDemo: true }),
      lessonDoc('paidA', 2),
    ],
    progress: [
      enrollment(STUDENTS.enrolledUnpaid),
      enrollment(STUDENTS.paid),
      enrollment(STUDENTS.complimentary),
      enrollment(STUDENTS.manualGrant),
      enrollment(STUDENTS.legacyLesson),
      enrollment(STUDENTS.unpaidAccessRow),
      enrollment(STUDENTS.otherCoursePaid),
      enrollment(STUDENTS.withdrawnPaid, { active: false, withdrawnAt: new Date('2026-10-01T00:00:00Z') }),
    ],
    [COLLECTIONS.courseAccess]: [
      { userId: STUDENTS.paid, courseId: String(COURSE_ID), paid: true, entitlementType: 'paid_course' },
      { userId: STUDENTS.complimentary, courseId: String(COURSE_ID), paid: false, entitlementType: 'complimentary' },
      { userId: STUDENTS.manualGrant, courseId: String(COURSE_ID), entitlementType: 'manual_grant' },
      { userId: STUDENTS.unpaidAccessRow, courseId: String(COURSE_ID), paid: false },
      { userId: STUDENTS.otherCoursePaid, courseId: String(OTHER_COURSE_ID), paid: true, entitlementType: 'paid_course' },
      { userId: STUDENTS.withdrawnPaid, courseId: String(COURSE_ID), paid: true, entitlementType: 'paid_course' },
      { userId: STUDENTS.paidNotEnrolled, courseId: String(COURSE_ID), paid: true, entitlementType: 'paid_course' },
    ],
    [COLLECTIONS.lessonAccess]: [
      { userId: STUDENTS.legacyLesson, lessonId: String(LESSON.paidA), courseId: String(COURSE_ID), paid: true },
    ],
  };
}

function fixtureDb() {
  return memoryDb(fixtureSeed());
}

const ENV = { PAYSTACK_SECRET_KEY: 'configured-for-test' };
const student = (userId) => ({ userId, role: 'student' });

async function list(db, member, env = ENV) {
  return listCourseLessons(db, { member, courseId: String(COURSE_ID), env });
}

/** The same composition GET /api/lessons performs (see the source contract test below). */
async function lessonsIndexFlow(db, member, env = ENV) {
  const course = await db.collection('courses').findOne({ _id: COURSE_ID });
  const enrollmentRow = await db.collection('progress').findOne({
    userId: member.userId,
    $or: [{ courseId: String(course._id) }, { courseId: course._id }],
  });
  const catalog = decideLessonCatalog({
    member,
    course: { _id: course._id, instructorId: course.instructorId },
    enrollment: enrollmentDecisionRecord(enrollmentRow),
  });
  if (!catalog.ok) return { ok: false, status: catalog.status };
  const lessons = await db.collection('lessons').find({ courseId: catalog.courseId }).sort({ order: 1 }).toArray();
  const entitlement = await loadCourseEntitlement(db, member, catalog.courseId, lessons.map((l) => String(l._id)));
  return {
    ok: true,
    lessons: presentCourseLessons({
      member,
      course: { _id: course._id, instructorId: course.instructorId, difficulty: course.difficulty },
      enrollmentRow,
      lessons,
      pricing: priceCourseLessons(lessons, entitlement, env),
    }),
  };
}

function byTitle(lessons) {
  return Object.fromEntries(lessons.map((lesson) => [lesson.title.replace('Lesson ', ''), lesson]));
}

const ALLOWED_LOCKED_KEYS = new Set(['_id', 'title', 'type', 'order', 'courseId', 'locked', 'accessible', 'completed', 'isFirstLesson', 'isFreePreview', 'isDemo', 'monetization', 'resources', ...WITHHELD_LESSON_FIELDS]);

function assertNoProtectedContent(view, label) {
  for (const key of WITHHELD_LESSON_FIELDS) {
    assert.equal(view[key], null, `${label}: ${key} must be null`);
  }
  assert.deepEqual(view.resources, [], `${label}: resources must be empty`);
  for (const key of Object.keys(view)) {
    assert.equal(ALLOWED_LOCKED_KEYS.has(key), true, `${label}: unexpected field ${key}`);
  }
}

function assertWithoutContent(view, label) {
  for (const key of ['content', 'summary', 'lessonSummary', 'videoUrl', 'pdfUrl', 'quiz', 'visualAids']) {
    assert.equal(view[key] == null, true, `${label}: ${key} must be absent`);
  }
  assert.equal(Array.isArray(view.resources) ? view.resources.length : 0, 0, `${label}: resources must be absent`);
}

function assertHasContent(view, key) {
  assert.equal(view.content, `<p>SECRET-${key}-content</p>`);
  assert.equal(view.videoUrl, `https://media.example.test/SECRET-${key}.mp4`);
  assert.equal(view.pdfUrl, `https://media.example.test/SECRET-${key}.pdf`);
  assert.equal(view.resources.length, 1);
  assert.equal(view.locked, false);
}

// ---------------------------------------------------------------------------
// 1. Unauthenticated requests
// ---------------------------------------------------------------------------

test('source contract: the course lessons route requires authentication before any lesson read', () => {
  const route = read('pages/api/courses/[id]/lessons.ts');
  assert.match(route, /export default withAuth\(handler\);/);
  const middleware = read('lib/auth-middleware.ts');
  assert.equal(middleware.includes("res.status(401).json({ error: 'Authentication required' });"), true);
});

test('a missing or unknown member is refused without reading lessons', async () => {
  for (const member of [null, undefined, { userId: '', role: 'student' }, { userId: STUDENTS.paid, role: 'guest' }]) {
    const db = fixtureDb();
    const result = await listCourseLessons(db, { member, courseId: String(COURSE_ID), env: ENV });
    assert.deepEqual(result, { ok: false, status: 403, error: 'Not authorized' });
  }
});

test('an invalid or unknown course id is rejected', async () => {
  const db = fixtureDb();
  assert.equal((await listCourseLessons(db, { member: student(STUDENTS.paid), courseId: 'not-an-id', env: ENV })).status, 400);
  assert.equal((await listCourseLessons(db, { member: student(STUDENTS.paid), courseId: ['x'], env: ENV })).status, 400);
  const missing = await listCourseLessons(db, { member: student(STUDENTS.paid), courseId: '64b0000000000000000000ff', env: ENV });
  assert.equal(missing.status, 404);
});

// ---------------------------------------------------------------------------
// 2–4. Students who may not read paid content
// ---------------------------------------------------------------------------

test('an unenrolled student gets the outline only, with no lesson content at all', async () => {
  const db = fixtureDb();
  const result = await list(db, student(STUDENTS.unenrolled));
  assert.equal(result.ok, true);
  assert.equal(result.lessons.length, 4);
  const body = JSON.stringify(result);
  assert.equal(body.includes('SECRET-'), false, 'no protected marker may be serialized');
  for (const view of result.lessons) {
    assert.equal(view.accessible, false);
    assertWithoutContent(view, view.title);
    assert.equal(view.completed, undefined);
  }
  const lessons = byTitle(result.lessons);
  assert.equal(lessons.paidA.locked, true);
  assert.equal(lessons.paidB.locked, true);
  assert.equal(lessons.paidA.description, null);
  assert.equal(lessons.intro.locked, false);
});

test('a paid but unenrolled student still gets no content until enrolled', async () => {
  const db = fixtureDb();
  const result = await list(db, student(STUDENTS.paidNotEnrolled));
  assert.equal(JSON.stringify(result).includes('SECRET-'), false);
  assert.equal(result.lessons.every((view) => view.locked === false), true, 'the outline still shows the course as owned');
});

test('a locked lesson carries no protected fields or media URLs', async () => {
  const db = fixtureDb();
  const result = await list(db, student(STUDENTS.enrolledUnpaid));
  const lessons = byTitle(result.lessons);
  for (const key of ['paidA', 'paidB']) {
    assert.equal(lessons[key].locked, true);
    assert.equal(lessons[key].monetization.requiresPayment, true);
    assertNoProtectedContent(lessons[key], key);
    assert.equal(JSON.stringify(lessons[key]).includes('SECRET-'), false);
    assert.equal(JSON.stringify(lessons[key]).includes(`Blurb ${key}`), false);
  }
});

test('an enrolled student without a course entitlement cannot read paid lessons', async () => {
  for (const userId of [STUDENTS.enrolledUnpaid, STUDENTS.unpaidAccessRow, STUDENTS.otherCoursePaid]) {
    const db = fixtureDb();
    const body = JSON.stringify(await list(db, student(userId)));
    assert.equal(body.includes('SECRET-paidA'), false, userId);
    assert.equal(body.includes('SECRET-paidB'), false, userId);
  }
});

test('a withdrawn enrollment does not expose content even with a paid entitlement', async () => {
  const db = fixtureDb();
  const result = await list(db, student(STUDENTS.withdrawnPaid));
  assert.equal(JSON.stringify(result).includes('SECRET-'), false);
});

test('paid lessons stay locked when Paystack is not configured', async () => {
  const db = fixtureDb();
  const body = JSON.stringify(await list(db, student(STUDENTS.enrolledUnpaid), {}));
  assert.equal(body.includes('SECRET-paidA'), false);
  assert.equal(body.includes('SECRET-paidB'), false);
});

// ---------------------------------------------------------------------------
// 5–6. Members who may read paid content
// ---------------------------------------------------------------------------

test('a verified full-course entitlement unlocks every lesson for an enrolled student', async () => {
  const db = fixtureDb();
  const result = await list(db, student(STUDENTS.paid));
  const lessons = byTitle(result.lessons);
  for (const key of Object.keys(LESSON)) assertHasContent(lessons[key], key);
  assert.equal(lessons.intro.completed, true);
  assert.equal(lessons.paidA.completed, false);
});

test('complimentary and manual grants keep full-course access', async () => {
  for (const userId of [STUDENTS.complimentary, STUDENTS.manualGrant]) {
    const db = fixtureDb();
    const lessons = byTitle((await list(db, student(userId))).lessons);
    assertHasContent(lessons.paidA, 'paidA');
    assertHasContent(lessons.paidB, 'paidB');
  }
});

test('the course instructor and admins see all content; other instructors see the outline', async () => {
  for (const member of [{ userId: INSTRUCTOR, role: 'instructor' }, { userId: ADMIN, role: 'admin' }, { userId: ADMIN, role: 'superadmin' }]) {
    const db = fixtureDb();
    const lessons = byTitle((await list(db, member)).lessons);
    assertHasContent(lessons.paidB, 'paidB');
  }
  const db = fixtureDb();
  const other = await list(db, { userId: OTHER_INSTRUCTOR, role: 'instructor' });
  assert.equal(JSON.stringify(other).includes('SECRET-'), false);
});

// ---------------------------------------------------------------------------
// 7–8. Free lessons and legacy lesson purchases
// ---------------------------------------------------------------------------

test('the first lesson and demo lessons stay free for an enrolled student', async () => {
  const db = fixtureDb();
  const lessons = byTitle((await list(db, student(STUDENTS.enrolledUnpaid))).lessons);
  assertHasContent(lessons.intro, 'intro');
  assert.equal(lessons.intro.monetization.isFreeTier, true);
  assertHasContent(lessons.demo, 'demo');
  assert.equal(lessons.demo.monetization.isDemo, true);
});

test('a lesson marked isFirstLesson is free even when it is not first by order', async () => {
  const db = fixtureDb();
  db.collection('lessons').docs.find((doc) => sameValue(doc._id, LESSON.paidB)).isFirstLesson = true;
  const lessons = byTitle((await list(db, student(STUDENTS.enrolledUnpaid))).lessons);
  assertHasContent(lessons.paidB, 'paidB');
  assert.equal(lessons.paidA.locked, true);
});

test('a legacy lesson purchase unlocks only that lesson, never the course', async () => {
  const db = fixtureDb();
  const result = await list(db, student(STUDENTS.legacyLesson));
  const lessons = byTitle(result.lessons);
  assertHasContent(lessons.paidA, 'paidA');
  assert.equal(lessons.paidB.locked, true);
  assertNoProtectedContent(lessons.paidB, 'paidB');
  assert.equal(JSON.stringify(result).includes('SECRET-paidB'), false);
});

// ---------------------------------------------------------------------------
// 9. Both lesson endpoints
// ---------------------------------------------------------------------------

test('GET /api/lessons and GET /api/courses/:id/lessons return the same lesson views to an enrolled student', async () => {
  for (const userId of [STUDENTS.enrolledUnpaid, STUDENTS.paid, STUDENTS.complimentary, STUDENTS.legacyLesson, STUDENTS.unpaidAccessRow]) {
    const fromCourse = await list(fixtureDb(), student(userId));
    const fromIndex = await lessonsIndexFlow(fixtureDb(), student(userId));
    assert.equal(fromIndex.ok, true);
    assert.deepEqual(fromIndex.lessons, fromCourse.lessons, userId);
  }
});

test('GET /api/lessons refuses an unenrolled student; the course list gives that student the outline only', async () => {
  const index = await lessonsIndexFlow(fixtureDb(), student(STUDENTS.unenrolled));
  assert.deepEqual(index, { ok: false, status: 403 });
  const course = await list(fixtureDb(), student(STUDENTS.unenrolled));
  assert.equal(JSON.stringify(course).includes('SECRET-'), false);
});

test('source contract: both lesson endpoints use the shared lesson presentation', () => {
  const courseRoute = read('pages/api/courses/[id]/lessons.ts');
  assert.equal(courseRoute.includes("from '@/lib/course-lesson-list'"), true);
  assert.equal(courseRoute.includes('listCourseLessons(db'), true);
  assert.equal(courseRoute.includes('buildSimpleLessonsWithLocked'), false);

  const indexRoute = read('pages/api/lessons/index.ts');
  assert.equal(indexRoute.includes("from '@/lib/course-lesson-list'"), true);
  assert.equal(indexRoute.includes('decideLessonCatalog({'), true);
  assert.equal(indexRoute.includes('loadCourseEntitlement('), true);
  assert.equal(indexRoute.includes('presentCourseLessons({'), true);
  assert.equal(indexRoute.includes('priceCourseLessons(lessonsList, entitlement, undefined, { explicitPreview: course!.freePreviewExplicit === true })'), true);
  assert.equal(indexRoute.includes('buildLessonsListForCourse'), false);

  const builder = read('lib/course-lessons-locked.ts');
  assert.equal(builder.includes('presentLessonRead(lesson, false, courseId)'), true);
  assert.equal(builder.includes('withholdLockedContent(row)'), true);
});

test('the shared pricing helper never returns content for any row', async () => {
  const db = fixtureDb();
  const lessons = sortLessonsByOrder(db.collection('lessons').docs);
  const entitlement = await loadCourseEntitlement(db, student(STUDENTS.paid), String(COURSE_ID), lessons.map((l) => String(l._id)));
  assert.equal(entitlement.coursePaid, true);
  const anonymous = await loadCourseEntitlement(db, undefined, String(COURSE_ID), lessons.map((l) => String(l._id)));
  assert.deepEqual({ ...anonymous, legacyLessonIds: [...anonymous.legacyLessonIds] }, { staff: false, coursePaid: false, legacyLessonIds: [] });
  const pricing = priceCourseLessons(lessons, anonymous, ENV);
  assert.deepEqual(lessons.map((l) => pricing.get(String(l._id)).locked), [false, true, false, true]);
});

// ---------------------------------------------------------------------------
// 10. Reads only
// ---------------------------------------------------------------------------

test('requesting lesson lists never creates or changes entitlement, enrollment, or payment records', async () => {
  const db = fixtureDb();
  const before = db.snapshot();
  const members = [
    ...Object.values(STUDENTS).map(student),
    { userId: INSTRUCTOR, role: 'instructor' },
    { userId: ADMIN, role: 'admin' },
  ];
  for (const member of members) {
    await list(db, member);
    await list(db, member, {});
    await lessonsIndexFlow(db, member);
  }
  assert.deepEqual(db.writes, []);
  assert.equal(db.snapshot(), before);
});

// ---------------------------------------------------------------------------
// 11. GET /api/lessons/:id (single lesson)
// ---------------------------------------------------------------------------

const ALL_MEMBERS = [
  ...Object.values(STUDENTS).map((userId) => ({ userId, role: 'student' })),
  { userId: INSTRUCTOR, role: 'instructor' },
  { userId: OTHER_INSTRUCTOR, role: 'instructor' },
  { userId: ADMIN, role: 'admin' },
];

function detailDb() {
  const seed = fixtureSeed();
  seed.users = ALL_MEMBERS.map((m) => ({ _id: new ObjectId(m.userId), email: `${m.userId}@example.test`, role: m.role }));
  seed.quizzes = Object.keys(LESSON).map((key) => ({
    lessonId: String(LESSON[key]),
    questions: [{ question: `SECRET-${key}-quiz`, options: ['a', 'b'], correctAnswer: 0 }],
  }));
  return memoryDb(seed);
}

async function detail(db, userId, key, env = ENV) {
  return readLessonDetail(db, { userId, lessonId: String(LESSON[key]), env });
}

const LOCKED_BODY_KEYS = ['access', 'lessonMeta', 'locked', 'message', 'monetization'];

test('single lesson: a paid lesson is refused to students without a course entitlement, with no content', async () => {
  for (const userId of [STUDENTS.enrolledUnpaid, STUDENTS.unpaidAccessRow, STUDENTS.otherCoursePaid]) {
    for (const env of [ENV, {}]) {
      for (const key of ['paidA', 'paidB']) {
        const { status, body } = await detail(detailDb(), userId, key, env);
        assert.equal(status, 403, `${userId} ${key}`);
        assert.deepEqual(Object.keys(body).sort(), LOCKED_BODY_KEYS);
        assert.equal(body.message, LESSON_LOCKED_MESSAGE);
        assert.equal(body.monetization.requiresPayment, true);
        assert.deepEqual(body.lessonMeta, { _id: String(LESSON[key]), courseId: String(COURSE_ID), title: `Lesson ${key}` });
        assert.equal(JSON.stringify(body).includes('SECRET-'), false);
        assert.equal(JSON.stringify(body).includes('Blurb'), false);
      }
    }
  }
});

test('single lesson: an unenrolled or withdrawn student gets no lesson, even with a paid entitlement', async () => {
  for (const userId of [STUDENTS.unenrolled, STUDENTS.paidNotEnrolled, STUDENTS.withdrawnPaid]) {
    for (const key of Object.keys(LESSON)) {
      const { status, body } = await detail(detailDb(), userId, key);
      assert.equal(status, 403, `${userId} ${key}`);
      assert.deepEqual(Object.keys(body), ['error']);
      assert.equal(JSON.stringify(body).includes('SECRET-'), false);
    }
  }
});

test('single lesson: paid, complimentary, and manual entitlements return the full lesson and quiz', async () => {
  for (const userId of [STUDENTS.paid, STUDENTS.complimentary, STUDENTS.manualGrant]) {
    for (const key of Object.keys(LESSON)) {
      const { status, body } = await detail(detailDb(), userId, key);
      assert.equal(status, 200, `${userId} ${key}`);
      assertHasContent(body, key);
      assert.equal(body.access, true);
      assert.equal(body.monetization.unlocked, true);
      assert.equal(body.quiz.questions.length, 1);
    }
  }
});

test('single lesson: a legacy lesson purchase opens that lesson only', async () => {
  assert.equal((await detail(detailDb(), STUDENTS.legacyLesson, 'paidA')).status, 200);
  const other = await detail(detailDb(), STUDENTS.legacyLesson, 'paidB');
  assert.equal(other.status, 403);
  assert.equal(JSON.stringify(other.body).includes('SECRET-'), false);
});

test('single lesson: the first and demo lessons are free to an enrolled student', async () => {
  const intro = await detail(detailDb(), STUDENTS.enrolledUnpaid, 'intro');
  assert.equal(intro.status, 200);
  assertHasContent(intro.body, 'intro');
  assert.equal(intro.body.monetization.isFreeTier, true);
  assert.equal(intro.body.completed, true);
  const demo = await detail(detailDb(), STUDENTS.enrolledUnpaid, 'demo');
  assert.equal(demo.status, 200);
  assert.equal(demo.body.monetization.isDemo, true);
  assert.equal(demo.body.isDemo, true);
});

test('single lesson: the course instructor and admins read any lesson; another instructor does not', async () => {
  for (const userId of [INSTRUCTOR, ADMIN]) {
    const { status, body } = await detail(detailDb(), userId, 'paidB', {});
    assert.equal(status, 200);
    assertHasContent(body, 'paidB');
  }
  const other = await detail(detailDb(), OTHER_INSTRUCTOR, 'paidB');
  assert.equal(other.status, 403);
  assert.equal(JSON.stringify(other.body).includes('SECRET-'), false);
});

test('single lesson: invalid ids, missing lessons, and unknown accounts are refused', async () => {
  assert.equal((await readLessonDetail(detailDb(), { userId: STUDENTS.paid, lessonId: 'nope', env: ENV })).status, 400);
  assert.equal((await readLessonDetail(detailDb(), { userId: STUDENTS.paid, lessonId: ['x'], env: ENV })).status, 400);
  const missing = await readLessonDetail(detailDb(), { userId: STUDENTS.paid, lessonId: '64c0000000000000000000ff', env: ENV });
  assert.equal(missing.status, 404);
  const ghost = await readLessonDetail(detailDb(), { userId: '64a0000000000000000000ff', lessonId: String(LESSON.paidA), env: ENV });
  assert.equal(ghost.status, 403, 'no member reaches the lesson rule, which refuses');
  assert.equal(JSON.stringify(ghost.body).includes('SECRET-'), false);
});

test('single lesson and lesson lists agree on paywall state for every member and lesson', async () => {
  for (const member of ALL_MEMBERS) {
    const listed = await list(detailDb(), member);
    for (const view of listed.lessons) {
      const key = view.title.replace('Lesson ', '');
      const one = await detail(detailDb(), member.userId, key);
      if (one.status === 200) {
        assert.equal(view.locked, false, `${member.userId} ${key}`);
        assert.equal(view.accessible, true, `${member.userId} ${key}`);
        assert.deepEqual(one.body.monetization, view.monetization, `${member.userId} ${key}`);
      } else {
        assert.equal(view.content == null, true, `${member.userId} ${key}: list must not show what detail refuses`);
      }
    }
  }
});

test('single lesson requests never create or change entitlement, enrollment, or payment records', async () => {
  const db = detailDb();
  const before = db.snapshot();
  for (const member of ALL_MEMBERS) {
    for (const key of Object.keys(LESSON)) {
      await detail(db, member.userId, key);
      await detail(db, member.userId, key, {});
    }
  }
  assert.deepEqual(db.writes, []);
  assert.equal(db.snapshot(), before);
});

test('source contract: GET /api/lessons/:id delegates to the shared single-lesson read', () => {
  const route = read('pages/api/lessons/[id].ts');
  assert.equal(route.includes('readLessonDetail(db, { userId: req.user!.userId, lessonId })'), true);
  assert.equal(route.includes('stripLessonVisualAidsFields(body)'), true);
  assert.equal(route.includes('getMonetizationForLessonDoc'), false);
  assert.equal(route.includes('presentLessonRead('), false);
  const monetization = read('lib/lesson-monetization.ts');
  assert.equal(monetization.includes(`export const LESSON_LOCKED_MESSAGE = '${LESSON_LOCKED_MESSAGE}';`), true);
});

test('source contract: the lesson list module performs reads only', () => {
  const source = read('lib/course-lesson-list.js');
  for (const method of WRITE_METHODS) {
    assert.equal(source.includes(`.${method}(`), false, method);
  }
});
