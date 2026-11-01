/**
 * Phase 7: learning experience and lesson delivery. The real route handlers (Phase 4.5 cookie
 * sessions, CSRF and exact Origin through withAuth) and libraries run against an in-memory
 * database with the real unique indexes (tests/helpers/payment-memory-db.js). The client modules
 * (navigation, resume position, response classification) are run directly.
 *
 * Numbers in test names refer to the Phase 7 critical acceptance scenarios.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ObjectId } = require('mongodb');

const payment = require('../lib/course-payment');
const { grantCourseAccess, revokeCourseGrant } = require('../lib/course-access-admin');
const { OUTLINE_LESSON_PROJECTION, courseContentAccess } = require('../lib/course-lesson-list');
const documents = require('../lib/lesson-documents');
const { ENROLLMENT_INDEXES } = require('../lib/enrollment-indexes');
const { REFUND_INDEXES } = require('../lib/refund-indexes');
const { COURSE_PAYMENT_INDEXES } = require('../lib/course-payment-indexes');
const { matches, paymentMemoryDb } = require('./helpers/payment-memory-db');
const { loadModule, mockResponse } = require('./helpers/ts-loader');
const { requestHeaders, seedSession } = require('./helpers/session-cookie');

const { COLLECTIONS } = payment;
const ROOT = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const INDEXES = [...COURSE_PAYMENT_INDEXES, ...REFUND_INDEXES, ...ENROLLMENT_INDEXES];
const NOW = new Date('2026-11-08T10:00:00Z');
const newId = () => new ObjectId().toHexString();
const ROUTE_ENV = { NODE_ENV: 'test', PAYSTACK_SECRET_KEY: 'sk_test_phase7_unit_only', MONGODB_DB_NAME: 'forexorbit_p7_test', MONGO_URI: 'mongodb://127.0.0.1:27017', APP_ORIGIN: undefined, PORT: undefined, SHARED_RATE_LIMIT: undefined };
const SECRET = (key) => `SECRET-BODY-${key}`;
const STORAGE = (key) => `https://res.cloudinary.com/fo-test/raw/upload/private-${key}.pdf`;
const CONTENT_FIELDS = ['content', 'videoUrl', 'pdfUrl', 'lessonSummary', 'summary', 'quiz'];

/** paymentMemoryDb plus findOneAndUpdate with $addToSet (lib/course-progress.js) and a find log. */
function newDb() {
  const db = paymentMemoryDb({ uniqueIndexes: INDEXES });
  const base = db.collection.bind(db);
  db.finds = [];
  db.collection = (name) => {
    const col = base(name);
    if (!col.__phase7) {
      col.__phase7 = true;
      const find = col.find.bind(col);
      col.find = (query, options) => {
        db.finds.push({ name, query, options });
        return find(query, options);
      };
      col.findOneAndUpdate = async (filter, update) => {
        const doc = col.docs.find((row) => matches(row, filter));
        if (!doc) return null;
        for (const [key, value] of Object.entries(update.$addToSet || {})) {
          const list = Array.isArray(doc[key]) ? doc[key] : [];
          if (!list.map(String).includes(String(value))) list.push(value);
          doc[key] = list;
        }
        Object.assign(doc, update.$set || {});
        return { ...doc };
      };
    }
    return col;
  };
  return db;
}

async function withEnv(env, fn) {
  const saved = {};
  for (const key of Object.keys(env)) {
    saved[key] = process.env[key];
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

/**
 * Course P (published, explicit previews): intro (paid, first by order), preview (free preview at
 * position 2), paid (with PDF and resources), demo. Course Q (published, another instructor): a
 * preview and a paid lesson. Course D (draft) with one lesson.
 */
function seedWorld(db) {
  const w = { student: newId(), payer: newId(), stranger: newId(), instructor: newId(), admin: newId(), superadmin: newId(), P: newId(), Q: newId(), D: newId(), lesson: {} };
  const course = (id, status, instructorId) => db.rows('courses').push({ _id: new ObjectId(id), title: `Course ${id.slice(-4)}`, status, instructorId, difficulty: 'beginner', freePreviewExplicit: true, createdAt: NOW });
  course(w.P, 'published', w.instructor);
  course(w.Q, 'published', newId());
  course(w.D, 'draft', w.instructor);
  const lesson = (key, courseId, order, flags = {}) => {
    const id = newId();
    w.lesson[key] = id;
    db.rows('lessons').push({
      _id: new ObjectId(id), courseId, order, title: `Lesson ${key}`, type: 'video',
      content: `<p>${SECRET(key)}</p>`, videoUrl: `https://videos.example.test/${key}.mp4`, ...flags,
    });
  };
  lesson('intro', w.P, 1);
  lesson('preview', w.P, 2, { isFreePreview: true, pdfUrl: STORAGE('preview') });
  lesson('paid', w.P, 3, {
    pdfUrl: STORAGE('paid'),
    resources: [
      { type: 'pdf', title: 'Workbook', url: STORAGE('workbook') },
      { type: 'link', title: 'Old link', url: 'javascript:alert(1)' },
      { type: 'slide', title: 'Deck', url: 'https://docs.example.test/deck' },
    ],
  });
  lesson('demo', w.P, 4, { isDemo: true });
  lesson('qPreview', w.Q, 1, { isFreePreview: true });
  lesson('qPaid', w.Q, 2, { pdfUrl: STORAGE('qPaid') });
  lesson('draft', w.D, 1, { isFreePreview: true });
  db.rows('quizzes').push({ _id: new ObjectId(), lessonId: w.lesson.paid, questions: [{ question: 'Q?', options: ['a', 'b'], correctAnswer: 1 }] });
  return w;
}

function enroll(db, userId, courseId, extra = {}) {
  db.rows('progress').push({ _id: new ObjectId(), userId, courseId, progress: 0, completedLessons: [], active: true, createdAt: NOW, ...extra });
}

function entitle(db, userId, courseId) {
  db.rows(COLLECTIONS.courseAccess).push({ _id: new ObjectId(), userId, courseId, paid: true, entitlementType: 'paid_course', unlockedAt: NOW });
}

function signIn(db, userId, roleName) {
  db.rows('users').push({ _id: new ObjectId(userId), email: `${roleName}-${userId.slice(-6)}@example.test`, name: `${roleName} ${userId.slice(-4)}`, role: roleName, status: 'approved', sessionGeneration: 0 });
  return seedSession(db.rows('sessions'), { userId, generation: 0, now: new Date() });
}

async function call(handler, { method = 'GET', token, body, query = {}, headers } = {}) {
  const res = mockResponse();
  await handler({ method, url: '/api/test', headers: headers || requestHeaders(token), body, query, socket: { remoteAddress: '10.0.0.7' } }, res);
  return res;
}

function route(file, db) {
  return loadModule(file, { 'lib/mongodb': { getDb: async () => db }, 'lib/socket-server': { getSocketServer: () => null } }).default;
}

function routes(db) {
  return {
    lesson: route('pages/api/lessons/[id].ts', db),
    document: route('pages/api/lessons/[id]/document.ts', db),
    outline: route('pages/api/courses/[id]/lessons.ts', db),
    course: route('pages/api/courses/[id].ts', db),
    progress: route('pages/api/progress/index.ts', db),
  };
}

/** No protected field and no lesson body text anywhere in a response body. */
function assertNoContent(body, label) {
  const text = JSON.stringify(body || {});
  assert.equal(/SECRET-BODY-/.test(text), false, `${label}: lesson body leaked`);
  assert.equal(/res\.cloudinary\.com|videos\.example\.test|docs\.example\.test/.test(text), false, `${label}: media or document URL leaked`);
}

function world() {
  const db = newDb();
  const w = seedWorld(db);
  const r = routes(db);
  const T = {
    student: signIn(db, w.student, 'student'),
    payer: signIn(db, w.payer, 'student'),
    stranger: signIn(db, w.stranger, 'student'),
    instructor: signIn(db, w.instructor, 'instructor'),
    superadmin: signIn(db, w.superadmin, 'superadmin'),
  };
  enroll(db, w.student, w.P);
  enroll(db, w.payer, w.P);
  entitle(db, w.payer, w.P);
  return { db, w, r, T };
}

const SUPER_ACTOR = (w) => ({ userId: w.superadmin, email: 'owner@example.test', role: 'superadmin' });

// ---------------------------------------------------------------------------
// Lesson access (scenarios 1-5)
// ---------------------------------------------------------------------------

test('1. an enrolled student with the course entitlement opens every lesson, with content, quiz and documents', async () => {
  await withEnv(ROUTE_ENV, async () => {
    const { w, r, T } = world();
    for (const key of ['intro', 'preview', 'paid', 'demo']) {
      const res = await call(r.lesson, { token: T.payer, query: { id: w.lesson[key] } });
      assert.equal(res.statusCode, 200, key);
      assert.equal(res.body.content, `<p>${SECRET(key)}</p>`, key);
      assert.equal(res.body.videoUrl, `https://videos.example.test/${key}.mp4`, key);
    }
    const paid = await call(r.lesson, { token: T.payer, query: { id: w.lesson.paid } });
    assert.equal(paid.body.quiz.questions.length, 1);
    assert.equal(paid.body.completed, false);
  });
});

test('2. an unenrolled student cannot open any lesson, free preview included, and receives no content', async () => {
  await withEnv(ROUTE_ENV, async () => {
    const { w, r, T } = world();
    for (const key of ['intro', 'preview', 'paid', 'demo']) {
      const res = await call(r.lesson, { token: T.stranger, query: { id: w.lesson[key] } });
      assert.equal(res.statusCode, 403, key);
      assert.equal(res.body.error, 'Unable to access lesson');
      assertNoContent(res.body, key);
    }
    // No session at all.
    assert.equal((await call(r.lesson, { query: { id: w.lesson.preview } })).statusCode, 401);
  });
});

test('3. an explicitly flagged free preview opens for an enrolled student without payment; the unflagged first lesson does not', async () => {
  await withEnv(ROUTE_ENV, async () => {
    const { w, r, T } = world();
    const preview = await call(r.lesson, { token: T.student, query: { id: w.lesson.preview } });
    assert.equal(preview.statusCode, 200);
    assert.equal(preview.body.content, `<p>${SECRET('preview')}</p>`);
    assert.equal(preview.body.isFreePreview, true);
    const demo = await call(r.lesson, { token: T.student, query: { id: w.lesson.demo } });
    assert.equal(demo.statusCode, 200);
    for (const key of ['intro', 'paid']) {
      const res = await call(r.lesson, { token: T.student, query: { id: w.lesson[key] } });
      assert.equal(res.statusCode, 403, key);
      assert.deepEqual([res.body.access, res.body.locked], [false, true], key);
      assert.equal(res.body.lessonMeta.title, `Lesson ${key}`);
      assertNoContent(res.body, key);
      for (const field of CONTENT_FIELDS) assert.equal(res.body[field], undefined, `${key}.${field}`);
    }
  });
});

test('4. a revoked grant, a withdrawn enrollment and a refund that revokes access each close protected content again', async () => {
  await withEnv(ROUTE_ENV, async () => {
    const { db, w, r, T } = world();
    const granted = await grantCourseAccess(db, { actor: SUPER_ACTOR(w), userId: w.student, courseId: w.P, reason: 'Phase 7 complimentary access', now: NOW });
    assert.equal(granted.ok, true);
    assert.equal((await call(r.lesson, { token: T.student, query: { id: w.lesson.paid } })).statusCode, 200);
    assert.equal((await call(r.document, { token: T.student, query: { id: w.lesson.paid, item: 'pdf' } })).statusCode, 302);
    const revoked = await revokeCourseGrant(db, { actor: SUPER_ACTOR(w), userId: w.student, courseId: w.P, reason: 'Phase 7 revocation check', now: NOW });
    assert.equal(revoked.ok, true);
    const after = await call(r.lesson, { token: T.student, query: { id: w.lesson.paid } });
    assert.equal(after.statusCode, 403);
    assertNoContent(after.body, 'after revocation');
    const link = await call(r.document, { token: T.student, query: { id: w.lesson.paid, item: 'pdf' } });
    assert.equal(link.statusCode, 403, 'a document link obtained earlier stops working');
    assert.equal(link.headers.location, undefined);

    // Withdrawn (left the course): even the paying student's entitlement does not open lessons
    // until they enroll again.
    const row = db.rows('progress').find((p) => p.userId === w.payer && p.courseId === w.P);
    row.active = false;
    row.withdrawnAt = NOW;
    assert.equal((await call(r.lesson, { token: T.payer, query: { id: w.lesson.paid } })).statusCode, 403);
    assert.equal((await call(r.document, { token: T.payer, query: { id: w.lesson.paid, item: 'r0' } })).statusCode, 403);
    delete row.withdrawnAt;
    row.active = true;

    // Refund with revocation: the entitlement row stops counting.
    const access = db.rows(COLLECTIONS.courseAccess).find((a) => a.userId === w.payer);
    access.paid = false;
    access.entitlementType = 'revoked';
    assert.equal((await call(r.lesson, { token: T.payer, query: { id: w.lesson.paid } })).statusCode, 403);
    assert.equal((await call(r.lesson, { token: T.payer, query: { id: w.lesson.preview } })).statusCode, 200, 'free preview stays open');
  });
});

test('5. guessed lesson URLs do not bypass access: another course, a draft course, unknown and malformed ids', async () => {
  await withEnv(ROUTE_ENV, async () => {
    const { w, r, T } = world();
    // Paid for P, never enrolled in Q.
    for (const key of ['qPreview', 'qPaid']) {
      const res = await call(r.lesson, { token: T.payer, query: { id: w.lesson[key] } });
      assert.equal(res.statusCode, 403, key);
      assertNoContent(res.body, key);
      const doc = await call(r.document, { token: T.payer, query: { id: w.lesson[key], item: 'pdf' } });
      assert.equal(doc.statusCode, 403, `${key} document`);
    }
    const draft = await call(r.lesson, { token: T.payer, query: { id: w.lesson.draft } });
    assert.equal(draft.statusCode, 403);
    assertNoContent(draft.body, 'draft');
    assert.equal((await call(r.lesson, { token: T.payer, query: { id: newId() } })).statusCode, 404);
    assert.equal((await call(r.lesson, { token: T.payer, query: { id: '../../etc/passwd' } })).statusCode, 400);
    assert.equal((await call(r.document, { token: T.payer, query: { id: 'not-an-id', item: 'pdf' } })).statusCode, 400);
    // The instructor of P cannot read another instructor's course Q either.
    assert.equal((await call(r.lesson, { token: T.instructor, query: { id: w.lesson.qPaid } })).statusCode, 403);
  });
});

// ---------------------------------------------------------------------------
// Documents and PDFs (scenarios 12, 13)
// ---------------------------------------------------------------------------

test('12. students get gated document paths, never the stored URLs; entitled students are redirected to the document', async () => {
  await withEnv(ROUTE_ENV, async () => {
    const { w, r, T } = world();
    const res = await call(r.lesson, { token: T.payer, query: { id: w.lesson.paid } });
    assert.equal(res.statusCode, 200);
    const id = w.lesson.paid;
    assert.equal(res.body.pdfUrl, `/api/lessons/${id}/document?item=pdf`);
    assert.deepEqual(res.body.resources, [
      { title: 'Workbook', type: 'pdf', url: `/api/lessons/${id}/document?item=r0`, available: true },
      { title: 'Old link', type: 'link', url: null, available: false },
      { title: 'Deck', type: 'slide', url: `/api/lessons/${id}/document?item=r2`, available: true },
    ]);
    assert.equal(/res\.cloudinary\.com|docs\.example\.test/.test(JSON.stringify(res.body)), false);

    const pdf = await call(r.document, { token: T.payer, query: { id, item: 'pdf' } });
    assert.deepEqual([pdf.statusCode, pdf.headers.location], [302, STORAGE('paid')]);
    assert.equal(pdf.headers['cache-control'], 'private, no-store, max-age=0');
    assert.equal(pdf.headers['referrer-policy'], 'no-referrer');
    const deck = await call(r.document, { token: T.payer, query: { id, item: 'r2' } });
    assert.deepEqual([deck.statusCode, deck.headers.location], [302, 'https://docs.example.test/deck']);
    // Free preview PDF for an enrolled student who has not paid.
    const previewPdf = await call(r.document, { token: T.student, query: { id: w.lesson.preview, item: 'pdf' } });
    assert.deepEqual([previewPdf.statusCode, previewPdf.headers.location], [302, STORAGE('preview')]);

    // Staff keep the stored URLs (the lesson editor needs them).
    const staff = await call(r.lesson, { token: T.instructor, query: { id } });
    assert.equal(staff.body.pdfUrl, STORAGE('paid'));
    assert.equal(staff.body.resources[0].url, STORAGE('workbook'));
    // The full lesson list and the course detail apply the same student view.
    const list = await call(r.outline, { token: T.payer, query: { id: w.P } });
    const listed = list.body.lessons.find((l) => String(l._id) === id);
    assert.equal(listed.pdfUrl, `/api/lessons/${id}/document?item=pdf`);
    const detail = await call(r.course, { token: T.payer, query: { id: w.P } });
    assert.equal(/res\.cloudinary\.com|docs\.example\.test/.test(JSON.stringify(detail.body)), false);
  });
});

test('13. unauthorized document downloads are rejected without a redirect; bad items and unusable links are refused', async () => {
  await withEnv(ROUTE_ENV, async () => {
    const { w, r, T } = world();
    const id = w.lesson.paid;
    const cases = [
      ['not paid', T.student, { id, item: 'pdf' }, 403],
      ['not enrolled', T.stranger, { id, item: 'r0' }, 403],
      ['no session', undefined, { id, item: 'pdf' }, 401],
      ['unsafe stored link', T.payer, { id, item: 'r1' }, 404],
      ['no such resource', T.payer, { id, item: 'r9' }, 404],
      ['lesson without a PDF', T.payer, { id: w.lesson.demo, item: 'pdf' }, 404],
      ['malformed item', T.payer, { id, item: '../r0' }, 400],
      ['malformed item (url)', T.payer, { id, item: 'https://evil.test' }, 400],
    ];
    for (const [label, token, query, status] of cases) {
      const res = await call(r.document, { token, query });
      assert.equal(res.statusCode, status, label);
      assert.equal(res.headers.location, undefined, label);
      assertNoContent(res.body, label);
    }
    const locked = await call(r.document, { token: T.student, query: { id, item: 'pdf' } });
    assert.equal(locked.body.code, 'lesson_locked');
    assert.equal((await call(r.document, { method: 'POST', token: T.payer, query: { id, item: 'pdf' } })).statusCode, 405);
  });
});

test('lesson-documents: item parsing, URL policy and type labels', () => {
  assert.equal(documents.isDocumentItem('pdf'), true);
  assert.equal(documents.isDocumentItem('r0'), true);
  assert.equal(documents.isDocumentItem('r999'), true);
  for (const bad of ['r01', 'r1000', 'R1', 'pdf ', '', null, 'r-1', 'resources']) assert.equal(documents.isDocumentItem(bad), false, String(bad));
  const lesson = { pdfUrl: 'notes.pdf', resources: [{ url: 'data:text/html,x' }, { url: 'https://a.test/x.pdf' }] };
  assert.equal(documents.resolveLessonDocument(lesson, 'pdf'), null, 'relative links are not redirected to');
  assert.equal(documents.resolveLessonDocument(lesson, 'r0'), null);
  assert.equal(documents.resolveLessonDocument(lesson, 'r1'), 'https://a.test/x.pdf');
  for (const bad of ['x1', 'r01', '__proto__', 'constructor']) assert.equal(documents.resolveLessonDocument(lesson, bad), null, bad);
  assert.equal(documents.documentType('', 'https://a.test/x.PDF?dl=1'), 'pdf');
  assert.equal(documents.documentType('exe', 'https://a.test/x'), 'file');
});

// ---------------------------------------------------------------------------
// Navigation and outline (scenarios 8, 9)
// ---------------------------------------------------------------------------

test('8. previous/next resolve the right lessons, with lock state, from the outline', async () => {
  await withEnv(ROUTE_ENV, async () => {
    const nav = loadModule('lib/lesson-navigation.ts');
    const { w, r, T } = world();
    const res = await call(r.outline, { token: T.student, query: { id: w.P, view: 'outline' } });
    assert.equal(res.statusCode, 200);
    const lessons = res.body.lessons;
    assert.deepEqual(lessons.map((l) => l.title), ['Lesson intro', 'Lesson preview', 'Lesson paid', 'Lesson demo']);
    const atPreview = nav.resolveLessonNavigation(lessons, w.lesson.preview);
    assert.deepEqual([atPreview.position, atPreview.total], [2, 4]);
    assert.deepEqual([atPreview.prev.id, atPreview.prev.locked], [w.lesson.intro, true]);
    assert.deepEqual([atPreview.next.id, atPreview.next.locked], [w.lesson.paid, true]);
    const atDemo = nav.resolveLessonNavigation(lessons, w.lesson.demo);
    assert.deepEqual([atDemo.prev.id, atDemo.next], [w.lesson.paid, null]);
    const atIntro = nav.resolveLessonNavigation(lessons, w.lesson.intro);
    assert.equal(atIntro.prev, null);
    assert.equal(nav.resolveLessonNavigation(lessons, newId()).position, 0, 'a lesson of another course has no neighbours here');
    // Where to continue: the first open, unfinished lesson (the free preview, not the locked intro).
    assert.equal(nav.continueLesson(lessons).id, w.lesson.preview);
    const done = nav.markCompleted(lessons, w.lesson.preview);
    assert.equal(nav.continueLesson(done).id, w.lesson.demo);
    assert.equal(nav.resolveLessonNavigation(done, w.lesson.demo).completedCount, 1);
    // A paying student moves through every lesson.
    const paid = (await call(r.outline, { token: T.payer, query: { id: w.P, view: 'outline' } })).body.lessons;
    assert.equal(paid.every((l) => l.locked === false), true);
    assert.equal(nav.resolveLessonNavigation(paid, w.lesson.preview).next.locked, false);
    assert.equal(nav.lessonHref(w.P, w.lesson.paid), `/courses/${w.P}/lessons/${w.lesson.paid}`);
  });
});

test('9. the outline never reads or returns lesson bodies, and opening a lesson reads only that lesson body', async () => {
  await withEnv(ROUTE_ENV, async () => {
    const { db, w, r, T } = world();
    db.finds.length = 0;
    const res = await call(r.outline, { token: T.payer, query: { id: w.P, view: 'outline' } });
    assert.equal(res.statusCode, 200);
    const lessonFind = db.finds.find((f) => f.name === 'lessons');
    assert.deepEqual(lessonFind.options.projection, OUTLINE_LESSON_PROJECTION);
    for (const field of ['content', 'videoUrl', 'pdfUrl', 'resources', 'lessonSummary']) {
      assert.equal(OUTLINE_LESSON_PROJECTION[field], undefined, `outline projection reads ${field}`);
    }
    for (const lesson of res.body.lessons) {
      for (const field of [...CONTENT_FIELDS, 'resources']) assert.equal(lesson[field], undefined, field);
    }
    assertNoContent(res.body, 'outline (paying student)');
    // Completion state and preview flag are part of the outline (Phase 7).
    const preview = res.body.lessons.find((l) => String(l._id) === w.lesson.preview);
    assert.deepEqual([preview.completed, preview.isFreePreview], [false, true]);
    // Opening one lesson: sibling lessons are read for pricing only.
    db.finds.length = 0;
    await call(r.lesson, { token: T.payer, query: { id: w.lesson.paid } });
    const siblings = db.finds.filter((f) => f.name === 'lessons');
    assert.equal(siblings.length, 1);
    assert.deepEqual(siblings[0].options.projection, { _id: 1, order: 1, isFirstLesson: 1, isFreePreview: 1, isDemo: 1 });
    // The lesson page asks for the outline once per course (not once per lesson).
    const hook = read('hooks/useLesson.ts');
    assert.match(hook, /\/lessons\?view=outline`/);
    assert.match(hook, /\}, \[courseId, enabled\]\);/);
  });
});

// ---------------------------------------------------------------------------
// Playback and completion (scenarios 10, 11)
// ---------------------------------------------------------------------------

test('10. resume position: saved per account and lesson, resumed only where it makes sense, cleared on finish', () => {
  const pb = loadModule('lib/playback-position.ts');
  const store = new Map();
  const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  const a = pb.playbackKey('user-a', 'lesson-1');
  const b = pb.playbackKey('user-b', 'lesson-1');
  assert.notEqual(a, b, 'another account on the same browser has its own position');
  assert.equal(pb.playbackKey('', 'lesson-1'), null);
  pb.writePosition(storage, a, 125.7, 1000);
  assert.equal(pb.readPosition(storage, a, 2000), 125);
  assert.equal(pb.readPosition(storage, b, 2000), null);
  assert.equal(pb.resumePosition(125, 600), 125);
  assert.equal(pb.resumePosition(125, NaN), 125, 'unknown duration still resumes');
  assert.equal(pb.resumePosition(3, 600), null, 'too close to the start');
  assert.equal(pb.resumePosition(595, 600), null, 'near the end starts again');
  assert.equal(pb.resumePosition(null, 600), null);
  assert.equal(pb.readPosition(storage, a, 1000 + pb.MAX_AGE_MS + 1), null, 'stale positions are ignored');
  storage.setItem(a, '{not json');
  assert.equal(pb.readPosition(storage, a), null, 'malformed storage is ignored');
  storage.setItem(a, JSON.stringify({ t: -5, at: Date.now() }));
  assert.equal(pb.readPosition(storage, a), null);
  pb.clearPosition(storage, a);
  assert.equal(store.has(a), false);
  const throwing = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('full'); }, removeItem: () => { throw new Error('x'); } };
  assert.doesNotThrow(() => pb.writePosition(throwing, a, 10));
  assert.equal(pb.readPosition(throwing, a), null);
  assert.doesNotThrow(() => pb.clearPosition(throwing, a));
});

test('11. playback never completes a lesson: the player and page send no progress; completion is explicit and gated', async () => {
  const player = read('components/VideoPlayer.tsx');
  for (const forbidden of ['/progress', 'updateProgress', 'progressUpdate', 'apiClient']) assert.equal(player.includes(forbidden), false, `VideoPlayer: ${forbidden}`);
  const page = read('pages/courses/[id]/lessons/[lessonId].tsx');
  assert.equal(page.includes('updateProgress'), false, 'the lesson page does not complete on video end');
  assert.equal(page.includes("'progressUpdate'"), false);
  assert.match(page, /const handleVideoEnd = useCallback\(\(\) => setVideoFinished\(true\), \[\]\);/);
  const completion = read('components/student/LessonCompletion.tsx');
  assert.match(completion, /apiClient\.post<[^>]+>\('\/progress', \{ courseId, lessonId \}\)/);
  assert.match(completion, /if \(inFlight\.current \|\| completed\) return;/, 'one request at a time');
  assert.match(completion, /finally \{\s*inFlight\.current = false;\s*setSubmitting\(false\);/, 'never left disabled');

  await withEnv(ROUTE_ENV, async () => {
    const { db, w, r, T } = world();
    const row = () => db.rows('progress').find((p) => p.userId === w.student && p.courseId === w.P);
    // Opening a lesson (the player loading it) records nothing.
    await call(r.lesson, { token: T.student, query: { id: w.lesson.preview } });
    assert.deepEqual(row().completedLessons, []);
    const ok = await call(r.progress, { method: 'POST', token: T.student, body: { courseId: w.P, lessonId: w.lesson.preview } });
    assert.equal(ok.statusCode, 200);
    assert.deepEqual(row().completedLessons, [w.lesson.preview]);
    // A double click: the second request changes nothing.
    const again = await call(r.progress, { method: 'POST', token: T.student, body: { courseId: w.P, lessonId: w.lesson.preview } });
    assert.equal(again.statusCode, 200);
    assert.deepEqual(row().completedLessons, [w.lesson.preview]);
    const locked = await call(r.progress, { method: 'POST', token: T.student, body: { courseId: w.P, lessonId: w.lesson.paid } });
    assert.deepEqual([locked.statusCode, locked.body.code], [403, 'lesson_locked']);
    assert.deepEqual(row().completedLessons, [w.lesson.preview]);
    // The lesson read reports the completion back.
    assert.equal((await call(r.lesson, { token: T.student, query: { id: w.lesson.preview } })).body.completed, true);
  });
});

test('socket progressUpdate applies the same Phase 6 paywall as POST /api/progress (Phase 7 audit fix)', async () => {
  const source = read('server.js');
  const start = source.indexOf("socket.on('progressUpdate'");
  const end = source.indexOf("socket.on('lessonUpdated'");
  const handler = source.slice(start, end);
  const gate = handler.indexOf('courseContentAccess(db, account.user, decision.courseId)');
  assert.ok(gate > 0, 'the socket handler checks content access');
  assert.ok(gate < handler.indexOf('recordLessonCompletion(db'), 'before recording');
  assert.match(handler, /\.isOpen\(decision\.lessonId\)\) return;/);
  // The shared rule the handler calls: an enrolled, non-paying student may not complete a paid lesson.
  await withEnv(ROUTE_ENV, async () => {
    const { db, w } = world();
    const access = await courseContentAccess(db, { userId: w.student, role: 'student' }, w.P);
    assert.deepEqual([access.isOpen(w.lesson.preview), access.isOpen(w.lesson.paid), access.isOpen(w.lesson.intro)], [true, false, false]);
  });
});

// ---------------------------------------------------------------------------
// Errors, retry and route transitions (scenarios 6, 7, 14)
// ---------------------------------------------------------------------------

test('6, 7. every lesson answer maps to an actionable state; network failures are retryable', () => {
  const lr = loadModule('lib/lesson-request.ts');
  const kind = (answer) => lr.classifyLessonAnswer(answer).kind;
  assert.equal(kind({ ok: true, status: 200, data: { _id: 'x' } }), 'ok');
  assert.equal(kind({ ok: false, status: 403, data: { access: false, locked: true, message: 'Lesson locked. Please pay to unlock.' } }), 'locked');
  assert.equal(kind({ ok: false, status: 403, data: { error: 'Unable to access lesson' } }), 'forbidden');
  assert.equal(kind({ ok: false, status: 404, data: { error: 'Lesson not found' } }), 'not_found');
  assert.equal(kind({ ok: false, status: 400, data: { error: 'Invalid lesson ID' } }), 'not_found');
  assert.equal(kind({ ok: false, status: 401, data: {} }), 'redirecting');
  for (const status of [500, 502, 503, 429]) assert.equal(kind({ ok: false, status, data: {} }), 'error', String(status));
  assert.deepEqual(lr.classifyLessonFailure(false), { kind: 'error', message: lr.LESSON_OFFLINE_MESSAGE, offline: true });
  assert.equal(lr.classifyLessonFailure(true).offline, false);
  const seq = lr.createRequestSequence();
  const first = seq.next();
  const second = seq.next();
  assert.deepEqual([seq.isCurrent(first), seq.isCurrent(second)], [false, true]);
  // The page offers retry for errors and retries automatically when the browser is back online.
  const hook = read('hooks/useLesson.ts');
  assert.match(hook, /window\.addEventListener\('online', retry\)/);
  const page = read('pages/courses/[id]/lessons/[lessonId].tsx');
  assert.match(page, /lessonStatus === 'error'[\s\S]*?onClick=\{\(\) => void refetchLesson\(\)\}[\s\S]*?Try again/);
});

test('14. route transitions keep the lesson context: canonical course URL, no stale lesson, outline kept', () => {
  const page = read('pages/courses/[id]/lessons/[lessonId].tsx');
  assert.match(page, /if \(ownCourseId && courseId && lessonId && ownCourseId !== courseId\) \{\s*void router\.replace\(lessonHref\(ownCourseId, lessonId\)\);/);
  const hook = read('hooks/useLesson.ts');
  assert.match(hook, /const current = typeof lessonId === 'string' && stateFor === lessonId;/);
  assert.match(hook, /lesson: current \? lesson : null/);
  // The outline is not refetched when only the lesson changes.
  assert.match(page, /useLessons\(courseId \|\| undefined, canFetch\)/);
  // The instructor's save refreshes in place instead of reloading the route.
  assert.equal(page.includes('router.replace(router.asPath)'), false);
  assert.match(page, /refetchLesson\(\{ silent: true \}\)/);
});

// ---------------------------------------------------------------------------
// Public endpoints and caching (scenario 15)
// ---------------------------------------------------------------------------

test('15. lesson, outline, course and document responses are private and never stored; public course list carries no lesson content', async () => {
  await withEnv(ROUTE_ENV, async () => {
    const { w, r, T } = world();
    const responses = {
      'lesson 200': await call(r.lesson, { token: T.payer, query: { id: w.lesson.paid } }),
      'lesson 403': await call(r.lesson, { token: T.student, query: { id: w.lesson.paid } }),
      'outline': await call(r.outline, { token: T.payer, query: { id: w.P, view: 'outline' } }),
      'full list': await call(r.outline, { token: T.payer, query: { id: w.P } }),
      'course': await call(r.course, { token: T.payer, query: { id: w.P } }),
      'document': await call(r.document, { token: T.payer, query: { id: w.lesson.paid, item: 'pdf' } }),
      'document 403': await call(r.document, { token: T.student, query: { id: w.lesson.paid, item: 'pdf' } }),
    };
    for (const [label, res] of Object.entries(responses)) {
      assert.equal(res.headers['cache-control'], 'private, no-store, max-age=0', label);
      assert.equal(res.headers.vary, 'Cookie', label);
    }
    // The unauthenticated catalogue.
    const db2 = newDb();
    const w2 = seedWorld(db2);
    const list = route('pages/api/courses/index.ts', db2);
    const res = await call(list, { headers: { host: 'localhost:3000' } });
    assert.equal(res.statusCode, 200);
    assert.ok(Array.isArray(res.body) && res.body.length >= 1);
    assertNoContent(res.body, 'public course list');
    assert.equal(JSON.stringify(res.body).includes(w2.lesson.paid), false, 'no lesson ids in the public list');
  });
  // Middleware: no /api path skips the no-store headers, whatever it ends in.
  const middleware = read('middleware.ts');
  assert.match(middleware, /\(!pathname\.startsWith\('\/api\/'\) && STATIC_EXT\.test\(pathname\)\)/);
  assert.match(middleware, /'private, no-cache, no-store, must-revalidate'/);
  // The service worker sends every /api request to the network and never caches it.
  const sw = read('src/service-worker.js');
  assert.match(sw, /if \(url\.pathname\.startsWith\('\/api\/'\)\) \{\s*event\.respondWith\(fetch\(request\)\);\s*return;/);
});
