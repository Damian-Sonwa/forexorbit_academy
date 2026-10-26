/**
 * JWT sign and verify. The secret is read on each call from the process environment.
 */

const crypto = require('crypto');
const jwt = require('jsonwebtoken');

function secret() {
  return process.env.JWT_SECRET || '';
}

/**
 * Opaque session binding. The generation counter stays on the user record.
 * Tokens minted before this claim existed do not match generation 0.
 */
function sessionBinding(userId, generation, key) {
  const material = typeof key === 'string' ? key : secret();
  if (!material || typeof userId !== 'string' || !userId) return '';
  if (typeof generation !== 'number' || !Number.isInteger(generation) || generation < 0) return '';
  return crypto.createHmac('sha256', material).update(`${userId}:${generation}`).digest('hex');
}

function bindingsMatch(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length === 0 || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function decideSessionBinding({ userId, binding, generation, key, lookupError }) {
  if (lookupError) {
    return { ok: false, status: 500, error: 'Internal server error' };
  }
  const current = generation == null ? 0 : generation;
  const expected = sessionBinding(userId, current, key);
  if (!expected || typeof binding !== 'string' || !/^[a-f0-9]{64}$/.test(binding) || !bindingsMatch(binding, expected)) {
    return { ok: false, status: 401, error: 'Invalid or expired token' };
  }
  return { ok: true, status: 200 };
}

function issueAuthToken({ userId, email, role, generation, key }) {
  const current = generation == null ? 0 : generation;
  const sv = sessionBinding(userId, current, key);
  if (!sv) {
    throw new Error('Invalid or expired token');
  }
  return generateToken({ userId, email, role, sv });
}

function generateToken(payload) {
  return jwt.sign(payload, secret(), { expiresIn: '7d' });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, secret());
  } catch {
    throw new Error('Invalid or expired token');
  }
}

function extractToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.substring(7);
}

module.exports = {
  generateToken,
  verifyToken,
  extractToken,
  sessionBinding,
  decideSessionBinding,
  issueAuthToken,
};
