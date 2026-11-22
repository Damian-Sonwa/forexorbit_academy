'use strict';

/**
 * AI lesson development: proposals, approval and history, stored on the lesson itself.
 *
 *   lessons.aiProposals   the last 10 proposals: { id, mode, status: pending|accepted|rejected,
 *                         blocks, knowledgeChecks, quality, baseRevision, provider, model, usage,
 *                         createdBy, createdAt, decidedBy, decidedAt }
 *   lessons.history       the last 10 versions replaced by an accepted proposal or a restore:
 *                         { id, at, by, reason, revision, blocks }
 *   lessons.aiGeneration  a short lock so one lesson is generated once at a time
 *
 * A proposal never changes the lesson. Accepting one replaces the lesson body only when the lesson
 * is still at the revision the editor has (no silent overwrite), keeps the previous body in
 * history, and, for a live course, only with explicit confirmation. Students never receive these
 * fields: lesson responses copy an explicit list of keys (lib/account-access.js presentLessonRead).
 *
 * The curriculum (title, module, order) is never touched. Progress, attempts, submissions and grades
 * refer to the lesson id and are unaffected.
 */

const crypto = require('crypto');
const { ObjectId } = require('mongodb');
const C = require('./course-content');
const G = require('./lesson-generation');
const { chatJson, ProviderError } = require('./ai-provider');
const { courseStatus } = require('./course-lifecycle');
const { normalizeQuestions, normalizeSettings, quizSettings } = require('./quiz-assessment');
const { saveQuizVersion } = require('./quiz-store');

const KEEP = 10;
const LOCK_MS = 3 * 60 * 1000;
const REUSE_MS = 30 * 60 * 1000;

function oid(id) { return new ObjectId(String(id)); }
function refuse(status, code, error) { return { ok: false, status, code, error }; }
function newKey() { return crypto.randomBytes(8).toString('hex'); }

function summary(p) {
  return {
    id: p.id, mode: p.mode, sectionKind: p.sectionKind || null, status: p.status, createdAt: p.createdAt, decidedAt: p.decidedAt || null,
    baseRevision: p.baseRevision, provider: p.provider, model: p.model, blocks: Array.isArray(p.blocks) ? p.blocks.length : 0,
    checks: (p.quality && p.quality.checks ? p.quality.checks : []).filter((c) => c.status !== 'pass').length,
    questions: (p.knowledgeChecks || []).length, instructions: p.instructions || '',
  };
}

function presentProposal(p) {
  return { ...summary(p), blocks: p.blocks || [], knowledgeChecks: p.knowledgeChecks || [], suggestions: p.suggestions || [], quality: p.quality || { checks: [] }, usage: p.usage || null };
}

/** The proposed full lesson body for each mode (section-type modes insert into the current body). */
function proposedBody(mode, current, generated, insertAfter) {
  if (G.WHOLE_LESSON_MODES.includes(mode)) return generated;
  if (mode === 'checks') return current;
  const at = insertAfter ? current.findIndex((b) => b.id === insertAfter) : -1;
  const index = at >= 0 ? at + 1 : current.length;
  return [...current.slice(0, index), ...generated, ...current.slice(index)];
}

/**
 * Generates one proposal for a lesson the member may edit (checked by the caller).
 * `request`: { mode, sectionKind, instructions, insertAfter, regenerate }.
 */
async function generateProposal(db, { member, course, lessonId, request, chat = chatJson, env = process.env, now = new Date() }) {
  const mode = request.mode;
  if (!G.MODES.includes(mode)) return refuse(400, 'invalid_mode', 'Choose what the AI should do.');
  if (mode === 'section' && !Object.prototype.hasOwnProperty.call(G.SECTION_KINDS, request.sectionKind)) return refuse(400, 'invalid_section', 'Choose the section to write.');
  const instructions = typeof request.instructions === 'string' ? request.instructions.trim().slice(0, G.INSTRUCTIONS_MAX) : '';
  const courseId = String(course._id);
  const lessons = await db.collection('lessons')
    .find({ courseId }, { projection: { title: 1, order: 1, moduleId: 1, blocks: 1, description: 1, content: 1, videoUrl: 1, pdfUrl: 1, resources: 1, revision: 1, aiProposals: 1 } })
    .limit(500)
    .toArray();
  const lesson = lessons.find((l) => String(l._id) === String(lessonId));
  if (!lesson) return refuse(404, 'lesson_not_found', 'Lesson not found');
  const ctx = G.buildContext({ course, lessons, lessonId });
  if (!ctx) return refuse(404, 'lesson_not_found', 'Lesson not found');
  if (['improve', 'expand', 'simplify'].includes(mode) && ctx.existingWords < 40) {
    return refuse(409, 'nothing_to_improve', 'This lesson has almost no content to improve. Use "Generate lesson" instead.');
  }
  const revision = Number.isInteger(lesson.revision) ? lesson.revision : 0;

  // The same request on the same lesson version returns the pending proposal (no new generation).
  const same = (lesson.aiProposals || []).find((p) => p.status === 'pending' && p.mode === mode && (p.sectionKind || null) === (request.sectionKind || null)
    && (p.instructions || '') === instructions && p.baseRevision === revision && now - new Date(p.createdAt) < REUSE_MS);
  if (same && !request.regenerate) return { ok: true, status: 200, reused: true, proposal: presentProposal(same) };

  const locked = await db.collection('lessons').updateOne(
    { _id: lesson._id, $or: [{ 'aiGeneration.status': { $ne: 'running' } }, { 'aiGeneration.startedAt': { $lt: new Date(now.getTime() - LOCK_MS) } }] },
    { $set: { aiGeneration: { status: 'running', startedAt: now, by: String(member.userId), mode } } }
  );
  if (!locked.matchedCount) return refuse(409, 'generation_running', 'A generation for this lesson is already running. Wait for it to finish.');

  const started = Date.now();
  let outcome = 'failed';
  let failure = null;
  try {
    const prompt = G.buildPrompt(mode, ctx, { sectionKind: request.sectionKind, instructions });
    const answer = await chat({ system: prompt.system, user: prompt.user, maxTokens: G.maxTokensFor(mode), env });
    const parsed = G.parseLesson(answer.content, { mode, finishReason: answer.finishReason });
    const current = C.lessonBlocks(lesson);
    const { blocks: generated, calculations } = mode === 'checks' ? { blocks: [], calculations: [] } : G.toBlocks(parsed, { mode, existingBlocks: current });
    const quality = G.assessQuality({ mode, ctx, parsed, blocks: generated, calculations });
    const body = proposedBody(mode, current, generated, typeof request.insertAfter === 'string' ? request.insertAfter : null);
    const checked = C.checkBlocks(body);
    if (!checked.ok) throw new G.GenerationError('malformed', 'The generated lesson could not be combined with the existing content safely. Try again.');
    const proposal = {
      id: newKey(), mode, sectionKind: mode === 'section' ? request.sectionKind : null, status: 'pending',
      blocks: checked.blocks, knowledgeChecks: parsed.knowledgeChecks, suggestions: parsed.suggestions, quality,
      instructions, baseRevision: revision, provider: answer.provider, model: answer.model, usage: answer.usage,
      createdBy: String(member.userId), createdAt: now,
    };
    await db.collection('lessons').updateOne({ _id: lesson._id }, { $push: { aiProposals: { $each: [proposal], $slice: -KEEP } } });
    outcome = 'proposed';
    console.log(JSON.stringify({ event: 'aiLessonGeneration', result: 'proposed', courseId, lessonId: String(lesson._id), mode, provider: answer.provider, model: answer.model, promptTokens: answer.usage.promptTokens, completionTokens: answer.usage.completionTokens, ms: Date.now() - started }));
    return { ok: true, status: 201, proposal: presentProposal(proposal) };
  } catch (error) {
    failure = error;
    if (error instanceof ProviderError) return refuse(error.code === 'not_configured' ? 503 : 502, error.code, error.message);
    if (error instanceof G.GenerationError) return refuse(502, error.code, error.message);
    throw error;
  } finally {
    await db.collection('lessons').updateOne({ _id: lesson._id }, { $set: { aiGeneration: { status: outcome === 'proposed' ? 'idle' : 'failed', finishedAt: new Date(), code: failure ? failure.code || 'error' : null } } });
    if (outcome !== 'proposed') console.log(JSON.stringify({ event: 'aiLessonGeneration', result: 'failed', courseId, lessonId: String(lesson._id), mode, code: failure ? failure.code || 'error' : 'unknown', ms: Date.now() - started }));
  }
}

/** Replaces the lesson body with `blocks` (accept or restore), keeping the old body in history. */
async function replaceBody(db, { lesson, member, blocks, reason, baseRevision, proposalId, now }) {
  const checked = C.checkBlocks(blocks);
  if (!checked.ok) return refuse(400, 'invalid_content', checked.error);
  const revision = Number.isInteger(lesson.revision) ? lesson.revision : 0;
  if (baseRevision !== revision) return refuse(409, 'stale_revision', 'The lesson was saved since you opened it. Reload, then accept again.');
  const snapshot = { id: newKey(), at: now, by: String(member.userId), reason, revision, blocks: C.lessonBlocks(lesson) };
  const update = {
    $set: { blocks: checked.blocks, ...C.mirroredLessonFields(checked.blocks), updatedAt: now, updatedBy: String(member.userId) },
    $push: { history: { $each: [snapshot], $slice: -KEEP } },
    $inc: { revision: 1 },
  };
  const options = { returnDocument: 'after', includeResultMetadata: false, projection: { revision: 1 } };
  if (proposalId) {
    update.$set['aiProposals.$[p].status'] = 'accepted';
    update.$set['aiProposals.$[p].decidedAt'] = now;
    update.$set['aiProposals.$[p].decidedBy'] = String(member.userId);
    options.arrayFilters = [{ 'p.id': proposalId, 'p.status': 'pending' }];
  }
  const filter = revision === 0 ? { _id: lesson._id, $or: [{ revision: 0 }, { revision: { $exists: false } }] } : { _id: lesson._id, revision };
  const written = await db.collection('lessons').findOneAndUpdate(filter, update, options);
  if (!written) return refuse(409, 'stale_revision', 'The lesson was saved since you opened it. Reload, then accept again.');
  return { ok: true, status: 200, revision: written.revision };
}

function liveRefusal(course, confirmLive) {
  const state = courseStatus(course);
  if ((state === 'published' || state === 'archived') && confirmLive !== true) {
    return refuse(409, 'confirm_live', 'This course is live: accepting changes what enrolled students see straight away. Confirm to continue.');
  }
  return null;
}

/** Accepts a pending proposal. `body`: { proposalId, baseRevision, confirmLive, acceptStale, createQuiz }. */
async function acceptProposal(db, { member, course, lessonId, body, now = new Date() }) {
  const lesson = await db.collection('lessons').findOne({ _id: oid(lessonId), courseId: String(course._id) }, { projection: { blocks: 1, description: 1, content: 1, videoUrl: 1, pdfUrl: 1, resources: 1, revision: 1, aiProposals: 1 } });
  if (!lesson) return refuse(404, 'lesson_not_found', 'Lesson not found');
  const proposal = (lesson.aiProposals || []).find((p) => p.id === body.proposalId);
  if (!proposal) return refuse(404, 'proposal_not_found', 'That proposal no longer exists.');
  if (proposal.status !== 'pending') return refuse(409, 'proposal_decided', `This proposal was already ${proposal.status}.`);
  const live = liveRefusal(course, body.confirmLive);
  if (live) return live;
  const revision = Number.isInteger(lesson.revision) ? lesson.revision : 0;
  if (proposal.baseRevision !== revision && body.acceptStale !== true) {
    return refuse(409, 'proposal_stale', 'The lesson changed after this proposal was generated, so accepting it would undo those changes. Regenerate it, or accept anyway.');
  }
  let result = { ok: true, status: 200, revision };
  if (proposal.mode !== 'checks') {
    result = await replaceBody(db, { lesson, member, blocks: proposal.blocks, reason: `ai_${proposal.mode}`, baseRevision: body.baseRevision, proposalId: proposal.id, now });
    if (!result.ok) return result;
  } else {
    await db.collection('lessons').updateOne({ _id: lesson._id }, { $set: { 'aiProposals.$[p].status': 'accepted', 'aiProposals.$[p].decidedAt': now, 'aiProposals.$[p].decidedBy': String(member.userId) } }, { arrayFilters: [{ 'p.id': proposal.id, 'p.status': 'pending' }] });
  }
  let quiz = null;
  if ((body.createQuiz === true || proposal.mode === 'checks') && (proposal.knowledgeChecks || []).length) {
    quiz = await addDraftQuestions(db, { lessonId: String(lesson._id), courseId: String(course._id), member, checks: proposal.knowledgeChecks, now });
  }
  return { ...result, quiz };
}

/**
 * Knowledge checks into the lesson quiz through the quiz store (Phase 9 validation). A new quiz is
 * a draft; questions are added to an existing quiz only while it is a draft, so a live quiz never
 * changes under students.
 */
async function addDraftQuestions(db, { lessonId, courseId, member, checks, now }) {
  const quizzes = db.collection('quizzes');
  const existing = await quizzes.findOne({ lessonId }, { projection: { questions: 1, settings: 1, status: 1, published: 1 } });
  if (existing && quizSettings(existing).status === 'published') {
    return { added: 0, note: 'The lesson quiz is published, so the questions were not added. Add them in the quiz editor if you want them.' };
  }
  const questions = [...(existing && Array.isArray(existing.questions) ? existing.questions : []), ...checks.map((q) => ({ question: q.question, options: q.options, correctAnswer: q.correctIndex, points: 1, explanation: q.explanation }))];
  const normalized = normalizeQuestions(questions);
  if (!normalized.ok) return { added: 0, note: normalized.error };
  const settings = normalizeSettings({ status: 'draft' }, existing ? quizSettings(existing) : undefined);
  await saveQuizVersion(quizzes, { lessonId, set: { courseId, questions: normalized.questions, settings: settings.settings, updatedAt: now, updatedBy: String(member.userId) }, now });
  return { added: checks.length, note: 'Added to the lesson quiz as a draft. Review it, then publish it from the quiz editor.' };
}

async function rejectProposal(db, { member, course, lessonId, body, now = new Date() }) {
  const res = await db.collection('lessons').updateOne(
    { _id: oid(lessonId), courseId: String(course._id) },
    { $set: { 'aiProposals.$[p].status': 'rejected', 'aiProposals.$[p].decidedAt': now, 'aiProposals.$[p].decidedBy': String(member.userId) } },
    { arrayFilters: [{ 'p.id': String(body.proposalId || ''), 'p.status': 'pending' }] }
  );
  if (!res.matchedCount) return refuse(404, 'lesson_not_found', 'Lesson not found');
  if (!res.modifiedCount) return refuse(409, 'proposal_decided', 'That proposal is not pending.');
  return { ok: true, status: 200 };
}

/** Restores a version from history (the current body goes into history in turn). */
async function restoreVersion(db, { member, course, lessonId, body, now = new Date() }) {
  const lesson = await db.collection('lessons').findOne({ _id: oid(lessonId), courseId: String(course._id) }, { projection: { blocks: 1, description: 1, content: 1, videoUrl: 1, pdfUrl: 1, resources: 1, revision: 1, history: 1 } });
  if (!lesson) return refuse(404, 'lesson_not_found', 'Lesson not found');
  const version = (lesson.history || []).find((h) => h.id === body.historyId);
  if (!version) return refuse(404, 'version_not_found', 'That version is no longer kept.');
  const live = liveRefusal(course, body.confirmLive);
  if (live) return live;
  return replaceBody(db, { lesson, member, blocks: version.blocks, reason: 'restore', baseRevision: body.baseRevision, now });
}

/** Proposals (summaries, or one in full) and history for the builder. */
async function readAi(db, { course, lessonId, proposalId, historyId }) {
  const lesson = await db.collection('lessons').findOne({ _id: oid(lessonId), courseId: String(course._id) }, { projection: { aiProposals: 1, history: 1, aiGeneration: 1, revision: 1 } });
  if (!lesson) return refuse(404, 'lesson_not_found', 'Lesson not found');
  const proposals = (lesson.aiProposals || []).slice().reverse();
  const history = (lesson.history || []).slice().reverse();
  return {
    ok: true,
    status: 200,
    proposals: proposals.map(summary),
    proposal: proposalId ? (proposals.find((p) => p.id === proposalId) ? presentProposal(proposals.find((p) => p.id === proposalId)) : null) : null,
    history: history.map((h) => ({ id: h.id, at: h.at, reason: h.reason, revision: h.revision, blocks: (h.blocks || []).length })),
    version: historyId ? (history.find((h) => h.id === historyId) || null) : null,
    running: Boolean(lesson.aiGeneration && lesson.aiGeneration.status === 'running' && Date.now() - new Date(lesson.aiGeneration.startedAt) < LOCK_MS),
    revision: Number.isInteger(lesson.revision) ? lesson.revision : 0,
  };
}

module.exports = { KEEP, acceptProposal, addDraftQuestions, generateProposal, proposedBody, readAi, rejectProposal, restoreVersion };
