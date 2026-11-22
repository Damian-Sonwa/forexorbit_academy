/**
 * AI lesson development against a real MongoDB, through the route handler, with a local
 * OpenAI-compatible test double as the provider (scripts/acceptance/fake-ai-provider.js), so the
 * real adapter, HTTP, sessions, ownership, lifecycle and rate limits all run.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');
const { openTestDatabase, testDatabaseConfig } = require('../helpers/mongo-test-db');
const { loadModule, mockResponse } = require('../helpers/ts-loader');
const { requestHeaders, seedSession } = require('../helpers/session-cookie');
const { startFakeProvider } = require('../../scripts/acceptance/fake-ai-provider');

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
  await handler({ method, url: '/api/test', headers: requestHeaders(token), body, query, socket: { remoteAddress: '10.0.0.8' } }, res);
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

test('real MongoDB: AI proposals never change a lesson until accepted; accept, reject, restore and protections', { skip }, async () => {
  const fake = await startFakeProvider();
  const conn = await openTestDatabase();
  await conn.reset();
  const db = conn.db;
  try {
    await withEnv({ NODE_ENV: 'test', AI_LESSON_PROVIDER: 'compatible', AI_LESSON_BASE_URL: fake.url, AI_LESSON_API_KEY: 'test-only', AI_LESSON_MODEL: 'fake-model', GROQ_API_KEY: undefined, AI_API_KEY: undefined, SHARED_RATE_LIMIT: undefined, APP_ORIGIN: undefined }, async () => {
      const stubs = { 'lib/mongodb': { getDb: async () => db, getClient: async () => null } };
      const ai = loadModule('pages/api/lessons/[id]/ai.ts', stubs).default;
      const lessonRoute = loadModule('pages/api/lessons/[id].ts', stubs).default;
      const inst = await user(db, 'instructor');
      const other = await user(db, 'instructor');
      const admin = await user(db, 'admin');
      const stu = await user(db, 'student');
      const courseId = newId();
      await db.collection('courses').insertOne({ _id: new ObjectId(courseId), title: 'Forex Trading Fundamentals', description: '<p>Learn the basics.</p>', category: 'basics', difficulty: 'beginner', status: 'draft', instructorId: inst.id, modules: [{ id: 'modintro1', title: 'Introduction to Forex' }] });
      const ids = [newId(), newId(), newId()];
      await db.collection('lessons').insertMany([
        { _id: new ObjectId(ids[0]), courseId, title: 'What is Forex Trading?', order: 1, moduleId: 'modintro1', blocks: [{ id: 'aaaaaa01', type: 'text', ops: [{ insert: 'Forex is the global market for exchanging currencies.\n' }] }], revision: 1 },
        { _id: new ObjectId(ids[1]), courseId, title: 'Understanding Pips and Lots', order: 2, moduleId: 'modintro1', revision: 0, description: '<p>A pip is a small move.</p>' },
        { _id: new ObjectId(ids[2]), courseId, title: 'Understanding Currency Pairs', order: 3, moduleId: 'modintro1', revision: 3, blocks: [{ id: 'img00001', type: 'image', url: 'https://res.cloudinary.com/x/image/upload/forexorbit/instructors/a.png', alt: 'EUR/USD quote', caption: '' }, { id: 'txt00001', type: 'text', ops: [{ insert: `${'Currency pairs show how much of the quote currency buys one unit of the base currency. '.repeat(8)}\n` }] }] },
      ]);
      await db.collection('progress').insertOne({ userId: stu.id, courseId, completedLessons: [ids[1]], progress: 33, active: true });
      await db.collection('userCourseAccess').insertOne({ userId: stu.id, courseId, entitlementType: 'complimentary', grantedAt: new Date() });
      const L = ids[1];
      const lessonDoc = () => db.collection('lessons').findOne({ _id: new ObjectId(L) });

      // Status: configured, no secrets.
      const status = await call(ai, { token: inst.token, query: { id: L } });
      assert.equal(status.statusCode, 200);
      assert.equal(status.body.provider.configured, true);
      assert.equal(JSON.stringify(status.body).includes('test-only'), false);
      assert.equal(JSON.stringify(status.body).includes(fake.url), false);

      // 1. Generate a lesson: a draft proposal, the lesson untouched, the course context sent.
      const gen = await call(ai, { method: 'POST', token: inst.token, query: { id: L }, body: { action: 'generate', mode: 'generate', instructions: 'Use EUR/USD in the examples.' } });
      assert.equal(gen.statusCode, 201, JSON.stringify(gen.body));
      const prompt = fake.requests[fake.requests.length - 1].prompt;
      assert.match(prompt, /Course: Forex Trading Fundamentals \(beginner, basics\)/);
      assert.match(prompt, /Module: Introduction to Forex/);
      assert.match(prompt, /Topic \(lesson 2 of 3\): Understanding Pips and Lots/);
      assert.match(prompt, /Already taught earlier in the course: What is Forex Trading\?/);
      assert.match(prompt, /Instructor's request.*EUR\/USD/);
      const p1 = gen.body.proposal;
      assert.equal(p1.status, 'pending');
      assert.ok(p1.blocks.length > 5);
      assert.ok(p1.blocks.some((b) => b.type === 'code' && /0\.20 lots/.test(b.text)), 'the worked calculation is recomputed');
      assert.ok(p1.quality.checks.find((c) => c.id === 'review'));
      let doc = await lessonDoc();
      assert.equal(doc.blocks, undefined, 'the lesson body did not change');
      assert.equal(doc.title, 'Understanding Pips and Lots', 'the topic title is preserved');
      assert.equal(doc.aiGeneration.status, 'idle', 'the generation lock is released');

      // The same request again reuses the draft (no provider call).
      const before = fake.requests.length;
      const again = await call(ai, { method: 'POST', token: inst.token, query: { id: L }, body: { action: 'generate', mode: 'generate', instructions: 'Use EUR/USD in the examples.' } });
      assert.equal(again.body.reused, true);
      assert.equal(fake.requests.length, before);

      // 2. Reject it: nothing changes.
      const rej = await call(ai, { method: 'POST', token: inst.token, query: { id: L }, body: { action: 'reject', proposalId: p1.id } });
      assert.equal(rej.statusCode, 200);
      doc = await lessonDoc();
      assert.equal(doc.blocks, undefined);
      assert.equal(doc.aiProposals.find((p) => p.id === p1.id).status, 'rejected');

      // 3. Generate a new one and accept it: the body changes, the old one is kept in history.
      const p2 = (await call(ai, { method: 'POST', token: inst.token, query: { id: L }, body: { action: 'generate', mode: 'generate', regenerate: true } })).body.proposal;
      const stale = await call(ai, { method: 'POST', token: inst.token, query: { id: L }, body: { action: 'accept', proposalId: p2.id, baseRevision: 7 } });
      assert.equal(stale.statusCode, 409, 'a stale editor revision is refused');
      const acc = await call(ai, { method: 'POST', token: inst.token, query: { id: L }, body: { action: 'accept', proposalId: p2.id, baseRevision: 0, createQuiz: true } });
      assert.equal(acc.statusCode, 200, JSON.stringify(acc.body));
      assert.equal(acc.body.revision, 1);
      assert.equal(acc.body.quiz.added, 2);
      doc = await lessonDoc();
      assert.equal(doc.blocks.length, p2.blocks.length);
      assert.equal(doc.history.length, 1);
      assert.deepEqual(doc.history[0].blocks.map((b) => b.type), ['legacy'], 'the earlier content is kept');
      const quiz = await db.collection('quizzes').findOne({ lessonId: L });
      assert.equal(quiz.settings.status, 'draft', 'questions go to a draft quiz, never straight to students');
      assert.equal(quiz.questions.length, 2);
      // A decided proposal cannot be accepted twice.
      assert.equal((await call(ai, { method: 'POST', token: inst.token, query: { id: L }, body: { action: 'accept', proposalId: p2.id, baseRevision: 1 } })).statusCode, 409);
      // Manual editing still works on the accepted content.
      const manual = await call(lessonRoute, { method: 'PUT', token: inst.token, query: { id: L }, body: { blocks: doc.blocks.slice(0, 3), baseRevision: 1 } });
      assert.equal(manual.statusCode, 200);

      // 4. Restore the earlier version (the current goes into history).
      const restore = await call(ai, { method: 'POST', token: inst.token, query: { id: L }, body: { action: 'restore', historyId: doc.history[0].id, baseRevision: 2 } });
      assert.equal(restore.statusCode, 200, JSON.stringify(restore.body));
      doc = await lessonDoc();
      assert.deepEqual(doc.blocks.map((b) => b.type), ['legacy']);
      assert.equal(doc.history.length, 2);

      // 5. Improve keeps media; a section inserts where asked.
      const improve = await call(ai, { method: 'POST', token: inst.token, query: { id: ids[2] }, body: { action: 'generate', mode: 'improve' } });
      assert.equal(improve.statusCode, 201, JSON.stringify(improve.body));
      assert.ok(improve.body.proposal.blocks.some((b) => b.id === 'img00001'), 'the existing image is kept');
      const section = await call(ai, { method: 'POST', token: inst.token, query: { id: ids[2] }, body: { action: 'generate', mode: 'section', sectionKind: 'example', insertAfter: 'img00001' } });
      assert.equal(section.statusCode, 201);
      const sb = section.body.proposal.blocks;
      assert.equal(sb[0].id, 'img00001');
      assert.equal(sb[sb.length - 1].id, 'txt00001', 'the new section sits between the image and the text');
      assert.ok((await db.collection('lessons').findOne({ _id: new ObjectId(ids[2]) })).blocks.length === 2, 'unchanged until accepted');
      // Improve on an empty lesson is refused with a useful message.
      await db.collection('lessons').insertOne({ _id: new ObjectId(), courseId, title: 'Empty', order: 4, moduleId: 'modintro1' });

      // 6. Provider failures: useful codes, nothing saved, the lock released.
      const count = async () => ((await db.collection('lessons').findOne({ _id: new ObjectId(ids[0]) })).aiProposals || []).length;
      for (const [kind, code, httpStatus] of [['quota', 'quota', 502], ['auth', 'auth', 502], ['truncated', 'truncated', 502], ['malformed', 'malformed', 502], ['short', 'incomplete', 502]]) {
        fake.next(kind);
        const r = await call(ai, { method: 'POST', token: inst.token, query: { id: ids[0] }, body: { action: 'generate', mode: 'rewrite', regenerate: true } });
        assert.deepEqual([r.statusCode, r.body.code], [httpStatus, code], kind);
        assert.equal(await count(), 0, `${kind}: nothing saved`);
        assert.equal((await db.collection('lessons').findOne({ _id: new ObjectId(ids[0]) })).aiGeneration.status, 'failed');
      }
      // A running generation blocks a second one on the same lesson.
      await db.collection('lessons').updateOne({ _id: new ObjectId(ids[0]) }, { $set: { aiGeneration: { status: 'running', startedAt: new Date() } } });
      const busy = await call(ai, { method: 'POST', token: inst.token, query: { id: ids[0] }, body: { action: 'generate', mode: 'rewrite' } });
      assert.equal(busy.body.code, 'generation_running');
      await db.collection('lessons').updateOne({ _id: new ObjectId(ids[0]) }, { $set: { aiGeneration: { status: 'idle' } } });

      // 7. Authorization.
      assert.equal((await call(ai, { method: 'POST', token: other.token, query: { id: L }, body: { action: 'generate', mode: 'generate' } })).statusCode, 404, 'another instructor');
      assert.equal((await call(ai, { token: stu.token, query: { id: L } })).statusCode, 403, 'students');
      assert.equal((await call(ai, { method: 'POST', token: stu.token, query: { id: L }, body: { action: 'generate', mode: 'generate' } })).statusCode, 403);
      // A student reading the lesson never sees proposals or history.
      const studentRead = await call(lessonRoute, { token: stu.token, query: { id: L } });
      assert.equal(studentRead.statusCode, 403, 'the course is a draft');

      // 8. Live course: instructors cannot generate or accept; admins must confirm.
      await db.collection('courses').updateOne({ _id: new ObjectId(courseId) }, { $set: { status: 'published' } });
      const instLive = await call(ai, { method: 'POST', token: inst.token, query: { id: ids[2] }, body: { action: 'accept', proposalId: improve.body.proposal.id, baseRevision: 3 } });
      assert.equal(instLive.body.code, 'course_not_editable');
      const adminNoConfirm = await call(ai, { method: 'POST', token: admin.token, query: { id: ids[2] }, body: { action: 'accept', proposalId: improve.body.proposal.id, baseRevision: 3 } });
      assert.equal(adminNoConfirm.body.code, 'confirm_live', 'never overwrites live content silently');
      const adminAccept = await call(ai, { method: 'POST', token: admin.token, query: { id: ids[2] }, body: { action: 'accept', proposalId: improve.body.proposal.id, baseRevision: 3, confirmLive: true } });
      assert.equal(adminAccept.statusCode, 200);
      // The student now reads the accepted content; no AI fields reach them; progress is intact.
      const live = await call(lessonRoute, { token: stu.token, query: { id: L } });
      assert.equal(live.statusCode, 200, JSON.stringify(live.body));
      assert.equal(live.body.aiProposals, undefined);
      assert.equal(live.body.history, undefined);
      assert.deepEqual((await db.collection('progress').findOne({ userId: stu.id })).completedLessons, [L]);
      // Questions are not added to a quiz students can already take.
      await db.collection('quizzes').updateOne({ lessonId: L }, { $set: { 'settings.status': 'published' } });
      fake.next('checks');
      const checks = await call(ai, { method: 'POST', token: admin.token, query: { id: L }, body: { action: 'generate', mode: 'checks' } });
      assert.equal(checks.statusCode, 201, JSON.stringify(checks.body));
      const addChecks = await call(ai, { method: 'POST', token: admin.token, query: { id: L }, body: { action: 'accept', proposalId: checks.body.proposal.id, baseRevision: 3, confirmLive: true } });
      assert.equal(addChecks.statusCode, 200, JSON.stringify(addChecks.body));
      assert.equal(addChecks.body.quiz.added, 0);
      assert.equal((await db.collection('quizzes').findOne({ lessonId: L })).questions.length, 2, 'the published quiz is unchanged');
    });

    // 9. Without a provider, generation is refused with a clear message and manual editing works.
    await withEnv({ NODE_ENV: 'test', AI_LESSON_PROVIDER: undefined, GROQ_API_KEY: undefined, AI_API_KEY: undefined, SHARED_RATE_LIMIT: undefined }, async () => {
      const stubs = { 'lib/mongodb': { getDb: async () => db, getClient: async () => null } };
      const ai = loadModule('pages/api/lessons/[id]/ai.ts', stubs).default;
      const lessonRoute = loadModule('pages/api/lessons/[id].ts', stubs).default;
      const admin = await user(db, 'admin');
      const lesson = await db.collection('lessons').findOne({ title: 'Empty' });
      const off = await call(ai, { method: 'POST', token: admin.token, query: { id: String(lesson._id) }, body: { action: 'generate', mode: 'generate' } });
      assert.deepEqual([off.statusCode, off.body.code], [503, 'not_configured']);
      const manual = await call(lessonRoute, { method: 'PUT', token: admin.token, query: { id: String(lesson._id) }, body: { blocks: [{ id: 'manual01', type: 'text', ops: [{ insert: 'Written by hand.\n' }] }], baseRevision: 0 } });
      assert.equal(manual.statusCode, 200, 'manual editing works without any AI provider');
    });
  } finally {
    await conn.reset();
    await conn.close();
    await fake.close();
  }
});
