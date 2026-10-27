/**
 * Community Q&A rules.
 * Categories organize public discussions. They do not grant access to
 * level-locked chat rooms. Legacy communityMessages stay untouched.
 * Authors cannot vote on their own questions or replies.
 */

const { isStoredId } = require('./account-access');

const COMMUNITY_CATEGORIES = [
  { id: 'beginner', label: 'Beginner Questions' },
  { id: 'market-structure', label: 'Market Structure' },
  { id: 'technical-analysis', label: 'Technical Analysis' },
  { id: 'risk-management', label: 'Risk Management' },
  { id: 'psychology', label: 'Trading Psychology' },
  { id: 'strategy', label: 'Strategy and Trade Review' },
  { id: 'support', label: 'Platform and Learning Support' },
];

const CATEGORY_IDS = new Set(COMMUNITY_CATEGORIES.map((item) => item.id));
const ROLES = new Set(['student', 'instructor', 'admin', 'superadmin']);
const MODERATOR_ROLES = new Set(['instructor', 'admin', 'superadmin']);
const VIEWS = new Set(['all', 'unanswered', 'popular', 'activity']);
const SORTS = new Set(['activity', 'newest', 'votes', 'replies']);

const COMMUNITY_QA_INDEXES = [
  { collection: 'communityQuestions', key: { lastActivityAt: -1 }, name: 'communityQuestions_activity' },
  { collection: 'communityQuestions', key: { createdAt: -1 }, name: 'communityQuestions_newest' },
  { collection: 'communityQuestions', key: { score: -1, lastActivityAt: -1 }, name: 'communityQuestions_votes' },
  { collection: 'communityQuestions', key: { replyCount: -1, lastActivityAt: -1 }, name: 'communityQuestions_replies' },
  { collection: 'communityQuestions', key: { category: 1, lastActivityAt: -1 }, name: 'communityQuestions_category' },
  { collection: 'communityQuestions', key: { authorId: 1, createdAt: -1 }, name: 'communityQuestions_author' },
  { collection: 'communityQuestions', key: { acceptedReplyId: 1 }, name: 'communityQuestions_accepted' },
  { collection: 'communityReplies', key: { questionId: 1, createdAt: 1 }, name: 'communityReplies_question' },
  { collection: 'communityReplies', key: { authorId: 1, createdAt: -1 }, name: 'communityReplies_author' },
  {
    collection: 'communityVotes',
    key: { userId: 1, targetId: 1, targetType: 1 },
    unique: true,
    name: 'communityVotes_one_per_user',
  },
];

const rateBuckets = new Map();

function fail(status, error) {
  return { ok: false, status, error };
}

function categoryLabel(id) {
  const match = COMMUNITY_CATEGORIES.find((item) => item.id === id);
  return match ? match.label : 'Discussion';
}

function plainCommunityText(value, max) {
  if (typeof value !== 'string') return '';
  const limit = typeof max === 'number' && max > 0 ? max : 0;
  const stripped = value
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  return stripped.trim().slice(0, limit);
}

function decideCommunityQaMember(member) {
  const userId = member && typeof member.userId === 'string' ? member.userId : '';
  const role = member && typeof member.role === 'string' ? member.role : '';
  if (!isStoredId(userId) || !ROLES.has(role)) {
    return fail(403, 'You are not authorized to use the community.');
  }
  return { ok: true, userId, role, moderator: MODERATOR_ROLES.has(role) };
}

function readDraft(body, fields) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return fail(400, 'Check the question and try again.');
  }
  const draft = {};
  fields.forEach((field) => {
    draft[field] = body[field];
  });
  return { ok: true, draft };
}

function decideQuestionDraft(body) {
  const read = readDraft(body, ['title', 'body', 'category']);
  if (!read.ok) return read;
  const title = plainCommunityText(read.draft.title, 140);
  const text = plainCommunityText(read.draft.body, 8000);
  const category = typeof read.draft.category === 'string' ? read.draft.category : '';
  if (title.length < 12) return fail(400, 'Add a title of at least 12 characters.');
  if (text.length < 20) return fail(400, 'Describe the question in at least 20 characters.');
  if (!CATEGORY_IDS.has(category)) return fail(400, 'Choose a discussion category.');
  return { ok: true, title, body: text, category };
}

function decideQuestionPatch(body) {
  const read = readDraft(body, ['title', 'body', 'category']);
  if (!read.ok) return read;
  const next = {};
  if (read.draft.title != null) {
    next.title = plainCommunityText(read.draft.title, 140);
    if (next.title.length < 12) return fail(400, 'Add a title of at least 12 characters.');
  }
  if (read.draft.body != null) {
    next.body = plainCommunityText(read.draft.body, 8000);
    if (next.body.length < 20) return fail(400, 'Describe the question in at least 20 characters.');
  }
  if (read.draft.category != null) {
    next.category = typeof read.draft.category === 'string' ? read.draft.category : '';
    if (!CATEGORY_IDS.has(next.category)) return fail(400, 'Choose a discussion category.');
  }
  if (!next.title && !next.body && !next.category) {
    return fail(400, 'Nothing to update.');
  }
  return { ok: true, patch: next };
}

function decideReplyDraft(body) {
  const read = readDraft(body, ['body']);
  if (!read.ok) return fail(400, 'Write a reply and try again.');
  const text = plainCommunityText(read.draft.body, 5000);
  if (text.length < 2) return fail(400, 'Write a reply before sending it.');
  return { ok: true, body: text };
}

function decideContentControl(member, authorId) {
  const actor = decideCommunityQaMember(member);
  if (!actor.ok) return actor;
  const owner = typeof authorId === 'string' && actor.userId === authorId;
  if (!owner && !actor.moderator) {
    return fail(403, 'You can only change your own contribution.');
  }
  return { ok: true, userId: actor.userId, moderator: actor.moderator, owner };
}

function decideVoteChange({ current, requested, isAuthor }) {
  if (isAuthor) return fail(403, 'You cannot vote on your own contribution.');
  const previous = current === 1 || current === -1 ? current : 0;
  if (requested !== 1 && requested !== -1) {
    return fail(400, 'Choose an up vote or a down vote.');
  }
  const next = previous === requested ? 0 : requested;
  return { ok: true, previous, next, delta: next - previous, remove: next === 0 };
}

function decideAcceptAnswer({ member, questionAuthorId, reply, questionId }) {
  const actor = decideCommunityQaMember(member);
  if (!actor.ok) return actor;
  const owner = actor.userId === questionAuthorId;
  if (!owner && !actor.moderator) {
    return fail(403, 'Only the question author can accept an answer.');
  }
  if (reply == null) {
    return { ok: true, acceptedReplyId: null };
  }
  if (!reply._id || String(reply.questionId) !== String(questionId)) {
    return fail(404, 'That reply is not part of this question.');
  }
  return { ok: true, acceptedReplyId: String(reply._id) };
}

function reconcileAcceptedAnswer({ acceptedReplyId, removedReplyId }) {
  if (acceptedReplyId == null || acceptedReplyId === '') return { clear: false };
  return { clear: String(acceptedReplyId) === String(removedReplyId) };
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sortSpec(sort) {
  if (sort === 'newest') return { createdAt: -1, _id: -1 };
  if (sort === 'votes') return { score: -1, lastActivityAt: -1, _id: -1 };
  if (sort === 'replies') return { replyCount: -1, lastActivityAt: -1, _id: -1 };
  return { lastActivityAt: -1, _id: -1 };
}

function buildQuestionListQuery({ view, sort, category, search, page, limit, authorId, repliedQuestionIds }) {
  const selectedView = view == null || view === '' ? 'all' : view;
  const selectedSort = sort == null || sort === '' ? (selectedView === 'popular' ? 'votes' : 'activity') : sort;
  if (!VIEWS.has(selectedView)) return fail(400, 'Choose a valid community filter.');
  if (!SORTS.has(selectedSort)) return fail(400, 'Choose a valid sort order.');
  if (category != null && category !== '' && !CATEGORY_IDS.has(category)) {
    return fail(400, 'Choose a discussion category.');
  }
  const pageNum = page == null || page === '' ? 1 : Number(page);
  const limitNum = limit == null || limit === '' ? 10 : Number(limit);
  if (!Number.isInteger(pageNum) || pageNum < 1 || pageNum > 500) {
    return fail(400, 'Choose a valid page.');
  }
  if (!Number.isInteger(limitNum) || limitNum < 1 || limitNum > 20) {
    return fail(400, 'Choose a valid page size.');
  }
  const filter = {};
  if (category) filter.category = category;
  if (selectedView === 'unanswered') filter.acceptedReplyId = null;
  if (selectedView === 'activity') {
    if (!isStoredId(authorId)) return fail(403, 'You are not authorized to use the community.');
    const ids = Array.isArray(repliedQuestionIds) ? repliedQuestionIds.filter((id) => isStoredId(id)).slice(0, 200) : [];
    filter.$or = [{ authorId }, { _id: { $in: ids } }];
  }
  if (typeof search === 'string' && search.trim()) {
    const safe = escapeRegex(plainCommunityText(search, 80));
    if (safe) {
      const pattern = { $regex: safe, $options: 'i' };
      const textMatch = { $or: [{ title: pattern }, { body: pattern }] };
      if (filter.$or) {
        filter.$and = [{ $or: filter.$or }, textMatch];
        delete filter.$or;
      } else {
        filter.$or = textMatch.$or;
      }
    }
  }
  return {
    ok: true,
    view: selectedView,
    sort: selectedSort,
    filter,
    mongoSort: sortSpec(selectedSort),
    skip: (pageNum - 1) * limitNum,
    limit: limitNum,
  };
}

function consumeCommunityQaRate({ key, limit, windowMs, now }) {
  const name = typeof key === 'string' ? key : '';
  const max = typeof limit === 'number' ? limit : 0;
  const span = typeof windowMs === 'number' ? windowMs : 0;
  if (!name || max < 1 || span < 1) return fail(400, 'Please try again.');
  const current = typeof now === 'number' ? now : Date.now();
  const bucket = rateBuckets.get(name);
  if (!bucket || bucket.resetAt <= current) {
    rateBuckets.set(name, { count: 1, resetAt: current + span });
    return { ok: true };
  }
  if (bucket.count >= max) return fail(429, 'Please wait a moment and try again.');
  bucket.count += 1;
  return { ok: true };
}

function clearCommunityQaRateLimits() {
  rateBuckets.clear();
}

function communityReturnPath(value) {
  if (typeof value !== 'string') return '/community';
  if (!value.startsWith('/community') || value.startsWith('//') || value.includes('://') || value.includes('\\')) {
    return '/community';
  }
  return value;
}

function safeProfilePhoto(value) {
  if (typeof value !== 'string') return null;
  if (value.startsWith('/uploads/') && !value.includes('..') && !value.includes('\\')) return value;
  if (/^https:\/\/[^\s]+$/i.test(value)) return value;
  return null;
}

module.exports = {
  COMMUNITY_CATEGORIES,
  COMMUNITY_QA_INDEXES,
  categoryLabel,
  plainCommunityText,
  decideCommunityQaMember,
  decideQuestionDraft,
  decideQuestionPatch,
  decideReplyDraft,
  decideContentControl,
  decideVoteChange,
  decideAcceptAnswer,
  reconcileAcceptedAnswer,
  buildQuestionListQuery,
  consumeCommunityQaRate,
  clearCommunityQaRateLimits,
  communityReturnPath,
  safeProfilePhoto,
};
