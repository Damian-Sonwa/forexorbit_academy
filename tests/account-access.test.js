/**
 * Authorization decisions without a database or live credentials.
 * The former operator email is used only as a fixture to prove it grants nothing.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const { decideAccountAccess, canJoinConsultation } = require('../lib/account-access');
const { generateToken, verifyToken } = require('../lib/token-core');

const FORMER_PRIVILEGED_EMAIL = 'madudamian25@gmail.com';
const USER_ID = '507f1f77bcf86cd799439011';

process.env.JWT_SECRET = 'account-access-test-secret';

function record(overrides) {
  return {
    email: 'student@example.com',
    role: 'student',
    status: 'approved',
    ...overrides,
  };
}

test('former privileged email with a student role cannot access admin routes', () => {
  const decision = decideAccountAccess({
    userId: USER_ID,
    record: record({ email: FORMER_PRIVILEGED_EMAIL, role: 'student' }),
    allowedRoles: ['admin', 'superadmin'],
  });
  assert.equal(decision.ok, false);
  assert.equal(decision.status, 403);
});

test('a current superadmin record can access admin routes', () => {
  const decision = decideAccountAccess({
    userId: USER_ID,
    record: record({ email: 'operator@example.com', role: 'superadmin' }),
    allowedRoles: ['admin', 'superadmin'],
  });
  assert.equal(decision.ok, true);
  if (decision.ok) assert.equal(decision.user.role, 'superadmin');
});

test('an old admin token claim does not override a downgraded student record', () => {
  const staleClaim = { userId: USER_ID, email: FORMER_PRIVILEGED_EMAIL, role: 'superadmin' };
  const decision = decideAccountAccess({
    userId: staleClaim.userId,
    record: record({ email: FORMER_PRIVILEGED_EMAIL, role: 'student', status: 'approved' }),
    allowedRoles: ['admin', 'superadmin'],
  });
  assert.equal(decision.ok, false);
  assert.notEqual(decision.ok ? decision.user.role : 'student', staleClaim.role);
});

test('a deactivated account cannot use a previously privileged role', () => {
  for (const status of ['deactivated', 'suspended', 'disabled', 'inactive', 'rejected', 'pending']) {
    const decision = decideAccountAccess({
      userId: USER_ID,
      record: record({ role: 'admin', status }),
      allowedRoles: ['admin', 'superadmin'],
    });
    assert.equal(decision.ok, false, status);
    assert.equal(decision.status, 403, status);
  }
});

test('a missing user cannot access a protected route', () => {
  const decision = decideAccountAccess({
    userId: USER_ID,
    record: null,
    allowedRoles: ['student'],
  });
  assert.equal(decision.ok, false);
  assert.equal(decision.status, 401);
});

test('students and instructors keep their own routes', () => {
  const student = decideAccountAccess({
    userId: USER_ID,
    record: record({ role: 'student' }),
    allowedRoles: ['student'],
  });
  const instructor = decideAccountAccess({
    userId: USER_ID,
    record: record({ role: 'instructor', email: 'instructor@example.com' }),
    allowedRoles: ['instructor', 'admin'],
  });
  const instructorBlocked = decideAccountAccess({
    userId: USER_ID,
    record: record({ role: 'instructor' }),
    allowedRoles: ['admin', 'superadmin'],
  });
  assert.equal(student.ok, true);
  assert.equal(instructor.ok, true);
  assert.equal(instructorBlocked.ok, false);
});

test('a missing status remains active for backward compatibility', () => {
  const decision = decideAccountAccess({
    userId: USER_ID,
    record: { email: 'student@example.com', role: 'student' },
    allowedRoles: ['student'],
  });
  assert.equal(decision.ok, true);
});

test('consultation access follows the current role, not a stale superadmin claim', () => {
  const staleClaim = { role: 'superadmin' };
  const current = decideAccountAccess({
    userId: USER_ID,
    record: record({ email: FORMER_PRIVILEGED_EMAIL, role: 'student' }),
  });
  assert.equal(current.ok, true);
  assert.equal(
    canJoinConsultation(current.user, { studentId: 'someone-else', expertId: USER_ID }),
    false
  );
  assert.notEqual(current.user.role, staleClaim.role);

  const admin = decideAccountAccess({
    userId: USER_ID,
    record: record({ role: 'admin' }),
  });
  assert.equal(canJoinConsultation(admin.user, { studentId: 'student-1', expertId: 'expert-1' }), true);
});

test('invalid, expired, and tampered tokens are rejected', () => {
  const token = generateToken({
    userId: USER_ID,
    email: 'student@example.com',
    role: 'student',
  });
  assert.equal(verifyToken(token).userId, USER_ID);

  const expired = jwt.sign(
    { userId: USER_ID, email: 'student@example.com', role: 'admin' },
    process.env.JWT_SECRET,
    { expiresIn: -10 }
  );
  assert.throws(() => verifyToken(expired), /Invalid or expired token/);

  const tampered = `${token.slice(0, -4)}xxxx`;
  assert.throws(() => verifyToken(tampered), /Invalid or expired token/);
  assert.throws(() => verifyToken('not-a-token'), /Invalid or expired token/);
});

test('request authorization no longer special-cases the former operator email', () => {
  const root = path.join(__dirname, '..');
  const files = [
    'lib/account-access.js',
    'lib/auth-middleware.ts',
    'pages/api/auth/login.ts',
    'pages/api/auth/me.ts',
    'pages/api/admin/users/[id].ts',
    'pages/api/admin/approvals.ts',
    'pages/api/consultations/admin.ts',
    'pages/api/consultations/requests.ts',
    'pages/api/consultations/seed-experts.ts',
    'pages/admin/index.tsx',
    'server.js',
    'server/socket.ts',
  ];
  for (const relative of files) {
    const text = fs.readFileSync(path.join(root, relative), 'utf8');
    assert.equal(text.includes(FORMER_PRIVILEGED_EMAIL), false, relative);
  }
  const middleware = fs.readFileSync(path.join(root, 'lib/auth-middleware.ts'), 'utf8');
  assert.match(middleware, /decideAccountAccess/);
  const socketServer = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  assert.match(socketServer, /decideAccountAccess/);
  assert.match(socketServer, /canJoinConsultation/);
});
