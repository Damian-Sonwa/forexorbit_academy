/**
 * Course builder against a real MongoDB, through the API route handlers (sessions, CSRF headers,
 * ownership, lifecycle and rate limits all real). Runs when MONGODB_URI_TEST is set.
 *
 * Covers the lifecycle from an empty draft to a student reading the published lesson, and direct
 * API attempts by members who must be refused.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ObjectId } = require('mongodb');

const { openTestDatabase, testDatabaseConfig } = require('../helpers/mongo-test-db');
const { loadModule, mockResponse } = require('../helpers/ts-loader');
const { requestHeaders, seedSession } = require('../helpers/session-cookie');

const config = testDatabaseConfig();
const skip = config.ok ? false : config.reason;
const newId = () => new ObjectId().toHexString();
const ASSET_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fo-course-assets-'));
const ROUTE_ENV = { NODE_ENV: 'test', COURSE_ASSETS_LOCAL_DIR: ASSET_DIR, PAYSTACK_SECRET_KEY: undefined, APP_ORIGIN: undefined, PORT: undefined, SHARED_RATE_LIMIT: undefined, JWT_SECRET: 'test-only-secret-for-local-asset-links' };

async function withRouteEnv(fn) {
  const saved = {};
  for (const [key, value] of Object.entries(ROUTE_ENV)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try { return await fn(); } finally {
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
}

async function call(handler, { method = 'GET', token, body, query = {} }) {
  const res = mockResponse();
  res.end = function end() { this.ended = true; return this; };
  await handler({ method, url: '/api/test', headers: requestHeaders(token), body, query, socket: { remoteAddress: '10.0.0.9' } }, res);
  return res;
}

async function user(db, role) {
  const id = newId();
  await db.collection('users').insertOne({ _id: new ObjectId(id), email: `${role}${id}@example.test`, name: `${role} ${id.slice(-4)}`, role, status: 'approved', sessionGeneration: 0 });
  const rows = [];
  const token = seedSession(rows, { userId: id, generation: 0, now: new Date() });
  await db.collection('sessions').insertMany(rows);
  return { id, token };
}

/** A temporary file for the upload stub (the route removes it afterwards). */
function tempFile(name, bytes) {
  const file = path.join(os.tmpdir(), `fo-upload-${Date.now()}-${Math.random().toString(16).slice(2)}-${name}`);
  fs.writeFileSync(file, bytes);
  return { filepath: file, originalFilename: name, size: bytes.length };
}

function routes(db, uploadQueue) {
  const stubs = {
    'lib/mongodb': { getDb: async () => db, getClient: async () => null },
    'lib/notifications': { createNotification: async () => 'n' },
    'lib/socket-server': { getSocketServer: () => null },
    formidable: () => ({ parse: async () => { const f = uploadQueue.shift(); return [{}, f ? { file: [f] } : {}]; } }),
  };
  const load = (p) => loadModule(p, stubs).default;
  return {
    courses: load('pages/api/courses/index.ts'),
    course: load('pages/api/courses/[id].ts'),
    builder: load('pages/api/courses/[id]/builder.ts'),
    curriculum: load('pages/api/courses/[id]/curriculum.ts'),
    assets: load('pages/api/courses/[id]/assets.ts'),
    assetFile: load('pages/api/courses/[id]/asset-file.ts'),
    status: load('pages/api/courses/[id]/status.ts'),
    lessons: load('pages/api/lessons/index.ts'),
    lesson: load('pages/api/lessons/[id].ts'),
    document: load('pages/api/lessons/[id]/document.ts'),
  };
}

const text = (s) => ({ id: Math.random().toString(36).slice(2, 10).padEnd(8, 'x'), type: 'text', ops: [{ insert: `${s}\n` }] });

test('real MongoDB: build a course, preview data, publish, and a student receives the same structure', { skip }, async () => {
  const conn = await openTestDatabase();
  await conn.reset();
  const db = conn.db;
  try {
    await withRouteEnv(async () => {
      const uploads = [];
      const r = routes(db, uploads);
      const inst = await user(db, 'instructor');
      const other = await user(db, 'instructor');
      const admin = await user(db, 'admin');
      const stu = await user(db, 'student');
      const outsider = await user(db, 'student');

      // 1. A draft from a title alone.
      const created = await call(r.courses, { method: 'POST', token: inst.token, body: { draftStart: true, title: 'Risk management' } });
      assert.equal(created.statusCode, 201, JSON.stringify(created.body));
      const courseId = created.body.id;
      const q = { id: courseId };

      // 2. The builder view: one implicit module, nothing ready yet.
      let b = await call(r.builder, { token: inst.token, query: q });
      assert.equal(b.statusCode, 200);
      assert.equal(b.body.modules.length, 1);
      assert.equal(b.body.modules[0].implicit, true);
      assert.equal(b.body.readiness.ready, false);
      assert.equal(b.body.permissions.editContent, true);
      assert.equal(b.body.permissions.delete, false);

      // 3. Two modules, then lessons created into them.
      let cur = await call(r.curriculum, { method: 'PUT', token: inst.token, query: q, body: { version: b.body.curriculumVersion, modules: [{ id: 'modbasics1', title: 'Basics', lessonIds: [] }, { id: 'modsizing1', title: 'Position sizing', lessonIds: [] }] } });
      assert.equal(cur.statusCode, 200, JSON.stringify(cur.body));
      const mk = async (title, moduleId, blocks) => {
        const res = await call(r.lessons, { method: 'POST', token: inst.token, body: { courseId, title, moduleId, blocks } });
        assert.equal(res.statusCode, 201, JSON.stringify(res.body));
        return res.body.id;
      };
      const l1 = await mk('Why risk matters', 'modbasics1', [text('Protect capital first.')]);
      const l3 = await mk('Fixed fractional sizing', 'modsizing1', [text('Risk 1% per trade.')]);
      const l2 = await mk('Stop placement', 'modbasics1', [text('Stops go beyond structure.')]);
      // Lessons take their place inside their module; `order` follows the curriculum.
      const orders = async () => Object.fromEntries((await db.collection('lessons').find({ courseId }).toArray()).map((l) => [String(l._id), l.order]));
      assert.deepEqual(await orders(), { [l1]: 1, [l2]: 2, [l3]: 3 });

      // 4. Reorder: move "Stop placement" into the sizing module, first.
      b = await call(r.builder, { token: inst.token, query: q });
      cur = await call(r.curriculum, { method: 'PUT', token: inst.token, query: q, body: { version: b.body.curriculumVersion, modules: [{ id: 'modbasics1', title: 'Basics', lessonIds: [l1] }, { id: 'modsizing1', title: 'Position sizing', lessonIds: [l2, l3] }] } });
      assert.equal(cur.statusCode, 200);
      assert.deepEqual(await orders(), { [l1]: 1, [l2]: 2, [l3]: 3 });
      assert.equal((await db.collection('lessons').findOne({ _id: new ObjectId(l2) })).moduleId, 'modsizing1');
      // A save based on the old version is refused (another editor changed the curriculum).
      const stale = await call(r.curriculum, { method: 'PUT', token: inst.token, query: q, body: { version: b.body.curriculumVersion, modules: [{ id: 'modbasics1', title: 'Basics', lessonIds: [l1, l2, l3] }] } });
      assert.equal(stale.statusCode, 409);
      assert.equal(stale.body.code, 'curriculum_changed');

      // 5. Upload a PDF (checked by content) and a disguised file (refused).
      uploads.push(tempFile('evil.pdf', Buffer.from('MZ program')));
      const bad = await call(r.assets, { method: 'POST', token: inst.token, query: q });
      assert.equal(bad.statusCode, 415);
      assert.equal(bad.body.code, 'content_mismatch');
      uploads.push(tempFile('Trading plan.pdf', Buffer.from('%PDF-1.7\nhello pdf\n%%EOF')));
      const up = await call(r.assets, { method: 'POST', token: inst.token, query: q });
      assert.equal(up.statusCode, 201, JSON.stringify(up.body));
      const assetId = up.body.asset.id;
      assert.equal(up.body.asset.publicId, undefined, 'storage references stay on the server');
      // Another instructor cannot upload to this course.
      uploads.push(tempFile('x.pdf', Buffer.from('%PDF-1.7\n')));
      const foreign = await call(r.assets, { method: 'POST', token: other.token, query: q });
      assert.equal(foreign.statusCode, 404);
      uploads.length = 0;

      // 6. Save lesson content with the file; stale revisions are refused.
      let lb = (await call(r.builder, { token: inst.token, query: q })).body.lessons.find((l) => l.id === l3);
      const blocks = [
        { id: 'head0001', type: 'heading', text: 'The 1% rule', level: 2 },
        text('Risk a fixed fraction.'),
        { id: 'file0001', type: 'file', assetId, title: 'Trading plan', name: 'Trading plan.pdf' },
        { id: 'link0001', type: 'link', url: 'https://www.babypips.com', title: 'BabyPips', description: '' },
      ];
      const saved = await call(r.lesson, { method: 'PUT', token: inst.token, query: { id: l3 }, body: { title: 'Fixed fractional sizing', blocks, isFreePreview: true, baseRevision: lb.revision } });
      assert.equal(saved.statusCode, 200, JSON.stringify(saved.body));
      assert.equal(saved.body.revision, lb.revision + 1);
      const conflict = await call(r.lesson, { method: 'PUT', token: inst.token, query: { id: l3 }, body: { blocks: [], baseRevision: lb.revision } });
      assert.equal(conflict.statusCode, 409);
      assert.equal(conflict.body.code, 'stale_revision');
      assert.equal((await db.collection('lessons').findOne({ _id: new ObjectId(l3) })).blocks.length, 4, 'the newer content was not overwritten');
      // A file from outside the course is refused.
      const forged = await call(r.lesson, { method: 'PUT', token: inst.token, query: { id: l3 }, body: { blocks: [{ id: 'file0002', type: 'file', assetId: 'ffffffffffffffffffffffff', title: 'x' }], baseRevision: saved.body.revision } });
      assert.equal(forged.statusCode, 400);
      // The file is in use: it cannot be removed.
      const inUse = await call(r.assets, { method: 'DELETE', token: inst.token, query: { id: courseId, assetId } });
      assert.equal(inUse.statusCode, 409);

      // 7. Readiness: review is refused until the details exist.
      const early = await call(r.status, { method: 'POST', token: inst.token, query: q, body: { status: 'in_review' } });
      assert.equal(early.statusCode, 409);
      assert.equal(early.body.code, 'course_not_ready');
      assert.ok(early.body.issues.some((i) => i.field === 'description'));
      const details = await call(r.course, { method: 'PUT', token: inst.token, query: q, body: { description: '<p>Learn to size positions.</p>', category: 'risk', difficulty: 'beginner', summary: 'Size every trade from a fixed risk.', objectives: ['Size a position'] } });
      assert.equal(details.statusCode, 200, JSON.stringify(details.body));
      // Course details are protected from stale overwrites too.
      const staleDetails = await call(r.course, { method: 'PUT', token: inst.token, query: q, body: { summary: 'old tab', baseUpdatedAt: new Date(0).toISOString() } });
      assert.equal(staleDetails.statusCode, 409);
      assert.equal(staleDetails.body.code, 'stale_course');

      // 8. Review, then the instructor can no longer edit; an admin publishes.
      const review = await call(r.status, { method: 'POST', token: inst.token, query: q, body: { status: 'in_review' } });
      assert.equal(review.statusCode, 200, JSON.stringify(review.body));
      const locked = await call(r.lesson, { method: 'PUT', token: inst.token, query: { id: l1 }, body: { title: 'changed' } });
      assert.equal(locked.statusCode, 409);
      const instPublish = await call(r.status, { method: 'POST', token: inst.token, query: q, body: { status: 'published' } });
      assert.equal(instPublish.statusCode, 403, 'instructors cannot publish');
      // Students cannot see a course in review.
      assert.equal((await call(r.course, { token: stu.token, query: { ...q, lessons: 'none' } })).statusCode, 404);
      const publish = await call(r.status, { method: 'POST', token: admin.token, query: q, body: { status: 'published' } });
      assert.equal(publish.statusCode, 200);

      // 9. An enrolled student gets the same modules, order and blocks; files only through the gate.
      await db.collection('progress').insertOne({ userId: stu.id, courseId, progress: 0, completedLessons: [l1], active: true });
      const courseView = await call(r.course, { token: stu.token, query: { ...q, lessons: 'none' } });
      assert.deepEqual(courseView.body.modules, [{ id: 'modbasics1', title: 'Basics' }, { id: 'modsizing1', title: 'Position sizing' }]);
      assert.deepEqual(courseView.body.objectives, ['Size a position']);
      assert.equal(courseView.body.assets, undefined);
      const outline = await call(r.lessons, { token: stu.token, query: { courseId, outline: '1' } });
      assert.deepEqual(outline.body.map((l) => [String(l._id), l.moduleId]), [[l1, 'modbasics1'], [l2, 'modsizing1'], [l3, 'modsizing1']]);
      assert.ok(outline.body.every((l) => l.blocks === undefined), 'the outline carries no content');
      const read = await call(r.lesson, { token: stu.token, query: { id: l3 } });
      assert.equal(read.statusCode, 200, JSON.stringify(read.body));
      assert.deepEqual(read.body.blocks.map((x) => x.type), ['heading', 'text', 'file', 'link']);
      const file = read.body.blocks[2];
      assert.equal(file.assetId, undefined);
      assert.equal(file.url, `/api/lessons/${l3}/document?item=b-file0001`);
      const doc = await call(r.document, { token: stu.token, query: { id: l3, item: 'b-file0001' } });
      assert.equal(doc.statusCode, 302);
      const location = new URL(doc.headers.location, 'http://local');
      assert.equal(location.pathname, `/api/courses/${courseId}/asset-file`);
      const served = mockResponse();
      let streamed = '';
      served.write = (c) => { streamed += c; return true; };
      await new Promise((resolve) => {
        served.end = (c) => { if (c) streamed += c; resolve(); };
        served.on = () => served; served.once = () => served; served.emit = () => true;
        r.assetFile({ method: 'GET', query: { id: courseId, ...Object.fromEntries(location.searchParams) } }, served).then(() => { if (served.statusCode === 404) resolve(); });
      });
      assert.equal(served.statusCode, 200);
      assert.match(streamed, /%PDF-1\.7/);
      // A tampered link is refused.
      const tampered = mockResponse(); tampered.end = () => tampered;
      await r.assetFile({ method: 'GET', query: { id: courseId, a: assetId, e: location.searchParams.get('e'), t: '0'.repeat(32) } }, tampered);
      assert.equal(tampered.statusCode, 404);

      // 10. A student who is not enrolled gets neither the lesson nor its file.
      assert.equal((await call(r.lesson, { token: outsider.token, query: { id: l2 } })).statusCode, 403);
      assert.equal((await call(r.document, { token: outsider.token, query: { id: l2, item: 'b-file0001' } })).statusCode, 403);

      // 11. Direct API attempts by members who do not own the course.
      assert.equal((await call(r.builder, { token: other.token, query: q })).statusCode, 404);
      assert.equal((await call(r.builder, { token: stu.token, query: q })).statusCode, 403);
      assert.equal((await call(r.curriculum, { method: 'PUT', token: other.token, query: q, body: { version: null, modules: [] } })).statusCode, 404);
      assert.equal((await call(r.lesson, { method: 'PUT', token: other.token, query: { id: l1 }, body: { title: 'hijack' } })).statusCode, 403);
      assert.equal((await call(r.assets, { method: 'GET', token: stu.token, query: { id: courseId, assetId } })).statusCode, 403);
      assert.equal((await call(r.course, { method: 'DELETE', token: admin.token, query: q })).statusCode, 403, 'only the Super Admin deletes');

      // 12. An admin restructures the live course; the student's progress and completions stay.
      const before = await db.collection('progress').findOne({ userId: stu.id, courseId });
      b = await call(r.builder, { token: admin.token, query: q });
      assert.equal(b.body.permissions.editContent, true);
      cur = await call(r.curriculum, { method: 'PUT', token: admin.token, query: q, body: { version: b.body.curriculumVersion, modules: [{ id: 'modsizing1', title: 'Position sizing', lessonIds: [l3, l2] }, { id: 'modbasics1', title: 'Basics', lessonIds: [l1] }] } });
      assert.equal(cur.statusCode, 200);
      const after = await db.collection('progress').findOne({ userId: stu.id, courseId });
      assert.deepEqual(after.completedLessons, before.completedLessons);
      assert.deepEqual(await orders(), { [l3]: 1, [l2]: 2, [l1]: 3 });
    });
  } finally {
    await conn.reset();
    await conn.close();
    fs.rmSync(ASSET_DIR, { recursive: true, force: true });
  }
});
