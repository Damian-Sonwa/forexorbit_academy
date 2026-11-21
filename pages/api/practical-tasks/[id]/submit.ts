/**
 * POST: submit the attempt in progress (students). Body: { positionIds, explanation, external,
 * confirm: true }. Evidence is frozen from the server's trading records; automatic tasks are graded
 * at once, others are queued for the instructor.
 */
import { practicalRoute, queryText, bodyOf } from '@/lib/practical-route';
import { submitAttempt } from '@/lib/practical-tasks';
import { assessmentLimiter } from '@/lib/content-rate-limit';

export default practicalRoute('practicalTaskSubmit', { POST: { limiter: assessmentLimiter, handler: async (req, db, member) => submitAttempt(db, member, { taskId: queryText(req.query.id), body: bodyOf(req) }) } });
