/**
 * One practical task.
 * GET     students: the task, their state, attempts and eligible simulator trades.
 *         staff: the task, distribution, per-student state and analytics.
 * PUT     instructors: save changes (body: { definition, courseId, lessonId?, resources?,
 *         expectedVersion, confirmPolicyChange?, reason? }).
 * DELETE  instructors: discard an unpublished draft.
 */
import { practicalRoute, queryText, bodyOf } from '@/lib/practical-route';
import { discardDraft, saveTask, staffTaskDetail, studentTaskDetail } from '@/lib/practical-tasks';

export default practicalRoute('practicalTask', {
  GET: {
    handler: async (req, db, member) => (member.role === 'student'
      ? studentTaskDetail(db, member, { taskId: queryText(req.query.id) })
      : staffTaskDetail(db, member, { taskId: queryText(req.query.id) })),
  },
  PUT: { handler: async (req, db, member) => saveTask(db, member, { taskId: queryText(req.query.id), body: bodyOf(req) }) },
  DELETE: { handler: async (req, db, member) => discardDraft(db, member, { taskId: queryText(req.query.id) }) },
});
