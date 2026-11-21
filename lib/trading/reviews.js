'use strict';

/**
 * Trade reviews (the practice desk journal). One review per closed simulator trade.
 *
 * The trade's facts (pair, side, units, entry, exit, stop-loss, take-profit, result, close reason,
 * times) are never typed by the student: they come from the server's own position record, presented
 * by lib/trading/views.js. The student adds only the reflection: setup, why they entered, whether
 * they followed the plan, confidence, emotion, the lesson and an optional chart screenshot. The note
 * written on the order ticket ("why am I taking this trade?") is shown with it.
 *
 * Identity is deterministic (`review:<positionId>`), so a student has at most one review per trade
 * and saving again updates it. Only the owner of a closed position can review it. Nothing here
 * changes an order, a position, an account or the ledger.
 */

const { ObjectId } = require('mongodb');
const { presentPosition } = require('./views');
const { taskIsFor } = require('../practice-desk');
const { NOTE_MAX, cleanText, readPlanNote } = require('./plan-note');

const COLLECTIONS = Object.freeze({
  reviews: 'tradingReviews',
  positions: 'tradingPositions',
  orders: 'tradingOrders',
  tasks: 'demoTasks',
  users: 'users',
});

const SETUPS = Object.freeze(['trend', 'breakout', 'range', 'reversal', 'news', 'other']);
const PLAN = Object.freeze(['yes', 'partly', 'no']);
const EMOTIONS = Object.freeze(['calm', 'confident', 'anxious', 'impatient', 'frustrated', 'excited']);
const TEXT_MAX = 1500;
const PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 50;

const reviewIdFor = (positionId) => `review:${String(positionId)}`;

/** Validates a reflection. Returns { ok, fields } or { ok: false, error, field }. */
function readReviewInput(body) {
  const input = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const bad = (field, error) => ({ ok: false, field, error });
  if (!SETUPS.includes(input.setup)) return bad('setup', 'Choose the setup you traded.');
  if (!PLAN.includes(input.followedPlan)) return bad('followedPlan', 'Say whether you followed your plan.');
  const confidence = Number(input.confidence);
  if (!Number.isInteger(confidence) || confidence < 1 || confidence > 5) return bad('confidence', 'Rate your confidence from 1 to 5.');
  let emotion = null;
  if (input.emotion !== undefined && input.emotion !== null && input.emotion !== '') {
    if (!EMOTIONS.includes(input.emotion)) return bad('emotion', 'Choose one of the listed emotions.');
    emotion = input.emotion;
  }
  const reason = cleanText(input.reason, TEXT_MAX);
  if (reason === null) return bad('reason', `Why you entered can be at most ${TEXT_MAX} characters.`);
  if (!reason) return bad('reason', 'Write why you entered the trade.');
  const lesson = cleanText(input.lesson, TEXT_MAX);
  if (lesson === null) return bad('lesson', `The lesson can be at most ${TEXT_MAX} characters.`);
  if (!lesson) return bad('lesson', 'Write what you learned or would do differently.');
  let screenshot = null;
  if (input.screenshot) {
    if (typeof input.screenshot !== 'string' || !/^https:\/\/\S+$/.test(input.screenshot) || input.screenshot.length > 1000) return bad('screenshot', 'The screenshot link is not valid.');
    screenshot = input.screenshot;
  }
  let taskId = null;
  if (input.taskId) {
    if (typeof input.taskId !== 'string' || !ObjectId.isValid(input.taskId) || input.taskId.length !== 24) return bad('taskId', 'That task is not valid.');
    taskId = input.taskId;
  }
  return { ok: true, fields: { setup: input.setup, followedPlan: input.followedPlan, confidence, emotion, reason, lesson, screenshot, taskId } };
}

function presentReview(doc) {
  if (!doc) return null;
  return {
    id: String(doc._id),
    setup: doc.setup,
    followedPlan: doc.followedPlan,
    confidence: doc.confidence,
    emotion: doc.emotion || null,
    reason: doc.reason,
    lesson: doc.lesson,
    screenshot: doc.screenshot || null,
    taskId: doc.taskId || null,
    aiFeedback: doc.aiFeedback || null,
    createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString() : null,
    updatedAt: doc.updatedAt ? new Date(doc.updatedAt).toISOString() : null,
  };
}

/** The trade as the server recorded it (formatted by views.js), plus the order-ticket note. */
function presentTrade(position, planNote) {
  const p = presentPosition(position, null);
  return {
    positionId: p.id,
    instrument: p.instrument,
    side: p.side,
    units: p.units,
    entry: p.entry,
    exit: p.exit,
    stopLoss: p.stopLoss,
    takeProfit: p.takeProfit,
    realizedPl: p.realizedPl,
    closeReason: p.closeReason,
    openedAt: position.openedAt ? new Date(position.openedAt).toISOString() : null,
    closedAt: p.closedAt,
    planNote: planNote || null,
  };
}

async function planNotesFor(db, positions) {
  const ids = positions.map((p) => p.orderId).filter(Boolean);
  if (!ids.length) return new Map();
  const orders = await db.collection(COLLECTIONS.orders).find({ _id: { $in: ids } }, { projection: { planNote: 1 } }).toArray();
  return new Map(orders.map((o) => [String(o._id), o.planNote || null]));
}

/**
 * The student's closed trades with their reviews. status: 'pending' (not reviewed yet), 'reviewed'
 * or 'all'. Newest first. Counts of both are always included.
 */
async function listReviews(db, { userId, status = 'all', page = 1, limit = PAGE_SIZE }) {
  const size = Math.min(MAX_PAGE_SIZE, Math.max(1, Number.isInteger(limit) ? limit : PAGE_SIZE));
  const number = Math.max(1, Number.isInteger(page) ? page : 1);
  const reviewed = await db.collection(COLLECTIONS.reviews).find({ userId }, { projection: { positionId: 1 } }).toArray();
  const reviewedIds = reviewed.map((r) => r.positionId);
  const base = { userId, status: 'closed' };
  const filter = status === 'pending' ? { ...base, _id: { $nin: reviewedIds } } : status === 'reviewed' ? { ...base, _id: { $in: reviewedIds } } : base;
  const positions = db.collection(COLLECTIONS.positions);
  const [rows, total, closedTotal] = await Promise.all([
    positions.find(filter).sort({ openedAt: -1, _id: -1 }).skip((number - 1) * size).limit(size).toArray(),
    positions.countDocuments(filter),
    positions.countDocuments(base),
  ]);
  const notes = await planNotesFor(db, rows);
  const reviews = rows.length
    ? await db.collection(COLLECTIONS.reviews).find({ _id: { $in: rows.map((p) => reviewIdFor(p._id)) } }).toArray()
    : [];
  const byId = new Map(reviews.map((r) => [r._id, r]));
  return {
    rows: rows.map((p) => ({ trade: presentTrade(p, notes.get(String(p.orderId))), review: presentReview(byId.get(reviewIdFor(p._id))) })),
    counts: { reviewed: reviewedIds.length, pending: Math.max(0, closedTotal - reviewedIds.length) },
    pagination: { page: number, limit: size, total, pages: Math.max(1, Math.ceil(total / size)) },
  };
}

/**
 * Saves the student's reflection on one of their closed trades. Returns
 * { ok, review, trade, created } or { ok: false, status, error, field? }.
 */
async function saveReview(db, { userId, positionId, body, now = new Date() }) {
  if (typeof positionId !== 'string' || !ObjectId.isValid(positionId) || positionId.length !== 24) return { ok: false, status: 404, error: 'Trade not found.' };
  const checked = readReviewInput(body);
  if (!checked.ok) return { ok: false, status: 400, error: checked.error, field: checked.field };
  const position = await db.collection(COLLECTIONS.positions).findOne({ _id: new ObjectId(positionId), userId });
  if (!position) return { ok: false, status: 404, error: 'Trade not found.' };
  if (position.status !== 'closed') return { ok: false, status: 409, error: 'Only closed trades can be reviewed.' };
  const { taskId, ...fields } = checked.fields;
  let instructorId = null;
  if (taskId) {
    const task = await db.collection(COLLECTIONS.tasks).findOne({ _id: new ObjectId(taskId) });
    if (!task || !taskIsFor(task, userId)) return { ok: false, status: 404, error: 'Task not found or not assigned to you.', field: 'taskId' };
    instructorId = task.assignedBy ? String(task.assignedBy) : null;
  }
  const _id = reviewIdFor(position._id);
  const reviews = db.collection(COLLECTIONS.reviews);
  const existing = await reviews.findOne({ _id });
  await reviews.updateOne(
    { _id },
    {
      $set: { ...fields, taskId, instructorId, updatedAt: now },
      $setOnInsert: { userId, accountId: position.accountId, positionId: position._id, createdAt: now },
    },
    { upsert: true }
  );
  const saved = await reviews.findOne({ _id });
  const notes = await planNotesFor(db, [position]);
  return { ok: true, created: !existing, review: presentReview(saved), trade: presentTrade(position, notes.get(String(position.orderId))), changedText: !existing || existing.reason !== fields.reason || existing.lesson !== fields.lesson };
}

async function setAiFeedback(db, positionId, feedback) {
  await db.collection(COLLECTIONS.reviews).updateOne({ _id: reviewIdFor(positionId) }, { $set: { aiFeedback: feedback } });
}

/**
 * Reviews linked to an instructor's tasks (admins: every task-linked review), newest first, with the
 * student's name and the trade as recorded.
 */
async function instructorReviews(db, { viewerId, role, limit = 50 }) {
  const filter = role === 'instructor' ? { instructorId: viewerId } : { taskId: { $ne: null } };
  const docs = await db.collection(COLLECTIONS.reviews).find(filter).sort({ updatedAt: -1 }).limit(Math.min(100, limit)).toArray();
  if (!docs.length) return { rows: [] };
  const [positions, users, tasks] = await Promise.all([
    db.collection(COLLECTIONS.positions).find({ _id: { $in: docs.map((d) => d.positionId) } }).toArray(),
    db.collection(COLLECTIONS.users).find({ _id: { $in: docs.map((d) => d.userId).filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id)) } }, { projection: { name: 1 } }).toArray(),
    db.collection(COLLECTIONS.tasks).find({ _id: { $in: docs.map((d) => d.taskId).filter(Boolean).map((id) => new ObjectId(id)) } }, { projection: { title: 1 } }).toArray(),
  ]);
  const posById = new Map(positions.map((p) => [String(p._id), p]));
  const notes = await planNotesFor(db, positions);
  const nameById = new Map(users.map((u) => [String(u._id), u.name || 'Student']));
  const taskById = new Map(tasks.map((t) => [String(t._id), t.title || 'Task']));
  return {
    rows: docs
      .filter((d) => posById.has(String(d.positionId)))
      .map((d) => {
        const p = posById.get(String(d.positionId));
        return { student: nameById.get(d.userId) || 'Student', task: d.taskId ? taskById.get(d.taskId) || 'Task' : null, trade: presentTrade(p, notes.get(String(p.orderId))), review: presentReview(d) };
      }),
  };
}

/**
 * A student's practice summary for the instructor's analysis: closed trades and results as the
 * simulator recorded them, plus review habits. Figures are for an AI summary, not for any record.
 */
async function practiceSummary(db, userId) {
  const closed = await db.collection(COLLECTIONS.positions).find({ userId, status: 'closed' }, { projection: { realizedPl: 1 } }).toArray();
  const results = closed.map((p) => Number(String(p.realizedPl ?? '0')) || 0);
  const wins = results.filter((r) => r > 0).length;
  const reviews = await db.collection(COLLECTIONS.reviews).find({ userId }, { projection: { followedPlan: 1 } }).toArray();
  const followed = reviews.filter((r) => r.followedPlan === 'yes').length;
  return {
    totalTrades: closed.length,
    winRate: closed.length ? wins / closed.length : 0,
    averageProfitLoss: closed.length ? results.reduce((a, b) => a + b, 0) / closed.length : 0,
    reviewedTrades: reviews.length,
    planFollowedRate: reviews.length ? followed / reviews.length : null,
  };
}

module.exports = {
  practiceSummary,
  COLLECTIONS,
  EMOTIONS,
  NOTE_MAX,
  PLAN,
  SETUPS,
  TEXT_MAX,
  instructorReviews,
  listReviews,
  presentReview,
  readPlanNote,
  readReviewInput,
  reviewIdFor,
  saveReview,
  setAiFeedback,
};
