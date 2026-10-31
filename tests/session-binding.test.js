/**
 * Session revocation after password reset. No database connection.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
process.env.JWT_SECRET = 'session-binding-test-secret';

const {
  sessionBinding,
  decideSessionBinding,
  issueAuthToken,
  verifyToken,
} = require('../lib/token-core');

const KEY = 'fixture-session-key';
const USER_ID = '507f1f77bcf86cd799439011';

test('a token issued before password reset is rejected and a newly issued token works', () => {
  const before = sessionBinding(USER_ID, 0, KEY);
  const stale = decideSessionBinding({
    userId: USER_ID,
    binding: before,
    generation: 1,
    key: KEY,
  });
  const replacement = sessionBinding(USER_ID, 1, KEY);
  const current = decideSessionBinding({
    userId: USER_ID,
    binding: replacement,
    generation: 1,
    key: KEY,
  });
  assert.equal(stale.ok, false);
  assert.equal(current.ok, true);
  if (!stale.ok) assert.equal(stale.status, 401);
  assert.notEqual(before, replacement);
  assert.notEqual(before, '0');
  assert.notEqual(replacement, '1');
});

test('tokens without the session binding do not match a missing generation', () => {
  const missing = decideSessionBinding({
    userId: USER_ID,
    generation: null,
    key: KEY,
  });
  const blank = decideSessionBinding({
    userId: USER_ID,
    binding: '',
    generation: 0,
    key: KEY,
  });
  assert.equal(missing.ok, false);
  assert.equal(blank.ok, false);
  if (!missing.ok) assert.equal(missing.status, 401);
});

test('a tampered binding and an expired token are rejected', () => {
  const binding = sessionBinding(USER_ID, 0, KEY);
  const tampered = `${binding.slice(0, -1)}${binding.endsWith('a') ? 'b' : 'a'}`;
  const decision = decideSessionBinding({
    userId: USER_ID,
    binding: tampered,
    generation: 0,
    key: KEY,
  });
  assert.equal(decision.ok, false);

  const expired = jwt.sign(
    { userId: USER_ID, email: 'student@example.com', role: 'student', sv: binding },
    process.env.JWT_SECRET,
    { expiresIn: -10 }
  );
  assert.throws(() => verifyToken(expired), /Invalid or expired token/);
});

test('a newly issued token carries an opaque binding and not the generation counter', () => {
  const token = issueAuthToken({
    userId: USER_ID,
    email: 'student@example.com',
    role: 'student',
    generation: 0,
    key: KEY,
  });
  const payload = jwt.verify(token, process.env.JWT_SECRET);
  const decision = decideSessionBinding({
    userId: USER_ID,
    binding: payload.sv,
    generation: 0,
    key: KEY,
  });
  assert.equal(decision.ok, true);
  assert.equal(typeof payload.sv, 'string');
  assert.equal(payload.sv.length, 64);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'sessionGeneration'), false);
});

test('a database failure while checking the session fails closed', () => {
  const decision = decideSessionBinding({
    userId: USER_ID,
    binding: sessionBinding(USER_ID, 0, KEY),
    generation: 0,
    key: KEY,
    lookupError: true,
  });
  assert.equal(decision.ok, false);
  if (!decision.ok) assert.equal(decision.status, 500);
});

test('login, reset, the API and the socket handshake use generation-bound cookie sessions', () => {
  const root = path.join(__dirname, '..');
  const login = fs.readFileSync(path.join(root, 'pages', 'api', 'auth', 'login.ts'), 'utf8');
  // The reset route delegates to lib/password-reset.js, which raises the generation.
  const resetRoute = fs.readFileSync(path.join(root, 'pages', 'api', 'auth', 'reset-password.ts'), 'utf8');
  const reset = fs.readFileSync(path.join(root, 'lib', 'password-reset.js'), 'utf8');
  const middleware = fs.readFileSync(path.join(root, 'lib', 'auth-middleware.ts'), 'utf8');
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const core = fs.readFileSync(path.join(root, 'lib', 'session-core.js'), 'utf8');
  assert.equal(login.includes('startSession(res, db, { userId: decision.user.userId, sessionGeneration: user.sessionGeneration })'), true);
  const loginResponse = login.slice(login.indexOf('res.status(200).json('));
  assert.equal(loginResponse.slice(0, loginResponse.indexOf('});')).includes('sessionGeneration'), false, 'not sent to the client');
  assert.equal(resetRoute.includes('passwordResetService.completeReset('), true);
  assert.equal(reset.includes('$inc: { sessionGeneration: 1 }'), true);
  assert.equal(reset.includes("endAccountSessions(db, String(user._id), 'password_reset', now)"), true);
  assert.equal(middleware.includes('authenticateRequest(req, res, db)'), true);
  assert.equal(server.includes('readSessionCookie(socket.handshake.headers.cookie)'), true);
  assert.equal(server.includes('resolveSession('), true);
  assert.equal(server.includes('socket.handshake.auth'), false);
  assert.equal(core.includes("if (generationOf(user) !== session.generation) return refuse('generation');"), true);
  const resetResponse = reset.slice(reset.lastIndexOf('return { status: 200'));
  assert.equal(resetResponse.includes('sessionGeneration'), false);
});
