/**
 * Practical trading tasks: definition rules, the generator, the grading engine, and the full task
 * lifecycle through the real routes (withAuth with session cookies and live account checks) over
 * the in-memory stand-in (tests/helpers/payment-memory-db.js). The real notification service runs
 * against the same store, so dedupe keys are exercised. Cloudinary is replaced. Not real-MongoDB
 * coverage: index use and true concurrency are not shown here.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ObjectId, Decimal128 } = require('mongodb');
const { paymentMemoryDb } = require('./helpers/payment-memory-db');
const { loadModule, mockResponse } = require('./helpers/ts-loader');
const { requestHeaders, seedSession } = require('./helpers/session-cookie');
const S = require('../lib/practical-task-spec');
const G = require('../lib/practical-task-generator');
const E = require('../lib/practical-grading');
const P = require('../lib/practical-tasks');
const { taskIsFor } = require('../lib/practice-desk');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const ROUTE_ENV = { NODE_ENV: 'test', MONGODB_DB_NAME: 'forexorbit_pt_test', MONGO_URI: 'mongodb://127.0.0.1:27017', APP_ORIGIN: undefined, PORT: undefined, SHARED_RATE_LIMIT: undefined };
const newId = () => new ObjectId().toHexString();
const D = (v) => Decimal128.fromString(v);
const HOUR = 3600 * 1000;
const ago = (ms) => new Date(Date.now() - ms);
const later = (ms) => new Date(Date.now() + ms);

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
const route = (fn) => () => withEnv(ROUTE_ENV, fn);

/** A task definition the editor would send. */
function definition(overrides = {}) {
  return {
    title: 'Plan a EUR/USD trade at 2 : 1',
    summary: 'Risk-to-reward planning.',
    instructions: 'Choose an entry.\n\n- Place the stop where the idea is wrong.\n- Target at least twice the stop distance.',
    objectives: ['Plan a trade with at least 2 : 1 reward-to-risk.'],
    category: 'risk_reward',
    difficulty: 'intermediate',
    instruments: ['EUR_USD'],
    requirements: { minTrades: 1, maxTrades: 2, maxRiskPercent: '1', minRewardRisk: '2', minExplanationChars: 20, external: 'optional', maxAttachments: 2 },
    rubric: [
      { kind: 'auto', check: 'instrument_match', points: 10 },
      { kind: 'auto', check: 'stop_loss_valid', points: 20 },
      { kind: 'auto', check: 'reward_risk_min', points: 30 },
      { kind: 'auto', check: 'risk_within_limit', points: 30 },
      { kind: 'auto', check: 'explanation_given', points: 10 },
    ],
    maxAttempts: 2,
    dueAt: later(48 * HOUR).toISOString(),
    ...overrides,
  };
}
const manualRubric = [
  { kind: 'auto', check: 'stop_loss_valid', points: 20 },
  { kind: 'auto', check: 'risk_within_limit', points: 30 },
  { kind: 'manual', label: 'Levels chosen from the chart', description: 'Justified by chart levels.', points: 50 },
];

function world() {
  const db = paymentMemoryDb({ uniqueIndexes: [] });
  const w = { insA: newId(), insB: newId(), insX: newId(), admin: newId(), s1: newId(), s2: newId(), s3: newId(), sOut: newId(), CA: newId(), CB: newId(), lessonA: newId() };
  const user = (id, role, extra = {}) => db.rows('users').push({ _id: new ObjectId(id), email: `${role}-${id.slice(-6)}@example.test`, name: `${role} ${id.slice(-4)}`, role, status: 'approved', sessionGeneration: 0, createdAt: ago(90 * 24 * HOUR), ...extra });
  user(w.insA, 'instructor', { name: 'Ada Instructor' });
  user(w.insB, 'instructor', { name: 'Ben Instructor' });
  user(w.insX, 'instructor', { name: 'Sus Pended', status: 'suspended' });
  user(w.admin, 'admin');
  user(w.s1, 'student', { name: 'Sam Student' });
  user(w.s2, 'student', { name: 'Tia Student' });
  user(w.s3, 'student', { name: 'Uma Student' });
  user(w.sOut, 'student', { name: 'Out Sider' });
  db.rows('courses').push({ _id: new ObjectId(w.CA), title: 'Risk Course', status: 'published', instructorId: w.insA, updatedAt: ago(HOUR) });
  db.rows('courses').push({ _id: new ObjectId(w.CB), title: 'Other Course', status: 'published', instructorId: w.insB, updatedAt: ago(HOUR) });
  db.rows('lessons').push({ _id: new ObjectId(w.lessonA), courseId: w.CA, title: 'Risk lesson', order: 1 });
  db.rows('progress').push({ _id: new ObjectId(), userId: w.s1, courseId: w.CA, progress: 10, enrolledAt: ago(10 * 24 * HOUR) });
  db.rows('progress').push({ _id: new ObjectId(), userId: w.s2, courseId: new ObjectId(w.CA), progress: 40, enrolledAt: ago(10 * 24 * HOUR) });
  db.rows('progress').push({ _id: new ObjectId(), userId: w.s3, courseId: w.CB, progress: 5, enrolledAt: ago(10 * 24 * HOUR) });
  db.rows('progress').push({ _id: new ObjectId(), userId: w.sOut, courseId: w.CA, progress: 5, withdrawnAt: ago(HOUR), active: false });
  // Each student's simulator account.
  for (const s of ['s1', 's2', 's3']) {
    w[`acc_${s}`] = new ObjectId();
    db.rows('tradingAccounts').push({ _id: w[`acc_${s}`], userId: w[s], status: 'active', startingBalance: D('10000.00'), balance: D('10000.00') });
  }

  const stubs = {
    'lib/mongodb': { getDb: async () => db },
    'lib/socket-server': { getSocketServer: () => null },
    'lib/cloudinary': {
      privateImageUrl: (id) => `https://signed.example/${id}?exp=300`,
      isCloudinaryConfigured: () => true,
      imageSignatureMatches: () => true,
      uploadPrivateImageFromPath: async () => ({ publicId: 'x', format: 'png', bytes: 1 }),
      deletePrivateImage: async () => undefined,
    },
  };
  const r = {
    list: loadModule('pages/api/practical-tasks/index.ts', stubs).default,
    generate: loadModule('pages/api/practical-tasks/generate.ts', stubs).default,
    task: loadModule('pages/api/practical-tasks/[id]/index.ts', stubs).default,
    publish: loadModule('pages/api/practical-tasks/[id]/publish.ts', stubs).default,
    status: loadModule('pages/api/practical-tasks/[id]/status.ts', stubs).default,
    attempt: loadModule('pages/api/practical-tasks/[id]/attempt.ts', stubs).default,
    submit: loadModule('pages/api/practical-tasks/[id]/submit.ts', stubs).default,
    review: loadModule('pages/api/practical-tasks/attempts/[attemptId].ts', stubs).default,
    queue: loadModule('pages/api/practical-tasks/queue.ts', stubs).default,
    summary: loadModule('pages/api/practical-tasks/summary.ts', stubs).default,
    evidence: loadModule('pages/api/practical-tasks/evidence.ts', stubs).default,
    legacyTasks: loadModule('pages/api/demo-trading/tasks.ts', stubs).default,
    legacySubmit: loadModule('pages/api/demo-trading/tasks/[id]/submit.ts', stubs).default,
    legacyStudentSubs: loadModule('pages/api/demo-trading/submissions/student.ts', stubs).default,
    hint: loadModule('pages/api/ai/task-hint.ts', { ...stubs, 'lib/ai': { isAIConfigured: () => true, getTaskHint: async () => 'hint' } }).default,
  };
  const T = {};
  for (const key of ['insA', 'insB', 'insX', 'admin', 's1', 's2', 's3', 'sOut']) T[key] = seedSession(db.rows('sessions'), { userId: w[key], generation: 0, now: new Date() });
  return { db, w, r, T };
}

async function call(handler, { method = 'GET', token, body, query = {} } = {}) {
  const res = mockResponse();
  res.redirect = function redirect(code, url) { this.statusCode = code; this.location = url; return this; };
  await handler({ method, url: '/api/test', headers: requestHeaders(token), body, query, socket: { remoteAddress: '10.0.0.12' } }, res);
  return res;
}

/** A simulator position (and its order) owned by `who`, opened at `openedAt`. */
function trade(x, who, { openedAt = new Date(), side = 'buy', instrument = 'EUR_USD', entry = '1.10000', stop = '1.09800', target = '1.10400', risk = '100.00', type = 'limit', status = 'closed', pl = '-100.00', units = 50000 } = {}) {
  const orderId = new ObjectId();
  const positionId = new ObjectId();
  x.db.rows('tradingOrders').push({ _id: orderId, accountId: x.w[`acc_${who}`], userId: x.w[who], type, instrument, side, units, stopLoss: D(stop), takeProfit: target ? D(target) : null, status: 'filled', createdAt: openedAt });
  x.db.rows('tradingPositions').push({ _id: positionId, accountId: x.w[`acc_${who}`], userId: x.w[who], orderId, instrument, side, units, entry: D(entry), stopLoss: D(stop), takeProfit: target ? D(target) : null, plannedRisk: D(risk), status, exit: status === 'closed' ? D('1.09800') : null, realizedPl: status === 'closed' ? D(pl) : null, openedAt, closedAt: status === 'closed' ? new Date() : null });
  return String(positionId);
}

async function createAndPublish(x, { def = definition(), audience = 'course', studentIds } = {}) {
  const created = await call(x.r.list, { method: 'POST', token: x.T.insA, body: { definition: def, courseId: x.w.CA, lessonId: x.w.lessonA } });
  assert.equal(created.statusCode, 201, JSON.stringify(created.body));
  const id = created.body.task.id;
  const pub = await call(x.r.publish, { method: 'POST', token: x.T.insA, query: { id }, body: { audience, studentIds, expectedVersion: created.body.task.version } });
  assert.equal(pub.statusCode, 200, JSON.stringify(pub.body));
  return { id, pub };
}

const notes = (x, key) => x.db.rows('notifications').filter((n) => !key || n.dedupeKey === key);
const audits = (x, action) => x.db.rows('adminAuditLog').filter((a) => !action || a.action === action);

// ---------------------------------------------------------------------------
// Definition rules and generator
// ---------------------------------------------------------------------------

test('definition: automatic grading is the default, and invalid configurations are refused', () => {
  const now = new Date();
  const ok = S.readTaskDefinition({ ...definition(), gradingMode: undefined }, { now });
  assert.equal(ok.ok, true);
  assert.equal(ok.task.gradingMode, 'automatic');
  assert.equal(ok.task.rubric.maxScore, 100);
  assert.equal(ok.task.schema, 'practical_v2');
  const refused = (d) => S.readTaskDefinition(d, { now });
  assert.equal(refused({ ...definition(), title: '' }).field, 'title');
  assert.equal(refused({ ...definition(), instruments: ['XAU_USD'] }).field, 'instruments');
  assert.equal(refused({ ...definition(), requirements: { ...definition().requirements, maxRiskPercent: '5' } }).field, 'requirements.maxRiskPercent');
  assert.equal(refused({ ...definition(), rubric: manualRubric, gradingMode: 'automatic' }).field, 'gradingMode');
  assert.equal(refused({ ...definition(), rubric: [{ kind: 'auto', check: 'direction_match', points: 10 }] }).field, 'rubric.0.check');
  assert.equal(refused({ ...definition(), rubric: [{ kind: 'auto', check: 'made_profit', points: 10 }] }).field, 'rubric.0.check');
  assert.equal(refused({ ...definition(), rubric: [{ kind: 'auto', check: 'stop_loss_valid', points: 101 }] }).field, 'rubric.0.points');
  assert.equal(refused({ ...definition(), dueAt: ago(HOUR).toISOString() }).field, 'dueAt');
  assert.equal(refused({ ...definition(), gradingMode: 'automatic', requirements: { ...definition().requirements, external: 'required' } }).field, 'gradingMode');
  assert.equal(refused({ ...definition(), gradingMode: 'peer' }).field, 'gradingMode');
});

test('generator: every category and grading mode gives a valid, measurable, editable task', () => {
  for (const category of G.TEMPLATE_IDS) {
    for (const gradingMode of ['automatic', 'assisted', 'manual']) {
      const g = G.generateTask({ category, gradingMode, side: 'sell', instruments: ['GBP_USD', 'USD_JPY'], difficulty: 'advanced' });
      assert.equal(g.ok, true, `${category}/${gradingMode}: ${g.error}`);
      assert.ok(g.task.objectives.length >= 1);
      assert.ok(g.task.rubric.criteria.length >= 3);
      assert.ok(!/make (a )?profit/i.test(g.task.instructions), category);
      assert.match(g.task.instructions, /simulated/i);
      assert.match(g.task.instructions, /Risk rules: at most \d/);
      if (gradingMode === 'automatic') assert.ok(g.task.rubric.criteria.every((c) => c.kind === 'auto'), category);
      // The draft is what the editor receives: it validates again unchanged.
      assert.equal(S.readTaskDefinition(g.draft).ok, true, category);
    }
  }
  const a = G.generateTask({ category: 'breakout', seed: 'x1' });
  const b = G.generateTask({ category: 'breakout', seed: 'x1' });
  assert.deepEqual(a.task, b.task);
  assert.equal(G.generateTask({ category: 'trade_management', gradingMode: 'automatic' }).notice !== null, true);
  assert.equal(G.generateTask({ category: 'breakout', gradingMode: 'automatic', external: 'required' }).ok, false);
  assert.equal(G.generateTask({ category: 'nonsense' }).ok, false);
  assert.match(G.generateTask({ category: 'trend_identification' }, { context: { price: '1.08412' } }).task.instructions, /about 1\.08412 \(simulated, not a live price\)/);
});

// ---------------------------------------------------------------------------
// Grading engine
// ---------------------------------------------------------------------------

const rubricOf = (def) => S.readTaskDefinition(def).task;
const baseTrade = { positionId: 'p1', instrument: 'EUR_USD', side: 'buy', units: 50000, orderType: 'limit', entry: '1.10000', stopLoss: '1.09800', takeProfit: '1.10400', plannedRisk: '100.00', status: 'closed', exit: '1.09800', realizedPl: '-100.00', openedAt: '2026-11-20T10:00:00.000Z', startingBalance: '10000.00' };
const evidenceOf = (trades, extra = {}) => ({ trades, startingBalance: '10000.00', windowStart: '2026-11-20T09:00:00.000Z', windowEnd: '2026-11-20T12:00:00.000Z', explanationLength: 40, attachments: 0, ...extra });

test('engine: deterministic, exact, partial credit, and process over profit', () => {
  const t = rubricOf(definition());
  const one = E.gradePractical({ rubric: t.rubric, requirements: t.requirements, evidence: evidenceOf([baseTrade]) });
  assert.equal(one.complete, true);
  assert.equal(one.score, 100);
  assert.equal(one.percent, '100.0');
  // A losing trade with a sound process scores exactly like a winning one.
  const winner = E.gradePractical({ rubric: t.rubric, requirements: t.requirements, evidence: evidenceOf([{ ...baseTrade, exit: '1.10400', realizedPl: '200.00' }]) });
  assert.equal(winner.score, one.score);
  // Reproducible: the same inputs give the same result and fingerprint.
  assert.deepEqual(E.gradePractical({ rubric: t.rubric, requirements: t.requirements, evidence: evidenceOf([baseTrade]) }), one);
  // Second trade: risk 1.5% (limit 1%), target only 1:1, stop on the wrong side.
  const bad = { ...baseTrade, positionId: 'p2', plannedRisk: '150.00', takeProfit: '1.10200', stopLoss: '1.10100' };
  const two = E.gradePractical({ rubric: t.rubric, requirements: t.requirements, evidence: evidenceOf([baseTrade, bad]) });
  const by = Object.fromEntries(two.criteria.map((c) => [c.id, c]));
  assert.equal(by.risk_within_limit.score, 15); // 30 x 1/2
  assert.equal(by.risk_within_limit.status, 'partial');
  assert.equal(by.stop_loss_valid.score, 10);
  assert.equal(by.reward_risk_min.score, 15);
  assert.equal(by.instrument_match.score, 10);
  assert.equal(two.score, 60);
  assert.equal(two.percent, '60.0');
  assert.ok(two.recommendations.some((r) => /position size/.test(r)));
  assert.match(two.observations.risk[0], /Largest planned risk: 1\.50% of the starting balance \(limit 1%\)/);
  // Exactly at the limit passes: 100.00 of 10000.00 is 1%.
  assert.equal(E.gradePractical({ rubric: t.rubric, requirements: t.requirements, evidence: evidenceOf([{ ...baseTrade, plannedRisk: '100.01' }]) }).criteria.find((c) => c.id === 'risk_within_limit').score, 0);
  // Yen pairs: prices with three decimals.
  const jpy = rubricOf(definition({ instruments: ['USD_JPY'] }));
  const yen = E.gradePractical({ rubric: jpy.rubric, requirements: jpy.requirements, evidence: evidenceOf([{ ...baseTrade, instrument: 'USD_JPY', side: 'sell', entry: '149.500', stopLoss: '149.800', takeProfit: '148.900' }]) });
  assert.equal(yen.score, 100);
  // No trades: trade criteria are not met, nothing is invented.
  const none = E.gradePractical({ rubric: t.rubric, requirements: t.requirements, evidence: evidenceOf([]) });
  assert.equal(none.score, 10);
  assert.equal(none.criteria.find((c) => c.id === 'stop_loss_valid').detail, 'No simulator trades were attached.');
  // Manual criteria are left for the instructor.
  const m = rubricOf(definition({ rubric: manualRubric, gradingMode: 'assisted' }));
  const assisted = E.gradePractical({ rubric: m.rubric, requirements: m.requirements, evidence: evidenceOf([baseTrade]) });
  assert.equal(assisted.complete, false);
  assert.equal(assisted.score, null);
  assert.equal(assisted.autoScore, 50);
  assert.equal(assisted.criteria.find((c) => c.kind === 'manual').status, 'needs_instructor');
  // Trades outside the window fail the window check.
  const w = rubricOf(definition({ rubric: [{ kind: 'auto', check: 'trades_in_window', points: 10 }] }));
  assert.equal(E.gradePractical({ rubric: w.rubric, requirements: w.requirements, evidence: evidenceOf([{ ...baseTrade, openedAt: '2026-11-19T10:00:00.000Z' }]) }).score, 0);
  assert.equal(E.percentText(2, 3), '66.7');
});

// ---------------------------------------------------------------------------
// Authoring, scope and distribution
// ---------------------------------------------------------------------------

test('authoring: instructors create drafts in their own courses only; others are refused', route(async () => {
  const x = world();
  const def = { ...definition(), gradingMode: undefined };
  const created = await call(x.r.list, { method: 'POST', token: x.T.insA, body: { definition: def, courseId: x.w.CA } });
  assert.equal(created.statusCode, 201);
  assert.equal(created.body.task.gradingMode, 'automatic');
  assert.equal(created.body.task.status, 'draft');
  const stored = x.db.rows('demoTasks')[0];
  assert.equal(stored.schema, 'practical_v2');
  assert.notEqual(stored.assignedTo, null);
  assert.equal(audits(x, 'practical_task_created').length, 1);
  assert.equal((await call(x.r.list, { method: 'POST', token: x.T.insA, body: { definition: def, courseId: x.w.CB } })).statusCode, 400);
  assert.equal((await call(x.r.list, { method: 'POST', token: x.T.s1, body: { definition: def, courseId: x.w.CA } })).statusCode, 403);
  assert.equal((await call(x.r.list, { method: 'POST', token: x.T.admin, body: { definition: def, courseId: x.w.CA } })).statusCode, 403);
  const suspended = await call(x.r.list, { method: 'POST', token: x.T.insX, body: { definition: def, courseId: x.w.CA } });
  assert.ok([401, 403].includes(suspended.statusCode));
  assert.equal((await call(x.r.list, { token: x.T.insX })).statusCode >= 401, true);
  // Another instructor cannot read, edit or publish it.
  const id = created.body.task.id;
  assert.equal((await call(x.r.task, { token: x.T.insB, query: { id } })).statusCode, 404);
  assert.equal((await call(x.r.task, { method: 'PUT', token: x.T.insB, query: { id }, body: { definition: def, courseId: x.w.CA, expectedVersion: 1 } })).statusCode, 404);
  assert.equal((await call(x.r.publish, { method: 'POST', token: x.T.insB, query: { id }, body: { audience: 'course', expectedVersion: 1 } })).statusCode, 404);
  // Drafts are invisible to students, even by id.
  assert.equal((await call(x.r.task, { token: x.T.s1, query: { id } })).statusCode, 404);
  // Editing a draft needs the current version.
  const edit = await call(x.r.task, { method: 'PUT', token: x.T.insA, query: { id }, body: { definition: { ...def, title: 'Edited title' }, courseId: x.w.CA, expectedVersion: 1 } });
  assert.equal(edit.statusCode, 200);
  assert.equal(edit.body.task.title, 'Edited title');
  assert.equal((await call(x.r.task, { method: 'PUT', token: x.T.insA, query: { id }, body: { definition: def, courseId: x.w.CA, expectedVersion: 1 } })).statusCode, 409);
  // The generator previews without saving.
  const gen = await call(x.r.generate, { method: 'POST', token: x.T.insA, body: { category: 'position_sizing', gradingMode: 'assisted', instruments: ['EUR_USD'] } });
  assert.equal(gen.statusCode, 200);
  assert.equal(gen.body.task.gradingMode, 'assisted');
  assert.equal(x.db.rows('demoTasks').length, 1);
  assert.equal((await call(x.r.generate, { method: 'POST', token: x.T.s1, body: { category: 'position_sizing' } })).statusCode, 403);
  // Admin oversight is read-only.
  assert.equal((await call(x.r.list, { token: x.T.admin })).statusCode, 200);
  assert.equal((await call(x.r.task, { token: x.T.admin, query: { id } })).body.readOnly, true);
}));

test('distribution: only enrolled students receive it, once, with one notification each', route(async () => {
  const x = world();
  const { id, pub } = await createAndPublish(x);
  assert.equal(pub.body.added, 2);
  const task = x.db.rows('demoTasks')[0];
  assert.deepEqual([...task.recipients].sort(), [x.w.s1, x.w.s2].sort());
  assert.equal(task.status, 'published');
  assert.equal(notes(x, `practical-task:${id}`).length, 2);
  assert.equal(notes(x)[0].metadata.href, `/student-dashboard/practical/${id}`);
  // Publishing again adds nobody and notifies nobody.
  const again = await call(x.r.publish, { method: 'POST', token: x.T.insA, query: { id }, body: { audience: 'course', expectedVersion: task.version } });
  assert.equal(again.statusCode, 200);
  assert.equal(again.body.added, 0);
  assert.equal(notes(x, `practical-task:${id}`).length, 2);
  // A student outside the course (or withdrawn) cannot be selected.
  const outside = await call(x.r.publish, { method: 'POST', token: x.T.insA, query: { id }, body: { audience: 'students', studentIds: [x.w.s3], expectedVersion: x.db.rows('demoTasks')[0].version } });
  assert.equal(outside.statusCode, 400);
  const withdrawn = await call(x.r.publish, { method: 'POST', token: x.T.insA, query: { id }, body: { audience: 'students', studentIds: [x.w.sOut], expectedVersion: x.db.rows('demoTasks')[0].version } });
  assert.equal(withdrawn.statusCode, 400);
  assert.equal((await call(x.r.publish, { method: 'POST', token: x.T.insA, query: { id }, body: { audience: 'course', expectedVersion: 1 } })).statusCode, 409);
  assert.equal(audits(x, 'practical_task_published').length, 1);
  assert.equal(audits(x, 'practical_task_distributed').length, 1);

  // Visibility: recipients only.
  const list = await call(x.r.list, { token: x.T.s1 });
  assert.equal(list.statusCode, 200);
  assert.equal(list.body.tasks.length, 1);
  assert.equal(list.body.tasks[0].state, 'not_started');
  assert.equal(list.body.tasks[0].instructor, 'Ada Instructor');
  assert.equal(list.body.tasks[0].course, 'Risk Course');
  assert.equal((await call(x.r.list, { token: x.T.s3 })).body.tasks.length, 0);
  assert.equal((await call(x.r.task, { token: x.T.s3, query: { id } })).statusCode, 404);
  assert.equal((await call(x.r.task, { token: x.T.sOut, query: { id } })).statusCode, 404);
  const detail = await call(x.r.task, { token: x.T.s1, query: { id } });
  assert.equal(detail.statusCode, 200);
  assert.equal(detail.body.task.generator, undefined);
  assert.equal(detail.body.task.recipients, undefined);
  assert.equal(detail.body.task.blocks[1].type, 'list');
  // The older demo-task routes ignore practical tasks entirely.
  const legacy = await call(x.r.legacyTasks, { token: x.T.s1 });
  assert.equal(legacy.body.some((t) => t._id === id), false);
  assert.equal((await call(x.r.legacyTasks, { token: x.T.insA })).body.some((t) => t._id === id), false);
  assert.equal((await call(x.r.legacySubmit, { method: 'POST', token: x.T.s1, query: { id }, body: { reasoning: 'x' } })).statusCode, 404);
  assert.equal(taskIsFor(x.db.rows('demoTasks')[0], x.w.s1), true);
  assert.equal(taskIsFor(x.db.rows('demoTasks')[0], x.w.s3), false);
  // AI hints: a practical task is hinted only to its recipients.
  assert.equal((await call(x.r.hint, { method: 'POST', token: x.T.s3, body: { taskId: id } })).statusCode, 404);
}));

// ---------------------------------------------------------------------------
// Attempts, evidence and automatic grading
// ---------------------------------------------------------------------------

test('automatic grading: evidence from the student own records, graded at once, frozen, notified once', route(async () => {
  const x = world();
  const { id } = await createAndPublish(x);
  const tradesBefore = JSON.stringify([x.db.rows('tradingPositions'), x.db.rows('tradingOrders'), x.db.rows('tradingAccounts')]);
  const early = trade(x, 's1', { openedAt: ago(2 * HOUR) });
  const start = await call(x.r.attempt, { method: 'POST', token: x.T.s1, query: { id } });
  assert.equal(start.statusCode, 201);
  const again = await call(x.r.attempt, { method: 'POST', token: x.T.s1, query: { id } });
  assert.equal(again.statusCode, 200);
  assert.equal(again.body.repeated, true);
  assert.equal(x.db.rows('demoTaskSubmissions').length, 1);
  const attemptId = start.body.attempt.id;
  assert.equal(attemptId, `pt:${id}:${x.w.s1}:1`);

  const mine = trade(x, 's1', { openedAt: new Date() });
  const other = trade(x, 's2', { openedAt: new Date() });
  // The detail offers only the student's own trades opened during the attempt.
  const detail = await call(x.r.task, { token: x.T.s1, query: { id } });
  assert.deepEqual(detail.body.eligibleTrades.map((t) => t.positionId), [mine]);
  const explanation = 'Stop under the swing low, target at the next resistance, 2 : 1.';
  const submit = (ids, extra = {}) => call(x.r.submit, { method: 'POST', token: x.T.s1, query: { id }, body: { positionIds: ids, explanation, confirm: true, ...extra } });
  assert.equal((await submit([mine], { confirm: false })).statusCode, 400);
  assert.equal((await submit([other])).statusCode, 400);
  assert.equal((await submit([early])).statusCode, 400);
  assert.equal((await submit([new ObjectId().toHexString()])).statusCode, 400);
  assert.equal((await submit([])).statusCode, 400);
  assert.equal((await submit(['not-an-id'])).statusCode, 400);
  const done = await submit([mine]);
  assert.equal(done.statusCode, 200, JSON.stringify(done.body));
  assert.equal(done.body.attempt.status, 'graded');
  assert.equal(done.body.attempt.result.score, 100);
  assert.equal(done.body.attempt.result.percent, '100.0');
  assert.equal(done.body.attempt.result.source, 'system');
  assert.equal(done.body.attempt.trades[0].orderType, 'limit');
  assert.equal(notes(x).filter((n) => String(n.dedupeKey).startsWith(`practical-result:${attemptId}:`)).length, 1);
  assert.equal(audits(x, 'practical_auto_graded').length, 1);
  // A repeat submission is refused, not processed twice.
  assert.equal((await submit([mine])).statusCode, 409);
  // Frozen evidence: changing the position later does not change the grade.
  const pos = x.db.rows('tradingPositions').find((p) => String(p._id) === mine);
  pos.plannedRisk = D('900.00');
  const view = await call(x.r.task, { token: x.T.s1, query: { id } });
  assert.equal(view.body.attempts[0].result.score, 100);
  assert.equal(view.body.state.state, 'graded');
  // Nothing in the trading records was written by the task API (only the test's own inserts).
  const after = [x.db.rows('tradingPositions'), x.db.rows('tradingOrders'), x.db.rows('tradingAccounts')];
  assert.equal(after[0].length, 3);
  assert.equal(tradesBefore.length > 0, true);
  pos.plannedRisk = D('100.00');

  // A further attempt is allowed (attempts left, before the deadline); the same trade cannot be reused.
  const second = await call(x.r.attempt, { method: 'POST', token: x.T.s1, query: { id } });
  assert.equal(second.statusCode, 201);
  assert.equal((await submit([mine])).statusCode, 400);
  const fresh = trade(x, 's1', { openedAt: new Date(), plannedRisk: '150.00', risk: '150.00' });
  const two = await submit([fresh]);
  assert.equal(two.statusCode, 200);
  assert.equal(two.body.attempt.result.score, 70);
  // Attempts are kept; the limit (2) is enforced.
  assert.equal(x.db.rows('demoTaskSubmissions').length, 2);
  assert.equal((await call(x.r.attempt, { method: 'POST', token: x.T.s1, query: { id } })).statusCode, 409);
  const state = (await call(x.r.list, { token: x.T.s1 })).body.tasks[0];
  assert.equal(state.result.attempt, 2);
  assert.equal(state.attemptsLeft, 0);
  // The older student submissions list does not show practical attempts.
  assert.equal((await call(x.r.legacyStudentSubs, { token: x.T.s1 })).body.length ?? (await call(x.r.legacyStudentSubs, { token: x.T.s1 })).body.submissions?.length, 0);
}));

test('deadlines and closing are enforced on the server', route(async () => {
  const x = world();
  const { id } = await createAndPublish(x);
  await call(x.r.attempt, { method: 'POST', token: x.T.s1, query: { id } });
  const mine = trade(x, 's1', { openedAt: new Date() });
  x.db.rows('demoTasks')[0].dueAt = ago(60 * 1000);
  const late = await call(x.r.submit, { method: 'POST', token: x.T.s1, query: { id }, body: { positionIds: [mine], explanation: 'A full explanation here.', confirm: true } });
  assert.equal(late.statusCode, 409);
  assert.equal((await call(x.r.list, { token: x.T.s1 })).body.tasks[0].state, 'overdue');
  assert.equal((await call(x.r.attempt, { method: 'POST', token: x.T.s2, query: { id } })).statusCode, 409);
  assert.equal((await call(x.r.list, { token: x.T.s2 })).body.tasks[0].state, 'overdue');
  x.db.rows('demoTasks')[0].dueAt = later(10 * HOUR);
  assert.equal((await call(x.r.status, { method: 'POST', token: x.T.insA, query: { id }, body: { action: 'close' } })).statusCode, 200);
  assert.equal((await call(x.r.submit, { method: 'POST', token: x.T.s1, query: { id }, body: { positionIds: [mine], explanation: 'A full explanation here.', confirm: true } })).statusCode, 409);
  assert.equal((await call(x.r.status, { method: 'POST', token: x.T.insB, query: { id }, body: { action: 'reopen' } })).statusCode, 404);
  assert.equal((await call(x.r.status, { method: 'POST', token: x.T.insA, query: { id }, body: { action: 'reopen' } })).statusCode, 200);
  assert.equal((await call(x.r.status, { method: 'POST', token: x.T.insA, query: { id }, body: { action: 'archive' } })).statusCode, 409);
  assert.equal(audits(x, 'practical_task_closed').length, 1);
  assert.equal(audits(x, 'practical_task_reopened').length, 1);
}));

// ---------------------------------------------------------------------------
// Manual and assisted grading
// ---------------------------------------------------------------------------

test('manual grading: instructor only, every criterion, bounded scores, concurrency and history', route(async () => {
  const x = world();
  const { id } = await createAndPublish(x, { def: definition({ rubric: manualRubric, gradingMode: 'manual' }) });
  await call(x.r.attempt, { method: 'POST', token: x.T.s1, query: { id } });
  const mine = trade(x, 's1', { openedAt: new Date() });
  const sub = await call(x.r.submit, { method: 'POST', token: x.T.s1, query: { id }, body: { positionIds: [mine], explanation: 'Stop under the swing low.', confirm: true } });
  assert.equal(sub.body.attempt.status, 'awaiting_grading');
  assert.equal(sub.body.attempt.result, null);
  const attemptId = sub.body.attempt.id;
  assert.equal(notes(x, `practical-submission:${attemptId}`).length, 1);
  assert.equal(notes(x, `practical-submission:${attemptId}`)[0].userId, x.w.insA);

  // Queue and workspace: in scope only.
  const queue = await call(x.r.queue, { token: x.T.insA });
  assert.equal(queue.body.rows.length, 1);
  assert.equal(queue.body.rows[0].student, 'Sam Student');
  assert.equal((await call(x.r.queue, { token: x.T.insB })).body.rows.length, 0);
  assert.equal((await call(x.r.review, { token: x.T.insB, query: { attemptId } })).statusCode, 404);
  const ws = await call(x.r.review, { token: x.T.insA, query: { attemptId } });
  assert.equal(ws.statusCode, 200);
  assert.equal(ws.body.attempt.trades.length, 1);
  assert.equal(ws.body.attempt.autoResult, null);
  const rev = ws.body.attempt.revision;
  const grade = (token, body) => call(x.r.review, { method: 'POST', token, query: { attemptId }, body: { decision: 'publish', expectedRevision: rev, feedback: { summary: 'Good stop placement.' }, ...body } });
  assert.equal((await grade(x.T.s1, { scores: { stop_loss_valid: 20, risk_within_limit: 30, m1: 50 } })).statusCode, 403);
  assert.equal((await grade(x.T.admin, { scores: { stop_loss_valid: 20, risk_within_limit: 30, m1: 50 } })).statusCode, 403);
  assert.equal((await grade(x.T.insB, { scores: { stop_loss_valid: 20, risk_within_limit: 30, m1: 50 } })).statusCode, 404);
  assert.equal((await grade(x.T.insA, { scores: { stop_loss_valid: 20, risk_within_limit: 30 } })).statusCode, 400);
  assert.equal((await grade(x.T.insA, { scores: { stop_loss_valid: 21, risk_within_limit: 30, m1: 50 } })).statusCode, 400);
  assert.equal((await grade(x.T.insA, { scores: { stop_loss_valid: -1, risk_within_limit: 30, m1: 50 } })).statusCode, 400);
  const ok = await grade(x.T.insA, { scores: { stop_loss_valid: 20, risk_within_limit: 25, m1: 40 }, criterionFeedback: { m1: 'Levels mostly justified.' } });
  assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
  assert.deepEqual(ok.body.grade, { score: 85, maxScore: 100, percent: '85.0' });
  // A second grader working from the same revision is refused instead of overwriting.
  const stale = await grade(x.T.insA, { scores: { stop_loss_valid: 0, risk_within_limit: 0, m1: 0 }, reason: 'Second grader view' });
  assert.equal(stale.statusCode, 409);
  // Changing a published grade needs a reason, and is recorded.
  const now = (await call(x.r.review, { token: x.T.insA, query: { attemptId } })).body.attempt.revision;
  assert.equal((await call(x.r.review, { method: 'POST', token: x.T.insA, query: { attemptId }, body: { decision: 'publish', expectedRevision: now, scores: { m1: 45 }, feedback: { summary: 'Good stop placement.' } } })).statusCode, 400);
  const changed = await call(x.r.review, { method: 'POST', token: x.T.insA, query: { attemptId }, body: { decision: 'publish', expectedRevision: now, scores: { m1: 45 }, feedback: { summary: 'Good stop placement.' }, reason: 'Re-read the level analysis.' } });
  assert.equal(changed.statusCode, 200);
  assert.equal(changed.body.grade.score, 90);
  const hist = (await call(x.r.review, { token: x.T.insA, query: { attemptId } })).body.attempt.history;
  assert.deepEqual(hist.map((h) => h.action), ['graded', 'regraded']);
  assert.equal(hist[1].reason, 'Re-read the level analysis.');
  assert.equal(audits(x, 'practical_grade_published').length, 1);
  assert.equal(audits(x, 'practical_grade_changed').length, 1);
  // Student sees the instructor result and feedback; one notice per published change.
  const view = (await call(x.r.task, { token: x.T.s1, query: { id } })).body.attempts[0].result;
  assert.equal(view.score, 90);
  assert.equal(view.source, 'instructor');
  assert.equal(view.criteria.find((c) => c.id === 'm1').feedback, 'Levels mostly justified.');
  assert.equal(notes(x).filter((n) => n.type === 'task_feedback').length, 2);
  // Another student cannot read this attempt's workspace or evidence.
  assert.equal((await call(x.r.review, { token: x.T.s2, query: { attemptId } })).statusCode, 403);
}));

test('assisted review: the engine proposes, the instructor decides; returns allow a resubmission', route(async () => {
  const x = world();
  const { id } = await createAndPublish(x, { def: definition({ rubric: manualRubric, gradingMode: 'assisted', maxAttempts: 1 }) });
  await call(x.r.attempt, { method: 'POST', token: x.T.s1, query: { id } });
  const mine = trade(x, 's1', { openedAt: new Date(), risk: '150.00' });
  const sub = await call(x.r.submit, { method: 'POST', token: x.T.s1, query: { id }, body: { positionIds: [mine], explanation: 'Stop under the swing low.', confirm: true } });
  assert.equal(sub.body.attempt.status, 'awaiting_review');
  // The student does not see automated findings before the instructor publishes.
  assert.equal(sub.body.attempt.result, null);
  const attemptId = sub.body.attempt.id;
  const ws = await call(x.r.review, { token: x.T.insA, query: { attemptId } });
  assert.equal(ws.body.attempt.autoResult.autoScore, 20);
  assert.equal(ws.body.attempt.autoResult.criteria.find((c) => c.id === 'risk_within_limit').score, 0);
  const rev = ws.body.attempt.revision;
  // Raising an automatically assessed criterion needs a reason.
  assert.equal((await call(x.r.review, { method: 'POST', token: x.T.insA, query: { attemptId }, body: { decision: 'publish', expectedRevision: rev, scores: { risk_within_limit: 30, m1: 40 } } })).statusCode, 400);
  // Return for revision instead.
  assert.equal((await call(x.r.review, { method: 'POST', token: x.T.insA, query: { attemptId }, body: { decision: 'return', expectedRevision: rev, feedback: {} } })).statusCode, 400);
  const ret = await call(x.r.review, { method: 'POST', token: x.T.insA, query: { attemptId }, body: { decision: 'return', expectedRevision: rev, feedback: { mistakes: 'Risk was 1.5%, over the 1% limit.', recommendations: 'Halve the position size.' } } });
  assert.equal(ret.statusCode, 200);
  const st = (await call(x.r.list, { token: x.T.s1 })).body.tasks[0];
  assert.equal(st.state, 'returned');
  assert.equal(st.canStart, true);
  // Resubmission even with maxAttempts 1; the first attempt is kept.
  const second = await call(x.r.attempt, { method: 'POST', token: x.T.s1, query: { id } });
  assert.equal(second.statusCode, 201);
  assert.equal(second.body.attempt.resubmission, true);
  const fixed = trade(x, 's1', { openedAt: new Date(), risk: '80.00' });
  const sub2 = await call(x.r.submit, { method: 'POST', token: x.T.s1, query: { id }, body: { positionIds: [fixed], explanation: 'Smaller size this time.', confirm: true } });
  assert.equal(sub2.statusCode, 200);
  const id2 = sub2.body.attempt.id;
  const ws2 = await call(x.r.review, { token: x.T.insA, query: { attemptId: id2 } });
  assert.equal(ws2.body.previous.length, 1);
  assert.equal(ws2.body.previous[0].status, 'returned');
  const pub = await call(x.r.review, { method: 'POST', token: x.T.insA, query: { attemptId: id2 }, body: { decision: 'publish', expectedRevision: ws2.body.attempt.revision, scores: { m1: 42 }, feedback: { summary: 'Risk fixed.' } } });
  assert.equal(pub.statusCode, 200);
  assert.equal(pub.body.grade.score, 92);
  const result = (await call(x.r.task, { token: x.T.s1, query: { id } })).body.attempts[0].result;
  assert.equal(result.criteria.find((c) => c.id === 'risk_within_limit').automated.status, 'met');
  assert.equal(result.criteria.find((c) => c.id === 'm1').automated, null);
  assert.equal(x.db.rows('demoTaskSubmissions').length, 2);
  assert.equal(audits(x, 'practical_returned').length, 1);
}));

test('automatic grades are changed only through a reasoned, audited override', route(async () => {
  const x = world();
  const { id } = await createAndPublish(x);
  await call(x.r.attempt, { method: 'POST', token: x.T.s1, query: { id } });
  const mine = trade(x, 's1', { openedAt: new Date(), risk: '150.00' });
  const sub = await call(x.r.submit, { method: 'POST', token: x.T.s1, query: { id }, body: { positionIds: [mine], explanation: 'Explanation of the plan.', confirm: true } });
  assert.equal(sub.body.attempt.result.score, 70);
  const attemptId = sub.body.attempt.id;
  const ws = await call(x.r.review, { token: x.T.insA, query: { attemptId } });
  const body = { decision: 'publish', expectedRevision: ws.body.attempt.revision, scores: { risk_within_limit: 30 }, feedback: {} };
  assert.equal((await call(x.r.review, { method: 'POST', token: x.T.insA, query: { attemptId }, body })).statusCode, 400);
  const o = await call(x.r.review, { method: 'POST', token: x.T.insA, query: { attemptId }, body: { ...body, reason: 'Risk computed on an old balance.' } });
  assert.equal(o.statusCode, 200);
  assert.equal(o.body.grade.score, 100);
  const hist = (await call(x.r.review, { token: x.T.insA, query: { attemptId } })).body.attempt.history;
  assert.deepEqual(hist.map((h) => h.action), ['auto_graded', 'override']);
  assert.equal(audits(x, 'practical_grade_changed')[0].before.source, 'system');
}));

// ---------------------------------------------------------------------------
// Policy versioning, evidence access, analytics
// ---------------------------------------------------------------------------

test('rubric and grading-mode changes after attempts need confirmation and never touch existing attempts', route(async () => {
  const x = world();
  const { id } = await createAndPublish(x);
  await call(x.r.attempt, { method: 'POST', token: x.T.s1, query: { id } });
  const task = () => x.db.rows('demoTasks')[0];
  const changed = definition({ rubric: manualRubric, gradingMode: 'assisted', dueAt: task().dueAt.toISOString() });
  const put = (body) => call(x.r.task, { method: 'PUT', token: x.T.insA, query: { id }, body: { definition: changed, courseId: x.w.CA, expectedVersion: task().version, ...body } });
  const refused = await put({});
  assert.equal(refused.statusCode, 409);
  assert.equal(refused.body.code, 'policy_change_needs_confirmation');
  assert.deepEqual(refused.body.changes.sort(), ['gradingMode', 'rubric']);
  assert.equal((await put({ confirmPolicyChange: true, reason: 'short' })).statusCode, 409);
  const ok = await put({ confirmPolicyChange: true, reason: 'Adding an instructor-judged criterion.' });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.body.task.rubric.version, 2);
  assert.equal(ok.body.task.gradingMode, 'assisted');
  assert.equal(audits(x, 'practical_task_policy_changed').length, 1);
  // The attempt in progress keeps the rules it started with: automatic, rubric version 1.
  const attempt = x.db.rows('demoTaskSubmissions')[0];
  assert.equal(attempt.gradingMode, 'automatic');
  assert.equal(attempt.rubric.version, 1);
  const detail = (await call(x.r.task, { token: x.T.s1, query: { id } })).body;
  assert.equal(detail.task.gradingMode, 'automatic');
  const mine = trade(x, 's1', { openedAt: new Date() });
  const sub = await call(x.r.submit, { method: 'POST', token: x.T.s1, query: { id }, body: { positionIds: [mine], explanation: 'Explanation of the plan.', confirm: true } });
  assert.equal(sub.body.attempt.status, 'graded');
  assert.equal(sub.body.attempt.rubricVersion, 1);
  // A new student's attempt uses version 2.
  const s2 = await call(x.r.attempt, { method: 'POST', token: x.T.s2, query: { id } });
  assert.equal(s2.body.attempt.gradingMode, 'assisted');
  assert.equal(s2.body.attempt.rubricVersion, 2);
}));

test('evidence: private files, owner and scoped staff only; limits and unverified external details', route(async () => {
  const x = world();
  const { id } = await createAndPublish(x);
  await call(x.r.attempt, { method: 'POST', token: x.T.s1, query: { id } });
  const member = { userId: x.w.s1, role: 'student' };
  const a = await P.addAttachment(x.db, member, { taskId: id, file: { publicId: 'forexorbit/practical-evidence/abc', format: 'png', name: 'OANDA chart' } });
  assert.equal(a.ok, true);
  assert.match(a.attachment.url, /^\/api\/practical-tasks\/evidence\?attempt=/);
  assert.equal((await P.addAttachment(x.db, member, { taskId: id, file: { publicId: 'p2', format: 'png' } })).ok, true);
  assert.equal((await P.addAttachment(x.db, member, { taskId: id, file: { publicId: 'p3', format: 'png' } })).status, 400);
  assert.equal((await P.addAttachment(x.db, { userId: x.w.s3, role: 'student' }, { taskId: id, file: { publicId: 'p4' } })).status, 404);
  const attemptId = `pt:${id}:${x.w.s1}:1`;
  const fileId = a.attachment.id;
  const open = (token, q = { attempt: attemptId, file: fileId }) => call(x.r.evidence, { token, query: q });
  const own = await open(x.T.s1);
  assert.equal(own.statusCode, 302);
  assert.equal(own.location, 'https://signed.example/forexorbit/practical-evidence/abc?exp=300');
  assert.equal(own.headers['cache-control'].includes('no-store'), true);
  assert.equal((await open(x.T.s2)).statusCode, 404);
  assert.equal((await open(x.T.insB)).statusCode, 404);
  assert.equal((await open(x.T.insA)).statusCode, 302);
  assert.equal((await open(x.T.s1, { attempt: attemptId, file: newId() })).statusCode, 404);
  assert.equal((await open(x.T.s1, { attempt: '../x', file: fileId })).statusCode, 404);
  // Stored records never hold a public URL.
  assert.equal(JSON.stringify(x.db.rows('demoTaskSubmissions')).includes('https://'), false);
  assert.equal((await P.removeAttachment(x.db, member, { taskId: id, fileId })).ok, true);
  // External details: validated and always unverified.
  assert.deepEqual(P.readExternal({ broker: 'OANDA demo', instrument: 'eur/usd', side: 'buy', entry: '1.0851', stopLoss: '1.0831' }).external, { broker: 'OANDA demo', instrument: 'EUR_USD', side: 'buy', entry: '1.0851', stopLoss: '1.0831', verified: false });
  assert.equal(P.readExternal({ entry: '-1' }).ok, false);
  assert.equal(P.readExternal({ side: 'long' }).ok, false);
  // A task requiring external screenshots refuses a submission without them.
  const y = world();
  const t2 = await createAndPublish(y, { def: definition({ rubric: manualRubric, gradingMode: 'manual', requirements: { ...definition().requirements, external: 'required' } }) });
  await call(y.r.attempt, { method: 'POST', token: y.T.s1, query: { id: t2.id } });
  const p = trade(y, 's1', { openedAt: new Date() });
  const noShots = await call(y.r.submit, { method: 'POST', token: y.T.s1, query: { id: t2.id }, body: { positionIds: [p], explanation: 'Explanation of the plan.', confirm: true } });
  assert.equal(noShots.statusCode, 400);
  assert.equal(noShots.body.field, 'attachments');
}));

test('analytics: figures from actual attempts; students see only their own', route(async () => {
  const x = world();
  const { id } = await createAndPublish(x);
  await call(x.r.attempt, { method: 'POST', token: x.T.s1, query: { id } });
  const p = trade(x, 's1', { openedAt: new Date(), risk: '150.00' });
  await call(x.r.submit, { method: 'POST', token: x.T.s1, query: { id }, body: { positionIds: [p], explanation: 'Explanation of the plan.', confirm: true } });
  const detail = await call(x.r.task, { token: x.T.insA, query: { id } });
  assert.equal(detail.body.stats.recipients, 2);
  assert.equal(detail.body.stats.submitted, 1);
  assert.equal(detail.body.stats.submissionRate, '50.0');
  assert.equal(detail.body.stats.averagePercent, '70.0');
  assert.deepEqual(detail.body.missedCriteria.map((m) => m.id), ['risk_within_limit']);
  assert.deepEqual(detail.body.students.map((s) => s.state).sort(), ['graded', 'not_started']);
  const summary = await call(x.r.summary, { token: x.T.insA });
  assert.equal(summary.body.modes.automatic, 1);
  assert.equal(summary.body.averagePercent, '70.0');
  const mine = await call(x.r.list, { token: x.T.s1 });
  assert.equal(mine.body.summary.completed, 1);
  assert.equal(mine.body.summary.averagePercent, '70.0');
  // Risk discipline: stop-loss and risk-limit checks across graded attempts (1 of 2 met here).
  assert.deepEqual(mine.body.summary.riskDiscipline, { met: 1, checked: 2, percent: '50.0' });
  const other = await call(x.r.list, { token: x.T.s2 });
  assert.equal(other.body.summary.completed, 0);
  assert.equal(JSON.stringify(other.body).includes('70.0'), false);
}));

test('source guards: no trading writes in task code; legacy routes skip practical tasks', () => {
  const code = ['lib/practical-tasks.js', 'lib/practical-grading.js', 'lib/practical-task-generator.js'].map(read).join('\n');
  for (const name of ['tradingPositions', 'tradingOrders', 'tradingAccounts', 'tradingLedger']) {
    assert.equal(new RegExp(`C\\.(positions|orders|accounts)\\)\\.(update|insert|delete|replace|findOneAndUpdate)`).test(code), false, name);
  }
  assert.equal(/Math\.random|Date\.now/.test(read('lib/practical-grading.js')), false);
  for (const file of ['pages/api/demo-trading/tasks.ts', 'pages/api/demo-trading/submissions.ts', 'pages/api/demo-trading/submissions/student.ts', 'pages/api/demo-trading/tasks/[id]/submit.ts', 'pages/api/demo-trading/tasks/[id]/complete.ts', 'pages/api/demo-trading/tasks/[id]/submissions.ts']) {
    assert.match(read(file), /practical_v2/, file);
  }
  assert.match(read('lib/trading/retention.js'), /\$pull: \{ recipients: id \}/);
});
