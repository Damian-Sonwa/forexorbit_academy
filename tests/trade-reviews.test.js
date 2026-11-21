/**
 * Trade reviews (the practice desk journal) and the order-ticket plan note.
 *
 * Uses the in-memory stand-in (tests/helpers/memory-db.js), not a real MongoDB: these cover the
 * rules (ownership, closed trades only, one review per trade, server-recorded figures, task linking,
 * deletion) and the source contracts, not driver or index behaviour.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Decimal128, ObjectId } = require('mongodb');

const { memoryDb } = require('./helpers/memory-db');
const R = require('../lib/trading/reviews');
const { readPlanNote, NOTE_MAX } = require('../lib/trading/plan-note');
const E = require('../lib/trading/engine');
const { anonymiseStudentTrading } = require('../lib/trading/retention');
const role = require('../lib/app-database-role');
const { TRADING_INDEXES } = require('../lib/trading/indexes');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const D = (text) => Decimal128.fromString(text);
const student = new ObjectId().toHexString();
const other = new ObjectId().toHexString();
const instructor = new ObjectId().toHexString();
const otherInstructor = new ObjectId().toHexString();

function position({ userId = student, status = 'closed', realizedPl = '2.00', closedAt = new Date('2026-11-02T10:00:00Z'), orderId = new ObjectId(), closeReason = 'manual' } = {}) {
  return {
    _id: new ObjectId(),
    accountId: new ObjectId(),
    userId,
    orderId,
    instrument: 'EUR_USD',
    side: 'buy',
    units: 1000,
    entry: D('1.11102'),
    stopLoss: D('1.10702'),
    takeProfit: null,
    margin: D('37.03'),
    plannedRisk: D('4.00'),
    status,
    openedAt: new Date('2026-11-02T09:00:00Z'),
    ...(status === 'closed' ? { exit: D('1.11302'), realizedPl: D(realizedPl), closeReason, closedAt } : {}),
  };
}

const goodReview = (extra = {}) => ({ setup: 'breakout', followedPlan: 'yes', confidence: 4, emotion: 'calm', reason: 'Broke the Asian range high with momentum.', lesson: 'Wait for the retest next time.', ...extra });

function world() {
  const closed = position();
  const open = position({ status: 'open' });
  const loss = position({ realizedPl: '-4.00', closeReason: 'stop_loss', closedAt: new Date('2026-11-03T10:00:00Z') });
  const theirs = position({ userId: other });
  const task = { _id: new ObjectId(), title: 'Trade a breakout', assignedBy: instructor, assignedTo: student };
  const elsewhere = { _id: new ObjectId(), title: 'Someone else', assignedBy: instructor, assignedTo: other };
  const db = memoryDb({
    tradingPositions: [closed, open, loss, theirs],
    tradingOrders: [{ _id: closed.orderId, userId: student, planNote: 'Range breakout; wrong below 1.1070.' }],
    demoTasks: [task, elsewhere],
    users: [{ _id: new ObjectId(student), name: 'Ada Student' }],
  });
  return { db, closed, open, loss, theirs, task, elsewhere };
}

// ---------------------------------------------------------------------------
// The plan note
// ---------------------------------------------------------------------------

test('plan note: optional, trimmed, control characters removed, at most 500 characters', () => {
  assert.deepEqual(readPlanNote(undefined), { ok: true, note: '' });
  assert.deepEqual(readPlanNote('  Breakout \u0007 setup  '), { ok: true, note: 'Breakout  setup' });
  assert.equal(readPlanNote('x'.repeat(NOTE_MAX)).ok, true);
  assert.equal(readPlanNote('x'.repeat(NOTE_MAX + 1)).ok, false);
  assert.equal(readPlanNote(42).ok, false);
});

test('plan note: the order reader carries it, refuses a long one, and it is not part of the order identity', () => {
  const body = { clientOrderId: 'order-note-123456', type: 'market', instrument: 'EUR_USD', side: 'buy', units: '1000', stopLoss: '1.10000' };
  assert.equal(E.readOrderInput({ ...body, note: '  Why I trade  ' }).planNote, 'Why I trade');
  assert.equal(E.readOrderInput(body).planNote, '');
  const long = E.readOrderInput({ ...body, note: 'x'.repeat(501) });
  assert.deepEqual([long.ok, long.status, long.code], [false, 400, 'invalid_order']);
  const engine = read('lib/trading/engine.js');
  const fingerprint = engine.match(/const fingerprintOf = [^\n]+/)[0];
  assert.ok(!/note/i.test(fingerprint), 'the note does not change an order\'s fingerprint');
  assert.match(engine, /\.\.\.\(input\.planNote \? \{ planNote: input\.planNote \} : \{\}\)/, 'stored only when written');
});

test('plan note: the ticket sends it only when written, and the risk preview ignores it', () => {
  const ui = read('components/TradingInterface.tsx');
  assert.match(ui, /\.\.\.\(form\.note\.trim\(\) \? \{ note: form\.note\.trim\(\) \} : \{\}\)/);
  assert.match(ui, /data-testid="order-plan-note"/);
  const previewDeps = ui.match(/\}, \[form\.type, form\.instrument, form\.side, form\.units, form\.stopLoss, form\.takeProfit, form\.price\]\);/);
  assert.ok(previewDeps, 'the preview effect does not depend on the note');
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

test('review input: setup, plan, confidence, reason and lesson are required; the rest is checked', () => {
  assert.equal(R.readReviewInput(goodReview()).ok, true);
  const field = (body) => R.readReviewInput(body).field;
  assert.equal(field(goodReview({ setup: 'guess' })), 'setup');
  assert.equal(field(goodReview({ followedPlan: 'maybe' })), 'followedPlan');
  assert.equal(field(goodReview({ confidence: 0 })), 'confidence');
  assert.equal(field(goodReview({ confidence: 2.5 })), 'confidence');
  assert.equal(field(goodReview({ emotion: 'euphoric' })), 'emotion');
  assert.equal(field(goodReview({ reason: '   ' })), 'reason');
  assert.equal(field(goodReview({ lesson: 'x'.repeat(R.TEXT_MAX + 1) })), 'lesson');
  assert.equal(field(goodReview({ screenshot: 'http://insecure.example/x.png' })), 'screenshot');
  assert.equal(field(goodReview({ screenshot: 'javascript:alert(1)' })), 'screenshot');
  assert.equal(field(goodReview({ taskId: 'not-an-id' })), 'taskId');
  assert.equal(R.readReviewInput(goodReview({ emotion: '' })).fields.emotion, null);
  assert.equal(R.readReviewInput(null).ok, false);
});

test('review input: trade figures in the body are ignored', () => {
  const { fields } = R.readReviewInput(goodReview({ realizedPl: '9999.00', entry: '1.00000', instrument: 'GBP_USD' }));
  assert.deepEqual(Object.keys(fields).sort(), ['confidence', 'emotion', 'followedPlan', 'lesson', 'reason', 'screenshot', 'setup', 'taskId']);
});

// ---------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------

test('save: only the owner\'s closed trades can be reviewed', async () => {
  const { db, open, theirs } = world();
  assert.equal((await R.saveReview(db, { userId: student, positionId: String(theirs._id), body: goodReview() })).status, 404, 'another student\'s trade');
  assert.equal((await R.saveReview(db, { userId: student, positionId: String(open._id), body: goodReview() })).status, 409, 'an open trade');
  assert.equal((await R.saveReview(db, { userId: student, positionId: 'nope', body: goodReview() })).status, 404);
  assert.equal((await R.saveReview(db, { userId: student, positionId: new ObjectId().toHexString(), body: goodReview() })).status, 404);
  assert.equal(db.collection('tradingReviews').docs.length, 0);
});

test('save: one review per trade; saving again updates it; the figures are the simulator\'s', async () => {
  const { db, closed } = world();
  const first = await R.saveReview(db, { userId: student, positionId: String(closed._id), body: goodReview({ realizedPl: '9999.00' }) });
  assert.equal(first.ok, true);
  assert.equal(first.created, true);
  assert.equal(first.changedText, true);
  assert.deepEqual([first.trade.entry, first.trade.exit, first.trade.realizedPl, first.trade.closeReason], ['1.11102', '1.11302', '2.00', 'manual']);
  assert.equal(first.trade.planNote, 'Range breakout; wrong below 1.1070.');
  assert.equal(first.review.id, `review:${closed._id}`);
  const createdAt = first.review.createdAt;

  const second = await R.saveReview(db, { userId: student, positionId: String(closed._id), body: goodReview({ confidence: 2 }) });
  assert.equal(second.created, false);
  assert.equal(second.changedText, false, 'same reason and lesson: no new AI feedback');
  assert.equal(second.review.confidence, 2);
  const docs = db.collection('tradingReviews').docs;
  assert.equal(docs.length, 1);
  assert.equal(docs[0].userId, student);
  assert.equal(String(docs[0].positionId), String(closed._id));
  assert.equal(second.review.createdAt, createdAt, 'an update keeps the first save time');
  assert.ok(!('realizedPl' in docs[0]) && !('entry' in docs[0]), 'no trade figures are stored on the review');
  // Nothing about the trade itself changes.
  const after = db.collection('tradingPositions').docs.find((p) => String(p._id) === String(closed._id));
  assert.equal(String(after.realizedPl), '2.00');
  assert.equal(after.status, 'closed');
});

test('save: a task link must be a task assigned to the student, and records its instructor', async () => {
  const { db, closed, task, elsewhere } = world();
  const refused = await R.saveReview(db, { userId: student, positionId: String(closed._id), body: goodReview({ taskId: String(elsewhere._id) }) });
  assert.deepEqual([refused.ok, refused.status, refused.field], [false, 404, 'taskId']);
  const linked = await R.saveReview(db, { userId: student, positionId: String(closed._id), body: goodReview({ taskId: String(task._id) }) });
  assert.equal(linked.review.taskId, String(task._id));
  assert.equal(db.collection('tradingReviews').docs[0].instructorId, instructor);
  const unlinked = await R.saveReview(db, { userId: student, positionId: String(closed._id), body: goodReview() });
  assert.equal(unlinked.review.taskId, null);
  assert.equal(db.collection('tradingReviews').docs[0].instructorId, null, 'unlinking removes the instructor\'s view');
});

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

test('list: closed trades only, newest first, with pending and reviewed counts and filters', async () => {
  const { db, closed, loss } = world();
  let all = await R.listReviews(db, { userId: student });
  assert.deepEqual(all.rows.map((r) => r.trade.positionId).sort(), [String(closed._id), String(loss._id)].sort(), 'no open trade, no other student');
  assert.deepEqual(all.counts, { reviewed: 0, pending: 2 });

  await R.saveReview(db, { userId: student, positionId: String(closed._id), body: goodReview() });
  all = await R.listReviews(db, { userId: student });
  assert.deepEqual(all.counts, { reviewed: 1, pending: 1 });
  const pending = await R.listReviews(db, { userId: student, status: 'pending' });
  assert.deepEqual(pending.rows.map((r) => r.trade.positionId), [String(loss._id)]);
  assert.equal(pending.rows[0].review, null);
  const reviewed = await R.listReviews(db, { userId: student, status: 'reviewed' });
  assert.deepEqual(reviewed.rows.map((r) => r.trade.positionId), [String(closed._id)]);
  assert.equal(reviewed.rows[0].review.setup, 'breakout');
  assert.equal(reviewed.rows[0].trade.planNote, 'Range breakout; wrong below 1.1070.');

  const paged = await R.listReviews(db, { userId: student, page: 2, limit: 1 });
  assert.deepEqual([paged.rows.length, paged.pagination.pages, paged.pagination.total], [1, 2, 2]);
  assert.equal((await R.listReviews(db, { userId: other })).rows.length, 1, 'the other student sees only their own');
});

test('instructor view: an instructor sees reviews linked to their tasks; admins see every linked review', async () => {
  const { db, closed, loss, task } = world();
  await R.saveReview(db, { userId: student, positionId: String(closed._id), body: goodReview({ taskId: String(task._id) }) });
  await R.saveReview(db, { userId: student, positionId: String(loss._id), body: goodReview() });
  const mine = await R.instructorReviews(db, { viewerId: instructor, role: 'instructor' });
  assert.equal(mine.rows.length, 1);
  assert.deepEqual([mine.rows[0].student, mine.rows[0].task, mine.rows[0].trade.realizedPl], ['Ada Student', 'Trade a breakout', '2.00']);
  assert.equal((await R.instructorReviews(db, { viewerId: otherInstructor, role: 'instructor' })).rows.length, 0);
  assert.equal((await R.instructorReviews(db, { viewerId: 'admin', role: 'admin' })).rows.length, 1, 'unlinked reviews stay private');
});

test('practice summary: results from the simulator\'s closed trades, plus review habits', async () => {
  const { db, closed } = world();
  await R.saveReview(db, { userId: student, positionId: String(closed._id), body: goodReview() });
  const s = await R.practiceSummary(db, student);
  assert.deepEqual([s.totalTrades, s.winRate, s.averageProfitLoss, s.reviewedTrades, s.planFollowedRate], [2, 0.5, -1, 1, 1]);
  const none = await R.practiceSummary(db, new ObjectId().toHexString());
  assert.deepEqual([none.totalTrades, none.reviewedTrades, none.planFollowedRate], [0, 0, null]);
});

// ---------------------------------------------------------------------------
// Deletion, role, indexes, routes
// ---------------------------------------------------------------------------

test('account deletion: the student\'s reviews are deleted and plan notes removed from kept orders', async () => {
  const { db, closed } = world();
  await R.saveReview(db, { userId: student, positionId: String(closed._id), body: goodReview() });
  db.collection('tradingReviews').docs.push({ _id: 'review:other', userId: other });
  await anonymiseStudentTrading(db, student);
  assert.deepEqual(db.collection('tradingReviews').docs.map((d) => d._id), ['review:other']);
  const order = db.collection('tradingOrders').docs[0];
  assert.ok(!('planNote' in order) && !('userId' in order));
});

test('role and indexes: the app role covers tradingReviews; T19 and T20 serve the review reads', () => {
  assert.ok(role.READ_WRITE_COLLECTIONS.includes('tradingReviews'));
  const atlas = read('docs/audits/atlas/forexorbitAppRole.createRole.json');
  assert.match(atlas, /"tradingReviews"/, 'the generated Atlas role includes it');
  const byId = Object.fromEntries(TRADING_INDEXES.map((i) => [i.id, i]));
  assert.deepEqual([byId.T19.collection, byId.T19.key], ['tradingReviews', { userId: 1, positionId: 1 }]);
  assert.deepEqual([byId.T20.collection, byId.T20.key], ['tradingReviews', { instructorId: 1, updatedAt: -1 }]);
  assert.ok(!byId.T19.options.unique && !byId.T20.options.unique, 'uniqueness comes from the deterministic _id');
});

test('routes: students write their own reviews; staff read task-linked ones; the UI never sends figures', () => {
  const list = read('pages/api/trading/reviews/index.ts');
  const save = read('pages/api/trading/reviews/[positionId].ts');
  const staff = read('pages/api/trading/reviews/instructor.ts');
  assert.match(list, /studentTradingRoute\(\{\s*GET:/);
  assert.match(save, /studentTradingRoute\(\{\s*PUT:/);
  assert.match(save, /userId: req\.user!\.userId/);
  assert.match(save, /catch \{\s*console\.error/, 'AI failure never fails the save');
  assert.match(staff, /withAuth\(handler, \['instructor', 'admin', 'superadmin'\]\)/);
  assert.match(staff, /setPrivateNoStore\(res\)/);
  assert.match(staff, /req\.method !== 'GET'/);
  const ui = read('components/student/TradeReviews.tsx');
  const body = ui.match(/apiClient\.put<[^>]+>\(`\/trading\/reviews\/\$\{positionId\}`, \{([\s\S]*?)\}\);/)[1];
  for (const figure of ['entry', 'exit', 'realizedPl', 'stopLoss', 'units', 'instrument']) assert.ok(!new RegExp(`\\b${figure}\\b`).test(body), `${figure} is not sent`);
  const dashboard = read('pages/student-dashboard.tsx');
  assert.ok(!dashboard.includes("apiClient.post('/demo-trading/journal'"), 'no hand-typed journal entry from the desk');
  assert.match(dashboard, /<TradeReviews tasks=\{tasks\} legacyEntries=\{journalEntries\}/);
});

test('instructor analysis uses the simulator\'s record, not the hand-typed journal', () => {
  const source = read('pages/api/ai/instructor/analyze-student.ts');
  assert.ok(!source.includes("collection('demoTradeJournal')"));
  assert.match(source, /practiceSummary\(db, studentId\)/);
  assert.match(source, /instructorTeaches\(db, req\.user!\.userId, studentId\)/, 'the teaching check is unchanged');
});
