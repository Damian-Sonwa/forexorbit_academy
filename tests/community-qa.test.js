/**
 * Community Q&A rules. No database connection.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
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
  plainCommunityText,
  communityReturnPath,
  COMMUNITY_QA_INDEXES,
} = require('../lib/community-qa');
const { isFeatureApiBlocked, FEATURES } = require('../lib/feature-access');
const { decideCommunityRoomJoin } = require('../lib/account-access');

const AUTHOR = '507f1f77bcf86cd799439011';
const OTHER = '507f1f77bcf86cd799439012';
const QUESTION = '507f1f77bcf86cd799439013';
const REPLY = '507f1f77bcf86cd799439014';
const student = { userId: AUTHOR, role: 'student' };
const other = { userId: OTHER, role: 'student' };
const instructor = { userId: OTHER, role: 'instructor' };

test('a question requires a title, details, and a known category', () => {
  const created = decideQuestionDraft({
    title: 'How do I read a candle?',
    body: 'I can see the open and close, but I do not know what the wick means.',
    category: 'beginner',
    authorId: OTHER,
    score: 99,
  });
  const short = decideQuestionDraft({ title: 'Help', body: 'Too short for a question.', category: 'beginner' });
  const badCategory = decideQuestionDraft({
    title: 'How do I read a candle?',
    body: 'I can see the open and close, but I do not know what the wick means.',
    category: 'private-room',
  });
  assert.equal(created.ok, true);
  if (created.ok) {
    assert.equal(created.title, 'How do I read a candle?');
    assert.equal(created.category, 'beginner');
    assert.equal('authorId' in created, false);
  }
  assert.equal(short.ok, false);
  assert.equal(badCategory.ok, false);
});

test('question text is stored as plain text', () => {
  const draft = decideQuestionDraft({
    title: 'How do I read a candle?',
    body: 'Explain <script>alert(1)</script> the wick in a beginner example.',
    category: 'technical-analysis',
  });
  assert.equal(draft.ok, true);
  if (draft.ok) assert.equal(draft.body.includes('<script>'), false);
  assert.equal(plainCommunityText('  hello <b>there</b>  ', 20), 'hello there');
});

test('only the owner or a moderator can edit or delete', () => {
  const owner = decideContentControl(student, AUTHOR);
  const stranger = decideContentControl(other, AUTHOR);
  const staff = decideContentControl(instructor, AUTHOR);
  const patch = decideQuestionPatch({ title: 'How do I read a candle body?' });
  assert.equal(owner.ok, true);
  assert.equal(stranger.ok, false);
  if (!stranger.ok) assert.equal(stranger.status, 403);
  assert.equal(staff.ok, true);
  assert.equal(patch.ok, true);
});

test('replies stay attached to the supplied body only', () => {
  const reply = decideReplyDraft({ body: 'Look at the close first.', questionId: QUESTION, authorId: OTHER });
  const empty = decideReplyDraft({ body: ' ' });
  assert.equal(reply.ok, true);
  if (reply.ok) assert.equal(reply.body, 'Look at the close first.');
  assert.equal(empty.ok, false);
});

test('a vote toggles off and switches direction, and authors cannot vote', () => {
  const up = decideVoteChange({ current: 0, requested: 1, isAuthor: false });
  const again = decideVoteChange({ current: 1, requested: 1, isAuthor: false });
  const switched = decideVoteChange({ current: 1, requested: -1, isAuthor: false });
  const own = decideVoteChange({ current: 0, requested: 1, isAuthor: true });
  const junk = decideVoteChange({ current: 0, requested: 5, isAuthor: false });
  assert.equal(up.ok && up.next, 1);
  assert.equal(up.ok && up.delta, 1);
  assert.equal(again.ok && again.remove, true);
  assert.equal(again.ok && again.delta, -1);
  assert.equal(switched.ok && switched.next, -1);
  assert.equal(switched.ok && switched.delta, -2);
  assert.equal(own.ok, false);
  assert.equal(junk.ok, false);
});

test('acceptance is limited to the author or a moderator and to one reply', () => {
  const allowed = decideAcceptAnswer({
    member: student,
    questionAuthorId: AUTHOR,
    questionId: QUESTION,
    reply: { _id: REPLY, questionId: QUESTION },
  });
  const switched = decideAcceptAnswer({
    member: student,
    questionAuthorId: AUTHOR,
    questionId: QUESTION,
    reply: { _id: OTHER, questionId: QUESTION },
  });
  const denied = decideAcceptAnswer({
    member: other,
    questionAuthorId: AUTHOR,
    questionId: QUESTION,
    reply: { _id: REPLY, questionId: QUESTION },
  });
  const wrongQuestion = decideAcceptAnswer({
    member: instructor,
    questionAuthorId: AUTHOR,
    questionId: QUESTION,
    reply: { _id: REPLY, questionId: OTHER },
  });
  const cleared = decideAcceptAnswer({
    member: student,
    questionAuthorId: AUTHOR,
    questionId: QUESTION,
    reply: null,
  });
  assert.equal(allowed.ok && allowed.acceptedReplyId, REPLY);
  assert.equal(switched.ok && switched.acceptedReplyId, OTHER);
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.status, 403);
  assert.equal(wrongQuestion.ok, false);
  assert.equal(cleared.ok && cleared.acceptedReplyId, null);
});

test('deleting the accepted reply clears the accepted answer', () => {
  assert.equal(reconcileAcceptedAnswer({ acceptedReplyId: REPLY, removedReplyId: REPLY }).clear, true);
  assert.equal(reconcileAcceptedAnswer({ acceptedReplyId: OTHER, removedReplyId: REPLY }).clear, false);
  assert.equal(reconcileAcceptedAnswer({ acceptedReplyId: null, removedReplyId: REPLY }).clear, false);
});

test('listing rejects unsafe filters and paginates on the server', () => {
  const listed = buildQuestionListQuery({
    view: 'unanswered',
    sort: 'votes',
    category: 'risk-management',
    search: 'stop loss',
    page: 2,
    limit: 10,
  });
  const injected = buildQuestionListQuery({ view: 'all', sort: { $gt: '' }, search: '.*' });
  const operator = buildQuestionListQuery({ view: { $where: 'this.a' } });
  const activity = buildQuestionListQuery({
    view: 'activity',
    authorId: AUTHOR,
    repliedQuestionIds: [QUESTION, 'not-an-id'],
    page: 1,
    limit: 10,
  });
  assert.equal(listed.ok, true);
  if (listed.ok) {
    assert.equal(listed.filter.category, 'risk-management');
    assert.equal(listed.filter.acceptedReplyId, null);
    assert.equal(listed.skip, 10);
    assert.equal(JSON.stringify(listed.filter).includes('$where'), false);
    assert.equal(listed.mongoSort.score, -1);
  }
  assert.equal(injected.ok, false);
  assert.equal(operator.ok, false);
  assert.equal(activity.ok, true);
  if (activity.ok) {
    const clause = activity.filter.$or[1]._id.$in;
    assert.deepEqual(clause, [QUESTION]);
  }
});

test('search treats regular expression characters as text', () => {
  const listed = buildQuestionListQuery({ search: '.*', page: 1, limit: 10 });
  assert.equal(listed.ok, true);
  if (listed.ok) assert.equal(listed.filter.$or[0].title.$regex, '\\.\\*');
});

test('question creation is rate limited per member', () => {
  clearCommunityQaRateLimits();
  const key = 'question:rate-test';
  let blocked = false;
  for (let attempt = 0; attempt < 7; attempt += 1) {
    const result = consumeCommunityQaRate({ key, limit: 6, windowMs: 1000, now: 1000 });
    if (!result.ok) blocked = result.status === 429;
  }
  assert.equal(blocked, true);
  clearCommunityQaRateLimits();
});

test('return links stay inside the community', () => {
  assert.equal(communityReturnPath('/community?view=unanswered'), '/community?view=unanswered');
  assert.equal(communityReturnPath('https://example.com'), '/community');
  assert.equal(communityReturnPath('//example.com'), '/community');
});

test('categories do not unlock a level-restricted chat room', () => {
  const join = decideCommunityRoomJoin({
    user: { userId: AUTHOR, role: 'student', learningLevel: 'beginner' },
    roomId: QUESTION,
    room: { _id: QUESTION, name: 'Advanced', type: 'global' },
  });
  assert.equal(join.ok, false);
});

test('the community flag still covers the question API', () => {
  const flags = { ...FEATURES, COMMUNITY: false };
  assert.equal(isFeatureApiBlocked('/api/community/questions', flags), true);
  assert.equal(isFeatureApiBlocked('/api/community/questions/abc/vote', flags), true);
  assert.equal(isFeatureApiBlocked('/api/community/messages', flags), true);
});

test('the Q&A store does not delete legacy chat records', () => {
  const store = fs.readFileSync(path.join(__dirname, '../lib/community-qa-store.ts'), 'utf8');
  assert.equal(store.includes('communityMessages'), false);
  assert.equal(store.includes('communityRooms'), false);
  assert.equal(store.includes('createIndex'), false);
});

test('a unique vote index is proposed and not applied by the helper script', () => {
  const voteIndex = COMMUNITY_QA_INDEXES.find((item) => item.collection === 'communityVotes');
  const script = fs.readFileSync(path.join(__dirname, '../scripts/community-qa-indexes.js'), 'utf8');
  assert.equal(voteIndex.unique, true);
  assert.equal(script.includes('MongoClient'), false);
  assert.equal(script.includes('process.exit(1)'), true);
});
