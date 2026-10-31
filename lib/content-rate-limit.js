'use strict';

/**
 * Rate limits for course authoring and course-image uploads (Phase 4, L4).
 *
 * Built on the auth limiter (lib/auth-rate-limit.js), so it behaves the same way: a per-process
 * count always, plus the shared MongoDB count (lib/shared-rate-limit.js) once the owner sets
 * SHARED_RATE_LIMIT=mongodb; if that shared store cannot be reached the request is refused with
 * 503 rather than let through. Counts are per signed-in account (the limiter's `ticket` slot
 * carries the account id, HMAC-keyed like every other limiter key).
 *
 * The limits are generous for real editing (saving a lesson, reordering, uploading the images of
 * a lesson) and stop scripted floods of writes or uploads from one account.
 */

const { createAuthLimiter, sendRefusal } = require('./auth-rate-limit');

const WINDOW_MS = 10 * 60 * 1000;

const AUTHORING_RULES = Object.freeze([Object.freeze({ id: 'course-authoring-account', max: 300, parts: ['ticket'] })]);
const UPLOAD_RULES = Object.freeze([Object.freeze({ id: 'course-upload-account', max: 60, parts: ['ticket'] })]);

const authoringLimiter = createAuthLimiter(AUTHORING_RULES, { windowMs: WINDOW_MS });
const uploadLimiter = createAuthLimiter(UPLOAD_RULES, { windowMs: WINDOW_MS });

/**
 * Counts one request for `userId`. Returns true when it may proceed; otherwise the 429/503
 * refusal has already been sent.
 */
async function allowRequest(limiter, { userId, res, getDb, env, now }) {
  const decision = await limiter.consume({ ticket: String(userId || ''), getDb, env, now });
  if (decision.allowed) return true;
  sendRefusal(res, decision);
  return false;
}

module.exports = {
  AUTHORING_RULES,
  UPLOAD_RULES,
  WINDOW_MS,
  allowRequest,
  authoringLimiter,
  uploadLimiter,
};
