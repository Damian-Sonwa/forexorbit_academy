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
// Phase 15: chat posting (community rooms, consultations, lesson chat): 120 messages per window.
const CHAT_RULES = Object.freeze([Object.freeze({ id: 'chat-post-account', max: 120, parts: ['ticket'] })]);
// Phase 9 quiz attempts: start, autosave (one request per answer change) and submit. 600 in 10
// minutes covers a 100-question quiz answered and changed several times; it stops scripted floods.
const ASSESSMENT_RULES = Object.freeze([Object.freeze({ id: 'assessment-account', max: 600, parts: ['ticket'] })]);

// Phase 10 practice trading writes: orders, closes, cancels, resets. 300 in 10 minutes is far above
// what a person can place by hand and stops scripted floods.
const TRADING_RULES = Object.freeze([Object.freeze({ id: 'practice-trading-account', max: 300, parts: ['ticket'] })]);
// Reads run the evaluator, so they are limited too, well above what an open page uses (about 40 per
// window from its 15-second refresh).
const TRADING_READ_RULES = Object.freeze([Object.freeze({ id: 'practice-trading-read', max: 1200, parts: ['ticket'] })]);

// Phase 11 student dashboard reads (several aggregate queries each). 300 in 10 minutes is far above
// what the page uses (one load plus range changes and activity pages).
const DASHBOARD_RULES = Object.freeze([Object.freeze({ id: 'student-dashboard-read', max: 300, parts: ['ticket'] })]);
// Phase 12 instructor portal reads (lists, queues, student records). Generous for paging and filters.
const INSTRUCTOR_READ_RULES = Object.freeze([Object.freeze({ id: 'instructor-portal-read', max: 600, parts: ['ticket'] })]);
// Phase 13 admin portal reads, and CSV exports (heavier; each one is audited).
const ADMIN_READ_RULES = Object.freeze([Object.freeze({ id: 'admin-portal-read', max: 600, parts: ['ticket'] })]);
const ADMIN_EXPORT_RULES = Object.freeze([Object.freeze({ id: 'admin-portal-export', max: 30, parts: ['ticket'] })]);

// AI lesson development (lib/lesson-ai.js): each request is one long provider call. 12 per 10 minutes
// and a daily cap per account (AI_LESSON_DAILY_LIMIT, default 40) keep free-tier quotas from being
// spent by one person or a script. Cached repeats of the same request do not count against the provider.
const AI_LESSON_RULES = Object.freeze([Object.freeze({ id: 'ai-lesson-account', max: 12, parts: ['ticket'] })]);
const AI_DAILY_MS = 24 * 60 * 60 * 1000;
const aiDailyMax = (() => { const n = Number(process.env.AI_LESSON_DAILY_LIMIT); return Number.isInteger(n) && n >= 1 && n <= 1000 ? n : 40; })();
const AI_LESSON_DAILY_RULES = Object.freeze([Object.freeze({ id: 'ai-lesson-daily', max: aiDailyMax, parts: ['ticket'] })]);
const authoringLimiter = createAuthLimiter(AUTHORING_RULES, { windowMs: WINDOW_MS });
const uploadLimiter = createAuthLimiter(UPLOAD_RULES, { windowMs: WINDOW_MS });
const activityLimiter = createAuthLimiter(ACTIVITY_RULES, { windowMs: WINDOW_MS });
const chatLimiter = createAuthLimiter(CHAT_RULES, { windowMs: WINDOW_MS });
const assessmentLimiter = createAuthLimiter(ASSESSMENT_RULES, { windowMs: WINDOW_MS });
const tradingLimiter = createAuthLimiter(TRADING_RULES, { windowMs: WINDOW_MS });
const tradingReadLimiter = createAuthLimiter(TRADING_READ_RULES, { windowMs: WINDOW_MS });
const dashboardLimiter = createAuthLimiter(DASHBOARD_RULES, { windowMs: WINDOW_MS });
const instructorReadLimiter = createAuthLimiter(INSTRUCTOR_READ_RULES, { windowMs: WINDOW_MS });
const adminReadLimiter = createAuthLimiter(ADMIN_READ_RULES, { windowMs: WINDOW_MS });
const adminExportLimiter = createAuthLimiter(ADMIN_EXPORT_RULES, { windowMs: WINDOW_MS });
const aiLessonLimiter = createAuthLimiter(AI_LESSON_RULES, { windowMs: WINDOW_MS });
const aiLessonDailyLimiter = createAuthLimiter(AI_LESSON_DAILY_RULES, { windowMs: AI_DAILY_MS });

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
  AI_LESSON_RULES,
  AI_LESSON_DAILY_RULES,
  aiLessonLimiter,
  aiLessonDailyLimiter,
  ADMIN_READ_RULES,
  ADMIN_EXPORT_RULES,
  adminReadLimiter,
  adminExportLimiter,
  INSTRUCTOR_READ_RULES,
  instructorReadLimiter,
  DASHBOARD_RULES,
  dashboardLimiter,
  ASSESSMENT_RULES,
  assessmentLimiter,
  TRADING_READ_RULES,
  TRADING_RULES,
  tradingLimiter,
  tradingReadLimiter,
  ACTIVITY_RULES,
  activityLimiter,
  CHAT_RULES,
  chatLimiter,
  AUTHORING_RULES,
  UPLOAD_RULES,
  WINDOW_MS,
  allowRequest,
  authoringLimiter,
  uploadLimiter,
};
