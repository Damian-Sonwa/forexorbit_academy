'use strict';

/**
 * Server-side sessions (Phase 4.5).
 *
 * The browser holds one opaque, random session id in an HttpOnly cookie (`__Host-fo_session`).
 * JavaScript never sees a credential. The database stores only the SHA-256 of the id, so a copy of
 * the `sessions` collection cannot be replayed as a cookie.
 *
 * Lifetimes (owner decisions, 31 October 2026):
 *   - idle timeout 30 minutes (no request for 30 minutes ends the session);
 *   - absolute lifetime 12 hours from sign-in (rotation never extends it);
 *   - rotation every 15 minutes of use: a new id is issued and the old one is retired;
 *   - a 30-second grace window lets requests already in flight from other tabs, still carrying the
 *     old id, succeed. Presenting a retired id after the grace window is treated as theft: the whole
 *     chain (family) of that sign-in is revoked and the event is logged.
 *
 * Revocation: every session records the account's `sessionGeneration` at sign-in. Raising the
 * generation (sign out everywhere, password change or reset, suspension, role change) ends every
 * session of that account at its next request or socket event, without a second lookup table. The
 * helpers below also mark the records revoked so the reason is kept.
 *
 * This module never creates indexes: the app's database role may not. They are built once by a
 * privileged account with scripts/session-indexes.js.
 */

const crypto = require('crypto');
const { ObjectId } = require('mongodb');
const { decideAccountAccess } = require('./account-access');

const SESSION_COLLECTION = 'sessions';
const SECURITY_LOG_COLLECTION = 'passwordResetSecurityLogs';
const COOKIE_NAME = '__Host-fo_session';

const MINUTE = 60 * 1000;
const IDLE_TIMEOUT_MS = 30 * MINUTE;
const ABSOLUTE_LIFETIME_MS = 12 * 60 * MINUTE;
const ROTATION_INTERVAL_MS = 15 * MINUTE;
const ROTATION_GRACE_MS = 30 * 1000;
/** lastSeenAt is written at most this often, so reads do not become one write each. */
const TOUCH_INTERVAL_MS = MINUTE;

/** 32 random bytes, base64url without padding: 43 characters. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const USER_PROJECTION = Object.freeze({ email: 1, role: 1, status: 1, sessionGeneration: 1, name: 1 });

function newToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function generationOf(user) {
  return user && Number.isInteger(user.sessionGeneration) ? user.sessionGeneration : 0;
}

function time(value) {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

/** Seconds left before the absolute expiry, for the cookie's Max-Age (never negative). */
function cookieMaxAgeSeconds(session, now = new Date()) {
  return Math.max(0, Math.floor((time(session.absoluteExpiresAt) - now.getTime()) / 1000));
}

// ---------------------------------------------------------------------------------------------
// Cookies

const COOKIE_ATTRIBUTES = 'Path=/; HttpOnly; Secure; SameSite=Lax';

function sessionCookie(token, maxAgeSeconds) {
  if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) throw new Error('Invalid session id');
  const age = Number.isInteger(maxAgeSeconds) && maxAgeSeconds > 0 ? maxAgeSeconds : 0;
  return `${COOKIE_NAME}=${token}; ${COOKIE_ATTRIBUTES}; Max-Age=${age}`;
}

function clearedSessionCookie() {
  return `${COOKIE_NAME}=; ${COOKIE_ATTRIBUTES}; Max-Age=0`;
}

/**
 * The session id from a Cookie header, or null. A malformed value, or two different values under
 * the session name, gives null (the `__Host-` prefix already stops other hosts from setting it).
 */
function readSessionCookie(cookieHeader) {
  const header = Array.isArray(cookieHeader) ? cookieHeader.join('; ') : cookieHeader;
  if (typeof header !== 'string' || !header) return null;
  const values = new Set();
  for (const part of header.split(';')) {
    const at = part.indexOf('=');
    if (at === -1) continue;
    if (part.slice(0, at).trim() !== COOKIE_NAME) continue;
    values.add(part.slice(at + 1).trim());
  }
  if (values.size !== 1) return null;
  const [value] = values;
  return TOKEN_PATTERN.test(value) ? value : null;
}

// ---------------------------------------------------------------------------------------------
// Decisions (pure)

/**
 * Whether a stored session may be used now. Returns
 *   { ok: true, user, grace, rotate, touch }
 * or { ok: false, status, error, reason } with reason one of
 *   unknown | revoked | expired_absolute | expired_idle | reuse | account | generation.
 * `rotate` is never set inside the grace window (that request is a sibling of the rotation).
 */
function decideSession({ session, user, now = new Date() }) {
  const refuse = (reason, status = 401, error = 'Authentication required') => ({ ok: false, status, error, reason });
  if (!session) return refuse('unknown');
  if (session.revokedAt) return refuse('revoked');
  const at = now.getTime();
  if (at >= time(session.absoluteExpiresAt)) return refuse('expired_absolute');
  if (at - time(session.lastSeenAt) >= IDLE_TIMEOUT_MS) return refuse('expired_idle');
  let grace = false;
  if (session.rotatedAt) {
    if (at - time(session.rotatedAt) > ROTATION_GRACE_MS) return refuse('reuse');
    grace = true;
  }
  const access = decideAccountAccess({ userId: session.userId, record: user });
  if (!access.ok) return { ok: false, status: access.status, error: access.error, reason: 'account' };
  if (generationOf(user) !== session.generation) return refuse('generation');
  return {
    ok: true,
    user: access.user,
    grace,
    rotate: !grace && at - time(session.createdAt) >= ROTATION_INTERVAL_MS,
    touch: !grace && at - time(session.lastSeenAt) >= TOUCH_INTERVAL_MS,
  };
}

// ---------------------------------------------------------------------------------------------
// Store

async function logSessionEvent(db, event, { userId, detail } = {}) {
  try {
    await db.collection(SECURITY_LOG_COLLECTION).insertOne({
      event,
      ...(userId ? { userId: String(userId) } : {}),
      ...(detail ? { detail } : {}),
      createdAt: new Date(),
    });
  } catch {
    console.error('[session] security log write failed');
  }
}

function sessionRecord({ id, userId, generation, familyId, familyCreatedAt, now }) {
  return {
    _id: id,
    userId: String(userId),
    familyId,
    generation,
    createdAt: now,
    familyCreatedAt,
    lastSeenAt: now,
    absoluteExpiresAt: new Date(time(familyCreatedAt) + ABSOLUTE_LIFETIME_MS),
    rotatedAt: null,
    rotatedTo: null,
    revokedAt: null,
    revokeReason: null,
  };
}

/** A new sign-in. Returns { token, session }; the token is only ever placed in the cookie. */
async function createSession(db, { userId, generation, now = new Date() }) {
  if (!ObjectId.isValid(String(userId))) throw new Error('Invalid user id');
  if (!Number.isInteger(generation) || generation < 0) throw new Error('Invalid session generation');
  const token = newToken();
  const session = sessionRecord({
    id: hashToken(token),
    userId,
    generation,
    familyId: crypto.randomBytes(16).toString('hex'),
    familyCreatedAt: now,
    now,
  });
  await db.collection(SESSION_COLLECTION).insertOne(session);
  return { token, session };
}

/**
 * Retires `session` and issues its successor in the same family. Only one concurrent request can
 * claim the rotation (conditional update); the others carry on inside the grace window.
 * Returns { token, session } or null when another request rotated first.
 */
async function rotateSession(db, session, now = new Date()) {
  const sessions = db.collection(SESSION_COLLECTION);
  const token = newToken();
  const nextId = hashToken(token);
  const claimed = await sessions.updateOne(
    { _id: session._id, rotatedAt: null, revokedAt: null },
    { $set: { rotatedAt: now, rotatedTo: nextId } }
  );
  if (!claimed.matchedCount) return null;
  const successor = sessionRecord({
    id: nextId,
    userId: session.userId,
    generation: session.generation,
    familyId: session.familyId,
    familyCreatedAt: session.familyCreatedAt,
    now,
  });
  try {
    await sessions.insertOne(successor);
  } catch {
    // Undo the claim so the current id keeps working; rotation is tried again on a later request.
    await sessions.updateOne({ _id: session._id, rotatedTo: nextId }, { $set: { rotatedAt: null, rotatedTo: null } }).catch(() => {});
    return null;
  }
  return { token, session: successor };
}

async function revokeSessionById(db, id, reason, now = new Date()) {
  const result = await db.collection(SESSION_COLLECTION).updateOne(
    { _id: id, revokedAt: null },
    { $set: { revokedAt: now, revokeReason: reason } }
  );
  return result.matchedCount;
}

async function revokeFamily(db, familyId, reason, now = new Date()) {
  if (typeof familyId !== 'string' || !familyId) return 0;
  const result = await db.collection(SESSION_COLLECTION).updateMany(
    { familyId, revokedAt: null },
    { $set: { revokedAt: now, revokeReason: reason } }
  );
  return result.matchedCount;
}

/** Every session of the account. Pair it with a generation increase for an immediate effect. */
async function revokeUserSessions(db, userId, reason, now = new Date()) {
  const result = await db.collection(SESSION_COLLECTION).updateMany(
    { userId: String(userId), revokedAt: null },
    { $set: { revokedAt: now, revokeReason: reason } }
  );
  return result.matchedCount;
}

/**
 * Security-event revocation: every stored session of the account is revoked and its sockets on
 * this server are disconnected. Used with a sessionGeneration increase (password reset or change,
 * suspension, role change, sign out everywhere) or after the account is deleted. Never throws: the
 * generation increase (or the deletion) already ends the sessions at their next request.
 */
async function endAccountSessions(db, userId, reason, now = new Date()) {
  try {
    await revokeUserSessions(db, userId, reason, now);
  } catch {
    console.error('[session] revocation write failed');
  }
  require('./session-sockets').endSocketsForUser(null, String(userId));
}

/**
 * Looks up the session for a cookie value and decides it. On success returns
 *   { ok: true, user, session, token }
 * where `token` is a new id to set in the cookie when the session was rotated (else null).
 * Options: `rotate: false` for callers that cannot set a cookie (sockets).
 * A retired id presented after the grace window revokes its whole family. An expired or
 * generation-ended session is marked revoked. Neither the id nor its hash is ever logged.
 */
async function resolveSession(db, token, { now = new Date(), rotate = true } = {}) {
  if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) {
    return { ok: false, status: 401, error: 'Authentication required', reason: 'unknown' };
  }
  const id = hashToken(token);
  const sessions = db.collection(SESSION_COLLECTION);
  const session = await sessions.findOne({ _id: id });
  let user = null;
  if (session && ObjectId.isValid(String(session.userId))) {
    user = await db.collection('users').findOne({ _id: new ObjectId(String(session.userId)) }, { projection: USER_PROJECTION });
  }
  const decision = decideSession({ session, user, now });
  if (!decision.ok) {
    if (decision.reason === 'reuse') {
      await revokeFamily(db, session.familyId, 'reuse_detected', now);
      await logSessionEvent(db, 'session_reuse_detected', { userId: session.userId });
    } else if (session && !session.revokedAt && decision.reason !== 'unknown') {
      await revokeSessionById(db, id, decision.reason, now);
    }
    return decision;
  }
  if (rotate && decision.rotate) {
    const rotated = await rotateSession(db, session, now);
    if (rotated) return { ok: true, user: decision.user, session: rotated.session, token: rotated.token };
  } else if (decision.touch) {
    await sessions.updateOne({ _id: id, revokedAt: null, rotatedAt: null }, { $set: { lastSeenAt: now } });
  }
  return { ok: true, user: decision.user, session, token: null };
}

module.exports = {
  ABSOLUTE_LIFETIME_MS,
  COOKIE_NAME,
  IDLE_TIMEOUT_MS,
  ROTATION_GRACE_MS,
  ROTATION_INTERVAL_MS,
  SESSION_COLLECTION,
  TOKEN_PATTERN,
  TOUCH_INTERVAL_MS,
  clearedSessionCookie,
  cookieMaxAgeSeconds,
  createSession,
  decideSession,
  endAccountSessions,
  generationOf,
  hashToken,
  logSessionEvent,
  readSessionCookie,
  resolveSession,
  revokeFamily,
  revokeSessionById,
  revokeUserSessions,
  rotateSession,
  sessionCookie,
};
