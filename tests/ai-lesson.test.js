/**
 * AI lesson development: provider adapter, context from the curriculum, output validation,
 * conversion to builder blocks, calculation checks and quality checks. Real-database route tests:
 * tests/integration/ai-lesson-mongo.test.js.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const P = require('../lib/ai-provider');
const G = require('../lib/lesson-generation');
const F = require('../lib/forex-calculations');
const C = require('../lib/course-content');
const { proposedBody } = require('../lib/lesson-ai');
const { startFakeProvider } = require('../scripts/acceptance/fake-ai-provider');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

test('the provider comes from server settings; keys never appear in the public status', () => {
  assert.equal(P.resolveProvider({}).ok, false);
  const groq = P.resolveProvider({ GROQ_API_KEY: 'gsk_test' });
  assert.deepEqual([groq.ok, groq.id, groq.baseUrl, groq.model], [true, 'groq', 'https://api.groq.com/openai/v1', 'openai/gpt-oss-120b']);
  assert.equal(P.resolveProvider({ AI_API_KEY: 'sk-x' }).id, 'openai', 'the existing assistant key still works');
  assert.equal(P.resolveProvider({ AI_LESSON_PROVIDER: 'cloudflare', CLOUDFLARE_API_TOKEN: 't' }).ok, false, 'needs the account id');
  assert.match(P.resolveProvider({ AI_LESSON_PROVIDER: 'cloudflare', CLOUDFLARE_API_TOKEN: 't', CLOUDFLARE_ACCOUNT_ID: 'acc' }).baseUrl, /accounts\/acc\/ai\/v1$/);
  assert.equal(P.resolveProvider({ AI_LESSON_PROVIDER: 'groq', GROQ_API_KEY: 'k', AI_LESSON_MODEL: 'other-model' }).model, 'other-model');
  assert.equal(P.resolveProvider({ AI_LESSON_PROVIDER: 'nonsense' }).ok, false);
  const status = P.publicProviderStatus({ GROQ_API_KEY: 'gsk_secret_value' });
  assert.equal(JSON.stringify(status).includes('gsk_secret_value'), false);
  assert.equal(JSON.stringify(status).includes('api.groq.com'), false);
  assert.equal(P.publicProviderStatus({}).configured, false);
});

test('provider errors are classified into reasons people can act on', () => {
  assert.equal(P.classify(429, { error: { code: 'insufficient_quota', message: 'You exceeded your current quota' } }).code, 'quota');
  assert.equal(P.classify(429, { error: { message: 'Rate limit reached' } }).code, 'rate_limited');
  assert.equal(P.classify(401, {}).code, 'auth');
  assert.equal(P.classify(404, { error: { code: 'model_not_found' } }).code, 'model');
  assert.equal(P.classify(400, { error: { message: 'The model `gpt-x` has been decommissioned' } }).code, 'model');
  assert.equal(P.classify(503, {}).code, 'unavailable');
  assert.equal(P.classify(503, {}).retryable, true);
  assert.equal(P.classify(429, { error: { code: 'insufficient_quota' } }).retryable, false, 'quota is never retried');
});

test('the adapter talks to an OpenAI-compatible server, retries once for temporary errors, never for quota', async () => {
  const fake = await startFakeProvider();
  const env = { AI_LESSON_PROVIDER: 'compatible', AI_LESSON_BASE_URL: fake.url, AI_LESSON_API_KEY: 'test-key', AI_LESSON_MODEL: 'test-model' };
  try {
    const ok = await P.chatJson({ system: 's', user: 'Topic (lesson 1 of 1): Pips', env });
    assert.equal(ok.finishReason, 'stop');
    assert.equal(fake.requests[0].auth, 'Bearer test-key');
    assert.equal(fake.requests[0].model, 'test-model');
    fake.next('unavailable');
    const retried = await P.chatJson({ system: 's', user: 'Topic (lesson 1 of 1): Pips', env });
    assert.ok(retried.content, 'a temporary failure is retried once');
    fake.next('quota');
    const before = fake.requests.length;
    await assert.rejects(P.chatJson({ system: 's', user: 'x', env }), (e) => e.code === 'quota');
    assert.equal(fake.requests.length, before + 1, 'quota errors are not retried');
    fake.requests.length = 0;
    fake.next('auth');
    await assert.rejects(P.chatJson({ system: 's', user: 'x', env }), (e) => e.code === 'auth');
    fake.next('slow');
    await assert.rejects(P.chatJson({ system: 's', user: 'x', env, timeoutMs: 200, retries: 0 }), (e) => e.code === 'timeout');
    await assert.rejects(P.chatJson({ system: 's', user: 'x', env: {} }), (e) => e.code === 'not_configured');
  } finally {
    await fake.close();
  }
});

// ---------------------------------------------------------------------------
// Curriculum context (the source of truth)
// ---------------------------------------------------------------------------

const L = (n) => `${'0'.repeat(23)}${n}`;
const course = { title: 'Forex Trading Fundamentals', description: '<p>Start trading <b>forex</b> safely.</p>', difficulty: 'beginner', category: 'basics', objectives: ['Read a quote'], modules: [{ id: 'modintro1', title: 'Introduction to Forex' }, { id: 'modrisk01', title: 'Risk' }] };
const lessons = [
  { _id: L(1), title: 'What is Forex Trading?', order: 1, moduleId: 'modintro1', blocks: [{ id: 'aaaaaa01', type: 'text', ops: [{ insert: 'Forex is the exchange of currencies.\n' }] }] },
  { _id: L(2), title: 'Understanding Currency Pairs', order: 2, moduleId: 'modintro1', description: '<p>Base and quote.</p>' },
  { _id: L(3), title: 'Understanding Pips and Lots', order: 3, moduleId: 'modintro1', blocks: [{ id: 'img00001', type: 'image', url: 'https://res.cloudinary.com/x/image/upload/a.png', alt: 'A chart', caption: '' }, { id: 'aaaaaa02', type: 'text', ops: [{ insert: 'A pip is a small price move.\n' }] }] },
  { _id: L(4), title: 'Position sizing', order: 4, moduleId: 'modrisk01' },
];

test('the context comes from the stored curriculum: course, module, topic, earlier and later lessons', () => {
  const ctx = G.buildContext({ course, lessons, lessonId: L(3) });
  assert.equal(ctx.topic.title, 'Understanding Pips and Lots');
  assert.deepEqual([ctx.topic.position, ctx.topic.total], [3, 4]);
  assert.equal(ctx.module.title, 'Introduction to Forex');
  assert.deepEqual(ctx.prerequisites, ['What is Forex Trading?', 'Understanding Currency Pairs']);
  assert.deepEqual(ctx.upcoming, ['Position sizing']);
  assert.equal(ctx.course.description, 'Start trading forex safely.', 'HTML is reduced to text');
  assert.match(ctx.existing, /\[\[MEDIA:img00001\]\]/);
  assert.match(ctx.nearest[1].excerpt, /Base and quote/);
  assert.deepEqual(ctx.mediaIds, ['img00001']);
  assert.equal(G.buildContext({ course, lessons, lessonId: L(9) }), null);
  const prompt = G.buildPrompt('improve', ctx, { instructions: 'Use GBP/USD. '.repeat(100) });
  assert.match(prompt.user, /Topic \(lesson 3 of 4\): Understanding Pips and Lots/);
  assert.match(prompt.user, /Module: Introduction to Forex/);
  assert.match(prompt.user, /Already taught earlier in the course: What is Forex Trading\? \| Understanding Currency Pairs/);
  const guidance = prompt.user.split('\n').find((l) => l.startsWith("Instructor's request"));
  assert.ok(guidance.length < 700, 'guidance is bounded');
  assert.match(prompt.system, /Never invent current prices/);
  assert.match(prompt.system, /Do not rename the topic or change the curriculum/);
});

test('no lesson content is hard-coded: prompts carry only instructions, the lesson comes from the provider', () => {
  for (const file of ['lib/lesson-generation.js', 'lib/lesson-ai.js', 'components/builder/AiAssistantPanel.tsx', 'pages/api/lessons/[id]/ai.ts']) {
    const source = read(file);
    assert.doesNotMatch(source, /What is Forex Trading|Understanding Currency Pairs/i, `${file} holds no curriculum topics`);
  }
  // The only canned answers live in the test double, which the application never loads.
  assert.doesNotMatch(read('lib/ai-provider.js'), /fake-ai-provider/);
  assert.doesNotMatch(read('lib/lesson-ai.js'), /fake-ai-provider/);
});

// ---------------------------------------------------------------------------
// Output validation and conversion
// ---------------------------------------------------------------------------

const good = (extra = {}) => JSON.stringify({
  sections: [
    { kind: 'introduction', heading: 'Introduction', body: 'Pips measure price moves. '.repeat(30) },
    { kind: 'explanation', heading: 'Pips', body: 'A **pip** is 0.0001 for most pairs.\n\n- EUR/USD moves from 1.1000 to 1.1001\n- That is one pip\n\nSee https://evil.example/x for more.', keep: ['img00001'] },
    { kind: 'mistakes', heading: 'Common mistakes', body: 'Confusing pips with pipettes.' },
    { kind: 'summary', heading: 'Summary', body: 'Pips and lots together decide how much a move is worth. '.repeat(10) },
  ],
  calculations: [{ afterSection: 1, label: 'Pip value', type: 'pip_value', inputs: { units: 100000, pipSize: 0.0001, quoteCurrency: 'USD' }, expectedResult: 100 }],
  knowledgeChecks: [{ question: 'How much is one pip on EUR/USD?', options: ['0.0001', '0.01', '1', '0.1'], correctIndex: 0, explanation: '' }, { question: 'Bad', options: ['a', 'a'], correctIndex: 0 }],
  ...extra,
});

test('truncated, malformed, empty or too-short answers are refused and never saved', () => {
  assert.throws(() => G.parseLesson(good(), { mode: 'generate', finishReason: 'length' }), (e) => e.code === 'truncated');
  assert.throws(() => G.parseLesson('Sure! Here is a lesson.', { mode: 'generate', finishReason: 'stop' }), (e) => e.code === 'malformed');
  assert.throws(() => G.parseLesson('{"sections": [', { mode: 'generate', finishReason: 'stop' }), (e) => e.code === 'malformed');
  assert.throws(() => G.parseLesson(JSON.stringify({ sections: [] }), { mode: 'generate', finishReason: 'stop' }), (e) => e.code === 'incomplete');
  assert.throws(() => G.parseLesson(JSON.stringify({ sections: [{ kind: 'summary', heading: 'S', body: 'Short.' }] }), { mode: 'rewrite', finishReason: 'stop' }), (e) => e.code === 'incomplete');
  assert.throws(() => G.parseLesson(JSON.stringify({ sections: [], knowledgeChecks: [] }), { mode: 'checks', finishReason: 'stop' }), (e) => e.code === 'incomplete');
  // A short section is fine for section mode; fenced JSON is accepted.
  assert.equal(G.parseLesson('```json\n{"sections":[{"kind":"example","heading":"E","body":"One example."}]}\n```', { mode: 'section', finishReason: 'stop' }).sections.length, 1);
  const parsed = G.parseLesson(good(), { mode: 'generate', finishReason: 'stop' });
  assert.equal(parsed.knowledgeChecks.length, 1, 'malformed questions are dropped');
});

test('generated lessons become ordinary builder blocks; links are removed; media is kept; maths is recomputed', () => {
  const parsed = G.parseLesson(good(), { mode: 'improve', finishReason: 'stop' });
  const existing = C.lessonBlocks(lessons[2]);
  const { blocks, calculations } = G.toBlocks(parsed, { mode: 'improve', existingBlocks: existing });
  assert.equal(C.checkBlocks(blocks).ok, true, 'valid for the shared renderer and the lesson API');
  assert.ok(blocks.some((b) => b.type === 'image' && b.id === 'img00001'), 'the existing image is kept where the model placed it');
  assert.ok(blocks.some((b) => b.type === 'callout' && b.tone === 'warning'), 'short mistakes become a callout');
  const allText = blocks.filter((b) => b.type === 'text').map((b) => C.deltaText(b.ops)).join(' ');
  assert.doesNotMatch(allText, /https?:\/\//, 'no generated links');
  const list = blocks.find((b) => b.type === 'text' && b.ops.some((op) => op.attributes && op.attributes.list === 'bullet'));
  assert.ok(list, 'bullets become a list');
  assert.ok(blocks.filter((b) => b.type === 'text').some((b) => b.ops.some((op) => op.attributes && op.attributes.bold && op.insert === 'pip')), '**bold** becomes bold');
  const worked = blocks.find((b) => b.type === 'code');
  assert.match(worked.text, /100,000 × 0\.0001 = 10\.00 USD per pip/);
  assert.match(worked.text, /Hypothetical values/);
  assert.equal(calculations[0].matches, false, 'the model said 100; the correct value 10 is shown and the mismatch reported');
  // Whole-lesson modes never drop media the model did not place.
  const dropped = G.toBlocks(G.parseLesson(good({ sections: [{ kind: 'introduction', heading: 'Intro', body: 'Text '.repeat(150) }] }), { mode: 'rewrite', finishReason: 'stop' }), { mode: 'rewrite', existingBlocks: existing });
  assert.ok(dropped.blocks.some((b) => b.id === 'img00001'));
  assert.ok(dropped.blocks.some((b) => b.type === 'heading' && b.text === 'Lesson resources'));
});

test('section and example modes insert into the current lesson; whole-lesson modes replace it', () => {
  const current = [{ id: 'aaaaaa01', type: 'divider' }, { id: 'aaaaaa02', type: 'divider' }];
  const generated = [{ id: 'bbbbbb01', type: 'divider' }];
  assert.deepEqual(proposedBody('section', current, generated, 'aaaaaa01').map((b) => b.id), ['aaaaaa01', 'bbbbbb01', 'aaaaaa02']);
  assert.deepEqual(proposedBody('examples', current, generated, null).map((b) => b.id), ['aaaaaa01', 'aaaaaa02', 'bbbbbb01']);
  assert.deepEqual(proposedBody('rewrite', current, generated, null).map((b) => b.id), ['bbbbbb01']);
  assert.deepEqual(proposedBody('checks', current, generated, null).map((b) => b.id), ['aaaaaa01', 'aaaaaa02']);
});

// ---------------------------------------------------------------------------
// Calculations and quality
// ---------------------------------------------------------------------------

test('forex calculations are recomputed with their steps; impossible inputs are refused', () => {
  const pos = F.verifyCalculation({ type: 'position_size', inputs: { accountBalance: 5000, riskPercent: 2, stopPips: 40, pipValuePerLot: 10 }, expectedResult: 0.25 });
  assert.deepEqual([pos.result, pos.matches], [0.25, true]);
  assert.equal(F.verifyCalculation({ type: 'pips', inputs: { priceFrom: 150.25, priceTo: 150.75, pipSize: 0.01 } }).result, 50, 'JPY pairs use 0.01');
  assert.equal(F.verifyCalculation({ type: 'spread', inputs: { bid: 1.1, ask: 1.1002, pipSize: 0.0001 } }).result, 2);
  assert.equal(F.verifyCalculation({ type: 'margin', inputs: { units: 100000, price: 1.085, leverage: 30 } }).result, 3616.67);
  assert.equal(F.verifyCalculation({ type: 'profit_loss', inputs: { units: 10000, entry: 1.265, exit: 1.26, side: 'sell' } }).result, 50);
  assert.equal(F.verifyCalculation({ type: 'risk_reward', inputs: { entry: 1.1, stop: 1.105, target: 1.11 } }).ok, false, 'stop on the wrong side');
  assert.equal(F.verifyCalculation({ type: 'spread', inputs: { bid: 1.2, ask: 1.1, pipSize: 0.0001 } }).ok, false);
  assert.equal(F.verifyCalculation({ type: 'pip_value', inputs: { units: 'lots' } }).ok, false);
  assert.ok(F.verifyCalculation({ type: 'position_size', inputs: { accountBalance: 1000, riskPercent: 10, stopPips: 20, pipValuePerLot: 10 } }).warnings.length, 'excessive risk is flagged');
});

test('the quality checklist reports what can be checked and never calls content verified', () => {
  const ctx = G.buildContext({ course, lessons, lessonId: L(3) });
  const parsed = G.parseLesson(good({ sections: [
    { kind: 'introduction', heading: 'Intro', body: 'Studies show 90% of traders lose money. You should buy EUR/USD now; it is guaranteed. The current price is 1.0850.' },
    { kind: 'explanation', heading: 'Intro', body: 'Pips and lots matter a lot for every trade you make here. '.repeat(20) },
  ] }), { mode: 'generate', finishReason: 'stop' });
  const { blocks, calculations } = G.toBlocks(parsed, { mode: 'generate' });
  const q = G.assessQuality({ mode: 'generate', ctx, parsed, blocks, calculations });
  const by = Object.fromEntries(q.checks.map((c) => [c.id, c]));
  assert.equal(by.claims.status, 'warn');
  assert.equal(by.advice.status, 'warn');
  assert.equal(by.live_prices.status, 'warn');
  assert.equal(by.structure.status, 'warn', 'no summary');
  assert.equal(by.headings.status, 'warn', 'duplicate headings');
  assert.equal(by.math.status, 'warn', 'the model\'s result differed');
  assert.equal(by.repetition.status, 'warn');
  assert.equal(by.review.status, 'warn', 'always asks for instructor review');
  assert.equal(q.checks.some((c) => /verified/i.test(c.label) && c.status === 'pass'), false);
});

test('the builder exposes the assistant to owners only and keeps manual editing independent of it', () => {
  const route = read('pages/api/lessons/[id]/ai.ts');
  assert.match(route, /withAuth\(handler, \['instructor', 'admin', 'superadmin'\]\)/);
  assert.match(route, /loadOwnedCourse\(db, req, String\(lesson\.courseId\), COURSE_FIELDS, \{ edit: action !== 'read' && action !== 'reject' \}\)/);
  assert.match(route, /allowRequest\(aiLessonLimiter/);
  assert.match(route, /allowRequest\(aiLessonDailyLimiter/);
  // Lesson saves, uploads and the builder never call the AI provider.
  for (const file of ['pages/api/lessons/[id].ts', 'pages/api/lessons/index.ts', 'pages/api/courses/[id]/assets.ts', 'pages/api/courses/[id]/builder.ts']) {
    assert.doesNotMatch(read(file), /ai-provider|lesson-ai/, file);
  }
  // Students never receive proposals or history.
  const access = require('../lib/account-access');
  const view = access.presentLessonRead({ _id: L(1), title: 'T', blocks: [], aiProposals: [{ id: 'x' }], history: [{ id: 'y' }], aiGeneration: {} }, true, L(9));
  assert.equal(view.aiProposals, undefined);
  assert.equal(view.history, undefined);
  const { LESSON_TEXT_FIELDS } = require('../lib/media-cleanup');
  assert.ok(LESSON_TEXT_FIELDS.includes('history.blocks.url'), 'images in kept versions are never cleaned up');
});

test('a missing model names the provider and model; a wrong address is reported as such; keys never reach the log', async () => {
  assert.equal(P.classify(404, { error: { message: 'The model `gpt-4o-mini` does not exist or you do not have access to it.', code: 'model_not_found' } }).code, 'model');
  assert.equal(P.classify(404, { error: { message: 'Not Found' } }).code, 'endpoint', 'a 404 without a model reason is the address');
  assert.equal(P.providerReason({ error: { message: 'Incorrect API key provided: sk-proj-abcdef123456. Find it here' } }), 'Incorrect API key provided: <key>. Find it here');
  let reply = { status: 404, body: { error: { message: 'The model `gpt-4o-mini` does not exist or you do not have access to it.', code: 'model_not_found' } } };
  const fetchImpl = async () => ({ ok: false, status: reply.status, json: async () => reply.body });
  await assert.rejects(P.chatJson({ system: 's', user: 'u', env: { AI_API_KEY: 'sk-test' }, fetchImpl, retries: 0 }), (e) => e.code === 'model' && /OpenAI says the model "gpt-4o-mini" is not available/.test(e.message) && /GROQ_API_KEY/.test(e.message) && e.providerMessage.includes('does not exist'));
  reply = { status: 404, body: { error: { message: 'Not Found' } } };
  await assert.rejects(P.chatJson({ system: 's', user: 'u', env: { AI_LESSON_PROVIDER: 'compatible', AI_LESSON_BASE_URL: 'https://example.invalid/wrong', AI_LESSON_MODEL: 'm' }, fetchImpl, retries: 0 }), (e) => e.code === 'endpoint');
});

test('a retired default model is replaced from the provider list; a pinned model is not', async () => {
  const fake = await startFakeProvider();
  const base = { AI_LESSON_PROVIDER: 'compatible', AI_LESSON_BASE_URL: fake.url, AI_LESSON_API_KEY: 'k' };
  try {
    P.resetModelChoices();
    // Groq retired llama-3.3-70b-versatile (2026-08-16): the default moved to openai/gpt-oss-120b.
    assert.equal(P.resolveProvider({ GROQ_API_KEY: 'gsk' }).model, 'openai/gpt-oss-120b');
    // An unpinned default that is refused is replaced by the best available chat model, once.
    const groqLike = { ...base, AI_LESSON_MODEL: undefined };
    fake.refuse('fake-default');
    const p = P.resolveProvider({ ...groqLike, AI_LESSON_MODEL: 'fake-default' });
    assert.equal(p.pinned, true);
    const models = await P.availableModels({ baseUrl: fake.url, key: 'k' }, fetch);
    assert.deepEqual(models, ['openai/gpt-oss-120b', 'openai/gpt-oss-20b'], 'speech models are skipped; preference order');
    // Pinned: no automatic replacement, and the message lists what is available.
    await assert.rejects(P.chatJson({ system: 's', user: 'Topic (lesson 1 of 1): Pips', env: { ...base, AI_LESSON_MODEL: 'fake-default' }, retries: 0 }),
      (e) => e.code === 'model' && e.message.includes('Available: openai/gpt-oss-120b') && /Change AI_LESSON_MODEL/.test(e.message));
    // Not pinned (the provider's built-in default was refused): replaced, retried, remembered.
    const original = P.PROVIDERS.compatible.model;
    P.PROVIDERS.compatible.model = 'fake-default';
    try {
      const before = fake.requests.length;
      const ok = await P.chatJson({ system: 's', user: 'Topic (lesson 1 of 1): Pips', env: base, retries: 0 });
      assert.equal(ok.finishReason, 'stop');
      const tried = fake.requests.slice(before).map((r) => r.model);
      assert.deepEqual(tried, ['fake-default', 'openai/gpt-oss-120b']);
      assert.equal(fake.requests[fake.requests.length - 1].reasoning, 'low', 'reasoning models get low effort');
      assert.equal(P.resolveProvider(base).model, 'openai/gpt-oss-120b', 'the replacement is remembered');
    } finally {
      P.PROVIDERS.compatible.model = original;
      P.resetModelChoices();
    }
    // Plain-text answers for the assistant use the same connector.
    const text = await P.chatText({ system: 's', user: 'Explain pips', env: { ...base, AI_LESSON_MODEL: 'openai/gpt-oss-20b' } });
    assert.ok(text.content.length > 0);
  } finally {
    await fake.close();
  }
});

test('the assistant routes return the real reason for AI problems instead of a generic error', () => {
  const ai = read('lib/ai.ts');
  assert.ok(ai.includes('const answer = await chatText('));
  assert.ok(ai.includes('export function aiFailure(error: unknown)'));
  for (const route of ['pages/api/ai/answer-question.ts', 'pages/api/ai/analyze-trade.ts', 'pages/api/ai/task-hint.ts', 'pages/api/ai/explain-lesson.ts', 'pages/api/ai/community/answer.ts', 'pages/api/ai/instructor/analyze-student.ts', 'pages/api/ai/instructor/draft-feedback.ts']) {
    const source = read(route);
    assert.ok(/const aiError = aiFailure\((error|err|e)\);/.test(source), route);
    assert.ok(source.includes('if (aiError) return res.status(aiError.status).json(aiError.body);'), route);
  }
});
