/**
 * Course images and files on Cloudflare R2, through the real upload and download routes, with an
 * S3-compatible test double (scripts/acceptance/fake-r2.js) that verifies every signature. No
 * Cloudinary settings are present, so this also proves uploads work without Cloudinary.
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
const { startFakeR2 } = require('../../scripts/acceptance/fake-r2');

const config = testDatabaseConfig();
const skip = config.ok ? false : config.reason;
const newId = () => new ObjectId().toHexString();

async function withEnv(env, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(env)) { saved[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { return await fn(); } finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}
async function call(handler, { method = 'GET', token, body, query = {} }) {
  const res = mockResponse();
  await handler({ method, url: '/api/test', headers: requestHeaders(token), body, query, socket: { remoteAddress: '10.0.0.6' } }, res);
  return res;
}
async function user(db, role) {
  const id = newId();
  await db.collection('users').insertOne({ _id: new ObjectId(id), email: `${role}${id}@example.test`, name: role, role, status: 'approved', sessionGeneration: 0 });
  const rows = [];
  const token = seedSession(rows, { userId: id, generation: 0, now: new Date() });
  await db.collection('sessions').insertMany(rows);
  return { id, token };
}
function temp(name, bytes, mimetype) {
  const filepath = path.join(os.tmpdir(), `fo-r2-up-${Date.now()}-${Math.random().toString(16).slice(2)}-${name}`);
  fs.writeFileSync(filepath, bytes);
  return { filepath, originalFilename: name, size: bytes.length, mimetype };
}

test('real MongoDB: images and course files upload to R2 without Cloudinary and download only through the gate', { skip }, async () => {
  const r2 = await startFakeR2();
  const conn = await openTestDatabase();
  await conn.reset();
  const db = conn.db;
  try {
    await withEnv({ NODE_ENV: 'test', ...r2.env, CLOUDINARY_CLOUD_NAME: undefined, CLOUDINARY_API_KEY: undefined, CLOUDINARY_API_SECRET: undefined, COURSE_ASSETS_LOCAL_DIR: undefined, SHARED_RATE_LIMIT: undefined, PAYSTACK_SECRET_KEY: undefined }, async () => {
      const queue = [];
      const stubs = {
        'lib/mongodb': { getDb: async () => db, getClient: async () => null },
        formidable: () => ({ parse: async () => { const f = queue.shift(); return [{}, f ? { [f.field]: [f.file] } : {}]; } }),
      };
      const imageRoute = loadModule('pages/api/upload/instructor.ts', stubs).default;
      const assets = loadModule('pages/api/courses/[id]/assets.ts', stubs).default;
      const lessonRoute = loadModule('pages/api/lessons/[id].ts', stubs).default;
      const document = loadModule('pages/api/lessons/[id]/document.ts', stubs).default;
      const inst = await user(db, 'instructor');
      const stu = await user(db, 'student');
      const outsider = await user(db, 'student');
      const courseId = newId();
      const lessonId = newId();
      await db.collection('courses').insertOne({ _id: new ObjectId(courseId), title: 'R2 course', status: 'draft', instructorId: inst.id, freePreviewExplicit: true });
      await db.collection('lessons').insertOne({ _id: new ObjectId(lessonId), courseId, title: 'Lesson', order: 1, revision: 0, isFreePreview: true });

      // 1. A real PNG goes to the public bucket with the type read from its bytes.
      const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
      queue.push({ field: 'image', file: temp('chart.png', png, 'image/png') });
      const img = await call(imageRoute, { method: 'POST', token: inst.token });
      assert.equal(img.statusCode, 200, JSON.stringify(img.body));
      assert.equal(img.body.storage, 'r2');
      assert.match(img.body.url, new RegExp(`^${r2.base}/public/course-images/instructors/[a-f0-9]{32}\\.png$`));
      const key = img.body.url.replace(`${r2.base}/public/`, '');
      assert.equal(r2.objects.get(key).type, 'image/png');
      assert.match(r2.objects.get(key).cache, /immutable/);
      assert.equal((await fetch(img.body.url)).status, 200, 'publicly readable image');
      // 2. An HTML page renamed and labelled as a PNG is refused and never stored.
      const before = r2.objects.size;
      queue.push({ field: 'image', file: temp('evil.png', Buffer.from('<html><script>alert(1)</script></html>'), 'image/png') });
      const evil = await call(imageRoute, { method: 'POST', token: inst.token });
      assert.equal(evil.statusCode, 400);
      assert.equal(r2.objects.size, before);

      // 3. A course file goes to the private bucket.
      queue.push({ field: 'file', file: temp('Trading plan.pdf', Buffer.from('%PDF-1.7\nprivate plan\n%%EOF'), 'application/pdf') });
      const up = await call(assets, { method: 'POST', token: inst.token, query: { id: courseId } });
      assert.equal(up.statusCode, 201, JSON.stringify(up.body));
      const stored = (await db.collection('courses').findOne({ _id: new ObjectId(courseId) })).assets[0];
      assert.equal(stored.driver, 'r2');
      assert.match(stored.publicId, /^course-files\/[a-f0-9]{32}\.pdf$/);
      assert.ok(r2.objects.has(stored.publicId));
      assert.equal(String(stored.publicId).startsWith('course-images/'), false, 'never in the public bucket path');

      // Use it in the lesson and publish the course.
      const saved = await call(lessonRoute, { method: 'PUT', token: inst.token, query: { id: lessonId }, body: { blocks: [{ id: 'file0001', type: 'file', assetId: up.body.asset.id, title: 'Trading plan', name: 'Trading plan.pdf' }, { id: 'imag0001', type: 'image', url: img.body.url, alt: 'Chart' }, { id: 'imag0002', type: 'image', url: 'https://images.example.com/linked.png', alt: 'Linked image' }], baseRevision: 0 } });
      assert.equal(saved.statusCode, 200, JSON.stringify(saved.body));
      await db.collection('courses').updateOne({ _id: new ObjectId(courseId) }, { $set: { status: 'published' } });
      await db.collection('progress').insertOne({ userId: stu.id, courseId, completedLessons: [], progress: 0, active: true });

      // 4. The enrolled student downloads through the gate: a short-lived presigned R2 link.
      const doc = await call(document, { token: stu.token, query: { id: lessonId, item: 'b-file0001' } });
      assert.equal(doc.statusCode, 302, JSON.stringify(doc.body));
      assert.ok(doc.headers.location.startsWith(`${r2.base}/files/course-files/`));
      assert.match(doc.headers.location, /X-Amz-Expires=300/);
      const dl = await fetch(doc.headers.location);
      assert.equal(dl.status, 200);
      assert.match(await dl.text(), /private plan/);
      assert.match(dl.headers.get('content-disposition'), /inline; filename="Trading plan\.pdf"/);
      // The private object cannot be read without a valid signature.
      assert.equal((await fetch(`${r2.base}/files/${stored.publicId}`)).status, 403);
      assert.equal((await fetch(`${r2.base}/public/${stored.publicId}`)).status, 404, 'not in the public bucket');
      // 5. A student who is not enrolled gets no link.
      assert.equal((await call(document, { token: outsider.token, query: { id: lessonId, item: 'b-file0001' } })).statusCode, 403);
      // The student sees the linked image address as stored (link field).
      const read = await call(lessonRoute, { token: stu.token, query: { id: lessonId } });
      assert.deepEqual(read.body.blocks.filter((b) => b.type === 'image').map((b) => b.url), [img.body.url, 'https://images.example.com/linked.png']);

      // 6. Removing an unused file deletes it from R2.
      queue.push({ field: 'file', file: temp('old.csv', Buffer.from('a,b\n1,2\n'), 'text/csv') });
      await db.collection('courses').updateOne({ _id: new ObjectId(courseId) }, { $set: { status: 'draft' } });
      const extra = await call(assets, { method: 'POST', token: inst.token, query: { id: courseId } });
      assert.equal(extra.statusCode, 201);
      const extraKey = (await db.collection('courses').findOne({ _id: new ObjectId(courseId) })).assets[1].publicId;
      const removed = await call(assets, { method: 'DELETE', token: inst.token, query: { id: courseId, assetId: extra.body.asset.id } });
      assert.equal(removed.statusCode, 200);
      assert.equal(r2.objects.has(extraKey), false);
    });

    // 7. With neither R2 nor Cloudinary, image upload says so and points to the link option.
    await withEnv({ NODE_ENV: 'test', R2_ENDPOINT: undefined, R2_ACCESS_KEY_ID: undefined, R2_SECRET_ACCESS_KEY: undefined, R2_IMAGES_BUCKET: undefined, R2_PUBLIC_BASE_URL: undefined, R2_FILES_BUCKET: undefined, CLOUDINARY_CLOUD_NAME: undefined, CLOUDINARY_API_KEY: undefined, CLOUDINARY_API_SECRET: undefined, SHARED_RATE_LIMIT: undefined }, async () => {
      const queue = [];
      const stubs = { 'lib/mongodb': { getDb: async () => db, getClient: async () => null }, formidable: () => ({ parse: async () => [{}, { image: [queue.shift()] }] }) };
      const imageRoute = loadModule('pages/api/upload/instructor.ts', stubs).default;
      const inst = await user(db, 'instructor');
      queue.push(temp('a.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image/png'));
      const none = await call(imageRoute, { method: 'POST', token: inst.token });
      assert.equal(none.statusCode, 503);
      assert.match(none.body.error, /Paste a link to the image instead/);
    });
  } finally {
    await conn.reset();
    await conn.close();
    await r2.close();
  }
});
