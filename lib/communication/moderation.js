'use strict';

/**
 * Community moderation and abuse reports (Phase 14), for Q&A questions and replies.
 *
 * Reports are kept on the reported document (no new collection):
 *   reports[]       { reporterId, reason, details, at }, one per member (a second report from the
 *                   same member is refused), at most MAX_REPORTS kept
 *   reportCount     number of reports
 *   moderation      { status: 'reported' | 'hidden' | 'cleared', updatedAt, history[] }
 * Moderators (instructors, Admin, Super Admin: the existing community moderator roles) review the
 * queue and hide, restore or clear. Nothing is deleted by moderation: hidden content is kept as
 * evidence, invisible to members (lib/community-qa-store.ts), and every action is in the audit log
 * and the item's own history. Members cannot report their own content.
 */

const { ObjectId } = require('mongodb');
const { AUDIT_COLLECTION } = require('../course-payment');

const REASONS = Object.freeze({ spam: 'Spam or advertising', abuse: 'Harassment or abuse', misleading: 'Misleading trading advice or scams', off_topic: 'Off topic', other: 'Something else' });
const ACTIONS = Object.freeze(['hide', 'restore', 'clear']);
const MODERATORS = new Set(['instructor', 'admin', 'superadmin']);
const COLL = { question: 'communityQuestions', reply: 'communityReplies' };
const MAX_REPORTS = 50;
const HISTORY = 30;

const isId = (v) => typeof v === 'string' && /^[a-f0-9]{24}$/i.test(v);
const refuse = (status, error) => ({ ok: false, status, error });
const text = (v, max) => (typeof v === 'string' ? v.replace(/<[^>]*>/g, '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '');

async function report(db, member, body, { now = new Date() } = {}) {
  const b = body && typeof body === 'object' ? body : {};
  if (!member || !['student', 'instructor', 'admin', 'superadmin'].includes(member.role)) return refuse(403, 'Not authorized');
  if (!COLL[b.targetType] || !isId(b.targetId)) return refuse(400, 'Choose the post to report.');
  if (!Object.prototype.hasOwnProperty.call(REASONS, b.reason)) return refuse(400, 'Choose a reason.');
  const details = text(b.details, 500);
  if (b.reason === 'other' && details.length < 5) return refuse(400, 'Tell the moderators what is wrong.');
  const coll = db.collection(COLL[b.targetType]);
  const target = await coll.findOne({ _id: new ObjectId(b.targetId) }, { projection: { authorId: 1, reports: 1, moderation: 1 } });
  if (!target) return refuse(404, 'That post could not be found.');
  if (String(target.authorId) === String(member.userId)) return refuse(400, 'You cannot report your own post.');
  const reports = Array.isArray(target.reports) ? target.reports : [];
  if (reports.some((r) => String(r.reporterId) === String(member.userId))) return { ok: true, repeated: true };
  const status = target.moderation && target.moderation.status === 'hidden' ? 'hidden' : 'reported';
  const won = await coll.updateOne(
    { _id: target._id, 'reports.reporterId': { $ne: String(member.userId) } },
    { $set: { reports: [...reports, { reporterId: String(member.userId), reason: b.reason, details, at: now }].slice(-MAX_REPORTS), 'moderation.status': status, 'moderation.updatedAt': now, 'moderation.history': [...((target.moderation && target.moderation.history) || []), { action: 'reported', reason: b.reason, at: now }].slice(-HISTORY) }, $inc: { reportCount: 1 } }
  );
  return won.modifiedCount ? { ok: true, status: 201 } : { ok: true, repeated: true };
}

/** The moderation queue: reported and hidden items, most reported first. Moderators only. */
async function queue(db, member, { status = 'reported', limit = 50 } = {}) {
  if (!member || !MODERATORS.has(member.role)) return refuse(403, 'Only moderators can review reports.');
  const wanted = status === 'hidden' ? 'hidden' : 'reported';
  const pick = { title: 1, body: 1, content: 1, authorId: 1, questionId: 1, reportCount: 1, reports: 1, moderation: 1, createdAt: 1 };
  const [questions, replies] = await Promise.all([
    db.collection(COLL.question).find({ 'moderation.status': wanted }, { projection: pick }).sort({ reportCount: -1 }).limit(limit).toArray(),
    db.collection(COLL.reply).find({ 'moderation.status': wanted }, { projection: pick }).sort({ reportCount: -1 }).limit(limit).toArray(),
  ]);
  const authorIds = [...new Set([...questions, ...replies].map((d) => String(d.authorId)).filter(isId))];
  const names = new Map((authorIds.length ? await db.collection('users').find({ _id: { $in: authorIds.map((id) => new ObjectId(id)) } }, { projection: { name: 1 } }).toArray() : []).map((u) => [String(u._id), u.name || 'Member']));
  const view = (d, type) => ({
    id: String(d._id),
    type,
    questionId: type === 'question' ? String(d._id) : d.questionId ? String(d.questionId) : null,
    title: type === 'question' ? text(d.title, 160) : null,
    excerpt: text(d.body || d.content || '', 280),
    author: names.get(String(d.authorId)) || 'Member',
    reportCount: d.reportCount || 0,
    reasons: Object.entries((d.reports || []).reduce((acc, r) => ({ ...acc, [r.reason]: (acc[r.reason] || 0) + 1 }), {})).map(([reason, count]) => ({ reason, label: REASONS[reason] || reason, count })),
    details: (d.reports || []).map((r) => r.details).filter(Boolean).slice(-5),
    status: d.moderation ? d.moderation.status : wanted,
    history: ((d.moderation && d.moderation.history) || []).slice(-10).map((h) => ({ action: h.action, reason: h.reason || null, at: h.at ? new Date(h.at).toISOString() : null })),
    createdAt: d.createdAt ? new Date(d.createdAt).toISOString() : null,
  });
  const items = [...questions.map((d) => view(d, 'question')), ...replies.map((d) => view(d, 'reply'))].sort((a, b) => b.reportCount - a.reportCount);
  const counts = {
    reported: (await db.collection(COLL.question).countDocuments({ 'moderation.status': 'reported' })) + (await db.collection(COLL.reply).countDocuments({ 'moderation.status': 'reported' })),
    hidden: (await db.collection(COLL.question).countDocuments({ 'moderation.status': 'hidden' })) + (await db.collection(COLL.reply).countDocuments({ 'moderation.status': 'hidden' })),
  };
  return { ok: true, items, counts };
}

/** hide | restore | clear, with a reason. Audited; recorded on the item. Moderators only. */
async function moderate(db, member, body, { now = new Date() } = {}) {
  const b = body && typeof body === 'object' ? body : {};
  if (!member || !MODERATORS.has(member.role)) return refuse(403, 'Only moderators can do this.');
  if (!COLL[b.targetType] || !isId(b.targetId)) return refuse(400, 'Choose the post.');
  if (!ACTIONS.includes(b.action)) return refuse(400, 'Choose hide, restore or clear.');
  const reason = text(b.reason, 300);
  if (reason.length < 5) return refuse(400, 'Give a reason (at least 5 characters); it is recorded.');
  const coll = db.collection(COLL[b.targetType]);
  const target = await coll.findOne({ _id: new ObjectId(b.targetId) }, { projection: { moderation: 1, authorId: 1 } });
  if (!target) return refuse(404, 'That post could not be found.');
  const from = (target.moderation && target.moderation.status) || 'visible';
  const to = b.action === 'hide' ? 'hidden' : 'cleared';
  if (b.action === 'restore' && from !== 'hidden') return refuse(409, 'Only hidden posts can be restored.');
  await coll.updateOne({ _id: target._id }, { $set: { 'moderation.status': to, 'moderation.updatedAt': now, 'moderation.history': [...((target.moderation && target.moderation.history) || []), { action: b.action, reason, by: String(member.userId), at: now }].slice(-HISTORY) } });
  try {
    await db.collection(AUDIT_COLLECTION).insertOne({ entityType: `community_${b.targetType}`, entityId: String(target._id), reference: null, action: `community_${b.action}`, reason, before: { status: from }, after: { status: to }, outcome: 'saved', context: { authorId: String(target.authorId || '') }, actor: { userId: String(member.userId), email: member.email || null, role: member.role }, createdAt: now });
  } catch {
    console.error(JSON.stringify({ event: 'moderationAudit', result: 'write_failed' }));
  }
  return { ok: true, status: 200, moderation: to };
}

module.exports = { ACTIONS, COLLECTIONS: COLL, REASONS, moderate, queue, report };
