'use strict';

/**
 * Cookie sessions for route tests (Phase 4.5). A "session token" in the tests is the raw session id
 * a browser holds in its HttpOnly cookie; the database row stores only its SHA-256 (as the app does).
 *
 *   seedSession(rows, { userId, generation })  inserts a valid session row, returns the raw id
 *   requestHeaders(token)                      Cookie, Origin and CSRF headers of a same-origin call
 *   sessionFromResponse(res)                   the id a response set (null when it cleared the cookie)
 *
 * Tests run with NODE_ENV=test and no APP_ORIGIN, so the trusted origin is the local dev server.
 */

const crypto = require('crypto');
const { COOKIE_NAME, hashToken } = require('../../lib/session-core');

const TEST_ORIGIN = `http://localhost:${process.env.PORT || '3000'}`;
const ABSOLUTE_MS = 12 * 60 * 60 * 1000;

function seedSession(rows, { userId, generation = 0, now = new Date(), familyId, createdAt, lastSeenAt } = {}) {
  const token = crypto.randomBytes(32).toString('base64url');
  const created = createdAt || now;
  rows.push({
    _id: hashToken(token),
    userId: String(userId),
    familyId: familyId || crypto.randomBytes(16).toString('hex'),
    generation,
    createdAt: created,
    familyCreatedAt: created,
    lastSeenAt: lastSeenAt || now,
    absoluteExpiresAt: new Date(created.getTime() + ABSOLUTE_MS),
    rotatedAt: null,
    rotatedTo: null,
    revokedAt: null,
    revokeReason: null,
  });
  return token;
}

function requestHeaders(token, extra = {}) {
  return {
    origin: TEST_ORIGIN,
    'x-fo-csrf': '1',
    ...(token ? { cookie: `${COOKIE_NAME}=${token}` } : {}),
    ...extra,
  };
}

function setCookies(res) {
  const raw = typeof res.getHeader === 'function' ? res.getHeader('Set-Cookie') : res.headers && res.headers['set-cookie'];
  if (raw == null) return [];
  return Array.isArray(raw) ? raw.map(String) : [String(raw)];
}

/** The last session id this response set, or null (none set, or the cookie was cleared). */
function sessionFromResponse(res) {
  let value = null;
  for (const cookie of setCookies(res)) {
    const match = new RegExp(`^${COOKIE_NAME}=([^;]*)`).exec(cookie);
    if (match) value = match[1] || null;
  }
  return value;
}

module.exports = { TEST_ORIGIN, requestHeaders, seedSession, sessionFromResponse, setCookies };
