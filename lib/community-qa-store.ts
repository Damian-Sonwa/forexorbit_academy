/**
 * Community Q&A persistence.
 * Writes communityQuestions, communityReplies, and communityVotes only.
 * Existing chat messages and rooms are not read or deleted here.
 * The unique vote index is specified in COMMUNITY_QA_INDEXES and is not created here.
 */

import { ObjectId, type Db, type Sort } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { deliverNotification } from '@/lib/notifications';
import {
  buildQuestionListQuery,
  categoryLabel,
  consumeCommunityQaRate,
  decideAcceptAnswer,
  decideCommunityQaMember,
  decideContentControl,
  decideQuestionDraft,
  decideQuestionPatch,
  decideReplyDraft,
  decideVoteChange,
  reconcileAcceptedAnswer,
  safeProfilePhoto,
} from '@/lib/community-qa';

const QUESTIONS = 'communityQuestions';
const REPLIES = 'communityReplies';
const VOTES = 'communityVotes';
const RATE_WINDOW = 10 * 60 * 1000;

export class CommunityQaError extends Error {
  status: number;
  clientError: string;

  constructor(status: number, clientError: string) {
    super(clientError);
    this.status = status;
    this.clientError = clientError;
  }
}

type Member = { userId: string; role: string };

type QuestionDoc = {
  _id: ObjectId;
  authorId: string;
  title: string;
  body: string;
  category: string;
  acceptedReplyId: ObjectId | null;
  replyCount: number;
  score: number;
  createdAt: Date;
  updatedAt: Date;
  lastActivityAt: Date;
};

type ReplyDoc = {
  _id: ObjectId;
  questionId: ObjectId;
  authorId: string;
  body: string;
  score: number;
  createdAt: Date;
  updatedAt: Date;
};

function reject(result: { ok: false; status: number; error: string }): never {
  throw new CommunityQaError(result.status, result.error);
}

function memberOf(member: Member) {
  const decision = decideCommunityQaMember(member);
  if (!decision.ok) reject(decision);
  return decision;
}

function storedId(value: unknown) {
  return typeof value === 'string' && /^[a-fA-F0-9]{24}$/.test(value);
}

async function authorMap(db: Db, ids: string[]) {
  const unique = Array.from(new Set(ids.filter((id) => storedId(id))));
  const map = new Map<string, { name: string; photo: string | null }>();
  if (unique.length === 0) return map;
  const docs = await db.collection('users').find(
    { _id: { $in: unique.map((id) => new ObjectId(id)) } },
    { projection: { name: 1, profilePhoto: 1 } }
  ).toArray();
  docs.forEach((doc) => {
    map.set(String(doc._id), {
      name: typeof doc.name === 'string' && doc.name.trim() ? doc.name.trim() : 'Member',
      photo: safeProfilePhoto(doc.profilePhoto),
    });
  });
  return map;
}

function authorView(map: Map<string, { name: string; photo: string | null }>, authorId: string) {
  return map.get(authorId) || { name: 'Member', photo: null };
}

function questionView(
  doc: QuestionDoc,
  author: { name: string; photo: string | null },
  viewerVote: number,
  member: { userId: string; moderator: boolean }
) {
  return {
    id: String(doc._id),
    title: doc.title,
    body: doc.body,
    preview: doc.body.slice(0, 180),
    category: doc.category,
    categoryLabel: categoryLabel(doc.category),
    author: { id: doc.authorId, name: author.name, photo: author.photo },
    replyCount: doc.replyCount || 0,
    score: doc.score || 0,
    answered: Boolean(doc.acceptedReplyId),
    acceptedReplyId: doc.acceptedReplyId ? String(doc.acceptedReplyId) : null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    lastActivityAt: doc.lastActivityAt,
    viewerVote,
    canEdit: member.moderator || member.userId === doc.authorId,
    canAccept: member.moderator || member.userId === doc.authorId,
  };
}

async function viewerVotes(db: Db, userId: string, targetIds: ObjectId[]) {
  const map = new Map<string, number>();
  if (targetIds.length === 0) return map;
  const docs = await db.collection(VOTES).find(
    { userId, targetId: { $in: targetIds } },
    { projection: { targetId: 1, value: 1, updatedAt: 1 } }
  ).sort({ updatedAt: -1 }).toArray();
  docs.forEach((doc) => {
    const key = String(doc.targetId);
    if (!map.has(key) && (doc.value === 1 || doc.value === -1)) map.set(key, doc.value);
  });
  return map;
}

function mapIdClauses(clauses: unknown[], ids: ObjectId[]): unknown[] {
  return clauses.map((clause) => {
    if (!clause || typeof clause !== 'object') return clause;
    const record = clause as Record<string, unknown>;
    const idQuery = record._id;
    if (idQuery && typeof idQuery === 'object' && Array.isArray((idQuery as { $in?: unknown }).$in)) {
      return { ...record, _id: { $in: ids } };
    }
    if (Array.isArray(record.$or)) return { ...record, $or: mapIdClauses(record.$or, ids) };
    return record;
  });
}

function withReplyIds(filter: Record<string, unknown>, ids: string[]) {
  const objectIds = ids.filter((id) => storedId(id)).slice(0, 200).map((id) => new ObjectId(id));
  const next: Record<string, unknown> = { ...filter };
  if (Array.isArray(next.$or)) next.$or = mapIdClauses(next.$or, objectIds);
  if (Array.isArray(next.$and)) {
    next.$and = next.$and.map((item) => {
      if (!item || typeof item !== 'object') return item;
      const group = item as Record<string, unknown>;
      if (Array.isArray(group.$or)) return { ...group, $or: mapIdClauses(group.$or, objectIds) };
      return group;
    });
  }
  return next;
}

export async function listQuestions(member: Member, query: Record<string, unknown>) {
  const actor = memberOf(member);
  const db = await database();
  let repliedIds: string[] = [];
  if (query.view === 'activity') {
    const replies = await db.collection(REPLIES).find(
      { authorId: actor.userId },
      { projection: { questionId: 1 } }
    ).sort({ createdAt: -1 }).limit(200).toArray();
    repliedIds = replies.map((item) => String(item.questionId));
  }
  const decision = buildQuestionListQuery({
    view: query.view,
    sort: query.sort,
    category: query.category,
    search: query.q ?? query.search,
    page: query.page,
    limit: query.limit,
    authorId: actor.userId,
    repliedQuestionIds: repliedIds,
  });
  if (!decision.ok) reject(decision);
  const docs = await db.collection<QuestionDoc>(QUESTIONS).find(withReplyIds(decision.filter, repliedIds))
    .sort(decision.mongoSort as Sort)
    .skip(decision.skip)
    .limit(decision.limit + 1)
    .toArray();
  const hasMore = docs.length > decision.limit;
  const page = docs.slice(0, decision.limit);
  const authors = await authorMap(db, page.map((item) => item.authorId));
  const votes = await viewerVotes(db, actor.userId, page.map((item) => item._id));
  return {
    questions: page.map((item) => questionView(item, authorView(authors, item.authorId), votes.get(String(item._id)) || 0, actor)),
    page: Math.floor(decision.skip / decision.limit) + 1,
    limit: decision.limit,
    hasMore,
  };
}

async function database() {
  return getDb();
}

export async function createQuestion(member: Member, body: unknown) {
  const actor = memberOf(member);
  const draft = decideQuestionDraft(body);
  if (!draft.ok) reject(draft);
  const rate = consumeCommunityQaRate({ key: `question:${actor.userId}`, limit: 6, windowMs: RATE_WINDOW });
  if (!rate.ok) reject(rate);
  const db = await database();
  const now = new Date();
  const result = await db.collection(QUESTIONS).insertOne({
    authorId: actor.userId,
    title: draft.title,
    body: draft.body,
    category: draft.category,
    acceptedReplyId: null,
    replyCount: 0,
    score: 0,
    createdAt: now,
    updatedAt: now,
    lastActivityAt: now,
  });
  return { id: String(result.insertedId) };
}

async function loadQuestion(db: Db, id: string) {
  if (!storedId(id)) throw new CommunityQaError(400, 'That discussion could not be found.');
  const doc = await db.collection<QuestionDoc>(QUESTIONS).findOne({ _id: new ObjectId(id) });
  if (!doc) throw new CommunityQaError(404, 'That discussion could not be found.');
  return doc;
}

async function contributionStats(db: Db, authorId: string) {
  const authorMatch = { authorId };
  const [questions, replies, questionScore, replyScore] = await Promise.all([
    db.collection(QUESTIONS).countDocuments(authorMatch),
    db.collection(REPLIES).countDocuments(authorMatch),
    db.collection(QUESTIONS).aggregate([{ $match: authorMatch }, { $group: { _id: null, score: { $sum: '$score' } } }]).toArray(),
    db.collection(REPLIES).aggregate([{ $match: authorMatch }, { $group: { _id: null, score: { $sum: '$score' } } }]).toArray(),
  ]);
  const helpful = Number(questionScore[0]?.score || 0) + Number(replyScore[0]?.score || 0);
  return { questions, replies, helpful };
}

export async function getQuestion(member: Member, id: string, replyPageRaw: unknown) {
  const actor = memberOf(member);
  const replyPage = replyPageRaw == null || replyPageRaw === '' ? 1 : Number(replyPageRaw);
  if (!Number.isInteger(replyPage) || replyPage < 1 || replyPage > 100) {
    throw new CommunityQaError(400, 'Choose a valid page.');
  }
  const db = await database();
  const question = await loadQuestion(db, id);
  const limit = 30;
  const replyDocs = await db.collection<ReplyDoc>(REPLIES).find({ questionId: question._id })
    .sort({ createdAt: 1 })
    .skip((replyPage - 1) * limit)
    .limit(limit + 1)
    .toArray();
  const hasMoreReplies = replyDocs.length > limit;
  const replies = replyDocs.slice(0, limit);
  if (question.acceptedReplyId && !replies.some((item) => String(item._id) === String(question.acceptedReplyId))) {
    const accepted = await db.collection<ReplyDoc>(REPLIES).findOne({ _id: question.acceptedReplyId, questionId: question._id });
    if (accepted) replies.unshift(accepted);
  }
  const authors = await authorMap(db, [question.authorId, ...replies.map((item) => item.authorId)]);
  const votes = await viewerVotes(db, actor.userId, [question._id, ...replies.map((item) => item._id)]);
  const stats = await contributionStats(db, question.authorId);
  return {
    question: {
      ...questionView(question, authorView(authors, question.authorId), votes.get(String(question._id)) || 0, actor),
      authorStats: stats,
    },
    replies: replies.map((item) => ({
      id: String(item._id),
      body: item.body,
      score: item.score || 0,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      accepted: String(question.acceptedReplyId || '') === String(item._id),
      viewerVote: votes.get(String(item._id)) || 0,
      canEdit: actor.moderator || actor.userId === item.authorId,
      author: { id: item.authorId, ...authorView(authors, item.authorId) },
    })),
    replyPage,
    hasMoreReplies,
  };
}

export async function updateQuestion(member: Member, id: string, body: unknown) {
  const actor = memberOf(member);
  const patch = decideQuestionPatch(body);
  if (!patch.ok) reject(patch);
  const db = await database();
  const question = await loadQuestion(db, id);
  const control = decideContentControl(actor, question.authorId);
  if (!control.ok) reject(control);
  const now = new Date();
  await db.collection(QUESTIONS).updateOne(
    { _id: question._id },
    { $set: { ...patch.patch, updatedAt: now, lastActivityAt: now } }
  );
  return { id };
}

export async function deleteQuestion(member: Member, id: string) {
  const actor = memberOf(member);
  const db = await database();
  const question = await loadQuestion(db, id);
  const control = decideContentControl(actor, question.authorId);
  if (!control.ok) reject(control);
  const replies = await db.collection(REPLIES).find({ questionId: question._id }, { projection: { _id: 1 } }).toArray();
  const targetIds = [question._id, ...replies.map((item) => item._id)];
  await db.collection(VOTES).deleteMany({ targetId: { $in: targetIds } });
  await db.collection(REPLIES).deleteMany({ questionId: question._id });
  await db.collection(QUESTIONS).deleteOne({ _id: question._id });
  return { id };
}

async function notifyUser(userId: string, title: string, message: string, href: string, dedupeKey: string) {
  if (!storedId(userId)) return;
  try {
    await deliverNotification({
      type: 'system_alert',
      title,
      message,
      userId,
      dedupeKey,
      metadata: { href },
    });
  } catch {
    console.error(JSON.stringify({ event: 'communityQaNotice', result: 'failed' }));
  }
}

export async function createReply(member: Member, questionId: string, body: unknown) {
  const actor = memberOf(member);
  const draft = decideReplyDraft(body);
  if (!draft.ok) reject(draft);
  const rate = consumeCommunityQaRate({ key: `reply:${actor.userId}`, limit: 20, windowMs: RATE_WINDOW });
  if (!rate.ok) reject(rate);
  const db = await database();
  const question = await loadQuestion(db, questionId);
  const now = new Date();
  const result = await db.collection(REPLIES).insertOne({
    questionId: question._id,
    authorId: actor.userId,
    body: draft.body,
    score: 0,
    createdAt: now,
    updatedAt: now,
  });
  await db.collection(QUESTIONS).updateOne(
    { _id: question._id },
    { $inc: { replyCount: 1 }, $set: { updatedAt: now, lastActivityAt: now } }
  );
  if (question.authorId !== actor.userId) {
    await notifyUser(
      question.authorId,
      'New reply',
      'Someone replied to your question.',
      `/community/questions/${questionId}`,
      `community-reply:${String(result.insertedId)}`
    );
  }
  return { id: String(result.insertedId) };
}

async function loadReply(db: Db, questionId: string, replyId: string) {
  const question = await loadQuestion(db, questionId);
  if (!storedId(replyId)) throw new CommunityQaError(404, 'That reply could not be found.');
  const reply = await db.collection<ReplyDoc>(REPLIES).findOne({
    _id: new ObjectId(replyId),
    questionId: question._id,
  });
  if (!reply) throw new CommunityQaError(404, 'That reply could not be found.');
  return { question, reply };
}

export async function updateReply(member: Member, questionId: string, replyId: string, body: unknown) {
  const actor = memberOf(member);
  const draft = decideReplyDraft(body);
  if (!draft.ok) reject(draft);
  const db = await database();
  const { question, reply } = await loadReply(db, questionId, replyId);
  const control = decideContentControl(actor, reply.authorId);
  if (!control.ok) reject(control);
  const now = new Date();
  await db.collection(REPLIES).updateOne({ _id: reply._id }, { $set: { body: draft.body, updatedAt: now } });
  await db.collection(QUESTIONS).updateOne({ _id: question._id }, { $set: { lastActivityAt: now } });
  return { id: replyId };
}

export async function deleteReply(member: Member, questionId: string, replyId: string) {
  const actor = memberOf(member);
  const db = await database();
  const { question, reply } = await loadReply(db, questionId, replyId);
  const control = decideContentControl(actor, reply.authorId);
  if (!control.ok) reject(control);
  const accepted = reconcileAcceptedAnswer({
    acceptedReplyId: question.acceptedReplyId,
    removedReplyId: String(reply._id),
  });
  await db.collection(VOTES).deleteMany({ targetId: reply._id, targetType: 'reply' });
  await db.collection(REPLIES).deleteOne({ _id: reply._id });
  const now = new Date();
  const update: { $inc: { replyCount: number }; $set: Record<string, unknown> } = {
    $inc: { replyCount: -1 },
    $set: { updatedAt: now, lastActivityAt: now },
  };
  if (accepted.clear) update.$set.acceptedReplyId = null;
  await db.collection(QUESTIONS).updateOne({ _id: question._id }, update);
  await db.collection(QUESTIONS).updateOne(
    { _id: question._id, replyCount: { $lt: 0 } },
    { $set: { replyCount: 0 } }
  );
  return { id: replyId, acceptedCleared: accepted.clear };
}

export async function voteOnTarget(member: Member, questionId: string, body: unknown) {
  const actor = memberOf(member);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new CommunityQaError(400, 'Choose an up vote or a down vote.');
  }
  const payload = body as { target?: unknown; replyId?: unknown; value?: unknown };
  const targetType = payload.target === 'reply' ? 'reply' : payload.target === 'question' ? 'question' : '';
  if (!targetType) throw new CommunityQaError(400, 'Choose an up vote or a down vote.');
  const db = await database();
  const question = await loadQuestion(db, questionId);
  let targetId = question._id;
  let authorId = question.authorId;
  let score = question.score || 0;
  let collection: typeof QUESTIONS | typeof REPLIES = QUESTIONS;
  if (targetType === 'reply') {
    const replyId = typeof payload.replyId === 'string' ? payload.replyId : '';
    const loaded = await loadReply(db, questionId, replyId);
    targetId = loaded.reply._id;
    authorId = loaded.reply.authorId;
    score = loaded.reply.score || 0;
    collection = REPLIES;
  }
  const existing = await db.collection(VOTES).find({
    userId: actor.userId,
    targetId,
    targetType,
  }).sort({ updatedAt: -1 }).toArray();
  const current = existing[0]?.value === 1 || existing[0]?.value === -1 ? existing[0].value : 0;
  const decision = decideVoteChange({
    current,
    requested: payload.value,
    isAuthor: actor.userId === authorId,
  });
  if (!decision.ok) reject(decision);
  if (existing.length > 1) {
    await db.collection(VOTES).deleteMany({ _id: { $in: existing.slice(1).map((item) => item._id) } });
  }
  const now = new Date();
  if (decision.remove) {
    if (existing[0]) await db.collection(VOTES).deleteOne({ _id: existing[0]._id, value: decision.previous });
  } else if (existing[0]) {
    const updated = await db.collection(VOTES).updateOne(
      { _id: existing[0]._id, value: decision.previous },
      { $set: { value: decision.next, updatedAt: now } }
    );
    if (updated.matchedCount !== 1) throw new CommunityQaError(409, 'Please try that vote again.');
  } else {
    try {
      await db.collection(VOTES).insertOne({
        userId: actor.userId,
        targetId,
        targetType,
        value: decision.next,
        createdAt: now,
        updatedAt: now,
      });
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? (error as { code?: unknown }).code : undefined;
      if (code === 11000) throw new CommunityQaError(409, 'Please try that vote again.');
      throw error;
    }
  }
  if (decision.delta !== 0) {
    await db.collection(collection).updateOne({ _id: targetId }, { $inc: { score: decision.delta } });
  }
  return { vote: decision.next, score: score + decision.delta };
}

export async function acceptAnswer(member: Member, questionId: string, body: unknown) {
  const actor = memberOf(member);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new CommunityQaError(400, 'Choose a reply to accept.');
  }
  const replyId = (body as { replyId?: unknown }).replyId;
  const db = await database();
  const question = await loadQuestion(db, questionId);
  let reply: ReplyDoc | null = null;
  if (replyId != null) {
    if (typeof replyId !== 'string') throw new CommunityQaError(400, 'Choose a reply to accept.');
    reply = (await loadReply(db, questionId, replyId)).reply;
  }
  const decision = decideAcceptAnswer({
    member: actor,
    questionAuthorId: question.authorId,
    reply,
    questionId: String(question._id),
  });
  if (!decision.ok) reject(decision);
  await db.collection(QUESTIONS).updateOne(
    { _id: question._id },
    { $set: { acceptedReplyId: decision.acceptedReplyId ? new ObjectId(decision.acceptedReplyId) : null, updatedAt: new Date(), lastActivityAt: new Date() } }
  );
  if (reply && reply.authorId !== actor.userId) {
    await notifyUser(
      reply.authorId,
      'Answer accepted',
      'Your reply was marked as the answer.',
      `/community/questions/${questionId}`,
      `community-accepted:${String(reply._id)}`
    );
  }
  return { acceptedReplyId: decision.acceptedReplyId };
}
