/**
 * Consultation publisher tokens. The Agora SDK is not loaded or contacted.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  decideAccountAccess,
  decideConsultationPublisherToken,
  consultationLookupId,
  consultationPublisherResponse,
  CONSULTATION_PUBLISHER_TTL_SECONDS,
} = require('../lib/account-access');

const SESSION_ID = '507f1f77bcf86cd799439011';
const STUDENT_ID = '507f1f77bcf86cd799439012';
const EXPERT_ID = '507f1f77bcf86cd799439013';

function session(overrides = {}) {
  return {
    _id: SESSION_ID,
    studentId: STUDENT_ID,
    expertId: EXPERT_ID,
    status: 'active',
    ...overrides,
  };
}

test('a student participant and the assigned expert receive a server-derived channel', () => {
  const student = decideConsultationPublisherToken({
    member: { userId: STUDENT_ID, role: 'student' },
    session: session(),
  });
  const expert = decideConsultationPublisherToken({
    member: { userId: EXPERT_ID, role: 'instructor' },
    session: session(),
  });
  assert.equal(student.ok, true);
  assert.equal(expert.ok, true);
  if (student.ok) {
    assert.equal(student.channel, `consultation_${SESSION_ID}`);
    assert.equal(student.account, STUDENT_ID);
    assert.equal(student.ttlSeconds, CONSULTATION_PUBLISHER_TTL_SECONDS);
    assert.equal(student.ttlSeconds <= 3600, true);
  }
  if (expert.ok) assert.equal(expert.account, EXPERT_ID);
});

test('admins and superadmins can join an active consultation', () => {
  for (const role of ['admin', 'superadmin']) {
    const decision = decideConsultationPublisherToken({
      member: { userId: `${role}-1`, role },
      session: session(),
    });
    assert.equal(decision.ok, true);
    if (decision.ok) assert.equal(decision.channel, `consultation_${SESSION_ID}`);
  }
});

test('unauthenticated, inactive, unrelated, and missing sessions are denied', () => {
  const anonymous = decideConsultationPublisherToken({ member: null, session: session() });
  const inactive = decideAccountAccess({
    userId: STUDENT_ID,
    record: { role: 'student', status: 'suspended', email: 'student@example.com' },
  });
  const revoked = decideConsultationPublisherToken({
    member: inactive.ok ? inactive.user : null,
    session: session(),
  });
  const stranger = decideConsultationPublisherToken({
    member: { userId: '507f1f77bcf86cd799439099', role: 'student' },
    session: session(),
  });
  const missing = decideConsultationPublisherToken({
    member: { userId: STUDENT_ID, role: 'student' },
    session: null,
  });
  const ended = decideConsultationPublisherToken({
    member: { userId: STUDENT_ID, role: 'student' },
    session: session({ status: 'ended' }),
  });
  const failed = decideConsultationPublisherToken({
    member: { userId: STUDENT_ID, role: 'student' },
    session: session(),
    lookupError: true,
  });
  assert.equal(anonymous.ok, false);
  assert.equal(revoked.ok, false);
  assert.equal(stranger.ok, false);
  assert.equal(missing.ok, false);
  assert.equal(ended.ok, false);
  assert.equal(failed.ok, false);
  if (!missing.ok) assert.equal(missing.status, 404);
  if (!stranger.ok) assert.equal(stranger.status, 403);
  if (!failed.ok) assert.equal(failed.status, 500);
  for (const decision of [anonymous, revoked, stranger, missing, ended, failed]) {
    assert.equal(Object.prototype.hasOwnProperty.call(decision, 'channel'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(decision, 'account'), false);
  }
});

test('an invalid id is rejected and the client channel is not the Agora channel', () => {
  assert.equal(consultationLookupId('not-a-session'), '');
  assert.equal(consultationLookupId(''), '');
  assert.equal(consultationLookupId(`consultation_${SESSION_ID}`), SESSION_ID);
  const decision = decideConsultationPublisherToken({
    member: { userId: STUDENT_ID, role: 'student' },
    session: session(),
  });
  const issued = consultationPublisherResponse({
    decision,
    appId: 'public-app-id',
    nowSeconds: 1_700_000_000,
    issue(request) {
      assert.equal(request.channel, `consultation_${SESSION_ID}`);
      assert.notEqual(request.channel, 'consultation_attacker');
      assert.equal(request.account, STUDENT_ID);
      assert.equal(request.privilegeExpireTime, 1_700_000_000 + CONSULTATION_PUBLISHER_TTL_SECONDS);
      return 'mock-token';
    },
  });
  assert.equal(issued.ok, true);
  if (issued.ok) {
    assert.equal(issued.body.token, 'mock-token');
    assert.equal(issued.body.uid, STUDENT_ID);
    assert.equal(Object.prototype.hasOwnProperty.call(issued.body, 'certificate'), false);
  }
});

test('a token issuer failure does not return Agora configuration', () => {
  const decision = decideConsultationPublisherToken({
    member: { userId: STUDENT_ID, role: 'student' },
    session: session(),
  });
  const failed = consultationPublisherResponse({
    decision,
    appId: 'public-app-id',
    nowSeconds: 1_700_000_000,
    issue() {
      throw new Error('sdk unavailable');
    },
  });
  assert.equal(failed.ok, false);
  if (!failed.ok) assert.equal(failed.error, 'Unable to start the call');
});

test('the Agora route authenticates and builds the token from the decision', () => {
  const route = fs.readFileSync(path.join(__dirname, '..', 'pages', 'api', 'consultations', 'agora-token.ts'), 'utf8');
  assert.equal(route.includes('withAuth(issuePublisherToken)'), true);
  assert.equal(route.includes('decideConsultationPublisherToken'), true);
  assert.equal(route.includes('buildTokenWithAccount'), true);
  assert.equal(route.includes('buildTokenWithUid'), false);
  assert.equal(route.includes('req.query.uid'), false);
  assert.equal(route.includes('error.message'), false);
  const issuer = route.slice(route.indexOf('issue:'), route.indexOf('if (!issued.ok)'));
  assert.equal(issuer.includes('decision.channel') || issuer.includes('channel,'), true);
  assert.equal(issuer.includes('channelName'), false);
});
