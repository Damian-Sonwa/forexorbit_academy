/**
 * One submitted attempt, for staff over the task's course.
 * GET   the grading workspace: task, student, evidence, automated assessment, grade history.
 * POST  instructors: publish a grade, return for revision, or change a grade (body: { decision,
 *       scores, criterionFeedback, feedback, expectedRevision, reason? }). Audited.
 */
import { practicalRoute, queryText, bodyOf } from '@/lib/practical-route';
import { gradeAttempt, staffAttempt } from '@/lib/practical-tasks';

export default practicalRoute('practicalTaskAttemptReview', {
  GET: { handler: async (req, db, member) => staffAttempt(db, member, { attemptId: queryText(req.query.attemptId) }) },
  POST: { handler: async (req, db, member) => gradeAttempt(db, member, { attemptId: queryText(req.query.attemptId), body: bodyOf(req) }) },
});
