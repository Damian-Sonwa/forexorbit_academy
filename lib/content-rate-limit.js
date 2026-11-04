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
// Phase 8 learning activity signals: one every 30 s per open lesson page plus lesson opens. 300 in
// 10 minutes allows several tabs and devices at once; each minute counts once anyway
// (lib/learning-activity.js), so the limit only stops floods of writes.
const ACTIVITY_RULES = Object.freeze([Object.freeze({ id: 'learning-activity-account', max: 300, parts: ['ticket'] })]);
// Phase 9 quiz attempts: start, autosave (one request per answer change) and submit. 600 in 10
// minutes covers a 100-question quiz answered and changed several times; it stops scripted floods.
const ASSESSMENT_RULES = Object.freeze([Object.freeze({ id: 'assessment-account', max: 600, parts: ['ticket'] })]);

// Phase 10 practice trading writes: orders, closes, cancels, resets. 300 in 10 minutes is far above
// what a person can place by hand and stops scripted floods.
const TRADING_RULES = Object.freeze([Object.freeze({ id: 'practice-trading-account', max: 300, parts: ['ticket'] })]);
// Reads run the evaluator, so they are limited too, well above what an open page uses (about 40 per
// window from its 15-second refresh).
const TRADING_READ_RULES = Object.freeze([Object.freeze({ id: 'practice-trading-read', max: 1200, parts: ['ticket'] })]);

const authoringLimiter = createAuthLimiter(AUTHORING_RULES, { windowMs: WINDOW_MS });
const uploadLimiter = createAuthLimiter(UPLOAD_RULES, { windowMs: WINDOW_MS });
const activityLimiter = createAuthLimiter(ACTIVITY_RULES, { windowMs: WINDOW_MS });
const assessmentLimiter = createAuthLimiter(ASSESSMENT_RULES, { windowMs: WINDOW_MS });
const tradingLimiter = createAuthLimiter(TRADING_RULES, { windowMs: WINDOW_MS });
const tradingReadLimiter = createAuthLimiter(TRADING_READ_RULES, { windowMs: WINDOW_MS });

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
  ASSESSMENT_RULES,
  assessmentLimiter,
  TRADING_READ_RULES,
  TRADING_RULES,
  tradingLimiter,
  tradingReadLimiter,
  ACTIVITY_RULES,
  activityLimiter,
  AUTHORING_RULES,
  UPLOAD_RULES,
  WINDOW_MS,
  allowRequest,
  authoringLimiter,
  uploadLimiter,
};
