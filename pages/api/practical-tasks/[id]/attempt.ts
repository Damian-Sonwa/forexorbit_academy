/**
 * The student's attempt at a task.
 * POST  start an attempt (idempotent: an attempt in progress is returned as it is).
 * PUT   save work in progress (body: { explanation, positionIds, external }).
 */
import { practicalRoute, queryText, bodyOf } from '@/lib/practical-route';
import { saveDraft, startAttempt } from '@/lib/practical-tasks';
import { assessmentLimiter } from '@/lib/content-rate-limit';

export default practicalRoute('practicalTaskAttempt', {
  POST: { limiter: assessmentLimiter, handler: async (req, db, member) => startAttempt(db, member, { taskId: queryText(req.query.id) }) },
  PUT: { limiter: assessmentLimiter, handler: async (req, db, member) => saveDraft(db, member, { taskId: queryText(req.query.id), body: bodyOf(req) }) },
});
